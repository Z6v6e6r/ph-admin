import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { CanonicalTargetIntakeService } from '../src/subscriptions/canonical-target-intake.service';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import { SubscriptionShadowQuoteService } from '../src/subscriptions/subscription-shadow-quote.service';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { computeSubscriptionRuntimeProjectionDigest, validateStoredSubscriptionCanonicalTargetSnapshot, validateStoredSubscriptionPolicyPublication } from '../src/subscriptions/subscription-runtime-contracts';
import { parseQuarterDescriptor, parseQuarterIntake, quarterDescriptorDigest, quarterDictionaryRevision, quarterDictionaryEvidence, quarterSnapshotInput, QUARTER_EVENT } from '../src/subscriptions/subscription-create-quarter-contract';
import type { StoredSubscriptionEntitlementAggregate, StoredSubscriptionInstance, StoredSubscriptionPolicyPublication, StoredSubscriptionProviderMapping, SubscriptionShadowQuoteRequest, StoredSubscriptionCanonicalTargetSnapshot } from '../src/subscriptions/subscriptions.types';
const NOW = '2026-08-16T10:00:00.000Z';
const HASH = 'a'.repeat(64);
const publicationFixture = (): StoredSubscriptionPolicyPublication => {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:friendship-12m',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-16T00:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: true, max: 3, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: true, days: 4 },
    dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [{
      ruleId: 'station_rule:home',
      enabled: true,
      priority: 10,
      selector: { kind: 'HOME_STATION', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [{
      ruleId: 'benefit_rule:create-game',
      enabled: true,
      category: 'GAME',
      actions: ['CREATE_GAME'],
      externalEventTypeIds: ['event_type:open-game'],
      productTypeIds: [],
      durationMinutes: [60, 90, 120],
      stationIds: ['station:yasenevo'],
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 10
    }],
    lifecycle: { allowBookingsAfterExpiry: false },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: []
    }
  };
  return {
    schemaVersion: 1,
    publicationId: 'publication:friendship-12m-v3',
    subscriptionTypeId: runtimeProjection.subscriptionTypeId,
    policyVersion: runtimeProjection.policyVersion,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: 'mapping:friendship-12m',
    dictionaryRevision: 'dictionary:2026-08-16',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: '2026-08-16T09:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:friendship-12m-v3',
    approvalAuditRef: 'audit:friendship-12m-v3'
  };
};

const instanceFixture = (): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  tenantId: 'iSkq6G',
  subscriptionTypeId: 'subscription_type:friendship-12m',
  policyVersion: 3,
  policyDigest: publicationFixture().policyDigest,
  mappingId: 'mapping:friendship-12m',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerClientId: 'provider_client:synthetic-1',
  clientSubscriptionId: 'client_subscription:synthetic-1',
  clientRefHash: HASH,
  homeStationId: 'station:yasenevo',
  releaseProgramId: 'release_program:friendship-2026',
  releasePhaseId: 'release_phase:first-50',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: '2026-08-16T09:00:00.000Z',
  activeFrom: '2026-08-16T00:00:00.000Z',
  activeTo: '2027-08-15T23:59:59.999Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment-readback',
    providerInstanceEvidenceRef: 'evidence:provider-instance-readback',
    lastReadBackEvidenceRef: 'evidence:provider-instance-readback'
  },
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:instance-current'
  },
  revision: 1,
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z'
});

const aggregateFixture = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  revision: 4,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 0,
  activeServices: [],
  dailyUsage: {},
  weeklyUsage: {},
  monthlyUsage: {},
  futureBookingCount: 0,
  futureServiceStartsAt: [],
  remainingUnits: 270,
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:aggregate-current'
  },
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z'
});

const mappingFixture = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:friendship-12m',
  tenantId: 'iSkq6G',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerScope: { kind: 'TENANT', scopeId: 'iSkq6G' },
  subscriptionTypeId: 'subscription_type:friendship-12m',
  state: 'VERIFIED',
  evidenceRef: 'evidence:mapping-readback',
  verifiedAt: '2026-08-16T09:59:50.000Z',
  verifiedBy: 'admin:subscriptions',
  revision: 1,
  createdAt: '2026-08-16T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: '2026-08-16T09:59:50.000Z',
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-create-friendship-12m',
    requestHash: HASH,
    correlationId: 'corr:mapping-create'
  }
});

