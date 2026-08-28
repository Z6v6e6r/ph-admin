import { createHash } from 'node:crypto';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent
} from './subscriptions.types';
import {
  MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES,
  ManagedSubscriptionRuntimeReasonCode
} from './subscription-runtime-reason-codes';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const STATION_SET_SCOPE_PATTERN = /^station-set:[a-f0-9]{64}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const LOCAL_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export const MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTIONS = [
  'CREATE_GAME', 'JOIN_GAME', 'BOOK_GROUP_TRAINING', 'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT', 'CANCEL_BOOKING', 'RESCHEDULE_BOOKING',
  'CONFIRM_ATTENDANCE', 'CONFIRM_NO_SHOW'
] as const;
export const MANAGED_SUBSCRIPTION_RUNTIME_V1_OUTCOMES = [
  'ENTITLEMENT_APPLIED', 'FULL_PRICE_ONLY', 'SUBSCRIPTION_SELECTION_REQUIRED',
  'PRICE_CONFIRMATION_REQUIRED', 'SERVICE_BLOCKED', 'RETRY_LATER',
  'RECONCILIATION_REQUIRED'
] as const;
export const MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS = [
  'AUTO_BEST_PRICE', 'PAY_FULL_PRICE', 'USE_SUBSCRIPTION'
] as const;
export const MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KINDS = [
  'GAME', 'GROUP_TRAINING', 'TOURNAMENT', 'ADD_ON_PRODUCT', 'BOOKING'
] as const;
export const MANAGED_SUBSCRIPTION_RUNTIME_V1_BENEFIT_KINDS = [
  'NONE', 'FREE_ENTITLEMENT', 'FIXED_PRICE', 'FIXED_DISCOUNT',
  'PERCENT_DISCOUNT', 'PARTIAL_PRICE_PERCENT_DISCOUNT'
] as const;

export type ManagedSubscriptionRuntimeV1Action =
  (typeof MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTIONS)[number];
export type ManagedSubscriptionRuntimeV1Outcome =
  (typeof MANAGED_SUBSCRIPTION_RUNTIME_V1_OUTCOMES)[number];
export type ManagedSubscriptionRuntimeV1PaymentIntent =
  (typeof MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS)[number];
export type ManagedSubscriptionRuntimeV1TargetKind =
  (typeof MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KINDS)[number];
export type ManagedSubscriptionRuntimeV1BenefitKind =
  (typeof MANAGED_SUBSCRIPTION_RUNTIME_V1_BENEFIT_KINDS)[number];

export interface ManagedSubscriptionRuntimeV1QuoteRequest {
  action: ManagedSubscriptionRuntimeV1Action;
  target: {
    kind: ManagedSubscriptionRuntimeV1TargetKind;
    id: string;
    expectedRevision?: number;
  };
  preferredSubscriptionInstanceId?: string;
  paymentIntent: ManagedSubscriptionRuntimeV1PaymentIntent;
}

export interface ManagedSubscriptionRuntimeV1PriceSnapshot {
  priceRevision: number;
  basePriceMinor: number;
  discountMinor: number;
  surchargeMinor: number;
  finalPriceMinor: number;
  currency: 'RUB';
}

export interface ManagedSubscriptionRuntimeV1QuoteOutcome {
  contractVersion: 1;
  nonBinding: true;
  requiresReservationRecheck: true;
  outcome: ManagedSubscriptionRuntimeV1Outcome;
  paymentIntent: ManagedSubscriptionRuntimeV1PaymentIntent;
  decisionId: string;
  serviceAllowed: boolean;
  subscriptionBenefitAllowed: boolean;
  selectedSubscription: {
    subscriptionInstanceId: string;
    policyVersion: number;
    policyDigest: string;
  } | null;
  benefit: {
    kind: ManagedSubscriptionRuntimeV1BenefitKind;
    ruleId: string | null;
    usageUnits: number;
  } | null;
  price: ManagedSubscriptionRuntimeV1PriceSnapshot | null;
  limits: {
    activeServices: number | null;
    activeServicesLimit: number | null;
    dailyUsed: number | null;
    dailyLimit: number | null;
    weeklyUsed: number | null;
    weeklyLimit: number | null;
    monthlyUsed: number | null;
    monthlyLimit: number | null;
    remainingUnits: number | null;
  };
  blockers: Array<{ code: ManagedSubscriptionRuntimeReasonCode }>;
  warnings: Array<{ code: ManagedSubscriptionRuntimeReasonCode }>;
  alternatives: Array<{
    paymentIntent: 'PAY_FULL_PRICE';
    requiresExplicitUserConfirmation: true;
  }>;
  evaluatedAt: string;
  expiresAt: string;
}

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
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    fail('SUBSCRIPTION_RUNTIME_SHAPE_INVALID', { field });
  }
};

