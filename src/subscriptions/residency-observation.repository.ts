import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, Db } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { RESIDENCY_PRODUCT_ID, residencyBookingPolicyBlockers } from './residency-booking-policy';
import { validateStoredSubscriptionPolicyPublication, validateStoredSubscriptionProviderMapping,
  validateStoredSubscriptionProjectionFence } from './subscription-runtime-contracts';
import { subscriptionProjectionFenceBinding, subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId } from './subscription-projection-fence';
import { resolveSubscriptionSalePeriod } from './subscription-sale-period-resolver';
import { SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES, subscriptionIndexMatches } from './subscriptions.repository';
import { StoredSubscriptionPolicyPublication, StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping } from './subscriptions.types';
import { residencyDigest, residencyFailure, RESIDENCY_OBSERVATION_COLLECTION,
  RESIDENCY_OBSERVATION_INDEXES, residencyRemainingMS, withinResidencyDeadline, StoredResidencyObservation } from './residency-provider-observation';

export interface ResidencyBindingSnapshot {
  mapping: StoredSubscriptionProviderMapping;
  publications: StoredSubscriptionPolicyPublication[];
  fence: StoredSubscriptionProjectionFence;
}

@Injectable()
export class ResidencyObservationRepository implements OnModuleDestroy {
  private client?: MongoClient;
  private db?: Db;
  private connecting?: Promise<void>;

