import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManagedAnnualSubscriptionV2Candidate } from '../src/subscriptions/annual-subscription-policy-v2-candidate';
import {
  buildSubscriptionLegacyBindingPromotionPlan,
  HUB_PROVIDER_PRODUCT_ID,
  PITER_PRICE_MINOR,
  PITER_PROVIDER_PRODUCT_ID,
  PITER_STATION_ID,
  PITER_SUBSCRIPTION_TYPE_ID,
  PITER_TENANT_ID,
  parseSubscriptionLegacyBindingPromotionManifest,
  subscriptionLegacyBindingPromotionDocumentDigest,
  subscriptionLegacyBindingPromotionTargetFingerprint,
  validateSubscriptionLegacyBindingPromotionAttestations
} from '../src/subscriptions/subscription-legacy-binding-promotion.service';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { SubscriptionProviderInstanceProjectorService } from '../src/subscriptions/subscription-provider-instance-projector.service';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError
} from '../src/subscriptions/subscription-runtime-contracts';
import type {
  StoredReleaseProgram,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import {
  sanitizedBindingPromotionOutput,
  readPrivateBindingPromotionManifest,
  safeBindingPromotionErrorCode
} from '../scripts/managed-subscriptions-legacy-binding-promotion';

const HASH = 'a'.repeat(64);
const OBSERVED = '2026-08-28T08:59:40.000Z';
const COVERAGE = '2026-08-28T08:59:50.000Z';
const PROMOTED = '2026-08-28T09:00:00.000Z';
const PUBLICATION_ID = 'publication:piter-v3';
const MAPPING_ID = 'mapping:piter';
const PROGRAM_ID = 'release_program:piter';
const PHASE_ID = 'release_phase:piter';
const evidence = (kind: string, digit = 'a') => `${kind}:sha256:${digit.repeat(64)}`;
const clone = <T>(value: T): T => structuredClone(value);

const policyFixture = (): StoredSubscriptionPolicyVersion => {
  const candidate = buildManagedAnnualSubscriptionV2Candidate('PITER');
  return {
    schemaVersion: 3,
    modelVersion: 3,
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID,
    version: candidate.expectedNextVersion,
    revision: 1,
    status: 'PUBLISHED',
    ...candidate.request,
    providerBinding: {
      ...candidate.request.providerBinding!,
      evidenceState: 'UNVERIFIED'
    },
    createdAt: '2026-08-20T12:05:00.000Z',
    createdBy: 'admin:global',
    idempotency: {
      actorId: 'admin:global', key: 'piter-policy-v3', requestHash: HASH,
      correlationId: 'correlation:piter-policy-v3'
    }
  } as StoredSubscriptionPolicyVersion;
};

const typeFixture = (policyVersion: number): StoredSubscriptionType => ({
  schemaVersion: 1,
  subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID,
  code: 'piter-annual', codeNorm: 'piter-annual', title: 'Piter annual', description: null,
  state: 'ACTIVE', currentPolicyVersion: policyVersion, revision: 2,
  createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
  createdBy: 'admin:global',
  idempotency: {
    actorId: 'admin:global', key: 'piter-type', requestHash: HASH,
    correlationId: 'correlation:piter-type'
  }
});

const mappingFixture = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1, mappingId: MAPPING_ID, tenantId: PITER_TENANT_ID,
  provider: 'VIVA', providerProductId: PITER_PROVIDER_PRODUCT_ID,
  providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
  subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, state: 'VERIFIED',
  evidenceRef: evidence('provider_mapping_evidence', '1'), verifiedAt: OBSERVED,
  verifiedBy: 'admin:global', revision: 1, createdAt: OBSERVED,
  createdBy: 'admin:global', updatedAt: OBSERVED, updatedBy: 'admin:global',
  idempotency: {
    actorId: 'admin:global', key: 'piter-mapping', requestHash: HASH,
    correlationId: 'correlation:piter-mapping'
  }
});

