import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { normalizeResidencyProviderFacts, providerInstant, withinResidencyDeadline } from '../src/subscriptions/residency-provider-observation';
import { RESIDENCY_PRODUCT_ID, buildResidencyPolicyCandidate, RESIDENCY_BOOKING_COMPATIBILITY } from '../src/subscriptions/residency-booking-policy';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { buildSubscriptionProjectionFence } from '../src/subscriptions/subscription-projection-fence';
import { ResidencyProviderSyncService } from '../src/subscriptions/residency-provider-sync.service';
import { ResidencyObservationRepository } from '../src/subscriptions/residency-observation.repository';
import { ServiceUnavailableException } from '@nestjs/common';
import { SubscriptionRuntimeContextService } from '../src/subscriptions/subscription-runtime-context.service';

export const NOW = '2026-11-10T13:00:00.000Z';
export const actor = { tenantId: 'tenant:residency-test', providerClientId: 'client:residency-test', clientRefHash: 'a'.repeat(64) };
export function providerFixture() {
  return {
    subscription: { subscriptionId: 'subscription:residency-test', product: { id: RESIDENCY_PRODUCT_ID },
      transactionId: 'transaction:residency-test', status: 'ACTIVE', purchaseDate: '2026-11-10T12:00:00.000Z',
      activationDate: '2026-11-10T12:00:00.000Z', expirationDate: '2026-12-10T12:00:00.000Z', cost: 79000 } as any,
    transaction: { id: 'transaction:residency-test', client: { id: actor.providerClientId },
      status: 'PAID', paymentDate: '2026-11-10T12:00:00.000Z', sum: 79000, discount: 0, toPay: 79000,
      products: [{ id: RESIDENCY_PRODUCT_ID, count: 1, cost: 79000, discount: 0 }] } as any,
    instanceObservedAt: '2026-11-10T12:59:59.000Z', productObservedAt: '2026-11-10T12:59:59.010Z',
    productEvidenceRef: 'evidence:residency-product:' + 'a'.repeat(64)
  };
}
export const normalize = (fixture = providerFixture()) => normalizeResidencyProviderFacts({
  ...fixture, providerClientId: actor.providerClientId, clientSubscriptionId: 'subscription:residency-test', observedAt: NOW
});
export function bindingFixture() {
  const dto = buildResidencyPolicyCandidate({ effectiveAt: '2026-11-09T00:00:00.000Z',
    gameEventTypeIds: ['viva:direction:4588:type:1613'], groupTrainingEventTypeIds: ['viva:direction:2468:type:605'] });
  const service = Object.create(SubscriptionsService.prototype) as any;
  const policy = service.normalizePolicy(dto);
  const projection = compileSubscriptionRuntimeProjection({ ...policy, subscriptionTypeId: 'type:residency-test', version: 2, status: 'PUBLISHED' });
  const publication: any = { schemaVersion: 3, publicationId: 'publication:residency-test', subscriptionTypeId: projection.subscriptionTypeId,
    policyVersion: 2, policyDigest: computeSubscriptionRuntimeProjectionDigest(projection), mappingId: 'mapping:residency-test',
    dictionaryRevision: 'dictionary:residency-test', runtimeProjection: projection, state: 'PUBLISHED', effectiveAt: dto.effectiveAt,
    publishedAt: dto.effectiveAt, publishedBy: 'admin:test', supersededAt: null, supersededBy: null,
    impactPreviewRef: 'impact:residency-test', approvalAuditRef: 'audit:residency-test', runtimeCompatibility: RESIDENCY_BOOKING_COMPATIBILITY,
    idempotency: { actorId: 'admin:test', key: 'test-key', requestHash: 'a'.repeat(64), correlationId: 'corr:test' } };
  const mapping: any = { schemaVersion: 1, mappingId: publication.mappingId, tenantId: actor.tenantId, provider: 'VIVA', providerProductId: RESIDENCY_PRODUCT_ID,
    providerScope: { kind: 'TENANT', scopeId: actor.tenantId }, subscriptionTypeId: publication.subscriptionTypeId, state: 'VERIFIED',
    evidenceRef: 'evidence:original', verifiedAt: dto.effectiveAt, verifiedBy: 'admin:test', revision: 1,
    createdAt: dto.effectiveAt, createdBy: 'admin:test', updatedAt: dto.effectiveAt, updatedBy: 'admin:test', idempotency: publication.idempotency };
  return { mapping, publications: [publication], fence: buildSubscriptionProjectionFence({ mapping, publication, previous: null }) };
}

