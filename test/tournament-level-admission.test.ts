import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEVEL_TOLERANCE_MAX,
  TOURNAMENT_LEVEL_GRID,
  evaluateTournamentLevelAdmission,
  normalizeLevelToleranceInput,
  parseTournamentLevelRule,
  readStoredLevelTolerance,
  readTournamentLevelAdmissionMode,
  type PlayerLevelEvidence,
  type TournamentLevelRuleInput
} from '../src/tournaments/tournament-level-admission';

/** Slider tokens for 3.0–3.5 exactly as client-sdk/phab-admin-panel.js stores them. */
const C_SLIDER = ['3', '3.125', '3.25', '3.375', '3.5'];
const ok = (ratingNumeric: number): PlayerLevelEvidence => ({ status: 'OK', ratingNumeric });
const rule = (accessLevels: unknown, levelTolerance?: unknown): TournamentLevelRuleInput => ({
  id: 't-1', accessLevels, levelTolerance, updatedAt: '2026-11-17T10:00:00.000Z'
});
const decide = (input: TournamentLevelRuleInput, player: PlayerLevelEvidence) =>
  evaluateTournamentLevelAdmission(input, player, { mode: 'ENFORCE', now: new Date('2026-11-17T12:00:00.000Z') });

function expect(input: TournamentLevelRuleInput, rating: number, allowed: boolean, reason?: string): void {
  const decision = decide(input, ok(rating));
  assert.equal(decision.allowed, allowed, `rating ${rating} tolerance ${String(input.levelTolerance)} → ${decision.reasonCode}`);
  if (reason) assert.equal(decision.reasonCode, reason, `rating ${rating}`);
}

// Regression first: the audited defect (3.31 refused inside 3.0–3.5 stored as slider points).
expect(rule(C_SLIDER, 0), 3.31, true, 'LEVEL_ALLOWED');

// Required matrix, tolerance 0.
for (const rating of [3.0, 3.31, 3.5]) expect(rule(C_SLIDER, 0), rating, true, 'LEVEL_ALLOWED');
for (const rating of [2.99999, 2.9, 3.50001, 3.6]) expect(rule(C_SLIDER, 0), rating, false, 'LEVEL_NOT_ALLOWED');

// Required matrix, tolerance 0.20 in canonical CUP precision (5 decimals).
expect(rule(C_SLIDER, 0.2), 2.79999, false, 'LEVEL_NOT_ALLOWED');
expect(rule(C_SLIDER, 0.2), 2.8, true, 'LEVEL_ALLOWED_WITH_TOLERANCE');
expect(rule(C_SLIDER, 0.2), 2.9, true, 'LEVEL_ALLOWED_WITH_TOLERANCE');
expect(rule(C_SLIDER, 0.2), 3.31, true, 'LEVEL_ALLOWED');
expect(rule(C_SLIDER, 0.2), 3.7, true, 'LEVEL_ALLOWED_WITH_TOLERANCE');
expect(rule(C_SLIDER, 0.2), 3.70001, false, 'LEVEL_NOT_ALLOWED');

// The decision exposes the full contract for clients.
{
  const decision = decide(rule(C_SLIDER, 0.2), ok(2.9));
  assert.deepEqual(decision.baseRange, { min: 3, max: 3.5 });
  assert.deepEqual(decision.effectiveRange, { min: 2.8, max: 3.7 });
  assert.equal(decision.levelTolerance, 0.2);
  assert.equal(decision.playerLevel, 2.9);
  assert.equal(decision.enforced, true);
  assert.match(decision.ruleVersion, /^tournament-level-v2:[0-9a-f]{16}$/);
  assert.notEqual(decision.ruleVersion, decide(rule(C_SLIDER, 0.3), ok(2.9)).ruleVersion);
  assert.match(decide(rule(C_SLIDER, 0.2), ok(3.8)).message, /3,80 вне допустимого диапазона 2,80–3,70/);
}

// Tolerance does not round the player rating to a grid point and is symmetric, not per point.
expect(rule(['3.25'], 0), 3.25, true);
expect(rule(['3.25'], 0), 3.25001, false);
expect(rule(['3.25'], 0.2), 3.45, true);
expect(rule(['3.25'], 0.2), 3.45001, false);

// Old tournament without the field means tolerance 0; stored 0 stays 0.
assert.equal(readStoredLevelTolerance(undefined), 0);
assert.equal(readStoredLevelTolerance(null), 0);
assert.equal(readStoredLevelTolerance(0), 0);
expect(rule(C_SLIDER), 3.6, false);
expect(rule(C_SLIDER, 0), 3.6, false);

