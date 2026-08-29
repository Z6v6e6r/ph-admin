import { createHash } from 'node:crypto';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionRuntimeCompatibility
} from './subscriptions.types';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const STATION_SET_SCOPE_PATTERN = /^station-set:[a-f0-9]{64}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const LOCAL_MONTH_PATTERN = /^\d{4}-\d{2}$/;

const PROVIDER_MAPPING_STATES = ['DRAFT', 'VERIFIED', 'DISABLED'] as const;
const PUBLICATION_STATES = ['PUBLISHED', 'SUPERSEDED', 'DISABLED_FOR_NEW_OPERATIONS'] as const;
const INSTANCE_STATES = [
  'PENDING_ACTIVATION', 'CANCELLED_PRE_ACTIVATION', 'REFUNDED_PRE_ACTIVATION',
  'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'REVOKED'
] as const;
const RECONCILIATION_STATES = ['CURRENT', 'STALE', 'REQUIRED'] as const;
const OPERATION_KINDS = [
  'PURCHASE', 'ACTIVATION', 'BOOKING', 'CANCELLATION', 'REFUND', 'FREEZE', 'UNFREEZE',
  'ADMIN_ADJUSTMENT'
] as const;
const OPERATION_STATES = [
  'CREATED', 'RESERVED', 'PROVIDER_SENT', 'PROVIDER_PENDING', 'CONFIRMED',
  'COMPENSATION_PENDING', 'COMPENSATED', 'FAILED', 'MANUAL_RECONCILIATION'
] as const;
const ACTOR_TYPES = ['CLIENT', 'ADMIN', 'SYSTEM'] as const;
const COMPENSATION_STATES = ['NONE', 'PENDING', 'APPLIED', 'MANUAL_REVIEW'] as const;
const SUBSCRIPTION_ACTIONS = [
  'CREATE_GAME', 'JOIN_GAME', 'BOOK_GROUP_TRAINING', 'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
] as const;
const CANONICAL_TARGET_CATEGORIES = [
  'GAME', 'GROUP_TRAINING', 'TOURNAMENT', 'ADD_ON_PRODUCT'
] as const;
const ACTION_CATEGORY: Record<
  (typeof SUBSCRIPTION_ACTIONS)[number],
  (typeof CANONICAL_TARGET_CATEGORIES)[number]
> = {
  CREATE_GAME: 'GAME',
  JOIN_GAME: 'GAME',
  BOOK_GROUP_TRAINING: 'GROUP_TRAINING',
  BOOK_TOURNAMENT: 'TOURNAMENT',
  PURCHASE_ADD_ON_PRODUCT: 'ADD_ON_PRODUCT'
};
const LEDGER_EVENT_TYPES = [
  'PURCHASE_RESERVED', 'PURCHASE_PAID', 'PURCHASE_FAILED', 'PURCHASE_EXPIRED',
  'PURCHASE_REFUNDED', 'INSTANCE_ACTIVATED', 'INSTANCE_FROZEN', 'INSTANCE_UNFROZEN',
  'INSTANCE_EXPIRED', 'INSTANCE_REVOKED', 'INSTANCE_RENEWED', 'QUOTE_ELIGIBLE',
  'QUOTE_BLOCKED', 'ENTITLEMENT_RESERVED', 'ENTITLEMENT_RELEASED',
  'ENTITLEMENT_CONSUMED', 'ENTITLEMENT_RESTORED', 'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED', 'ATTENDANCE_CONSUMED',
  'ATTENDANCE_RETURNED', 'LATE_CANCELLATION_APPLIED', 'LATE_CANCELLATION_REVERSED',
  'NO_SHOW_CONFIRMED', 'NO_SHOW_REVERSED', 'SURCHARGE_CHARGED',
  'SURCHARGE_REFUNDED', 'ADD_ON_CHARGED', 'ADD_ON_REFUNDED', 'ADMIN_ADJUSTED'
] as const;
const OUTBOX_STATUSES = ['PENDING', 'DELIVERED', 'DEAD_LETTER'] as const;
const INSTANCE_PROJECTOR_SCOPE_KINDS = ['TENANT', 'STATION', 'STATION_SET'] as const;
const INSTANCE_PROJECTOR_EVIDENCE_PATTERN =
  /^[a-z][a-z0-9_]{2,63}:sha256:[a-f0-9]{64}$/;
const ACTIVATED_INSTANCE_STATES = new Set([
  'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'REVOKED'
]);
const PRE_ACTIVATION_TERMINAL_STATES = new Set([
  'CANCELLED_PRE_ACTIVATION', 'REFUNDED_PRE_ACTIVATION'
]);
const PROVIDER_OPERATION_KINDS = new Set([
  'PURCHASE', 'ACTIVATION', 'BOOKING', 'CANCELLATION', 'REFUND', 'FREEZE', 'UNFREEZE'
]);
const PROVIDER_IN_FLIGHT_STATES = new Set(['PROVIDER_SENT', 'PROVIDER_PENDING']);
const TERMINAL_OPERATION_STATES = new Set(['CONFIRMED', 'COMPENSATED', 'FAILED']);

export class SubscriptionRuntimeContractError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, string | number | boolean | null> = {}
  ) {
    super(code);
    this.name = 'SubscriptionRuntimeContractError';
  }
}

const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => (
      `${JSON.stringify(key)}:${canonicalStringify(item)}`
    )).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new SubscriptionRuntimeContractError('SUBSCRIPTION_RUNTIME_CANONICAL_VALUE_INVALID');
  }
  return serialized;
};

export function computeSubscriptionRuntimeProjectionDigest(
  value: StoredSubscriptionPolicyPublication['runtimeProjection']
): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

const fail = (
  code: string,
  details: Record<string, string | number | boolean | null> = {}
): never => {
  throw new SubscriptionRuntimeContractError(code, details);
};

const requiredId = (value: unknown, field: string): string => {
  if (typeof value !== 'string') fail('SUBSCRIPTION_RUNTIME_ID_INVALID', { field });
  const normalized = (value as string).trim();
  if (normalized !== value || !ID_PATTERN.test(normalized)) {
    fail('SUBSCRIPTION_RUNTIME_ID_INVALID', { field });
  }
  return normalized;
};

const requiredText = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string') fail('SUBSCRIPTION_RUNTIME_TEXT_INVALID', { field });
  const normalized = (value as string).trim();
  if (normalized !== value || !normalized || normalized.length > max) {
    fail('SUBSCRIPTION_RUNTIME_TEXT_INVALID', { field });
  }
  return normalized;
};

const optionalText = (value: unknown, field: string, max = 500): string | null => {
  if (value === null) return null;
  return requiredText(value, field, max);
};

const optionalId = (value: unknown, field: string): string | null => {
  if (value === null) return null;
  return requiredId(value, field);
};

const oneOf = (
  value: unknown,
  allowed: readonly string[],
  code: string,
  field: string
): void => {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(code, { field });
};

const requiredInstant = (value: unknown, field: string): string => {
  if (typeof value !== 'string') fail('SUBSCRIPTION_RUNTIME_TIMESTAMP_INVALID', { field });
  const normalized = (value as string).trim();
  const parsed = Date.parse(normalized);
  if (!normalized
    || normalized !== value
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== normalized) {
    fail('SUBSCRIPTION_RUNTIME_TIMESTAMP_INVALID', { field });
  }
  return normalized;
};

const optionalInstant = (value: unknown, field: string): string | null => {
  if (value === null) return null;
  return requiredInstant(value, field);
};

const assertInstantOrder = (
  earlier: string,
  later: string,
  code: string,
  field: string
): void => {
  if (Date.parse(later) < Date.parse(earlier)) fail(code, { field });
};

const validateReconciliation = (
  value: { state: unknown; asOf: unknown; evidenceRef: unknown },
  field: string
): void => {
  oneOf(
    value?.state,
    RECONCILIATION_STATES,
    'SUBSCRIPTION_RECONCILIATION_STATE_INVALID',
    `${field}.state`
  );
  optionalInstant(value?.asOf, `${field}.asOf`);
  optionalText(value?.evidenceRef, `${field}.evidenceRef`);
  if (value?.state === 'CURRENT') {
    requiredInstant(value.asOf, `${field}.asOf`);
    requiredText(value.evidenceRef, `${field}.evidenceRef`);
  }
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('SUBSCRIPTION_RUNTIME_COUNTER_INVALID', { field });
  }
  return value as number;
};

const integer = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('SUBSCRIPTION_RUNTIME_DELTA_INVALID', { field });
  }
  return value as number;
};

const requiredBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') fail('SUBSCRIPTION_RUNTIME_BOOLEAN_INVALID', { field });
  return value as boolean;
};

