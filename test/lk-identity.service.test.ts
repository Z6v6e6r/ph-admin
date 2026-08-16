import * as assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  JsonWebKey,
  KeyObject,
  sign as signPayload
} from 'crypto';
import { LkIdentityService } from '../src/lk-identity/lk-identity.service';

const integrationToken = 'test-cup-integration-token-32-bytes-minimum';
const issuer = 'https://kc.vivacrm.ru/realms/clients';
const legacyIssuer = 'https://kc.vivacrm.ru/realms/prod';
const jwksUrl = `${issuer}/protocol/openid-connect/certs`;
const legacyJwksUrl = `${legacyIssuer}/protocol/openid-connect/certs`;

interface SigningFixture {
  kid: string;
  privateKey: KeyObject;
  jwk: JsonWebKey & { kid: string; alg: string; use: string };
}

function createSigningFixture(kid: string): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig'
    }
  };
}

function signToken(
  fixture: SigningFixture,
  overrides: Record<string, unknown> = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: fixture.kid }))
    .toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: 'keycloak-subject-1',
    aud: ['widget', 'account'],
    azp: 'widget',
    tenant_key: 'iSkq6G',
    phone_number: '+7 (900) 000-00-01',
    client_id: 'viva-client-1',
    name: 'Player One',
    iat: now - 5,
    exp: now + 300,
    ...overrides
  })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = signPayload('RSA-SHA256', Buffer.from(signingInput), fixture.privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const candidate = error as { getStatus?: () => number };
    return candidate.getStatus?.() === status;
  });
}