const requestFixture = (): SubscriptionShadowQuoteRequest => ({
  identity: {
    resolutionSource: 'LK_IDENTITY',
    tenantId: 'iSkq6G',
    clientRefHash: HASH,
    evidenceRef: 'evidence:lk-session',
    verifiedAt: '2026-08-16T09:59:50.000Z'
  },
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  action: 'CREATE_GAME',
  target: {
    resolutionSource: 'SERVER',
    targetId: 'exercise:synthetic-1',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: '2026-08-18T06:00:00.000Z',
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-08-16',
    evidenceRef: 'evidence:exercise-read',
    priceEvidenceRef: 'evidence:price-read',
    resolvedAt: '2026-08-16T09:59:50.000Z'
  }
});

const TENANT = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const TOKEN = 'synthetic-quarter-intake-token-only-32';
const descriptor = () => parseQuarterDescriptor({ schemaVersion: 1, kind: 'ORGANIZER_QUARTER_CREATE', directionId: '4588',
  typeId: '1613', selectorRevision: 'selector:quarter-v1', durationMinutes: 60, participantCount: 4, spot: 1,
  currency: 'RUB', priceBasis: 'ORGANIZER_QUARTER', benefitKind: 'FREE_ENTITLEMENT', usageUnits: 1, dailyUsageLimit: 1,
  stations: [{ stationId: 'station:yasenevo', providerStudioId: 'studio:synthetic', masterServiceId: 'master:synthetic', subServiceId: 'service:synthetic' }] });
const intakeBody = () => ({ contractVersion: 2, kind: 'ORGANIZER_QUARTER_CREATE',
  targetId: 'create-draft:11111111-1111-4111-8111-111111111111', revision: 1, state: 'ACTIVE',
  subscriptionTypeId: 'subscription_type:friendship-12m', policyVersion: 3, publicationId: 'publication:friendship-12m-v3',
  createOperationId: '22222222-2222-4222-8222-222222222222', draftId: '11111111-1111-4111-8111-111111111111', clientRefHash: HASH,
  stationId: 'station:yasenevo', roomId: 'room:synthetic', startsAt: '2026-08-18T06:00:00.000Z',
  observedAt: '2026-08-16T09:59:50.000Z', expiresAt: '2026-08-16T10:00:50.000Z',
  catalogue: { directionId: '4588', typeId: '1613', providerStudioId: 'studio:synthetic', masterServiceId: 'master:synthetic', subServiceId: 'service:synthetic',
    selectorRevision: 'selector:quarter-v1', roomIds: ['room:synthetic'] },
  price: { basis: 'WHOLE_COURT_WINDOW', amountMinor: 600000, currency: 'RUB', durationMinutes: 60, participantCount: 4, spot: 1 } });
