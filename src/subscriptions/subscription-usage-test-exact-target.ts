import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import { createHash } from 'crypto';
import { SubscriptionUsageResolvedQuoteDto } from './dto/subscription-usage-resolved-quote.dto';
import { StoredSubscriptionTestOffer } from './subscriptions.types';

const CONFIG_ENV = 'SUBSCRIPTIONS_TEST_USAGE_EXACT_TARGETS_JSON';
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_TARGETS = 100;
const PARTICIPANT_COUNT = 4;
const ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,240}$/;
const CREATE_KEYS = new Set([
  'targetKind',
  'slotId',
  'stationId',
  'roomId',
  'masterServiceId',
  'subServiceIds',
  'startsAt',
  'durationMinutes'
]);
const JOIN_KEYS = new Set(['targetKind', 'gameId']);
const EVENT_KEYS = new Set(['targetKind', 'eventId']);
const CONFIG_CREATE_KEYS = new Set([...CREATE_KEYS, 'courtPriceMinor']);
const CONFIG_JOIN_KEYS = new Set([
  'targetKind',
  'gameId',
  'stationId',
  'startsAt',
  'durationMinutes',
  'courtPriceMinor'
]);
const CONFIG_EVENT_KEYS = new Set([
  'targetKind',
  'eventId',
  'action',
  'stationId',
  'startsAt',
  'durationMinutes',
  'basePriceMinor'
]);

type ExactTargetAction =
  | 'CREATE_GAME'
  | 'JOIN_GAME'
  | 'BOOK_GROUP_TRAINING'
  | 'BOOK_TOURNAMENT';

export interface SubscriptionUsageExactTarget {
  targetId: string;
  action: ExactTargetAction;
  stationId: string;
  startsAt: string;
  durationMinutes: 60 | 90 | 120;
  basePriceMinor: number;
  courtPriceMinor: number | null;
  participantCount: number;
  evidenceRef: string;
  priceEvidenceRef: string;
}

interface CreateTargetConfig {
  targetKind: 'NEW_GAME';
  slotId: string;
  stationId: string;
  roomId: string;
  masterServiceId: string;
  subServiceIds: string[];
  startsAt: string;
  durationMinutes: 60 | 90 | 120;
  courtPriceMinor: number;
}

interface JoinTargetConfig {
  targetKind: 'GAME_AGGREGATE';
  gameId: string;
  stationId: string;
  startsAt: string;
  durationMinutes: 60 | 90 | 120;
  courtPriceMinor: number;
}

interface EventTargetConfig {
  targetKind: 'EVENT_AGGREGATE';
  eventId: string;
  action: 'BOOK_GROUP_TRAINING' | 'BOOK_TOURNAMENT';
  stationId: string;
  startsAt: string;
  durationMinutes: 60 | 120;
  basePriceMinor: number;
}

type ExactTargetConfig = CreateTargetConfig | JoinTargetConfig | EventTargetConfig;

export function resolveSubscriptionUsageExactTarget(
  offer: StoredSubscriptionTestOffer,
  dto: SubscriptionUsageResolvedQuoteDto
): SubscriptionUsageExactTarget {
  const target = validateRequestTarget(dto);
  const configured = parseTargetConfig();
  const match = configured.find((candidate) => requestMatches(candidate, dto.action, target));
  if (!match) {
    throw new UnprocessableEntityException({
      code: 'SUBSCRIPTION_USAGE_TEST_EXACT_TARGET_NOT_FOUND',
      message: 'Для выбранной игры, слота или события нет точной серверной тестовой цены'
    });
  }
  if (match.stationId !== offer.stationId) {
    throw new UnprocessableEntityException({
      code: 'SUBSCRIPTION_USAGE_TEST_EXACT_TARGET_STATION_MISMATCH',
      message: 'Выбранная игра, слот или событие не относятся к станции тестового оффера'
    });
  }
  const canonical = canonicalTarget(match);
  const digest = createHash('sha256').update(canonical).digest('hex');
  const participantCount = match.targetKind === 'EVENT_AGGREGATE' ? 1 : PARTICIPANT_COUNT;
  const basePriceMinor = match.targetKind === 'EVENT_AGGREGATE'
    ? match.basePriceMinor
    : match.courtPriceMinor / participantCount;
  return {
    targetId: `test-exact:${digest.slice(0, 32)}`,
    action: match.targetKind === 'NEW_GAME'
      ? 'CREATE_GAME'
      : match.targetKind === 'GAME_AGGREGATE'
        ? 'JOIN_GAME'
        : match.action,
    stationId: match.stationId,
    startsAt: match.startsAt,
    durationMinutes: match.durationMinutes,
    basePriceMinor,
    courtPriceMinor: match.targetKind === 'EVENT_AGGREGATE' ? null : match.courtPriceMinor,
    participantCount,
    evidenceRef: `test-only:exact-target:sha256:${digest}`,
    priceEvidenceRef: `test-only:server-config:sha256:${digest}`
  };
}

