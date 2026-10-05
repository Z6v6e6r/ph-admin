import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfirmSubscriptionSaleBindingDto } from '../src/subscriptions/dto/confirm-subscription-sale-binding.dto';
import { buildSubscriptionInstancePolicyResolution } from '../src/subscriptions/subscription-instance-policy-resolution';
import {
  LK_NODE_RED_ANNUAL_BOOKING_V1,
  publicationAdapterRuntimeCompatibility
} from '../src/subscriptions/subscription-publication-enforcement-adapter';
import {
  buildSubscriptionProjectionFence,
  subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId
} from '../src/subscriptions/subscription-projection-fence';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionSaleBindingService } from '../src/subscriptions/subscription-sale-binding.service';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping
} from '../src/subscriptions/subscriptions.types';

const TOKEN = 'sale-binding-integration-token-20260904';
const TENANT_ID = 'tenant:padlhub';
const PRODUCT_ID = 'db7a5250-7369-4f43-8ac5-9111be24bc74';
const STATION_ID = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
const SCOPE_ID = `station-set:${'9'.repeat(64)}`;
const NOW = '2026-09-04T10:01:00.000Z';
const PURCHASED_AT = '2026-09-04T10:00:00.000Z';
const OBSERVED_AT = '2026-09-04T10:00:30.000Z';
const COMPATIBILITY = publicationAdapterRuntimeCompatibility(LK_NODE_RED_ANNUAL_BOOKING_V1);

const mapping = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:hub-annual',
  tenantId: TENANT_ID,
  provider: 'VIVA',
  providerProductId: PRODUCT_ID,
  providerScope: { kind: 'STATION_SET', scopeId: SCOPE_ID },
  subscriptionTypeId: 'subscription-type:hub-annual',
  state: 'VERIFIED',
  evidenceRef: 'evidence:hub-provider-product',
  verifiedAt: '2026-09-04T09:55:00.000Z',
  verifiedBy: 'admin:subscriptions',
  revision: 3,
  createdAt: '2026-09-01T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: '2026-09-04T09:55:00.000Z',
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-hub-annual',
    requestHash: 'a'.repeat(64),
    correlationId: 'corr:mapping-hub-annual'
  }
});

const publication = (): StoredSubscriptionPolicyPublication => {
  const value: StoredSubscriptionPolicyPublication = {
    schemaVersion: 3,
    publicationId: 'publication:hub-annual-v2',
    subscriptionTypeId: mapping().subscriptionTypeId,
    policyVersion: 2,
    policyDigest: '',
    mappingId: mapping().mappingId,
    dictionaryRevision: 'dictionary:hub-20260904',
    runtimeProjection: {
      runtimeSchemaVersion: 1,
      subscriptionTypeId: mapping().subscriptionTypeId,
      policyVersion: 2,
      status: 'PUBLISHED',
      effectiveAt: '2026-09-01T00:00:00.000Z',
      timeZone: 'Europe/Moscow',
      createGame: { enabled: true, durationsMinutes: [60] },
      joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
      activeServicesLimit: { enabled: false, max: null, scope: 'ALL_BOOKINGS' },
      bookingWindow: { enabled: false, days: null },
      dailyUsageLimit: 1,
      usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
      stationAccessRules: [{
        ruleId: 'station-rule:hub',
        enabled: true,
        priority: 1,
        selector: { kind: 'STATION_LIST', stationIds: [STATION_ID, 'station:other'] },
        surcharge: { kind: 'NONE', amountMinor: 0 }
      }],
      benefitRules: [{
        ruleId: 'benefit-rule:hub-join',
        enabled: true,
        category: 'GAME',
        actions: ['JOIN_GAME'],
        externalEventTypeIds: ['viva:direction:4588:type:1613'],
        productTypeIds: [],
        durationMinutes: [60, 90, 120],
        stationIds: [STATION_ID, 'station:other'],
        kind: 'FREE_ENTITLEMENT',
        valueMinor: null,
        percentage: null,
        partialPrice: null,
        priority: 1
      }],
      lifecycle: { allowBookingsAfterExpiry: false },
      usage: {
        weeklyUsageLimit: null,
        monthlyUsageLimit: null,
        maxFutureBookings: null,
        minHoursBetweenUses: 0,
        blackoutDates: []
      }
    },
    state: 'PUBLISHED',
    effectiveAt: '2026-09-01T00:00:00.000Z',
    publishedAt: '2026-09-01T00:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:hub-annual-v2',
    approvalAuditRef: 'audit:hub-annual-v2',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'publication-hub-annual-v2',
      requestHash: 'b'.repeat(64),
      correlationId: 'corr:publication-hub-annual-v2'
    },
    runtimeCompatibility: { ...COMPATIBILITY }
  };
  value.policyDigest = computeSubscriptionRuntimeProjectionDigest(value.runtimeProjection);
  return value;
};