const positiveInteger = (value: unknown, field: string): number => {
  const parsed = nonNegativeInteger(value, field);
  if (parsed < 1) fail('SUBSCRIPTION_RUNTIME_COUNTER_INVALID', { field });
  return parsed;
};

const digest = (value: unknown, field: string): string => {
  if (typeof value !== 'string') fail('SUBSCRIPTION_RUNTIME_DIGEST_INVALID', { field });
  const normalized = (value as string).trim();
  if (normalized !== value || !DIGEST_PATTERN.test(normalized)) {
    fail('SUBSCRIPTION_RUNTIME_DIGEST_INVALID', { field });
  }
  return normalized;
};

const hash = (value: unknown, field: string): string => {
  if (typeof value !== 'string') fail('SUBSCRIPTION_RUNTIME_HASH_INVALID', { field });
  const normalized = (value as string).trim();
  if (normalized !== value || !HASH_PATTERN.test(normalized)) {
    fail('SUBSCRIPTION_RUNTIME_HASH_INVALID', { field });
  }
  return normalized;
};

const validateRuntimeCompatibility = (value: unknown): SubscriptionRuntimeCompatibility => {
  const compatibility = value as Partial<SubscriptionRuntimeCompatibility> | null;
  if (!compatibility || typeof compatibility !== 'object') {
    fail('SUBSCRIPTION_PUBLICATION_RUNTIME_COMPATIBILITY_INVALID');
  }
  assertExactKeys(
    compatibility as object,
    ['adapterId', 'contractVersion', 'capabilityDigest'],
    'runtimeCompatibility'
  );
  const resolved = compatibility as SubscriptionRuntimeCompatibility;
  requiredId(resolved.adapterId, 'runtimeCompatibility.adapterId');
  positiveInteger(resolved.contractVersion, 'runtimeCompatibility.contractVersion');
  digest(resolved.capabilityDigest, 'runtimeCompatibility.capabilityDigest');
  return resolved;
};

const validateMoney = (
  money: { amountMinor: number; currency: 'RUB' },
  field: string
): void => {
  nonNegativeInteger(money?.amountMinor, `${field}.amountMinor`);
  if (money?.currency !== 'RUB') fail('SUBSCRIPTION_RUNTIME_CURRENCY_INVALID', { field });
};

const validateUsageBuckets = (
  buckets: Record<string, number>,
  pattern: RegExp,
  field: string
): void => {
  if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) {
    fail('SUBSCRIPTION_RUNTIME_USAGE_BUCKETS_INVALID', { field });
  }
  for (const [key, value] of Object.entries(buckets)) {
    if (!pattern.test(key)) fail('SUBSCRIPTION_RUNTIME_USAGE_BUCKET_KEY_INVALID', { field, key });
    nonNegativeInteger(value, `${field}.${key}`);
  }
};

const assertExactKeys = (value: object, expected: readonly string[], field: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SUBSCRIPTION_RUNTIME_SHAPE_INVALID', { field });
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    fail('SUBSCRIPTION_RUNTIME_SHAPE_INVALID', { field });
  }
};

const validateUniqueIdArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) fail('SUBSCRIPTION_RUNTIME_ARRAY_INVALID', { field });
  const normalized = (value as unknown[]).map((item) => requiredId(item, field));
  if (new Set(normalized).size !== normalized.length) {
    fail('SUBSCRIPTION_RUNTIME_ARRAY_DUPLICATE', { field });
  }
  return normalized;
};

const arraysIntersect = (left: string[], right: string[]): boolean => {
  const values = new Set(left);
  return right.some((item) => values.has(item));
};

const validateRuntimeStationRules = (
  rules: StoredSubscriptionPolicyPublication['runtimeProjection']['stationAccessRules']
): void => {
  if (!Array.isArray(rules) || rules.length === 0) {
    fail('SUBSCRIPTION_PUBLICATION_STATION_RULES_REQUIRED');
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    const ruleId = requiredId(rule?.ruleId, 'runtimeProjection.stationAccessRules.ruleId');
    if (ids.has(ruleId)) fail('SUBSCRIPTION_PUBLICATION_STATION_RULE_ID_DUPLICATE');
    ids.add(ruleId);
    requiredBoolean(rule?.enabled, 'runtimeProjection.stationAccessRules.enabled');
    integer(rule?.priority, 'runtimeProjection.stationAccessRules.priority');
    oneOf(
      rule?.selector?.kind,
      ['HOME_STATION', 'STATION_LIST', 'ALL_STATIONS'],
      'SUBSCRIPTION_PUBLICATION_STATION_SELECTOR_INVALID',
      'runtimeProjection.stationAccessRules.selector.kind'
    );
    const stationIds = validateUniqueIdArray(
      rule?.selector?.stationIds,
      'runtimeProjection.stationAccessRules.selector.stationIds'
    );
    if (rule.selector.kind === 'STATION_LIST' ? stationIds.length === 0 : stationIds.length > 0) {
      fail('SUBSCRIPTION_PUBLICATION_STATION_SELECTOR_INVALID');
    }
    oneOf(
      rule?.surcharge?.kind,
      ['NONE', 'FIXED'],
      'SUBSCRIPTION_PUBLICATION_STATION_SURCHARGE_INVALID',
      'runtimeProjection.stationAccessRules.surcharge.kind'
    );
    const amount = nonNegativeInteger(
      rule?.surcharge?.amountMinor,
      'runtimeProjection.stationAccessRules.surcharge.amountMinor'
    );
    if ((rule.surcharge.kind === 'NONE' && amount !== 0)
      || (rule.surcharge.kind === 'FIXED' && amount === 0)) {
      fail('SUBSCRIPTION_PUBLICATION_STATION_SURCHARGE_INVALID');
    }
  }
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left];
      const b = rules[right];
      if (!a.enabled || !b.enabled || a.priority !== b.priority) continue;
      if (a.selector.kind === 'ALL_STATIONS' || b.selector.kind === 'ALL_STATIONS'
        || a.selector.kind === 'HOME_STATION' || b.selector.kind === 'HOME_STATION'
        || arraysIntersect(a.selector.stationIds, b.selector.stationIds)) {
        fail('SUBSCRIPTION_PUBLICATION_STATION_PRIORITY_AMBIGUOUS');
      }
    }
  }
};

const BENEFIT_CATEGORIES = ['GAME', 'GROUP_TRAINING', 'TOURNAMENT', 'ADD_ON_PRODUCT'] as const;
const BENEFIT_KINDS = [
  'FREE_ENTITLEMENT', 'FIXED_PRICE', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT',
  'PARTIAL_PRICE_PERCENT_DISCOUNT', 'DISABLED'
] as const;
const BENEFIT_ACTIONS_BY_CATEGORY: Record<string, readonly string[]> = {
  GAME: ['CREATE_GAME', 'JOIN_GAME'],
  GROUP_TRAINING: ['BOOK_GROUP_TRAINING'],
  TOURNAMENT: ['BOOK_TOURNAMENT'],
  ADD_ON_PRODUCT: ['PURCHASE_ADD_ON_PRODUCT']
};