const publicationFixture = (policy: StoredSubscriptionPolicyVersion): StoredSubscriptionPolicyPublication => {
  const runtimeProjection = compileSubscriptionRuntimeProjection(policy);
  return {
    schemaVersion: 2, publicationId: PUBLICATION_ID,
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, policyVersion: policy.version,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: MAPPING_ID, dictionaryRevision: 'dictionary:piter:v1', runtimeProjection,
    state: 'PUBLISHED', effectiveAt: policy.effectiveAt,
    publishedAt: '2026-08-22T12:00:00.000Z', publishedBy: 'admin:global',
    supersededAt: null, supersededBy: null, impactPreviewRef: 'impact:piter-v3',
    approvalAuditRef: 'audit:piter-v3',
    idempotency: {
      actorId: 'admin:global', key: 'piter-publication-v3', requestHash: HASH,
      correlationId: 'correlation:piter-publication-v3'
    }
  };
};

const programFixture = (): StoredReleaseProgram => ({
  schemaVersion: 1, releaseProgramId: PROGRAM_ID,
  subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, stationId: PITER_STATION_ID,
  timezone: 'Europe/Moscow', state: 'DRAFT', revision: 1,
  phases: [{
    releasePhaseId: PHASE_ID, order: 1, mode: 'BULK', totalQuantity: 24,
    dailyDropQuantity: null, dailyDropLocalTime: null,
    price: { amountMinor: PITER_PRICE_MINOR, currency: 'RUB' }, activation: 'MANUAL',
    scheduledAt: null, providerProductRef: null
  }],
  createdAt: '2026-08-22T12:10:00.000Z', updatedAt: '2026-08-22T12:10:00.000Z',
  createdBy: 'admin:global',
  idempotency: {
    actorId: 'admin:global', key: 'piter-program', requestHash: HASH,
    correlationId: 'correlation:piter-program'
  }
});

const fixture = () => {
  const policy = policyFixture();
  const publication = publicationFixture(policy);
  const mapping = mappingFixture();
  const releaseProgram = programFixture();
  const targetSha256 = subscriptionLegacyBindingPromotionTargetFingerprint(
    'mongodb://db-a.example:27017/?replicaSet=rs0',
    'phab'
  );
  const manifest = {
    schemaVersion: 'PHAB_SUBSCRIPTION_LEGACY_RUNTIME_BINDING_PROMOTION_V1',
    approvalRef: evidence('provider_approval', '2'),
    providerEvidenceRef: evidence('provider_snapshot_evidence', '3'),
    resultEvidenceRef: evidence('promotion_result', '4'),
    evidence: { observedAt: OBSERVED, coverageThrough: COVERAGE },
    counts: { sourceItemCount: 24, rejectedItemCount: 0, duplicateIdentityCount: 0 },
    tenantId: PITER_TENANT_ID, provider: 'VIVA', providerProductId: PITER_PROVIDER_PRODUCT_ID,
    providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, policyVersion: policy.version,
    publication: {
      publicationId: PUBLICATION_ID,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(publication)
    },
    mapping: {
      mappingId: MAPPING_ID, sourceRevision: mapping.revision,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(mapping)
    },
    releaseProgram: {
      releaseProgramId: PROGRAM_ID, releasePhaseId: PHASE_ID,
      sourceRevision: releaseProgram.revision,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(releaseProgram)
    },
    stationId: PITER_STATION_ID,
    price: { amountMinor: PITER_PRICE_MINOR, currency: 'RUB' },
    expected: {
      instanceCount: 0, projectorCheckpointCount: 0,
      fenceCount: 0, promotionCheckpointCount: 0
    },
    targetSha256, promotedAt: PROMOTED, actorId: 'operator:piter-binding'
  };
  const snapshot = {
    type: typeFixture(policy.version), policy, publication, mapping, releaseProgram,
    fence: null, promotion: null, instanceCount: 0, projectorCheckpointCount: 0
  };
  return { manifest, snapshot };
};