function validateRequestTarget(dto: SubscriptionUsageResolvedQuoteDto): Record<string, unknown> {
  const target = dto.target;
  const targetKind = target.targetKind;
  if (dto.action === 'CREATE_GAME' && targetKind !== 'NEW_GAME') {
    invalidRequest('CREATE_GAME requires targetKind NEW_GAME');
  }
  if (dto.action === 'JOIN_GAME' && targetKind !== 'GAME_AGGREGATE') {
    invalidRequest('JOIN_GAME requires targetKind GAME_AGGREGATE');
  }
  if ((dto.action === 'BOOK_GROUP_TRAINING' || dto.action === 'BOOK_TOURNAMENT')
    && targetKind !== 'EVENT_AGGREGATE') {
    invalidRequest(`${dto.action} requires targetKind EVENT_AGGREGATE`);
  }
  const allowed = targetKind === 'NEW_GAME'
    ? CREATE_KEYS
    : targetKind === 'GAME_AGGREGATE'
      ? JOIN_KEYS
      : targetKind === 'EVENT_AGGREGATE'
        ? EVENT_KEYS
        : null;
  if (!allowed) invalidRequest('target.targetKind is invalid');
  assertExactKeys(target, allowed, 'request target', invalidRequest);
  if (targetKind === 'NEW_GAME') {
    requiredId(target.slotId, 'target.slotId', invalidRequest);
    requiredId(target.stationId, 'target.stationId', invalidRequest);
    requiredId(target.roomId, 'target.roomId', invalidRequest);
    requiredId(target.masterServiceId, 'target.masterServiceId', invalidRequest);
    requiredIds(target.subServiceIds, 'target.subServiceIds', invalidRequest);
    normalizedIso(target.startsAt, 'target.startsAt', invalidRequest);
    requiredDuration(target.durationMinutes, 'target.durationMinutes', invalidRequest);
  } else if (targetKind === 'GAME_AGGREGATE') {
    requiredId(target.gameId, 'target.gameId', invalidRequest);
  } else {
    requiredId(target.eventId, 'target.eventId', invalidRequest);
  }
  return target;
}

function parseTargetConfig(): ExactTargetConfig[] {
  const raw = String(process.env[CONFIG_ENV] ?? '').trim();
  if (!raw) unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_NOT_CONFIGURED', 'Exact target catalog is not configured');
  if (Buffer.byteLength(raw, 'utf8') > MAX_CONFIG_BYTES) {
    unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_CONFIG_INVALID', 'Exact target catalog exceeds the size limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_CONFIG_INVALID', 'Exact target catalog is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_TARGETS) {
    unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_CONFIG_INVALID', 'Exact target catalog must be a non-empty bounded array');
  }
  const targets = parsed.map((item, index) => validateConfigTarget(item, index));
  const keys = new Set<string>();
  for (const target of targets) {
    const key = canonicalLookupKey(target);
    if (keys.has(key)) unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_CONFIG_INVALID', 'Exact target catalog contains duplicate targets');
    keys.add(key);
  }
  return targets;
}

function validateConfigTarget(value: unknown, index: number): ExactTargetConfig {
  if (!isRecord(value)) configInvalid(`target[${index}] must be an object`);
  const kind = value.targetKind;
  const allowed = kind === 'NEW_GAME'
    ? CONFIG_CREATE_KEYS
    : kind === 'GAME_AGGREGATE'
      ? CONFIG_JOIN_KEYS
      : kind === 'EVENT_AGGREGATE'
        ? CONFIG_EVENT_KEYS
        : null;
  if (!allowed) configInvalid(`target[${index}].targetKind is invalid`);
  assertExactKeys(value, allowed, `target[${index}]`, configInvalid);
  const stationId = requiredId(value.stationId, `target[${index}].stationId`, configInvalid);
  const startsAt = normalizedIso(value.startsAt, `target[${index}].startsAt`, configInvalid);
  const durationMinutes = requiredDuration(value.durationMinutes, `target[${index}].durationMinutes`, configInvalid);
  if (kind === 'NEW_GAME') {
    return {
      targetKind: kind,
      slotId: requiredId(value.slotId, `target[${index}].slotId`, configInvalid),
      stationId,
      roomId: requiredId(value.roomId, `target[${index}].roomId`, configInvalid),
      masterServiceId: requiredId(value.masterServiceId, `target[${index}].masterServiceId`, configInvalid),
      subServiceIds: requiredIds(value.subServiceIds, `target[${index}].subServiceIds`, configInvalid),
      startsAt,
      durationMinutes,
      courtPriceMinor: requiredCourtPrice(value.courtPriceMinor, `target[${index}].courtPriceMinor`, configInvalid)
    };
  }
  if (kind === 'GAME_AGGREGATE') {
    return {
      targetKind: 'GAME_AGGREGATE',
      gameId: requiredId(value.gameId, `target[${index}].gameId`, configInvalid),
      stationId,
      startsAt,
      durationMinutes,
      courtPriceMinor: requiredCourtPrice(value.courtPriceMinor, `target[${index}].courtPriceMinor`, configInvalid)
    };
  }
  const action = value.action;
  if (action !== 'BOOK_GROUP_TRAINING' && action !== 'BOOK_TOURNAMENT') {
    configInvalid(`target[${index}].action is invalid`);
  }
  if ((action === 'BOOK_GROUP_TRAINING' && durationMinutes !== 60)
    || (action === 'BOOK_TOURNAMENT' && durationMinutes !== 120)) {
    configInvalid(`target[${index}].durationMinutes does not match action`);
  }
  const eventDuration = action === 'BOOK_GROUP_TRAINING' ? 60 : 120;
  return {
    targetKind: 'EVENT_AGGREGATE',
    eventId: requiredId(value.eventId, `target[${index}].eventId`, configInvalid),
    action,
    stationId,
    startsAt,
    durationMinutes: eventDuration,
    basePriceMinor: requiredBasePrice(value.basePriceMinor, `target[${index}].basePriceMinor`, configInvalid)
  };
}

