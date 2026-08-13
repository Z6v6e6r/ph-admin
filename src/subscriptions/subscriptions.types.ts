export type SubscriptionTypeState = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SubscriptionPolicyStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export type SubscriptionPolicyApplyTo = 'NEW_ONLY' | 'ACTIVE_AND_NEW';
export type ActiveServiceScope = 'SUBSCRIPTION_BENEFIT_ONLY' | 'ALL_BOOKINGS';
export type SubscriptionActivationMode = 'PURCHASE' | 'FIRST_USE' | 'FIXED_DATE';
export type SubscriptionRenewalMode = 'DISABLED' | 'MANUAL' | 'AUTO';
export type SubscriptionRefundMode = 'NONE' | 'MANUAL' | 'PRORATED';
export type SubscriptionUpgradeMode = 'DISABLED' | 'MANUAL' | 'PRORATED';
export type SubscriptionConsumptionPriority =
  | 'EXPIRING_FIRST'
  | 'SUBSCRIPTION_FIRST'
  | 'MANUAL';
export type SubscriptionCrossStationMode =
  | 'HOME_ONLY'
  | 'ALLOWED'
  | 'ALLOWED_WITH_SURCHARGE';
export type SubscriptionReschedulePolicy = 'KEEP_RESERVATION' | 'REVALIDATE';
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

export interface SubscriptionCapabilities {
  lifecycle: {
    activationMode: SubscriptionActivationMode;
    activationWindowDays: number;
    fixedActivationAt: string | null;
    fixedActivationTimeZone: 'Europe/Moscow';
    gracePeriodDays: number;
    allowBookingsAfterExpiry: boolean;
    freeze: {
      enabled: boolean;
      maxDaysPerYear: number;
      maxPeriodsPerYear: number;
      minDaysPerPeriod: number;
      extendsValidity: boolean;
    };
    adminExtension: {
      enabled: boolean;
      maxDays: number;
      reasonRequired: boolean;
    };
  };
  usage: {
    weeklyUsageLimit: number | null;
    monthlyUsageLimit: number | null;
    maxFutureBookings: number | null;
    minHoursBetweenUses: number;
    guestPassesPerMonth: number;
    earlyBookingAccessHours: number;
    waitlistPriority: boolean;
    crossStationMode: SubscriptionCrossStationMode;
    crossStationSurchargeMinor: number;
    blackoutDates: string[];
  };
  cancellation: {
    freeCancellationHours: Record<EventCategory, number>;
    lateCancellationUsageUnits: number;
    noShowUsageUnits: number;
    noShowBlockDays: number;
    stationCancellationRestoresUsage: boolean;
    reschedulePolicy: SubscriptionReschedulePolicy;
  };
  commerce: {
    renewalMode: SubscriptionRenewalMode;
    renewalWindowDays: number;
    priceLockEnabled: boolean;
    renewalDiscountPercent: number;
    purchaseLimitPerClient: number;
    reservationTtlMinutes: number;
    waitlistWhenSoldOut: boolean;
    promoCodesAllowed: boolean;
    installmentsAllowed: boolean;
    upgradeDowngradeMode: SubscriptionUpgradeMode;
    terminationRefundMode: SubscriptionRefundMode;
    coolingOffDays: number;
    giftable: boolean;
    transferable: boolean;
    familySeats: number;
    corporateSeats: number;
    maxConcurrentSubscriptions: number;
    consumptionPriority: SubscriptionConsumptionPriority;
  };
  engagement: {
    showSavings: boolean;
    showBreakEvenProgress: boolean;
    expirationReminderDays: number[];
    referralEnabled: boolean;
    renewalBonusEnabled: boolean;
    personalizedRecommendationsEnabled: boolean;
  };
  analytics: {
    trackRevenue: boolean;
    trackRefunds: boolean;
    trackBreakage: boolean;
    trackMargin: boolean;
    trackPeakLoad: boolean;
    trackChurn: boolean;
    trackCohorts: boolean;
    attributionTag: string | null;
  };
}

export interface SubscriptionPolicyVersion {
  modelVersion: 2;
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
  capabilities: SubscriptionCapabilities;
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
  schemaVersion: 1 | 2;
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