const releaseProgram = (): StoredReleaseProgram => ({
  schemaVersion: 1,
  releaseProgramId: 'release-program:hub-annual',
  subscriptionTypeId: mapping().subscriptionTypeId,
  stationId: STATION_ID,
  timezone: 'Europe/Moscow',
  state: 'ACTIVE',
  revision: 2,
  phases: [{
    releasePhaseId: 'release-phase:hub-annual',
    order: 1,
    mode: 'DAILY_DROP',
    totalQuantity: 100,
    dailyDropQuantity: 10,
    dailyDropLocalTime: null,
    price: { amountMinor: 5680000, currency: 'RUB' },
    activation: 'MANUAL',
    scheduledAt: null,
    providerProductRef: PRODUCT_ID
  }],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-04T09:55:00.000Z',
  createdBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'release-program-hub-annual',
    requestHash: 'c'.repeat(64),
    correlationId: 'corr:release-program-hub-annual'
  }
});

const binding = () => ({
  fenceId: subscriptionProjectionFenceId(mapping().subscriptionTypeId),
  fenceRevision: 1,
  fenceDigest: subscriptionProjectionFenceBindingDigest({
    mappingId: mapping().mappingId,
    mappingRevision: mapping().revision,
    subscriptionTypeId: mapping().subscriptionTypeId,
    publicationId: publication().publicationId,
    policyVersion: publication().policyVersion,
    policyDigest: publication().policyDigest as `sha256:${string}`,
    runtimeCompatibility: COMPATIBILITY
  }),
  mappingId: mapping().mappingId,
  mappingRevision: mapping().revision,
  subscriptionTypeId: mapping().subscriptionTypeId,
  publicationId: publication().publicationId,
  policyVersion: publication().policyVersion,
  policyDigest: publication().policyDigest,
  releaseProgramId: releaseProgram().releaseProgramId,
  releaseProgramRevision: releaseProgram().revision,
  releasePhaseId: releaseProgram().phases[0].releasePhaseId,
  runtimeCompatibility: COMPATIBILITY,
  projectorReconciliationDigest: `sha256:${'d'.repeat(64)}`
});

const fence = () => buildSubscriptionProjectionFence({
  mapping: mapping(),
  publication: publication(),
  previous: null
});

