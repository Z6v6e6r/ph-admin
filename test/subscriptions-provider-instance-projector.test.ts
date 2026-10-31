import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MongoClient, MongoServerError } from 'mongodb';
import {
  buildSubscriptionInstanceProjectionPlan as buildSubscriptionInstanceProjectionPlanWithHistory,
  assertSubscriptionInstanceProjectionApplyBoundary,
  subscriptionInstanceProjectionInputFingerprint,
  subscriptionInstanceProjectionTargetFingerprint,
  SubscriptionProviderInstanceProjectorService
} from '../src/subscriptions/subscription-provider-instance-projector.service';
import {
  computeSubscriptionRuntimeProjectionDigest,
  computeSubscriptionUsageLedgerEventHash,
  SubscriptionRuntimeContractError
} from '../src/subscriptions/subscription-runtime-contracts';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping
} from '../src/subscriptions/subscriptions.types';
import { parseQuarterDescriptor, quarterDescriptorDigest, quarterDictionaryRevision } from '../src/subscriptions/subscription-create-quarter-contract';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { buildSubscriptionProjectionFence } from '../src/subscriptions/subscription-projection-fence';
import {
  parseProjectorInputJson,
  sanitizedProjectorOutput,
  safeProjectorErrorCode
} from '../scripts/managed-subscriptions-instance-projector';