const validateRuntimeBenefitRules = (
  rules: StoredSubscriptionPolicyPublication['runtimeProjection']['benefitRules']
): void => {
  if (!Array.isArray(rules) || !rules.some((rule) => rule?.enabled === true)) {
    fail('SUBSCRIPTION_PUBLICATION_ENABLED_BENEFIT_REQUIRED');
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    const ruleId = requiredId(rule?.ruleId, 'runtimeProjection.benefitRules.ruleId');
    if (ids.has(ruleId)) fail('SUBSCRIPTION_PUBLICATION_BENEFIT_RULE_ID_DUPLICATE');
    ids.add(ruleId);
    requiredBoolean(rule?.enabled, 'runtimeProjection.benefitRules.enabled');
    oneOf(
      rule?.category,
      BENEFIT_CATEGORIES,
      'SUBSCRIPTION_PUBLICATION_BENEFIT_CATEGORY_INVALID',
      'runtimeProjection.benefitRules.category'
    );
    oneOf(
      rule?.kind,
      BENEFIT_KINDS,
      'SUBSCRIPTION_PUBLICATION_BENEFIT_KIND_INVALID',
      'runtimeProjection.benefitRules.kind'
    );
    integer(rule?.priority, 'runtimeProjection.benefitRules.priority');
    const actions = validateUniqueIdArray(
      rule?.actions,
      'runtimeProjection.benefitRules.actions'
    );
    const eventTypeIds = validateUniqueIdArray(
      rule?.externalEventTypeIds,
      'runtimeProjection.benefitRules.externalEventTypeIds'
    );
    const productTypeIds = validateUniqueIdArray(
      rule?.productTypeIds,
      'runtimeProjection.benefitRules.productTypeIds'
    );
    const stationIds = validateUniqueIdArray(
      rule?.stationIds,
      'runtimeProjection.benefitRules.stationIds'
    );
    if (!Array.isArray(rule?.durationMinutes)
      || new Set(rule.durationMinutes).size !== rule.durationMinutes.length
      || rule.durationMinutes.some((item) => ![60, 90, 120].includes(item))) {
      fail('SUBSCRIPTION_PUBLICATION_BENEFIT_DURATIONS_INVALID');
    }
    if (rule.enabled) {
      if (actions.length === 0
        || rule.kind === 'DISABLED'
        || actions.some((action) => !BENEFIT_ACTIONS_BY_CATEGORY[rule.category].includes(action))
        || eventTypeIds.length === 0
        || rule.durationMinutes.length === 0
        || stationIds.length === 0
        || (rule.category === 'ADD_ON_PRODUCT' && productTypeIds.length === 0)) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_SELECTOR_INVALID');
      }
    }
    const hasMoney = rule.valueMinor !== null;
    const hasPercentage = rule.percentage !== null;
    if (hasMoney) nonNegativeInteger(rule.valueMinor, 'runtimeProjection.benefitRules.valueMinor');
    if (hasPercentage && (typeof rule.percentage !== 'number'
      || !Number.isFinite(rule.percentage)
      || rule.percentage <= 0
      || rule.percentage > 100)) {
      fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
    }
    if (rule.kind === 'FIXED_PRICE' || rule.kind === 'FIXED_DISCOUNT') {
      if (!hasMoney || hasPercentage || rule.partialPrice !== null) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
      }
    } else if (rule.kind === 'PERCENT_DISCOUNT') {
      if (!hasPercentage || hasMoney || rule.partialPrice !== null) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
      }
    } else if (rule.kind === 'PARTIAL_PRICE_PERCENT_DISCOUNT') {
      if (!hasPercentage || hasMoney || !rule.partialPrice) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
      }
      const partialPrice = rule.partialPrice!;
      const numerator = positiveInteger(
        partialPrice.numerator,
        'runtimeProjection.benefitRules.partialPrice.numerator'
      );
      const denominator = positiveInteger(
        partialPrice.denominator,
        'runtimeProjection.benefitRules.partialPrice.denominator'
      );
      if (numerator > 100 || denominator > 100 || numerator >= denominator) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
      }
    } else if (hasMoney || hasPercentage || rule.partialPrice !== null) {
      fail('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID');
    }
  }
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left];
      const b = rules[right];
      if (!a.enabled || !b.enabled || a.priority !== b.priority || a.category !== b.category) {
        continue;
      }
      if (arraysIntersect(a.stationIds, b.stationIds)
        && arraysIntersect(a.externalEventTypeIds, b.externalEventTypeIds)) {
        fail('SUBSCRIPTION_PUBLICATION_BENEFIT_PRIORITY_AMBIGUOUS');
      }
    }
  }
};

const validateRuntimeProjection = (
  value: StoredSubscriptionPolicyPublication['runtimeProjection']
): void => {
  if (value?.timeZone !== 'Europe/Moscow') {
    fail('SUBSCRIPTION_PUBLICATION_TIME_ZONE_INVALID');
  }
  requiredBoolean(value.createGame?.enabled, 'runtimeProjection.createGame.enabled');
  if (!Array.isArray(value.createGame?.durationsMinutes)
    || new Set(value.createGame.durationsMinutes).size !== value.createGame.durationsMinutes.length
    || value.createGame.durationsMinutes.some((item) => ![60, 90, 120].includes(item))) {
    fail('SUBSCRIPTION_PUBLICATION_CREATE_DURATIONS_INVALID');
  }
  if (value.createGame.enabled !== (value.createGame.durationsMinutes.length > 0)) {
    fail('SUBSCRIPTION_PUBLICATION_CREATE_DURATIONS_INVALID');
  }
  requiredBoolean(value.joinGame?.enabled, 'runtimeProjection.joinGame.enabled');
  positiveInteger(value.joinGame?.minDurationMinutes, 'runtimeProjection.joinGame.minDurationMinutes');
  positiveInteger(value.joinGame?.maxDurationMinutes, 'runtimeProjection.joinGame.maxDurationMinutes');
  if (![60, 90, 120].includes(value.joinGame.minDurationMinutes)
    || ![60, 90, 120].includes(value.joinGame.maxDurationMinutes)
    || value.joinGame.minDurationMinutes > value.joinGame.maxDurationMinutes) {
    fail('SUBSCRIPTION_PUBLICATION_JOIN_DURATION_RANGE_INVALID');
  }
  requiredBoolean(value.activeServicesLimit?.enabled, 'runtimeProjection.activeServicesLimit.enabled');
  oneOf(
    value.activeServicesLimit?.scope,
    ['SUBSCRIPTION_BENEFIT_ONLY', 'ALL_BOOKINGS'],
    'SUBSCRIPTION_PUBLICATION_ACTIVE_SCOPE_INVALID',
    'runtimeProjection.activeServicesLimit.scope'
  );
  if (value.activeServicesLimit.enabled) {
    positiveInteger(value.activeServicesLimit.max, 'runtimeProjection.activeServicesLimit.max');
  } else if (value.activeServicesLimit.max !== null) {
    fail('SUBSCRIPTION_PUBLICATION_ACTIVE_LIMIT_INVALID');
  }
  requiredBoolean(value.bookingWindow?.enabled, 'runtimeProjection.bookingWindow.enabled');
  if (value.bookingWindow.enabled) {
    const days = positiveInteger(value.bookingWindow.days, 'runtimeProjection.bookingWindow.days');
    if (days > 14) fail('SUBSCRIPTION_PUBLICATION_BOOKING_WINDOW_INVALID');
  } else if (value.bookingWindow.days !== null) {
    fail('SUBSCRIPTION_PUBLICATION_BOOKING_WINDOW_INVALID');
  }
  positiveInteger(value.dailyUsageLimit, 'runtimeProjection.dailyUsageLimit');
  if (value.dailyUsagePolicy !== undefined) {
    const dailyUsageActions = validateUniqueIdArray(
      value.dailyUsagePolicy.actions,
      'runtimeProjection.dailyUsagePolicy.actions'
    );
    if (dailyUsageActions.length === 0
      || dailyUsageActions.some((action) => !SUBSCRIPTION_ACTIONS.includes(
        action as (typeof SUBSCRIPTION_ACTIONS)[number]
      ))) {
      fail('SUBSCRIPTION_PUBLICATION_DAILY_USAGE_ACTIONS_INVALID');
    }
    oneOf(
      value.dailyUsagePolicy.limitExceeded,
      ['BLOCK', 'PERCENT_DISCOUNT'],
      'SUBSCRIPTION_PUBLICATION_DAILY_USAGE_EXCEEDED_INVALID',
      'runtimeProjection.dailyUsagePolicy.limitExceeded'
    );
    if (value.dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT') {
      const percentage = nonNegativeInteger(
        value.dailyUsagePolicy.percentage,
        'runtimeProjection.dailyUsagePolicy.percentage'
      );
      if (percentage > 100) fail('SUBSCRIPTION_PUBLICATION_DAILY_USAGE_DISCOUNT_INVALID');
    } else if (value.dailyUsagePolicy.percentage !== null) {
      fail('SUBSCRIPTION_PUBLICATION_DAILY_USAGE_DISCOUNT_INVALID');
    }
  }
  for (const duration of ['60', '90', '120'] as const) {
    positiveInteger(
      value.usageUnitsByDuration?.[duration],
      `runtimeProjection.usageUnitsByDuration.${duration}`
    );
  }
  validateRuntimeStationRules(value.stationAccessRules);
  validateRuntimeBenefitRules(value.benefitRules);
  requiredBoolean(
    value.lifecycle?.allowBookingsAfterExpiry,
    'runtimeProjection.lifecycle.allowBookingsAfterExpiry'
  );
  const lifecycle = value.lifecycle as StoredSubscriptionPolicyPublication['runtimeProjection']['lifecycle'];
  const hasActivationContract = lifecycle.activationMode !== undefined
    || lifecycle.activationWindowDays !== undefined
    || lifecycle.fixedActivationAt !== undefined
    || lifecycle.fixedActivationTimeZone !== undefined
    || lifecycle.validityDays !== undefined;
  if (hasActivationContract) {
    oneOf(
      lifecycle.activationMode,
      ['PURCHASE', 'FIRST_USE', 'FIXED_DATE', 'FIRST_USE_OR_FIXED_DATE'],
      'SUBSCRIPTION_PUBLICATION_ACTIVATION_MODE_INVALID',
      'runtimeProjection.lifecycle.activationMode'
    );
    nonNegativeInteger(
      lifecycle.activationWindowDays,
      'runtimeProjection.lifecycle.activationWindowDays'
    );
    if (lifecycle.fixedActivationTimeZone !== 'Europe/Moscow') {
      fail('SUBSCRIPTION_PUBLICATION_ACTIVATION_TIME_ZONE_INVALID');
    }
    positiveInteger(lifecycle.validityDays, 'runtimeProjection.lifecycle.validityDays');
    const needsFixedDate = lifecycle.activationMode === 'FIXED_DATE'
      || lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE';
    if (needsFixedDate) {
      requiredInstant(
        lifecycle.fixedActivationAt,
        'runtimeProjection.lifecycle.fixedActivationAt'
      );
    } else if (lifecycle.fixedActivationAt !== null) {
      fail('SUBSCRIPTION_PUBLICATION_ACTIVATION_DATE_INVALID');
    }
    if (lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE'
      && lifecycle.activationWindowDays !== 0) {
      fail('SUBSCRIPTION_PUBLICATION_ACTIVATION_WINDOW_INVALID');
    }
    if (lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE'
      && lifecycle.fixedActivationAt
      && Date.parse(lifecycle.fixedActivationAt) < Date.parse(value.effectiveAt)) {
      fail('SUBSCRIPTION_PUBLICATION_ACTIVATION_DATE_BEFORE_EFFECTIVE_AT');
    }
  }
  for (const field of ['weeklyUsageLimit', 'monthlyUsageLimit', 'maxFutureBookings'] as const) {
    if (value.usage?.[field] !== null) {
      positiveInteger(value.usage?.[field], `runtimeProjection.usage.${field}`);
    }
  }
  nonNegativeInteger(
    value.usage?.minHoursBetweenUses,
    'runtimeProjection.usage.minHoursBetweenUses'
  );
  if (!Array.isArray(value.usage?.blackoutDates)
    || value.usage.blackoutDates.some((item) => !LOCAL_DATE_PATTERN.test(item))) {
    fail('SUBSCRIPTION_PUBLICATION_BLACKOUT_DATES_INVALID');
  }
};