const refreshDigests = (value: ReturnType<typeof fixture>) => {
  value.manifest.publication.sourceDigest = subscriptionLegacyBindingPromotionDocumentDigest(
    value.snapshot.publication
  );
  value.manifest.mapping.sourceRevision = value.snapshot.mapping.revision;
  value.manifest.mapping.sourceDigest = subscriptionLegacyBindingPromotionDocumentDigest(
    value.snapshot.mapping
  );
  value.manifest.releaseProgram.sourceRevision = value.snapshot.releaseProgram.revision;
  value.manifest.releaseProgram.sourceDigest = subscriptionLegacyBindingPromotionDocumentDigest(
    value.snapshot.releaseProgram
  );
  return value;
};

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof SubscriptionRuntimeContractError && error.code === code;

const nestedValues = (value: any, path: string[]): unknown[] => {
  if (path.length === 0) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => nestedValues(item, path));
  if (!value || typeof value !== 'object') return [];
  return nestedValues(value[path[0]], path.slice(1));
};

class PromotionMemoryMongo {
  forceReplaceConflict: string | null = null;
  forceInsertFailure: string | null = null;
  transactionTail: Promise<void> = Promise.resolve();
  rows: Record<string, any[]>;

  constructor(value: ReturnType<typeof fixture>) {
    this.rows = {
      subscription_types: [clone(value.snapshot.type)],
      subscription_policy_versions: [clone(value.snapshot.policy)],
      subscription_policy_publications: [clone(value.snapshot.publication)],
      subscription_provider_mappings: [clone(value.snapshot.mapping)],
      subscription_release_programs: [clone(value.snapshot.releaseProgram)],
      subscription_projection_fences: [],
      subscription_runtime_binding_promotions: [],
      subscription_instances: [],
      subscription_instance_projector_checkpoints: []
    };
  }

  snapshot(): Record<string, any[]> { return clone(this.rows); }
  restore(rows: Record<string, any[]>): void { this.rows = clone(rows); }

  collection(name: string) {
    const rows = () => this.rows[name] ?? (this.rows[name] = []);
    const matches = (row: any, filter: Record<string, any>): boolean =>
      Object.entries(filter).every(([path, expected]) => {
        const values = nestedValues(row, path.split('.'));
        if (expected && typeof expected === 'object' && '$exists' in expected) {
          return expected.$exists ? values.some((item) => item !== undefined) : values.every((item) => item === undefined);
        }
        return values.some((item) => isDeepEqual(item, expected));
      });
    return {
      findOne: async (filter: Record<string, any>) => {
        const row = rows().find((candidate) => matches(candidate, filter));
        return row ? clone(row) : null;
      },
      countDocuments: async (filter: Record<string, any>) =>
        rows().filter((candidate) => matches(candidate, filter)).length,
      replaceOne: async (filter: Record<string, any>, replacement: any) => {
        const index = rows().findIndex((candidate) => matches(candidate, filter));
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        if (this.forceReplaceConflict === name) {
          this.forceReplaceConflict = null;
          return { matchedCount: 0, modifiedCount: 0 };
        }
        rows()[index] = clone(replacement);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      insertOne: async (document: any) => {
        if (this.forceInsertFailure === name) {
          this.forceInsertFailure = null;
          throw new Error(`forced insert failure:${name}`);
        }
        rows().push(clone(document));
        return { acknowledged: true, insertedId: document.promotionId ?? document.fenceId };
      }
    };
  }
}

const isDeepEqual = (left: unknown, right: unknown): boolean => {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
};

const repositoryWithMemoryMongo = (
  mongo: PromotionMemoryMongo
): SubscriptionsRepository => {
  const repository = new SubscriptionsRepository() as any;
  repository.db = mongo;
  repository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>, options: unknown) => {
        assert.deepEqual(options, {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', j: true },
          readPreference: 'primary'
        });
        let release!: () => void;
        const previous = mongo.transactionTail;
        mongo.transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        const before = mongo.snapshot();
        try { return await callback(); }
        catch (error) { mongo.restore(before); throw error; }
        finally { release(); }
      },
      endSession: async () => undefined
    })
  };
  return repository as SubscriptionsRepository;
};

