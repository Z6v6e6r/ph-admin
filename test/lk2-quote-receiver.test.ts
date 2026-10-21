import * as assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signMessage } from 'node:crypto';
import { Lk2QuoteController } from '../src/subscriptions/lk2-runtime/lk2-quote.controller';
import {
  InMemoryLk2QuoteDelegationReplayStore,
  Lk2QuoteEvaluationUnavailable,
  Lk2QuoteReceiverError,
  Lk2QuoteReceiverService,
  parseLk2QuoteRequest,
  type Lk2QuoteEvaluator,
} from '../src/subscriptions/lk2-runtime/lk2-quote-receiver.service';
import {
  computeLk2IdempotencyKeySha256,
  computeLk2QuoteRequestSha256,
  LK2_QUOTE_DELEGATION_TYP,
  type Lk2QuoteDelegationConfig,
} from '../src/subscriptions/lk2-runtime/lk2-quote-delegation.verifier';

const tenantId = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const userId = '49d4e88c-7d52-4c1c-8f80-2fc99b42f9ca';
const sessionId = '55555555-5555-4555-8555-555555555555';
const mappingId = '66666666-6666-4666-8666-666666666666';
const JTI = '77777777-7777-4777-8777-777777777777';
const keyId = 'lk2-test-key-1';
const issuer = 'https://lk2.example.test';
const audience = 'ph-admin-subscription-runtime';
const integrationToken = 'lk2-quote-integration-token-0123456789';
const idempotencyKey = 'idem-key-0001';
const correlationId = 'lk2-quote-correlation-1';
const request = {
  action: 'JOIN_GAME' as const,
  target: {
    kind: 'GAME' as const,
    id: '11111111-1111-4111-8111-111111111111',
    expectedRevision: 7,
  },
  paymentIntent: 'AUTO_BEST_PRICE' as const,
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: Lk2QuoteDelegationConfig = {
  keys: new Map([[keyId, publicKey]]),
  issuer,
  audience,
  tenantId,
  maxTtlSeconds: 60,
  clockToleranceSeconds: 5,
};

function delegationToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    contract_version: 1,
    correlation_id: correlationId,
    exp: now + 30,
    iat: now,
    idempotency_key_sha256: computeLk2IdempotencyKeySha256(idempotencyKey),
    iss: issuer,
    jti: JTI,
    nbf: now,
    provider: 'VIVA',
    provider_client_id: 'viva-client-1',
    provider_mapping_id: mappingId,
    request_sha256: computeLk2QuoteRequestSha256(request),
    scope: 'subscription-runtime.quote',
    sid: sessionId,
    sub: userId,
    tenant_id: tenantId,
    tenant_key: 'local-padel',
    action: 'JOIN_GAME',
    ...overrides,
  };
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: LK2_QUOTE_DELEGATION_TYP, kid: keyId }),
  ).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signMessage(
    'RSA-SHA256',
    Buffer.from(`${header}.${encodedPayload}`, 'utf8'),
    privateKey,
  ).toString('base64url');
  return `${header}.${encodedPayload}.${signature}`;
}

function evaluator(result?: Awaited<ReturnType<Lk2QuoteEvaluator['evaluate']>>): Lk2QuoteEvaluator {
  return {
    evaluate: async () => {
      if (result) return result;
      throw new Lk2QuoteEvaluationUnavailable('POLICY_UNAVAILABLE');
    },
  };
}

function receiver(
  overrides: Partial<{
    enabled: boolean;
    token: string;
    evaluator: Lk2QuoteEvaluator;
    replayStore: InMemoryLk2QuoteDelegationReplayStore;
  }> = {},
): Lk2QuoteReceiverService {
  return new Lk2QuoteReceiverService({
    enabled: overrides.enabled ?? true,
    integrationToken: overrides.token ?? integrationToken,
    delegationConfig: config,
    replayStore: overrides.replayStore ?? new InMemoryLk2QuoteDelegationReplayStore(),
    evaluator: overrides.evaluator ?? evaluator(),
  });
}

async function expectReceiverError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Lk2QuoteReceiverError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

function envelope(values: Partial<{
  integrationToken: string;
  actorDelegation: string;
  contractVersion: string;
  idempotencyKey: string;
  correlationId: string;
  body: unknown;
}> = {}) {
  return {
    integrationToken: values.integrationToken ?? integrationToken,
    actorDelegation: values.actorDelegation ?? delegationToken(),
    contractVersion: values.contractVersion ?? '1',
    idempotencyKey: values.idempotencyKey ?? idempotencyKey,
    correlationId: values.correlationId ?? correlationId,
    body: values.body ?? request,
  };
}