export function validateStoredSubscriptionProviderMapping(
  value: StoredSubscriptionProviderMapping
): void {
  if (value.schemaVersion !== 1 || value.provider !== 'VIVA') {
    fail('SUBSCRIPTION_PROVIDER_MAPPING_SCHEMA_INVALID');
  }
  requiredId(value.mappingId, 'mappingId');
  requiredId(value.tenantId, 'tenantId');
  requiredId(value.providerProductId, 'providerProductId');
  requiredId(value.subscriptionTypeId, 'subscriptionTypeId');
  oneOf(
    value.state,
    PROVIDER_MAPPING_STATES,
    'SUBSCRIPTION_PROVIDER_MAPPING_STATE_INVALID',
    'state'
  );
  if (!['TENANT', 'STUDIO', 'STATION', 'STATION_SET'].includes(value.providerScope?.kind)) {
    fail('SUBSCRIPTION_PROVIDER_SCOPE_INVALID');
  }
  const providerScopeId = requiredId(value.providerScope?.scopeId, 'providerScope.scopeId');
  if (value.providerScope?.kind === 'STATION_SET' && !STATION_SET_SCOPE_PATTERN.test(providerScopeId)) {
    fail('SUBSCRIPTION_PROVIDER_SCOPE_INVALID');
  }
  positiveInteger(value.revision, 'revision');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
  requiredId(value.createdBy, 'createdBy');
  requiredId(value.updatedBy, 'updatedBy');
  requiredId(value.idempotency?.actorId, 'idempotency.actorId');
  requiredText(value.idempotency?.key, 'idempotency.key', 200);
  hash(value.idempotency?.requestHash, 'idempotency.requestHash');
  requiredId(value.idempotency?.correlationId, 'idempotency.correlationId');
  if (value.state === 'VERIFIED') {
    requiredText(value.evidenceRef, 'evidenceRef');
    requiredInstant(value.verifiedAt, 'verifiedAt');
    requiredId(value.verifiedBy, 'verifiedBy');
  } else {
    optionalText(value.evidenceRef, 'evidenceRef');
    optionalInstant(value.verifiedAt, 'verifiedAt');
    optionalId(value.verifiedBy, 'verifiedBy');
  }
}

export function validateStoredSubscriptionCanonicalTargetSnapshot(
  value: StoredSubscriptionCanonicalTargetSnapshot
): void {
  if (value.schemaVersion !== 1
    || value.sourceKind !== 'CANONICAL_TARGET_PROJECTION') {
    fail('SUBSCRIPTION_CANONICAL_TARGET_SCHEMA_INVALID');
  }
  requiredId(value.snapshotId, 'snapshotId');
  requiredId(value.tenantId, 'tenantId');
  requiredId(value.targetId, 'targetId');
  oneOf(
    value.action,
    SUBSCRIPTION_ACTIONS,
    'SUBSCRIPTION_CANONICAL_TARGET_ACTION_INVALID',
    'action'
  );
  oneOf(
    value.state,
    ['ACTIVE', 'REVOKED'],
    'SUBSCRIPTION_CANONICAL_TARGET_STATE_INVALID',
    'state'
  );
  positiveInteger(value.revision, 'revision');
  requiredId(value.stationId, 'stationId');
  oneOf(
    value.category,
    CANONICAL_TARGET_CATEGORIES,
    'SUBSCRIPTION_CANONICAL_TARGET_CATEGORY_INVALID',
    'category'
  );
  if (ACTION_CATEGORY[value.action] !== value.category) {
    fail('SUBSCRIPTION_CANONICAL_TARGET_ACTION_CATEGORY_MISMATCH');
  }
  requiredId(value.externalEventTypeId, 'externalEventTypeId');
  optionalId(value.productTypeId, 'productTypeId');
  if (value.action === 'PURCHASE_ADD_ON_PRODUCT' && value.productTypeId === null) {
    fail('SUBSCRIPTION_CANONICAL_TARGET_PRODUCT_TYPE_REQUIRED');
  }
  const durationMinutes = positiveInteger(value.durationMinutes, 'durationMinutes');
  if (durationMinutes > 1440) {
    fail('SUBSCRIPTION_CANONICAL_TARGET_DURATION_INVALID');
  }
  requiredInstant(value.startsAt, 'startsAt');
  nonNegativeInteger(value.basePriceMinor, 'basePriceMinor');
  if (value.currency !== 'RUB') {
    fail('SUBSCRIPTION_CANONICAL_TARGET_CURRENCY_INVALID');
  }
  requiredId(value.dictionaryRevision, 'dictionaryRevision');
  requiredId(value.evidenceRef, 'evidenceRef');
  requiredId(value.priceEvidenceRef, 'priceEvidenceRef');
  requiredInstant(value.observedAt, 'observedAt');
  requiredInstant(value.expiresAt, 'expiresAt');
  requiredInstant(value.createdAt, 'createdAt');
  assertInstantOrder(
    value.observedAt,
    value.createdAt,
    'SUBSCRIPTION_CANONICAL_TARGET_TIME_ORDER_INVALID',
    'createdAt'
  );
  assertInstantOrder(
    value.createdAt,
    value.expiresAt,
    'SUBSCRIPTION_CANONICAL_TARGET_TIME_ORDER_INVALID',
    'expiresAt'
  );
}

