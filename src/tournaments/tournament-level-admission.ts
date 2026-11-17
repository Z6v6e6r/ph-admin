import { createHash } from 'crypto';
import { PLAYER_RATING_PRECISION, ratingNumericToGrade } from '../player-ratings/player-ratings.types';

/**
 * Tournament level admission, version 2.
 *
 * One server-side rule for every CUP route that admits a player into a tournament. Clients
 * (LK1 browser, Node-RED gateways, composite purchase) receive the decision; they never
 * re-implement it. The player level always comes from CUP `player_rating_state`; this module
 * has no provider dependency and must not gain one (see test/tournament-level-admission.test.ts).
 */

export const TOURNAMENT_LEVEL_POLICY_VERSION = 'tournament-level-v2' as const;

/** Same bands and grid as the CUP admin range slider (`client-sdk/phab-admin-panel.js`). */
export const TOURNAMENT_LEVEL_GRID_BANDS = [
  { base: 'D', min: 1, max: 2 },
  { base: 'D+', min: 2, max: 3 },
  { base: 'C', min: 3, max: 3.5 },
  { base: 'C+', min: 3.5, max: 4 },
  { base: 'B', min: 4, max: 4.7 },
  { base: 'B+', min: 4.7, max: 5.5 },
  { base: 'A', min: 5.5, max: 6.3 }
] as const;
export const TOURNAMENT_LEVEL_GRID_DIVISIONS = 4;

const GRADES = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const;
export type TournamentLevelGrade = (typeof GRADES)[number];

/** Comparisons use CUP canonical rating precision (5 decimals) as integers. */
const SCALE = 10 ** PLAYER_RATING_PRECISION;
const toScaled = (value: number): number => Math.round(value * SCALE);
const fromScaled = (value: number): number => Number((value / SCALE).toFixed(PLAYER_RATING_PRECISION));

const formatGridToken = (value: number): string =>
  value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

/** Ordered slider tokens exactly as the admin panel builds them. */
export const TOURNAMENT_LEVEL_GRID: ReadonlyArray<{ token: string; scaled: number }> = (() => {
  const grid: Array<{ token: string; scaled: number }> = [];
  TOURNAMENT_LEVEL_GRID_BANDS.forEach((band, bandIndex) => {
    for (let step = 0; step <= TOURNAMENT_LEVEL_GRID_DIVISIONS; step += 1) {
      if (bandIndex > 0 && step === 0) continue;
      const value = band.min + (band.max - band.min) * (step / TOURNAMENT_LEVEL_GRID_DIVISIONS);
      grid.push({ token: formatGridToken(value), scaled: toScaled(Number(formatGridToken(value))) });
    }
  });
  return grid;
})();

/**
 * Upper limit of the per-tournament tolerance: the widest single grade band of the agreed scale
 * (D+ 2.0–3.0). A wider tolerance would admit a whole additional grade on one side.
 */
export const LEVEL_TOLERANCE_MAX = Math.max(...TOURNAMENT_LEVEL_GRID_BANDS.map((band) => band.max - band.min));
/** Default suggested for newly created tournaments; absent field on existing rows means 0. */
export const LEVEL_TOLERANCE_NEW_TOURNAMENT_DEFAULT = 0.2;

export type TournamentLevelRule =
  | { kind: 'NONE' }
  | { kind: 'RANGE'; min: number; max: number | null }
  | { kind: 'CATEGORIES'; grades: TournamentLevelGrade[] }
  | { kind: 'INVALID'; reason: 'MIXED_FORMAT' | 'UNKNOWN_TOKEN' | 'NON_CONTIGUOUS' | 'TOLERANCE_INVALID' | 'NOT_A_LIST' };

export type TournamentLevelAdmissionMode = 'LEGACY' | 'ENFORCE' | 'OFF';

/**
 * Rollout switch. Unset/unknown keeps the pre-v2 behavior byte-for-byte (LEGACY). ENFORCE turns on
 * the continuous range, the tolerance and the checks on the energy/subscription/decision routes.
 * OFF is an emergency switch that admits without a level check. No mode deletes settings or
 * participants.
 */
export function readTournamentLevelAdmissionMode(env: NodeJS.ProcessEnv = process.env): TournamentLevelAdmissionMode {
  const value = String(env.TOURNAMENT_LEVEL_ADMISSION_MODE ?? '').trim().toLowerCase();
  if (value === 'enforce') return 'ENFORCE';
  if (value === 'off') return 'OFF';
  return 'LEGACY';
}

export class LevelToleranceValidationError extends Error {}

