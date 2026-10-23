import * as assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signMessage,
  type KeyObject,
} from 'node:crypto';
import {
  computeLk2IdempotencyKeySha256,
  computeLk2QuoteRequestSha256,
  loadLk2QuoteDelegationConfig,
  LK2_QUOTE_DELEGATION_TYP,
  Lk2QuoteDelegationError,
  verifyLk2QuoteDelegation,
  type Lk2QuoteDelegationConfig,
  type Lk2QuoteDelegationErrorCode,
  type Lk2QuoteRequestForDigest,
} from '../src/subscriptions/lk2-runtime/lk2-quote-delegation.verifier';

const tenantId = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const userId = '49d4e88c-7d52-4c1c-8f80-2fc99b42f9ca';
const sessionId = '55555555-5555-4555-8555-555555555555';
const mappingId = '66666666-6666-4666-8666-666666666666';
const JTI = '77777777-7777-4777-8777-777777777777';
const keyId = 'lk2-test-key-1';
const issuer = 'https://lk2.example.test';
const audience = 'ph-admin-subscription-runtime';
const now = 1_800_000_000;
const idempotencyKey = 'idem-key-0001';
const correlationId = 'lk2-quote-correlation-1';
const request: Lk2QuoteRequestForDigest = {
  action: 'JOIN_GAME',
  target: {
    kind: 'GAME',
    id: '11111111-1111-4111-8111-111111111111',
    expectedRevision: 7,
  },
  paymentIntent: 'AUTO_BEST_PRICE',
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: Lk2QuoteDelegationConfig = {
  keys: new Map([[keyId, publicKey]]),
  issuer,
  audience,
  tenantId,
  maxTtlSeconds: 60,
  clockToleranceSeconds: 5,
};

function basePayload(): Record<string, unknown> {
  return {
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
  };
}

function token(
  payload: Record<string, unknown>,
  options: {
    readonly key?: KeyObject;
    readonly header?: Record<string, unknown>;
  } = {},
): string {
  const header = options.header ?? { alg: 'RS256', typ: LK2_QUOTE_DELEGATION_TYP, kid: keyId };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signMessage(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    options.key ?? privateKey,
  ).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function expectCode(fn: () => unknown, code: Lk2QuoteDelegationErrorCode): void {
  try {
    fn();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof Lk2QuoteDelegationError, String(error));
    assert.equal(error.code, code);
  }
}

function verify(overrides: {
  readonly token?: string;
  readonly payload?: Record<string, unknown>;
  readonly request?: Lk2QuoteRequestForDigest;
  readonly idempotency?: string;
  readonly correlation?: string;
  readonly nowSeconds?: number;
  readonly config?: Lk2QuoteDelegationConfig;
}) {
  const payload = overrides.payload ?? basePayload();
  return verifyLk2QuoteDelegation({
    token: overrides.token ?? token(payload),
    config: overrides.config ?? config,
    request: overrides.request ?? request,
    idempotencyKey: overrides.idempotency ?? idempotencyKey,
    correlationId: overrides.correlation ?? correlationId,
    nowSeconds: overrides.nowSeconds ?? now,
  });
}

function testRequestDigestVector(): void {
  // Locks the canonical JSON key order shared with the LK2 issuer.
  assert.equal(
    computeLk2QuoteRequestSha256(request),
    'sha256:42e621fa429e703adfa9b66416839a12d54215e44213b41f74225fa5c67f5a9f',
  );
  assert.equal(
    computeLk2IdempotencyKeySha256(idempotencyKey),
    'sha256:f571395684beeb0116e04bf6fe2579ce9fc7d17906d3ffd6f9e16f9e0e2b89b3',
  );
}

function testValidDelegation(): void {
  const verified = verify({});
  assert.equal(verified.userId, userId);
  assert.equal(verified.tenantId, tenantId);
  assert.equal(verified.providerMappingId, mappingId);
  assert.equal(verified.action, 'JOIN_GAME');
  assert.equal(verified.jti, JTI);
  assert.equal(verified.requestSha256, computeLk2QuoteRequestSha256(request));
}

function testConfiguration(): void {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const baseEnv = {
    SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: JSON.stringify({ [keyId]: pem }),
    SUBSCRIPTIONS_LK2_DELEGATION_ISSUER: issuer,
    SUBSCRIPTIONS_LK2_DELEGATION_AUDIENCE: audience,
    SUBSCRIPTIONS_LK2_DELEGATION_TENANT_ID: tenantId,
  };
  const loaded = loadLk2QuoteDelegationConfig(baseEnv);
  assert.equal(loaded.keys.size, 1);
  assert.equal(loaded.maxTtlSeconds, 60);
  for (const env of [
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: '' },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: '{}' },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: 'not-json' },
    {
      ...baseEnv,
      SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: JSON.stringify({
        [keyId]: 'not-a-pem',
      }),
    },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_TENANT_ID: 'not-a-uuid' },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_MAX_TTL_SECONDS: '5' },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_MAX_TTL_SECONDS: '3600' },
    { ...baseEnv, SUBSCRIPTIONS_LK2_DELEGATION_ISSUER: 'bad issuer with spaces' },
  ]) {
    expectCode(
      () => loadLk2QuoteDelegationConfig({ ...env } as NodeJS.ProcessEnv),
      'LK2_DELEGATION_CONFIGURATION_INVALID',
    );
  }
  const shortKey = generateKeyPairSync('rsa', { modulusLength: 1024 });
  expectCode(
    () =>
      loadLk2QuoteDelegationConfig({
        ...baseEnv,
        SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS: JSON.stringify({
          [keyId]: shortKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        }),
      } as NodeJS.ProcessEnv),
    'LK2_DELEGATION_CONFIGURATION_INVALID',
  );
}