async function testUncertaintyIsNotAnAllow(): Promise<void> {
  const outcome = await receiver().receive(envelope());
  assert.equal(outcome.contractVersion, 1);
  assert.equal(outcome.nonBinding, true);
  assert.equal(outcome.requiresReservationRecheck, true);
  assert.equal(outcome.outcome, 'RETRY_LATER');
  assert.equal(outcome.serviceAllowed, false);
  assert.equal(outcome.subscriptionBenefitAllowed, false);
  assert.equal(outcome.selectedSubscription, null);
  assert.equal(outcome.price, null);
  assert.deepEqual(outcome.blockers, [{ code: 'POLICY_UNAVAILABLE' }]);
  assert.deepEqual(Object.keys(outcome.limits).sort(), [
    'activeServices',
    'activeServicesLimit',
    'dailyLimit',
    'dailyUsed',
    'monthlyLimit',
    'monthlyUsed',
    'remainingUnits',
    'weeklyLimit',
    'weeklyUsed',
  ]);
  assert.ok(Date.parse(outcome.expiresAt) > Date.parse(outcome.evaluatedAt));
}

async function testEvaluationMapping(): Promise<void> {
  const outcome = await receiver({
    evaluator: evaluator({
      outcome: 'ENTITLEMENT_APPLIED',
      serviceAllowed: true,
      subscriptionBenefitAllowed: true,
      selectedSubscription: {
        subscriptionInstanceId: 'subscription_instance:1',
        policyVersion: 3,
        policyDigest: `sha256:${'a'.repeat(64)}`,
      },
      benefit: { kind: 'FREE_ENTITLEMENT', ruleId: 'join-free', usageUnits: 1 },
      price: {
        priceRevision: 7,
        basePriceMinor: 300000,
        discountMinor: 300000,
        surchargeMinor: 0,
        finalPriceMinor: 0,
        currency: 'RUB',
      },
      limits: {
        activeServices: 1,
        activeServicesLimit: 8,
        dailyUsed: 0,
        dailyLimit: 1,
        weeklyUsed: null,
        weeklyLimit: null,
        monthlyUsed: null,
        monthlyLimit: null,
        remainingUnits: null,
      },
      blockers: [],
      warnings: [],
      alternatives: [],
    }),
  }).receive(envelope());
  assert.equal(outcome.outcome, 'ENTITLEMENT_APPLIED');
  assert.equal(outcome.serviceAllowed, true);
  assert.equal(outcome.benefit?.ruleId, 'join-free');
  assert.equal(outcome.price?.finalPriceMinor, 0);
}

async function testReplayAndAuth(): Promise<void> {
  const service = receiver();
  await service.receive(envelope());
  await expectReceiverError(
    service.receive(envelope()),
    409,
    'LK2_QUOTE_DELEGATION_REPLAYED',
  );
  await expectReceiverError(
    receiver().receive(envelope({ integrationToken: 'wrong-integration-token-0123456789' })),
    403,
    'SUBSCRIPTION_RUNTIME_LK2_QUOTE_FORBIDDEN',
  );
  await expectReceiverError(
    receiver({ enabled: false }).receive(envelope()),
    503,
    'SUBSCRIPTION_RUNTIME_LK2_QUOTE_DISABLED',
  );
  await expectReceiverError(
    receiver().receive(envelope({ contractVersion: '2' })),
    400,
    'LK2_QUOTE_ENVELOPE_INVALID',
  );
  await expectReceiverError(
    receiver().receive(envelope({ body: { action: 'OTHER' } })),
    400,
    'LK2_QUOTE_REQUEST_INVALID',
  );
  await expectReceiverError(
    receiver().receive(
      envelope({ actorDelegation: delegationToken({ request_sha256: `sha256:${'0'.repeat(64)}` }) }),
    ),
    403,
    'LK2_QUOTE_DELEGATION_REJECTED',
  );
}

function testParseRequest(): void {
  assert.deepEqual(parseLk2QuoteRequest(request), request);
  for (const invalid of [
    null,
    [],
    { ...request, extra: true },
    { ...request, action: 'BOOK_TOURNAMENT' },
    { ...request, target: { ...request.target, kind: 'TRAINING' } },
    { ...request, target: { ...request.target, id: 'x' } },
    { ...request, paymentIntent: 'FREE' },
    { ...request, preferredSubscriptionInstanceId: 'x' },
  ]) {
    assert.throws(
      () => parseLk2QuoteRequest(invalid),
      (error: unknown) =>
        error instanceof Lk2QuoteReceiverError && error.code === 'LK2_QUOTE_REQUEST_INVALID',
    );
  }
}

async function testControllerBoundary(): Promise<void> {
  const controller = new Lk2QuoteController(receiver());
  const outcome = await controller.quote(
    integrationToken,
    delegationToken(),
    '1',
    idempotencyKey,
    correlationId,
    request,
  );
  assert.equal(outcome.outcome, 'RETRY_LATER');

  const disabled = new Lk2QuoteController(receiver({ enabled: false }));
  await assert.rejects(
    () =>
      disabled.quote(integrationToken, delegationToken(), '1', idempotencyKey, correlationId, request),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const http = error as { getStatus?: () => number; getResponse?: () => unknown };
      assert.equal(http.getStatus?.(), 503);
      const response = http.getResponse?.() as { code?: string };
      assert.equal(response.code, 'SUBSCRIPTION_RUNTIME_LK2_QUOTE_DISABLED');
      return true;
    },
  );
}

async function run(): Promise<void> {
  testParseRequest();
  await testUncertaintyIsNotAnAllow();
  await testEvaluationMapping();
  await testReplayAndAuth();
  await testControllerBoundary();
  console.log('lk2 quote receiver tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