async function main() {
  let cases = 0;
  assert.equal(normalize().eligible, true); assert.equal(normalize().purchaseAmountMinor, 79000); cases += 1;
  const discounted = providerFixture(); discounted.transaction.products[0].discount = 10000;
  discounted.transaction.discount = 10000; discounted.transaction.toPay = 69000;
  // Provider subscription.cost gross/net semantics are not used to invent a payment amount.
  assert.equal(normalize(discounted).purchaseAmountMinor, 69000); cases += 1;
  for (const mutate of [
    (f: any) => f.subscription.product.id = 'product:foreign',
    (f: any) => f.subscription.clientId = 'client:foreign',
    (f: any) => f.subscription.subscriptionId = 'subscription:foreign',
    (f: any) => f.subscription.transactionId = 'transaction:foreign',
    (f: any) => f.transaction.client.id = 'client:foreign',
    (f: any) => f.transaction.clientId = 'client:conflict',
    (f: any) => f.transaction.uuid = 'transaction:conflict',
    (f: any) => f.transaction.products[0].id = 'product:foreign',
    (f: any) => f.transaction.products.push({ ...f.transaction.products[0] }),
    (f: any) => f.transaction.products[0].count = 2,
    (f: any) => f.transaction.products[0].cost = -1,
    (f: any) => f.transaction.products[0].discount = 0.5,
    (f: any) => f.transaction.products[0].cost = Number.MAX_SAFE_INTEGER + 1,
    (f: any) => f.transaction.sum = 1,
    (f: any) => f.transaction.discount = 1,
    (f: any) => f.transaction.toPay = 0,
    (f: any) => delete f.transaction.paymentDate,
    (f: any) => { f.transaction.status = 'UNPAID'; f.transaction.paymentDate = null; },
    (f: any) => f.transaction.paymentDate = '2026-11-11T12:00:00Z',
    (f: any) => f.transaction.paymentDate = '2026-11-10T12:00:00',
    (f: any) => f.transaction.status = 'UNSUPPORTED',
    (f: any) => f.subscription.status = 'UNSUPPORTED',
    (f: any) => f.transaction.products[0].refundStatus = 'UNKNOWN',
    (f: any) => f.subscription.holdUntil = 'invalid',
    (f: any) => f.subscription.purchaseDate = '2026-02-30T12:00:00.000999'
  ]) {
    const fixture = providerFixture(); mutate(fixture); assert.throws(() => normalize(fixture)); cases += 1;
  }
  for (const mutate of [
    (f: any) => f.subscription.status = 'HOLD',
    (f: any) => f.subscription.status = 'EXPIRED',
    (f: any) => f.subscription.status = 'REFUNDED',
    (f: any) => f.subscription.status = 'NO_VISITS',
    (f: any) => f.transaction.status = 'WAITING',
    (f: any) => f.transaction.status = 'PARTIALLY_PAID',
    (f: any) => f.transaction.status = 'PARTIALLY_REFUNDED',
    (f: any) => f.transaction.status = 'REFUND',
    (f: any) => f.transaction.products[0].refundStatus = 'PARTIAL',
    (f: any) => f.transaction.products[0].refundStatus = 'FULL',
    (f: any) => f.transaction.products[0].refunded = true,
    (f: any) => f.transaction.refundSum = 1,
    (f: any) => f.subscription.refundedAt = NOW,
    (f: any) => f.transaction.transactionRefunds = [{ status: 'CREATED' }],
    (f: any) => f.transaction.transactionRefunds = [{ status: 'COMPLETED' }],
    (f: any) => f.transaction.transactionRefunds = [{ status: 'CANCELLED' }],
    (f: any) => f.subscription.frozenUntil = '2026-11-11T12:00:00Z',
    (f: any) => f.subscription.holdUntil = '2026-11-11T12:00:00Z',
  ]) {
    const fixture = providerFixture(); mutate(fixture); assert.equal(normalize(fixture).eligible, false); cases += 1;
  }
  for (const bad of ['2026-02-30T12:00:00Z', '2026-11-10T24:00:00Z', '2026-11-10T12:00:00.000001Z']) {
    assert.throws(() => providerInstant(bad)); cases += 1;
  }
  assert.equal(providerInstant('2026-11-10T15:00:00.123000000+03:00'), '2026-11-10T12:00:00.123Z'); cases += 1;

  const env = ['SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID', 'SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS',
    'SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED',
    'SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN', 'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER', 'SUBSCRIPTIONS_RUNTIME_TENANT_ID'];
  const saved = env.map(k => process.env[k]);
  process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID = 'studio:test';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = '60';
  try {
    process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN = 'synthetic-integration-token-'.repeat(2);
    process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = 'synthetic-client-hash-pepper-'.repeat(2);
    process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = actor.tenantId;
    let verified = 0;
    const trusted: any = { verifyTrustedBearer: async () => { verified++; return { actor: { tenantKey: actor.tenantId, clientId: actor.providerClientId } }; } };
    const authentication = new SubscriptionRuntimeContextService(trusted, {} as any);
    const token = process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN;
    const canonical = await authentication.authorizeResidencyRefresh('Bearer synthetic', token);
    assert.equal(canonical.providerClientId, actor.providerClientId); assert.match(canonical.clientRefHash, /^[a-f0-9]{64}$/); cases++;
    await assert.rejects(authentication.authorizeResidencyRefresh('Bearer synthetic', 'wrong')); assert.equal(verified, 1); cases++;
    for (const flag of ['SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED']) {
      process.env[flag] = 'false'; await assert.rejects(authentication.authorizeResidencyRefresh('Bearer synthetic', token)); process.env[flag] = 'true'; cases++;
    }
    trusted.verifyTrustedBearer = async () => ({ actor: { tenantKey: 'tenant:foreign', clientId: actor.providerClientId } });
    await assert.rejects(authentication.authorizeResidencyRefresh('Bearer synthetic', token)); cases++;
    trusted.verifyTrustedBearer = async () => { throw Error('revoked bearer'); };
    await assert.rejects(authentication.authorizeResidencyRefresh('Bearer revoked', token)); cases++;
    for (const row of ['subscription', 'transaction'] as const) {
      const refunded = providerFixture(); refunded[row].refunded = true;
      assert.equal(normalize(refunded).eligible, false); cases++;
      refunded[row].refunded = 'false'; assert.throws(() => normalize(refunded)); cases++;
    }
    for (const phase of ['catalog', 'observation-index']) {
      const repo: any = new ResidencyObservationRepository(); let timeout = 0;
      repo.db = { collection: () => ({ listIndexes: (options: any) => {
        timeout = options.timeoutMS; return { toArray: () => new Promise(() => {}) };
      } }) };
      const started = Date.now();
      await assert.rejects(phase === 'catalog' ? repo.binding(actor.tenantId, started + 25) : repo.connect(true, started + 25));
      assert.ok(timeout > 0 && timeout <= 25); assert.ok(Date.now() - started < 500); cases++;
    }
    let lateWrites = 0;
    await assert.rejects(withinResidencyDeadline(() => new Promise(resolve => setTimeout(resolve, 40)), Date.now() + 10)
      .then(() => { lateWrites++; }));
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(lateWrites, 0); cases++;
    let authCalls = 0, fetches = 0, writes = 0;
    const identity: any = { authorizeResidencyRefresh: async () => { authCalls++; return actor; } };
    const repository: any = { binding: async () => bindingFixture(), persist: async (_: any, observation: any) => { writes++; return observation; } };
    const viva: any = { readResidencySubscriptionEvidence: async (input: any) => { fetches++; assert.equal(input.clientId, actor.providerClientId); return providerFixture(); } };
    class Service extends ResidencyProviderSyncService { protected now() { return new Date(NOW); } }
    const service = new Service(identity, repository, viva);
    const result = await service.refresh('Bearer test', 'test-token', { clientSubscriptionId: 'subscription:residency-test' });
    assert.equal(result.contextKind, 'RESIDENCY_BOOKING_CONTEXT'); assert.equal(result.context.instance.homeStationId, null);
    assert.equal(result.observedAt, '2026-11-10T12:59:59.000Z'); assert.equal(result.validUntil, '2026-11-10T13:00:29.000Z');
    assert.equal(writes, 1); assert.equal(fetches, 1); assert.equal(authCalls, 1); cases += 1;
    identity.authorizeResidencyRefresh = async () => { throw new Error('auth denied'); };
    await assert.rejects(service.refresh('bad', 'bad', { clientSubscriptionId: 'subscription:residency-test' }));
    assert.equal(fetches, 1); assert.equal(writes, 1); cases += 1;
    identity.authorizeResidencyRefresh = async () => actor;
    viva.readResidencySubscriptionEvidence = async () => { throw new Error('provider unavailable'); };
    await assert.rejects(service.refresh('Bearer test', 'test', { clientSubscriptionId: 'subscription:residency-test' })); assert.equal(writes, 1); cases += 1;
    viva.readResidencySubscriptionEvidence = async () => ({ ...providerFixture(), instanceObservedAt: '2026-11-10T12:00:00Z' });
    await assert.rejects(service.refresh('Bearer test', 'test', { clientSubscriptionId: 'subscription:residency-test' })); assert.equal(writes, 1); cases += 1;
    viva.readResidencySubscriptionEvidence = async () => providerFixture();
    repository.persist = async (_: any, o: any) => { if (writes++ === 1) throw new ServiceUnavailableException({ code: 'RESIDENCY_SYNC_BINDING_CHANGED' }); return o; };
    await service.refresh('Bearer test', 'test', { clientSubscriptionId: 'subscription:residency-test' });
    assert.equal(writes, 3); cases += 1;
    repository.persist = async (_: any, o: any) => ({ ...o, facts: { ...o.facts, eligible: false } });
    await assert.rejects(service.refresh('Bearer test', 'test', { clientSubscriptionId: 'subscription:residency-test' })); cases += 1;
  } finally { env.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
  console.log(`residency provider normalization + JIT service: ${cases} cases PASS`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