async function main(): Promise<void> {
  const envNames = [
    'LK_IDENTITY_INTEGRATION_TOKEN',
    'LK_IDENTITY_KEYCLOAK_ISSUER',
    'LK_IDENTITY_KEYCLOAK_JWKS_URL',
    'LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER',
    'LK_IDENTITY_LEGACY_KEYCLOAK_JWKS_URL',
    'LK_IDENTITY_LEGACY_EXPECTED_AUDIENCE',
    'LK_IDENTITY_LEGACY_EXPECTED_AUTHORIZED_PARTY',
    'LK_IDENTITY_EXPECTED_AUDIENCE',
    'LK_IDENTITY_EXPECTED_AUTHORIZED_PARTY',
    'LK_IDENTITY_EXPECTED_TENANT_KEY',
    'LK_IDENTITY_JWKS_FORCE_REFRESH_MIN_INTERVAL_MS'
  ];
  const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const keyA = createSigningFixture('key-a');
  const keyB = createSigningFixture('key-b');
  const legacyKey = createSigningFixture('legacy-key');
  const crossRealmKey = createSigningFixture(legacyKey.kid);
  let keys = [keyA.jwk];
  const legacyKeys = [legacyKey.jwk];
  const fetchCalls = new Map<string, number>();

  process.env.LK_IDENTITY_INTEGRATION_TOKEN = integrationToken;
  process.env.LK_IDENTITY_KEYCLOAK_ISSUER = issuer;
  process.env.LK_IDENTITY_KEYCLOAK_JWKS_URL = jwksUrl;
  process.env.LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER = legacyIssuer;
  process.env.LK_IDENTITY_LEGACY_KEYCLOAK_JWKS_URL = legacyJwksUrl;
  process.env.LK_IDENTITY_LEGACY_EXPECTED_AUDIENCE = 'widget';
  process.env.LK_IDENTITY_LEGACY_EXPECTED_AUTHORIZED_PARTY = 'widget';
  process.env.LK_IDENTITY_EXPECTED_AUDIENCE = 'widget';
  process.env.LK_IDENTITY_EXPECTED_AUTHORIZED_PARTY = 'widget';
  process.env.LK_IDENTITY_EXPECTED_TENANT_KEY = 'iSkq6G';
  process.env.LK_IDENTITY_JWKS_FORCE_REFRESH_MIN_INTERVAL_MS = '1000';
  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    fetchCalls.set(requestUrl, (fetchCalls.get(requestUrl) ?? 0) + 1);
    const responseKeys = requestUrl === jwksUrl
      ? keys
      : requestUrl === legacyJwksUrl
        ? legacyKeys
        : null;
    return new Response(JSON.stringify({ keys: responseKeys ?? [] }), {
      status: responseKeys ? 200 : 404,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const service = new LkIdentityService();
    const valid = await service.verify(bearer(signToken(keyA)), integrationToken);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.actor, {
      issuer,
      subject: 'keycloak-subject-1',
      clientId: 'viva-client-1',
      phoneNorm: '79000000001',
      name: 'Player One',
      tenantKey: 'iSkq6G',
      authorizedParty: 'widget',
      verified: true,
      source: 'cup-keycloak-jwt'
    });
    assert.equal(fetchCalls.get(jwksUrl), 1);

    const inProcessValid = await service.verifyTrustedBearer(bearer(signToken(keyA)));
    assert.equal(inProcessValid.actor.phoneNorm, '79000000001');
    assert.equal(
      fetchCalls.get(jwksUrl),
      1,
      'in-process verification uses the same signature and claims checks'
    );

    await service.verify(bearer(signToken(keyA)), integrationToken);
    assert.equal(fetchCalls.get(jwksUrl), 1, 'fresh clients JWKS cache avoids one call per poll');

    const legacyValid = await service.verify(
      bearer(signToken(legacyKey, { iss: legacyIssuer })),
      integrationToken
    );
    assert.equal(legacyValid.actor.issuer, legacyIssuer);
    assert.equal(legacyValid.actor.phoneNorm, '79000000001');
    assert.equal(fetchCalls.get(legacyJwksUrl), 1);

    await service.verify(
      bearer(signToken(legacyKey, { iss: legacyIssuer })),
      integrationToken
    );
    assert.equal(
      fetchCalls.get(legacyJwksUrl),
      1,
      'legacy prod issuer has an independent fresh JWKS cache'
    );

    keys = [keyB.jwk];
    const rotated = await service.verify(bearer(signToken(keyB)), integrationToken);
    assert.equal(rotated.actor.phoneNorm, '79000000001');
    assert.equal(fetchCalls.get(jwksUrl), 2, 'unknown kid refreshes only clients JWKS');
    assert.equal(fetchCalls.get(legacyJwksUrl), 1, 'clients rotation does not refresh prod JWKS');

    await expectStatus(
      service.verify(bearer(signToken(legacyKey, {
        iss: legacyIssuer,
        aud: 'other-client'
      })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(
        bearer(signToken(crossRealmKey, { iss: legacyIssuer })),
        integrationToken
      ),
      401
    );
    const fetchesBeforeUnknownIssuer = Array.from(fetchCalls.values())
      .reduce((total, count) => total + count, 0);
    await expectStatus(
      service.verify(bearer(signToken(keyB, {
        iss: 'https://untrusted.example/realms/other'
      })), integrationToken),
      401
    );
    assert.equal(
      Array.from(fetchCalls.values()).reduce((total, count) => total + count, 0),
      fetchesBeforeUnknownIssuer,
      'unknown issuers are rejected without an outbound JWKS request'
    );

    await expectStatus(
      service.verify(bearer(signToken(keyB, { aud: 'other-client' })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { iss: `${issuer}/other` })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { azp: 'other-client' })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { tenant_key: 'other-tenant' })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { exp: Math.floor(Date.now() / 1000) - 300 })), integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { exp: undefined })),
        integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { iat: undefined })),
        integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, { nbf: Math.floor(Date.now() / 1000) + 300 })),
        integrationToken),
      401
    );
    await expectStatus(
      service.verify(bearer(signToken(keyB, {
        phone_number: '79000000001',
        phone: '79000000002'
      })), integrationToken),
      401
    );
    await expectStatus(service.verify('Bearer not-a-jwt', integrationToken), 401);
    const forgedParts = signToken(keyB).split('.');
    forgedParts[2] = `${forgedParts[2][0] === 'A' ? 'B' : 'A'}${forgedParts[2].slice(1)}`;
    const forgedToken = forgedParts.join('.');
    await expectStatus(service.verifyTrustedBearer(bearer(forgedToken)), 401);
    await expectStatus(service.verify(bearer(signToken(keyB)), 'wrong-token'), 403);

    const keyWithoutClient = await service.verify(
      bearer(signToken(keyB, { client_id: undefined })),
      integrationToken
    );
    assert.equal(keyWithoutClient.actor.subject, 'keycloak-subject-1');
    assert.equal(keyWithoutClient.actor.clientId, undefined, 'sub is never promoted to Viva clientId');

    process.env.LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER = '';
    const fetchesBeforeDisabledLegacy = Array.from(fetchCalls.values())
      .reduce((total, count) => total + count, 0);
    const currentOnlyService = new LkIdentityService();
    await expectStatus(
      currentOnlyService.verify(
        bearer(signToken(legacyKey, { iss: legacyIssuer })),
        integrationToken
      ),
      401
    );
    assert.equal(
      Array.from(fetchCalls.values()).reduce((total, count) => total + count, 0),
      fetchesBeforeDisabledLegacy,
      'an empty legacy issuer disables prod compatibility without a JWKS request'
    );
    process.env.LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER = legacyIssuer;

    keys = [keyA.jwk];
    globalThis.fetch = async () => new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const rotationOutageService = new LkIdentityService();
    await rotationOutageService.verify(bearer(signToken(keyA)), integrationToken);
    globalThis.fetch = async () => {
      throw new Error('network unavailable');
    };
    await expectStatus(
      rotationOutageService.verify(bearer(signToken(keyB)), integrationToken),
      503
    );

    const unavailableService = new LkIdentityService();
    await expectStatus(
      unavailableService.verify(bearer(signToken(keyA)), integrationToken),
      503
    );

    console.log('LK identity verifier test passed');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
