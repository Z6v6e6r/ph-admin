import * as assert from 'node:assert/strict';
import { Lk2QuoteEvaluationUnavailable } from '../src/subscriptions/lk2-runtime/lk2-quote-receiver.service';
import { Lk2ShadowQuoteEvaluator } from '../src/subscriptions/lk2-runtime/lk2-shadow-quote-evaluator';
import type { VerifiedLk2QuoteDelegation } from '../src/subscriptions/lk2-runtime/lk2-quote-delegation.verifier';
import type { Lk2QuoteRequest } from '../src/subscriptions/lk2-runtime/lk2-quote-receiver.service';
import type {
  StoredSubscriptionInstance,
  SubscriptionShadowQuoteResolvedTarget,
  SubscriptionShadowQuoteResult
} from '../src/subscriptions/subscriptions.types';

const PEPPER = 'p'.repeat(40);
process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = PEPPER;

const tenantId = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const instanceId = '11111111-1111-4111-8111-111111111111';
const mappingId = '22222222-2222-4222-8222-222222222222';
const delegation: VerifiedLk2QuoteDelegation = {
  keyId: 'lk2-key',
  jti: '33333333-3333-4333-8333-333333333333',
  userId: '49d4e88c-7d52-4c1c-8f80-2fc99b42f9ca',
  tenantId,
  tenantKey: 'local-padel',
  sessionId: '44444444-4444-4444-8444-444444444444',
  providerClientId: 'viva-client-1',
  providerMappingId: mappingId,
  action: 'JOIN_GAME',
  correlationId: 'correlation-0001',
  requestSha256: `sha256:${'a'.repeat(64)}`,
  idempotencyKeySha256: `sha256:${'b'.repeat(64)}`,
  issuedAt: 1_800_000_000,
  expiresAt: 1_800_000_030
};
const request: Lk2QuoteRequest = {
  action: 'JOIN_GAME',
  target: { kind: 'GAME', id: '55555555-5555-4555-8555-555555555555', expectedRevision: 7 },
  paymentIntent: 'AUTO_BEST_PRICE'
};
const target = {
  resolutionSource: 'SERVER',
  targetId: request.target.id,
  stationId: 'station:1',
  category: 'GAME',
  externalEventTypeId: 'event_type:open-game',
  productTypeId: null,
  durationMinutes: 90,
  startsAt: '2026-10-25T06:00:00.000Z',
  basePriceMinor: 300_000,
  currency: 'RUB',
  dictionaryRevision: 'dictionary:1',
  evidenceRef: 'evidence:target',
  priceEvidenceRef: 'evidence:price',
  resolvedAt: '2026-10-21T08:00:00.000Z',
  snapshotRevision: 7
} as SubscriptionShadowQuoteResolvedTarget;

function instance(id = instanceId): StoredSubscriptionInstance {
  return {
    subscriptionInstanceId: id,
    tenantId,
    mappingId,
    providerClientId: 'viva-client-1'
  } as unknown as StoredSubscriptionInstance;
}

function quoteResult(overrides: Partial<SubscriptionShadowQuoteResult> = {}): SubscriptionShadowQuoteResult {
  return {
    quoteKind: 'SHADOW',
    nonBinding: true,
    requiresReservationRecheck: true,
    eligible: false,
    blockers: [],
    subscriptionInstanceId: instanceId,
    policyVersion: 3,
    policyDigest: `sha256:${'c'.repeat(64)}`,
    aggregateRevision: 4,
    evaluatedAt: '2026-10-21T08:00:00.000Z',
    usageUnits: 1,
    activeServices: 1,
    maxActiveServices: 8,
    dailyUsed: 0,
    dailyLimit: 1,
    benefit: null,
    decision: null,
    ...overrides
  } as SubscriptionShadowQuoteResult;
}

function evaluator(input: {
  instances?: StoredSubscriptionInstance[];
  instancesError?: Error;
  resolverError?: Error;
  target?: SubscriptionShadowQuoteResolvedTarget;
  quote?: SubscriptionShadowQuoteResult;
  quoteError?: Error;
  calls?: { quotes: number; instances?: number; targets?: number };
}): Lk2ShadowQuoteEvaluator {
  const repository = {
    runtimeInstancesByProviderMappingAndClient: async () => {
      if (input.calls) input.calls.instances = (input.calls.instances ?? 0) + 1;
      if (input.instancesError) throw input.instancesError;
      return input.instances ?? [instance()];
    }
  };
  const targets = {
    resolveLatest: async () => {
      if (input.calls) input.calls.targets = (input.calls.targets ?? 0) + 1;
      if (input.resolverError) throw input.resolverError;
      return input.target ?? target;
    }
  };
  const shadowQuote = {
    quote: async () => {
      if (input.calls) input.calls.quotes += 1;
      if (input.quoteError) throw input.quoteError;
      return input.quote ?? quoteResult();
    }
  };
  return new Lk2ShadowQuoteEvaluator(
    repository as never,
    targets as never,
    shadowQuote as never,
    () => new Date('2026-10-21T08:00:00.000Z')
  );
}

