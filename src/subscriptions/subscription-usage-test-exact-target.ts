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
const CONFIG_CREATE_KEYS = new Set([...CREATE_KEYS, 'courtPriceMinor']);
const CONFIG_JOIN_KEYS = new Set([
  'targetKind',
  'gameId',
  'stationId',
  'startsAt',
  'durationMinutes',
  'courtPriceMinor'
]);

export interface SubscriptionUsageExactTarget {
  targetId: string;
  action: 'CREATE_GAME' | 'JOIN_GAME';
  stationId: string;
  startsAt: string;
  durationMinutes: 60 | 90 | 120;
  courtPriceMinor: number;
  participantCount: 4;
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

type ExactTargetConfig = CreateTargetConfig | JoinTargetConfig;

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
      message: 'Для выбранной игры или слота нет точной серверной тестовой цены'
    });
  }
  if (match.stationId !== offer.stationId) {
    throw new UnprocessableEntityException({
      code: 'SUBSCRIPTION_USAGE_TEST_EXACT_TARGET_STATION_MISMATCH',
      message: 'Выбранная игра или слот не относятся к станции тестового оффера'
    });
  }
  const canonical = canonicalTarget(match);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return {
    targetId: `test-exact:${digest.slice(0, 32)}`,
    action: match.targetKind === 'NEW_GAME' ? 'CREATE_GAME' : 'JOIN_GAME',
    stationId: match.stationId,
    startsAt: match.startsAt,
    durationMinutes: match.durationMinutes,
    courtPriceMinor: match.courtPriceMinor,
    participantCount: PARTICIPANT_COUNT,
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
  const allowed = targetKind === 'NEW_GAME' ? CREATE_KEYS : JOIN_KEYS;
  assertExactKeys(target, allowed, 'request target', invalidRequest);
  if (targetKind === 'NEW_GAME') {
    requiredId(target.slotId, 'target.slotId', invalidRequest);
    requiredId(target.stationId, 'target.stationId', invalidRequest);
    requiredId(target.roomId, 'target.roomId', invalidRequest);
    requiredId(target.masterServiceId, 'target.masterServiceId', invalidRequest);
    requiredIds(target.subServiceIds, 'target.subServiceIds', invalidRequest);
    normalizedIso(target.startsAt, 'target.startsAt', invalidRequest);
    requiredDuration(target.durationMinutes, 'target.durationMinutes', invalidRequest);
  } else {
    requiredId(target.gameId, 'target.gameId', invalidRequest);
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
      : null;
  if (!allowed) configInvalid(`target[${index}].targetKind is invalid`);
  assertExactKeys(value, allowed, `target[${index}]`, configInvalid);
  const stationId = requiredId(value.stationId, `target[${index}].stationId`, configInvalid);
  const startsAt = normalizedIso(value.startsAt, `target[${index}].startsAt`, configInvalid);
  const durationMinutes = requiredDuration(value.durationMinutes, `target[${index}].durationMinutes`, configInvalid);
  const courtPriceMinor = requiredPrice(value.courtPriceMinor, `target[${index}].courtPriceMinor`, configInvalid);
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
      courtPriceMinor
    };
  }
  return {
    targetKind: 'GAME_AGGREGATE',
    gameId: requiredId(value.gameId, `target[${index}].gameId`, configInvalid),
    stationId,
    startsAt,
    durationMinutes,
    courtPriceMinor
  };
}

function requestMatches(
  candidate: ExactTargetConfig,
  action: 'CREATE_GAME' | 'JOIN_GAME',
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
  return action === 'JOIN_GAME'
    && candidate.targetKind === 'GAME_AGGREGATE'
    && candidate.gameId === target.gameId;
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
    : `JOIN_GAME:${target.gameId}`;
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

function requiredPrice(value: unknown, field: string, fail: (message: string) => never): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 100_000_000) {
    fail(`${field} is invalid`);
  }
  if ((value as number) % PARTICIPANT_COUNT !== 0) {
    fail(`${field} must be exactly divisible by ${PARTICIPANT_COUNT}`);
  }
  return value as number;
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
