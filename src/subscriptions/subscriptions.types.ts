export type SubscriptionTypeState = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SubscriptionPolicyStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export type SubscriptionPolicyApplyTo = 'NEW_ONLY' | 'ACTIVE_AND_NEW';
export type ActiveServiceScope = 'SUBSCRIPTION_BENEFIT_ONLY' | 'ALL_BOOKINGS';
export type SubscriptionActivationMode =
  | 'PURCHASE'
  | 'FIRST_USE'
  | 'FIXED_DATE'
  | 'FIRST_USE_OR_FIXED_DATE';
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
export type DailyUsageLimitExceededMode = 'BLOCK' | 'PERCENT_DISCOUNT';
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
  dailyUsagePolicy?: {
    actions: SubscriptionAction[];
    limitExceeded: DailyUsageLimitExceededMode;
    percentage: number | null;
  };
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
  usageScenarioUrl: string | null;
  tokenIssued: boolean;
  replayed: boolean;
  correlationId: string;
}

export interface SubscriptionUsageTestTargetView {
  targetId: string;
  title: string;
  description: string;
  action: SubscriptionAction;
  courtPriceMinor: number | null;
  participantCount: number;
  target: SubscriptionShadowQuoteResolvedTarget;
}

export interface SubscriptionUsageTestScenarioView {
  mode: 'HOSTED_DEV_SHADOW';
  testOnly: true;
  providerMode: 'FAKE_NO_VIVA';
  evaluatedAt: string;
  offer: {
    offerId: string;
    title: string;
    stationId: string;
    timeZone: string;
  };
  policySource: {
    sourceStatus: SubscriptionPolicyStatus;
    runtimeStatus: 'PUBLISHED';
    sourceModelVersion: 2 | 3;
    version: number;
    digest: string;
  };
  limits: {
    activeServicesEnabled: boolean;
    maxActiveServices: number | null;
    bookingWindowEnabled: boolean;
    bookingWindowDays: number | null;
    dailyUsageLimit: number;
    dailyUsageActions: SubscriptionAction[];
    dailyLimitExceeded: DailyUsageLimitExceededMode;
    dailyLimitExceededPercentage: number | null;
  };
  targets: SubscriptionUsageTestTargetView[];
}