async function expectUnavailable(
  promise: Promise<unknown>,
  reasonCode: string
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Lk2QuoteEvaluationUnavailable);
    assert.equal(error.reasonCode, reasonCode);
    return true;
  });
}

async function testEligibleBenefit(): Promise<void> {
  const outcome = await evaluator({
    quote: quoteResult({
      eligible: true,
      benefit: {
        kind: 'FREE_ENTITLEMENT',
        ruleId: 'benefit:join',
        stationRuleId: 'station:home',
        basePriceMinor: 300_000,
        discountMinor: 300_000,
        surchargeMinor: 0,
        finalPriceMinor: 0,
        partialPriceCalculation: null,
        currency: 'RUB'
      },
      decision: null
    })
  }).evaluate({ delegation, request, correlationId: 'correlation-0001' });
  assert.equal(outcome.outcome, 'ENTITLEMENT_APPLIED');
  assert.equal(outcome.serviceAllowed, true);
  assert.equal(outcome.subscriptionBenefitAllowed, true);
  assert.deepEqual(outcome.selectedSubscription, {
    subscriptionInstanceId: instanceId,
    policyVersion: 3,
    policyDigest: `sha256:${'c'.repeat(64)}`
  });
  assert.equal(outcome.benefit?.ruleId, 'benefit:join');
  assert.equal(outcome.benefit?.usageUnits, 1);
  assert.equal(outcome.price?.finalPriceMinor, 0);
  assert.equal(outcome.price?.priceRevision, 7);
}

