import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signValue,
  type KeyObject
} from 'node:crypto';
import {
  computeSubscriptionRuntimeIdempotencyKeyHash,
  computeSubscriptionRuntimeQuoteRequestHash,
  SubscriptionRuntimeLk2DelegationVerifierService
} from '../src/subscriptions/subscription-runtime-lk2-delegation-verifier.service';

const NOW = new Date('2026-08-24T12:00:00.000Z');
const ISSUER = 'https://api.padlhub.invalid/subscription-runtime-delegation';
const AUDIENCE = 'urn:padlhub:ph-admin:subscription-runtime:v1';
const KID = 'subscription-runtime-delegation-test-1';
const TENANT_ID = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const MAPPING_ID = '33333333-3333-4333-8333-333333333333';
const JTI = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'lk2-runtime-integration-token-20260824';
const CORRELATION_ID = 'correlation:lk2:quote:one';
const IDEMPOTENCY_KEY = 'idempotency:lk2:quote:one';

const request = {
  action: 'JOIN_GAME' as const,
  target: { kind: 'GAME' as const, id: 'game:one', expectedRevision: 7 },
  preferredSubscriptionInstanceId: 'subscription_instance:one',
  paymentIntent: 'USE_SUBSCRIPTION' as const
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(
  privateKey: KeyObject,
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {}
): string {
  const nowSeconds = Math.floor(NOW.getTime() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'phub-subscription-runtime-actor-delegation+jwt',
    kid: KID,
    ...headerOverrides
  };
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: USER_ID,
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + 30,
    jti: JTI,
    contract_version: 1,
    scope: 'subscription-runtime.quote',
    tenant_id: TENANT_ID,
    tenant_key: 'local-padel',
    sid: SESSION_ID,
    provider: 'VIVA',
    provider_client_id: 'viva-profile:one',
    provider_mapping_id: MAPPING_ID,
    action: request.action,
    correlation_id: CORRELATION_ID,
    request_sha256: computeSubscriptionRuntimeQuoteRequestHash(request),
    idempotency_key_sha256: computeSubscriptionRuntimeIdempotencyKeyHash(IDEMPOTENCY_KEY),
    ...overrides
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = signValue('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: any) => error?.response?.code === code);
}

async function run(): Promise<void> {
  const original = { ...process.env };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER = ISSUER;
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE = AUDIENCE;
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON = JSON.stringify({
    keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }]
  });
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS = '60';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS = '5';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON = JSON.stringify({
    'local-padel': { lk2TenantId: TENANT_ID, runtimeTenantId: 'tenant:one' }
  });
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:one';

  const consumed = new Set<string>();
  const repository = {
    connect: async () => undefined,
    consumeRuntimeDelegationReplay: async (input: { issuer: string; jti: string }) => {
      const key = `${input.issuer}\0${input.jti}`;
      if (consumed.has(key)) return 'REPLAY' as const;
      consumed.add(key);
      return 'CONSUMED' as const;
    }
  };
  const service = new SubscriptionRuntimeLk2DelegationVerifierService(repository as any);
  (service as any).now = () => new Date(NOW);
  const verify = (actorDelegation: string, overrides: Record<string, unknown> = {}) => service.verify({
    actorDelegation,
    integrationToken: TOKEN,
    request,
    correlationId: CORRELATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    contractVersion: '1',
    ...overrides
  });

  const actor = await verify(token(privateKey));
  assert.deepEqual(actor, {
    source: 'LK2_DELEGATION',
    runtimeTenantId: 'tenant:one',
    actorUserId: USER_ID,
    provider: 'VIVA',
    providerClientId: 'viva-profile:one',
    evidenceRef: actor.evidenceRef,
    verifiedAt: NOW.toISOString()
  });
  assert.match(actor.evidenceRef, /^evidence:lk2-delegation:[a-f0-9]{64}$/);

  await expectCode(verify(token(privateKey)), 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_REPLAYED');
  consumed.clear();
  await expectCode(
    verify(token(privateKey), { authorization: 'Bearer general-session-jwt' }),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, { aud: 'other-audience' })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, { action: 'CREATE_GAME' })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, { request_sha256: `sha256:${'0'.repeat(64)}` })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, { exp: Math.floor(NOW.getTime() / 1000) + 61 })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, {
      exp: Math.floor(NOW.getTime() / 1000),
      jti: '55555555-5555-4555-8555-555555555555'
    })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    verify(token(privateKey, {
      exp: Math.floor(NOW.getTime() / 1000) - 1,
      jti: '66666666-6666-4666-8666-666666666666'
    })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  const expiresOneSecondLater = await verify(token(privateKey, {
    exp: Math.floor(NOW.getTime() / 1000) + 1,
    jti: '77777777-7777-4777-8777-777777777777'
  }));
  assert.equal(expiresOneSecondLater.actorUserId, USER_ID);
  await expectCode(
    verify(token(privateKey, {}, { jku: 'https://attacker.invalid/jwks' })),
    'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
  );
  await expectCode(
    service.verify({
      actorDelegation: token(privateKey),
      integrationToken: 'wrong-token-value-that-is-long-enough',
      request,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      contractVersion: '1'
    }),
    'SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_FORBIDDEN'
  );

  process.env.SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON = JSON.stringify({
    'local-padel': { lk2TenantId: TENANT_ID, runtimeTenantId: 'other-tenant' }
  });
  await expectCode(
    verify(token(privateKey)),
    'SUBSCRIPTIONS_RUNTIME_DELEGATION_TENANT_UNMAPPED'
  );

  process.env = original;
  console.log('subscriptions runtime LK2 delegation tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