const expectPlanFailure = (
  mutate: (value: ReturnType<typeof fixture>) => void,
  code: string,
  refresh = false
) => {
  const value = fixture();
  mutate(value);
  if (refresh) refreshDigests(value);
  assert.throws(() => buildSubscriptionLegacyBindingPromotionPlan(value.manifest, value.snapshot), hasCode(code));
};

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED = 'true';
  const ready = fixture();
  const plan = buildSubscriptionLegacyBindingPromotionPlan(ready.manifest, ready.snapshot);
  assert.equal(plan.status, 'READY_TO_PROMOTE');
  assert.equal(plan.target.publication.schemaVersion, 3);
  assert.deepEqual(plan.target.publication.runtimeCompatibility, {
    adapterId: 'LK_REGIONAL_BOOKING_GATEWAY', contractVersion: 1,
    capabilityDigest: 'sha256:f1e00751ba2ef19b1945964f2ee90d2d88dbf11121fdb75dfe573b6b12f31791'
  });
  const sourcePublication = clone(ready.snapshot.publication);
  const targetPublication = clone(plan.target.publication) as any;
  delete targetPublication.runtimeCompatibility;
  targetPublication.schemaVersion = 2;
  assert.deepEqual(targetPublication, sourcePublication, 'publication changes only schema/compatibility');
  assert.equal(plan.target.mapping.revision, ready.snapshot.mapping.revision + 1);
  assert.equal(plan.target.releaseProgram.state, 'PAUSED');
  assert.notEqual(plan.target.releaseProgram.state, 'ACTIVE');
  assert.equal(plan.target.releaseProgram.phases[0].providerProductRef, PITER_PROVIDER_PRODUCT_ID);
  assert.deepEqual(
    { ...plan.target.releaseProgram.phases[0], providerProductRef: null },
    ready.snapshot.releaseProgram.phases[0],
    'phase binding is the only phase change'
  );
  assert.equal(plan.target.fence.bindingRevision, 1);
  assert.equal(plan.target.promotion.revision, 1);

  expectPlanFailure((value) => { value.manifest.providerProductId = HUB_PROVIDER_PRODUCT_ID; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PRODUCT_UNSUPPORTED');
  expectPlanFailure((value) => { value.manifest.stationId = 'station:wrong'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_IDENTITY_UNSUPPORTED');
  expectPlanFailure((value) => { value.manifest.price.amountMinor = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PRICE_INVALID');
  expectPlanFailure((value) => { value.manifest.counts.sourceItemCount = 23; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_SOURCE_COUNT_INVALID');
  expectPlanFailure((value) => { value.manifest.counts.rejectedItemCount = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_REJECTED_RECORDS');
  expectPlanFailure((value) => { value.manifest.counts.duplicateIdentityCount = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_DUPLICATE_IDENTITIES');
  expectPlanFailure((value) => { (value.manifest as any).runtimeCompatibility = { adapterId: 'attacker-controlled' }; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MANIFEST_SHAPE_INVALID');
  expectPlanFailure((value) => { (value.manifest as any).phone = 'forbidden'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MANIFEST_SHAPE_INVALID');
  expectPlanFailure((value) => { (value.snapshot.publication as any).schemaVersion = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_PRECONDITION_FAILED', true);
  expectPlanFailure((value) => { (value.snapshot.publication as any).schemaVersion = 3; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE', true);
  expectPlanFailure((value) => { (value.snapshot.policy as any).modelVersion = 2; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PRECONDITION_FAILED');
  expectPlanFailure((value) => { value.snapshot.policy.status = 'DRAFT'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PRECONDITION_FAILED');
  expectPlanFailure((value) => { value.snapshot.policy.createGame.durationsMinutes = [90]; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_ADAPTER_UNSUPPORTED');
  expectPlanFailure((value) => {
    value.snapshot.publication.runtimeProjection.dailyUsageLimit = 2;
    value.snapshot.publication.policyDigest = computeSubscriptionRuntimeProjectionDigest(value.snapshot.publication.runtimeProjection);
  }, 'SUBSCRIPTIONS_BINDING_PROMOTION_POLICY_PROJECTION_MISMATCH', true);
  expectPlanFailure((value) => { value.snapshot.publication.policyDigest = `sha256:${'b'.repeat(64)}`; }, 'SUBSCRIPTION_PUBLICATION_DIGEST_MISMATCH', true);
  expectPlanFailure((value) => { value.snapshot.mapping.providerProductId = 'product:wrong'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_PRECONDITION_FAILED', true);
  expectPlanFailure((value) => { value.snapshot.mapping.providerScope = { kind: 'TENANT', scopeId: PITER_TENANT_ID }; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_PRECONDITION_FAILED', true);
  expectPlanFailure((value) => { value.snapshot.mapping.subscriptionTypeId = 'subscription_type:wrong'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_PRECONDITION_FAILED', true);
  expectPlanFailure((value) => { value.snapshot.mapping.state = 'DISABLED'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_PRECONDITION_FAILED', true);
  expectPlanFailure((value) => { value.snapshot.releaseProgram.state = 'PAUSED'; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE', true);
  expectPlanFailure((value) => { value.snapshot.releaseProgram.phases[0].providerProductRef = PITER_PROVIDER_PRODUCT_ID; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE', true);
  expectPlanFailure((value) => { value.snapshot.releaseProgram.phases.push(clone(value.snapshot.releaseProgram.phases[0])); }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PHASE_AMBIGUOUS', true);
  expectPlanFailure((value) => { value.snapshot.releaseProgram.phases[0].price.amountMinor = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PHASE_PRICE_INVALID', true);
  expectPlanFailure((value) => { value.snapshot.instanceCount = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_INSTANCES_EXIST');
  expectPlanFailure((value) => { value.snapshot.projectorCheckpointCount = 1; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PROJECTOR_CHECKPOINT_EXISTS');
  expectPlanFailure((value) => { (value.snapshot as any).fence = plan.target.fence; }, 'SUBSCRIPTIONS_BINDING_PROMOTION_PARTIAL_STATE');

  const replaySnapshot = {
    ...ready.snapshot,
    publication: clone(plan.target.publication), mapping: clone(plan.target.mapping),
    releaseProgram: clone(plan.target.releaseProgram), fence: clone(plan.target.fence),
    promotion: clone(plan.target.promotion)
  };
  const replay = buildSubscriptionLegacyBindingPromotionPlan(ready.manifest, replaySnapshot);
  assert.equal(replay.status, 'EXACT_REPLAY');
  assert.equal(replay.planSha256, plan.planSha256);
  const changedReplayManifest = clone(ready.manifest);
  changedReplayManifest.resultEvidenceRef = evidence('promotion_result', '9');
  assert.throws(
    () => buildSubscriptionLegacyBindingPromotionPlan(changedReplayManifest, replaySnapshot),
    hasCode('SUBSCRIPTIONS_BINDING_PROMOTION_IMMUTABLE_CONFLICT')
  );
  const partialReplay = clone(replaySnapshot);
  partialReplay.releaseProgram.state = 'ACTIVE';
  assert.throws(
    () => buildSubscriptionLegacyBindingPromotionPlan(ready.manifest, partialReplay),
    hasCode('SUBSCRIPTIONS_BINDING_PROMOTION_IMMUTABLE_CONFLICT')
  );

  const applyMongo = new PromotionMemoryMongo(ready);
  const applyRepository = repositoryWithMemoryMongo(applyMongo);
  assert.equal(await applyRepository.preflightLegacyBindingPromotion(plan), 'READY_TO_PROMOTE');
  assert.equal(await applyRepository.applyLegacyBindingPromotion(plan), 'PROMOTED');
  assert.deepEqual(applyMongo.rows.subscription_provider_mappings, [plan.target.mapping]);
  assert.deepEqual(applyMongo.rows.subscription_policy_publications, [plan.target.publication]);
  assert.deepEqual(applyMongo.rows.subscription_release_programs, [plan.target.releaseProgram]);
  assert.deepEqual(applyMongo.rows.subscription_projection_fences, [plan.target.fence]);
  assert.deepEqual(applyMongo.rows.subscription_runtime_binding_promotions, [plan.target.promotion]);
  const afterFirstApply = applyMongo.snapshot();
  assert.equal(await applyRepository.applyLegacyBindingPromotion(plan), 'EXACT_REPLAY');
  assert.deepEqual(applyMongo.rows, afterFirstApply, 'exact replay performs zero writes');

  for (const [collection, code] of [
    ['subscription_provider_mappings', 'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_CAS_CONFLICT'],
    ['subscription_policy_publications', 'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_CAS_CONFLICT'],
    ['subscription_release_programs', 'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_CAS_CONFLICT']
  ] as const) {
    const mongo = new PromotionMemoryMongo(ready);
    mongo.forceReplaceConflict = collection;
    const repository = repositoryWithMemoryMongo(mongo);
    const before = mongo.snapshot();
    await assert.rejects(repository.applyLegacyBindingPromotion(plan), hasCode(code));
    assert.deepEqual(mongo.rows, before, `${collection} CAS conflict rolls back all writes`);
  }
  for (const collection of [
    'subscription_projection_fences', 'subscription_runtime_binding_promotions'
  ]) {
    const mongo = new PromotionMemoryMongo(ready);
    mongo.forceInsertFailure = collection;
    const repository = repositoryWithMemoryMongo(mongo);
    const before = mongo.snapshot();
    await assert.rejects(repository.applyLegacyBindingPromotion(plan));
    assert.deepEqual(mongo.rows, before, `${collection} insert failure rolls back all writes`);
  }

  const postCommitMongo = new PromotionMemoryMongo(ready);
  const postCommitRepository = repositoryWithMemoryMongo(postCommitMongo) as any;
  postCommitRepository.preflightLegacyBindingPromotion = async () => 'READY_TO_PROMOTE';
  await assert.rejects(
    postCommitRepository.applyLegacyBindingPromotion(plan),
    hasCode('SUBSCRIPTIONS_BINDING_PROMOTION_POSTCOMMIT_READBACK_FAILED')
  );
  assert.equal(postCommitMongo.rows.subscription_runtime_binding_promotions.length, 1);

  const concurrentMongo = new PromotionMemoryMongo(ready);
  const concurrentResults = await Promise.all([
    repositoryWithMemoryMongo(concurrentMongo).applyLegacyBindingPromotion(plan),
    repositoryWithMemoryMongo(concurrentMongo).applyLegacyBindingPromotion(plan)
  ]);
  assert.deepEqual([...concurrentResults].sort(), ['EXACT_REPLAY', 'PROMOTED']);
  assert.equal(concurrentMongo.rows.subscription_runtime_binding_promotions.length, 1);
  assert.deepEqual(concurrentMongo.rows.subscription_policy_publications, [plan.target.publication]);

  const projectorRepository = {
    runtimeProviderMappingByProviderIdentity: async () => clone(plan.target.mapping),
    runtimePolicyPublicationByVersion: async () => clone(plan.target.publication),
    releaseProgramById: async () => clone(plan.target.releaseProgram),
    subscriptionTypeById: async () => clone(ready.snapshot.type),
    runtimeProjectionFenceByType: async () => clone(plan.target.fence)
  };
  class FixedProjectorClock extends SubscriptionProviderInstanceProjectorService {
    protected override now(): Date { return new Date('2026-10-01T00:00:00.000Z'); }
  }
  await (new FixedProjectorClock(projectorRepository as any) as any).assertPersistedBinding({
    checkpoint: {
      tenantId: PITER_TENANT_ID,
      provider: 'VIVA',
      providerProductId: PITER_PROVIDER_PRODUCT_ID,
      providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
      binding: {
        fenceId: plan.target.fence.fenceId,
        fenceRevision: plan.target.fence.bindingRevision,
        fenceDigest: plan.target.fence.bindingDigest,
        mappingId: plan.target.mapping.mappingId,
        mappingRevision: plan.target.mapping.revision,
        subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID,
        publicationId: plan.target.publication.publicationId,
        policyVersion: plan.target.publication.policyVersion,
        policyDigest: plan.target.publication.policyDigest,
        releaseProgramId: plan.target.releaseProgram.releaseProgramId,
        releaseProgramRevision: plan.target.releaseProgram.revision,
        releasePhaseId: PHASE_ID,
        runtimeCompatibility: plan.target.publication.runtimeCompatibility
      },
      coverage: { coverageThrough: '2026-10-01T00:00:00.000Z' }
    },
    instances: [{
      homeStationId: PITER_STATION_ID,
      purchasePrice: { amountMinor: PITER_PRICE_MINOR, currency: 'RUB' }
    }]
  });

  const parsed = parseSubscriptionLegacyBindingPromotionManifest(ready.manifest);
  const env = {
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false',
    SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_SHA256: parsed.inputSha256,
    SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_SHA256: plan.planSha256,
    SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_SHA256: ready.manifest.targetSha256,
    SUBSCRIPTIONS_BINDING_PROMOTION_APPROVAL_REF: ready.manifest.approvalRef,
    SUBSCRIPTIONS_BINDING_PROMOTION_EXPECTED_DB: 'phab',
    SUBSCRIPTIONS_BINDING_PROMOTION_SUBSCRIPTION_TYPE_ID: PITER_SUBSCRIPTION_TYPE_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_PROVIDER_PRODUCT_ID: PITER_PROVIDER_PRODUCT_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_ID: PUBLICATION_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_ID: MAPPING_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_RELEASE_PROGRAM_ID: PROGRAM_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_RELEASE_PHASE_ID: PHASE_ID,
    SUBSCRIPTIONS_BINDING_PROMOTION_ACTOR_ID: ready.manifest.actorId,
    SUBSCRIPTIONS_BINDING_PROMOTION_MAX_STALENESS_SECONDS: '30',
    SUBSCRIPTIONS_BINDING_PROMOTION_APPLY_CONFIRM: 'APPLY_PITER_LEGACY_RUNTIME_BINDING_PROMOTION'
  } as NodeJS.ProcessEnv;
  validateSubscriptionLegacyBindingPromotionAttestations({
    env, manifest: parsed, planSha256: plan.planSha256,
    actualTargetSha256: ready.manifest.targetSha256, database: 'phab',
    now: new Date(PROMOTED), requireApplyConfirm: true
  });
  assert.throws(() => validateSubscriptionLegacyBindingPromotionAttestations({
    env: { ...env, SUBSCRIPTIONS_BINDING_PROMOTION_MAX_STALENESS_SECONDS: '5' },
    manifest: parsed, planSha256: plan.planSha256,
    actualTargetSha256: ready.manifest.targetSha256, database: 'phab',
    now: new Date(PROMOTED), requireApplyConfirm: true
  }), hasCode('SUBSCRIPTIONS_BINDING_PROMOTION_EVIDENCE_STALE'));
  assert.throws(() => validateSubscriptionLegacyBindingPromotionAttestations({
    env: { ...env, SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_SHA256: `sha256:${'f'.repeat(64)}` },
    manifest: parsed, planSha256: plan.planSha256,
    actualTargetSha256: ready.manifest.targetSha256, database: 'phab',
    now: new Date(PROMOTED), requireApplyConfirm: true
  }), hasCode('SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_ATTESTATION_MISMATCH'));
  for (const [name, value, code] of [
    ['SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED', undefined, 'SUBSCRIPTIONS_BINDING_PROMOTION_RUNTIME_CONTRACTS_REQUIRED'],
    ['SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED', undefined, 'SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_DISABLED'],
    ['SUBSCRIPTIONS_AUTO_CREATE_INDEXES', 'true', 'SUBSCRIPTIONS_BINDING_PROMOTION_AUTO_INDEXES_FORBIDDEN'],
    ['SUBSCRIPTIONS_BINDING_PROMOTION_APPLY_CONFIRM', 'WRONG', 'SUBSCRIPTIONS_BINDING_PROMOTION_APPLY_CONFIRM_INVALID']
  ] as const) {
    const changed = { ...env };
    if (value === undefined) delete changed[name];
    else changed[name] = value;
    assert.throws(() => validateSubscriptionLegacyBindingPromotionAttestations({
      env: changed, manifest: parsed, planSha256: plan.planSha256,
      actualTargetSha256: ready.manifest.targetSha256, database: 'phab',
      now: new Date(PROMOTED), requireApplyConfirm: true
    }), hasCode(code));
  }

  const output = sanitizedBindingPromotionOutput({
    status: 'READY_TO_PROMOTE', write: false, promotionId: plan.identity.promotionId,
    subscriptionTypeId: plan.identity.subscriptionTypeId,
    providerProductId: plan.identity.providerProductId,
    publicationId: plan.identity.publicationId, mappingId: plan.identity.mappingId,
    releaseProgramId: plan.identity.releaseProgramId, releasePhaseId: plan.identity.releasePhaseId,
    inputSha256: plan.manifest.inputSha256, planSha256: plan.planSha256,
    targetSha256: plan.manifest.targetSha256,
    sourceItemCount: 24, rejectedItemCount: 0, duplicateIdentityCount: 0
  });
  assert.doesNotMatch(JSON.stringify(output), /phone|email|client|name/i);
  assert.equal(safeBindingPromotionErrorCode(new Error('private provider failure detail')), 'SUBSCRIPTIONS_BINDING_PROMOTION_FAILED');

  const privateRoot = await mkdtemp(join(tmpdir(), 'binding-promotion-input-'));
  const privatePath = join(privateRoot, 'manifest.json');
  const symlinkPath = join(privateRoot, 'manifest-link.json');
  try {
    await writeFile(privatePath, JSON.stringify(ready.manifest), { mode: 0o600 });
    process.env.SUBSCRIPTIONS_BINDING_PROMOTION_INPUT = privatePath;
    assert.deepEqual(await readPrivateBindingPromotionManifest(), ready.manifest);
    await symlink(privatePath, symlinkPath);
    process.env.SUBSCRIPTIONS_BINDING_PROMOTION_INPUT = symlinkPath;
    await assert.rejects(
      readPrivateBindingPromotionManifest(),
      /SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_INVALID/
    );
    process.env.SUBSCRIPTIONS_BINDING_PROMOTION_INPUT = privatePath;
    await chmod(privatePath, 0o640);
    await assert.rejects(
      readPrivateBindingPromotionManifest(),
      /SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_PRIVATE_REQUIRED/
    );
  } finally {
    delete process.env.SUBSCRIPTIONS_BINDING_PROMOTION_INPUT;
    await rm(privateRoot, { recursive: true, force: true });
  }

  const controllerSource = readFileSync('src/subscriptions/subscriptions.controller.ts', 'utf8');
  const moduleSource = readFileSync('src/subscriptions/subscriptions.module.ts', 'utf8');
  const serviceSource = readFileSync('src/subscriptions/subscription-legacy-binding-promotion.service.ts', 'utf8');
  assert.doesNotMatch(controllerSource, /binding.promot/i);
  assert.doesNotMatch(moduleSource, /LegacyBindingPromotion/);
  assert.doesNotMatch(serviceSource, /process\.env\.[A-Z_]+\s*\?\?\s*['"]true/);

  console.log('subscriptions legacy binding promotion tests: OK');
}

void main();
