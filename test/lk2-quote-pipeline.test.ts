import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import {
  Lk2QuoteEvaluationUnavailable,
  type Lk2QuoteRequest
} from '../src/subscriptions/lk2-runtime/lk2-quote-receiver.service';
import { Lk2ShadowQuoteEvaluator } from '../src/subscriptions/lk2-runtime/lk2-shadow-quote-evaluator';
import { SubscriptionShadowQuoteService } from '../src/subscriptions/subscription-shadow-quote.service';
import { computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import type {
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  SubscriptionShadowQuoteResult,
} from '../src/subscriptions/subscriptions.types';

const NOW = '2026-10-21T08:00:00.000Z';
const TENANT = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const MAPPING_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = 'exercise:synthetic-1';
const PEPPER = 'p'.repeat(40);
const PROVIDER_CLIENT_ID = 'viva-client-1';

process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED = 'true';
process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
process.env.SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED = 'true';
process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = PEPPER;

const now = new Date(NOW);
const iso = (offsetMs: number): string => new Date(now.getTime() + offsetMs).toISOString();
const clientRefHash = computeSubscriptionClientRefHash({
  pepper: PEPPER,
  tenantId: TENANT,
  providerClientId: PROVIDER_CLIENT_ID,
});

function projection(): StoredSubscriptionPolicyPublication['runtimeProjection'] {
  return {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:annual',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: iso(-24 * 60 * 60 * 1000),
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: {
      enabled: true,
      max: 8,
      scope: 'SUBSCRIPTION_BENEFIT_ONLY',
      limitExceeded: 'BLOCK',
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
      weeklyUsageLimit: 2,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: [],
    },
  };
}

function publication(): StoredSubscriptionPolicyPublication {
  const runtimeProjection = projection();
  return {
    schemaVersion: 3,
    publicationId: 'publication:annual-v3',
    subscriptionTypeId: runtimeProjection.subscriptionTypeId,
    policyVersion: 3,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: MAPPING_ID,
    dictionaryRevision: 'dictionary:2026-10-21',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: iso(-24 * 60 * 60 * 1000),
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:annual-v3',
    approvalAuditRef: 'audit:annual-v3',
    runtimeCompatibility: {
      adapterId: 'lk2-runtime-adapter',
      contractVersion: 1,
      capabilityDigest: `sha256:${'c'.repeat(64)}`,
    },
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'publication-annual-v3',
      requestHash: 'a'.repeat(64),
      correlationId: 'corr:publication-annual-v3',
    },
  };
}

function instance(): StoredSubscriptionInstance {
  return {
    schemaVersion: 1,
    subscriptionInstanceId: INSTANCE_ID,
    tenantId: TENANT,
    subscriptionTypeId: 'subscription_type:annual',
    policyVersion: 3,
    policyDigest: publication().policyDigest,
    mappingId: MAPPING_ID,
    provider: 'VIVA',
    providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
    providerClientId: PROVIDER_CLIENT_ID,
    clientSubscriptionId: 'client_subscription:annual-1',
    clientRefHash,
    homeStationId: 'station:yasenevo',
    releaseProgramId: 'release_program:annual',
    releasePhaseId: 'release_phase:first',
    purchasePrice: { amountMinor: 1_980_000, currency: 'RUB' },
    state: 'ACTIVE',
    purchasedAt: iso(-24 * 60 * 60 * 1000),
    activeFrom: iso(-24 * 60 * 60 * 1000),
    activeTo: iso(365 * 24 * 60 * 60 * 1000),
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
      asOf: iso(-10_000),
      evidenceRef: 'evidence:instance-current',
    },
    revision: 1,
    createdAt: iso(-24 * 60 * 60 * 1000),
    updatedAt: iso(-10_000),
  };
}

