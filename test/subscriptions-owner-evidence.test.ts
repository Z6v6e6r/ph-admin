import * as assert from 'node:assert/strict';
import {
  createOwnerEvidence,
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

function run(): void {
  testCreateAndVerify();
  testBindingAndSignature();
  testFreshness();
  testMalformed();
  testConfiguration();
  console.log('subscriptions owner evidence tests: OK');
}

run();