export function validateStoredSubscriptionPolicyPublication(
  value: StoredSubscriptionPolicyPublication
): void {
  if (![1, 2, 3].includes(value.schemaVersion)) fail('SUBSCRIPTION_PUBLICATION_SCHEMA_INVALID');
  requiredId(value.publicationId, 'publicationId');
  requiredId(value.subscriptionTypeId, 'subscriptionTypeId');
  positiveInteger(value.policyVersion, 'policyVersion');
  digest(value.policyDigest, 'policyDigest');
  requiredId(value.mappingId, 'mappingId');
  requiredId(value.dictionaryRevision, 'dictionaryRevision');
  requiredInstant(value.effectiveAt, 'effectiveAt');
  requiredInstant(value.publishedAt, 'publishedAt');
  requiredId(value.publishedBy, 'publishedBy');
  requiredId(value.impactPreviewRef, 'impactPreviewRef');
  requiredId(value.approvalAuditRef, 'approvalAuditRef');
  if (value.schemaVersion === 2 && !value.idempotency) {
    fail('SUBSCRIPTION_PUBLICATION_IDEMPOTENCY_REQUIRED');
  }
  if ((value.schemaVersion === 1 || value.schemaVersion === 2) && value.runtimeCompatibility !== undefined) {
    fail('SUBSCRIPTION_PUBLICATION_RUNTIME_COMPATIBILITY_UNATTESTED');
  }
  if (value.schemaVersion === 3) {
    if (!value.idempotency) fail('SUBSCRIPTION_PUBLICATION_IDEMPOTENCY_REQUIRED');
    validateRuntimeCompatibility(value.runtimeCompatibility);
  }
  if (value.idempotency) {
    requiredId(value.idempotency.actorId, 'idempotency.actorId');
    requiredText(value.idempotency.key, 'idempotency.key', 200);
    hash(value.idempotency.requestHash, 'idempotency.requestHash');
    requiredId(value.idempotency.correlationId, 'idempotency.correlationId');
  }
  oneOf(value.state, PUBLICATION_STATES, 'SUBSCRIPTION_PUBLICATION_STATE_INVALID', 'state');
  if (value.runtimeProjection?.runtimeSchemaVersion !== 1
    || value.runtimeProjection.status !== 'PUBLISHED'
    || value.runtimeProjection.subscriptionTypeId !== value.subscriptionTypeId
    || value.runtimeProjection.policyVersion !== value.policyVersion
    || value.runtimeProjection.effectiveAt !== value.effectiveAt) {
    fail('SUBSCRIPTION_PUBLICATION_PROJECTION_MISMATCH');
  }
  validateRuntimeProjection(value.runtimeProjection);
  if (computeSubscriptionRuntimeProjectionDigest(value.runtimeProjection) !== value.policyDigest) {
    fail('SUBSCRIPTION_PUBLICATION_DIGEST_MISMATCH');
  }
  if (value.state === 'SUPERSEDED') {
    requiredInstant(value.supersededAt, 'supersededAt');
    requiredId(value.supersededBy, 'supersededBy');
  } else if (value.supersededAt !== null || value.supersededBy !== null) {
    fail('SUBSCRIPTION_PUBLICATION_SUPERSESSION_INVALID');
  }
  if (value.supersededAt !== null) {
    assertInstantOrder(
      value.publishedAt,
      value.supersededAt,
      'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
      'supersededAt'
    );
  }
}

export function validateStoredSubscriptionProjectionFence(
  value: StoredSubscriptionProjectionFence
): void {
  if (value.schemaVersion !== 1) fail('SUBSCRIPTION_PROJECTION_FENCE_SCHEMA_INVALID');
  assertExactKeys(value as object, [
    'schemaVersion', 'fenceId', 'subscriptionTypeId', 'bindingRevision', 'bindingDigest',
    'binding', 'coordinationRevision', 'lastProjectorReconciliationDigest', 'createdAt',
    'updatedAt'
  ], 'projectionFence');
  requiredId(value.fenceId, 'fenceId');
  requiredId(value.subscriptionTypeId, 'subscriptionTypeId');
  positiveInteger(value.bindingRevision, 'bindingRevision');
  digest(value.bindingDigest, 'bindingDigest');
  positiveInteger(value.coordinationRevision, 'coordinationRevision');
  if (value.lastProjectorReconciliationDigest !== null) {
    digest(value.lastProjectorReconciliationDigest, 'lastProjectorReconciliationDigest');
  }
  assertExactKeys(value.binding as object, [
    'mappingId', 'mappingRevision', 'subscriptionTypeId', 'publicationId', 'policyVersion',
    'policyDigest', 'runtimeCompatibility'
  ], 'projectionFence.binding');
  requiredId(value.binding.mappingId, 'binding.mappingId');
  positiveInteger(value.binding.mappingRevision, 'binding.mappingRevision');
  requiredId(value.binding.subscriptionTypeId, 'binding.subscriptionTypeId');
  requiredId(value.binding.publicationId, 'binding.publicationId');
  positiveInteger(value.binding.policyVersion, 'binding.policyVersion');
  digest(value.binding.policyDigest, 'binding.policyDigest');
  validateRuntimeCompatibility(value.binding.runtimeCompatibility);
  if (value.binding.subscriptionTypeId !== value.subscriptionTypeId) {
    fail('SUBSCRIPTION_PROJECTION_FENCE_BINDING_MISMATCH');
  }
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
}

export function validateStoredSubscriptionInstance(value: StoredSubscriptionInstance): void {
  if (value.schemaVersion !== 1 || value.provider !== 'VIVA') {
    fail('SUBSCRIPTION_INSTANCE_SCHEMA_INVALID');
  }
  requiredId(value.subscriptionInstanceId, 'subscriptionInstanceId');
  requiredId(value.tenantId, 'tenantId');
  requiredId(value.subscriptionTypeId, 'subscriptionTypeId');
  positiveInteger(value.policyVersion, 'policyVersion');
  digest(value.policyDigest, 'policyDigest');
  requiredId(value.mappingId, 'mappingId');
  requiredId(value.providerProductId, 'providerProductId');
  requiredId(value.providerClientId, 'providerClientId');
  requiredId(value.clientSubscriptionId, 'clientSubscriptionId');
  hash(value.clientRefHash, 'clientRefHash');
  requiredId(value.homeStationId, 'homeStationId');
  requiredId(value.releaseProgramId, 'releaseProgramId');
  requiredId(value.releasePhaseId, 'releasePhaseId');
  oneOf(value.state, INSTANCE_STATES, 'SUBSCRIPTION_INSTANCE_STATE_INVALID', 'state');
  validateMoney(value.purchasePrice, 'purchasePrice');
  requiredInstant(value.purchasedAt, 'purchasedAt');
  optionalInstant(value.activeFrom, 'activeFrom');
  optionalInstant(value.activeTo, 'activeTo');
  optionalInstant(value.frozenUntil, 'frozenUntil');
  positiveInteger(value.revision, 'revision');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
  optionalId(value.renewalPredecessorId, 'renewalPredecessorId');
  optionalId(value.renewalSuccessorId, 'renewalSuccessorId');
  optionalText(value.evidence?.paymentEvidenceRef, 'evidence.paymentEvidenceRef');
  optionalText(value.evidence?.providerInstanceEvidenceRef, 'evidence.providerInstanceEvidenceRef');
  optionalText(value.evidence?.lastReadBackEvidenceRef, 'evidence.lastReadBackEvidenceRef');
  if (ACTIVATED_INSTANCE_STATES.has(value.state)) {
    requiredInstant(value.activeFrom, 'activeFrom');
    requiredInstant(value.activeTo, 'activeTo');
    requiredText(value.evidence?.paymentEvidenceRef, 'evidence.paymentEvidenceRef');
    requiredText(value.evidence?.providerInstanceEvidenceRef, 'evidence.providerInstanceEvidenceRef');
  }
  if (PRE_ACTIVATION_TERMINAL_STATES.has(value.state)) {
    if (value.activeFrom !== null || value.activeTo !== null) {
      fail('SUBSCRIPTION_INSTANCE_PRE_ACTIVATION_RANGE_FORBIDDEN');
    }
    requiredText(value.evidence?.paymentEvidenceRef, 'evidence.paymentEvidenceRef');
    requiredText(value.evidence?.lastReadBackEvidenceRef, 'evidence.lastReadBackEvidenceRef');
  }
  if (value.state === 'FROZEN') requiredInstant(value.frozenUntil, 'frozenUntil');
  if (value.activeFrom !== null && value.activeTo !== null) {
    assertInstantOrder(
      value.activeFrom,
      value.activeTo,
      'SUBSCRIPTION_INSTANCE_ACTIVE_RANGE_INVALID',
      'activeTo'
    );
  }
  validateReconciliation(value.reconciliation, 'reconciliation');
}