const HASH = 'a'.repeat(64);
export const PEPPER = 'projector-test-pepper-is-at-least-32-bytes';
const NOW = '2026-08-28T09:00:00.000Z';
const COVERAGE = '2026-08-28T08:59:50.000Z';
const PRODUCT_ID = 'provider-product-annual-piter';
const STATION_ID = 'station:piter';

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map((key) => [key, stable((value as Record<string, unknown>)[key])]));
};
const digest = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256')
  .update(JSON.stringify(stable(value)))
  .digest('hex')}`;
const evidence = (kind: string, digit = 'a'): string => `${kind}:sha256:${digit.repeat(64)}`;

export const record = (): Record<string, unknown> => ({
  providerClientId: 'provider-client-001',
  clientSubscriptionId: 'client-subscription-001',
  homeStationId: STATION_ID,
  purchasePrice: { amountMinor: 1200000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: '2026-08-01T10:00:00.000Z',
  activeFrom: '2026-08-01T10:00:00.000Z',
  activeTo: '2027-08-01T10:00:00.000Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  paymentEvidenceRef: evidence('provider_payment_evidence', 'b'),
  providerInstanceEvidenceRef: evidence('provider_instance_evidence', 'c'),
  lastReadBackEvidenceRef: evidence('provider_readback_evidence', 'd')
});

const compatibility = {
  adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
  contractVersion: 1,
  capabilityDigest: `sha256:${HASH}` as `sha256:${string}`
};

const mapping = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:annual-piter',
  tenantId: 'tenant:piter',
  provider: 'VIVA',
  providerProductId: PRODUCT_ID,
  providerScope: { kind: 'STATION', scopeId: STATION_ID },
  subscriptionTypeId: 'subscription_type:annual-piter',
  state: 'VERIFIED',
  evidenceRef: evidence('provider_mapping_evidence'),
  verifiedAt: COVERAGE,
  verifiedBy: 'admin:subscriptions',
  revision: 3,
  createdAt: COVERAGE,
  createdBy: 'admin:subscriptions',
  updatedAt: COVERAGE,
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-annual-piter',
    requestHash: HASH,
    correlationId: 'correlation:mapping-annual-piter'
  }
});

const publication = (): StoredSubscriptionPolicyPublication => {
  const value: StoredSubscriptionPolicyPublication = {
    schemaVersion: 3,
    publicationId: 'publication:annual-piter-v1',
    subscriptionTypeId: 'subscription_type:annual-piter',
    policyVersion: 1,
    policyDigest: `sha256:${HASH}`,
    mappingId: 'mapping:annual-piter',
    dictionaryRevision: evidence('provider_dictionary'),
    runtimeProjection: {
      runtimeSchemaVersion: 1,
      subscriptionTypeId: 'subscription_type:annual-piter',
      policyVersion: 1,
      status: 'PUBLISHED',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      timeZone: 'Europe/Moscow',
      createGame: { enabled: true, durationsMinutes: [60] },
      joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
      activeServicesLimit: { enabled: false, max: null, scope: 'ALL_BOOKINGS' },
      bookingWindow: { enabled: false, days: null },
      dailyUsageLimit: 1,
      usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
      stationAccessRules: [{
        ruleId: 'station_rule:piter',
        enabled: true,
        priority: 1,
        selector: { kind: 'STATION_LIST', stationIds: [STATION_ID] },
        surcharge: { kind: 'NONE', amountMinor: 0 }
      }],
      benefitRules: [{
        ruleId: 'benefit_rule:join-game',
        enabled: true,
        category: 'GAME',
        actions: ['JOIN_GAME'],
        externalEventTypeIds: ['viva:direction:4588:type:1613'],
        productTypeIds: [],
        durationMinutes: [60, 90, 120],
        stationIds: [STATION_ID],
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
    effectiveAt: '2026-08-01T00:00:00.000Z',
    publishedAt: '2026-07-31T10:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:annual-piter-v1',
    approvalAuditRef: 'audit:annual-piter-v1',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'publication-annual-piter-v1',
      requestHash: HASH,
      correlationId: 'correlation:publication-annual-piter-v1'
    },
    runtimeCompatibility: compatibility
  };
  value.policyDigest = computeSubscriptionRuntimeProjectionDigest(value.runtimeProjection);
  return value;
};

export function quarterPublication(value = publication(), effectiveAt = '2026-08-27T00:00:00.000Z'): StoredSubscriptionPolicyPublication {
  value.schemaVersion = 4;
  value.policyVersion = 2;
  value.publicationId = 'publication:annual-piter-v2';
  value.effectiveAt = value.publishedAt = effectiveAt;
  value.runtimeProjection.policyVersion = 2;
  value.runtimeProjection.effectiveAt = value.effectiveAt;
  value.runtimeProjection.benefitRules[0].actions = ['CREATE_GAME'];
  value.runtimeProjection.benefitRules[0].durationMinutes = [60];
  const descriptor = parseQuarterDescriptor({ schemaVersion: 1, kind: 'ORGANIZER_QUARTER_CREATE',
    directionId: '4588', typeId: '1613', selectorRevision: 'selector:quarter-v1', durationMinutes: 60,
    participantCount: 4, spot: 1, currency: 'RUB', priceBasis: 'ORGANIZER_QUARTER',
    benefitKind: 'FREE_ENTITLEMENT', usageUnits: 1, dailyUsageLimit: 1,
    stations: [{ stationId: value.runtimeProjection.stationAccessRules[0].selector.stationIds[0], providerStudioId: 'studio:piter', masterServiceId: 'service:master', subServiceId: 'service:sub' }] });
  value.createQuarterDescriptor = descriptor;
  value.createQuarterDescriptorDigest = quarterDescriptorDigest(descriptor);
  value.dictionaryRevision = quarterDictionaryRevision(descriptor);
  value.policyDigest = computeSubscriptionRuntimeProjectionDigest(value.runtimeProjection);
  return value;
}

const buildSubscriptionInstanceProjectionPlan = (
  input: unknown,
  pepper: unknown,
  publications: readonly StoredSubscriptionPolicyPublication[] = [publication()]
) => buildSubscriptionInstanceProjectionPlanWithHistory(input, pepper, publications);

export const twoPublicationHistory = (): [
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyPublication
] => {
  const first = publication();
  const second: StoredSubscriptionPolicyPublication = {
    ...structuredClone(first),
    publicationId: 'publication:annual-piter-v2',
    policyVersion: 2,
    effectiveAt: '2026-08-15T00:00:00.000Z',
    publishedAt: '2026-08-14T10:00:00.000Z',
    impactPreviewRef: 'impact:annual-piter-v2',
    approvalAuditRef: 'audit:annual-piter-v2',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'publication-annual-piter-v2',
      requestHash: HASH,
      correlationId: 'correlation:publication-annual-piter-v2'
    },
    runtimeProjection: {
      ...structuredClone(first.runtimeProjection),
      policyVersion: 2,
      effectiveAt: '2026-08-15T00:00:00.000Z'
    }
  };
  second.policyDigest = computeSubscriptionRuntimeProjectionDigest(second.runtimeProjection);
  first.state = 'SUPERSEDED';
  first.supersededAt = second.publishedAt;
  first.supersededBy = second.publicationId;
  return [first, second];
};

export const manifestForHistory = (
  records: Array<Record<string, unknown>>,
  history: readonly StoredSubscriptionPolicyPublication[]
): Record<string, unknown> => {
  const current = history.at(-1)!;
  const fence = buildSubscriptionProjectionFence({
    mapping: mapping(),
    publication: current,
    previous: history.length > 1 ? projectionFence() : null
  });
  const sortedRecords = [...records].sort((left, right) => {
    const leftId = `${String(left.providerClientId)}\0${String(left.clientSubscriptionId)}`;
    const rightId = `${String(right.providerClientId)}\0${String(right.clientSubscriptionId)}`;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const base = manifest();
  return {
    ...base,
    binding: {
      ...(base.binding as Record<string, unknown>),
      fenceId: fence.fenceId,
      fenceRevision: fence.bindingRevision,
      fenceDigest: fence.bindingDigest,
      publicationId: current.publicationId,
      policyVersion: current.policyVersion,
      policyDigest: current.policyDigest
    },
    authority: {
      ...(base.authority as Record<string, unknown>),
      sourceItemCount: records.length
    },
    snapshot: {
      ...(base.snapshot as Record<string, unknown>),
      snapshotDigest: digest(sortedRecords)
    },
    records
  };
};

const releaseProgram = (): StoredReleaseProgram => ({
  schemaVersion: 1,
  releaseProgramId: 'release_program:annual-piter',
  subscriptionTypeId: 'subscription_type:annual-piter',
  stationId: STATION_ID,
  timezone: 'Europe/Moscow',
  state: 'CLOSED',
  revision: 1,
  phases: [{
    releasePhaseId: 'release_phase:annual-piter',
    order: 1,
    mode: 'BULK',
    totalQuantity: 100,
    dailyDropQuantity: null,
    dailyDropLocalTime: null,
    price: { amountMinor: 1200000, currency: 'RUB' },
    activation: 'MANUAL',
    scheduledAt: null,
    providerProductRef: PRODUCT_ID
  }],
  createdAt: COVERAGE,
  updatedAt: COVERAGE,
  createdBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'release-program-annual-piter',
    requestHash: HASH,
    correlationId: 'correlation:release-program-annual-piter'
  }
});

const projectionFence = () => buildSubscriptionProjectionFence({
  mapping: mapping(),
  publication: publication(),
  previous: null
});

const manifest = (): Record<string, unknown> => {
  const records = [record()];
  const published = publication();
  return {
    schemaVersion: 2,
    sourceMode: 'VIVA_AUTHORITATIVE_COMPLETE_SUBSCRIPTION_INSTANCE_SNAPSHOT',
    evidenceStatus: 'APPROVED',
    approvalRef: evidence('provider_approval'),
    tenantId: 'tenant:piter',
    provider: 'VIVA',
    providerProductId: PRODUCT_ID,
    providerScope: { kind: 'STATION', scopeId: STATION_ID },
    binding: {
      fenceId: projectionFence().fenceId,
      fenceRevision: projectionFence().bindingRevision,
      fenceDigest: projectionFence().bindingDigest,
      mappingId: 'mapping:annual-piter',
      mappingRevision: 3,
      subscriptionTypeId: 'subscription_type:annual-piter',
      publicationId: 'publication:annual-piter-v1',
      policyVersion: 1,
      policyDigest: published.policyDigest,
      releaseProgramId: 'release_program:annual-piter',
      releaseProgramRevision: 1,
      releasePhaseId: 'release_phase:annual-piter',
      runtimeCompatibility: compatibility
    },
    producer: {
      producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR',
      contractVersion: 2,
      producerCapabilityDigest: evidence('sha256').slice(7),
      sourceContractDigest: `sha256:${'f'.repeat(64)}`
    },
    authority: {
      sourceSystem: 'VIVA',
      resourceKind: 'SUBSCRIPTION_INSTANCE',
      selectionMode: 'EXACT_PRODUCT_AND_SCOPE',
      snapshotSemantics: 'COMPLETE_AS_OF',
      endpointContractDigest: `sha256:${'1'.repeat(64)}`,
      queryContractDigest: `sha256:${'2'.repeat(64)}`,
      paginationContractDigest: `sha256:${'3'.repeat(64)}`,
      normalizationContractDigest: `sha256:${'4'.repeat(64)}`,
      stateMappingDigest: `sha256:${'5'.repeat(64)}`,
      moneyMappingDigest: `sha256:${'6'.repeat(64)}`,
      completenessEvidenceRef: evidence('provider_completeness_evidence', '7'),
      pageCount: 1,
      sourceItemCount: records.length,
      rejectedItemCount: 0,
      duplicateIdentityCount: 0
    },
    snapshot: {
      snapshotId: 'snapshot:annual-piter-20260828',
      snapshotDigest: digest(records),
      startedAt: '2026-08-28T08:59:45.000Z',
      coverageThrough: COVERAGE,
      sourceEvidenceRef: evidence('provider_snapshot_evidence'),
      resultEvidenceRef: evidence('projection_result')
    },
    records
  };
};

class FakeRepository {
  preflightStatus: 'READY_TO_INSERT' | 'EXACT_REPLAY' = 'READY_TO_INSERT';
  applyStatus: 'INSERTED' | 'EXACT_REPLAY' = 'INSERTED';
  connectCalls = 0;
  connectReadOnlyCalls = 0;
  applyCalls = 0;
  preflightCalls = 0;
  mapping = mapping();
  publication = publication();
  publicationHistory: StoredSubscriptionPolicyPublication[] = [publication()];
  program = releaseProgram();
  subscriptionType = { state: 'ACTIVE', currentPolicyVersion: 1 };
  fence: ReturnType<typeof projectionFence> | null = projectionFence();

  async connect(): Promise<void> { this.connectCalls += 1; }
  async connectReadOnly(): Promise<void> { this.connectReadOnlyCalls += 1; }
  async runtimeProviderMappingByProviderIdentity(): Promise<StoredSubscriptionProviderMapping | null> { return this.mapping; }
  async runtimePolicyPublicationByVersion(): Promise<StoredSubscriptionPolicyPublication | null> { return this.publication; }
  async runtimePolicyPublicationHistoryByType(): Promise<StoredSubscriptionPolicyPublication[]> {
    return structuredClone(this.publicationHistory);
  }
  async releaseProgramById(): Promise<StoredReleaseProgram | null> { return this.program; }
  async subscriptionTypeById(): Promise<any> { return this.subscriptionType; }
  async runtimeProjectionFenceByType(): Promise<any> {
    return this.fence ? structuredClone(this.fence) : null;
  }
  async preflightInitialRuntimeInstanceProjection(): Promise<'READY_TO_INSERT' | 'EXACT_REPLAY'> {
    this.preflightCalls += 1;
    return this.preflightStatus;
  }
  async applyInitialRuntimeInstanceProjection(): Promise<'INSERTED' | 'EXACT_REPLAY'> {
    this.applyCalls += 1;
    return this.applyStatus;
  }
}

class FixedClockService extends SubscriptionProviderInstanceProjectorService {
  protected override now(): Date { return new Date(NOW); }
}

async function verifyRealMongoPostcommitReadback(
  input: Record<string, unknown>,
  plan: ReturnType<typeof buildSubscriptionInstanceProjectionPlan>
): Promise<void> {
  const uri = String(process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_MONGODB_TEST_URI ?? '').trim();
  if (!uri) {
    console.log('subscriptions instance projector MongoDB postcommit test: SKIP');
    return;
  }
  const parsedUri = new URL(uri);
  assert.equal(parsedUri.protocol, 'mongodb:', 'MongoDB test URI must use mongodb://');
  assert.equal(parsedUri.username, '', 'MongoDB test URI must not contain credentials');
  assert.equal(parsedUri.password, '', 'MongoDB test URI must not contain credentials');
  assert.equal(parsedUri.pathname, '/', 'MongoDB test URI must not select a shared database');
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsedUri.hostname),
    'MongoDB test URI must target loopback'
  );
  const dbPrefix = `ip_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const dbNames = {
    postcommit: `${dbPrefix}_postcommit`,
    concurrent: `${dbPrefix}_concurrent`,
    bootstrapConcurrent: `${dbPrefix}_bootstrap_concurrent`,
    fullReplay: `${dbPrefix}_full_replay`,
    fullRollback: `${dbPrefix}_full_rollback`,
    saleFirst: `${dbPrefix}_sale_first`,
    projectionFirst: `${dbPrefix}_projection_first`,
    checkpointFailure: `${dbPrefix}_checkpoint_failure`,
    bootstrapCheckpointFailure: `${dbPrefix}_bootstrap_checkpoint_failure`,
    instanceFailure: `${dbPrefix}_instance_failure`
  };
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, directConnection: true });
  const inputSnapshot = structuredClone(input);
  const planSnapshot = structuredClone(plan);
  const countMongoIds = (value: unknown): number => {
    if (Array.isArray(value)) {
      return value.reduce((count, item) => count + countMongoIds(item), 0);
    }
    if (!value || typeof value !== 'object') return 0;
    return Object.entries(value).reduce(
      (count, [key, item]) => count + (key === '_id' ? 1 : 0) + countMongoIds(item),
      0
    );
  };
  await client.connect();
  for (const dbName of Object.values(dbNames)) {
    const db = client.db(dbName);
    await Promise.all([
      db.collection('subscription_policy_publications').insertOne(structuredClone(publication())),
      db.collection('subscription_provider_mappings').insertOne(structuredClone(mapping())),
      db.collection('subscription_release_programs').insertOne(structuredClone(releaseProgram())),
      db.collection('subscription_types').insertOne({
        subscriptionTypeId: 'subscription_type:annual-piter',
        state: 'ACTIVE',
        currentPolicyVersion: 1
      })
    ]);
  }
  const repositoryFor = (dbName: string): SubscriptionsRepository => {
    const repository = new SubscriptionsRepository() as any;
    repository.client = client;
    repository.db = client.db(dbName);
    return repository as SubscriptionsRepository;
  };
  const seedFence = async (dbName: string): Promise<void> => {
    await client.db(dbName).collection('subscription_projection_fences')
      .insertOne(structuredClone(projectionFence()));
  };
  const assertFenceUnchanged = async (dbName: string): Promise<void> => {
    assert.deepEqual(
      await client.db(dbName).collection('subscription_projection_fences')
        .findOne({}, { projection: { _id: 0 } }),
      projectionFence()
    );
  };
  let testError: unknown;
  try {
    const db = client.db(dbNames.postcommit);
    await seedFence(dbNames.postcommit);
    const repository = repositoryFor(dbNames.postcommit);
    let applyError: unknown;
    let applyResult: 'INSERTED' | 'EXACT_REPLAY' | undefined;
    try {
      applyResult = await repository.applyInitialRuntimeInstanceProjection(plan);
    } catch (error) {
      applyError = error;
    }
    const instanceCount = await db.collection('subscription_instances').countDocuments({});
    const checkpointCount = await db.collection('subscription_instance_projector_checkpoints')
      .countDocuments({});
    if (applyError) {
      const errorCode = applyError instanceof SubscriptionRuntimeContractError
        ? applyError.code
        : applyError instanceof Error ? applyError.message : String(applyError);
      assert.equal(errorCode, 'SUBSCRIPTION_RUNTIME_SHAPE_INVALID');
      assert.equal(instanceCount, plan.instances.length);
      assert.equal(checkpointCount, 1);
      assert.deepEqual(input, inputSnapshot, 'caller-owned manifest must remain immutable');
      assert.notDeepEqual(plan, planSnapshot, 'current regression must expose plan mutation');
      const planMongoIdCount = countMongoIds(plan);
      assert.equal(planMongoIdCount, plan.instances.length + 1);
      assert.fail(
        `initial projector apply threw ${errorCode} after committed readback `
          + `instances=${instanceCount} checkpoints=${checkpointCount} `
          + `callerPlanMongoIds=${planMongoIdCount}`
      );
    }
    assert.equal(applyResult, 'INSERTED');
    assert.deepEqual(input, inputSnapshot, 'caller-owned manifest must remain immutable');
    assert.deepEqual(plan, planSnapshot, 'caller-owned projection plan must remain immutable');
    assert.equal(countMongoIds(input), 0);
    assert.equal(countMongoIds(plan), 0);
    assert.equal(
      instanceCount,
      plan.instances.length
    );
    assert.equal(
      checkpointCount,
      1
    );
    assert.equal(
      await repository.preflightInitialRuntimeInstanceProjection(plan),
      'EXACT_REPLAY',
      'strict persisted readback must match the original canonical plan'
    );
    assert.equal(
      await repository.applyInitialRuntimeInstanceProjection(plan),
      'EXACT_REPLAY',
      'retrying the same in-memory plan must be an exact replay'
    );
    assert.equal(await repository.applyInitialRuntimeInstanceProjection(
      buildSubscriptionInstanceProjectionPlan(manifest(), PEPPER)
    ), 'EXACT_REPLAY');
    assert.equal(await db.collection('subscription_instances').countDocuments({}), plan.instances.length);
    assert.equal(
      await db.collection('subscription_instance_projector_checkpoints').countDocuments({}),
      1
    );

    await seedFence(dbNames.concurrent);
    const concurrentResults = await Promise.all([
      repositoryFor(dbNames.concurrent).applyInitialRuntimeInstanceProjection(plan),
      repositoryFor(dbNames.concurrent).applyInitialRuntimeInstanceProjection(plan)
    ]);
    assert.deepEqual([...concurrentResults].sort(), ['EXACT_REPLAY', 'INSERTED']);
    const concurrentDb = client.db(dbNames.concurrent);
    const concurrentInstances = await concurrentDb.collection('subscription_instances')
      .find({}, { projection: { _id: 0 } }).toArray();
    assert.equal(concurrentInstances.length, plan.instances.length);
    assert.equal(
      new Set(concurrentInstances.map((instance) => instance.subscriptionInstanceId)).size,
      plan.instances.length,
      'concurrent apply must not create duplicate instance rows'
    );
    assert.equal(
      await concurrentDb.collection('subscription_instance_projector_checkpoints').countDocuments({}),
      1
    );

    const bootstrapConcurrentDb = client.db(dbNames.bootstrapConcurrent);
    await bootstrapConcurrentDb.collection('subscription_projection_fences')
      .createIndex({ subscriptionTypeId: 1 }, { unique: true });
    await bootstrapConcurrentDb.collection('subscription_instances')
      .createIndex({ subscriptionInstanceId: 1 }, { unique: true });
    await bootstrapConcurrentDb.collection('subscription_instance_projector_checkpoints')
      .createIndex({ checkpointId: 1 }, { unique: true });
    const bootstrapConcurrentResults = await Promise.all([
      repositoryFor(dbNames.bootstrapConcurrent).applyInitialRuntimeInstanceProjection(plan),
      repositoryFor(dbNames.bootstrapConcurrent).applyInitialRuntimeInstanceProjection(plan)
    ]);
    assert.deepEqual([...bootstrapConcurrentResults].sort(), ['EXACT_REPLAY', 'INSERTED']);
    assert.equal(
      await bootstrapConcurrentDb.collection('subscription_projection_fences').countDocuments({}),
      1
    );
    assert.equal(
      await bootstrapConcurrentDb.collection('subscription_instances').countDocuments({}),
      plan.instances.length
    );
    assert.equal(
      await bootstrapConcurrentDb.collection('subscription_instance_projector_checkpoints')
        .countDocuments({}),
      1
    );

    const checkpointFailureDb = client.db(dbNames.checkpointFailure);
    await seedFence(dbNames.checkpointFailure);
    await checkpointFailureDb.createCollection('subscription_instance_projector_checkpoints', {
      validator: { $jsonSchema: { bsonType: 'object', required: ['forcedMissingField'] } },
      validationLevel: 'strict',
      validationAction: 'error'
    });
    await assert.rejects(
      repositoryFor(dbNames.checkpointFailure).applyInitialRuntimeInstanceProjection(plan),
      (error: unknown) => error instanceof MongoServerError && error.code === 121
    );
    assert.equal(await checkpointFailureDb.collection('subscription_instances').countDocuments({}), 0);
    assert.equal(
      await checkpointFailureDb.collection('subscription_instance_projector_checkpoints')
        .countDocuments({}),
      0
    );
    await assertFenceUnchanged(dbNames.checkpointFailure);

    const bootstrapCheckpointFailureDb = client.db(dbNames.bootstrapCheckpointFailure);
    await bootstrapCheckpointFailureDb.createCollection(
      'subscription_instance_projector_checkpoints',
      {
        validator: { $jsonSchema: { bsonType: 'object', required: ['forcedMissingField'] } },
        validationLevel: 'strict',
        validationAction: 'error'
      }
    );
    await assert.rejects(
      repositoryFor(dbNames.bootstrapCheckpointFailure).applyInitialRuntimeInstanceProjection(plan),
      (error: unknown) => error instanceof MongoServerError && error.code === 121
    );
    assert.equal(
      await bootstrapCheckpointFailureDb.collection('subscription_projection_fences')
        .countDocuments({}),
      0
    );
    assert.equal(
      await bootstrapCheckpointFailureDb.collection('subscription_instances').countDocuments({}),
      0
    );
    assert.equal(
      await bootstrapCheckpointFailureDb.collection('subscription_instance_projector_checkpoints')
        .countDocuments({}),
      0
    );

    const instanceFailureDb = client.db(dbNames.instanceFailure);
    await seedFence(dbNames.instanceFailure);
    await instanceFailureDb.createCollection('subscription_instances', {
      validator: { $jsonSchema: { bsonType: 'object', required: ['forcedMissingField'] } },
      validationLevel: 'strict',
      validationAction: 'error'
    });
    await assert.rejects(
      repositoryFor(dbNames.instanceFailure).applyInitialRuntimeInstanceProjection(plan),
      (error: unknown) => error instanceof MongoServerError && error.code === 121
    );
    assert.equal(await instanceFailureDb.collection('subscription_instances').countDocuments({}), 0);
    assert.equal(
      await instanceFailureDb.collection('subscription_instance_projector_checkpoints')
        .countDocuments({}),
      0
    );
    await assertFenceUnchanged(dbNames.instanceFailure);
    await verifyFullMongoReconciliation(uri, client, dbNames);
    console.log('subscriptions instance projector MongoDB postcommit test: OK');
  } catch (error) {
    testError = error;
  } finally {
    try {
      for (const dbName of Object.values(dbNames)) await client.db(dbName).dropDatabase();
      const databases = await client.db('admin').admin().listDatabases({ nameOnly: true });
      for (const dbName of Object.values(dbNames)) {
        assert.equal(
          databases.databases.some((database) => database.name === dbName),
          false,
          `MongoDB test database cleanup failed: ${dbName}`
        );
      }
    } catch (cleanupError) {
      if (testError) throw new AggregateError([testError, cleanupError], 'MongoDB test and cleanup failed');
      throw cleanupError;
    } finally {
      await client.close();
    }
  }
  if (testError) throw testError;
}

