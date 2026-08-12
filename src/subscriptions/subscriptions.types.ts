export type SubscriptionTypeState = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SubscriptionPolicyStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export type SubscriptionPolicyApplyTo = 'NEW_ONLY' | 'ACTIVE_AND_NEW';
export type ActiveServiceScope = 'SUBSCRIPTION_BENEFIT_ONLY' | 'ALL_BOOKINGS';
export type EventCategory = 'GAME' | 'GROUP_TRAINING' | 'TOURNAMENT';
export type BenefitKind =
  | 'FREE_ENTITLEMENT'
  | 'FIXED_PRICE'
  | 'PERCENT_DISCOUNT'
  | 'FIXED_DISCOUNT'
  | 'DISABLED';
export type ReleasePhaseMode = 'BULK' | 'DAILY_DROP' | 'MANUAL';
export type ReleasePhaseActivation = 'MANUAL' | 'SCHEDULED' | 'PREVIOUS_SOLD_OUT';
export type ReleaseProgramState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SOLD_OUT'
  | 'CLOSED';

export interface SubscriptionType {
  subscriptionTypeId: string;
  code: string;
  title: string;
  description: string | null;
  state: SubscriptionTypeState;
  currentPolicyVersion: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BenefitRule {
  ruleId: string;
  enabled: boolean;
  category: EventCategory;
  externalEventTypeIds: string[];
  stationIds: string[];
  kind: BenefitKind;
  valueMinor: number | null;
  percentage: number | null;
  priority: number;
}

export interface SubscriptionPolicyVersion {
  subscriptionTypeId: string;
  version: number;
  revision: number;
  status: SubscriptionPolicyStatus;
  effectiveAt: string;
  applyTo: SubscriptionPolicyApplyTo;
  validityDays: number;
  createGame: {
    enabled: boolean;
    durationsMinutes: Array<60 | 90 | 120>;
  };
  joinGame: {
    enabled: boolean;
    minDurationMinutes: number;
    maxDurationMinutes: number;
  };
  maxActiveServices: number;
  bookingWindowDays: number;
  dailyUsageLimit: number;
  activeServiceScope: ActiveServiceScope;
  usageUnitsByDuration: { '60': number; '90': number; '120': number };
  benefitRules: BenefitRule[];
  createdAt: string;
  createdBy: string;
}

export interface Money {
  amountMinor: number;
  currency: 'RUB';
}

export interface ReleasePhase {
  releasePhaseId: string;
  order: number;
  mode: ReleasePhaseMode;
  totalQuantity: number;
  dailyDropQuantity: number | null;
  dailyDropLocalTime: string | null;
  price: Money;
  activation: ReleasePhaseActivation;
  scheduledAt: string | null;
  providerProductRef: string | null;
  counters: {
    available: number;
    reserved: number;
    sold: number;
    refunded: number;
  };
  nextReleaseAt: string | null;
}

export interface ReleaseProgram {
  releaseProgramId: string;
  subscriptionTypeId: string;
  stationId: string;
  timezone: string;
  state: ReleaseProgramState;
  revision: number;
  phases: ReleasePhase[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface SubscriptionTypePage {
  items: SubscriptionType[];
  nextCursor: string | null;
}

export interface ReleaseProgramPage {
  items: ReleaseProgram[];
  nextCursor: string | null;
}

export interface StoredSubscriptionType extends SubscriptionType {
  schemaVersion: 1;
  codeNorm: string;
  createdBy: string;
  idempotency: SubscriptionIdempotency;
}

export interface StoredSubscriptionPolicyVersion extends SubscriptionPolicyVersion {
  schemaVersion: 1;
  idempotency: SubscriptionIdempotency;
}

export interface SubscriptionIdempotency {
  actorId: string;
  key: string;
  requestHash: string;
  correlationId: string;
}

export type StoredReleasePhase = Omit<ReleasePhase, 'counters' | 'nextReleaseAt'>;

export interface StoredReleaseProgram extends Omit<ReleaseProgram, 'phases'> {
  schemaVersion: 1;
  phases: StoredReleasePhase[];
  idempotency: SubscriptionIdempotency;
}

export interface SubscriptionCreateResult<T> {
  item: T;
  replayed: boolean;
  correlationId: string;
}
