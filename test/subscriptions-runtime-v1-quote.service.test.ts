import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { plainToInstance } from 'class-transformer';
import { SubscriptionRuntimeV1QuoteDto } from
  '../src/subscriptions/dto/subscription-runtime-v1-quote.dto';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionRuntimeV1QuoteService } from
  '../src/subscriptions/subscription-runtime-v1-quote.service';

const TOKEN = 'runtime-v1-integration-token-20260824';
const AUTHORIZATION = 'Bearer verified-user-token';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-08-24T10:00:00.000Z';

const request = (overrides: Record<string, unknown> = {}) => ({
  action: 'JOIN_GAME',
  target: { kind: 'GAME', id: 'game:one', expectedRevision: 4 },
  preferredSubscriptionInstanceId: 'subscription_instance:one',
  paymentIntent: 'USE_SUBSCRIPTION',
  ...overrides
});

const shadow = (overrides: Record<string, unknown> = {}) => ({
  quoteKind: 'SHADOW',
  nonBinding: true,
  requiresReservationRecheck: true,
  eligible: true,
  blockers: [],
  subscriptionInstanceId: 'subscription_instance:one',
  policyVersion: 3,
  policyDigest: DIGEST,
  aggregateRevision: 7,
  evaluatedAt: NOW,
  usageUnits: 1,
  activeServices: 0,
  maxActiveServices: 3,
  dailyUsed: 0,
  dailyLimit: 1,
  benefit: {
    kind: 'FREE_ENTITLEMENT',
    ruleId: 'rule:one',
    stationRuleId: 'station-rule:one',
    basePriceMinor: 400_000,
    discountMinor: 400_000,
    surchargeMinor: 0,
    finalPriceMinor: 0,
    partialPriceCalculation: null,
    currency: 'RUB'
  },
  decision: null,
  ...overrides
});

