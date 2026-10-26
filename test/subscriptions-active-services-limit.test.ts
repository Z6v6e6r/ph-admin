import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActiveServicesLimitDto } from '../src/subscriptions/dto/create-policy-version.dto';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { evaluateSubscriptionShadowQuote } from '../src/subscriptions/subscription-shadow-quote';
import { reservationFallsBackToFullPrice } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import {
  computeSubscriptionRuntimeProjectionDigest,
} from '../src/subscriptions/subscription-runtime-contracts';
import {
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  SubscriptionShadowQuoteRequest,
} from '../src/subscriptions/subscriptions.types';

const NOW = '2026-08-16T10:00:00.000Z';
const HASH = 'a'.repeat(64);

const publication = (): StoredSubscriptionPolicyPublication => {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:annual',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-16T00:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: {
      enabled: true,
      max: 8,
      scope: 'SUBSCRIPTION_BENEFIT_ONLY',
    },
    bookingWindow: { enabled: false, days: null },
    dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [
      {
        ruleId: 'station_rule:home',
        enabled: true,
        priority: 10,
        selector: { kind: 'HOME_STATION', stationIds: [] },
        surcharge: { kind: 'NONE', amountMinor: 0 },
      },
    ],
    benefitRules: [
      {
        ruleId: 'benefit_rule:join-game',
        enabled: true,
        category: 'GAME',
        actions: ['JOIN_GAME'],
        externalEventTypeIds: ['event_type:open-game'],
        productTypeIds: [],
        durationMinutes: [60, 90, 120],
        stationIds: ['station:yasenevo'],
        kind: 'FREE_ENTITLEMENT',
        valueMinor: null,
        percentage: null,
        partialPrice: null,
        priority: 10,
      },
    ],
    lifecycle: { allowBookingsAfterExpiry: false },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: [],
    },
  };
  return {
    schemaVersion: 3,
    publicationId: 'publication:annual-v3',
    subscriptionTypeId: runtimeProjection.subscriptionTypeId,
    policyVersion: 3,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: 'mapping:annual',
    dictionaryRevision: 'dictionary:2026-08-16',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: '2026-08-16T09:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:annual-v3',
    approvalAuditRef: 'audit:annual-v3',
  };
};

const instance = (): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:annual-1',
  tenantId: 'iSkq6G',
  subscriptionTypeId: 'subscription_type:annual',
  policyVersion: 3,
  policyDigest: publication().policyDigest,
  mappingId: 'mapping:annual',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerClientId: 'provider_client:annual-1',
  clientSubscriptionId: 'client_subscription:annual-1',
  clientRefHash: HASH,
  homeStationId: 'station:yasenevo',
  releaseProgramId: 'release_program:annual',
  releasePhaseId: 'release_phase:first',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: '2026-08-16T09:00:00.000Z',
  activeFrom: '2026-08-16T00:00:00.000Z',
  activeTo: '2027-08-15T23:59:59.999Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment',
    providerInstanceEvidenceRef: 'evidence:provider',
    lastReadBackEvidenceRef: 'evidence:provider',
  },
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:instance-current',
  },
  revision: 1,
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z',
});

const aggregate = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:annual-1',
  revision: 4,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 8,
  activeServices: [],
  dailyUsage: {},
  weeklyUsage: {},
  monthlyUsage: {},
  futureBookingCount: 0,
  futureServiceStartsAt: [],
  remainingUnits: 270,
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:aggregate-current',
  },
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z',
});

const request = (): SubscriptionShadowQuoteRequest => ({
  identity: {
    resolutionSource: 'LK_IDENTITY',
    tenantId: 'iSkq6G',
    clientRefHash: HASH,
    evidenceRef: 'evidence:lk-session',
    verifiedAt: '2026-08-16T09:59:50.000Z',
  },
  subscriptionInstanceId: 'subscription_instance:annual-1',
  action: 'JOIN_GAME',
  target: {
    resolutionSource: 'SERVER',
    targetId: 'exercise:synthetic-1',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: '2026-08-18T06:00:00.000Z',
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-08-16',
    evidenceRef: 'evidence:exercise-read',
    priceEvidenceRef: 'evidence:price-read',
    resolvedAt: '2026-08-16T09:59:50.000Z',
  },
});