/** Validates an organizer-supplied tolerance. 0 is a valid value and is preserved as 0. */
export function normalizeLevelToleranceInput(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LevelToleranceValidationError('levelTolerance must be a finite number');
  }
  if (value < 0) throw new LevelToleranceValidationError('levelTolerance must not be negative');
  const scaled = toScaled(value);
  if (Math.abs(scaled - value * SCALE) > 1e-6) {
    throw new LevelToleranceValidationError(`levelTolerance supports at most ${PLAYER_RATING_PRECISION} decimals`);
  }
  if (scaled > toScaled(LEVEL_TOLERANCE_MAX)) {
    throw new LevelToleranceValidationError(`levelTolerance must not exceed ${LEVEL_TOLERANCE_MAX}`);
  }
  return fromScaled(scaled);
}

/** Stored value: absent/null means 0 for existing tournaments; anything else invalid is reported. */
export function readStoredLevelTolerance(value: unknown): number | 'INVALID' {
  if (value === undefined || value === null) return 0;
  try {
    return normalizeLevelToleranceInput(value);
  } catch {
    return 'INVALID';
  }
}

const NUMERIC_TOKEN = /^\d+(?:[.,]\d+)?$/;

/**
 * Interprets the stored `accessLevels`.
 * - Slider tokens forming one contiguous run of the grid are a continuous range [first, last].
 *   The top grid token (6.3) is open-ended because canonical ratings reach 7.
 * - Plain grade labels (legacy rows) stay a set of allowed grades; they are not converted into a
 *   range because their semantics as a range were never confirmed.
 * - Anything else is INVALID and never means "no restriction".
 */
export function parseTournamentLevelRule(accessLevels: unknown): TournamentLevelRule {
  if (accessLevels === undefined || accessLevels === null) return { kind: 'NONE' };
  if (!Array.isArray(accessLevels)) return { kind: 'INVALID', reason: 'NOT_A_LIST' };
  const items = accessLevels.map((item) => String(item ?? '').trim().toUpperCase()).filter(Boolean);
  if (items.length === 0) return { kind: 'NONE' };
  const numeric = items.filter((item) => NUMERIC_TOKEN.test(item));
  if (numeric.length > 0 && numeric.length !== items.length) return { kind: 'INVALID', reason: 'MIXED_FORMAT' };
  if (numeric.length === 0) {
    if (!items.every((item) => (GRADES as readonly string[]).includes(item))) {
      return { kind: 'INVALID', reason: 'UNKNOWN_TOKEN' };
    }
    const grades = GRADES.filter((grade) => items.includes(grade));
    return grades.length === GRADES.length ? { kind: 'NONE' } : { kind: 'CATEGORIES', grades: [...grades] };
  }
  const indexes = new Set<number>();
  for (const item of numeric) {
    const scaled = toScaled(Number(item.replace(',', '.')));
    const index = TOURNAMENT_LEVEL_GRID.findIndex((entry) => entry.scaled === scaled);
    if (index < 0) return { kind: 'INVALID', reason: 'UNKNOWN_TOKEN' };
    indexes.add(index);
  }
  const sorted = [...indexes].sort((left, right) => left - right);
  if (sorted[sorted.length - 1] - sorted[0] + 1 !== sorted.length) return { kind: 'INVALID', reason: 'NON_CONTIGUOUS' };
  if (sorted.length === TOURNAMENT_LEVEL_GRID.length) return { kind: 'NONE' };
  const last = sorted[sorted.length - 1];
  return {
    kind: 'RANGE',
    min: fromScaled(TOURNAMENT_LEVEL_GRID[sorted[0]].scaled),
    max: last === TOURNAMENT_LEVEL_GRID.length - 1 ? null : fromScaled(TOURNAMENT_LEVEL_GRID[last].scaled)
  };
}

export type PlayerLevelEvidence =
  | { status: 'OK'; ratingNumeric: number }
  | { status: 'MISSING' }
  | { status: 'UNKNOWN' }
  | { status: 'UNAVAILABLE' };

export type TournamentLevelReasonCode =
  | 'LEVEL_NOT_RESTRICTED'
  | 'LEVEL_ALLOWED'
  | 'LEVEL_ALLOWED_WITH_TOLERANCE'
  | 'LEVEL_NOT_ALLOWED'
  | 'PLAYER_LEVEL_REQUIRED'
  | 'PLAYER_LEVEL_UNKNOWN'
  | 'LEVEL_CHECK_UNAVAILABLE'
  | 'ACTIVITY_LEVEL_INVALID'
  | 'LEVEL_GATE_DISABLED'
  | 'LEVEL_GATE_LEGACY';

