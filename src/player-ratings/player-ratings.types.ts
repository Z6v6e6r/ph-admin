export const PLAYER_RATING_SCHEMA_VERSION = 1;
export const PLAYER_RATING_GRADE_FORMULA_VERSION = 'padel-rating-grade-v1';
export const PLAYER_RATING_MIN = 1;
export const PLAYER_RATING_MAX = 7;
export const PLAYER_RATING_PRECISION = 5;

export type PlayerRatingGrade = 'D' | 'D+' | 'C' | 'C+' | 'B' | 'B+' | 'A';
export type PlayerRatingProjectionStatus = 'PENDING' | 'SYNCED' | 'FAILED_RETRYABLE';
export type PlayerRatingEventType =
  | 'RATING_INITIAL_IMPORTED'
  | 'RATING_BOOTSTRAPPED_FROM_VIVA'
  | 'RATING_MANUALLY_CHANGED';

export interface PlayerRatingActor {
  id: string;
  name: string;
  type: 'ADMIN' | 'SYSTEM' | 'IMPORT';
  memberKey?: string | null;
  phoneNorm?: string | null;
}

export interface PlayerRatingSource {
  domain: string;
  reason?: string;
  sourceId?: string;
  legacyRowId?: string;
  legacyUpdatedAt?: string;
}

export interface PlayerRatingStateDocument {
  playerKey: string;
  clientId?: string;
  phoneNorm?: string;
  name: string;
  nameSearch?: string;
  ratingNumeric: number;
  rating: PlayerRatingGrade;
  ownership: 'CUP_CANONICAL';
  source?: 'CUP';
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  lastEventId: string;
  lastEventAt: string;
  lastEventType: PlayerRatingEventType | string;
  lastSource: string;
  lastChangedBy: PlayerRatingActor;
  lastDelta?: number | null;
  lastGameId?: string | null;
  lastResultId?: string | null;
  team?: string | null;
  vivaCabinetUrl?: string;
  bootstrappedFromViva?: boolean;
}

export interface PlayerRatingEventDocument {
  id: string;
  schemaVersion: number;
  eventType: PlayerRatingEventType | string;
  idempotencyKey: string;
  occurredAt: string;
  createdAt: string;
  player: {
    key: string;
    clientId?: string | null;
    memberKey?: string | null;
    phoneNorm?: string | null;
    name: string;
  };
  change: {
    before: number | null;
    delta: number | null;
    after: number;
    gradeBefore: PlayerRatingGrade | null;
    gradeAfter: PlayerRatingGrade;
    expected?: number | null;
    actual?: number | null;
  };
  formula: {
    version: string;
  } | null;
  source: PlayerRatingSource;
  actor: PlayerRatingActor;
  projectionIntent: {
    viva: 'REQUIRED_DURING_MIGRATION';
  };
  stateSnapshot?: PlayerRatingStateDocument;
}

export interface PlayerRatingProjectionFieldResult {
  fieldId: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
  responseSummary?: string;
}

export interface PlayerRatingProjectionOutboxDocument {
  id: string;
  schemaVersion: number;
  ratingEventId: string;
  playerKey: string;
  clientId?: string;
  phoneNorm?: string;
  ratingNumeric: number;
  status: PlayerRatingProjectionStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  leaseOwner?: string | null;
  leaseUntil?: string | null;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  payload: {
    vivaNumericFieldId: string;
    ratingNumeric: number;
  };
  fieldResults?: { numeric?: PlayerRatingProjectionFieldResult };
  manualRetryCount?: number;
  lastManualRetryAt?: string | null;
  lastManualRetryBy?: PlayerRatingActor | null;
}

export interface PlayerRatingStateDto {
  playerKey: string;
  clientId?: string;
  phoneNorm?: string;
  name: string;
  ratingNumeric: number;
  rating: PlayerRatingGrade;
  source: 'CUP';
  ownership: 'CUP_CANONICAL';
  lastEventId: string;
  lastEventAt: string;
  lastEventType: string;
  lastActor: PlayerRatingActor;
  lastSource: string;
  projectionStatus: PlayerRatingProjectionStatus;
  vivaCabinetUrl?: string;
  bootstrappedFromViva: boolean;
}

export interface PlayerRatingEventDto {
  id: string;
  eventType: string;
  occurredAt: string;
  before: number | null;
  delta: number | null;
  after: number;
  gradeBefore: PlayerRatingGrade | null;
  gradeAfter: PlayerRatingGrade;
  source: PlayerRatingSource;
  actor: PlayerRatingActor;
  projectionStatus: PlayerRatingProjectionStatus;
}

export interface PlayerRatingSearchResult {
  items: PlayerRatingStateDto[];
  nextCursor: string | null;
}

export interface PlayerRatingEventsResult {
  items: PlayerRatingEventDto[];
  nextCursor: string | null;
}

export interface PlayerRatingChangeResult {
  state: PlayerRatingStateDto;
  event: PlayerRatingEventDto;
  projection: {
    status: PlayerRatingProjectionStatus;
  };
}

export interface VivaPlayerRatingBootstrapInput {
  clientId: string;
  phoneNorm?: string;
  name: string;
  ratingNumeric: number;
  vivaCabinetUrl?: string;
}

export interface LocalPlayerCandidate {
  clientId?: string;
  phoneNorm?: string;
  name: string;
}

export interface PlayerRatingEventFilters {
  limit: number;
  cursor?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function normalizePlayerPhone(value: unknown): string | undefined {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) {
    return undefined;
  }
  if (digits.length === 10) {
    return `7${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('8')) {
    return `7${digits.slice(1)}`;
  }
  return digits;
}

export function normalizePlayerName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ');
}

export function normalizeRatingNumeric(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < PLAYER_RATING_MIN || numeric > PLAYER_RATING_MAX) {
    return null;
  }
  return Number(numeric.toFixed(PLAYER_RATING_PRECISION));
}

export function ratingNumericToGrade(value: unknown): PlayerRatingGrade | null {
  const numeric = normalizeRatingNumeric(value);
  if (numeric === null) {
    return null;
  }
  if (numeric < 2) return 'D';
  if (numeric < 3) return 'D+';
  if (numeric < 3.5) return 'C';
  if (numeric < 4) return 'C+';
  if (numeric < 4.7) return 'B';
  if (numeric < 5.5) return 'B+';
  return 'A';
}
