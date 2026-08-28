import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { buildManagedAnnualSubscriptionV2Candidate } from '../src/subscriptions/annual-subscription-policy-v2-candidate';
import {
  buildSubscriptionLegacyBindingPromotionPlan,
  PITER_PRICE_MINOR,
  PITER_PROVIDER_PRODUCT_ID,
  PITER_STATION_ID,
  PITER_SUBSCRIPTION_TYPE_ID,
  PITER_TENANT_ID,
  parseSubscriptionLegacyBindingPromotionManifest,
  subscriptionLegacyBindingPromotionDocumentDigest,
  subscriptionLegacyBindingPromotionIdentity,
  subscriptionLegacyBindingPromotionTargetFingerprint
} from '../src/subscriptions/subscription-legacy-binding-promotion.service';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import type {
  StoredReleaseProgram,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';

const uri = String(process.env.SUBSCRIPTIONS_PROMOTION_MONGODB_TEST_URI ?? '').trim();
if (!uri) {
  console.log('subscriptions legacy binding promotion MongoDB tests: SKIP (SUBSCRIPTIONS_PROMOTION_MONGODB_TEST_URI not set)');
  process.exit(0);
}

const HASH = 'a'.repeat(64);
const PUBLICATION_ID = 'publication:piter-v3';
const MAPPING_ID = 'mapping:piter';
const PROGRAM_ID = 'release_program:piter';
const PHASE_ID = 'release_phase:piter';
const PROMOTED = '2026-08-28T09:00:00.000Z';
const evidence = (kind: string, digit: string) => `${kind}:sha256:${digit.repeat(64)}`;

function sourceFixture(dbName: string) {
  const candidate = buildManagedAnnualSubscriptionV2Candidate('PITER');
  const policy: StoredSubscriptionPolicyVersion = {
    schemaVersion: 3, modelVersion: 3,
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID,
    version: candidate.expectedNextVersion, revision: 1, status: 'PUBLISHED',
    ...candidate.request,
    providerBinding: { ...candidate.request.providerBinding!, evidenceState: 'UNVERIFIED' },
    createdAt: '2026-08-20T12:05:00.000Z', createdBy: 'admin:global',
    idempotency: {
      actorId: 'admin:global', key: 'piter-policy-v3', requestHash: HASH,
      correlationId: 'correlation:piter-policy-v3'
    }
  } as StoredSubscriptionPolicyVersion;
  const type: StoredSubscriptionType = {
    schemaVersion: 1, subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID,
    code: 'piter-annual', codeNorm: 'piter-annual', title: 'Piter annual', description: null,
    state: 'ACTIVE', currentPolicyVersion: policy.version, revision: 2,
    createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
    createdBy: 'admin:global',
    idempotency: {
      actorId: 'admin:global', key: 'piter-type', requestHash: HASH,
      correlationId: 'correlation:piter-type'
    }
  };
  const mapping: StoredSubscriptionProviderMapping = {
    schemaVersion: 1, mappingId: MAPPING_ID, tenantId: PITER_TENANT_ID,
    provider: 'VIVA', providerProductId: PITER_PROVIDER_PRODUCT_ID,
    providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, state: 'VERIFIED',
    evidenceRef: evidence('provider_mapping_evidence', '1'),
    verifiedAt: '2026-08-28T08:59:40.000Z', verifiedBy: 'admin:global', revision: 1,
    createdAt: '2026-08-28T08:59:40.000Z', createdBy: 'admin:global',
    updatedAt: '2026-08-28T08:59:40.000Z', updatedBy: 'admin:global',
    idempotency: {
      actorId: 'admin:global', key: 'piter-mapping', requestHash: HASH,
      correlationId: 'correlation:piter-mapping'
    }
  };
  const runtimeProjection = compileSubscriptionRuntimeProjection(policy);
  const publication: StoredSubscriptionPolicyPublication = {
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
  const releaseProgram: StoredReleaseProgram = {
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
  };
  const manifest = {
    schemaVersion: 'PHAB_SUBSCRIPTION_LEGACY_RUNTIME_BINDING_PROMOTION_V1',
    approvalRef: evidence('provider_approval', '2'),
    providerEvidenceRef: evidence('provider_snapshot_evidence', '3'),
    resultEvidenceRef: evidence('promotion_result', '4'),
    evidence: {
      observedAt: '2026-08-28T08:59:40.000Z', coverageThrough: '2026-08-28T08:59:50.000Z'
    },
    counts: { sourceItemCount: 24, rejectedItemCount: 0, duplicateIdentityCount: 0 },
    tenantId: PITER_TENANT_ID, provider: 'VIVA', providerProductId: PITER_PROVIDER_PRODUCT_ID,
    providerScope: { kind: 'STATION', scopeId: PITER_STATION_ID },
    subscriptionTypeId: PITER_SUBSCRIPTION_TYPE_ID, policyVersion: policy.version,
    publication: {
      publicationId: PUBLICATION_ID,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(publication)
    },
    mapping: {
      mappingId: MAPPING_ID, sourceRevision: 1,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(mapping)
    },
    releaseProgram: {
      releaseProgramId: PROGRAM_ID, releasePhaseId: PHASE_ID, sourceRevision: 1,
      sourceDigest: subscriptionLegacyBindingPromotionDocumentDigest(releaseProgram)
    },
    stationId: PITER_STATION_ID, price: { amountMinor: PITER_PRICE_MINOR, currency: 'RUB' },
    expected: {
      instanceCount: 0, projectorCheckpointCount: 0,
      fenceCount: 0, promotionCheckpointCount: 0
    },
    targetSha256: subscriptionLegacyBindingPromotionTargetFingerprint(uri, dbName),
    promotedAt: PROMOTED, actorId: 'operator:piter-binding'
  };
  return { type, policy, mapping, publication, releaseProgram, manifest };
}

async function seed(client: MongoClient, dbName: string, rejectCheckpoint: boolean) {
  const db = client.db(dbName);
  const source = sourceFixture(dbName);
  await db.createCollection('subscription_projection_fences');
  await db.createCollection(
    'subscription_runtime_binding_promotions',
    rejectCheckpoint
      ? {
        validator: { $jsonSchema: { bsonType: 'object', required: ['forcedMissingField'] } },
        validationLevel: 'strict', validationAction: 'error'
      }
      : undefined
  );
  await Promise.all([
    db.collection('subscription_types').insertOne(structuredClone(source.type)),
    db.collection('subscription_policy_versions').insertOne(structuredClone(source.policy)),
    db.collection('subscription_provider_mappings').insertOne(structuredClone(source.mapping)),
    db.collection('subscription_policy_publications').insertOne(structuredClone(source.publication)),
    db.collection('subscription_release_programs').insertOne(structuredClone(source.releaseProgram))
  ]);
  return source;
}

function repository(client: MongoClient, dbName: string): SubscriptionsRepository {
  const value = new SubscriptionsRepository() as any;
  value.client = client;
  value.db = client.db(dbName);
  return value as SubscriptionsRepository;
}

async function planFor(repo: SubscriptionsRepository, source: ReturnType<typeof sourceFixture>) {
  const parsedIdentity = subscriptionLegacyBindingPromotionIdentity(
    parseSubscriptionLegacyBindingPromotionManifest(source.manifest)
  );
  const snapshot = await repo.legacyBindingPromotionSnapshot(parsedIdentity);
  return buildSubscriptionLegacyBindingPromotionPlan(source.manifest, snapshot);
}

async function run(): Promise<void> {
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const prefix = `binding_promotion_${randomUUID().replaceAll('-', '')}`;
  const rollbackDb = `${prefix}_rollback`;
  const successDb = `${prefix}_success`;
  try {
    const rollbackSource = await seed(client, rollbackDb, true);
    const rollbackRepo = repository(client, rollbackDb);
    const rollbackPlan = await planFor(rollbackRepo, rollbackSource);
    await assert.rejects(rollbackRepo.applyLegacyBindingPromotion(rollbackPlan));
    assert.deepEqual(
      await client.db(rollbackDb).collection('subscription_provider_mappings').findOne({}, { projection: { _id: 0 } }),
      rollbackSource.mapping
    );
    assert.deepEqual(
      await client.db(rollbackDb).collection('subscription_policy_publications').findOne({}, { projection: { _id: 0 } }),
      rollbackSource.publication
    );
    assert.equal(await client.db(rollbackDb).collection('subscription_projection_fences').countDocuments(), 0);

    const successSource = await seed(client, successDb, false);
    const successPlan = await planFor(repository(client, successDb), successSource);
    const results = await Promise.all([
      repository(client, successDb).applyLegacyBindingPromotion(successPlan),
      repository(client, successDb).applyLegacyBindingPromotion(successPlan)
    ]);
    assert.ok(results.includes('PROMOTED'));
    assert.ok(results.every((result) => result === 'PROMOTED' || result === 'EXACT_REPLAY'));
    assert.equal(
      await client.db(successDb).collection('subscription_runtime_binding_promotions').countDocuments(),
      1
    );
    assert.equal(
      await repository(client, successDb).applyLegacyBindingPromotion(successPlan),
      'EXACT_REPLAY'
    );
    assert.deepEqual(
      await client.db(successDb).collection('subscription_policy_publications').findOne({}, { projection: { _id: 0 } }),
      successPlan.target.publication
    );
    console.log('subscriptions legacy binding promotion MongoDB tests: OK');
  } finally {
    await client.db(rollbackDb).dropDatabase().catch(() => undefined);
    await client.db(successDb).dropDatabase().catch(() => undefined);
    await client.close();
  }
}

void run();
