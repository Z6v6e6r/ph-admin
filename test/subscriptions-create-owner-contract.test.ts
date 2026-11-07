import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CanonicalTargetIntakeService } from '../src/subscriptions/canonical-target-intake.service';
import { SubscriptionTrustedShadowAdapterService, computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import { SubscriptionShadowQuoteService } from '../src/subscriptions/subscription-shadow-quote.service';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { parseQuarterDescriptor, quarterDescriptorDigest, quarterDictionaryRevision } from '../src/subscriptions/subscription-create-quarter-contract';
import { quarterFixture, QUARTER_TOKEN } from './subscriptions-create-quarter.test';
export async function pairedOwnerContract() {
  const wire = JSON.parse(readFileSync('test/fixtures/quarter-create-owner-v1.json', 'utf8'));
  const input = wire.targetIntake, runtime = wire.runtime, now = wire.admission.preparation.observedAt;
  const settings = { SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true', SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED: 'true',
    SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true', SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED: 'true',
    SUBSCRIPTIONS_TARGET_INGEST_ENABLED: 'true', SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED: 'true',
    SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN: QUARTER_TOKEN, SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN: QUARTER_TOKEN,
    SUBSCRIPTIONS_RUNTIME_TENANT_ID: wire.actor.tenantKey, SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: 'paired-synthetic-test-identity-pepper32',
    SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS: '60' };
  const before = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]])); Object.assign(process.env, settings);
  try {
    const f = quarterFixture(), s = f.state;
    const descriptor = parseQuarterDescriptor({ ...s.publication.createQuarterDescriptor,
      selectorRevision: input.catalogue.selectorRevision,
      stations: [{ stationId: input.stationId, providerStudioId: input.catalogue.providerStudioId,
        masterServiceId: input.catalogue.masterServiceId, subServiceId: input.catalogue.subServiceId }] });
    Object.assign(s.publication, { subscriptionTypeId: input.subscriptionTypeId, publicationId: input.publicationId,
      mappingId: runtime.evidence.mappingId, createQuarterDescriptor: descriptor,
      createQuarterDescriptorDigest: quarterDescriptorDigest(descriptor), dictionaryRevision: quarterDictionaryRevision(descriptor) });
    s.publication.runtimeProjection.subscriptionTypeId = input.subscriptionTypeId;
    s.publication.runtimeProjection.stationAccessRules[0].selector = { kind: 'STATION_LIST', stationIds: [input.stationId] };
    s.publication.runtimeProjection.benefitRules[0].stationIds = [input.stationId];
    s.publication.policyDigest = computeSubscriptionRuntimeProjectionDigest(s.publication.runtimeProjection);
    Object.assign(s.mapping, { tenantId: wire.actor.tenantKey, mappingId: runtime.evidence.mappingId,
      subscriptionTypeId: input.subscriptionTypeId, providerScope: { kind: 'TENANT', scopeId: wire.actor.tenantKey }, verifiedAt: now });
    Object.assign(s.instance, { tenantId: wire.actor.tenantKey, subscriptionInstanceId: input.subscriptionInstanceId,
      subscriptionTypeId: input.subscriptionTypeId, mappingId: s.mapping.mappingId, policyDigest: s.publication.policyDigest,
      providerClientId: wire.actor.providerClientId, clientSubscriptionId: runtime.clientSubscriptionId, homeStationId: input.stationId,
      activeFrom: runtime.instance.activeFrom, activeTo: runtime.instance.activeTo,
      clientRefHash: computeSubscriptionClientRefHash({ pepper: settings.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER,
        tenantId: wire.actor.tenantKey, providerClientId: wire.actor.providerClientId }) });
    s.instance.reconciliation.asOf = now; s.aggregate.reconciliation.asOf = now;
    s.aggregate.subscriptionInstanceId = input.subscriptionInstanceId;
    class Resolver extends SubscriptionCanonicalTargetResolverService { protected now() { return new Date(now); } }
    class Quote extends SubscriptionShadowQuoteService { protected now() { return new Date(now); } }
    class Trusted extends SubscriptionTrustedShadowAdapterService { protected now() { return new Date(now); } }
    class Lifecycle extends SubscriptionEntitlementLifecycleService { protected now() { return new Date(now); } }
    const resolver = new Resolver(f.repo as any), quote = new Quote(f.repo as any);
    const trusted = new Trusted({ verifyTrustedBearer: async () => ({ actor: { tenantKey: wire.actor.tenantKey,
      clientId: wire.actor.providerClientId, issuer: 'synthetic', subject: 'synthetic' } }) } as any, quote, resolver);
    const intake = await new CanonicalTargetIntakeService(f.repo as any, trusted).ingest(QUARTER_TOKEN, input,
      { authorizationHeader: 'Bearer paired-synthetic-actor', now: () => new Date(now) });
    const lifecycle = new Lifecycle(trusted, quote, f.repo as any);
    const request = { contractVersion: 2 as const, subscriptionInstanceId: input.subscriptionInstanceId,
      action: 'CREATE_GAME' as const, target: { targetId: input.targetId } };
    const preflight = await lifecycle.preflight('Bearer paired-synthetic-actor', QUARTER_TOKEN, request);
    const reserve = await lifecycle.reserve('Bearer paired-synthetic-actor', QUARTER_TOKEN,
      { subscriptionInstanceId: request.subscriptionInstanceId, action: request.action, target: request.target, expectations: preflight.expectations },
      { idempotencyKey: input.createOperationId });
    assert.equal(reserve.outcome, 'RESERVED'); assert.equal(reserve.decision!.usageUnits, 1);
    assert.equal(reserve.decision!.money.basePriceMinor! * 4, input.price.amountMinor);
    assert.equal(reserve.decision!.money.finalPriceMinor, 0);
    assert.equal(preflight.expectations.targetSnapshot.snapshotId, intake.snapshotId);
    assert.equal(preflight.expectations.createQuarter!.createOperationId, input.createOperationId);
    assert.doesNotMatch(JSON.stringify(intake), /clientRefHash|providerClientId|tenantId|pepper/);
    return { policyDigest: s.publication.policyDigest, intake, preflight, reserve };
  } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
if (require.main === module) void pairedOwnerContract().then(result => {
  const expected = JSON.parse(readFileSync('test/fixtures/quarter-create-owner-v1.json', 'utf8')).cup;
  assert.ok(expected, 'paired fixture must contain actual CUP output');
  assert.deepEqual(result.preflight, expected.preflight);
  assert.deepEqual(result.reserve.decision, expected.reserve.decision);
  assert.equal(result.policyDigest, expected.policyDigest);
  console.log('Paired actual LK producer → CUP v3 intake/preflight/reserve contract PASS');
});
