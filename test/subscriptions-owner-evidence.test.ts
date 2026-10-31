import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createOwnerEvidence,
  createOwnerReleaseEvidence,
  verifyOwnerReleaseEvidence,
  type OwnerReleaseEvidenceClaims,
  loadOwnerEvidenceConfig,
  OwnerEvidenceError,
  verifyOwnerEvidence,
  type OwnerEvidenceErrorCode,
} from '../src/subscriptions/owner-evidence.verifier';

const NOW = '2026-09-01T09:00:00.000Z';
const SECRET = 'owner-evidence-shared-secret-0123456789';
const OPERATION = 'booking:operation-1';
const BOOKING = 'booking:viva-1';

const config = { secret: SECRET, maxAgeSeconds: 60 };
const now = new Date(NOW);

function expectCode(fn: () => unknown, code: OwnerEvidenceErrorCode): void {
  try {
    fn();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof OwnerEvidenceError, String(error));
    assert.equal(error.code, code);
  }
}

function evidence(overrides: Partial<{ operationId: string; providerBookingId: string; issuedAt: string }> = {}) {
  return createOwnerEvidence(
    {
      operationId: OPERATION,
      providerBookingId: BOOKING,
      issuedAt: NOW,
      ...overrides,
    },
    SECRET,
  );
}

function testCreateAndVerify(): void {
  const token = evidence();
  const claims = verifyOwnerEvidence({
    evidence: token,
    config,
    operationId: OPERATION,
    providerBookingId: BOOKING,
    now,
  });
  assert.deepEqual(claims, {
    operationId: OPERATION,
    providerBookingId: BOOKING,
    issuedAt: NOW,
  });
  assert.equal(token.startsWith('v1.'), true);
}

function testBindingAndSignature(): void {
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: evidence({ operationId: 'booking:operation-2' }),
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now,
      }),
    'OWNER_EVIDENCE_BINDING_MISMATCH',
  );
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: evidence({ providerBookingId: 'booking:viva-2' }),
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now,
      }),
    'OWNER_EVIDENCE_BINDING_MISMATCH',
  );
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: evidence(),
        config: { ...config, secret: 'different-shared-secret-0123456789' },
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now,
      }),
    'OWNER_EVIDENCE_SIGNATURE_INVALID',
  );
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: undefined,
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now,
      }),
    'OWNER_EVIDENCE_REQUIRED',
  );
}

function testFreshness(): void {
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: evidence(),
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now: new Date(Date.parse(NOW) + 61_000),
      }),
    'OWNER_EVIDENCE_EXPIRED',
  );
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: evidence(),
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now: new Date(Date.parse(NOW) - 61_000),
      }),
    'OWNER_EVIDENCE_EXPIRED',
  );
}

function testMalformed(): void {
  for (const bad of ['', 'v1', 'v2.x.y', 'v1..abc', 'v1.payload.not-hex']) {
    expectCode(
      () =>
        verifyOwnerEvidence({
          evidence: bad,
          config,
          operationId: OPERATION,
          providerBookingId: BOOKING,
          now,
        }),
      bad === '' ? 'OWNER_EVIDENCE_REQUIRED' : 'OWNER_EVIDENCE_MALFORMED',
    );
  }
  // A well-formed HMAC over a non-JSON payload is rejected before binding.
  const encoded = Buffer.from('not-json', 'utf8').toString('base64url');
  const signature = createOwnerEvidence(
    { operationId: OPERATION, providerBookingId: BOOKING, issuedAt: NOW },
    SECRET,
  ).split('.')[2];
  void signature;
  expectCode(
    () =>
      verifyOwnerEvidence({
        evidence: `v1.${encoded}.${'0'.repeat(64)}`,
        config,
        operationId: OPERATION,
        providerBookingId: BOOKING,
        now,
      }),
    'OWNER_EVIDENCE_SIGNATURE_INVALID',
  );
}

function testConfiguration(): void {
  assert.deepEqual(
    loadOwnerEvidenceConfig({
      SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: SECRET,
    } as NodeJS.ProcessEnv),
    { secret: SECRET, maxAgeSeconds: 60 },
  );
  for (const env of [
    {},
    { SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: 'short' },
    { SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: SECRET, SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS: '5' },
    { SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: SECRET, SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS: '999' },
  ]) {
    expectCode(
      () => loadOwnerEvidenceConfig({ ...env } as NodeJS.ProcessEnv),
      'OWNER_EVIDENCE_CONFIGURATION_INVALID',
    );
  }
  expectCode(
    () =>
      createOwnerEvidence(
        { operationId: 'x', providerBookingId: BOOKING, issuedAt: NOW },
        SECRET,
      ),
    'OWNER_EVIDENCE_MALFORMED',
  );
}

