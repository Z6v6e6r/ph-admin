import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import { RESIDENCY_PRODUCT_ID } from '../src/subscriptions/residency-booking-policy';
import { actor, providerFixture } from './residency-provider-sync.test';

async function main() {
  const oldFetch = globalThis.fetch, oldFlag = process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED;
  process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED = 'true';
  const service: any = new VivaAdminService();
  service.requireAccessToken = async () => 'synthetic-admin-token';
  service.getResolvedSettings = async () => ({ config: { baseUrl: 'https://api.vivacrm.ru' } });
  const input = { clientId: actor.providerClientId, clientSubscriptionId: 'subscription:residency-test', studioId: 'studio:test' };
  const product = { id: RESIDENCY_PRODUCT_ID, productType: 'SUBSCRIPTION', validityDays: 30, hasStudioLimitation: false, availableStudios: [] };
  let cases = 0;
  const page = (rows: any[], number = 0, total = rows.length, pages = rows.length ? 1 : 0) =>
    ({ content: rows, number, numberOfElements: rows.length, totalElements: total, totalPages: pages, last: number + 1 >= pages });
  async function run(transform: (path: string, body: any) => any = (_p, b) => b, options: { redirect?: boolean; status?: number } = {}) {
    const calls: string[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const parsed = new URL(String(url)); calls.push(parsed.pathname);
      assert.equal(parsed.origin, 'https://api.vivacrm.ru'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-admin-token'); assert.ok(init.signal);
      let body: any;
      if (parsed.pathname.startsWith('/api/v1/products/subscriptions/')) body = { ...product };
      else if (parsed.pathname === `/api/v1/clients/${encodeURIComponent(input.clientId)}/subscriptions`) body = page([providerFixture().subscription]);
      else if (parsed.pathname === `/api/v1/transactions/${encodeURIComponent('transaction:residency-test')}`) body = providerFixture().transaction;
      else assert.fail('Unexpected provider route: ' + parsed.pathname);
      body = transform(parsed.pathname + parsed.search, body);
      const response = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: options.status || 200 });
      Object.defineProperty(response, 'url', { value: options.redirect ? 'https://evil.example/' : String(url) });
      return response;
    }) as any;
    const result = await service.readResidencySubscriptionEvidence(input);
    return { result, calls };
  }
  try {
    let result = await run(); assert.equal(result.calls.length, 3); assert.equal(result.result.subscription.subscriptionId, input.clientSubscriptionId);
    assert.ok(result.result.productEvidenceRef.startsWith('evidence:residency-product:')); cases++;
    result = await run((p, b) => {
      if (!p.includes('/clients/')) return b;
      if (p.endsWith('page=0')) return page([{ subscriptionId: 'subscription:other' }], 0, 2, 2);
      return page([providerFixture().subscription], 1, 2, 2);
    }); assert.equal(result.calls.length, 4); cases++;
    for (const transform of [
      (p: string, b: any) => p.includes('/clients/') ? page([]) : b,
      (p: string, b: any) => p.includes('/clients/') ? { ...b, number: 1 } : b,
      (p: string, b: any) => p.includes('/clients/') ? { ...b, totalElements: 2 } : b,
      (p: string, b: any) => p.includes('/clients/') ? { ...b, numberOfElements: 2 } : b,
      (p: string, b: any) => p.includes('/clients/') ? page([providerFixture().subscription, providerFixture().subscription]) : b,
      (p: string, b: any) => p.includes('/clients/') ? { ...b, last: false } : b,
      (p: string, b: any) => p.includes('/clients/') ? { ...b, content: [{ subscriptionId: input.clientSubscriptionId, id: 'subscription:conflict' }] } : b,
      (p: string, b: any) => p.includes('/products/') ? { ...b, id: 'product:foreign' } : b,
      (p: string, b: any) => p.includes('/products/') ? { ...b, validityDays: 31 } : b,
      (p: string, b: any) => p.includes('/products/') ? { ...b, hasStudioLimitation: true } : b,
      (p: string, b: any) => p.includes('/products/') ? 'x'.repeat(1048577) : b,
      (p: string, b: any) => p.includes('/transactions/') ? 'invalid-json-private-body' : b
    ]) { await assert.rejects(run(transform)); cases++; }
    await assert.rejects(run(undefined, { redirect: true })); cases++;
    await assert.rejects(run(undefined, { status: 503 })); cases++;
    process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED = 'false'; await assert.rejects(service.readResidencySubscriptionEvidence(input)); cases++;
    process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED = 'true';
    service.getResolvedSettings = async () => ({ config: { baseUrl: 'https://evil.example' } });
    await assert.rejects(service.readResidencySubscriptionEvidence(input)); cases++;
    for (const phase of ['requireAccessToken', 'getResolvedSettings']) {
      service.requireAccessToken = async () => 'synthetic-admin-token';
      service.getResolvedSettings = async () => ({ config: { baseUrl: 'https://api.vivacrm.ru' } });
      service[phase] = () => new Promise(() => {});
      let calls = 0;
      globalThis.fetch = (async () => { calls++; throw Error('no request after expired setup'); }) as any;
      const started = Date.now();
      await assert.rejects(service.readResidencySubscriptionEvidence({ ...input, deadline: started + 25 }));
      assert.ok(Date.now() - started < 500, phase + ' must be bounded before provider HTTP');
      assert.equal(calls, 0); cases++;
    }
    console.log(`residency Viva GET-only reader/pagination/transport: ${cases} cases PASS`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldFlag === undefined) delete process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED; else process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED = oldFlag;
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