export function validateStoredSubscriptionInstanceProjectorCheckpoint(
  value: StoredSubscriptionInstanceProjectorCheckpoint
): void {
  if (value.schemaVersion !== 2 || value.provider !== 'VIVA') {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_CHECKPOINT_SCHEMA_INVALID');
  }
  assertExactKeys(value as object, [
    'schemaVersion', 'checkpointId', 'tenantId', 'provider', 'providerProductId', 'providerScope',
    'approvalRef', 'binding', 'producer', 'state', 'coverage', 'reconciliation', 'failure',
    'lease', 'revision', 'createdAt', 'updatedAt'
  ], 'instanceProjectorCheckpoint');
  requiredId(value.checkpointId, 'checkpointId');
  requiredId(value.tenantId, 'tenantId');
  requiredId(value.providerProductId, 'providerProductId');
  assertExactKeys(value.providerScope as object, ['kind', 'scopeId'], 'providerScope');
  oneOf(value.providerScope.kind, INSTANCE_PROJECTOR_SCOPE_KINDS,
    'SUBSCRIPTION_INSTANCE_PROJECTOR_SCOPE_INVALID', 'providerScope.kind');
  if (value.providerScope.kind === 'STATION_SET') {
    if (!STATION_SET_SCOPE_PATTERN.test(value.providerScope.scopeId)) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_SCOPE_INVALID', { field: 'providerScope.scopeId' });
    }
  } else requiredId(value.providerScope.scopeId, 'providerScope.scopeId');
  if (!INSTANCE_PROJECTOR_EVIDENCE_PATTERN.test(value.approvalRef)) {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_APPROVAL_REF_INVALID');
  }

  assertExactKeys(value.binding as object, [
    'fenceId', 'fenceRevision', 'fenceDigest', 'mappingId', 'mappingRevision',
    'subscriptionTypeId', 'publicationId', 'policyVersion',
    'policyDigest', 'releaseProgramId', 'releaseProgramRevision', 'releasePhaseId',
    'runtimeCompatibility'
  ], 'binding');
  requiredId(value.binding.fenceId, 'binding.fenceId');
  positiveInteger(value.binding.fenceRevision, 'binding.fenceRevision');
  digest(value.binding.fenceDigest, 'binding.fenceDigest');
  requiredId(value.binding.mappingId, 'binding.mappingId');
  positiveInteger(value.binding.mappingRevision, 'binding.mappingRevision');
  requiredId(value.binding.subscriptionTypeId, 'binding.subscriptionTypeId');
  requiredId(value.binding.publicationId, 'binding.publicationId');
  positiveInteger(value.binding.policyVersion, 'binding.policyVersion');
  digest(value.binding.policyDigest, 'binding.policyDigest');
  requiredId(value.binding.releaseProgramId, 'binding.releaseProgramId');
  positiveInteger(value.binding.releaseProgramRevision, 'binding.releaseProgramRevision');
  requiredId(value.binding.releasePhaseId, 'binding.releasePhaseId');
  validateRuntimeCompatibility(value.binding.runtimeCompatibility);

  assertExactKeys(value.producer as object, [
    'producerId', 'contractVersion', 'producerCapabilityDigest', 'sourceContractDigest',
    'authorityDigest'
  ], 'producer');
  if (value.producer.producerId !== 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR'
    || value.producer.contractVersion !== 2) {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_PRODUCER_INVALID');
  }
  digest(value.producer.producerCapabilityDigest, 'producer.producerCapabilityDigest');
  digest(value.producer.sourceContractDigest, 'producer.sourceContractDigest');
  digest(value.producer.authorityDigest, 'producer.authorityDigest');
  oneOf(value.state, ['CURRENT', 'FAILED'], 'SUBSCRIPTION_INSTANCE_PROJECTOR_STATE_INVALID', 'state');

  if (!value.coverage || typeof value.coverage !== 'object') {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_COVERAGE_INVALID');
  }
  if (value.coverage.kind === 'ORDERED_CHANGE_FEED') {
    assertExactKeys(value.coverage, ['kind', 'watermark', 'watermarkDigest', 'coverageThrough'], 'coverage');
    if (!INSTANCE_PROJECTOR_EVIDENCE_PATTERN.test(value.coverage.watermark)) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_WATERMARK_INVALID');
    }
    digest(value.coverage.watermarkDigest, 'coverage.watermarkDigest');
    requiredInstant(value.coverage.coverageThrough, 'coverage.coverageThrough');
  } else if (value.coverage.kind === 'CONSISTENT_FULL_SNAPSHOT') {
    assertExactKeys(value.coverage, ['kind', 'snapshotId', 'snapshotDigest', 'coverageThrough', 'sourceItemCount'], 'coverage');
    requiredId(value.coverage.snapshotId, 'coverage.snapshotId');
    digest(value.coverage.snapshotDigest, 'coverage.snapshotDigest');
    requiredInstant(value.coverage.coverageThrough, 'coverage.coverageThrough');
    nonNegativeInteger(value.coverage.sourceItemCount, 'coverage.sourceItemCount');
  } else fail('SUBSCRIPTION_INSTANCE_PROJECTOR_COVERAGE_INVALID');

  assertExactKeys(value.reconciliation as object, [
    'runId', 'mode', 'startedAt', 'completedAt', 'sourceItemCount', 'insertedCount', 'updatedCount',
    'replayedCount', 'terminalCount', 'failureCount', 'sourceEvidenceRef', 'resultEvidenceRef',
    'reconciliationDigest'
  ], 'reconciliation');
  requiredId(value.reconciliation.runId, 'reconciliation.runId');
  oneOf(value.reconciliation.mode, ['INITIAL_FULL', 'INCREMENTAL', 'FULL_RECONCILIATION'],
    'SUBSCRIPTION_INSTANCE_PROJECTOR_RECONCILIATION_INVALID', 'reconciliation.mode');
  requiredInstant(value.reconciliation.startedAt, 'reconciliation.startedAt');
  optionalInstant(value.reconciliation.completedAt, 'reconciliation.completedAt');
  nonNegativeInteger(value.reconciliation.sourceItemCount, 'reconciliation.sourceItemCount');
  for (const field of ['insertedCount', 'updatedCount', 'replayedCount', 'terminalCount', 'failureCount'] as const) {
    nonNegativeInteger(value.reconciliation[field], `reconciliation.${field}`);
  }
  if (value.reconciliation.insertedCount + value.reconciliation.updatedCount
    + value.reconciliation.replayedCount + value.reconciliation.terminalCount
    > value.reconciliation.sourceItemCount) {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_COUNT_INVALID');
  }
  if (!INSTANCE_PROJECTOR_EVIDENCE_PATTERN.test(value.reconciliation.sourceEvidenceRef)) {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_EVIDENCE_REF_INVALID', {
      field: 'reconciliation.sourceEvidenceRef'
    });
  }
  if (value.reconciliation.resultEvidenceRef !== null
    && !INSTANCE_PROJECTOR_EVIDENCE_PATTERN.test(value.reconciliation.resultEvidenceRef)) {
    fail('SUBSCRIPTION_INSTANCE_PROJECTOR_EVIDENCE_REF_INVALID', {
      field: 'reconciliation.resultEvidenceRef'
    });
  }
  digest(value.reconciliation.reconciliationDigest, 'reconciliation.reconciliationDigest');
  if (value.reconciliation.completedAt !== null) {
    assertInstantOrder(value.reconciliation.startedAt, value.reconciliation.completedAt,
      'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID', 'reconciliation.completedAt');
    assertInstantOrder(value.coverage.coverageThrough, value.reconciliation.completedAt,
      'SUBSCRIPTION_INSTANCE_PROJECTOR_COVERAGE_TIME_INVALID', 'coverage.coverageThrough');
  }

  if (value.failure !== null) {
    assertExactKeys(value.failure as object, ['code', 'detectedAt', 'evidenceRef'], 'failure');
    requiredId(value.failure.code, 'failure.code');
    requiredInstant(value.failure.detectedAt, 'failure.detectedAt');
    if (!INSTANCE_PROJECTOR_EVIDENCE_PATTERN.test(value.failure.evidenceRef)) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_EVIDENCE_REF_INVALID', {
        field: 'failure.evidenceRef'
      });
    }
  }
  if (value.lease !== null) {
    assertExactKeys(value.lease as object, ['runId', 'epoch', 'ownerIdHash', 'acquiredAt', 'expiresAt'], 'lease');
    requiredId(value.lease.runId, 'lease.runId');
    positiveInteger(value.lease.epoch, 'lease.epoch');
    digest(value.lease.ownerIdHash, 'lease.ownerIdHash');
    requiredInstant(value.lease.acquiredAt, 'lease.acquiredAt');
    requiredInstant(value.lease.expiresAt, 'lease.expiresAt');
    assertInstantOrder(value.lease.acquiredAt, value.lease.expiresAt,
      'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID', 'lease.expiresAt');
  }
  if (value.state === 'CURRENT') {
    if (value.failure !== null || value.lease !== null || value.reconciliation.failureCount !== 0
      || value.reconciliation.completedAt === null) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_CURRENT_INVALID');
    }
    const accounted = value.reconciliation.insertedCount
      + value.reconciliation.updatedCount
      + value.reconciliation.replayedCount
      + value.reconciliation.terminalCount;
    if (accounted !== value.reconciliation.sourceItemCount) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_COUNT_INVALID');
    }
    if (value.coverage.kind === 'CONSISTENT_FULL_SNAPSHOT'
      && value.coverage.sourceItemCount !== value.reconciliation.sourceItemCount) {
      fail('SUBSCRIPTION_INSTANCE_PROJECTOR_COUNT_INVALID');
    }
  } else if (value.failure === null) fail('SUBSCRIPTION_INSTANCE_PROJECTOR_FAILED_INVALID');
  positiveInteger(value.revision, 'revision');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(value.createdAt, value.updatedAt, 'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID', 'updatedAt');
}