function testReleaseEvidence(): void {
  const claims: OwnerReleaseEvidenceClaims = {
    operationId: OPERATION,
    reason: 'BOOKING_CANCELLED',
    providerBookingId: BOOKING,
    issuedAt: NOW,
  };
  const token = createOwnerReleaseEvidence(claims, SECRET);
  const verify = (proof: string | undefined, overrides: Partial<Parameters<typeof verifyOwnerReleaseEvidence>[0]> = {}) =>
    verifyOwnerReleaseEvidence({ evidence: proof, config, ...claims, now, ...overrides });
  assert.deepEqual(verify(token), claims);
  const rejected = { ...claims, reason: 'PROVIDER_REJECTED' as const, providerBookingId: null };
  assert.deepEqual(verify(createOwnerReleaseEvidence(rejected, SECRET), rejected), rejected);
  // Signature domains are intentionally incompatible in both directions.
  expectCode(() => verify(evidence()), 'OWNER_EVIDENCE_MALFORMED');
  expectCode(() => verifyOwnerEvidence({ evidence: token, config, operationId: OPERATION, providerBookingId: BOOKING, now }), 'OWNER_EVIDENCE_MALFORMED');
  expectCode(() => verify(undefined), 'OWNER_EVIDENCE_REQUIRED');
  expectCode(() => verify(token, { operationId: 'booking:other' }), 'OWNER_EVIDENCE_BINDING_MISMATCH');
  expectCode(() => verify(token, { reason: 'PROVIDER_REJECTED' }), 'OWNER_EVIDENCE_BINDING_MISMATCH');
  expectCode(() => verify(token, { providerBookingId: 'booking:other' }), 'OWNER_EVIDENCE_BINDING_MISMATCH');
  expectCode(() => verify(token, { config: { ...config, secret: 'x'.repeat(40) } }), 'OWNER_EVIDENCE_SIGNATURE_INVALID');
  expectCode(() => verify(token, { now: new Date(Date.parse(NOW) + 60_001) }), 'OWNER_EVIDENCE_EXPIRED');
  expectCode(() => verify(token, { now: new Date(Date.parse(NOW) - 60_001) }), 'OWNER_EVIDENCE_EXPIRED');
  assert.deepEqual(verify(token, { now: new Date(Date.parse(NOW) + 60_000) }), claims);
  expectCode(() => verify(token, { now: new Date(NaN) }), 'OWNER_EVIDENCE_CONFIGURATION_INVALID');
  for (const malformed of ['release-v1..abc', 'release-v1.a.' + '0'.repeat(64), 'x'.repeat(2049)]) {
    expectCode(() => verify(malformed), malformed.startsWith('release-v1.a.') ? 'OWNER_EVIDENCE_SIGNATURE_INVALID' : 'OWNER_EVIDENCE_MALFORMED');
  }
  const rawProof = (json: string) => {
    const encoded = Buffer.from(json).toString('base64url');
    const mac = createHmac('sha256', SECRET).update(`owner-evidence:release:v1\0${encoded}`).digest('hex');
    return `release-v1.${encoded}.${mac}`;
  };
  for (const row of [
    { ...claims, reason: 'CONFIRMED' },
    { ...claims, providerBookingId: null },
    { ...claims, reason: 'PROVIDER_REJECTED' },
    { ...claims, tenantId: 'extra:claim' },
    { ...claims, operationId: 'bad id' },
    { ...claims, issuedAt: '2026-09-01' },
  ]) expectCode(() => verify(rawProof(JSON.stringify(row))), 'OWNER_EVIDENCE_MALFORMED');
  expectCode(() => verify(rawProof('not-json')), 'OWNER_EVIDENCE_MALFORMED');
  expectCode(() => verify(rawProof(JSON.stringify(claims).replace('{', '{"reason":"PROVIDER_REJECTED",'))), 'OWNER_EVIDENCE_MALFORMED');
  expectCode(() => verify(rawProof(' ' + JSON.stringify(claims))), 'OWNER_EVIDENCE_MALFORMED');
  const payload = Buffer.from(JSON.stringify({ ...claims, providerBookingId: 'booking:other' })).toString('base64url');
  expectCode(() => verify(`release-v1.${payload}.${token.split('.')[2]}`), 'OWNER_EVIDENCE_SIGNATURE_INVALID');
}

function run(): void {
  testCreateAndVerify();
  testBindingAndSignature();
  testFreshness();
  testMalformed();
  testConfiguration();
  testReleaseEvidence();
  console.log('subscriptions owner evidence tests: OK');
}

run();