function testSignatureAndHeader(): void {
  expectCode(
    () => verify({ token: token(basePayload(), { key: otherKeys.privateKey }) }),
    'LK2_DELEGATION_SIGNATURE_INVALID',
  );
  expectCode(
    () => verify({ token: token(basePayload(), { header: { alg: 'RS512', typ: LK2_QUOTE_DELEGATION_TYP, kid: keyId } }) }),
    'LK2_DELEGATION_TOKEN_INVALID',
  );
  expectCode(
    () => verify({ token: token(basePayload(), { header: { alg: 'RS256', typ: 'JWT', kid: keyId } }) }),
    'LK2_DELEGATION_TOKEN_INVALID',
  );
  expectCode(
    () => verify({ token: token(basePayload(), { header: { alg: 'RS256', typ: LK2_QUOTE_DELEGATION_TYP, kid: 'unknown-key' } }) }),
    'LK2_DELEGATION_KEY_UNKNOWN',
  );
  expectCode(
    () => verify({ token: `${token(basePayload())}.extra` }),
    'LK2_DELEGATION_TOKEN_INVALID',
  );
}

function testTimeBounds(): void {
  expectCode(
    () => verify({ token: token({ ...basePayload(), iat: now - 30, nbf: now - 30, exp: now - 10 }) }),
    'LK2_DELEGATION_EXPIRED',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), nbf: now + 60 }) }),
    'LK2_DELEGATION_NOT_YET_VALID',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), exp: now + 61 }) }),
    'LK2_DELEGATION_TTL_INVALID',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), exp: now }) }),
    'LK2_DELEGATION_TTL_INVALID',
  );
  // Clock tolerance is bounded and applied symmetrically.
  assert.equal(
    verify({ token: token({ ...basePayload(), iat: now - 30, nbf: now - 30, exp: now - 3 }), nowSeconds: now }).jti,
    JTI,
  );
}

function testClaimBinding(): void {
  expectCode(
    () => verify({ token: token({ ...basePayload(), iss: 'https://other.example.test' }) }),
    'LK2_DELEGATION_ISSUER_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), aud: 'other-audience' }) }),
    'LK2_DELEGATION_AUDIENCE_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), scope: 'subscription-runtime.booked-operation.admit' }) }),
    'LK2_DELEGATION_SCOPE_INVALID',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), contract_version: 2 }) }),
    'LK2_DELEGATION_SCOPE_INVALID',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), provider: 'OTHER' }) }),
    'LK2_DELEGATION_SCOPE_INVALID',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), tenant_id: '99999999-9999-4999-8999-999999999999' }) }),
    'LK2_DELEGATION_TENANT_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), action: 'CREATE_GAME' }) }),
    'LK2_DELEGATION_ACTION_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), correlation_id: 'other-correlation-1' }) }),
    'LK2_DELEGATION_CORRELATION_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), request_sha256: `sha256:${'0'.repeat(64)}` }) }),
    'LK2_DELEGATION_REQUEST_DIGEST_MISMATCH',
  );
  expectCode(
    () => verify({ token: token({ ...basePayload(), idempotency_key_sha256: `sha256:${'0'.repeat(64)}` }) }),
    'LK2_DELEGATION_IDEMPOTENCY_DIGEST_MISMATCH',
  );
  // A valid token cannot be redirected to another request or idempotency key.
  expectCode(
    () => verify({ request: { ...request, target: { ...request.target, expectedRevision: 8 } } }),
    'LK2_DELEGATION_REQUEST_DIGEST_MISMATCH',
  );
  expectCode(() => verify({ idempotency: 'idem-key-0002' }), 'LK2_DELEGATION_IDEMPOTENCY_DIGEST_MISMATCH');
  expectCode(() => verify({ correlation: 'other-correlation-2' }), 'LK2_DELEGATION_CORRELATION_MISMATCH');
}

function testTokenShape(): void {
  for (const bad of [
    'not-a-token',
    'a.b',
    'a.b.c.d',
    '..',
    `${Buffer.from('{}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`,
  ]) {
    expectCode(() => verify({ token: bad }), 'LK2_DELEGATION_TOKEN_INVALID');
  }
  const payload = basePayload();
  delete payload.sid;
  expectCode(() => verify({ token: token(payload) }), 'LK2_DELEGATION_TOKEN_INVALID');
  expectCode(
    () => verify({ token: token({ ...basePayload(), extra: true }) }),
    'LK2_DELEGATION_TOKEN_INVALID',
  );
}

async function run(): Promise<void> {
  testRequestDigestVector();
  testValidDelegation();
  testConfiguration();
  testSignatureAndHeader();
  testTimeBounds();
  testClaimBinding();
  testTokenShape();
  console.log('lk2 quote delegation verifier tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