const nested = (value: any, path: string): unknown =>
  path.split('.').reduce((current, key) => current?.[key], value);

class MemoryMongo {
  forceFenceCasConflict = false;
  operations: any[] = [];
  ledger: any[] = [];
  outbox: any[] = [];
  instances: any[] = [];
  checkpoints: any[] = [];
  mappings: any[] = [mapping()];
  publications: any[] = [publication()];
  programs: any[] = [releaseProgram()];
  fences: any[] = [projectionFence()];
  types: any[] = [{
    subscriptionTypeId: 'subscription_type:annual-piter',
    state: 'ACTIVE',
    currentPolicyVersion: 1
  }];

  collection(name: string) {
    const rows = name === 'subscription_operations' ? this.operations
      : name === 'subscription_usage_ledger' ? this.ledger
        : name === 'subscription_outbox' ? this.outbox
          : name === 'subscription_instances' ? this.instances
      : name === 'subscription_instance_projector_checkpoints' ? this.checkpoints
        : name === 'subscription_projection_fences' ? this.fences
        : name === 'subscription_provider_mappings' ? this.mappings
          : name === 'subscription_policy_publications' ? this.publications
            : name === 'subscription_release_programs' ? this.programs
              : this.types;
    const matches = (row: any, filter: Record<string, unknown>): boolean =>
      Object.entries(filter).every(([key, value]) => nested(row, key) === value);
    return {
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      find: (filter: Record<string, unknown>) => ({
        sort: () => ({
          toArray: async () => rows.filter((row) => matches(row, filter))
            .map((row) => structuredClone(row))
            .sort((left, right) => String(left.subscriptionInstanceId ?? '')
              .localeCompare(String(right.subscriptionInstanceId ?? '')))
        })
      }),
      updateOne: async (filter: Record<string, unknown>, update: any) => {
        const row = rows.find((candidate) => matches(candidate, filter));
        if (!row) return { modifiedCount: 0 };
        if (name === 'subscription_projection_fences' && this.forceFenceCasConflict) {
          this.forceFenceCasConflict = false;
          row.bindingRevision += 1;
          row.coordinationRevision += 1;
          return { modifiedCount: 0 };
        }
        Object.assign(row, structuredClone(update.$set ?? {}));
        for (const [key, value] of Object.entries(update.$inc ?? {})) {
          row[key] = Number(row[key] ?? 0) + Number(value);
        }
        return { modifiedCount: 1 };
      },
      insertMany: async (documents: any[]) => { rows.push(...structuredClone(documents)); },
      insertOne: async (document: any) => { rows.push(structuredClone(document)); }
    };
  }