// Tournament without a range stays unrestricted and needs no player level.
for (const levels of [[], undefined, null, TOURNAMENT_LEVEL_GRID.map((entry) => entry.token)]) {
  const decision = decide(rule(levels, 0.2), { status: 'MISSING' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, 'LEVEL_NOT_RESTRICTED');
}

// Top grid token is open-ended: canonical ratings reach 7.
expect(rule(['5.7', '5.9', '6.1', '6.3']), 6.9, true);
expect(rule(['5.7', '5.9', '6.1', '6.3']), 5.69999, false);

// Legacy grade lists keep set semantics (no silent widening across adjacent grades).
expect(rule(['C']), 3.31, true);
expect(rule(['C']), 3.5, false); // 3.5 is C+ by the canonical grade formula
expect(rule(['C']), 2.99999, false);
expect(rule(['D+', 'C']), 2.5, true);
expect(rule(['C'], 0.2), 2.9, false); // tolerance applies only to the continuous slider format
assert.equal(decide(rule(['C'], 0.2), ok(3.2)).levelTolerance, 0);

// Invalid settings fail closed instead of meaning "no restriction".
for (const [levels, reason] of [
  [['3', '3.5'], 'NON_CONTIGUOUS'],
  [['3.31'], 'UNKNOWN_TOKEN'],
  [['C', '3.5'], 'MIXED_FORMAT'],
  [['Z'], 'UNKNOWN_TOKEN'],
  ['3-3.5', 'NOT_A_LIST']
] as const) {
  assert.deepEqual(parseTournamentLevelRule(levels), { kind: 'INVALID', reason });
  const decision = decide(rule(levels, 0), ok(3.2));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, 'ACTIVITY_LEVEL_INVALID');
}
for (const tolerance of [-0.1, Number.NaN, Number.POSITIVE_INFINITY, '0.2', LEVEL_TOLERANCE_MAX + 0.00001]) {
  const decision = decide(rule(C_SLIDER, tolerance), ok(3.2));
  assert.equal(decision.allowed, false, `stored tolerance ${String(tolerance)}`);
  assert.equal(decision.reasonCode, 'ACTIVITY_LEVEL_INVALID');
}
// A corrupt tolerance on an unrestricted tournament does not invent a restriction.
assert.equal(decide(rule([], 'bad'), { status: 'MISSING' }).allowed, true);

// Organizer input validation.
assert.equal(normalizeLevelToleranceInput(0), 0);
assert.equal(normalizeLevelToleranceInput(0.2), 0.2);
assert.equal(normalizeLevelToleranceInput(LEVEL_TOLERANCE_MAX), LEVEL_TOLERANCE_MAX);
assert.equal(LEVEL_TOLERANCE_MAX, 1);
for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, '0.2', null, 1.00001, 0.123456]) {
  assert.throws(() => normalizeLevelToleranceInput(bad), `tolerance ${String(bad)}`);
}

// Missing level and unavailable check are different refusals; neither admits a restricted tournament.
assert.equal(decide(rule(C_SLIDER, 0.2), { status: 'MISSING' }).reasonCode, 'PLAYER_LEVEL_REQUIRED');
assert.equal(decide(rule(C_SLIDER, 0.2), { status: 'UNKNOWN' }).reasonCode, 'PLAYER_LEVEL_UNKNOWN');
assert.equal(decide(rule(C_SLIDER, 0.2), { status: 'UNAVAILABLE' }).reasonCode, 'LEVEL_CHECK_UNAVAILABLE');
for (const status of ['MISSING', 'UNKNOWN', 'UNAVAILABLE'] as const) {
  assert.equal(decide(rule(C_SLIDER, 0.2), { status }).allowed, false);
}

// Modes: unset keeps legacy; OFF admits without deleting anything; only ENFORCE is enforced.
assert.equal(readTournamentLevelAdmissionMode({}), 'LEGACY');
assert.equal(readTournamentLevelAdmissionMode({ TOURNAMENT_LEVEL_ADMISSION_MODE: 'enforce' }), 'ENFORCE');
assert.equal(readTournamentLevelAdmissionMode({ TOURNAMENT_LEVEL_ADMISSION_MODE: 'off' }), 'OFF');
assert.equal(readTournamentLevelAdmissionMode({ TOURNAMENT_LEVEL_ADMISSION_MODE: 'typo' }), 'LEGACY');
{
  const off = evaluateTournamentLevelAdmission(rule(C_SLIDER, 0), ok(5), { mode: 'OFF' });
  assert.equal(off.allowed, true);
  assert.equal(off.enforced, false);
  assert.equal(off.reasonCode, 'LEVEL_GATE_DISABLED');
}

// The server grid is the admin slider grid (same bands, same tokens).
{
  const panel = readFileSync(join(__dirname, '..', 'client-sdk', 'phab-admin-panel.js'), 'utf8');
  const start = panel.indexOf('var TOURNAMENT_LEVEL_BANDS = [');
  assert.ok(start > 0, 'admin slider bands must stay discoverable');
  const block = panel.slice(start, panel.indexOf('];', start));
  const bands = [...block.matchAll(/base: '([^']+)', min: ([\d.]+), max: ([\d.]+)/g)]
    .map((match) => ({ base: match[1], min: Number(match[2]), max: Number(match[3]) }));
  assert.deepEqual(bands.map((band) => [band.base, band.min, band.max]), [
    ['D', 1, 2], ['D+', 2, 3], ['C', 3, 3.5], ['C+', 3.5, 4], ['B', 4, 4.7], ['B+', 4.7, 5.5], ['A', 5.5, 6.3]
  ]);
  assert.deepEqual(TOURNAMENT_LEVEL_GRID.slice(8, 13).map((entry) => entry.token), C_SLIDER);
}

// Level source guard: the admission rule has no provider dependency and cannot read a level from Viva.
{
  const source = readFileSync(join(__dirname, '..', 'src', 'tournaments', 'tournament-level-admission.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"][^'"]*(viva|integrations|lk-identity|http|fetch)[^'"]*['"]/i);
  assert.doesNotMatch(source, /fetch\(|vivaAdmin|customField/i);
  const service = readFileSync(join(__dirname, '..', 'src', 'tournaments', 'tournaments.service.ts'), 'utf8');
  const start = service.indexOf('async resolveTournamentAdmissionLevel(');
  assert.ok(start > 0, 'trusted level resolver must exist');
  const body = service.slice(start, service.indexOf('\n  }\n', start));
  assert.match(body, /playerRatingsService\.resolveCanonicalLevelByIdentity/);
  assert.doesNotMatch(body, /viva|customField|levelLabel/i, 'admission level must come only from CUP canonical state');
}

console.log('tournament-level-admission tests passed');
