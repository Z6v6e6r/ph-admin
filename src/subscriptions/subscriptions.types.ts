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
export type SubscriptionProvider = 'VIVA';
export type SubscriptionProviderReferenceKind = 'PRODUCT_CANDIDATE';
export type SubscriptionProviderEvidenceState = 'UNVERIFIED';
export type SubscriptionAction =
  | 'CREATE_GAME'
  | 'JOIN_GAME'
  | 'BOOK_GROUP_TRAINING'
  | 'BOOK_TOURNAMENT'
  | 'PURCHASE_ADD_ON_PRODUCT';
export type EventCategory = 'GAME' | 'GROUP_TRAINING' | 'TOURNAMENT';
export type BenefitCategory = EventCategory | 'ADD_ON_PRODUCT';
export type BenefitKind =
  | 'FREE_ENTITLEMENT'
  | 'FIXED_PRICE'
  | 'PERCENT_DISCOUNT'
  | 'FIXED_DISCOUNT'
  | 'PARTIAL_PRICE_PERCENT_DISCOUNT'
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
  category: BenefitCategory;
  actions: SubscriptionAction[];
  externalEventTypeIds: string[];
  productTypeIds: string[];
  durationMinutes: number[];
  stationIds: string[];
  kind: BenefitKind;
  valueMinor: number | null;
  percentage: number | null;
  partialPrice: { numerator: number; denominator: number } | null;
  priority: number;
}

export interface SubscriptionStationAccessRule {
  ruleId: string;
  enabled: boolean;
  priority: number;
  selector:
    | { kind: 'HOME_STATION'; stationIds: [] }
    | { kind: 'STATION_LIST'; stationIds: string[] }
    | { kind: 'ALL_STATIONS'; stationIds: [] };
  surcharge: {
    kind: 'NONE' | 'FIXED';
    amountMinor: number;
  };
}

export interface SubscriptionProviderBindingCandidate {
  provider: SubscriptionProvider;
  externalId: string;
  referenceKind: SubscriptionProviderReferenceKind;
  evidenceState: SubscriptionProviderEvidenceState;
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
  modelVersion: 2 | 3;
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
  activeServicesLimit?: {
    enabled: boolean;
    max: number | null;
    scope: ActiveServiceScope;
  };
  bookingWindow?: {
    enabled: boolean;
    days: number | null;
  };
  dailyUsageLimit: number;
  activeServiceScope: ActiveServiceScope;
  usageUnitsByDuration: { '60': number; '90': number; '120': number };
  stationAccessRules?: SubscriptionStationAccessRule[];
  benefitRules: BenefitRule[];
  providerBinding?: SubscriptionProviderBindingCandidate;
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
  schemaVersion: 1 | 2 | 3;
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

export type SubscriptionTestOfferState = 'TEST_ACTIVE' | 'CLOSED';
export type SubscriptionTestProviderMode = 'FAKE';
export type SubscriptionTestPurchaseStatus =
  | 'CREATING'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED';

export interface SubscriptionTestInventoryPhase {
  phaseId: string;
  order: number;
  activation: ReleasePhaseActivation;
  totalQuantity: number;
  price: Money;
  available: number;
  reserved: number;
  sold: number;
  refunded: number;
}

export interface SubscriptionTestInventorySnapshot {
  offerId: string;
  currentPhaseOrder: number;
  currentPhase: SubscriptionTestInventoryPhase | null;
  phases: SubscriptionTestInventoryPhase[];
  revision: number;
  updatedAt: string;
}

export interface SubscriptionTestOfferView {
  offerId: string;
  title: string;
  stationId: string;
  testOnly: true;
  providerMode: SubscriptionTestProviderMode;
  policyVersion: number;
  currentPhase: SubscriptionTestInventoryPhase | null;
  phases: SubscriptionTestInventoryPhase[];
  reservationTtlMinutes: number;
}

export interface SubscriptionTestActivationResult extends SubscriptionTestOfferView {
  accessToken: string | null;
  storefrontPath: string | null;
  tokenIssued: boolean;
  replayed: boolean;
  correlationId: string;
}

export interface SubscriptionImpactIssue {
  code: string;
  message: string;
  target: 'REAL' | 'TEST';
}

export interface SubscriptionPolicyImpactPreview {
  subscriptionTypeId: string;
  policyVersion: number;
  policyStatus: SubscriptionPolicyStatus;
  readOnly: true;
  realPublication: {
    blocked: boolean;
    blockers: SubscriptionImpactIssue[];
  };
  testActivation: {
    allowed: boolean;
    blockers: SubscriptionImpactIssue[];
  };
  warnings: SubscriptionImpactIssue[];
}

export interface SubscriptionTestReservationResult {
  purchaseId: string;
  status: 'PAYMENT_PENDING';
  priceSnapshot: Money;
  expiresAt: string;
}

export interface SubscriptionTestPurchaseView {
  purchaseId: string;
  offerId: string;
  status: Exclude<SubscriptionTestPurchaseStatus, 'CREATING'>;
  priceSnapshot: Money;
  expiresAt: string;
  testOnly: true;
  providerMode: SubscriptionTestProviderMode;
  inventory?: SubscriptionTestInventorySnapshot;
}

export interface StoredSubscriptionTestOffer {
  schemaVersion: 1;
  offerId: string;
  subscriptionTypeId: string;
  releaseProgramId: string;
  title: string;
  stationId: string;
  timezone: string;
  state: SubscriptionTestOfferState;
  testOnly: true;
  providerMode: SubscriptionTestProviderMode;
  accessTokenHash: string;
  policyVersion: number;
  policySnapshot: SubscriptionPolicyVersion;
  releaseProgramSnapshot: ReleaseProgram;
  reservationTtlMinutes: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  idempotency: SubscriptionIdempotency;
}

export interface StoredSubscriptionTestInventory {
  schemaVersion: 1;
  offerId: string;
  currentPhaseOrder: number;
  phases: SubscriptionTestInventoryPhase[];
  purchaseMarkers: Record<string, {
    phaseId: string;
    clientClaimKey: string;
    state: 'RESERVED' | 'PAID' | 'FAILED' | 'EXPIRED';
    updatedAt: string;
  }>;
  clientClaimCounts: Record<string, number>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSubscriptionTestReservation {
  schemaVersion: 1;
  reservationId: string;
  purchaseId: string;
  offerId: string;
  phaseId: string;
  clientRefHash: string;
  status: 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  priceSnapshot: Money;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSubscriptionTestPurchase {
  schemaVersion: 1;
  purchaseId: string;
  offerId: string;
  phaseId: string;
  phaseOrder: number;
  accessTokenHash: string;
  clientRefHash: string;
  status: SubscriptionTestPurchaseStatus;
  priceSnapshot: Money;
  expiresAt: string;
  testOnly: true;
  providerMode: SubscriptionTestProviderMode;
  createdAt: string;
  updatedAt: string;
  inventoryFinalizedAt: string | null;
  idempotency: {
    keyHash: string;
    requestHash: string;
    correlationId: string;
  };
  confirmationCommands: Record<string, {
    requestHash: string;
    correlationId: string;
    outcome: 'PAID' | 'FAILED' | 'PENDING';
  }>;
}

export interface StoredSubscriptionTestEvent {
  schemaVersion: 1;
  eventId: string;
  eventType:
    | 'TEST_OFFER_ACTIVATED'
    | 'PURCHASE_RESERVED'
    | 'PURCHASE_CONFIRMED'
    | 'PURCHASE_RELEASED';
  offerId: string;
  purchaseId: string | null;
  stationId: string;
  correlationId: string;
  actorId: string | null;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}