export interface TournamentLevelRange {
  min: number;
  /** null: no upper bound. */
  max: number | null;
}

/** Shared decision contract for LK1, Node-RED gateways and composite purchase. */
export interface TournamentLevelDecision {
  schemaVersion: 1;
  policyVersion: typeof TOURNAMENT_LEVEL_POLICY_VERSION;
  mode: TournamentLevelAdmissionMode;
  /** True only in ENFORCE: CUP write routes apply exactly this decision. */
  enforced: boolean;
  allowed: boolean;
  reasonCode: TournamentLevelReasonCode;
  message: string;
  ruleKind: TournamentLevelRule['kind'];
  baseRange: TournamentLevelRange | null;
  allowedGrades: TournamentLevelGrade[] | null;
  levelTolerance: number;
  effectiveRange: TournamentLevelRange | null;
  playerLevel: number | null;
  /** Changes whenever the range, tolerance or tournament revision changes. */
  ruleVersion: string;
  ruleUpdatedAt: string | null;
  evaluatedAt: string;
}

export interface TournamentLevelRuleInput {
  id: string;
  accessLevels: unknown;
  levelTolerance?: unknown;
  updatedAt?: string | null;
}

export function tournamentLevelRuleVersion(input: TournamentLevelRuleInput): string {
  const levels = Array.isArray(input.accessLevels)
    ? input.accessLevels.map((item) => String(item ?? '').trim().toUpperCase()).sort()
    : input.accessLevels ?? null;
  const digest = createHash('sha256')
    .update(JSON.stringify({ id: input.id, levels, tolerance: input.levelTolerance ?? null, updatedAt: input.updatedAt ?? null }))
    .digest('hex')
    .slice(0, 16);
  return `${TOURNAMENT_LEVEL_POLICY_VERSION}:${digest}`;
}

/** Resolved rule plus tolerance; a corrupt tolerance makes the whole restricted rule INVALID. */
export function resolveTournamentLevelRule(input: TournamentLevelRuleInput): {
  rule: TournamentLevelRule;
  tolerance: number;
} {
  const rule = parseTournamentLevelRule(input.accessLevels);
  const tolerance = readStoredLevelTolerance(input.levelTolerance);
  if (tolerance === 'INVALID') {
    return { rule: rule.kind === 'NONE' ? rule : { kind: 'INVALID', reason: 'TOLERANCE_INVALID' }, tolerance: 0 };
  }
  return { rule, tolerance: rule.kind === 'RANGE' ? tolerance : 0 };
}

/** True when admission depends on the player's level (INVALID is restricted and fails closed). */
export function isTournamentLevelRestricted(input: TournamentLevelRuleInput): boolean {
  return resolveTournamentLevelRule(input).rule.kind !== 'NONE';
}

const formatLevel = (value: number): string => value.toFixed(2).replace('.', ',');
export const formatTournamentLevelRange = (range: TournamentLevelRange): string =>
  range.max === null ? `от ${formatLevel(range.min)}` : `${formatLevel(range.min)}–${formatLevel(range.max)}`;