const policyVersion = (
  limitExceeded?: 'BLOCK' | 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
): StoredSubscriptionPolicyVersion => ({
  schemaVersion: 3,
  modelVersion: 3,
  subscriptionTypeId: 'subscription_type:annual',
  version: 3,
  revision: 1,
  status: 'PUBLISHED',
  effectiveAt: '2026-08-16T00:00:00.000Z',
  applyTo: 'NEW_ONLY',
  validityDays: 365,
  createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
  joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
  maxActiveServices: 8,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  bookingWindowDays: 0,
  activeServicesLimit: {
    enabled: true,
    max: 8,
    scope: 'SUBSCRIPTION_BENEFIT_ONLY',
    ...(limitExceeded ? { limitExceeded } : {}),
  },
  bookingWindow: { enabled: false, days: null },
  dailyUsageLimit: 1,
  usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
  stationAccessRules: [
    {
      ruleId: 'station_rule:home',
      enabled: true,
      priority: 10,
      selector: { kind: 'HOME_STATION', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 },
    },
  ],
  benefitRules: [
    {
      ruleId: 'benefit_rule:join-game',
      enabled: true,
      category: 'GAME',
      actions: ['JOIN_GAME'],
      externalEventTypeIds: ['event_type:open-game'],
      productTypeIds: [],
      durationMinutes: [60, 90, 120],
      stationIds: ['station:yasenevo'],
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 10,
    },
  ],
  capabilities: {
    lifecycle: {
      activationMode: 'PURCHASE',
      activationWindowDays: 0,
      fixedActivationAt: null,
      fixedActivationTimeZone: 'Europe/Moscow',
      gracePeriodDays: 0,
      allowBookingsAfterExpiry: false,
      freeze: {
        enabled: false,
        maxDaysPerYear: 0,
        maxPeriodsPerYear: 0,
        minDaysPerPeriod: 0,
        extendsValidity: false,
      },
      adminExtension: { enabled: false, maxDays: 0, reasonRequired: true },
    },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      guestPassesPerMonth: 0,
      earlyBookingAccessHours: 0,
      waitlistPriority: false,
      crossStationMode: 'HOME_ONLY',
      crossStationSurchargeMinor: 0,
      blackoutDates: [],
    },
    cancellation: {
      freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 24 },
      lateCancellationUsageUnits: 1,
      noShowUsageUnits: 1,
      noShowBlockDays: 0,
      stationCancellationRestoresUsage: true,
      reschedulePolicy: 'REVALIDATE',
    },
    commerce: {
      renewalMode: 'DISABLED',
      renewalWindowDays: 0,
      priceLockEnabled: false,
      renewalDiscountPercent: 0,
      purchaseLimitPerClient: 0,
      reservationTtlMinutes: 15,
      waitlistWhenSoldOut: false,
      promoCodesAllowed: false,
      installmentsAllowed: false,
      upgradeDowngradeMode: 'DISABLED',
      terminationRefundMode: 'NONE',
      coolingOffDays: 0,
      giftable: false,
      transferable: false,
      familySeats: 0,
      corporateSeats: 0,
      maxConcurrentSubscriptions: 1,
      consumptionPriority: 'EXPIRING_FIRST',
    },
    engagement: {
      showSavings: false,
      showBreakEvenProgress: false,
      expirationReminderDays: [],
      referralEnabled: false,
      renewalBonusEnabled: false,
      personalizedRecommendationsEnabled: false,
    },
    analytics: {
      trackRevenue: false,
      trackRefunds: false,
      trackBreakage: false,
      trackMargin: false,
      trackPeakLoad: false,
      trackChurn: false,
      trackCohorts: false,
      attributionTag: null,
    },
  },
  createdAt: '2026-08-16T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'policy-annual-v3',
    requestHash: HASH,
    correlationId: 'corr:policy-annual-v3',
  },
});