function mapping(): StoredSubscriptionProviderMapping {
  return {
    schemaVersion: 1,
    mappingId: MAPPING_ID,
    tenantId: TENANT,
    provider: 'VIVA',
    providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
    providerScope: { kind: 'TENANT', scopeId: TENANT },
    subscriptionTypeId: 'subscription_type:annual',
    state: 'VERIFIED',
    evidenceRef: 'evidence:mapping',
    verifiedAt: iso(-10_000),
    verifiedBy: 'admin:subscriptions',
    revision: 1,
    createdAt: iso(-24 * 60 * 60 * 1000),
    createdBy: 'admin:subscriptions',
    updatedAt: iso(-10_000),
    updatedBy: 'admin:subscriptions',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'mapping-annual',
      requestHash: 'a'.repeat(64),
      correlationId: 'corr:mapping',
    },
  };
}

function aggregate(activeServiceCount = 0): StoredSubscriptionEntitlementAggregate {
  return {
    schemaVersion: 1,
    subscriptionInstanceId: INSTANCE_ID,
    revision: 4,
    activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
    activeServiceCount,
    activeServices: Array.from({ length: activeServiceCount }, (_, index) => ({
      operationId: `operation:active-${index + 1}`,
      targetId: `exercise:active-${index + 1}`,
      startsAt: iso(3 * 24 * 60 * 60 * 1000),
      usageUnits: 1,
      state: 'CONFIRMED' as const,
    })),
    dailyUsage: {},
    weeklyUsage: {},
    monthlyUsage: {},
    futureBookingCount: 0,
    futureServiceStartsAt: [],
    remainingUnits: 270,
    reconciliation: {
      state: 'CURRENT',
      asOf: iso(-10_000),
      evidenceRef: 'evidence:aggregate-current',
    },
    createdAt: iso(-24 * 60 * 60 * 1000),
    updatedAt: iso(-10_000),
  };
}

function targetSnapshot(): StoredSubscriptionCanonicalTargetSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: 'canonical_target:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tenantId: TENANT,
    targetId: TARGET_ID,
    action: 'JOIN_GAME',
    state: 'ACTIVE',
    revision: 7,
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 90,
    startsAt: iso(2 * 24 * 60 * 60 * 1000),
    basePriceMinor: 300_000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-10-21',
    evidenceRef: 'evidence:target',
    priceEvidenceRef: 'evidence:price',
    sourceKind: 'CANONICAL_TARGET_PROJECTION',
    observedAt: iso(-10_000),
    expiresAt: iso(60 * 60 * 1000),
    createdAt: iso(-9_000),
  };
}

class FixedShadowQuoteService extends SubscriptionShadowQuoteService {
  protected override now(): Date {
    return now;
  }
}

class FixedResolver extends SubscriptionCanonicalTargetResolverService {
  protected override now(): Date {
    return now;
  }
}

function repository(input: {
  target?: StoredSubscriptionCanonicalTargetSnapshot | null;
  aggregate?: StoredSubscriptionEntitlementAggregate;
  instances?: StoredSubscriptionInstance[];
}) {
  const policy = publication();
  const instanceRow = instance();
  const aggregateRow = input.aggregate ?? aggregate();
  return {
    connectReadOnly: async () => undefined,
    runtimeInstancesByProviderMappingAndClient: async () => input.instances ?? [instanceRow],
    runtimeInstanceByTenantAndId: async () => instanceRow,
    runtimeProviderMappingById: async () => mapping(),
    runtimePolicyPublicationByVersion: async () => policy,
    runtimeEntitlementAggregateByInstance: async () => aggregateRow,
    runtimeCanonicalTargetSnapshot: async () =>
      input.target === undefined ? targetSnapshot() : input.target,
    runtimeLatestCanonicalTargetSnapshot: async () =>
      input.target === undefined ? targetSnapshot() : input.target,
  };
}

const delegation = {
  keyId: 'lk2-key',
  jti: '33333333-3333-4333-8333-333333333333',
  userId: '49d4e88c-7d52-4c1c-8f80-2fc99b42f9ca',
  tenantId: TENANT,
  tenantKey: 'local-padel',
  sessionId: '44444444-4444-4444-8444-444444444444',
  providerClientId: PROVIDER_CLIENT_ID,
  providerMappingId: MAPPING_ID,
  action: 'JOIN_GAME' as const,
  correlationId: 'correlation-0001',
  requestSha256: `sha256:${'a'.repeat(64)}`,
  idempotencyKeySha256: `sha256:${'b'.repeat(64)}`,
  issuedAt: 1_800_000_000,
  expiresAt: 1_800_000_030,
};