async function testBenefitDenialStaysPaid(): Promise<void> {
  const outcome = await evaluator({
    quote: quoteResult({
      blockers: [
        {
          code: 'ACTIVE_SERVICES_LIMIT_REACHED',
          message: 'limit',
          details: { activeServices: 8, maxActiveServices: 8 }
        }
      ] as never,
      activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION'
    })
  }).evaluate({ delegation, request, correlationId: 'correlation-0001' });
  assert.equal(outcome.outcome, 'FULL_PRICE_ONLY');
  assert.equal(outcome.serviceAllowed, true);
  assert.equal(outcome.subscriptionBenefitAllowed, false);
  assert.deepEqual(outcome.blockers, [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED' }]);
  assert.equal(outcome.price?.finalPriceMinor, 300_000);
  assert.deepEqual(outcome.alternatives, [
    { paymentIntent: 'PAY_FULL_PRICE', requiresExplicitUserConfirmation: true }
  ]);
}

async function testUnclassifiedBlockerIsUncertainty(): Promise<void> {
  await expectUnavailable(
    evaluator({
      quote: quoteResult({
        blockers: [{ code: 'POLICY_PUBLICATION_NOT_FOUND', message: 'x', details: null }] as never
      })
    }).evaluate({ delegation, request, correlationId: 'correlation-0001' }),
    'POLICY_UNAVAILABLE'
  );
  await expectUnavailable(
    evaluator({
      quote: quoteResult({
        blockers: [
          { code: 'PROVIDER_MAPPING_NOT_VERIFIED', message: 'x', details: null }
        ] as never
      })
    }).evaluate({ delegation, request, correlationId: 'correlation-0001' }),
    'POLICY_MAPPING_UNVERIFIED'
  );
  await expectUnavailable(
    evaluator({
      quote: quoteResult({
        blockers: [{ code: 'BASE_PRICE_UNRESOLVED', message: 'x', details: null }] as never
      })
    }).evaluate({ delegation, request, correlationId: 'correlation-0001' }),
    'PRICE_UNAVAILABLE'
  );
}

async function testParticipationBlocker(): Promise<void> {
  const outcome = await evaluator({
    quote: quoteResult({
      blockers: [{ code: 'TARGET_ALREADY_STARTED', message: 'x', details: null }] as never
    })
  }).evaluate({ delegation, request, correlationId: 'correlation-0001' });
  assert.equal(outcome.outcome, 'SERVICE_BLOCKED');
  assert.equal(outcome.serviceAllowed, false);
  assert.deepEqual(outcome.blockers, [{ code: 'SERVICE_UNAVAILABLE' }]);
}

async function testSelection(): Promise<void> {
  const notFound = await evaluator({ instances: [] }).evaluate({
    delegation,
    request,
    correlationId: 'correlation-0001'
  });
  assert.equal(notFound.outcome, 'FULL_PRICE_ONLY');
  assert.deepEqual(notFound.blockers, [{ code: 'SUBSCRIPTION_NOT_FOUND' }]);

  const multiple = await evaluator({
    instances: [instance(), instance('99999999-9999-4999-8999-999999999999')]
  }).evaluate({ delegation, request, correlationId: 'correlation-0001' });
  assert.equal(multiple.outcome, 'SUBSCRIPTION_SELECTION_REQUIRED');
  assert.deepEqual(multiple.blockers, [{ code: 'SUBSCRIPTION_SELECTION_REQUIRED' }]);

  const foreignPreferred = await evaluator({ instances: [instance()] }).evaluate({
    delegation,
    request: { ...request, preferredSubscriptionInstanceId: '99999999-9999-4999-8999-999999999999' },
    correlationId: 'correlation-0001'
  });
  assert.equal(foreignPreferred.outcome, 'SUBSCRIPTION_SELECTION_REQUIRED');
  assert.deepEqual(foreignPreferred.blockers, [{ code: 'SUBSCRIPTION_NOT_OWNED_BY_ACTOR' }]);
}

async function testTechnicalFailures(): Promise<void> {
  await expectUnavailable(
    evaluator({ instancesError: new Error('db') }).evaluate({
      delegation,
      request,
      correlationId: 'correlation-0001'
    }),
    'POLICY_UNAVAILABLE'
  );
  const resolverError = new Error('not found') as Error & { getResponse: () => unknown };
  resolverError.getResponse = () => ({ code: 'SUBSCRIPTIONS_CANONICAL_TARGET_NOT_FOUND' });
  await expectUnavailable(
    evaluator({ resolverError }).evaluate({ delegation, request, correlationId: 'correlation-0001' }),
    'TARGET_NOT_FOUND'
  );
  const quoteError = new Error('disabled') as Error & { getResponse: () => unknown };
  quoteError.getResponse = () => ({ code: 'SUBSCRIPTION_SHADOW_QUOTE_DISABLED' });
  await expectUnavailable(
    evaluator({ quoteError }).evaluate({ delegation, request, correlationId: 'correlation-0001' }),
    'POLICY_UNAVAILABLE'
  );
}

async function run(): Promise<void> {
  await testRevisionAndIntentContracts();
  await testEligibleBenefit();
  await testBenefitDenialStaysPaid();
  await testUnclassifiedBlockerIsUncertainty();
  await testParticipationBlocker();
  await testSelection();
  await testTechnicalFailures();
  console.log('lk2 shadow quote evaluator tests: OK');
}

async function testRevisionAndIntentContracts(): Promise<void> {
  const eligible = quoteResult({ eligible: true, benefit: {
    kind: 'FREE_ENTITLEMENT', ruleId: 'benefit:join', stationRuleId: 'station:home',
    basePriceMinor: 300_000, discountMinor: 300_000, surchargeMinor: 0, finalPriceMinor: 0,
    partialPriceCalculation: null, currency: 'RUB'
  } });
  for (const instances of [[], [instance()]]) {
   for (const paymentIntent of ['PAY_FULL_PRICE', 'USE_SUBSCRIPTION', 'AUTO_BEST_PRICE'] as const) {
    const calls = { quotes: 0, instances: 0, targets: 0 };
    const stale = await evaluator({ instances, target: { ...target, snapshotRevision: 8 }, quote: eligible, calls })
      .evaluate({ delegation, request: { ...request, paymentIntent }, correlationId: 'correlation-0001' });
    assert.equal(stale.outcome, 'PRICE_CONFIRMATION_REQUIRED');
    assert.equal(stale.serviceAllowed, false);
    assert.equal(stale.subscriptionBenefitAllowed, false);
    assert.equal(stale.benefit, null);
    assert.equal(stale.price?.priceRevision, 8);
    assert.equal(calls.quotes, 0);
    assert.equal(calls.instances, 0);
    assert.equal(calls.targets, 1);
   }
  }
  for (const instances of [[], [instance()], [instance(), instance('99999999-9999-4999-8999-999999999999')]]) {
    const calls = { quotes: 0, instances: 0, targets: 0 };
    const paid = await evaluator({ instances, quote: eligible, calls }).evaluate({ delegation,
      request: { ...request, paymentIntent: 'PAY_FULL_PRICE', preferredSubscriptionInstanceId: 'foreign:instance' }, correlationId: 'correlation-0001' });
    assert.equal(paid.outcome, 'FULL_PRICE_ONLY');
    assert.equal(paid.subscriptionBenefitAllowed, false);
    assert.equal(paid.benefit, null);
    assert.equal(paid.selectedSubscription, null);
    assert.equal(paid.price?.finalPriceMinor, 300_000);
    assert.equal(calls.instances, 0);
    assert.equal(calls.quotes, 0);
    assert.equal(calls.targets, 1);
  }
  for (const instances of [[], [instance()]]) {
    const denied = await evaluator({ instances, quote: quoteResult({ blockers: [{
      code: 'SUBSCRIPTION_EXPIRED', message: 'expired', details: null
    }] as never }) }).evaluate({ delegation, request: { ...request, paymentIntent: 'USE_SUBSCRIPTION' }, correlationId: 'correlation-0001' });
    assert.equal(denied.outcome, 'SERVICE_BLOCKED');
    assert.equal(denied.serviceAllowed, false);
    assert.equal(denied.subscriptionBenefitAllowed, false);
    assert.equal(denied.price, null);
    assert.deepEqual(denied.alternatives, [{ paymentIntent: 'PAY_FULL_PRICE', requiresExplicitUserConfirmation: true }]);
  }
  for (const mode of ['BLOCK', undefined, 'FULL_PRICE_WITHOUT_SUBSCRIPTION'] as const) {
    const denied = await evaluator({ quote: quoteResult({ activeServicesLimitExceeded: mode,
      blockers: [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED', message: 'limit', details: null }] as never
    }) }).evaluate({ delegation, request, correlationId: 'correlation-0001' });
    assert.equal(denied.serviceAllowed, mode === 'FULL_PRICE_WITHOUT_SUBSCRIPTION');
    assert.equal(denied.outcome, mode === 'FULL_PRICE_WITHOUT_SUBSCRIPTION' ? 'FULL_PRICE_ONLY' : 'SERVICE_BLOCKED');
  }
  for (const paymentIntent of ['PAY_FULL_PRICE', 'USE_SUBSCRIPTION', 'AUTO_BEST_PRICE'] as const) {
    await expectUnavailable(evaluator({ instances: [], resolverError: new Error('unavailable') })
      .evaluate({ delegation, request: { ...request, paymentIntent }, correlationId: 'correlation-0001' }), 'TARGET_STALE');
  }
  const noRevision = await evaluator({ quote: eligible }).evaluate({ delegation,
    request: { ...request, target: { kind: 'GAME', id: target.targetId! } }, correlationId: 'correlation-0001' });
  assert.equal(noRevision.outcome, 'ENTITLEMENT_APPLIED');
  const strictEligible = await evaluator({ quote: eligible }).evaluate({ delegation,
    request: { ...request, paymentIntent: 'USE_SUBSCRIPTION' }, correlationId: 'correlation-0001' });
  assert.equal(strictEligible.outcome, 'ENTITLEMENT_APPLIED');
  for (const paymentIntent of ['PAY_FULL_PRICE', 'USE_SUBSCRIPTION', 'AUTO_BEST_PRICE'] as const) {
    const started = await evaluator({ instances: [], target: { ...target, startsAt: '2026-10-21T08:00:00.000Z' } })
      .evaluate({ delegation, request: { ...request, paymentIntent }, correlationId: 'correlation-0001' });
    assert.equal(started.serviceAllowed, false);
    for (const badTarget of [{ ...target, basePriceMinor: null }, { ...target, currency: 'USD' }]) {
      await expectUnavailable(evaluator({ instances: [], target: badTarget as SubscriptionShadowQuoteResolvedTarget })
        .evaluate({ delegation, request: { ...request, paymentIntent }, correlationId: 'correlation-0001' }), 'PRICE_UNAVAILABLE');
    }
    const multiple = await evaluator({ instances: [instance(), instance('99999999-9999-4999-8999-999999999999')] })
      .evaluate({ delegation, request: { ...request, paymentIntent }, correlationId: 'correlation-0001' });
    assert.equal(multiple.outcome, paymentIntent === 'PAY_FULL_PRICE' ? 'FULL_PRICE_ONLY' : 'SUBSCRIPTION_SELECTION_REQUIRED');
    assert.equal(multiple.serviceAllowed, paymentIntent === 'PAY_FULL_PRICE');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