const plainObject = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_SHAPE_INVALID', { field });
  }
  return value as Record<string, unknown>;
};

const optionalRevision = (value: unknown, field: string): void => {
  if (value !== undefined) positiveInteger(value, field);
};

const V1_ACTION_TARGET_KIND: Record<
  ManagedSubscriptionRuntimeV1Action,
  ManagedSubscriptionRuntimeV1TargetKind
> = {
  CREATE_GAME: 'GAME',
  JOIN_GAME: 'GAME',
  BOOK_GROUP_TRAINING: 'GROUP_TRAINING',
  BOOK_TOURNAMENT: 'TOURNAMENT',
  PURCHASE_ADD_ON_PRODUCT: 'ADD_ON_PRODUCT',
  CANCEL_BOOKING: 'BOOKING',
  RESCHEDULE_BOOKING: 'BOOKING',
  CONFIRM_ATTENDANCE: 'BOOKING',
  CONFIRM_NO_SHOW: 'BOOKING'
};

export function validateManagedSubscriptionRuntimeV1QuoteRequest(
  value: unknown
): asserts value is ManagedSubscriptionRuntimeV1QuoteRequest {
  const request = plainObject(value, 'quoteRequest');
  assertExactKeys(
    request,
    ['action', 'target', 'preferredSubscriptionInstanceId', 'paymentIntent']
      .filter((key) => request[key] !== undefined),
    'quoteRequest'
  );
  oneOf(
    request.action,
    MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTIONS,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTION_INVALID',
    'action'
  );
  oneOf(
    request.paymentIntent,
    MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENT_INVALID',
    'paymentIntent'
  );
  const target = plainObject(request.target, 'target');
  assertExactKeys(target, ['kind', 'id', 'expectedRevision'].filter((key) => target[key] !== undefined), 'target');
  oneOf(
    target.kind,
    MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KINDS,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KIND_INVALID',
    'target.kind'
  );
  requiredId(target.id, 'target.id');
  optionalRevision(target.expectedRevision, 'target.expectedRevision');
  if (V1_ACTION_TARGET_KIND[request.action as ManagedSubscriptionRuntimeV1Action]
    !== target.kind) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTION_TARGET_MISMATCH');
  }
  if (request.preferredSubscriptionInstanceId !== undefined) {
    requiredId(request.preferredSubscriptionInstanceId, 'preferredSubscriptionInstanceId');
  }
}