const checkpoint = () => {
  const {
    projectorReconciliationDigest: _projectorReconciliationDigest,
    ...checkpointBinding
  } = binding();
  return ({
  schemaVersion: 3 as const,
  checkpointId: 'checkpoint:hub-annual',
  tenantId: TENANT_ID,
  provider: 'VIVA' as const,
  providerProductId: PRODUCT_ID,
  providerScope: { kind: 'STATION_SET' as const, scopeId: SCOPE_ID },
  approvalRef: `provider_approval:sha256:${'e'.repeat(64)}`,
  binding: checkpointBinding,
  producer: {
    producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR' as const,
    contractVersion: 2 as const,
    producerCapabilityDigest: `sha256:${'f'.repeat(64)}` as `sha256:${string}`,
    sourceContractDigest: `sha256:${'1'.repeat(64)}` as `sha256:${string}`,
    authorityDigest: `sha256:${'2'.repeat(64)}` as `sha256:${string}`
  },
  policyResolution: buildSubscriptionInstancePolicyResolution([publication()], [{
    subscriptionInstanceId: 'subscription-instance:bootstrap',
    providerClientId: 'provider-client:bootstrap',
    clientSubscriptionId: 'client-subscription:bootstrap',
    purchasedAt: publication().effectiveAt,
    publicationId: publication().publicationId,
    policyVersion: publication().policyVersion,
    policyDigest: publication().policyDigest as `sha256:${string}`,
    mappingId: publication().mappingId
  }]),
  state: 'CURRENT' as const,
  coverage: {
    kind: 'CONSISTENT_FULL_SNAPSHOT' as const,
    snapshotId: 'snapshot:hub-annual',
    snapshotDigest: `sha256:${'3'.repeat(64)}` as `sha256:${string}`,
    coverageThrough: '2026-09-04T09:59:00.000Z',
    sourceItemCount: 1
  },
  reconciliation: {
    runId: 'run:hub-annual',
    mode: 'INITIAL_FULL' as const,
    startedAt: '2026-09-04T09:58:00.000Z',
    completedAt: '2026-09-04T09:59:00.000Z',
    sourceItemCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    replayedCount: 0,
    terminalCount: 0,
    failureCount: 0,
    sourceEvidenceRef: `provider_snapshot_evidence:sha256:${'4'.repeat(64)}`,
    resultEvidenceRef: `projection_result:sha256:${'5'.repeat(64)}`,
    reconciliationDigest: binding().projectorReconciliationDigest as `sha256:${string}`
  },
  failure: null,
  lease: null,
  revision: 1,
  createdAt: '2026-09-04T09:59:00.000Z',
  updatedAt: '2026-09-04T09:59:00.000Z'
  });
};

const dto = (): ConfirmSubscriptionSaleBindingDto => Object.assign(
  new ConfirmSubscriptionSaleBindingDto(),
  {
    provider: 'VIVA' as const,
    providerProductId: PRODUCT_ID,
    providerScopeKind: 'STATION_SET' as const,
    providerScopeId: SCOPE_ID,
    providerClientId: 'provider-client:hub-001',
    clientSubscriptionId: 'client-subscription:hub-001',
    providerTransactionId: 'transaction:hub-001',
    providerTransactionStatus: 'PAID' as const,
    providerSubscriptionState: 'PENDING_ACTIVATION' as const,
    homeStationId: STATION_ID,
    purchasePriceMinor: 5680000,
    purchasedAt: PURCHASED_AT,
    activeFrom: null,
    activeTo: null,
    providerObservedAt: OBSERVED_AT,
    requiredAdapterId: COMPATIBILITY.adapterId,
    requiredContractVersion: COMPATIBILITY.contractVersion,
    requiredCapabilityDigest: COMPATIBILITY.capabilityDigest,
    expectedMappingId: binding().mappingId,
    expectedMappingRevision: binding().mappingRevision,
    expectedSubscriptionTypeId: binding().subscriptionTypeId,
    expectedPublicationId: binding().publicationId,
    expectedPolicyVersion: binding().policyVersion,
    expectedPolicyDigest: binding().policyDigest,
    expectedFenceId: binding().fenceId,
    expectedFenceRevision: binding().fenceRevision,
    expectedFenceDigest: binding().fenceDigest,
    expectedProjectorReconciliationDigest: binding().projectorReconciliationDigest,
    expectedReleaseProgramId: binding().releaseProgramId,
    expectedReleaseProgramRevision: binding().releaseProgramRevision,
    expectedReleasePhaseId: binding().releasePhaseId
  }
);

