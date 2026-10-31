import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { CanonicalTargetIntakeService } from '../src/subscriptions/canonical-target-intake.service';
import { CanonicalTargetIntakeController } from '../src/subscriptions/canonical-target-intake.controller';
import { SubscriptionTrustedShadowAdapterService, computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { quarterFixture, quarterIntakeBody, QUARTER_NOW, QUARTER_TOKEN, QuarterLifecycle } from './subscriptions-create-quarter.test';

const TENANT = 'iSkq6G';
const AUTH = 'Bearer synthetic-actor-not-a-real-token';
const PEPPER = 'synthetic-test-only-identity-pepper-32';
const settings = {
  SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true', SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED: 'true',
  SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true', SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED: 'true',
  SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED: 'true', SUBSCRIPTIONS_TARGET_INGEST_ENABLED: 'true',
  SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN: QUARTER_TOKEN,
  SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN: QUARTER_TOKEN,
  SUBSCRIPTIONS_RUNTIME_TENANT_ID: TENANT, SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: PEPPER,
  SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS: '60'
};
class TrustedIdentity extends SubscriptionTrustedShadowAdapterService {
  protected now(): Date { return new Date(QUARTER_NOW); }
}
function fixture() {
  const f = quarterFixture();
  f.state.instance.tenantId = TENANT;
  f.state.mapping.tenantId = TENANT;
  f.state.mapping.providerScope = { kind: 'TENANT', scopeId: TENANT };
  f.state.instance.clientRefHash = computeSubscriptionClientRefHash({
    pepper: PEPPER, tenantId: TENANT, providerClientId: f.state.instance.providerClientId
  });
  const actor = { tenantKey: TENANT, clientId: f.state.instance.providerClientId,
    issuer: 'synthetic-issuer', subject: 'synthetic-subject' };
  let verified = 0;
  const trusted = new TrustedIdentity({
    verifyTrustedBearer: async (value: unknown) => {
      verified++;
      if (value !== AUTH) throw new Error('SYNTHETIC_UNAUTHENTICATED');
      return { actor };
    }
  } as any, f.quote, f.resolver);
  const intake = new CanonicalTargetIntakeService(f.repo as any, trusted);
  const { clientRefHash: _privateHash, ...original } = quarterIntakeBody();
  const body = { ...original, contractVersion: 3, subscriptionInstanceId: f.state.instance.subscriptionInstanceId };
  const ingest = (input: unknown = body, authorizationHeader: string | undefined = AUTH, token = QUARTER_TOKEN) =>
    intake.ingest(token, input, { authorizationHeader, now: () => new Date(QUARTER_NOW) });
  return { ...f, intake, actor, body, ingest, trusted, verified: () => verified };
}
async function main() {
  const before = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]));
  Object.assign(process.env, settings);
  let cases = 0;
  try {
    const f = fixture();
    const result = await f.ingest();
    assert.equal(result.replay, false);
    assert.equal(f.state.snapshots[0].tenantId, TENANT);
    assert.equal(f.state.snapshots[0].createQuarter?.binding.clientRefHash, f.state.instance.clientRefHash);
    assert.equal((await f.ingest()).replay, true);
    assert.equal(f.state.snapshots.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /clientRefHash|tenantId|providerClientId|pepper|Bearer/);
    const lifecycle = new QuarterLifecycle(f.trusted, f.quote, f.repo as any);
    const preflight = await lifecycle.preflight(AUTH, QUARTER_TOKEN, f.request);
    assert.equal(preflight.expectations.createQuarter?.clientRefHash, f.state.instance.clientRefHash);
    assert.equal(preflight.expectations.targetSnapshot.snapshotId, result.snapshotId);
    assert.equal(f.state.operations.length, 0); // Intake/preflight cannot reserve, charge or book.
    cases++;

    for (const patch of [
      { clientRefHash: 'a'.repeat(64) }, { tenantId: TENANT }, { tenant_id: TENANT },
      { state: 'REVOKED' }, { subscriptionInstanceId: 'bad\n' }, { contractVersion: 4 },
      { catalogue: { ...f.body.catalogue, roomIds: [] } },
      { price: { ...f.body.price, amountMinor: 1 } }
    ]) {
      const x = fixture();
      await assert.rejects(x.ingest({ ...x.body, ...patch }));
      assert.equal(x.state.snapshots.length, 0); assert.equal(x.state.operations.length, 0);
      cases++;
    }
    for (const change of [
      (x: ReturnType<typeof fixture>) => { x.actor.tenantKey = 'foreign-tenant'; },
      (x: ReturnType<typeof fixture>) => { x.actor.clientId = 'foreign-client'; },
      (x: ReturnType<typeof fixture>) => { x.state.instance.tenantId = 'foreign-tenant'; },
      (x: ReturnType<typeof fixture>) => { x.state.instance.state = 'PENDING_ACTIVATION'; },
      (x: ReturnType<typeof fixture>) => { x.state.instance.policyDigest = `sha256:${'f'.repeat(64)}`; },
      (x: ReturnType<typeof fixture>) => { x.state.mapping.providerProductId = 'foreign-product'; },
      (x: ReturnType<typeof fixture>) => { x.state.instance.reconciliation.asOf = '2026-08-15T00:00:00.000Z'; },
      (x: ReturnType<typeof fixture>) => { x.state.mapping.verifiedAt = '2026-08-19T00:00:00.000Z'; },
      (x: ReturnType<typeof fixture>) => { x.state.publication.state = 'DISABLED_FOR_NEW_OPERATIONS'; }
    ]) {
      const x = fixture(); change(x);
      await assert.rejects(x.ingest()); assert.equal(x.state.snapshots.length, 0); cases++;
    }
    const badAuth = fixture();
    await assert.rejects(badAuth.ingest(badAuth.body, 'Bearer foreign'));
    assert.equal(badAuth.state.connections, 0);
    await assert.rejects(badAuth.ingest(badAuth.body, AUTH, 'wrong-target-token'));
    assert.equal(badAuth.state.connections, 0); cases++;
    for (const flag of ['SUBSCRIPTIONS_TARGET_INGEST_ENABLED', 'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED']) {
      const x = fixture(); process.env[flag] = 'false';
      try { await assert.rejects(x.ingest()); assert.equal(x.state.connections, 0); }
      finally { process.env[flag] = 'true'; }
      cases++;
    }
    const changed = fixture(); await changed.ingest();
    await assert.rejects(changed.ingest({ ...changed.body, createOperationId: '33333333-3333-4333-8333-333333333333' }),
      (error: any) => error.code === 'CANONICAL_TARGET_INTAKE_CONFLICT');
    assert.equal(changed.state.snapshots.length, 1); cases++;
    const calls: unknown[] = [];
    const controller = new CanonicalTargetIntakeController({ ingest: async (...args: unknown[]) => { calls.push(args); return result; } } as any);
    await controller.ingest(QUARTER_TOKEN, f.body, AUTH);
    assert.deepEqual(calls, [[QUARTER_TOKEN, f.body, { authorizationHeader: AUTH }]]); cases++;
    console.log(`Actor-bound CREATE target intake: ${cases} cases PASS`);
  } finally {
    for (const [k, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[k]; else process.env[k] = value;
    }
  }
}
void main();