async function run(): Promise<void> {
  const original = { ...process.env };
  process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_V1_MODE = 'SHADOW';
  process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_TTL_SECONDS = '120';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:one';

  let identityCalls = 0;
  let adapterCalls = 0;
  let adapterResult = shadow();
  const identity = {
    verifyTrustedBearer: async (authorization: string | undefined) => {
      identityCalls += 1;
      assert.equal(authorization, AUTHORIZATION);
      return { actor: { tenantKey: 'tenant:one' } };
    }
  };
  const adapter = {
    quote: async (authorization: string | undefined, token: string | undefined, dto: unknown) => {
      adapterCalls += 1;
      assert.equal(authorization, AUTHORIZATION);
      assert.equal(token, TOKEN);
      assert.deepEqual(dto, {
        subscriptionInstanceId: 'subscription_instance:one',
        action: 'JOIN_GAME',
        target: { targetId: 'game:one', snapshotRevision: 4 }
      });
      return adapterResult;
    }
  };
  const service = new SubscriptionRuntimeV1QuoteService(adapter as any, identity as any);
  (service as any).now = () => new Date(NOW);

  const eligible = await service.quote(
    AUTHORIZATION,
    TOKEN,
    plainToInstance(SubscriptionRuntimeV1QuoteDto, request()),
    'correlation:one',
    'idempotency:one',
    '1'
  );
  assert.equal(eligible.outcome, 'ENTITLEMENT_APPLIED');
  assert.equal(eligible.price?.finalPriceMinor, 0);
  assert.equal(eligible.selectedSubscription?.policyDigest, DIGEST);
  assert.equal(eligible.expiresAt, '2026-08-24T10:02:00.000Z');

  adapterResult = shadow({
    eligible: false,
    blockers: [{ code: 'DAILY_USAGE_LIMIT_REACHED', message: 'safe', details: null }]
  });
  const fullPrice = await service.quote(
    AUTHORIZATION, TOKEN, request() as any, 'correlation:two', 'idempotency:two', '1'
  );
  assert.equal(fullPrice.outcome, 'FULL_PRICE_ONLY');
  assert.deepEqual(fullPrice.blockers, [{ code: 'DAILY_LIMIT_REACHED' }]);
  assert.equal(fullPrice.price?.finalPriceMinor, 400_000);
  assert.deepEqual(fullPrice.alternatives, [{
    paymentIntent: 'PAY_FULL_PRICE', requiresExplicitUserConfirmation: true
  }]);

  const explicitFullPrice = await service.quote(
    AUTHORIZATION,
    TOKEN,
    request({ paymentIntent: 'PAY_FULL_PRICE' }) as any,
    'correlation:three',
    'idempotency:three',
    '1'
  );
  assert.equal(explicitFullPrice.outcome, 'FULL_PRICE_ONLY');
  assert.deepEqual(explicitFullPrice.blockers, []);
  assert.deepEqual(explicitFullPrice.alternatives, []);

  const callsBeforeNoSelection = adapterCalls;
  const unresolvedRequest = request() as Record<string, unknown>;
  delete unresolvedRequest.preferredSubscriptionInstanceId;
  const unresolved = await service.quote(
    AUTHORIZATION,
    TOKEN,
    unresolvedRequest as any,
    'correlation:four',
    'idempotency:four',
    '1'
  );
  assert.equal(unresolved.outcome, 'RETRY_LATER');
  assert.deepEqual(unresolved.blockers, [{ code: 'PROVIDER_IDENTITY_UNAVAILABLE' }]);
  assert.equal(adapterCalls, callsBeforeNoSelection);

  const unsupported = await service.quote(
    AUTHORIZATION,
    TOKEN,
    request({
      action: 'CANCEL_BOOKING',
      target: { kind: 'BOOKING', id: 'booking:one', expectedRevision: 2 }
    }) as any,
    'correlation:five',
    'idempotency:five',
    '1'
  );
  assert.equal(unsupported.outcome, 'RETRY_LATER');
  assert.deepEqual(unsupported.blockers, [{ code: 'TARGET_NOT_SERVER_RESOLVED' }]);

  await assert.rejects(
    service.quote(
      AUTHORIZATION,
      TOKEN,
      { ...request(), browserPriceMinor: 1 } as any,
      'correlation:six',
      'idempotency:six',
      '1'
    ),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_RUNTIME_SHAPE_INVALID'
  );
  await assert.rejects(
    service.quote(AUTHORIZATION, 'wrong-token', request() as any, 'correlation:seven', 'idempotency:seven', '1'),
    (error: any) => error?.response?.code === 'SUBSCRIPTIONS_RUNTIME_V1_INTEGRATION_FORBIDDEN'
  );
  process.env.SUBSCRIPTIONS_RUNTIME_V1_MODE = 'ENFORCE';
  await assert.rejects(
    service.quote(AUTHORIZATION, TOKEN, request() as any, 'correlation:eight', 'idempotency:eight', '1'),
    (error: any) => error?.response?.code === 'SUBSCRIPTIONS_RUNTIME_V1_MODE_DISABLED'
  );
  process.env.SUBSCRIPTIONS_RUNTIME_V1_MODE = 'SHADOW';

  await assert.rejects(
    service.quote(
      AUTHORIZATION,
      TOKEN,
      request() as any,
      'correlation:nine',
      'idempotency:nine',
      '2'
    ),
    (error: any) => error?.response?.code === 'SUBSCRIPTIONS_RUNTIME_V1_HEADERS_INVALID'
  );

  const controllerSource = fs.readFileSync('src/subscriptions/subscriptions.controller.ts', 'utf8');
  assert.match(controllerSource, /@Controller\('internal\/subscription-runtime'\)[\s\S]*@Post\('quote'\)/);
  assert.match(controllerSource, /x-subscription-runtime-contract-version/);
  assert.doesNotMatch(JSON.stringify(eligible), /verified-user-token|runtime-v1-integration-token/);
  assert.ok(identityCalls >= 5);
  process.env = original;
  console.log('subscriptions runtime v1 quote service tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