export function validateStoredSubscriptionEntitlementAggregate(
  value: StoredSubscriptionEntitlementAggregate
): void {
  if (value.schemaVersion !== 1) fail('SUBSCRIPTION_AGGREGATE_SCHEMA_INVALID');
  requiredId(value.subscriptionInstanceId, 'subscriptionInstanceId');
  positiveInteger(value.revision, 'revision');
  oneOf(
    value.activeServiceScope,
    ['SUBSCRIPTION_BENEFIT_ONLY', 'ALL_BOOKINGS'],
    'SUBSCRIPTION_AGGREGATE_ACTIVE_SCOPE_INVALID',
    'activeServiceScope'
  );
  nonNegativeInteger(value.activeServiceCount, 'activeServiceCount');
  nonNegativeInteger(value.futureBookingCount, 'futureBookingCount');
  if (!Array.isArray(value.activeServices)
    || value.activeServices.length !== value.activeServiceCount) {
    fail('SUBSCRIPTION_AGGREGATE_ACTIVE_COUNT_MISMATCH');
  }
  if (!Array.isArray(value.futureServiceStartsAt)
    || value.futureServiceStartsAt.length !== value.futureBookingCount) {
    fail('SUBSCRIPTION_AGGREGATE_FUTURE_COUNT_MISMATCH');
  }
  const operationIds = new Set<string>();
  for (const reservation of value.activeServices) {
    const operationId = requiredId(reservation.operationId, 'activeServices.operationId');
    if (operationIds.has(operationId)) fail('SUBSCRIPTION_AGGREGATE_OPERATION_DUPLICATE');
    operationIds.add(operationId);
    requiredId(reservation.targetId, 'activeServices.targetId');
    requiredInstant(reservation.startsAt, 'activeServices.startsAt');
    positiveInteger(reservation.usageUnits, 'activeServices.usageUnits');
    oneOf(
      reservation.state,
      ['RESERVED', 'CONFIRMED'],
      'SUBSCRIPTION_AGGREGATE_RESERVATION_STATE_INVALID',
      'activeServices.state'
    );
  }
  for (const startsAt of value.futureServiceStartsAt) {
    requiredInstant(startsAt, 'futureServiceStartsAt');
  }
  validateUsageBuckets(value.dailyUsage, LOCAL_DATE_PATTERN, 'dailyUsage');
  validateUsageBuckets(value.weeklyUsage, LOCAL_WEEK_PATTERN, 'weeklyUsage');
  validateUsageBuckets(value.monthlyUsage, LOCAL_MONTH_PATTERN, 'monthlyUsage');
  if (value.remainingUnits !== null) nonNegativeInteger(value.remainingUnits, 'remainingUnits');
  validateReconciliation(value.reconciliation, 'reconciliation');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
}

export function validateStoredSubscriptionRuntimeOperation(
  value: StoredSubscriptionRuntimeOperation
): void {
  if (value.schemaVersion !== 1) fail('SUBSCRIPTION_OPERATION_SCHEMA_INVALID');
  requiredId(value.operationId, 'operationId');
  positiveInteger(value.revision, 'revision');
  requiredId(value.tenantId, 'tenantId');
  optionalId(value.subscriptionInstanceId, 'subscriptionInstanceId');
  oneOf(value.kind, OPERATION_KINDS, 'SUBSCRIPTION_OPERATION_KIND_INVALID', 'kind');
  oneOf(value.state, OPERATION_STATES, 'SUBSCRIPTION_OPERATION_STATE_INVALID', 'state');
  oneOf(value.actor?.type, ACTOR_TYPES, 'SUBSCRIPTION_RUNTIME_ACTOR_INVALID', 'actor.type');
  if (value.actor?.type === 'CLIENT') hash(value.actor.actorId, 'actor.actorId');
  else requiredId(value.actor?.actorId, 'actor.actorId');
  hash(value.idempotency?.keyHash, 'idempotency.keyHash');
  hash(value.idempotency?.requestHash, 'idempotency.requestHash');
  requiredId(value.correlationId, 'correlationId');
  nonNegativeInteger(value.attempts, 'attempts');
  optionalInstant(value.nextAttemptAt, 'nextAttemptAt');
  optionalInstant(value.lastReconciledAt, 'lastReconciledAt');
  optionalInstant(value.terminalAt, 'terminalAt');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
  optionalId(value.providerCorrelationId, 'providerCorrelationId');
  optionalText(value.lastReconciliationResult, 'lastReconciliationResult');
  oneOf(
    value.compensationState,
    COMPENSATION_STATES,
    'SUBSCRIPTION_OPERATION_COMPENSATION_STATE_INVALID',
    'compensationState'
  );
  if (['PURCHASE', 'BOOKING', 'CANCELLATION', 'REFUND'].includes(value.kind)
    && value.decision === null) {
    fail('SUBSCRIPTION_OPERATION_DECISION_REQUIRED', { kind: value.kind, state: value.state });
  }
  if (value.kind === 'PURCHASE' && value.decision?.decisionKind !== 'PURCHASE') {
    fail('SUBSCRIPTION_OPERATION_PURCHASE_DECISION_REQUIRED');
  }
  if (value.kind !== 'PURCHASE' && value.subscriptionInstanceId === null) {
    fail('SUBSCRIPTION_OPERATION_INSTANCE_REQUIRED', { kind: value.kind });
  }
  if (value.kind === 'PURCHASE'
    && ['CONFIRMED', 'COMPENSATED'].includes(value.state)
    && value.subscriptionInstanceId === null) {
    fail('SUBSCRIPTION_OPERATION_INSTANCE_REQUIRED', { kind: value.kind, state: value.state });
  }
  if (['BOOKING', 'CANCELLATION'].includes(value.kind)
    && value.decision?.decisionKind !== 'ENTITLEMENT') {
    fail('SUBSCRIPTION_OPERATION_ENTITLEMENT_DECISION_REQUIRED', { kind: value.kind });
  }
  if (PROVIDER_OPERATION_KINDS.has(value.kind)
    && PROVIDER_IN_FLIGHT_STATES.has(value.state)) {
    requiredId(value.providerCorrelationId, 'providerCorrelationId');
  }
  if (PROVIDER_OPERATION_KINDS.has(value.kind)
    && ['CONFIRMED', 'COMPENSATED'].includes(value.state)
    && value.providerEvidenceRefs.length === 0) {
    fail('SUBSCRIPTION_OPERATION_PROVIDER_EVIDENCE_REQUIRED', {
      kind: value.kind,
      state: value.state
    });
  }
  if (TERMINAL_OPERATION_STATES.has(value.state)) {
    requiredInstant(value.terminalAt, 'terminalAt');
  }
  if (value.decision) {
    positiveInteger(value.decision.policyVersion, 'decision.policyVersion');
    digest(value.decision.policyDigest, 'decision.policyDigest');
    oneOf(
      value.decision.decisionKind,
      ['ENTITLEMENT', 'PURCHASE'],
      'SUBSCRIPTION_OPERATION_DECISION_KIND_INVALID',
      'decision.decisionKind'
    );
    if (value.decision.decisionKind === 'ENTITLEMENT') {
      oneOf(
        value.decision.action,
        SUBSCRIPTION_ACTIONS,
        'SUBSCRIPTION_OPERATION_ACTION_INVALID',
        'decision.action'
      );
      requiredId(value.decision.target?.targetId, 'decision.target.targetId');
      requiredId(value.decision.target?.stationId, 'decision.target.stationId');
      optionalId(value.decision.target?.eventTypeId, 'decision.target.eventTypeId');
      optionalId(value.decision.target?.productTypeId, 'decision.target.productTypeId');
      requiredInstant(value.decision.target?.startsAt, 'decision.target.startsAt');
      positiveInteger(value.decision.target?.durationMinutes, 'decision.target.durationMinutes');
      positiveInteger(value.decision.usageUnits, 'decision.usageUnits');
      const money = value.decision.money;
      if (money?.currency !== 'RUB') fail('SUBSCRIPTION_RUNTIME_CURRENCY_INVALID');
      for (const field of ['basePriceMinor', 'finalPriceMinor'] as const) {
        if (money[field] !== null) nonNegativeInteger(money[field], `decision.money.${field}`);
      }
      nonNegativeInteger(money?.discountMinor, 'decision.money.discountMinor');
      nonNegativeInteger(money?.surchargeMinor, 'decision.money.surchargeMinor');
      if (money.basePriceMinor !== null && money.finalPriceMinor !== null) {
        if (money.discountMinor > money.basePriceMinor
          || BigInt(money.basePriceMinor) - BigInt(money.discountMinor)
            + BigInt(money.surchargeMinor) !== BigInt(money.finalPriceMinor)) {
          fail('SUBSCRIPTION_OPERATION_MONEY_INVARIANT_INVALID');
        }
      }
    } else {
      requiredId(value.decision.mappingId, 'decision.mappingId');
      requiredId(value.decision.providerProductId, 'decision.providerProductId');
      requiredId(value.decision.releaseProgramId, 'decision.releaseProgramId');
      requiredId(value.decision.releasePhaseId, 'decision.releasePhaseId');
      requiredId(value.decision.stationId, 'decision.stationId');
      if (value.decision.quantity !== 1) fail('SUBSCRIPTION_OPERATION_PURCHASE_QUANTITY_INVALID');
      validateMoney(value.decision.price, 'decision.price');
    }
  }
  const uniqueEvidence = new Set(value.providerEvidenceRefs);
  if (uniqueEvidence.size !== value.providerEvidenceRefs.length) {
    fail('SUBSCRIPTION_OPERATION_EVIDENCE_DUPLICATE');
  }
  value.providerEvidenceRefs.forEach((item) => requiredText(item, 'providerEvidenceRefs'));
}