  async connect(requireObservationIndexes = true, deadline = Date.now() + 8000): Promise<void> {
    if (this.connecting) await withinResidencyDeadline(() => this.connecting!, deadline);
    if (!this.db) {
      this.connecting = (async () => {
        const uri = process.env.SUBSCRIPTIONS_MONGODB_URI || process.env.MONGODB_URI;
        const dbName = process.env.SUBSCRIPTIONS_MONGODB_DB;
        if (!uri || !dbName) residencyFailure('DATABASE_CONFIG');
        const remaining = residencyRemainingMS(deadline);
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: Math.min(5000, remaining),
          connectTimeoutMS: Math.min(5000, remaining), timeoutMS: remaining, maxPoolSize: 5 });
        try { await withinResidencyDeadline(() => client.connect(), deadline); }
        catch (error) { await client.close(); throw error; }
        this.client = client; this.db = client.db(dbName);
      })();
      try { await this.connecting; } finally { this.connecting = undefined; }
    }
    // No startup migration or automatic index creation. Explicit deployment maintenance owns DDL.
    if (requireObservationIndexes) {
      let indexes;
      try { indexes = await withinResidencyDeadline(() => this.database().collection(RESIDENCY_OBSERVATION_COLLECTION)
        .listIndexes({ timeoutMS: residencyRemainingMS(deadline) }).toArray(), deadline); }
      catch { return residencyFailure('INDEXES_NOT_READY'); }
      for (const required of RESIDENCY_OBSERVATION_INDEXES) {
        if (!indexes.some(index => index.name === required.name && index.unique === true
          && isDeepStrictEqual(index.key, required.key)
          && !index.hidden && !index.sparse && !index.partialFilterExpression && index.expireAfterSeconds === undefined
          && (!index.collation || index.collation.locale === 'simple'))) {
          residencyFailure('INDEXES_NOT_READY');
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> { await this.client?.close(); this.db = undefined; this.client = undefined; }
  protected database(): Db { if (!this.db) residencyFailure('DATABASE_NOT_CONNECTED'); return this.db; }

  async binding(tenantId: string, deadline = Date.now() + 8000): Promise<ResidencyBindingSnapshot> {
    await this.connect(false, deadline);
    for (const [collection, required] of [
      ['subscription_provider_mappings', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.mappings],
      ['subscription_policy_publications', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.publications],
      ['subscription_projection_fences', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.projectionFences]
    ] as const) {
      const indexes = await withinResidencyDeadline(() => this.database().collection(collection)
        .listIndexes({ timeoutMS: residencyRemainingMS(deadline) }).toArray(), deadline);
      if (required.some(index => !indexes.some(actual => subscriptionIndexMatches(actual, index)))) residencyFailure('CATALOG_INDEXES_NOT_READY');
    }
    const mappings = await this.database().collection<StoredSubscriptionProviderMapping>('subscription_provider_mappings')
      .find({ tenantId, provider: 'VIVA', providerProductId: RESIDENCY_PRODUCT_ID, state: 'VERIFIED' },
        { projection: { _id: 0 }, timeoutMS: residencyRemainingMS(deadline), readPreference: 'primary', readConcern: { level: 'majority' } }).limit(2).maxTimeMS(5000).toArray();
    if (mappings.length !== 1) residencyFailure('MAPPING_NOT_UNIQUE');
    const mapping = mappings[0]; validateStoredSubscriptionProviderMapping(mapping);
    if (mapping.providerScope.kind !== 'TENANT' || mapping.providerScope.scopeId !== tenantId) residencyFailure('MAPPING_SCOPE');
    const publications = await this.database().collection<StoredSubscriptionPolicyPublication>('subscription_policy_publications')
      .find({ subscriptionTypeId: mapping.subscriptionTypeId },
        { projection: { _id: 0 }, timeoutMS: residencyRemainingMS(deadline), readPreference: 'primary', readConcern: { level: 'majority' } }).maxTimeMS(5000).toArray();
    publications.forEach(validateStoredSubscriptionPolicyPublication);
    const fence = await this.database().collection<StoredSubscriptionProjectionFence>('subscription_projection_fences')
      .findOne({ subscriptionTypeId: mapping.subscriptionTypeId },
        { projection: { _id: 0 }, timeoutMS: residencyRemainingMS(deadline), maxTimeMS: 5000, readPreference: 'primary', readConcern: { level: 'majority' } });
    if (!fence) residencyFailure('FENCE_MISSING');
    validateStoredSubscriptionProjectionFence(fence);
    const current = publications.find(p => p.publicationId === fence.binding.publicationId);
    if (!current || current.state !== 'PUBLISHED' || current.mappingId !== mapping.mappingId
      || residencyBookingPolicyBlockers(current.runtimeProjection).length
      || fence.fenceId !== subscriptionProjectionFenceId(mapping.subscriptionTypeId)
      || !isDeepStrictEqual(fence.binding, subscriptionProjectionFenceBinding(mapping, current))
      || fence.bindingDigest !== subscriptionProjectionFenceBindingDigest(fence.binding)) residencyFailure('BINDING_INVALID');
    return { mapping, publications, fence };
  }

  async persist(snapshot: ResidencyBindingSnapshot, observation: StoredResidencyObservation, deadline = Date.now() + 5000): Promise<StoredResidencyObservation> {
    const times = [observation.evidence.productObservedAt, observation.evidence.instanceObservedAt, observation.updatedAt].map(Date.parse);
    if (observation.schemaVersion !== 1 || observation.sourceKind !== 'VIVA_OWNED_SUBSCRIPTION_READ'
      || times.some(t => !Number.isFinite(t) || t > Date.now()) || Date.now() - Math.min(...times) >= 30000
      || observation.tenantId !== snapshot.mapping.tenantId || observation.binding.mappingId !== snapshot.mapping.mappingId
      || observation.binding.subscriptionTypeId !== snapshot.mapping.subscriptionTypeId
      || observation.facts.providerProductId !== RESIDENCY_PRODUCT_ID
      || observation.providerClientId !== observation.facts.providerClientId
      || observation.clientSubscriptionId !== observation.facts.clientSubscriptionId
      || !/^sha256:[a-f0-9]{64}$/.test(observation.refreshId)
      || !/^[a-f0-9]{64}$/.test(observation.clientRefHash)) residencyFailure('OBSERVATION_INVALID');
    await this.connect(true, deadline);
    if (Date.now() >= deadline) residencyFailure('DEADLINE');
    const db = this.database(), client = this.client!;
    const session = client.startSession();
    const observations = db.collection<StoredResidencyObservation>(RESIDENCY_OBSERVATION_COLLECTION);
    const identity = { tenantId: observation.tenantId, clientSubscriptionId: observation.clientSubscriptionId };
    const sameObservation = (saved: StoredResidencyObservation): boolean => {
      const semantic = (value: StoredResidencyObservation) => {
        const { revision, createdAt, updatedAt, ...facts } = value; return facts;
      };
      return isDeepStrictEqual(semantic(saved), semantic(observation));
    };
    let committed: StoredResidencyObservation | undefined;
    try {
      await session.withTransaction(async () => {
        if (Date.now() - Math.min(Date.parse(observation.evidence.productObservedAt),
          Date.parse(observation.evidence.instanceObservedAt)) >= 30000) residencyFailure('OBSERVATION_EXPIRED');
        const mapping = await db.collection('subscription_provider_mappings').findOne(
          { mappingId: snapshot.mapping.mappingId }, { session, projection: { _id: 0 } });
        const fence = await db.collection('subscription_projection_fences').findOne(
          { fenceId: snapshot.fence.fenceId }, { session, projection: { _id: 0 } });
        const publications = await db.collection('subscription_policy_publications').find(
          { subscriptionTypeId: snapshot.mapping.subscriptionTypeId }, { session, projection: { _id: 0 } }).toArray();
        const existing = await observations.findOne(identity, { session, projection: { _id: 0 } });
        // Exact replay after commit/lost response never re-applies increments.
        if (existing?.refreshId === observation.refreshId) {
          if (!sameObservation(existing)) residencyFailure('REPLAY_MISMATCH');
          committed = existing; return;
        }
        if (!isDeepStrictEqual(mapping, snapshot.mapping) || !isDeepStrictEqual(fence, snapshot.fence)
          || residencyDigest([...publications].sort((a, b) => a.policyVersion - b.policyVersion))
          !== residencyDigest([...snapshot.publications].sort((a, b) => a.policyVersion - b.policyVersion))) {
          residencyFailure('BINDING_CHANGED');
        }
        const resolution = resolveSubscriptionSalePeriod({ purchasedAt: observation.facts.purchasedAt,
          publications: snapshot.publications });
        if (resolution.kind !== 'MATCH' || resolution.publication.publicationId !== observation.binding.publicationId
          || resolution.publication.policyDigest !== observation.binding.policyDigest
          || resolution.publication.state === 'DISABLED_FOR_NEW_OPERATIONS') residencyFailure('SALE_PERIOD');
        if (Date.parse(observation.evidence.productObservedAt) <= Date.parse(snapshot.mapping.verifiedAt || '')
          || Date.parse(observation.evidence.productObservedAt) < Date.parse(snapshot.mapping.updatedAt)
          || (existing && Date.parse(observation.evidence.instanceObservedAt) <= Date.parse(existing.evidence.instanceObservedAt))) {
          residencyFailure('OUT_OF_ORDER_OBSERVATION');
        }
        if (existing && (existing.providerClientId !== observation.providerClientId
          || existing.clientRefHash !== observation.clientRefHash
          || existing.facts.purchasedAt !== observation.facts.purchasedAt
          || existing.facts.transactionId !== observation.facts.transactionId
          || !isDeepStrictEqual(existing.binding, observation.binding))) residencyFailure('IMMUTABLE_PURCHASE_CHANGED');
        const nextMapping: StoredSubscriptionProviderMapping = { ...snapshot.mapping,
          revision: snapshot.mapping.revision + 1, verifiedAt: observation.evidence.productObservedAt,
          evidenceRef: observation.evidence.productEvidenceRef, verifiedBy: 'service:residency-sync',
          updatedAt: observation.evidence.productObservedAt, updatedBy: 'service:residency-sync' };
        const current = snapshot.publications.find(p => p.publicationId === snapshot.fence.binding.publicationId)!;
        const nextBinding = subscriptionProjectionFenceBinding(nextMapping, current);
        const nextFence: StoredSubscriptionProjectionFence = { ...snapshot.fence,
          binding: nextBinding, bindingDigest: subscriptionProjectionFenceBindingDigest(nextBinding),
          bindingRevision: snapshot.fence.bindingRevision + 1, coordinationRevision: snapshot.fence.coordinationRevision + 1,
          updatedAt: observation.updatedAt, lastProjectorReconciliationDigest: null };
        validateStoredSubscriptionProviderMapping(nextMapping); validateStoredSubscriptionProjectionFence(nextFence);
        const next = { ...observation, revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? observation.createdAt };
        const m = await db.collection('subscription_provider_mappings').replaceOne(
          { mappingId: snapshot.mapping.mappingId, revision: snapshot.mapping.revision }, nextMapping, { session });
        const f = await db.collection('subscription_projection_fences').replaceOne(
          { fenceId: snapshot.fence.fenceId, bindingRevision: snapshot.fence.bindingRevision,
            coordinationRevision: snapshot.fence.coordinationRevision }, nextFence, { session });
        if (m.modifiedCount !== 1 || f.modifiedCount !== 1) residencyFailure('BINDING_CHANGED');
        if (existing) {
          const result = await observations.replaceOne({ ...identity, revision: existing.revision }, next, { session });
          if (result.modifiedCount !== 1) residencyFailure('OBSERVATION_CHANGED');
        } else await observations.insertOne({ ...next }, { session });
        committed = next;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', j: true }, readPreference: 'primary',
        maxCommitTimeMS: 1500, timeoutMS: Math.max(1, Math.min(3000, deadline - Date.now())) });
    } catch (error) {
      // An uncertain commit can be acknowledged only by its exact immutable observation ID.
      residencyRemainingMS(deadline);
      const saved = await observations.findOne(identity, { projection: { _id: 0 }, maxTimeMS: 1000,
        timeoutMS: Math.max(1, Math.min(1000, deadline - Date.now())), readPreference: 'primary', readConcern: { level: 'majority' } });
      if (saved?.refreshId === observation.refreshId && sameObservation(saved)) return saved;
      throw error;
    } finally { await session.endSession(); }
    if (!committed) residencyFailure('COMMIT_NOT_CONFIRMED');
    return committed;
  }
}