class Resolver extends SubscriptionCanonicalTargetResolverService { protected now() { return new Date(NOW); } }
class Quote extends SubscriptionShadowQuoteService { protected now() { return new Date(NOW); } }
class Lifecycle extends SubscriptionEntitlementLifecycleService { protected now() { return new Date(NOW); } }
function fixture() {
  const publication = publicationFixture();
  publication.schemaVersion = 4;
  publication.idempotency = { actorId: 'admin:synthetic', key: 'quarter-publication-key', requestHash: HASH, correlationId: 'corr:quarter' };
  publication.runtimeCompatibility = { adapterId: 'LK_REGIONAL_BOOKING_GATEWAY', contractVersion: 1, capabilityDigest: `sha256:${HASH}` };
  publication.createQuarterDescriptor = descriptor();
  publication.createQuarterDescriptorDigest = quarterDescriptorDigest(descriptor());
  publication.dictionaryRevision = quarterDictionaryRevision(descriptor());
  publication.runtimeProjection.createGame.durationsMinutes = [60];
  publication.runtimeProjection.stationAccessRules[0].selector = { kind: 'STATION_LIST', stationIds: ['station:yasenevo'] };
  publication.runtimeProjection.benefitRules[0].durationMinutes = [60];
  publication.runtimeProjection.benefitRules[0].externalEventTypeIds = [QUARTER_EVENT];
  publication.policyDigest = computeSubscriptionRuntimeProjectionDigest(publication.runtimeProjection);
  const instance = instanceFixture(); instance.tenantId = TENANT; instance.policyDigest = publication.policyDigest;
  const mapping = mappingFixture(); mapping.tenantId = TENANT; mapping.providerScope = { kind: 'TENANT', scopeId: TENANT };
  const state = { publication, instance, mapping, aggregate: aggregateFixture(), snapshots: [] as StoredSubscriptionCanonicalTargetSnapshot[],
    operations: [] as any[], writes: 0, connections: 0, targetReads: 0, publicationReads: 0, actorHash: HASH, failReads: false };
  const repo = {
    connectReadOnly: async () => { state.connections++; },
    connect: async (): Promise<void> => { throw new Error('index-creating connection forbidden'); },
    runtimePolicyPublicationByVersion: async (type: string, version: number) => {
      state.publicationReads++; if (state.failReads) throw new Error('read unavailable');
      return state.publication.subscriptionTypeId === type && state.publication.policyVersion === version ? state.publication : null;
    },
    runtimeProviderMappingById: async () => state.mapping,
    insertRuntimeCanonicalTargetSnapshot: async (value: StoredSubscriptionCanonicalTargetSnapshot) => {
      validateStoredSubscriptionCanonicalTargetSnapshot(value);
      if (state.snapshots.some(x => x.targetId === value.targetId && x.revision === value.revision)) throw { code: 11000 };
      state.snapshots.push(structuredClone(value));
    },
    isDuplicateKey: (error: any) => error?.code === 11000,
    runtimeCanonicalTargetSnapshot: async (query: any) => { state.targetReads++; return state.snapshots.find(x => x.tenantId === query.tenantId && x.targetId === query.targetId && x.action === query.action && x.revision === query.revision) ?? null; },
    runtimeLatestCanonicalTargetSnapshot: async (query: any) => state.snapshots.filter(x => x.tenantId === query.tenantId && x.targetId === query.targetId && x.action === query.action).sort((a,b) => b.revision-a.revision)[0] ?? null,
    runtimeInstanceByTenantAndId: async (tenant: string, id: string) => tenant === instance.tenantId && id === instance.subscriptionInstanceId ? instance : null,
    runtimeEntitlementAggregateByInstance: async () => structuredClone(state.aggregate),
    runtimeOperationByIdempotency: async (q: any) => state.operations.find(x => x.tenantId === q.tenantId && x.actor.actorId === q.actorId && x.idempotency.keyHash === q.keyHash) ?? null,
    reserveRuntimeEntitlement: async (input: any) => {
      state.writes++; state.aggregate = structuredClone(input.aggregate); state.operations.push(structuredClone(input.operation));
      return { replayed: false, operation: input.operation, aggregate: input.aggregate };
    }
  };
  const resolver = new Resolver(repo as any), quote = new Quote(repo as any);
  const identity = () => ({ resolutionSource: 'LK_IDENTITY' as const, tenantId: TENANT, clientRefHash: state.actorHash,
    evidenceRef: 'evidence:synthetic-actor', verifiedAt: NOW });
  const adapter = { resolveEntitlementIdentity: async () => identity(),
    resolveEntitlementRequest: async (_a: unknown, _b: unknown, input: any) => ({ identity: identity(), subscriptionInstanceId: input.subscriptionInstanceId,
      action: input.action, target: await resolver.resolveLatest({ tenantId: TENANT, targetId: input.target.targetId, action: input.action }) }) };
  const lifecycle = new Lifecycle(adapter as any, quote, repo as any);
  const intake = new CanonicalTargetIntakeService(repo as any);
  const ingest = (body: unknown = intakeBody(), token = TOKEN) => intake.ingest(token, body, { now: () => new Date(NOW) });
  const request = { contractVersion: 2 as const, subscriptionInstanceId: instance.subscriptionInstanceId,
    action: 'CREATE_GAME' as const, target: { targetId: intakeBody().targetId } };
  const preflight = () => lifecycle.preflight('Bearer synthetic', 'synthetic-integration', request);
  return { state, repo, resolver, quote, lifecycle, ingest, request, preflight, adapter };
}
async function main() {
  const settings = { SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true', SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED: 'true',
    SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true', SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED: 'true',
    SUBSCRIPTIONS_TARGET_INGEST_ENABLED: 'true', SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN: TOKEN,
    SUBSCRIPTIONS_RUNTIME_TENANT_ID: TENANT, SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS: '60' };
  const previous = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]])); Object.assign(process.env, settings);
  try {
    // Exact exported function bytes from base41c744d5, not a mirrored enum assertion.
    const priorValidator = readFileSync('test/fixtures/subscription-publication-validator-41c744d5.txt', 'utf8');
    assert.equal(createHash('sha256').update(priorValidator).digest('hex'), '556111196a775e40f0850ea833e104c9e241ee62f033258699f785972a81a3a0');
    const oldModule: { exports: Record<string, (input: unknown) => void> } = { exports: {} };
    runInNewContext(transpileModule(priorValidator, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText,
      { exports: oldModule.exports, fail: (code: string) => { throw new Error(code); } });
    assert.throws(() => oldModule.exports.validateStoredSubscriptionPolicyPublication(fixture().state.publication),
      /SUBSCRIPTION_PUBLICATION_SCHEMA_INVALID/);
    const f = fixture(); validateStoredSubscriptionPolicyPublication(f.state.publication);
    await assert.rejects(f.ingest(intakeBody(), 'invalid')); assert.equal(f.state.connections, 0); assert.equal(f.state.snapshots.length, 0);
    const first = await f.ingest(); assert.equal(first.replay, false); assert.equal(f.state.snapshots[0].basePriceMinor, 150000);
    assert.equal((await f.ingest()).replay, true); assert.equal(f.state.snapshots.length, 1);
    assert.deepEqual(quarterSnapshotInput(JSON.parse(JSON.stringify(f.state.snapshots[0]))), parseQuarterIntake(intakeBody()));
    const preflight = await f.preflight(); assert.equal(preflight.nonBinding, true); assert.equal(f.state.writes, 0);
    assert.deepEqual(preflight.expectations.createQuarter, f.state.snapshots[0].createQuarter!.binding);
    const reserve = { subscriptionInstanceId: f.request.subscriptionInstanceId, action: f.request.action, target: f.request.target, expectations: preflight.expectations };
    const result = await f.lifecycle.reserve('Bearer synthetic', 'synthetic', reserve, { idempotencyKey: 'quarter-original-key' });
    assert.equal(result.decision!.money.basePriceMinor, 150000); assert.equal(result.decision!.money.finalPriceMinor, 0);
    assert.equal(result.decision!.usageUnits, 1); assert.equal(f.state.writes, 1);
    const reads = f.state.publicationReads; f.state.failReads = true;
    assert.equal((await f.lifecycle.reserve('Bearer synthetic', 'synthetic', reserve, { idempotencyKey: 'quarter-original-key' })).replayed, true);
    assert.equal(f.state.publicationReads, reads); assert.equal(f.state.writes, 1);
    await assert.rejects(f.lifecycle.reserve('Bearer synthetic', 'synthetic', { ...reserve, expectations: { ...reserve.expectations,
      createQuarter: { ...reserve.expectations.createQuarter!, createOperationId: '33333333-3333-4333-8333-333333333333' } } }, { idempotencyKey: 'quarter-original-key' }));
    for (const change of [
      (x: any) => x.state = ['ACTIVE'], (x: any) => x.state = null,
      (x: any) => x.price.amountMinor = 600001, (x: any) => x.price.amountMinor = 0, (x: any) => x.price.amountMinor = 1.5,
      (x: any) => x.price.basis = 'ORGANIZER_QUARTER', (x: any) => x.price.participantCount = 2, (x: any) => x.price.spot = 2,
      (x: any) => x.price.durationMinutes = 90, (x: any) => x.price.currency = 'USD', (x: any) => x.basePriceMinor = 150000,
      (x: any) => x.dictionaryRevision = f.state.publication.dictionaryRevision, (x: any) => x.clientRefHash = 'provider:client',
      (x: any) => x.createOperationId += '\n', (x: any) => x.clientRefHash += '\n',
      (x: any) => x.draftId = '33333333-3333-4333-8333-333333333333', (x: any) => x.catalogue.roomIds = ['room:other'],
      (x: any) => x.catalogue.providerStudioId = 'studio:other', (x: any) => x.catalogue.masterServiceId = 'master:other', (x: any) => x.catalogue.selectorRevision = 'selector:other',
      (x: any) => x.publicationId = 'publication:other', (x: any) => x.observedAt = '2026-08-16T10:00:01.000Z',
      (x: any) => x.expiresAt = NOW, (x: any) => x.expiresAt = '2026-08-16T10:10:00.000Z',
    ]) { const g = fixture(), body = intakeBody(); change(body); await assert.rejects(g.ingest(body)); assert.equal(g.state.snapshots.length, 0); }
    for (const change of [
      (x: ReturnType<typeof fixture>) => x.state.mapping.tenantId = 'tenant:other',
      (x: ReturnType<typeof fixture>) => delete x.state.publication.createQuarterDescriptor,
      (x: ReturnType<typeof fixture>) => x.state.publication.dictionaryRevision = 'dictionary:wrong',
      (x: ReturnType<typeof fixture>) => x.state.publication.state = 'DISABLED_FOR_NEW_OPERATIONS',
      (x: ReturnType<typeof fixture>) => x.state.failReads = true,
    ]) { const g = fixture(); change(g); await assert.rejects(g.ingest()); assert.equal(g.state.snapshots.length, 0); }
    for (const change of [
      (x: ReturnType<typeof fixture>) => x.state.actorHash = 'b'.repeat(64),
      (x: ReturnType<typeof fixture>) => x.state.publication.publicationId = 'publication:changed',
      (x: ReturnType<typeof fixture>) => x.state.publication.dictionaryRevision = 'dictionary:changed',
      (x: ReturnType<typeof fixture>) => x.state.snapshots[0].basePriceMinor = 600000,
      (x: ReturnType<typeof fixture>) => x.state.aggregate.dailyUsage['2026-08-18'] = 1,
      (x: ReturnType<typeof fixture>) => { x.state.publication.runtimeProjection.usageUnitsByDuration['60'] = 2; },
      (x: ReturnType<typeof fixture>) => { x.state.publication.runtimeProjection.benefitRules[0].kind = 'PERCENT_DISCOUNT'; },
    ]) {
      const g = fixture(); await g.ingest(); const expected = await g.preflight(); change(g);
      await assert.rejects(g.preflight());
      await assert.rejects(g.lifecycle.reserve('Bearer synthetic', 'synthetic', { subscriptionInstanceId: g.request.subscriptionInstanceId,
        action: g.request.action, target: g.request.target, expectations: expected.expectations }, { idempotencyKey: 'new-quarter-key' }));
      assert.equal(g.state.writes, 0);
    }
    const downgrade = fixture();
    downgrade.repo.connect = async () => { downgrade.state.connections++; };
    const legacy = { targetId: 'exercise:legacy-create', action: 'CREATE_GAME', revision: 1, state: 'ACTIVE',
      stationId: 'station:yasenevo', category: 'GAME', externalEventTypeId: QUARTER_EVENT, productTypeId: null,
      durationMinutes: 60, startsAt: intakeBody().startsAt, basePriceMinor: 600000, currency: 'RUB',
      dictionaryRevision: downgrade.state.publication.dictionaryRevision, evidenceRef: 'evidence:legacy-target',
      priceEvidenceRef: 'evidence:legacy-price', observedAt: intakeBody().observedAt, expiresAt: intakeBody().expiresAt };
    await downgrade.ingest(legacy);
    const legacyDto = { subscriptionInstanceId: downgrade.request.subscriptionInstanceId, action: 'CREATE_GAME' as const,
      target: { targetId: legacy.targetId } };
    const legacyRequest = await downgrade.adapter.resolveEntitlementRequest(null, null, legacyDto);
    const legacyDenied = await downgrade.quote.quote(legacyRequest);
    assert.equal(legacyDenied.eligible, false);
    assert.ok(legacyDenied.blockers.some(x => x.code === 'CREATE_QUARTER_PROVENANCE_MISMATCH'));
    await assert.rejects(downgrade.lifecycle.reserve('Bearer synthetic', 'synthetic', legacyDto, { idempotencyKey: 'v1-downgrade-key' }));
    assert.equal(downgrade.state.writes, 0);
    delete downgrade.state.publication.createQuarterDescriptor; delete downgrade.state.publication.createQuarterDescriptorDigest;
    downgrade.state.publication.schemaVersion = 3;
    assert.equal((await downgrade.quote.quote(legacyRequest)).eligible, true); // truly legacy publication behavior is preserved
    const invalidPublication = fixture().state.publication;
    assert.throws(() => validateStoredSubscriptionPolicyPublication({ ...invalidPublication, schemaVersion: 3 }));
    const missingDescriptor = { ...invalidPublication }; delete missingDescriptor.createQuarterDescriptor;
    assert.throws(() => validateStoredSubscriptionPolicyPublication(missingDescriptor));
    const actor = fixture(); await actor.ingest();
    const actualRequest = await actor.adapter.resolveEntitlementRequest(null, null, actor.request);
    actor.state.instance.clientRefHash = 'b'.repeat(64); actualRequest.identity.clientRefHash = 'b'.repeat(64);
    const actorDenied = await actor.quote.quote(actualRequest);
    assert.equal(actorDenied.eligible, false); assert.ok(actorDenied.blockers.some(b => b.code === 'CREATE_QUARTER_PROVENANCE_MISMATCH'));
    const noDescriptor = fixture(); await noDescriptor.ingest();
    const oldRequest = await noDescriptor.adapter.resolveEntitlementRequest(null, null, noDescriptor.request);
    delete noDescriptor.state.publication.createQuarterDescriptor; delete noDescriptor.state.publication.createQuarterDescriptorDigest;
    noDescriptor.state.publication.schemaVersion = 3;
    assert.equal((await noDescriptor.quote.quote(oldRequest)).eligible, false); // matching revision text alone is not authority
    const reversed = fixture(); await reversed.ingest();
    const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([k,x]) => [k, reverseKeys(x)])) : v;
    reversed.state.snapshots[0] = reverseKeys(reversed.state.snapshots[0]);
    assert.deepEqual((await reversed.preflight()).expectations.createQuarter, reversed.state.snapshots[0].createQuarter!.binding);
    const incomplete = fixture(); await incomplete.ingest();
    await assert.rejects(incomplete.lifecycle.preflight('Bearer synthetic', 'synthetic', { ...incomplete.request, contractVersion: undefined }));
    const incompleteProof = await incomplete.preflight();
    for (const badBinding of [null, { ...incompleteProof.expectations.createQuarter, extra: true },
      { ...incompleteProof.expectations.createQuarter, clientRefHash: 'b'.repeat(64) }]) {
      await assert.rejects(incomplete.lifecycle.reserve('Bearer synthetic', 'synthetic', { subscriptionInstanceId: incomplete.request.subscriptionInstanceId,
        action: 'CREATE_GAME', target: incomplete.request.target, expectations: { ...incompleteProof.expectations, createQuarter: badBinding as any } }, { idempotencyKey: 'bad-binding-key' }));
    }
    assert.equal(incomplete.state.writes, 0);
    const missing = fixture(); await missing.ingest();
    await assert.rejects(missing.lifecycle.reserve('Bearer synthetic', 'synthetic', { subscriptionInstanceId: missing.request.subscriptionInstanceId,
      action: 'CREATE_GAME', target: missing.request.target }, { idempotencyKey: 'unbound-quarter-key' }));
    assert.equal(missing.state.writes, 0);
    const conflict = fixture(); await conflict.ingest(); const changed = intakeBody(); changed.price.amountMinor = 800000;
    await assert.rejects(conflict.ingest(changed)); assert.equal(conflict.state.snapshots.length, 1);
    const jsonb = JSON.parse(JSON.stringify(descriptor())); const reordered = Object.fromEntries(Object.entries(jsonb).reverse());
    assert.equal(quarterDescriptorDigest(parseQuarterDescriptor(reordered)), quarterDescriptorDigest(descriptor()));
    assert.equal(quarterDictionaryEvidence(descriptor()), `evidence:canonical-dictionary:${quarterDescriptorDigest(descriptor()).slice(7)}`);
    for (const invalid of [null, {}, { ...descriptor(), extra: true }, { ...descriptor(), dailyUsageLimit: 2 },
      { ...descriptor(), stations: [...descriptor().stations, ...descriptor().stations] }]) assert.throws(() => parseQuarterDescriptor(invalid));
    console.log('CREATE quarter intake/resolver/real quote/preflight/reserve and replay: PASS (synthetic repositories, zero provider/DB calls)');
  } finally { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
export { fixture as quarterFixture, intakeBody as quarterIntakeBody, NOW as QUARTER_NOW, TENANT as QUARTER_TENANT, TOKEN as QUARTER_TOKEN, Resolver as QuarterResolver, Quote as QuarterQuote, Lifecycle as QuarterLifecycle };
if (require.main === module) void main();
