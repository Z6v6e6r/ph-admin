import * as assert from 'node:assert/strict';
import { resolveResidencyProviderIdentity } from '../src/subscriptions/subscription-provider-identity';
import { SubscriptionRuntimeContextService } from '../src/subscriptions/subscription-runtime-context.service';
const originalFetch = globalThis.fetch;
const names = ['SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED',
  'SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED', 'SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID', 'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER'];
const originalEnv = names.map(k => [k, process.env[k]] as const);
const url = 'https://api.vivacrm.ru/end-user/api/v1/iSkq6G/profile';
const phone = '79990000000';
const token = 'synthetic-integration-token-'.repeat(2);
let reads = 0;
const response = (body: unknown, status = 200, responseUrl = url) => ({ status, url: responseUrl,
  json: async () => body }) as Response;
async function main() {
  globalThis.fetch = async (target, options) => {
    reads++;
    assert.equal(target, url); assert.equal(options?.redirect, 'error');
    assert.equal(options?.method, 'GET');
    assert.deepEqual(options?.headers, { Authorization: 'Bearer synthetic', Accept: 'application/json' });
    assert(options?.signal);
    return response({ id: 'provider-client', phone: '+7 (999) 000-00-00' });
  };
  assert.equal(await resolveResidencyProviderIdentity('Bearer synthetic', 'iSkq6G', phone), 'provider-client');
  for (const body of [[], null, { id: 'bad id', phone }, { id: 'client', phone: '79990000001' },
    { id: 'client' }, { id: 'client', phone, mobile: '79990000001' }]) {
    globalThis.fetch = async () => response(body);
    await assert.rejects(resolveResidencyProviderIdentity('Bearer synthetic', 'iSkq6G', phone));
  }
  for (const r of [response({}, 401), response({}, 302), response({}, 200, 'https://foreign.invalid/profile')]) {
    globalThis.fetch = async () => r;
    await assert.rejects(resolveResidencyProviderIdentity('Bearer synthetic', 'iSkq6G', phone));
  }
  globalThis.fetch = async () => { throw new Error('synthetic transport/abort'); };
  await assert.rejects(resolveResidencyProviderIdentity('Bearer synthetic', 'iSkq6G', phone));
  Object.assign(process.env, { SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED: 'true',
    SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED: 'true', SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED: 'true',
    SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN: token, SUBSCRIPTIONS_RUNTIME_TENANT_ID: 'iSkq6G',
    SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: 'synthetic-pepper-'.repeat(3) });
  let actor: Record<string, unknown> = { tenantKey: 'iSkq6G', phoneNorm: phone };
  const identity = { verifyTrustedBearer: async () => ({ actor }) };
  const service = new SubscriptionRuntimeContextService(identity as never, {} as never);
  globalThis.fetch = async () => { reads++; return response({ id: 'provider-client', phone }); };
  reads = 0;
  const resolved = await service.authorizeResidencyRefresh('Bearer synthetic', token);
  assert.equal(resolved.providerClientId, 'provider-client'); assert.equal(reads, 1);
  assert.match(resolved.clientRefHash, /^[a-f0-9]{64}$/);
  for (const id of ['claimed-client', '', 'bad id']) {
    actor = { tenantKey: 'iSkq6G', phoneNorm: phone, clientId: id }; reads = 0;
    if (id === 'claimed-client') assert.equal((await service.authorizeResidencyRefresh('Bearer synthetic', token)).providerClientId, id);
    else await assert.rejects(service.authorizeResidencyRefresh('Bearer synthetic', token));
    assert.equal(reads, 0);
  }
  actor = { tenantKey: 'iSkq6G', phoneNorm: phone }; reads = 0;
  await assert.rejects(service.resolve('Bearer synthetic', token, { clientSubscriptionId: 'untrusted-instance' }));
  assert.equal(reads, 0);
  await assert.rejects(service.authorizeResidencyRefresh('Bearer synthetic', 'wrong'));
  actor = { tenantKey: 'foreign', phoneNorm: phone };
  await assert.rejects(service.authorizeResidencyRefresh('Bearer synthetic', token));
  assert.equal(reads, 0);
  identity.verifyTrustedBearer = async () => { throw new Error('invalid JWT'); };
  await assert.rejects(service.authorizeResidencyRefresh('Bearer synthetic', token)); assert.equal(reads, 0);
  console.log('Residency provider identity positive and refusal checks passed');
}
main().finally(() => {
  globalThis.fetch = originalFetch;
  for (const [k,v] of originalEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}).catch(error => { console.error(error); process.exitCode = 1; });
