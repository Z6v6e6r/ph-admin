import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { normalizeResidencyProviderFacts, providerPaymentInstant, StoredResidencyObservation } from '../src/subscriptions/residency-provider-observation';
import { ResidencyProviderSyncService } from '../src/subscriptions/residency-provider-sync.service';
import { actor, bindingFixture, NOW, providerFixture } from './residency-provider-sync.test';

function issuedFixture() {
  const f = providerFixture();
  Object.assign(f.subscription, { status: 'NEW', purchaseDate: '2026-11-10T12:00:00.149583',
    activationDate: null, expirationDate: null, cost: 0 });
  Object.assign(f.transaction, { paymentDate: '2026-11-10T15:00:00.123456+03:00',
    paymentMethod: 'NO_PAYMENT', discount: 79000, toPay: 0 });
  f.transaction.products[0].discount = 79000;
  return f;
}
const facts = (f = issuedFixture(), observedAt = NOW) => normalizeResidencyProviderFacts({ ...f,
  providerClientId: actor.providerClientId, clientSubscriptionId: 'subscription:residency-test', observedAt });

async function main() {
  let cases = 0;
  const granted = facts();
  assert.equal(granted.eligible, true); assert.equal(granted.providerStatus, 'NEW');
  assert.equal(granted.paymentStatus, 'PAID'); assert.equal(granted.purchaseAmountMinor, 0);
  assert.equal(granted.windowOrigin, 'VIVA_PAID_TRANSACTION_PAYMENT_DATE');
  assert.equal(granted.purchasedAt, '2026-11-10T12:00:00.123Z');
  assert.equal(granted.activeFrom, granted.purchasedAt); assert.equal(granted.activeTo, '2026-12-10T12:00:00.123Z');
  assert.equal(granted.providerPurchaseDateRaw, '2026-11-10T12:00:00.149583');
  assert.equal(granted.providerActivationDateRaw, null); assert.equal(granted.providerExpirationDateRaw, null); cases++;

  const exact = providerPaymentInstant(granted.paymentDateRaw);
  assert.equal(exact.exactNs, (BigInt(Date.parse(granted.purchasedAt)) * 1000000n + 456000n).toString());
  assert.equal(exact.ceilMs, exact.floorMs + 1); cases++;
  for (const date of ['2026-11-10T12:00:00.123456Z', '2026-11-10T08:30:00.123456-03:30',
    '2026-11-11T02:00:00.123456+14:00', '2026-11-09T22:00:00.123456-14:00']) {
    assert.equal(providerPaymentInstant(date).exactNs, exact.exactNs); cases++;
  }
  for (const date of ['2026-11-10T12:00:00.123456', '2026-11-10T12:00:00-00:00', '2026-02-30T12:00:00Z',
    '2026-11-10T24:00:00Z', '2026-11-10T12:00:60Z', '2026-11-10T12:00:00+14:01',
    '2026-11-10T12:00:00+15:00', '2026-11-10T12:00:00+03:60', '2026-11-10T12:00:00.1234567890Z']) {
    assert.throws(() => providerPaymentInstant(date)); cases++;
  }
  // Never admit before the exact sub-ms paid instant, or extend expiry by rounding up.
  assert.throws(() => facts(issuedFixture(), '2026-11-10T12:00:00.123Z'));
  assert.equal(facts(issuedFixture(), '2026-11-10T12:00:00.124Z').eligible, true);
  assert.equal(facts(issuedFixture(), '2026-12-10T12:00:00.122Z').eligible, true);
  assert.equal(facts(issuedFixture(), '2026-12-10T12:00:00.123Z').eligible, false); cases++;
  for (const fractional of ['', '.1', '.123', '.123000000', '.123000001', '.123999999']) {
    const p = providerPaymentInstant('2026-11-10T12:00:00' + fractional + 'Z');
    const f = issuedFixture(); f.transaction.paymentDate = p.raw;
    const g = facts(f);
    assert.equal(BigInt(Date.parse(g.activeTo!)) * 1000000n <= BigInt(p.exactNs) + 30n * 86400000000000n, true);
    assert.equal(p.ceilMs - p.floorMs, /[1-9]/.test(fractional.slice(4)) ? 1 : 0); cases++;
  }
  // Provider counters are preserved evidence; refresh/activation never restarts the CUP PURCHASE window.
  const activated = issuedFixture(); Object.assign(activated.subscription, { status: 'ACTIVE',
    purchaseDate: '2026-11-11T12:00:00.149583', activationDate: '2026-11-12T12:00:00.654321',
    expirationDate: '2026-12-12T12:00:00.654321' });
  const refreshed = facts(activated, '2026-11-13T12:00:00.000Z');
  assert.equal(refreshed.eligible, true); assert.equal(refreshed.purchasedAt, granted.purchasedAt);
  assert.equal(refreshed.activeTo, granted.activeTo); assert.equal(refreshed.providerActivationDateRaw, activated.subscription.activationDate); cases++;
  const unpaid = issuedFixture(); unpaid.transaction.status = 'WAITING';
  assert.equal(facts(unpaid).eligible, false); // zero total never substitutes for PAID.
  unpaid.transaction.status = 'UNPAID'; assert.throws(() => facts(unpaid)); cases++;
  const inconsistent = providerFixture(); inconsistent.transaction.paymentMethod = 'NO_PAYMENT';
  assert.throws(() => facts(inconsistent)); cases++;
  for (const state of ['HOLD', 'EXPIRED', 'REFUNDED', 'NO_VISITS', 'FINISHED']) {
    const f = issuedFixture(); f.subscription.status = state; assert.equal(facts(f).eligible, false); cases++;
  }
  for (const mutate of [
    (f: any) => f.subscription.holdUntil = '2026-11-09T12:00:00.123456',
    (f: any) => f.transaction.transactionRefunds = [{ status: 'CREATED' }],
    (f: any) => f.transaction.refunded = true,
    (f: any) => f.subscription.refundSum = 1
  ]) { const f = issuedFixture(); mutate(f); assert.equal(facts(f).eligible, false); cases++; }
  for (const mutate of [
    (f: any) => f.transaction.client.id = 'client:foreign',
    (f: any) => f.subscription.status = 'UNKNOWN',
    (f: any) => f.transaction.status = 'UNKNOWN'
  ]) { const f = issuedFixture(); mutate(f); assert.throws(() => facts(f)); cases++; }

  const keys = ['SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID', 'SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS'];
  const saved = keys.map(k => process.env[k]);
  process.env[keys[0]] = 'studio:test'; process.env[keys[1]] = '60';
  try {
    let stored: StoredResidencyObservation | undefined;
    const repository: any = { binding: async () => bindingFixture(), persist: async (_: any, o: StoredResidencyObservation) => { stored = o; return o; } };
    const identity: any = { authorizeResidencyRefresh: async () => actor };
    const viva: any = { readResidencySubscriptionEvidence: async () => issuedFixture() };
    class Service extends ResidencyProviderSyncService { protected now() { return new Date(NOW); } }
    const result = await new Service(identity, repository, viva).refresh('synthetic', 'synthetic', { clientSubscriptionId: 'subscription:residency-test' });
    // Existing v1 envelope conveys active CUP monetary eligibility, not a fabricated Viva inventory state.
    assert.equal(result.schemaVersion, 1); assert.equal(result.context.instance.state, 'ACTIVE');
    assert.equal(stored!.facts.providerStatus, 'NEW'); assert.equal(stored!.facts.providerActivationDateRaw, null);
    assert.equal(result.purchasedAt, granted.purchasedAt); assert.equal(result.context.instance.activeFrom, granted.purchasedAt);
    assert.equal(result.context.instance.activeTo, granted.activeTo); assert.equal(result.context.instance.homeStationId, null);
    assert.equal(result.validUntil, '2026-11-10T13:00:29.000Z'); cases++;
  } finally { keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
  console.log(`residency financial issuance window: ${cases} cases PASS`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