async function testCompilerDefaultsToBlock(): Promise<void> {
  const defaulted = compileSubscriptionRuntimeProjection(policyVersion());
  assert.equal(defaulted.activeServicesLimit.limitExceeded, 'BLOCK');
  const explicit = compileSubscriptionRuntimeProjection(
    policyVersion('FULL_PRICE_WITHOUT_SUBSCRIPTION'),
  );
  assert.equal(
    explicit.activeServicesLimit.limitExceeded,
    'FULL_PRICE_WITHOUT_SUBSCRIPTION',
  );
}

async function testQuoteExposesRuleBehavior(): Promise<void> {
  const blocked = evaluateSubscriptionShadowQuote({
    evaluatedAt: NOW,
    publication: publication(),
    instance: instance(),
    aggregate: aggregate(),
    action: 'JOIN_GAME',
    target: request().target,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.activeServicesLimitExceeded, 'BLOCK');

  const fallbackPublication = publication();
  fallbackPublication.runtimeProjection.activeServicesLimit.limitExceeded =
    'FULL_PRICE_WITHOUT_SUBSCRIPTION';
  const fallback = evaluateSubscriptionShadowQuote({
    evaluatedAt: NOW,
    publication: fallbackPublication,
    instance: instance(),
    aggregate: aggregate(),
    action: 'JOIN_GAME',
    target: request().target,
  });
  assert.equal(fallback.eligible, false);
  assert.ok(fallback.blockers.some((item) => item.code === 'ACTIVE_SERVICES_LIMIT_REACHED'));
  assert.equal(
    fallback.activeServicesLimitExceeded,
    'FULL_PRICE_WITHOUT_SUBSCRIPTION',
  );
}

function testReservationFallback(): void {
  const base = {
    eligible: false,
    blockers: [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED' }],
    aggregateRevision: 4,
  };
  assert.equal(
    reservationFallsBackToFullPrice({
      ...base,
      activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
    }),
    true,
  );
  assert.equal(
    reservationFallsBackToFullPrice({ ...base, activeServicesLimitExceeded: 'BLOCK' }),
    false,
  );
  // The policy that omits the switch fails closed.
  assert.equal(reservationFallsBackToFullPrice(base), false);
  assert.equal(
    reservationFallsBackToFullPrice({
      ...base,
      blockers: [
        { code: 'ACTIVE_SERVICES_LIMIT_REACHED' },
        { code: 'DAILY_LIMIT_REACHED' },
      ],
      activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
    }),
    false,
  );
  assert.equal(
    reservationFallsBackToFullPrice({
      ...base,
      aggregateRevision: null,
      activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
    }),
    false,
  );
  assert.equal(
    reservationFallsBackToFullPrice({
      ...base,
      eligible: true,
      activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
    }),
    false,
  );
}

async function testDtoValidation(): Promise<void> {
  for (const limitExceeded of [undefined, 'BLOCK', 'FULL_PRICE_WITHOUT_SUBSCRIPTION']) {
    const dto = plainToInstance(ActiveServicesLimitDto, {
      enabled: true,
      max: 8,
      scope: 'SUBSCRIPTION_BENEFIT_ONLY',
      ...(limitExceeded === undefined ? {} : { limitExceeded }),
    });
    assert.deepEqual(await validate(dto), []);
  }
  const invalid = plainToInstance(ActiveServicesLimitDto, {
    enabled: true,
    max: 8,
    scope: 'SUBSCRIPTION_BENEFIT_ONLY',
    limitExceeded: 'ALLOW',
  });
  assert.ok((await validate(invalid)).length > 0);
}

async function run(): Promise<void> {
  await testCompilerDefaultsToBlock();
  await testQuoteExposesRuleBehavior();
  testReservationFallback();
  await testDtoValidation();
  console.log('subscriptions active-services limit tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