const PROVIDER_EVIDENCE_REQUIRED_EVENTS = new Set([
  'PURCHASE_PAID',
  'PURCHASE_REFUNDED',
  'INSTANCE_ACTIVATED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
  'ATTENDANCE_CONSUMED',
  'ATTENDANCE_RETURNED',
  'NO_SHOW_CONFIRMED',
  'NO_SHOW_REVERSED',
  'SURCHARGE_CHARGED',
  'SURCHARGE_REFUNDED',
  'ADD_ON_CHARGED',
  'ADD_ON_REFUNDED'
]);
const PRE_INSTANCE_LEDGER_EVENTS = new Set([
  'PURCHASE_RESERVED', 'PURCHASE_FAILED', 'PURCHASE_EXPIRED',
  'QUOTE_ELIGIBLE', 'QUOTE_BLOCKED'
]);

export function computeSubscriptionUsageLedgerEventHash(
  value: Omit<StoredSubscriptionUsageLedgerEvent, 'eventHash'>
    | StoredSubscriptionUsageLedgerEvent
): string {
  const canonicalPayload = {
    schemaVersion: value.schemaVersion,
    eventId: value.eventId,
    eventType: value.eventType,
    tenantId: value.tenantId,
    subscriptionInstanceId: value.subscriptionInstanceId,
    operationId: value.operationId,
    correlationId: value.correlationId,
    policyVersion: value.policyVersion,
    policyDigest: value.policyDigest,
    stationId: value.stationId,
    eventTypeId: value.eventTypeId,
    productTypeId: value.productTypeId,
    moneyDeltaMinor: value.moneyDeltaMinor,
    currency: value.currency,
    usageDelta: value.usageDelta,
    providerEvidenceRef: value.providerEvidenceRef,
    actor: { type: value.actor?.type, actorId: value.actor?.actorId },
    occurredAt: value.occurredAt,
    recordedAt: value.recordedAt
  };
  return createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
}

export function validateStoredSubscriptionUsageLedgerEvent(
  value: StoredSubscriptionUsageLedgerEvent
): void {
  if (value.schemaVersion !== 1) fail('SUBSCRIPTION_LEDGER_SCHEMA_INVALID');
  assertExactKeys(value, [
    'schemaVersion', 'eventId', 'eventHash', 'eventType', 'tenantId',
    'subscriptionInstanceId', 'operationId', 'correlationId', 'policyVersion',
    'policyDigest', 'stationId', 'eventTypeId', 'productTypeId', 'moneyDeltaMinor',
    'currency', 'usageDelta', 'providerEvidenceRef', 'actor', 'occurredAt', 'recordedAt'
  ], 'ledger');
  assertExactKeys(value.actor, ['type', 'actorId'], 'ledger.actor');
  requiredId(value.eventId, 'eventId');
  hash(value.eventHash, 'eventHash');
  oneOf(value.eventType, LEDGER_EVENT_TYPES, 'SUBSCRIPTION_LEDGER_EVENT_TYPE_INVALID', 'eventType');
  requiredId(value.tenantId, 'tenantId');
  optionalId(value.subscriptionInstanceId, 'subscriptionInstanceId');
  if (value.subscriptionInstanceId === null && !PRE_INSTANCE_LEDGER_EVENTS.has(value.eventType)) {
    fail('SUBSCRIPTION_LEDGER_INSTANCE_REQUIRED', { eventType: value.eventType });
  }
  requiredId(value.operationId, 'operationId');
  requiredId(value.correlationId, 'correlationId');
  positiveInteger(value.policyVersion, 'policyVersion');
  digest(value.policyDigest, 'policyDigest');
  integer(value.moneyDeltaMinor, 'moneyDeltaMinor');
  integer(value.usageDelta, 'usageDelta');
  if (value.currency !== 'RUB') fail('SUBSCRIPTION_RUNTIME_CURRENCY_INVALID');
  optionalId(value.stationId, 'stationId');
  optionalId(value.eventTypeId, 'eventTypeId');
  optionalId(value.productTypeId, 'productTypeId');
  optionalText(value.providerEvidenceRef, 'providerEvidenceRef');
  oneOf(value.actor?.type, ACTOR_TYPES, 'SUBSCRIPTION_RUNTIME_ACTOR_INVALID', 'actor.type');
  if (value.actor?.type === 'CLIENT') hash(value.actor.actorId, 'actor.actorId');
  else requiredId(value.actor?.actorId, 'actor.actorId');
  requiredInstant(value.occurredAt, 'occurredAt');
  requiredInstant(value.recordedAt, 'recordedAt');
  assertInstantOrder(
    value.occurredAt,
    value.recordedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'recordedAt'
  );
  if (PROVIDER_EVIDENCE_REQUIRED_EVENTS.has(value.eventType)) {
    requiredText(value.providerEvidenceRef, 'providerEvidenceRef');
  }
  if (value.eventHash !== computeSubscriptionUsageLedgerEventHash(value)) {
    fail('SUBSCRIPTION_LEDGER_EVENT_HASH_MISMATCH', { eventId: value.eventId });
  }
}

export function validateStoredSubscriptionOutboxEvent(value: StoredSubscriptionOutboxEvent): void {
  if (value.schemaVersion !== 1 || value.topic !== 'SUBSCRIPTION_LEDGER_EVENT') {
    fail('SUBSCRIPTION_OUTBOX_SCHEMA_INVALID');
  }
  requiredId(value.outboxEventId, 'outboxEventId');
  requiredId(value.ledgerEventId, 'ledgerEventId');
  optionalId(value.subscriptionInstanceId, 'subscriptionInstanceId');
  oneOf(value.status, OUTBOX_STATUSES, 'SUBSCRIPTION_OUTBOX_STATUS_INVALID', 'status');
  nonNegativeInteger(value.attempts, 'attempts');
  optionalInstant(value.nextAttemptAt, 'nextAttemptAt');
  optionalInstant(value.deliveredAt, 'deliveredAt');
  requiredInstant(value.createdAt, 'createdAt');
  requiredInstant(value.updatedAt, 'updatedAt');
  assertInstantOrder(
    value.createdAt,
    value.updatedAt,
    'SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID',
    'updatedAt'
  );
  optionalText(value.lastErrorCode, 'lastErrorCode', 200);
  if (value.status === 'DELIVERED') {
    if (value.deliveredAt === null) fail('SUBSCRIPTION_OUTBOX_DELIVERY_TIMESTAMP_REQUIRED');
    if (value.nextAttemptAt !== null) fail('SUBSCRIPTION_OUTBOX_DELIVERY_STATE_INVALID');
  } else if (value.deliveredAt !== null) {
    fail('SUBSCRIPTION_OUTBOX_DELIVERY_STATE_INVALID');
  }
  if (value.status === 'DEAD_LETTER' && value.lastErrorCode === null) {
    fail('SUBSCRIPTION_OUTBOX_ERROR_CODE_REQUIRED');
  }
}