export function evaluateTournamentLevelAdmission(
  input: TournamentLevelRuleInput,
  player: PlayerLevelEvidence,
  options: { mode: TournamentLevelAdmissionMode; now?: Date }
): TournamentLevelDecision {
  const { rule, tolerance } = resolveTournamentLevelRule(input);
  const baseRange = rule.kind === 'RANGE' ? { min: rule.min, max: rule.max } : null;
  const effectiveRange = rule.kind === 'RANGE'
    ? {
        min: fromScaled(toScaled(rule.min) - toScaled(tolerance)),
        max: rule.max === null ? null : fromScaled(toScaled(rule.max) + toScaled(tolerance))
      }
    : null;
  const playerLevel = player.status === 'OK' ? player.ratingNumeric : null;
  const base = {
    schemaVersion: 1 as const,
    policyVersion: TOURNAMENT_LEVEL_POLICY_VERSION,
    mode: options.mode,
    enforced: options.mode === 'ENFORCE',
    ruleKind: rule.kind,
    baseRange,
    allowedGrades: rule.kind === 'CATEGORIES' ? rule.grades : null,
    levelTolerance: tolerance,
    effectiveRange,
    playerLevel,
    ruleVersion: tournamentLevelRuleVersion(input),
    ruleUpdatedAt: input.updatedAt ?? null,
    evaluatedAt: (options.now ?? new Date()).toISOString()
  };
  const decide = (allowed: boolean, reasonCode: TournamentLevelReasonCode, message: string): TournamentLevelDecision =>
    ({ ...base, allowed, reasonCode, message });

  if (options.mode === 'OFF') return decide(true, 'LEVEL_GATE_DISABLED', 'Проверка уровня временно отключена.');
  if (rule.kind === 'NONE') return decide(true, 'LEVEL_NOT_RESTRICTED', 'Турнир доступен без ограничений по уровню.');
  if (rule.kind === 'INVALID') {
    return decide(false, 'ACTIVITY_LEVEL_INVALID', 'Ограничение уровня турнира настроено некорректно. Запись временно недоступна.');
  }
  if (player.status === 'MISSING') {
    return decide(false, 'PLAYER_LEVEL_REQUIRED', 'Уровень не определён. Определите уровень, чтобы записаться на турнир.');
  }
  if (player.status === 'UNKNOWN') {
    return decide(false, 'PLAYER_LEVEL_UNKNOWN', 'Уровень не удалось однозначно подтвердить. Обратитесь к организатору.');
  }
  if (player.status === 'UNAVAILABLE') {
    return decide(false, 'LEVEL_CHECK_UNAVAILABLE', 'Проверка уровня временно недоступна. Повторите попытку позже.');
  }
  const rating = player.ratingNumeric;
  if (!Number.isFinite(rating)) {
    return decide(false, 'PLAYER_LEVEL_UNKNOWN', 'Уровень не удалось однозначно подтвердить. Обратитесь к организатору.');
  }
  if (rule.kind === 'CATEGORIES') {
    const grade = ratingNumericToGrade(rating);
    return grade && (rule.grades as string[]).includes(grade)
      ? decide(true, 'LEVEL_ALLOWED', 'Ваш уровень подходит для турнира.')
      : decide(false, 'LEVEL_NOT_ALLOWED', `Турнир для уровней ${rule.grades.join(', ')}. Ваш уровень: ${formatLevel(rating)}.`);
  }
  const scaled = toScaled(rating);
  const inside = (range: TournamentLevelRange) =>
    scaled >= toScaled(range.min) && (range.max === null || scaled <= toScaled(range.max));
  if (inside(baseRange!)) return decide(true, 'LEVEL_ALLOWED', 'Ваш уровень подходит для турнира.');
  if (inside(effectiveRange!)) {
    return decide(true, 'LEVEL_ALLOWED_WITH_TOLERANCE', 'Ваш уровень подходит с учётом допуска турнира.');
  }
  return decide(
    false,
    'LEVEL_NOT_ALLOWED',
    `Ваш уровень ${formatLevel(rating)} вне допустимого диапазона ${formatTournamentLevelRange(effectiveRange!)}.`
  );
}

/** Display projection shared by public views; never a substitute for the decision route. */
export interface TournamentLevelRuleView {
  policyVersion: typeof TOURNAMENT_LEVEL_POLICY_VERSION;
  mode: TournamentLevelAdmissionMode;
  enforced: boolean;
  ruleKind: TournamentLevelRule['kind'];
  baseRange: TournamentLevelRange | null;
  allowedGrades: TournamentLevelGrade[] | null;
  levelTolerance: number;
  effectiveRange: TournamentLevelRange | null;
  ruleVersion: string;
}

export function describeTournamentLevelRule(
  input: TournamentLevelRuleInput,
  mode: TournamentLevelAdmissionMode
): TournamentLevelRuleView {
  const decision = evaluateTournamentLevelAdmission(input, { status: 'UNAVAILABLE' }, { mode: 'ENFORCE' });
  return {
    policyVersion: TOURNAMENT_LEVEL_POLICY_VERSION,
    mode,
    enforced: mode === 'ENFORCE',
    ruleKind: decision.ruleKind,
    baseRange: decision.baseRange,
    allowedGrades: decision.allowedGrades,
    levelTolerance: decision.levelTolerance,
    effectiveRange: decision.effectiveRange,
    ruleVersion: decision.ruleVersion
  };
}

/** Organizer report over the existing roster; never changes participation. */
export interface TournamentLevelAdmissionReport {
  tournamentId: string;
  rule: TournamentLevelRuleView;
  generatedAt: string;
  truncated: boolean;
  checked: number;
  outsideRule: number;
  entries: Array<{
    participantId: string | null;
    name: string;
    phoneMasked: string | null;
    list: 'PARTICIPANT' | 'WAITLIST';
    status: string | null;
    paymentStatus: string | null;
    allowed: boolean;
    reasonCode: TournamentLevelReasonCode;
    playerLevel: number | null;
  }>;
}