class RepositoryStub {
  applyResult: 'INSERTED' | 'EXACT_REPLAY' = 'INSERTED';
  applied: any = null;
  replay: any = null;
  replayInput: any = null;
  async connect() {}
  async confirmedRuntimeSaleBindingReplay(input: unknown) {
    this.replayInput = input;
    return this.replay;
  }
  async runtimeProviderMappingByProviderIdentity() { return mapping(); }
  async runtimeInstanceProjectorCheckpointByProviderIdentity() {
    const value = checkpoint();
    delete (value.binding as any).projectorReconciliationDigest;
    return value;
  }
  async runtimeProjectionFenceByType() {
    return {
      ...fence(),
      lastProjectorReconciliationDigest: binding().projectorReconciliationDigest
    };
  }
  async runtimePolicyPublicationHistoryByType() { return [publication()]; }
  async releaseProgramById() { return releaseProgram(); }
  async applyConfirmedRuntimeSaleBinding(input: unknown) {
    this.applied = input;
    return this.applyResult;
  }
}

class FixedClockService extends SubscriptionSaleBindingService {
  protected now(): Date { return new Date(NOW); }
}

class LateClockService extends SubscriptionSaleBindingService {
  protected now(): Date { return new Date('2026-09-04T11:01:00.000Z'); }
}

const readinessStub = () => ({
  checkTrusted: async () => ({
    schemaVersion: 1 as const,
    ready: true,
    provider: 'VIVA' as const,
    providerProductId: PRODUCT_ID,
    providerScope: { kind: 'STATION_SET' as const, scopeId: SCOPE_ID },
    checkedAt: '2026-09-04T09:59:30.000Z',
    requiredCompatibility: COMPATIBILITY,
    mapping: null,
    publication: null,
    instanceProjector: { status: 'CURRENT' as const, checkpointAsOf: '2026-09-04T09:59:00.000Z' },
    binding: binding(),
    blockers: []
  })
});

const exceptionCode = (error: unknown): string | undefined => {
  if (!(error instanceof ServiceUnavailableException)
    && !(error instanceof ForbiddenException)
    && !(error instanceof ConflictException)) return undefined;
  const response = error.getResponse();
  return response && typeof response === 'object' && 'code' in response
    ? String((response as { code: unknown }).code)
    : undefined;
};

const configure = () => {
  process.env.SUBSCRIPTIONS_SALE_BINDING_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN =
    'sale-readiness-integration-token-distinct-20260904';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = TENANT_ID;
  process.env.SUBSCRIPTIONS_HASH_PEPPER = 'sale-binding-test-pepper-at-least-32-bytes';
};