export function validateManagedSubscriptionRuntimeV1QuoteOutcome(
  value: unknown
): asserts value is ManagedSubscriptionRuntimeV1QuoteOutcome {
  const outcome = plainObject(value, 'quoteOutcome');
  assertExactKeys(outcome, [
    'contractVersion', 'nonBinding', 'requiresReservationRecheck', 'outcome', 'paymentIntent',
    'decisionId', 'serviceAllowed', 'subscriptionBenefitAllowed', 'selectedSubscription',
    'benefit', 'price', 'limits', 'blockers', 'warnings', 'alternatives', 'evaluatedAt', 'expiresAt'
  ], 'quoteOutcome');
  if (outcome.contractVersion !== 1) fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_VERSION_INVALID');
  if (outcome.nonBinding !== true || outcome.requiresReservationRecheck !== true) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_NON_BINDING_REQUIRED');
  }
  oneOf(outcome.outcome, MANAGED_SUBSCRIPTION_RUNTIME_V1_OUTCOMES,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_OUTCOME_INVALID', 'outcome');
  oneOf(outcome.paymentIntent, MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENT_INVALID', 'paymentIntent');
  requiredId(outcome.decisionId, 'decisionId');
  requiredBoolean(outcome.serviceAllowed, 'serviceAllowed');
  requiredBoolean(outcome.subscriptionBenefitAllowed, 'subscriptionBenefitAllowed');
  if (outcome.selectedSubscription !== null) {
    const selected = plainObject(outcome.selectedSubscription, 'selectedSubscription');
    assertExactKeys(selected, ['subscriptionInstanceId', 'policyVersion', 'policyDigest'], 'selectedSubscription');
    requiredId(selected.subscriptionInstanceId, 'selectedSubscription.subscriptionInstanceId');
    positiveInteger(selected.policyVersion, 'selectedSubscription.policyVersion');
    digest(selected.policyDigest, 'selectedSubscription.policyDigest');
  }
  if (outcome.benefit !== null) {
    const benefit = plainObject(outcome.benefit, 'benefit');
    assertExactKeys(benefit, ['kind', 'ruleId', 'usageUnits'], 'benefit');
    oneOf(
      benefit.kind,
      MANAGED_SUBSCRIPTION_RUNTIME_V1_BENEFIT_KINDS,
      'MANAGED_SUBSCRIPTION_RUNTIME_V1_BENEFIT_KIND_INVALID',
      'benefit.kind'
    );
    optionalId(benefit.ruleId, 'benefit.ruleId');
    positiveInteger(benefit.usageUnits, 'benefit.usageUnits');
  }
  if (outcome.price !== null) {
    const price = plainObject(outcome.price, 'price');
    assertExactKeys(price, [
      'priceRevision', 'basePriceMinor', 'discountMinor', 'surchargeMinor', 'finalPriceMinor', 'currency'
    ], 'price');
    positiveInteger(price.priceRevision, 'price.priceRevision');
    const basePriceMinor = nonNegativeInteger(price.basePriceMinor, 'price.basePriceMinor');
    const discountMinor = nonNegativeInteger(price.discountMinor, 'price.discountMinor');
    const surchargeMinor = nonNegativeInteger(price.surchargeMinor, 'price.surchargeMinor');
    const finalPriceMinor = nonNegativeInteger(price.finalPriceMinor, 'price.finalPriceMinor');
    if (price.currency !== 'RUB') fail('SUBSCRIPTION_RUNTIME_CURRENCY_INVALID', { field: 'price' });
    if (discountMinor > basePriceMinor
      || BigInt(basePriceMinor) - BigInt(discountMinor)
        + BigInt(surchargeMinor) !== BigInt(finalPriceMinor)) {
      fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_PRICE_INVARIANT_INVALID');
    }
  }
  const limits = plainObject(outcome.limits, 'limits');
  assertExactKeys(limits, ['activeServices', 'activeServicesLimit', 'dailyUsed', 'dailyLimit',
    'weeklyUsed', 'weeklyLimit', 'monthlyUsed', 'monthlyLimit', 'remainingUnits'], 'limits');
  Object.entries(limits).forEach(([field, item]) => {
    if (item !== null) nonNegativeInteger(item, `limits.${field}`);
  });
  const validateReasons = (raw: unknown, severity: 'BLOCKER' | 'WARNING', field: string): string[] => {
    if (!Array.isArray(raw)) fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_REASON_CODES_INVALID', { field });
    const codes: string[] = (raw as unknown[]).map((item) => {
      const entry = plainObject(item, field);
      assertExactKeys(entry, ['code'], field);
      if (typeof entry.code !== 'string' || !(entry.code in MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES)
        || MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES[entry.code as ManagedSubscriptionRuntimeReasonCode].severity !== severity) {
        fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_REASON_CODES_INVALID', { field });
      }
      return entry.code as string;
    });
    if (new Set(codes).size !== codes.length) fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_REASON_CODES_INVALID', { field });
    return codes;
  };
  const blockers = validateReasons(outcome.blockers, 'BLOCKER', 'blockers');
  validateReasons(outcome.warnings, 'WARNING', 'warnings');
  if (!Array.isArray(outcome.alternatives)) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_ALTERNATIVES_INVALID');
  }
  const alternatives = outcome.alternatives as unknown[];
  if (alternatives.some((item) => {
      const alternative = plainObject(item, 'alternatives');
      return Object.keys(alternative).length !== 2 || alternative.paymentIntent !== 'PAY_FULL_PRICE'
        || alternative.requiresExplicitUserConfirmation !== true;
    })
    || alternatives.length > 1) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_ALTERNATIVES_INVALID');
  }
  requiredInstant(outcome.evaluatedAt, 'evaluatedAt');
  requiredInstant(outcome.expiresAt, 'expiresAt');
  assertInstantOrder(
    outcome.evaluatedAt as string,
    outcome.expiresAt as string,
    'MANAGED_SUBSCRIPTION_RUNTIME_V1_QUOTE_EXPIRY_INVALID',
    'expiresAt'
  );
  const kind = outcome.outcome as ManagedSubscriptionRuntimeV1Outcome;
  const fullPriceIntent = outcome.paymentIntent === 'PAY_FULL_PRICE';
  const requiresSelection = kind === 'ENTITLEMENT_APPLIED' || kind === 'PRICE_CONFIRMATION_REQUIRED';
  const requiresPrice = !['SERVICE_BLOCKED', 'RETRY_LATER', 'RECONCILIATION_REQUIRED'].includes(kind);
  const fullPriceAlternative = alternatives.length === 1;
  const hasPriceChanged = blockers.includes('PRICE_CHANGED');
  if ((requiresSelection && outcome.selectedSubscription === null)
    || (!requiresSelection && outcome.selectedSubscription !== null)
    || (requiresSelection && outcome.benefit === null)
    || (!requiresSelection && outcome.benefit !== null)
    || (requiresPrice && outcome.price === null)
    || (!requiresPrice && outcome.price !== null)
    || (kind === 'ENTITLEMENT_APPLIED' && (!outcome.serviceAllowed || !outcome.subscriptionBenefitAllowed
      || blockers.length > 0 || fullPriceAlternative || fullPriceIntent))
    || (kind === 'FULL_PRICE_ONLY' && (!outcome.serviceAllowed || outcome.subscriptionBenefitAllowed
      || (fullPriceIntent ? blockers.length > 0 || fullPriceAlternative
        : blockers.length === 0 || !fullPriceAlternative)))
    || (kind === 'SUBSCRIPTION_SELECTION_REQUIRED' && (!outcome.serviceAllowed
      || outcome.subscriptionBenefitAllowed || blockers.length === 0 || fullPriceIntent))
    || (kind === 'PRICE_CONFIRMATION_REQUIRED' && (!outcome.serviceAllowed
      || !outcome.subscriptionBenefitAllowed || !hasPriceChanged || fullPriceIntent))
    || (kind === 'SERVICE_BLOCKED' && (outcome.serviceAllowed || outcome.subscriptionBenefitAllowed || blockers.length === 0 || fullPriceAlternative))
    || (kind === 'RETRY_LATER' && (outcome.serviceAllowed || outcome.subscriptionBenefitAllowed
      || !blockers.some((code) => MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES[
        code as ManagedSubscriptionRuntimeReasonCode
      ].retryable)))
    || (kind === 'RECONCILIATION_REQUIRED' && (outcome.serviceAllowed || outcome.subscriptionBenefitAllowed
      || !blockers.some((code) => ['RECONCILIATION_REQUIRED', 'PROVIDER_TIMEOUT_AFTER_ACCEPT',
        'PROVIDER_READBACK_MISMATCH'].includes(code))))) {
    fail('MANAGED_SUBSCRIPTION_RUNTIME_V1_OUTCOME_FLAGS_INVALID');
  }
}

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
  if (![1, 2].includes(value.schemaVersion)) fail('SUBSCRIPTION_PUBLICATION_SCHEMA_INVALID');
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