  admin() {
    return { command: async () => ({ isWritablePrimary: true }) };
  }
}

const repositoryWithMemoryMongo = (mongo: MemoryMongo): SubscriptionsRepository => {
  const repository = new SubscriptionsRepository() as any;
  repository.db = mongo;
  repository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>, options: any) => {
        assert.deepEqual(options, {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', j: true },
          readPreference: 'primary'
        });
        return callback();
      },
      endSession: async () => undefined
    })
  };
  return repository as SubscriptionsRepository;
};

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof SubscriptionRuntimeContractError && error.code === code;

const ENV_NAMES = [
  'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER', 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_MAX_STALENESS_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED', 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256', 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF', 'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PROVIDER_PRODUCT_ID', 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_KIND',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ID', 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_EXPECTED_DB',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_SHA256', 'SUBSCRIPTIONS_MONGODB_URI',
  'SUBSCRIPTIONS_MONGODB_DB', 'SUBSCRIPTIONS_AUTO_CREATE_INDEXES',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

const enable = (input: unknown): void => {
  const plan = buildSubscriptionInstanceProjectionPlan(input, PEPPER);
  process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = PEPPER;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_MAX_STALENESS_SECONDS = '60';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256 = plan.inputSha256;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256 = plan.planSha256;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF = plan.approvalRef;
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = plan.checkpoint.tenantId;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_PROVIDER_PRODUCT_ID = plan.checkpoint.providerProductId;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_KIND = plan.checkpoint.providerScope.kind;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_SCOPE_ID = plan.checkpoint.providerScope.scopeId;
  process.env.SUBSCRIPTIONS_MONGODB_URI = 'mongodb://localhost:27017/?replicaSet=rs0';
  process.env.SUBSCRIPTIONS_MONGODB_DB = 'subscriptions_test';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_EXPECTED_DB = 'subscriptions_test';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_SHA256 =
    subscriptionInstanceProjectionTargetFingerprint(
      process.env.SUBSCRIPTIONS_MONGODB_URI,
      process.env.SUBSCRIPTIONS_MONGODB_DB
    );
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
};

function fullFixture() {
  const previousInput: any = manifest();
  previousInput.snapshot.startedAt = '2026-08-26T08:59:40.000Z';
  previousInput.snapshot.coverageThrough = '2026-08-26T08:59:50.000Z';
  const previous = buildSubscriptionInstanceProjectionPlan(previousInput, PEPPER);
  const current = quarterPublication();
  const old = publication(); old.state = 'SUPERSEDED'; old.supersededAt = current.publishedAt; old.supersededBy = current.publicationId;
  const history = [old, current];
  const fence = buildSubscriptionProjectionFence({ mapping: mapping(), publication: current, previous: projectionFence() });
  const input: any = manifest();
  input.schemaVersion = 4;
  input.binding = { ...input.binding, publicationId: current.publicationId, policyVersion: current.policyVersion,
    policyDigest: current.policyDigest, fenceId: fence.fenceId, fenceRevision: fence.bindingRevision, fenceDigest: fence.bindingDigest };
  input.reconciliation = { mode: 'FULL_RECONCILIATION', previousCheckpointSha256: digest(previous.checkpoint),
    previousCheckpointRevision: previous.checkpoint.revision, previousCheckpointCreatedAt: previous.checkpoint.createdAt,
    existingInstances: previous.instances.map(row => ({ subscriptionInstanceId: row.subscriptionInstanceId, sha256: digest(row) })) };
  const next = { ...record(), providerClientId: 'provider-client-002', clientSubscriptionId: 'client-subscription-002',
    purchasedAt: '2026-08-27T10:00:00.000Z', activeFrom: '2026-08-27T10:00:00.000Z' };
  input.records = [record(), next];
  input.authority.sourceItemCount = 2;
  input.snapshot.snapshotDigest = digest(input.records);
  const plan = buildSubscriptionInstanceProjectionPlanWithHistory(input, PEPPER, history, 'PRODUCTION_COMPLETE', previous.instances);
  const mongo = new MemoryMongo();
  mongo.instances = structuredClone(previous.instances);
  mongo.checkpoints = [structuredClone(previous.checkpoint)];
  mongo.publications = history; mongo.fences = [fence]; mongo.types[0].currentPolicyVersion = 2;
  return { input, plan, previous, history, mongo, fence };
}

function saleBundle(data: ReturnType<typeof fullFixture>) {
  const template = data.plan.instances.find(row => row.policyVersion === 2)!;
  const instance = { ...structuredClone(template), subscriptionInstanceId: 'subscription_instance:sale-race',
    providerClientId: 'provider-client-sale-race', clientSubscriptionId: 'client-subscription-sale-race' };
  const actor = { type: 'SYSTEM' as const, actorId: 'system:lk-managed-sale' };
  const operation = { schemaVersion: 1 as const, operationId: 'operation:sale-race', revision: 1,
    tenantId: instance.tenantId, subscriptionInstanceId: instance.subscriptionInstanceId,
    kind: 'PURCHASE' as const, state: 'CONFIRMED' as const, actor,
    idempotency: { keyHash: HASH, requestHash: HASH }, correlationId: 'correlation:sale-race',
    decision: { decisionKind: 'PURCHASE' as const, policyVersion: instance.policyVersion,
      policyDigest: instance.policyDigest, mappingId: instance.mappingId, providerProductId: instance.providerProductId,
      releaseProgramId: instance.releaseProgramId, releasePhaseId: instance.releasePhaseId,
      stationId: instance.homeStationId, quantity: 1 as const, price: instance.purchasePrice },
    providerCorrelationId: 'transaction:sale-race', providerEvidenceRefs: Object.values(instance.evidence),
    attempts: 1, nextAttemptAt: null, compensationState: 'NONE' as const, lastReconciledAt: COVERAGE,
    lastReconciliationResult: 'PROVIDER_PAID_INSTANCE_READBACK_CONFIRMED', createdAt: COVERAGE,
    updatedAt: COVERAGE, terminalAt: COVERAGE };
  const ledgerWithoutHash = { schemaVersion: 1 as const, eventId: 'event:sale-race', eventType: 'PURCHASE_PAID' as const,
    tenantId: instance.tenantId, subscriptionInstanceId: instance.subscriptionInstanceId, operationId: operation.operationId,
    correlationId: operation.correlationId, policyVersion: instance.policyVersion, policyDigest: instance.policyDigest,
    stationId: instance.homeStationId, eventTypeId: null, productTypeId: instance.providerProductId,
    moneyDeltaMinor: instance.purchasePrice.amountMinor, currency: 'RUB' as const, usageDelta: 0,
    providerEvidenceRef: instance.evidence.paymentEvidenceRef, actor, occurredAt: instance.purchasedAt, recordedAt: COVERAGE };
  const ledger = { ...ledgerWithoutHash, eventHash: computeSubscriptionUsageLedgerEventHash(ledgerWithoutHash) };
  const outbox = { schemaVersion: 1 as const, outboxEventId: 'outbox:sale-race', ledgerEventId: ledger.eventId,
    subscriptionInstanceId: instance.subscriptionInstanceId, topic: 'SUBSCRIPTION_LEDGER_EVENT' as const,
    status: 'PENDING' as const, attempts: 0, nextAttemptAt: COVERAGE, deliveredAt: null, lastErrorCode: null,
    createdAt: COVERAGE, updatedAt: COVERAGE };
  return { instance, operation, ledger, outbox, mappingSnapshot: mapping(), checkpointSnapshot: data.plan.checkpoint,
    fenceSnapshot: structuredClone(data.mongo.fences[0]), publicationHistorySnapshot: data.history,
    releaseProgramSnapshot: releaseProgram() };
}

async function verifyFullMongoReconciliation(uri: string, client: MongoClient, names: {
  fullReplay: string; fullRollback: string; saleFirst: string; projectionFirst: string;
}): Promise<void> {
  // Called only after the existing loopback/no-credentials/unique-owned-DB guard.
  const second = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 10000 });
  await second.connect();
  const repo = (connection: MongoClient, dbName: string) => {
    const result = new SubscriptionsRepository() as any;
    result.client = connection; result.db = connection.db(dbName); return result as SubscriptionsRepository;
  };
  const seed = async (dbName: string) => {
    const data = fullFixture(); const db = client.db(dbName);
    await db.collection('subscription_policy_publications').deleteMany({});
    await db.collection('subscription_policy_publications').insertMany(structuredClone(data.history));
    await db.collection('subscription_types').updateOne({}, { $set: { currentPolicyVersion: 2 } });
    await db.collection('subscription_projection_fences').insertOne(structuredClone(data.fence));
    await db.collection('subscription_instances').insertMany(structuredClone(data.previous.instances));
    await db.collection('subscription_instance_projector_checkpoints').insertOne(structuredClone(data.previous.checkpoint));
    return data;
  };
  const snapshot = async (dbName: string) => {
    const db = client.db(dbName);
    return Promise.all(['subscription_instances','subscription_instance_projector_checkpoints',
      'subscription_projection_fences','subscription_operations','subscription_usage_ledger','subscription_outbox']
      .map(name => db.collection(name).find({}, { projection: { _id: 0 } }).sort({ _id: 1 }).toArray()));
  };
  try {
    const data = await seed(names.fullReplay);
    const firstRepo = repo(client, names.fullReplay) as any;
    const originalReadback = firstRepo.preflightInitialRuntimeInstanceProjection.bind(firstRepo);
    firstRepo.preflightInitialRuntimeInstanceProjection = async () => { throw new Error('simulated postcommit ACK loss'); };
    await assert.rejects(firstRepo.applyInitialRuntimeInstanceProjection(data.plan), /ACK loss/);
    firstRepo.preflightInitialRuntimeInstanceProjection = originalReadback;
    const beforeReplay = await snapshot(names.fullReplay);
    assert.equal(await repo(second, names.fullReplay).applyInitialRuntimeInstanceProjection(data.plan), 'EXACT_REPLAY');
    assert.deepEqual(await snapshot(names.fullReplay), beforeReplay);
    assert.deepEqual(beforeReplay[0].filter(row => row.policyVersion === 1), data.previous.instances);
    const currentFence = await client.db(names.fullReplay).collection('subscription_projection_fences')
      .findOne({}, { projection: { _id: 0 } });
    assert.ok(currentFence); data.mongo.fences = [currentFence];
    await repo(client, names.fullReplay).applyConfirmedRuntimeSaleBinding(saleBundle(data));
    const afterLaterSale = await snapshot(names.fullReplay);
    await assert.rejects(repo(second, names.fullReplay).applyInitialRuntimeInstanceProjection(data.plan),
      hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PREVIOUS_CHECKPOINT_CONFLICT'));
    assert.deepEqual(await snapshot(names.fullReplay), afterLaterSale,
      'a later sale makes projector replay conservative; it must never rewrite the committed checkpoint or rows');

    const rollback = await seed(names.fullRollback);
    const beforeRollback = await snapshot(names.fullRollback);
    await client.db(names.fullRollback).command({ collMod: 'subscription_instance_projector_checkpoints',
      validator: { revision: { $eq: 1 } }, validationLevel: 'strict', validationAction: 'error' });
    await assert.rejects(repo(client, names.fullRollback).applyInitialRuntimeInstanceProjection(rollback.plan));
    assert.deepEqual(await snapshot(names.fullRollback), beforeRollback, 'new instance and fence roll back with rejected checkpoint CAS');

    for (const order of ['saleFirst', 'projectionFirst'] as const) {
      const dbName = names[order]; const base = await seed(dbName);
      await repo(client, dbName).applyInitialRuntimeInstanceProjection(base.plan);
      const db = client.db(dbName);
      base.mongo.fences = [await db.collection('subscription_projection_fences').findOne({}, { projection: { _id: 0 } })];
      const sale = saleBundle(base);
      const nextInput: any = structuredClone(base.input);
      nextInput.reconciliation = { mode: 'FULL_RECONCILIATION', previousCheckpointSha256: digest(base.plan.checkpoint),
        previousCheckpointRevision: base.plan.checkpoint.revision, previousCheckpointCreatedAt: base.plan.checkpoint.createdAt,
        existingInstances: base.plan.instances.map(row => ({ subscriptionInstanceId: row.subscriptionInstanceId, sha256: digest(row) })) };
      nextInput.records.push({ ...nextInput.records[1], providerClientId: 'provider-client-004', clientSubscriptionId: 'client-subscription-004' });
      nextInput.authority.sourceItemCount = 3; nextInput.snapshot.snapshotDigest = digest(nextInput.records);
      const next = buildSubscriptionInstanceProjectionPlanWithHistory(nextInput, PEPPER, base.history, 'PRODUCTION_COMPLETE', base.plan.instances);
      const losing = repo(second, dbName) as any;
      let release!: () => void; let reached!: () => void;
      const parked = new Promise<void>(resolve => { reached = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      const collection = losing.runtimeProjectionFences.bind(losing);
      let once = true;
      losing.runtimeProjectionFences = () => {
        const value = collection(); const update = value.updateOne.bind(value);
        value.updateOne = async (...args: any[]) => {
          if (once) { once = false; reached(); await resume; }
          return update(...args);
        }; return value;
      };
      const loser = (order === 'saleFirst' ? losing.applyInitialRuntimeInstanceProjection(next)
        : losing.applyConfirmedRuntimeSaleBinding(sale)).then(() => null, (error: unknown) => error);
      let barrierTimeout: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => { release(); }, 15000);
      let winnerError: unknown;
      try {
        await Promise.race([parked, new Promise((_, reject) => {
          barrierTimeout = setTimeout(() => reject(new Error('barrier not reached')), 10000);
        })]);
        if (order === 'saleFirst') await repo(client, dbName).applyConfirmedRuntimeSaleBinding(sale);
        else await repo(client, dbName).applyInitialRuntimeInstanceProjection(next);
      } catch (error) { winnerError = error; }
      finally { release(); clearTimeout(timeout); clearTimeout(barrierTimeout); }
      const loserError = await loser;
      if (winnerError) throw winnerError;
      assert.ok(loserError, 'stale snapshot loser must reject after transaction retry');
      const final = await snapshot(dbName);
      assert.equal(final[0].length, 3);
      assert.equal(final[0].some(row => row.clientSubscriptionId === 'client-subscription-sale-race'), order === 'saleFirst');
      assert.equal(final[0].some(row => row.clientSubscriptionId === 'client-subscription-004'), order === 'projectionFirst');
      assert.equal(final[3].length, order === 'saleFirst' ? 1 : 0);
      assert.equal(final[4].length, final[3].length); assert.equal(final[5].length, final[3].length);
      assert.deepEqual(final[0].filter(row => row.policyVersion === 1), base.previous.instances);
    }
    console.log('schema4 Mongo reconciliation: lost ACK, rollback and independent-connection race both orders OK');
  } finally { await second.close(); }
}

async function verifyFullReconciliation(): Promise<void> {
  const data = fullFixture();
  const repo = repositoryWithMemoryMongo(data.mongo);
  const oldBytes = JSON.stringify(data.previous.instances);
  assert.equal(data.plan.checkpoint.reconciliation.mode, 'FULL_RECONCILIATION');
  assert.equal(data.plan.checkpoint.reconciliation.insertedCount, 1);
  assert.equal(data.plan.checkpoint.reconciliation.replayedCount, 1);
  assert.equal(await repo.preflightInitialRuntimeInstanceProjection(data.plan), 'READY_TO_INSERT');
  assert.equal(await repo.applyInitialRuntimeInstanceProjection(data.plan), 'INSERTED');
  assert.equal(JSON.stringify(data.mongo.instances.filter(row => row.policyVersion === 1)), oldBytes);
  const rebuilt = buildSubscriptionInstanceProjectionPlanWithHistory(data.input, PEPPER, data.history,
    'PRODUCTION_COMPLETE', data.mongo.instances);
  assert.deepEqual(rebuilt, data.plan, 'lost response reconstruction retains original preimage, hash and all bytes');
  assert.equal(await repo.applyInitialRuntimeInstanceProjection(rebuilt), 'EXACT_REPLAY');
  assert.equal(data.mongo.instances.length, 2);
  const unsigned = structuredClone(data.input); delete unsigned.reconciliation; unsigned.schemaVersion = 2;
  assert.throws(() => buildSubscriptionInstanceProjectionPlanWithHistory(unsigned, PEPPER, data.history),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RECONCILIATION_REQUIRED'));
  for (const alter of [
    (x: any) => { x.records[1].purchasedAt = '2026-08-26T10:00:00.000Z'; },
    (x: any) => { x.records[0].state = 'FROZEN'; x.records[0].frozenUntil = '2026-09-01T00:00:00.000Z'; },
    (x: any) => { x.records[0].purchasePrice.amountMinor += 1; },
    (x: any) => { x.records.shift(); x.authority.sourceItemCount = 1; },
    (x: any) => { x.reconciliation.existingInstances[0].sha256 = `sha256:${'f'.repeat(64)}`; }
  ]) {
    const bad = structuredClone(data.input); alter(bad); bad.snapshot.snapshotDigest = digest(bad.records);
    assert.throws(() => buildSubscriptionInstanceProjectionPlanWithHistory(bad, PEPPER, data.history,
      'PRODUCTION_COMPLETE', data.previous.instances));
  }
  for (const alter of [
    (input: any) => { input.reconciliation.previousCheckpointSha256 += '\n'; },
    (input: any) => { input.reconciliation.existingInstances[0].sha256 += '\n'; },
    (input: any) => { input.reconciliation.existingInstances.push(input.reconciliation.existingInstances[0]); },
    (input: any) => { input.reconciliation.other = true; },
    (input: any) => { input.reconciliation = null; }
  ]) {
    const malformed = structuredClone(data.input); alter(malformed);
    assert.throws(() => buildSubscriptionInstanceProjectionPlanWithHistory(malformed, PEPPER, data.history,
      'PRODUCTION_COMPLETE', data.previous.instances));
  }
  const corruptPlan = structuredClone(data.plan);
  corruptPlan.reconciliation!.previousCheckpointSha256 = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(repositoryWithMemoryMongo(fullFixture().mongo).applyInitialRuntimeInstanceProjection(corruptPlan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_INVALID'));
  for (const alter of [
    (m: MemoryMongo) => { m.checkpoints[0].revision += 1; },
    (m: MemoryMongo) => { m.instances[0].revision += 1; },
    (m: MemoryMongo) => { m.instances.push({ ...m.instances[0], subscriptionInstanceId: 'subscription_instance:extra' }); },
    (m: MemoryMongo) => { m.publications[1].createQuarterDescriptorDigest = `sha256:${'b'.repeat(64)}`; },
    (m: MemoryMongo) => { m.fences[0].bindingRevision += 1; },
    (m: MemoryMongo) => { m.fences = []; },
    (m: MemoryMongo) => { m.fences[0].lastProjectorReconciliationDigest = `sha256:${'f'.repeat(64)}`; }
  ]) {
    const candidate = fullFixture(); alter(candidate.mongo); const before = JSON.stringify(candidate.mongo);
    await assert.rejects(repositoryWithMemoryMongo(candidate.mongo).applyInitialRuntimeInstanceProjection(candidate.plan));
    assert.equal(JSON.stringify(candidate.mongo), before, 'bad preimage must not write any collection');
  }
  const serviceData = fullFixture();
  const serviceRepo = repositoryWithMemoryMongo(serviceData.mongo) as any;
  serviceRepo.connectReadOnly = async () => {};
  serviceRepo.connect = async () => {};
  enable(manifest());
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256 = serviceData.plan.inputSha256;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256 = serviceData.plan.planSha256;
  const service = new FixedClockService(serviceRepo);
  assert.equal((await service.check(serviceData.input)).status, 'READY_TO_INSERT');
  assert.equal((await service.apply(serviceData.input)).status, 'INSERTED');
  assert.equal((await service.apply(serviceData.input)).status, 'EXACT_REPLAY');
  serviceData.mongo.instances[0].revision += 1; // A later lifecycle/readback revision, not a projector update.
  const afterLaterRevision = JSON.stringify(serviceData.mongo);
  await assert.rejects(service.apply(serviceData.input),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PRESERVED_INSTANCE_CONFLICT'));
  assert.equal(JSON.stringify(serviceData.mongo), afterLaterRevision, 'later mutable-row drift must not trigger another apply');
  const saleData = fullFixture();
  const saleRepo = repositoryWithMemoryMongo(saleData.mongo);
  await saleRepo.applyInitialRuntimeInstanceProjection(saleData.plan);
  const sale = saleBundle(saleData);
  const revision = saleData.mongo.fences[0].coordinationRevision;
  assert.equal(await saleRepo.applyConfirmedRuntimeSaleBinding(sale), 'INSERTED');
  assert.equal(saleData.mongo.fences[0].coordinationRevision, revision + 1);
  saleData.mongo.fences[0].coordinationRevision += 1;
  assert.equal(await saleRepo.applyConfirmedRuntimeSaleBinding(sale), 'EXACT_REPLAY', 'lost ACK ignores later fence revision');
  assert.equal(saleData.mongo.operations.length, 1);
  assert.equal(saleData.mongo.ledger.length, 1);
  assert.equal(saleData.mongo.outbox.length, 1);
  const afterLaterSale = JSON.stringify(saleData.mongo);
  await assert.rejects(saleRepo.applyInitialRuntimeInstanceProjection(saleData.plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PREVIOUS_CHECKPOINT_CONFLICT'));
  assert.equal(JSON.stringify(saleData.mongo), afterLaterSale, 'later sales forbid claiming exact projector replay or writing');
  const failedData = fullFixture();
  const failedRepo = repositoryWithMemoryMongo(failedData.mongo);
  await failedRepo.applyInitialRuntimeInstanceProjection(failedData.plan);
  const failedSale = saleBundle(failedData);
  failedData.mongo.forceFenceCasConflict = true;
  await assert.rejects(failedRepo.applyConfirmedRuntimeSaleBinding(failedSale), hasCode('SUBSCRIPTIONS_SALE_BINDING_SOURCE_CHANGED'));
  assert.equal(failedData.mongo.instances.length, 2);
  assert.equal(failedData.mongo.operations.length + failedData.mongo.ledger.length + failedData.mongo.outbox.length, 0);
  console.log('schema4 full reconciliation synthetic cases: OK');
}

async function run(): Promise<void> {
  const input = manifest();
  const plan = buildSubscriptionInstanceProjectionPlan(input, PEPPER);
  assert.equal(plan.instances.length, 1);
  assert.notEqual(
    plan.instances[0].subscriptionInstanceId,
    buildSubscriptionInstanceProjectionPlan(input, `${PEPPER}-other`).instances[0].subscriptionInstanceId
  );
  assert.equal(plan.checkpoint.reconciliation.insertedCount, 1);
  assert.equal(plan.checkpoint.binding.releaseProgramId, 'release_program:annual-piter');
  assert.equal(
    subscriptionInstanceProjectionInputFingerprint(input),
    subscriptionInstanceProjectionInputFingerprint(Object.fromEntries(Object.entries(input).reverse()))
  );
  assert.equal(
    buildSubscriptionInstanceProjectionPlan(input, PEPPER).planSha256,
    buildSubscriptionInstanceProjectionPlan(input, PEPPER).planSha256
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({ ...input, phone: '+79990000000' }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHAPE_INVALID')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      schemaVersion: 1,
      sourceMode: 'REVIEWED_NORMALIZED_PROVIDER_INSTANCE_SNAPSHOT'
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SOURCE_INVALID')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      authority: { ...(input.authority as object), sourceItemCount: 2 }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_COUNT_MISMATCH')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      authority: { ...(input.authority as object), rejectedItemCount: 1 }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INCOMPLETE')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      authority: { ...(input.authority as object), endpointUrl: 'https://private.example' }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_AUTHORITY_INVALID')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      snapshot: { ...(input.snapshot as object), snapshotDigest: `sha256:${'0'.repeat(64)}` }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SNAPSHOT_DIGEST_MISMATCH')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(input, 'short'),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_HASH_PEPPER_REQUIRED')
  );
  const duplicateRecords = [record(), record()];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      records: duplicateRecords,
      authority: { ...(input.authority as object), sourceItemCount: duplicateRecords.length },
      snapshot: { ...(input.snapshot as object), snapshotDigest: digest(duplicateRecords) }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_DUPLICATE_RECORD')
  );
  const renewalRecords = [{ ...record(), renewalPredecessorId: 'provider-subscription-old' }];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      records: renewalRecords,
      snapshot: { ...(input.snapshot as object), snapshotDigest: digest(renewalRecords) }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RENEWAL_LINK_UNSUPPORTED')
  );
  let malformedError: unknown;
  try {
    parseProjectorInputJson('{"providerClientId":"private-client-001"');
  } catch (error) {
    malformedError = error;
  }
  assert.equal(
    safeProjectorErrorCode(malformedError),
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_JSON_INVALID'
  );
  assert.equal(
    safeProjectorErrorCode(new Error('Mongo failure contains private-client-001')),
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_FAILED'
  );
  const wrongPaymentRecords = [{
    ...record(),
    paymentEvidenceRef: evidence('unrelated_evidence')
  }];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      records: wrongPaymentRecords,
      snapshot: { ...(input.snapshot as object), snapshotDigest: digest(wrongPaymentRecords) }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PAYMENT_EVIDENCE_REQUIRED')
  );
  const missingReadbackRecords = [{ ...record(), lastReadBackEvidenceRef: null }];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan({
      ...input,
      records: missingReadbackRecords,
      snapshot: { ...(input.snapshot as object), snapshotDigest: digest(missingReadbackRecords) }
    }, PEPPER),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_READBACK_EVIDENCE_REQUIRED')
  );

  const secondRecord = {
    ...record(),
    providerClientId: 'provider-client-002',
    clientSubscriptionId: 'client-subscription-002'
  };
  const multiRecords = [secondRecord, record()];
  const multiInput = {
    ...input,
    records: multiRecords,
    authority: { ...(input.authority as object), sourceItemCount: multiRecords.length },
    snapshot: { ...(input.snapshot as object), snapshotDigest: digest(
      [...multiRecords].sort((left, right) => {
        const leftId = `${left.providerClientId}\0${left.clientSubscriptionId}`;
        const rightId = `${right.providerClientId}\0${right.clientSubscriptionId}`;
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      })
    ) }
  };
  const multiPlan = buildSubscriptionInstanceProjectionPlan(multiInput, PEPPER);
  assert.equal(multiPlan.instances.length, 2);
  assert.deepEqual(
    multiPlan.instances.map((instance) => instance.subscriptionInstanceId),
    multiPlan.instances.map((instance) => instance.subscriptionInstanceId).sort()
  );

  const history = twoPublicationHistory();
  const beforeBoundary = {
    ...record(),
    providerClientId: 'provider-client-before-boundary',
    clientSubscriptionId: 'client-subscription-before-boundary',
    purchasedAt: '2026-08-14T23:59:59.999Z',
    activeFrom: '2026-08-14T23:59:59.999Z',
    activeTo: '2027-08-14T23:59:59.999Z'
  };
  const exactBoundary = {
    ...record(),
    providerClientId: 'provider-client-exact-boundary',
    clientSubscriptionId: 'client-subscription-exact-boundary',
    purchasedAt: '2026-08-15T00:00:00.000Z',
    activeFrom: '2026-08-15T00:00:00.000Z',
    activeTo: '2027-08-15T00:00:00.000Z'
  };
  const multiPeriodInput = manifestForHistory([beforeBoundary, exactBoundary], history);
  const multiPeriodPlan = buildSubscriptionInstanceProjectionPlan(
    multiPeriodInput,
    PEPPER,
    history
  );
  assert.deepEqual(
    multiPeriodPlan.instances.map((instance) => [
      instance.clientSubscriptionId,
      instance.policyVersion
    ]).sort(),
    [
      ['client-subscription-before-boundary', 1],
      ['client-subscription-exact-boundary', 2]
    ]
  );
  assert.equal(multiPeriodPlan.checkpoint.schemaVersion, 3);
  assert.equal(multiPeriodPlan.checkpoint.policyResolution?.publicationHistory.entries.length, 2);
  assert.deepEqual(
    multiPeriodPlan.checkpoint.policyResolution?.selections.map((selection) => [
      selection.clientSubscriptionId,
      selection.purchasedAt,
      selection.publicationId,
      selection.policyVersion
    ]).sort(),
    [
      [
        'client-subscription-before-boundary',
        '2026-08-14T23:59:59.999Z',
        'publication:annual-piter-v1',
        1
      ],
      [
        'client-subscription-exact-boundary',
        '2026-08-15T00:00:00.000Z',
        'publication:annual-piter-v2',
        2
      ]
    ]
  );

  const malformedPurchase = [{
    ...beforeBoundary,
    purchasedAt: '2026-02-30T00:00:00.000Z'
  }];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory(malformedPurchase, history),
      PEPPER,
      history
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  const beforeFirstPublication = [{
    ...beforeBoundary,
    purchasedAt: '2026-07-31T23:59:59.999Z',
    activeFrom: '2026-07-31T23:59:59.999Z'
  }];
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory(beforeFirstPublication, history),
      PEPPER,
      history
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_NOT_FOUND')
  );
  const duplicateEffectiveAtHistory = structuredClone(history);
  duplicateEffectiveAtHistory[1].effectiveAt = duplicateEffectiveAtHistory[0].effectiveAt;
  duplicateEffectiveAtHistory[1].runtimeProjection.effectiveAt =
    duplicateEffectiveAtHistory[0].effectiveAt;
  duplicateEffectiveAtHistory[1].policyDigest = computeSubscriptionRuntimeProjectionDigest(
    duplicateEffectiveAtHistory[1].runtimeProjection
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([exactBoundary], duplicateEffectiveAtHistory),
      PEPPER,
      duplicateEffectiveAtHistory
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_AMBIGUOUS')
  );
  const nonMonotonicHistory = structuredClone(history);
  nonMonotonicHistory[1].policyVersion = 1;
  nonMonotonicHistory[1].runtimeProjection.policyVersion = 1;
  nonMonotonicHistory[1].policyDigest = computeSubscriptionRuntimeProjectionDigest(
    nonMonotonicHistory[1].runtimeProjection
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([exactBoundary], nonMonotonicHistory),
      PEPPER,
      nonMonotonicHistory
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  const skippedPolicyVersionHistory = structuredClone(history);
  skippedPolicyVersionHistory[1].policyVersion = 3;
  skippedPolicyVersionHistory[1].runtimeProjection.policyVersion = 3;
  skippedPolicyVersionHistory[1].policyDigest = computeSubscriptionRuntimeProjectionDigest(
    skippedPolicyVersionHistory[1].runtimeProjection
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([exactBoundary], skippedPolicyVersionHistory),
      PEPPER,
      skippedPolicyVersionHistory
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  const disabledSelectedHistory = structuredClone(history);
  disabledSelectedHistory[0].state = 'DISABLED_FOR_NEW_OPERATIONS';
  disabledSelectedHistory[0].supersededAt = null;
  disabledSelectedHistory[0].supersededBy = null;
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([beforeBoundary], disabledSelectedHistory),
      PEPPER,
      disabledSelectedHistory
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  const twoCurrentPublications = structuredClone(history);
  twoCurrentPublications[0].state = 'PUBLISHED';
  twoCurrentPublications[0].supersededAt = null;
  twoCurrentPublications[0].supersededBy = null;
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([exactBoundary], twoCurrentPublications),
      PEPPER,
      twoCurrentPublications
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  const brokenSupersessionHistory = structuredClone(history);
  brokenSupersessionHistory[0].supersededBy = 'publication:wrong-successor';
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(
      manifestForHistory([exactBoundary], brokenSupersessionHistory),
      PEPPER,
      brokenSupersessionHistory
    ),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  assert.throws(
    () => buildSubscriptionInstanceProjectionPlan(manifest(), PEPPER, history),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PUBLICATION_NOT_CURRENT')
  );

  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'true';
  const memoryMongo = new MemoryMongo();
  const repository = repositoryWithMemoryMongo(memoryMongo);
  assert.equal(await repository.preflightInitialRuntimeInstanceProjection(plan), 'READY_TO_INSERT');
  memoryMongo.instances.push(...structuredClone(plan.instances));
  memoryMongo.checkpoints.push(structuredClone(plan.checkpoint));
  assert.equal(await repository.preflightInitialRuntimeInstanceProjection(plan), 'EXACT_REPLAY');
  memoryMongo.instances[0].revision = 2;
  await assert.rejects(
    repository.preflightInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_IMMUTABLE_CONFLICT')
  );

  const uncheckpointedMongo = new MemoryMongo();
  uncheckpointedMongo.instances.push(...structuredClone(plan.instances));
  const uncheckpointedRepository = repositoryWithMemoryMongo(uncheckpointedMongo);
  await assert.rejects(
    uncheckpointedRepository.preflightInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_UNCHECKPOINTED_INSTANCES_CONFLICT')
  );

  const tamperedPinPlan = structuredClone(multiPeriodPlan);
  tamperedPinPlan.instances[0].policyVersion =
    tamperedPinPlan.instances[0].policyVersion === 1 ? 2 : 1;
  const tamperedPinRepository = repositoryWithMemoryMongo(new MemoryMongo());
  await assert.rejects(
    tamperedPinRepository.preflightInitialRuntimeInstanceProjection(tamperedPinPlan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_INVALID')
  );

  const subMillisecondPlan = structuredClone(multiPeriodPlan);
  const subMillisecondSelection = subMillisecondPlan.checkpoint.policyResolution!.selections[0];
  subMillisecondSelection.purchasedAt = '2026-08-15T00:00:00.000499Z';
  subMillisecondPlan.checkpoint.policyResolution!.resolutionDigest = digest({
    publicationHistory: subMillisecondPlan.checkpoint.policyResolution!.publicationHistory,
    selections: subMillisecondPlan.checkpoint.policyResolution!.selections
  });
  const subMillisecondMongo = new MemoryMongo();
  subMillisecondMongo.publications = structuredClone(history);
  const subMillisecondRepository = repositoryWithMemoryMongo(subMillisecondMongo);
  await assert.rejects(
    subMillisecondRepository.applyInitialRuntimeInstanceProjection(subMillisecondPlan),
    hasCode('SUBSCRIPTION_RUNTIME_TIMESTAMP_INVALID')
  );
  assert.equal(subMillisecondMongo.instances.length, 0);
  assert.equal(subMillisecondMongo.checkpoints.length, 0);

  const legacyCheckpointMongo = new MemoryMongo();
  legacyCheckpointMongo.instances = structuredClone(multiPeriodPlan.instances);
  const legacyCheckpoint = structuredClone(multiPeriodPlan.checkpoint) as any;
  legacyCheckpoint.schemaVersion = 2;
  delete legacyCheckpoint.policyResolution;
  legacyCheckpointMongo.checkpoints = [legacyCheckpoint];
  const legacyCheckpointRepository = repositoryWithMemoryMongo(legacyCheckpointMongo);
  await assert.rejects(
    legacyCheckpointRepository.preflightInitialRuntimeInstanceProjection(multiPeriodPlan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_IMMUTABLE_CONFLICT')
  );

  const disjointScopeMongo = new MemoryMongo();
  disjointScopeMongo.instances.push({
    ...structuredClone(plan.instances[0]),
    subscriptionInstanceId: 'subscription_instance:other-station',
    subscriptionTypeId: 'subscription_type:annual-other-station',
    mappingId: 'mapping:annual-other-station',
    providerClientId: 'provider-client-other-station',
    clientSubscriptionId: 'client-subscription-other-station',
    homeStationId: 'station:other'
  });
  const disjointScopeRepository = repositoryWithMemoryMongo(disjointScopeMongo);
  assert.equal(
    await disjointScopeRepository.preflightInitialRuntimeInstanceProjection(plan),
    'READY_TO_INSERT'
  );
  assert.equal(
    await disjointScopeRepository.applyInitialRuntimeInstanceProjection(plan),
    'INSERTED'
  );
  assert.equal(disjointScopeMongo.instances.length, 2);

  const applyMongo = new MemoryMongo();
  const applyRepository = repositoryWithMemoryMongo(applyMongo);
  assert.equal(await applyRepository.applyInitialRuntimeInstanceProjection(plan), 'INSERTED');
  assert.deepEqual(applyMongo.instances, plan.instances);
  assert.deepEqual(applyMongo.checkpoints, [plan.checkpoint]);
  assert.equal(applyMongo.fences[0].coordinationRevision, 2);
  assert.equal(
    applyMongo.fences[0].lastProjectorReconciliationDigest,
    plan.checkpoint.reconciliation.reconciliationDigest
  );
  assert.equal(await applyRepository.applyInitialRuntimeInstanceProjection(plan), 'EXACT_REPLAY');
  assert.equal(applyMongo.instances.length, plan.instances.length);
  assert.equal(applyMongo.checkpoints.length, 1);

  const bootstrapMongo = new MemoryMongo();
  bootstrapMongo.fences = [];
  const bootstrapRepository = repositoryWithMemoryMongo(bootstrapMongo);
  assert.equal(await bootstrapRepository.applyInitialRuntimeInstanceProjection(plan), 'INSERTED');
  assert.equal(bootstrapMongo.fences.length, 1);
  assert.equal(bootstrapMongo.fences[0].bindingDigest, plan.checkpoint.binding.fenceDigest);
  assert.equal(
    bootstrapMongo.fences[0].lastProjectorReconciliationDigest,
    plan.checkpoint.reconciliation.reconciliationDigest
  );

  const fenceDriftMongo = new MemoryMongo();
  fenceDriftMongo.fences[0].bindingRevision += 1;
  const fenceDriftRepository = repositoryWithMemoryMongo(fenceDriftMongo);
  await assert.rejects(
    fenceDriftRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CONFLICT')
  );
  assert.equal(fenceDriftMongo.instances.length, 0);
  assert.equal(fenceDriftMongo.checkpoints.length, 0);

  const multiPeriodMongo = new MemoryMongo();
  multiPeriodMongo.publications = structuredClone(history);
  multiPeriodMongo.fences = [buildSubscriptionProjectionFence({
    mapping: mapping(),
    publication: history[1],
    previous: projectionFence()
  })];
  multiPeriodMongo.types[0].currentPolicyVersion = 2;
  const multiPeriodRepository = repositoryWithMemoryMongo(multiPeriodMongo);
  assert.equal(
    await multiPeriodRepository.applyInitialRuntimeInstanceProjection(multiPeriodPlan),
    'INSERTED'
  );
  assert.equal(
    await multiPeriodRepository.applyInitialRuntimeInstanceProjection(multiPeriodPlan),
    'EXACT_REPLAY'
  );
  assert.deepEqual(
    multiPeriodMongo.instances.map((instance) => instance.policyVersion).sort(),
    [1, 2]
  );
  assert.equal(multiPeriodMongo.checkpoints.length, 1);

  const historyDriftMongo = new MemoryMongo();
  historyDriftMongo.publications = structuredClone(history);
  historyDriftMongo.publications[0].state = 'DISABLED_FOR_NEW_OPERATIONS';
  historyDriftMongo.publications[0].supersededAt = null;
  historyDriftMongo.publications[0].supersededBy = null;
  historyDriftMongo.fences = [buildSubscriptionProjectionFence({
    mapping: mapping(),
    publication: history[1],
    previous: projectionFence()
  })];
  historyDriftMongo.types[0].currentPolicyVersion = 2;
  const historyDriftRepository = repositoryWithMemoryMongo(historyDriftMongo);
  await assert.rejects(
    historyDriftRepository.applyInitialRuntimeInstanceProjection(multiPeriodPlan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_CONFLICT')
  );
  assert.equal(historyDriftMongo.instances.length, 0);
  assert.equal(historyDriftMongo.checkpoints.length, 0);

  const mappingDriftMongo = new MemoryMongo();
  const mappingDriftApplyRepository = repositoryWithMemoryMongo(mappingDriftMongo);
  assert.equal(
    await mappingDriftApplyRepository.preflightInitialRuntimeInstanceProjection(plan),
    'READY_TO_INSERT'
  );
  mappingDriftMongo.mappings[0].revision += 1;
  await assert.rejects(
    mappingDriftApplyRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SOURCE_CONFLICT')
  );
  assert.equal(mappingDriftMongo.instances.length, 0);
  assert.equal(mappingDriftMongo.checkpoints.length, 0);

  const programDriftMongo = new MemoryMongo();
  const programDriftRepository = repositoryWithMemoryMongo(programDriftMongo);
  assert.equal(
    await programDriftRepository.preflightInitialRuntimeInstanceProjection(plan),
    'READY_TO_INSERT'
  );
  programDriftMongo.programs[0].revision += 1;
  await assert.rejects(
    programDriftRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SOURCE_CONFLICT')
  );
  assert.equal(programDriftMongo.instances.length, 0);
  assert.equal(programDriftMongo.checkpoints.length, 0);

  const typeDriftMongo = new MemoryMongo();
  const typeDriftRepository = repositoryWithMemoryMongo(typeDriftMongo);
  assert.equal(
    await typeDriftRepository.preflightInitialRuntimeInstanceProjection(plan),
    'READY_TO_INSERT'
  );
  typeDriftMongo.types[0].currentPolicyVersion = 2;
  await assert.rejects(
    typeDriftRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_SOURCE_CONFLICT')
  );
  assert.equal(typeDriftMongo.instances.length, 0);
  assert.equal(typeDriftMongo.checkpoints.length, 0);

  const publicationRaceMongo = new MemoryMongo();
  publicationRaceMongo.forceFenceCasConflict = true;
  const publicationRaceRepository = repositoryWithMemoryMongo(publicationRaceMongo);
  await assert.rejects(
    publicationRaceRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CAS_CONFLICT')
  );
  assert.equal(publicationRaceMongo.instances.length, 0);
  assert.equal(publicationRaceMongo.checkpoints.length, 0);

  enable(input);
  delete process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256;
  const fingerprintRepository = new FakeRepository();
  const fingerprint = await new FixedClockService(
    fingerprintRepository as any
  ).planFingerprint(input);
  assert.deepEqual(
    {
      status: fingerprint.status,
      write: fingerprint.write,
      sourceItemCount: fingerprint.sourceItemCount,
      planSha256: fingerprint.planSha256
    },
    {
      status: 'PLAN_FINGERPRINT',
      write: false,
      sourceItemCount: 1,
      planSha256: plan.planSha256
    }
  );
  assert.equal(fingerprintRepository.connectReadOnlyCalls, 1);
  assert.equal(fingerprintRepository.connectCalls, 0);
  assert.equal(fingerprintRepository.preflightCalls, 0);
  assert.equal(fingerprintRepository.applyCalls, 0);
  const fingerprintOutput = JSON.stringify(sanitizedProjectorOutput(fingerprint));
  for (const forbidden of [
    'provider-client-001', 'client-subscription-001', 'projector-test-pepper',
    'provider_payment_evidence', 'provider_instance_evidence'
  ]) assert.equal(fingerprintOutput.includes(forbidden), false);

  enable(input);
  const checkRepository = new FakeRepository();
  const checked = await new FixedClockService(checkRepository as any).check(input);
  assert.deepEqual(
    { status: checked.status, write: checked.write, sourceItemCount: checked.sourceItemCount },
    { status: 'READY_TO_INSERT', write: false, sourceItemCount: 1 }
  );
  assert.equal(checkRepository.connectReadOnlyCalls, 1);
  assert.equal(checkRepository.connectCalls, 0);
  assert.equal(checkRepository.applyCalls, 0);
  const output = JSON.stringify(sanitizedProjectorOutput(checked));
  for (const forbidden of [
    'provider-client-001', 'client-subscription-001', 'projector-test-pepper',
    'provider_payment_evidence', 'provider_instance_evidence'
  ]) assert.equal(output.includes(forbidden), false);

  enable(input);
  const invalidLifecycleRepository = new FakeRepository();
  invalidLifecycleRepository.publicationHistory = structuredClone(history);
  invalidLifecycleRepository.publicationHistory[0].state = 'PUBLISHED';
  invalidLifecycleRepository.publicationHistory[0].supersededAt = null;
  invalidLifecycleRepository.publicationHistory[0].supersededBy = null;
  await assert.rejects(
    new FixedClockService(invalidLifecycleRepository as any).check(input),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POLICY_HISTORY_INVALID')
  );
  assert.equal(invalidLifecycleRepository.preflightCalls, 0);
  assert.equal(invalidLifecycleRepository.applyCalls, 0);

  const assertApplyRejectedWithoutWrite = async (
    name: (typeof ENV_NAMES)[number],
    value: string | undefined,
    code: string
  ): Promise<void> => {
    enable(input);
    process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM =
      'APPLY_INITIAL_RUNTIME_INSTANCE_PROJECTION';
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    const applyRepository = new FakeRepository();
    await assert.rejects(
      new FixedClockService(applyRepository as any).apply(input),
      hasCode(code)
    );
    assert.equal(
      applyRepository.connectCalls,
      name === 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256' ? 1 : 0
    );
    assert.equal(applyRepository.applyCalls, 0);
  };

  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM',
    undefined,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM_REQUIRED'
  );
  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_SHA256',
    `sha256:${'1'.repeat(64)}`,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_ATTESTATION_MISMATCH'
  );
  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256',
    `sha256:${'2'.repeat(64)}`,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_ATTESTATION_MISMATCH'
  );
  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_SHA256',
    `sha256:${'3'.repeat(64)}`,
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TARGET_ATTESTATION_MISMATCH'
  );
  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_REF',
    evidence('provider_approval', '4'),
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPROVAL_ATTESTATION_MISMATCH'
  );
  await assertApplyRejectedWithoutWrite(
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_EXPECTED_DB',
    'wrong_database',
    'SUBSCRIPTIONS_INSTANCE_PROJECTOR_DATABASE_ATTESTATION_MISMATCH'
  );

  enable(input);
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_APPLY_CONFIRM =
    'APPLY_INITIAL_RUNTIME_INSTANCE_PROJECTION';
  assert.doesNotThrow(() => assertSubscriptionInstanceProjectionApplyBoundary(plan));
  const serviceApplyRepository = new FakeRepository();
  const applyService = new FixedClockService(serviceApplyRepository as any);
  const inserted = await applyService.apply(input);
  assert.deepEqual(
    { status: inserted.status, write: inserted.write, sourceItemCount: inserted.sourceItemCount },
    { status: 'INSERTED', write: true, sourceItemCount: 1 }
  );
  assert.equal(serviceApplyRepository.connectCalls, 1);
  assert.equal(serviceApplyRepository.connectReadOnlyCalls, 0);
  assert.equal(serviceApplyRepository.applyCalls, 1);
  serviceApplyRepository.applyStatus = 'EXACT_REPLAY';
  const replayed = await applyService.apply(input);
  assert.deepEqual(
    { status: replayed.status, write: replayed.write, sourceItemCount: replayed.sourceItemCount },
    { status: 'EXACT_REPLAY', write: false, sourceItemCount: 1 }
  );
  assert.equal(serviceApplyRepository.applyCalls, 2);
  const applyOutput = JSON.stringify(sanitizedProjectorOutput(inserted));
  for (const forbidden of [
    'provider-client-001', 'client-subscription-001', 'projector-test-pepper',
    'provider_payment_evidence', 'provider_instance_evidence'
  ]) assert.equal(applyOutput.includes(forbidden), false);

  const failedReadbackMongo = new MemoryMongo();
  const failedReadbackRepository = repositoryWithMemoryMongo(failedReadbackMongo) as any;
  failedReadbackRepository.preflightInitialRuntimeInstanceProjection = async () =>
    'READY_TO_INSERT';
  await assert.rejects(
    failedReadbackRepository.applyInitialRuntimeInstanceProjection(plan),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_POSTCOMMIT_READBACK_FAILED')
  );
  const legacyWithoutFence = new FakeRepository();
  legacyWithoutFence.fence = null;
  assert.equal(
    (await new FixedClockService(legacyWithoutFence as any).check(input)).status,
    'READY_TO_INSERT'
  );

  const mappingDrift = new FakeRepository();
  mappingDrift.mapping = { ...mappingDrift.mapping, revision: 4 };
  await assert.rejects(
    new FixedClockService(mappingDrift as any).check(input),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_MAPPING_NOT_CURRENT')
  );
  assert.equal(mappingDrift.preflightCalls, 0);

  const priceDrift = new FakeRepository();
  priceDrift.program = {
    ...priceDrift.program,
    phases: [{ ...priceDrift.program.phases[0], price: { amountMinor: 1, currency: 'RUB' } }]
  };
  await assert.rejects(
    new FixedClockService(priceDrift as any).check(input),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_RELEASE_BINDING_MISMATCH')
  );
  assert.equal(priceDrift.preflightCalls, 0);

  const realMongoManifest = manifest();
  const realMongoManifestSnapshot = structuredClone(realMongoManifest);
  const realMongoPlan = buildSubscriptionInstanceProjectionPlan(realMongoManifest, PEPPER);
  assert.deepEqual(
    realMongoManifest,
    realMongoManifestSnapshot,
    'building the canonical projection plan must not mutate the input manifest'
  );
  await verifyFullReconciliation();
  await verifyRealMongoPostcommitReadback(realMongoManifest, realMongoPlan);

  console.log('subscriptions provider instance projector tests: OK');
}

if (require.main === module) {
  run().finally(() => {
    for (const name of ENV_NAMES) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