async function main(): Promise<void> {
  configure();
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata = { type: 'body' as const, metatype: ConfirmSubscriptionSaleBindingDto, data: '' };
  await pipe.transform({ ...dto() }, metadata);
  await assert.rejects(() => pipe.transform({ ...dto(), providerTransactionStatus: 'PENDING' }, metadata));
  await assert.rejects(() => pipe.transform({ ...dto(), unexpected: true }, metadata));

  process.env.SUBSCRIPTIONS_SALE_BINDING_ENABLED = 'false';
  await assert.rejects(
    () => new FixedClockService(new RepositoryStub() as any, readinessStub() as any)
      .confirm(TOKEN, 'idempotency:hub-001', 'correlation:hub-001', dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_BINDING_DISABLED'
  );
  configure();
  await assert.rejects(
    () => new FixedClockService(new RepositoryStub() as any, readinessStub() as any)
      .confirm('wrong-token', 'idempotency:hub-001', 'correlation:hub-001', dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_FORBIDDEN'
  );
  configure();
  process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN = TOKEN;
  await assert.rejects(
    () => new FixedClockService(new RepositoryStub() as any, readinessStub() as any)
      .confirm(TOKEN, 'idempotency:hub-001', 'correlation:hub-001', dto()),
    (error) => exceptionCode(error)
      === 'SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_TOKEN_NOT_DISTINCT'
  );
  configure();

  const repository = new RepositoryStub();
  const service = new FixedClockService(repository as any, readinessStub() as any);
  const result = await service.confirm(
    TOKEN,
    'idempotency:hub-001',
    'correlation:hub-001',
    dto()
  );
  assert.equal(result.state, 'BOUND');
  assert.equal(result.replayed, false);
  assert.equal(result.clientSubscriptionId, dto().clientSubscriptionId);
  assert.match(result.subscriptionInstanceId, /^subscription_instance:[a-f0-9]{64}$/);
  assert.equal(repository.applied.instance.state, 'PENDING_ACTIVATION');
  assert.equal(repository.applied.operation.kind, 'PURCHASE');
  assert.equal(repository.applied.operation.state, 'CONFIRMED');
  assert.equal(repository.applied.ledger.eventType, 'PURCHASE_PAID');
  assert.equal(repository.applied.outbox.topic, 'SUBSCRIPTION_LEDGER_EVENT');
  assert.doesNotMatch(JSON.stringify(result), /providerClientId|providerTransactionId|EvidenceRef/);

  const lateRepository = new RepositoryStub();
  await new LateClockService(lateRepository as any, readinessStub() as any).confirm(
    TOKEN,
    'idempotency:hub-001',
    'correlation:hub-001',
    dto()
  );
  assert.deepEqual(lateRepository.applied.instance, repository.applied.instance);
  assert.deepEqual(lateRepository.applied.operation, repository.applied.operation);
  assert.deepEqual(lateRepository.applied.ledger, repository.applied.ledger);
  assert.deepEqual(lateRepository.applied.outbox, repository.applied.outbox);

  repository.applyResult = 'EXACT_REPLAY';
  const replay = await service.confirm(
    TOKEN,
    'idempotency:hub-001',
    'correlation:hub-001',
    dto()
  );
  assert.equal(replay.replayed, true);

  const durableReplayRepository = new RepositoryStub();
  durableReplayRepository.replay = structuredClone(repository.applied.instance);
  const unavailableReadiness = {
    checkTrusted: async () => {
      throw new Error('current readiness must not be read for a durable exact replay');
    }
  };
  const durableReplay = await new FixedClockService(
    durableReplayRepository as any,
    unavailableReadiness as any
  ).confirm(TOKEN, 'idempotency:hub-001', 'correlation:hub-001', dto());
  assert.equal(durableReplay.replayed, true);
  assert.equal(durableReplay.subscriptionInstanceId, repository.applied.instance.subscriptionInstanceId);

  const originalReplayHash = durableReplayRepository.replayInput.requestHash;
  const advancedProviderReadback = Object.assign(dto(), {
    providerTransactionStatus: 'COMPLETED' as const,
    purchasedAt: '2026-09-04T10:00:10.000Z',
    providerSubscriptionState: 'ACTIVE' as const,
    homeStationId: 'station:corrected-provider-readback',
    activeFrom: '2026-09-04T10:00:30.000Z',
    activeTo: '2027-09-04T10:00:30.000Z',
    providerObservedAt: '2026-09-04T10:00:45.000Z'
  });
  const advancedReplay = await new FixedClockService(
    durableReplayRepository as any,
    unavailableReadiness as any
  ).confirm(TOKEN, 'idempotency:hub-001', 'correlation:hub-001', advancedProviderReadback);
  assert.equal(advancedReplay.replayed, true);
  assert.equal(durableReplayRepository.replayInput.requestHash, originalReplayHash);

  const changedReadiness = readinessStub();
  changedReadiness.checkTrusted = async () => ({
    ...(await readinessStub().checkTrusted()),
    binding: { ...binding(), mappingRevision: binding().mappingRevision + 1 }
  });
  await assert.rejects(
    () => new FixedClockService(new RepositoryStub() as any, changedReadiness as any)
      .confirm(TOKEN, 'idempotency:hub-001', 'correlation:hub-001', dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_BINDING_READINESS_CHANGED'
  );

  await assert.rejects(
    () => service.confirm(TOKEN, 'idempotency:hub-002', 'correlation:hub-002', Object.assign(dto(), {
      providerSubscriptionState: 'ACTIVE', activeFrom: null, activeTo: null
    })),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_BINDING_PROVIDER_TIME_CONFLICT'
  );
  console.log('subscriptions sale binding tests: OK');
}

void main();