export interface SubscriptionUsageTestQuoteResult {
  target: SubscriptionUsageTestTargetView;
  decision: SubscriptionShadowQuoteResult;
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

export type SubscriptionProviderMappingState = 'DRAFT' | 'VERIFIED' | 'DISABLED';
export type SubscriptionProviderScopeKind = 'TENANT' | 'STUDIO' | 'STATION' | 'STATION_SET';
export type SubscriptionPublicationState =
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'DISABLED_FOR_NEW_OPERATIONS';
export type SubscriptionInstanceState =
  | 'PENDING_ACTIVATION'
  | 'CANCELLED_PRE_ACTIVATION'
  | 'REFUNDED_PRE_ACTIVATION'
  | 'ACTIVE'
  | 'FROZEN'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REVOKED';
export type SubscriptionReconciliationState = 'CURRENT' | 'STALE' | 'REQUIRED';
export type SubscriptionRuntimeOperationKind =
  | 'PURCHASE'
  | 'ACTIVATION'
  | 'BOOKING'
  | 'CANCELLATION'
  | 'REFUND'
  | 'FREEZE'
  | 'UNFREEZE'
  | 'ADMIN_ADJUSTMENT';
export type SubscriptionRuntimeOperationState =
  | 'CREATED'
  | 'RESERVED'
  | 'PROVIDER_SENT'
  | 'PROVIDER_PENDING'
  | 'CONFIRMED'
  | 'COMPENSATION_PENDING'
  | 'COMPENSATED'
  | 'FAILED'
  | 'MANUAL_RECONCILIATION';
export type SubscriptionRuntimeActorType = 'CLIENT' | 'ADMIN' | 'SYSTEM';
export type SubscriptionUsageLedgerEventType =
  | 'PURCHASE_RESERVED'
  | 'PURCHASE_PAID'
  | 'PURCHASE_FAILED'
  | 'PURCHASE_EXPIRED'
  | 'PURCHASE_REFUNDED'
  | 'INSTANCE_ACTIVATED'
  | 'INSTANCE_FROZEN'
  | 'INSTANCE_UNFROZEN'
  | 'INSTANCE_EXPIRED'
  | 'INSTANCE_REVOKED'
  | 'INSTANCE_RENEWED'
  | 'QUOTE_ELIGIBLE'
  | 'QUOTE_BLOCKED'
  | 'ENTITLEMENT_RESERVED'
  | 'ENTITLEMENT_RELEASED'
  | 'ENTITLEMENT_CONSUMED'
  | 'ENTITLEMENT_RESTORED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_RESCHEDULED'
  | 'ATTENDANCE_CONSUMED'
  | 'ATTENDANCE_RETURNED'
  | 'LATE_CANCELLATION_APPLIED'
  | 'LATE_CANCELLATION_REVERSED'
  | 'NO_SHOW_CONFIRMED'
  | 'NO_SHOW_REVERSED'
  | 'SURCHARGE_CHARGED'
  | 'SURCHARGE_REFUNDED'
  | 'ADD_ON_CHARGED'
  | 'ADD_ON_REFUNDED'
  | 'ADMIN_ADJUSTED';

export interface SubscriptionProviderScope {
  kind: SubscriptionProviderScopeKind;
  scopeId: string;
}

export interface StoredSubscriptionProviderMapping {
  schemaVersion: 1;
  mappingId: string;
  tenantId: string;
  provider: SubscriptionProvider;
  providerProductId: string;
  providerScope: SubscriptionProviderScope;
  subscriptionTypeId: string;
  state: SubscriptionProviderMappingState;
  evidenceRef: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  idempotency: SubscriptionIdempotency;
}

export interface SubscriptionRuntimeProjectionSnapshot {
  runtimeSchemaVersion: 1;
  subscriptionTypeId: string;
  policyVersion: number;
  status: 'PUBLISHED';
  effectiveAt: string;
  timeZone: 'Europe/Moscow';
  createGame: SubscriptionPolicyVersion['createGame'];
  joinGame: SubscriptionPolicyVersion['joinGame'];
  activeServicesLimit: NonNullable<SubscriptionPolicyVersion['activeServicesLimit']>;
  bookingWindow: NonNullable<SubscriptionPolicyVersion['bookingWindow']>;
  dailyUsageLimit: number;
  dailyUsagePolicy?: NonNullable<SubscriptionPolicyVersion['dailyUsagePolicy']>;
  usageUnitsByDuration: SubscriptionPolicyVersion['usageUnitsByDuration'];
  stationAccessRules: SubscriptionStationAccessRule[];
  benefitRules: BenefitRule[];
  lifecycle: {
    allowBookingsAfterExpiry: boolean;
    activationMode?: SubscriptionActivationMode;
    activationWindowDays?: number;
    fixedActivationAt?: string | null;
    fixedActivationTimeZone?: 'Europe/Moscow';
    validityDays?: number;
  };
  usage: {
    weeklyUsageLimit: number | null;
    monthlyUsageLimit: number | null;
    maxFutureBookings: number | null;
    minHoursBetweenUses: number;
    blackoutDates: string[];
  };
}

export interface StoredSubscriptionPolicyPublication {
  schemaVersion: 1 | 2 | 3;
  publicationId: string;
  subscriptionTypeId: string;
  policyVersion: number;
  policyDigest: string;
  mappingId: string;
  dictionaryRevision: string;
  runtimeProjection: SubscriptionRuntimeProjectionSnapshot;
  state: SubscriptionPublicationState;
  effectiveAt: string;
  publishedAt: string;
  publishedBy: string;
  supersededAt: string | null;
  supersededBy: string | null;
  impactPreviewRef: string;
  approvalAuditRef: string;
  idempotency?: SubscriptionIdempotency;
  runtimeCompatibility?: SubscriptionRuntimeCompatibility;
}

export interface SubscriptionRuntimeCompatibility {
  adapterId: string;
  contractVersion: number;
  capabilityDigest: `sha256:${string}`;
}

export interface SubscriptionProjectionFenceBinding {
  mappingId: string;
  mappingRevision: number;
  subscriptionTypeId: string;
  publicationId: string;
  policyVersion: number;
  policyDigest: `sha256:${string}`;
  runtimeCompatibility: SubscriptionRuntimeCompatibility;
}

export interface StoredSubscriptionProjectionFence {
  schemaVersion: 1;
  fenceId: string;
  subscriptionTypeId: string;
  bindingRevision: number;
  bindingDigest: `sha256:${string}`;
  binding: SubscriptionProjectionFenceBinding;
  coordinationRevision: number;
  lastProjectorReconciliationDigest: `sha256:${string}` | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionInstanceEvidence {
  paymentEvidenceRef: string | null;
  providerInstanceEvidenceRef: string | null;
  lastReadBackEvidenceRef: string | null;
}

export interface StoredSubscriptionInstance {
  schemaVersion: 1;
  subscriptionInstanceId: string;
  tenantId: string;
  subscriptionTypeId: string;
  policyVersion: number;
  policyDigest: string;
  mappingId: string;
  provider: SubscriptionProvider;
  providerProductId: string;
  providerClientId: string;
  clientSubscriptionId: string;
  clientRefHash: string;
  homeStationId: string;
  releaseProgramId: string;
  releasePhaseId: string;
  purchasePrice: Money;
  state: SubscriptionInstanceState;
  purchasedAt: string;
  activeFrom: string | null;
  activeTo: string | null;
  frozenUntil: string | null;
  renewalPredecessorId: string | null;
  renewalSuccessorId: string | null;
  evidence: SubscriptionInstanceEvidence;
  reconciliation: {
    state: SubscriptionReconciliationState;
    asOf: string | null;
    evidenceRef: string | null;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionInstanceProjectorCheckpointState = 'CURRENT' | 'FAILED';
export type SubscriptionInstanceProjectorCoverage =
  | {
    kind: 'ORDERED_CHANGE_FEED';
    watermark: string;
    watermarkDigest: `sha256:${string}`;
    coverageThrough: string;
  }
  | {
    kind: 'CONSISTENT_FULL_SNAPSHOT';
    snapshotId: string;
    snapshotDigest: `sha256:${string}`;
    coverageThrough: string;
    sourceItemCount: number;
  };

export interface StoredSubscriptionInstanceProjectorCheckpoint {
  schemaVersion: 2;
  checkpointId: string;
  tenantId: string;
  provider: 'VIVA';
  providerProductId: string;
  providerScope: {
    kind: Exclude<SubscriptionProviderScopeKind, 'STUDIO'>;
    scopeId: string;
  };
  approvalRef: string;
  binding: {
    fenceId: string;
    fenceRevision: number;
    fenceDigest: `sha256:${string}`;
    mappingId: string;
    mappingRevision: number;
    subscriptionTypeId: string;
    publicationId: string;
    policyVersion: number;
    policyDigest: `sha256:${string}`;
    releaseProgramId: string;
    releaseProgramRevision: number;
    releasePhaseId: string;
    runtimeCompatibility: SubscriptionRuntimeCompatibility;
  };
  producer: {
    producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR';
    contractVersion: 2;
    producerCapabilityDigest: `sha256:${string}`;
    sourceContractDigest: `sha256:${string}`;
    authorityDigest: `sha256:${string}`;
  };
  state: SubscriptionInstanceProjectorCheckpointState;
  coverage: SubscriptionInstanceProjectorCoverage;
  reconciliation: {
    runId: string;
    mode: 'INITIAL_FULL' | 'INCREMENTAL' | 'FULL_RECONCILIATION';
    startedAt: string;
    completedAt: string | null;
    sourceItemCount: number;
    insertedCount: number;
    updatedCount: number;
    replayedCount: number;
    terminalCount: number;
    failureCount: number;
    sourceEvidenceRef: string;
    resultEvidenceRef: string | null;
    reconciliationDigest: `sha256:${string}`;
  };
  failure: { code: string; detectedAt: string; evidenceRef: string } | null;
  lease: {
    runId: string;
    epoch: number;
    ownerIdHash: `sha256:${string}`;
    acquiredAt: string;
    expiresAt: string;
  } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionEntitlementReservation {
  operationId: string;
  targetId: string;
  startsAt: string;
  usageUnits: number;
  state: 'RESERVED' | 'CONFIRMED';
}

export interface StoredSubscriptionEntitlementAggregate {
  schemaVersion: 1;
  subscriptionInstanceId: string;
  revision: number;
  activeServiceScope: ActiveServiceScope;
  activeServiceCount: number;
  activeServices: SubscriptionEntitlementReservation[];
  dailyUsage: Record<string, number>;
  weeklyUsage: Record<string, number>;
  monthlyUsage: Record<string, number>;
  futureBookingCount: number;
  futureServiceStartsAt: string[];
  remainingUnits: number | null;
  reconciliation: {
    state: SubscriptionReconciliationState;
    asOf: string | null;
    evidenceRef: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionShadowQuoteIdentityContext {
  resolutionSource: 'LK_IDENTITY';
  tenantId: string;
  clientRefHash: string;
  evidenceRef: string;
  verifiedAt: string;
}

export interface SubscriptionShadowQuoteResolvedTarget {
  resolutionSource: 'SERVER';
  targetId: string;
  stationId: string;
  category: BenefitCategory;
  externalEventTypeId: string;
  productTypeId: string | null;
  durationMinutes: number;
  startsAt: string;
  basePriceMinor: number | null;
  currency: 'RUB';
  dictionaryRevision: string;
  evidenceRef: string;
  priceEvidenceRef: string | null;
  resolvedAt: string;
}

export type SubscriptionCanonicalTargetSnapshotState = 'ACTIVE' | 'REVOKED';

export interface StoredSubscriptionCanonicalTargetSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  tenantId: string;
  targetId: string;
  action: SubscriptionAction;
  state: SubscriptionCanonicalTargetSnapshotState;
  revision: number;
  stationId: string;
  category: BenefitCategory;
  externalEventTypeId: string;
  productTypeId: string | null;
  durationMinutes: number;
  startsAt: string;
  basePriceMinor: number;
  currency: 'RUB';
  dictionaryRevision: string;
  evidenceRef: string;
  priceEvidenceRef: string;
  sourceKind: 'CANONICAL_TARGET_PROJECTION';
  observedAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface SubscriptionShadowQuoteRequest {
  identity: SubscriptionShadowQuoteIdentityContext;
  subscriptionInstanceId: string;
  action: SubscriptionAction;
  target: SubscriptionShadowQuoteResolvedTarget;
}

export interface SubscriptionShadowQuoteBlocker {
  code: string;
  message: string;
  details: Record<string, string | number | boolean | null> | null;
}

export interface SubscriptionShadowQuoteAppliedBenefit {
  kind: Exclude<BenefitKind, 'DISABLED'> | 'NONE';
  ruleId: string | null;
  stationRuleId: string | null;
  basePriceMinor: number | null;
  discountMinor: number;
  surchargeMinor: number;
  finalPriceMinor: number | null;
  partialPriceCalculation: {
    numerator: number;
    denominator: number;
    chargeBeforeDiscountMinor: number;
    percentageDiscountMinor: number;
  } | null;
  currency: 'RUB';
}

export interface SubscriptionShadowQuoteResult {
  quoteKind: 'SHADOW';
  nonBinding: true;
  requiresReservationRecheck: true;
  eligible: boolean;
  blockers: SubscriptionShadowQuoteBlocker[];
  subscriptionInstanceId: string;
  policyVersion: number | null;
  policyDigest: string | null;
  aggregateRevision: number | null;
  evaluatedAt: string;
  usageUnits: number | null;
  activeServices: number | null;
  maxActiveServices: number | null;
  dailyUsed: number | null;
  dailyLimit: number | null;
  benefit: SubscriptionShadowQuoteAppliedBenefit | null;
  decision: SubscriptionRuntimeEntitlementDecisionSnapshot | null;
}

export interface SubscriptionProviderProductEvidence {
  provider: 'VIVA';
  providerProductId: string;
  name: string | null;
  type: string | null;
  providerReportedCost: number | null;
  costUnit: 'UNVERIFIED';
  observedAt: string;
  evidenceRef: string;
}

export interface SubscriptionProviderMappingPreview {
  subscriptionTypeId: string;
  policyVersion: number;
  policyStatus: SubscriptionPolicyStatus;
  canonicalStationId: string;
  providerStudioId: string;
  providerBinding: SubscriptionProviderBindingCandidate;
  evidenceState: 'EVIDENCE_ONLY';
  persisted: false;
  verified: false;
  product: SubscriptionProviderProductEvidence;
  blockers: Array<{
    code: string;
    message: string;
  }>;
}

export interface SubscriptionPolicyPublicationPreview {
  subscriptionTypeId: string;
  policyVersion: number;
  policyStatus: 'DRAFT';
  readOnly: true;
  blocked: false;
  blockers: [];
  tenantId: string;
  providerStudioId: string;
  providerScope: SubscriptionProviderScope;
  providerProductId: string;
  providerEvidence: SubscriptionProviderProductEvidence;
  dictionaryRevision: string;
  dictionaryEvidenceRef: string;
  policyDigest: string;
  runtimeCompatibility: SubscriptionRuntimeCompatibility;
  impactPreviewRef: string;
  runtimeProjection: SubscriptionRuntimeProjectionSnapshot;
  publicationMode: 'INITIAL' | 'SUPERSESSION';
  providerMappingMode: 'CREATE' | 'REUSE';
  supersedes: null | {
    publicationId: string;
    policyVersion: number;
    policyDigest: string;
  };
  instanceImpact: {
    applyTo: SubscriptionPolicyApplyTo;
    existingInstanceCount: number;
    migrationRequired: false;
  };
}

export type SubscriptionProviderMappingView = Omit<
  StoredSubscriptionProviderMapping,
  'idempotency'
>;

export interface SubscriptionPolicyPublicationResult {
  mapping: SubscriptionProviderMappingView;
  publication: StoredSubscriptionPolicyPublication;
}

export interface SubscriptionRuntimeEntitlementDecisionSnapshot {
  decisionKind: 'ENTITLEMENT';
  policyVersion: number;
  policyDigest: string;
  action: SubscriptionAction;
  target: {
    targetId: string;
    stationId: string;
    eventTypeId: string | null;
    productTypeId: string | null;
    durationMinutes: number;
    startsAt: string;
  };
  usageUnits: number;
  money: {
    basePriceMinor: number | null;
    discountMinor: number;
    surchargeMinor: number;
    finalPriceMinor: number | null;
    currency: 'RUB';
  };
}

export interface SubscriptionRuntimePurchaseDecisionSnapshot {
  decisionKind: 'PURCHASE';
  policyVersion: number;
  policyDigest: string;
  mappingId: string;
  providerProductId: string;
  releaseProgramId: string;
  releasePhaseId: string;
  stationId: string;
  quantity: 1;
  price: Money;
}

export type SubscriptionRuntimeDecisionSnapshot =
  | SubscriptionRuntimeEntitlementDecisionSnapshot
  | SubscriptionRuntimePurchaseDecisionSnapshot;

export interface StoredSubscriptionRuntimeOperation {
  schemaVersion: 1;
  operationId: string;
  revision: number;
  tenantId: string;
  subscriptionInstanceId: string | null;
  kind: SubscriptionRuntimeOperationKind;
  state: SubscriptionRuntimeOperationState;
  actor: {
    type: SubscriptionRuntimeActorType;
    actorId: string;
  };
  idempotency: {
    keyHash: string;
    requestHash: string;
  };
  correlationId: string;
  decision: SubscriptionRuntimeDecisionSnapshot | null;
  providerCorrelationId: string | null;
  providerEvidenceRefs: string[];
  attempts: number;
  nextAttemptAt: string | null;
  compensationState: 'NONE' | 'PENDING' | 'APPLIED' | 'MANUAL_REVIEW';
  lastReconciledAt: string | null;
  lastReconciliationResult: string | null;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}

export interface StoredSubscriptionUsageLedgerEvent {
  schemaVersion: 1;
  eventId: string;
  eventHash: string;
  eventType: SubscriptionUsageLedgerEventType;
  tenantId: string;
  subscriptionInstanceId: string | null;
  operationId: string;
  correlationId: string;
  policyVersion: number;
  policyDigest: string;
  stationId: string | null;
  eventTypeId: string | null;
  productTypeId: string | null;
  moneyDeltaMinor: number;
  currency: 'RUB';
  usageDelta: number;
  providerEvidenceRef: string | null;
  actor: {
    type: SubscriptionRuntimeActorType;
    actorId: string;
  };
  occurredAt: string;
  recordedAt: string;
}

export interface StoredSubscriptionOutboxEvent {
  schemaVersion: 1;
  outboxEventId: string;
  ledgerEventId: string;
  subscriptionInstanceId: string | null;
  topic: 'SUBSCRIPTION_LEDGER_EVENT';
  status: 'PENDING' | 'DELIVERED' | 'DEAD_LETTER';
  attempts: number;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