const request: Lk2QuoteRequest = {
  action: 'JOIN_GAME',
  target: { kind: 'GAME', id: TARGET_ID, expectedRevision: 7 },
  paymentIntent: 'AUTO_BEST_PRICE',
};

function evaluator(repo: ReturnType<typeof repository>): Lk2ShadowQuoteEvaluator {
  return new Lk2ShadowQuoteEvaluator(
    repo as never,
    new FixedResolver(repo as never),
    new FixedShadowQuoteService(repo as never),
    () => now,
  );
}

async function testEntitlementApplied(): Promise<void> {
  const outcome = await evaluator(repository({})).evaluate({
    delegation,
    request,
    correlationId: 'correlation-0001',
  });
  assert.equal(outcome.outcome, 'ENTITLEMENT_APPLIED');
  assert.equal(outcome.serviceAllowed, true);
  assert.equal(outcome.subscriptionBenefitAllowed, true);
  assert.equal(outcome.selectedSubscription?.policyVersion, 3);
  assert.match(outcome.selectedSubscription?.policyDigest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(outcome.benefit?.ruleId, 'benefit_rule:join-game');
  assert.equal(outcome.benefit?.usageUnits, 1);
  assert.equal(outcome.price?.finalPriceMinor, 0);
  assert.equal(outcome.price?.priceRevision, 7);
  assert.equal(outcome.limits.dailyUsed, 0);
  assert.equal(outcome.limits.dailyLimit, 1);
  assert.equal(outcome.limits.weeklyUsed, 0);
  assert.equal(outcome.limits.weeklyLimit, 2);
  assert.equal(outcome.limits.monthlyUsed, 0);
  assert.equal(outcome.limits.monthlyLimit, null);
}

async function testRuleDrivenLimit(): Promise<void> {
  const denied = await evaluator(repository({ aggregate: aggregate(8) })).evaluate({
    delegation,
    request,
    correlationId: 'correlation-0001',
  });
  assert.equal(denied.outcome, 'FULL_PRICE_ONLY');
  assert.equal(denied.serviceAllowed, true);
  assert.equal(denied.subscriptionBenefitAllowed, false);
  assert.ok(denied.blockers.some((blocker) => blocker.code === 'ACTIVE_SERVICES_LIMIT_REACHED'));
  assert.equal(denied.price?.finalPriceMinor, 300_000);
}

async function testNoSubscriptionQuotesFullPrice(): Promise<void> {
  const outcome = await evaluator(repository({ instances: [] })).evaluate({
    delegation,
    request,
    correlationId: 'correlation-0001',
  });
  assert.equal(outcome.outcome, 'FULL_PRICE_ONLY');
  assert.equal(outcome.serviceAllowed, true);
  assert.equal(outcome.subscriptionBenefitAllowed, false);
  assert.equal(outcome.price?.basePriceMinor, 300_000);
  assert.equal(outcome.price?.finalPriceMinor, 300_000);
  assert.deepEqual(outcome.blockers, [{ code: 'SUBSCRIPTION_NOT_FOUND' }]);
}

async function testMissingTargetIsUncertainty(): Promise<void> {
  await assert.rejects(
    evaluator(repository({ target: null })).evaluate({
      delegation,
      request,
      correlationId: 'correlation-0001',
    }),
    (error) =>
      error instanceof Lk2QuoteEvaluationUnavailable && error.reasonCode === 'TARGET_NOT_FOUND',
  );
}

async function run(): Promise<void> {
  await testEntitlementApplied();
  await testRuleDrivenLimit();
  await testNoSubscriptionQuotesFullPrice();
  await testMissingTargetIsUncertainty();
  console.log('lk2 quote pipeline tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