function requestMatches(
  candidate: ExactTargetConfig,
  action: ExactTargetAction,
  target: Record<string, unknown>
): boolean {
  if (action === 'CREATE_GAME' && candidate.targetKind === 'NEW_GAME') {
    return candidate.slotId === target.slotId
      && candidate.stationId === target.stationId
      && candidate.roomId === target.roomId
      && candidate.masterServiceId === target.masterServiceId
      && candidate.startsAt === normalizedIso(target.startsAt, 'target.startsAt', invalidRequest)
      && candidate.durationMinutes === target.durationMinutes
      && sameIds(candidate.subServiceIds, target.subServiceIds as string[]);
  }
  if (action === 'JOIN_GAME') {
    return candidate.targetKind === 'GAME_AGGREGATE'
      && candidate.gameId === target.gameId;
  }
  return (action === 'BOOK_GROUP_TRAINING' || action === 'BOOK_TOURNAMENT')
    && candidate.targetKind === 'EVENT_AGGREGATE'
    && candidate.action === action
    && candidate.eventId === target.eventId;
}

function canonicalTarget(target: ExactTargetConfig): string {
  return JSON.stringify({
    ...target,
    ...(target.targetKind === 'NEW_GAME' ? { subServiceIds: [...target.subServiceIds].sort() } : {})
  });
}

function canonicalLookupKey(target: ExactTargetConfig): string {
  return target.targetKind === 'NEW_GAME'
    ? `CREATE_GAME:${target.stationId}:${target.slotId}:${target.startsAt}:${target.durationMinutes}`
    : target.targetKind === 'GAME_AGGREGATE'
      ? `JOIN_GAME:${target.gameId}`
      : `EVENT:${target.eventId}`;
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function requiredId(value: unknown, field: string, fail: (message: string) => never): string {
  if (typeof value !== 'string' || value !== value.trim() || !ID_PATTERN.test(value)) {
    fail(`${field} is invalid`);
  }
  return value;
}

function requiredIds(value: unknown, field: string, fail: (message: string) => never): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) fail(`${field} is invalid`);
  const items = value.map((item, index) => requiredId(item, `${field}[${index}]`, fail));
  if (new Set(items).size !== items.length) fail(`${field} contains duplicates`);
  return items;
}

function requiredDuration(value: unknown, field: string, fail: (message: string) => never): 60 | 90 | 120 {
  if (value !== 60 && value !== 90 && value !== 120) fail(`${field} is invalid`);
  return value;
}

function requiredBasePrice(value: unknown, field: string, fail: (message: string) => never): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 100_000_000) {
    fail(`${field} is invalid`);
  }
  return value as number;
}

function requiredCourtPrice(value: unknown, field: string, fail: (message: string) => never): number {
  const price = requiredBasePrice(value, field, fail);
  if (price % PARTICIPANT_COUNT !== 0) {
    fail(`${field} must be exactly divisible by ${PARTICIPANT_COUNT}`);
  }
  return price;
}

function normalizedIso(value: unknown, field: string, fail: (message: string) => never): string {
  if (typeof value !== 'string' || value !== value.trim()) fail(`${field} is invalid`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(`${field} is invalid`);
  return new Date(timestamp).toISOString();
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: Set<string>,
  field: string,
  fail: (message: string) => never
): void {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !expected.has(key));
  const missing = [...expected].filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) {
    fail(`${field} keys are invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message: string): never {
  throw new BadRequestException({
    code: 'SUBSCRIPTION_USAGE_TEST_RESOLVED_TARGET_INVALID',
    message
  });
}

function configInvalid(message: string): never {
  unavailable('SUBSCRIPTION_USAGE_TEST_EXACT_TARGETS_CONFIG_INVALID', message);
}

function unavailable(code: string, message: string): never {
  throw new ServiceUnavailableException({ code, message });
}
