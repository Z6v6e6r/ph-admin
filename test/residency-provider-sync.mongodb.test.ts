import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ResidencyObservationRepository, ResidencyBindingSnapshot } from '../src/subscriptions/residency-observation.repository';
import { RESIDENCY_OBSERVATION_COLLECTION, RESIDENCY_OBSERVATION_INDEXES,
  normalizeResidencyProviderFacts, residencyDigest, residencyInstanceId, StoredResidencyObservation } from '../src/subscriptions/residency-provider-observation';
import { SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES } from '../src/subscriptions/subscriptions.repository';
import { bindingFixture, providerFixture, actor } from './residency-provider-sync.test';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { buildSubscriptionProjectionFence } from '../src/subscriptions/subscription-projection-fence';

async function main() {
  const uri = process.env.RESIDENCY_TEST_MONGO_URI;
  if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw Error('Explicit localhost replica-set test URI required');
  const dbName = 'residency_jit_test_' + process.pid + '_' + Date.now();
  const oldUri = process.env.SUBSCRIPTIONS_MONGODB_URI, oldDb = process.env.SUBSCRIPTIONS_MONGODB_DB;
  process.env.SUBSCRIPTIONS_MONGODB_URI = uri; process.env.SUBSCRIPTIONS_MONGODB_DB = dbName;
  const client = new MongoClient(uri); await client.connect(); const db = client.db(dbName);
  let cases = 0, serial = 0;
  let purchaseTime = new Date(Date.now() - 3600000).toISOString();
  const stamp = () => new Date(Date.now() - 2000 + serial++).toISOString();
  let repo = new ResidencyObservationRepository();
  async function seed() {
    await repo.onModuleDestroy(); await db.dropDatabase(); repo = new ResidencyObservationRepository();
    for (const [name, indexes] of [
      ['subscription_provider_mappings', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.mappings],
      ['subscription_policy_publications', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.publications],
      ['subscription_projection_fences', SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.projectionFences],
      [RESIDENCY_OBSERVATION_COLLECTION, RESIDENCY_OBSERVATION_INDEXES]
    ] as const) for (const index of indexes) {
      const { key, ...options } = index; await db.collection(name).createIndex(key, options);
    }
    purchaseTime = new Date(Date.now() - 3600000).toISOString();
    const b = bindingFixture(), effective = new Date(Date.now() - 2 * 86400000).toISOString();
    const p = b.publications[0]; p.effectiveAt = effective; p.publishedAt = effective; p.runtimeProjection.effectiveAt = effective;
    p.policyDigest = computeSubscriptionRuntimeProjectionDigest(p.runtimeProjection);
    Object.assign(b.mapping, { verifiedAt: effective, createdAt: effective, updatedAt: effective });
    b.fence = buildSubscriptionProjectionFence({ mapping: b.mapping, publication: p, previous: null });
    await db.collection('subscription_provider_mappings').insertOne(b.mapping);
    await db.collection('subscription_policy_publications').insertMany(b.publications);
    await db.collection('subscription_projection_fences').insertOne(b.fence);
    return repo.binding(actor.tenantId);
  }
  function observation(b: ResidencyBindingSnapshot, options: { clientId?: string; subscriptionId?: string; at?: string; status?: string; paymentDate?: string } = {}): StoredResidencyObservation {
    const at = options.at || stamp(), clientId = options.clientId || actor.providerClientId;
    const subscriptionId = options.subscriptionId || 'subscription:residency-test';
    const fixture = providerFixture(); fixture.subscription.subscriptionId = subscriptionId; fixture.transaction.client.id = clientId;
    fixture.subscription.purchaseDate = purchaseTime; fixture.subscription.activationDate = purchaseTime;
    fixture.subscription.expirationDate = new Date(Date.parse(purchaseTime) + 30 * 86400000).toISOString();
    fixture.transaction.paymentDate = options.paymentDate || purchaseTime;
    if (options.status) fixture.subscription.status = options.status;
    const facts = normalizeResidencyProviderFacts({ ...fixture, providerClientId: clientId, clientSubscriptionId: subscriptionId,
      observedAt: new Date().toISOString() });
    const p = b.publications[0];
    return { schemaVersion: 1, sourceKind: 'VIVA_OWNED_SUBSCRIPTION_READ', subscriptionInstanceId: residencyInstanceId(actor.tenantId, subscriptionId),
      tenantId: actor.tenantId, providerClientId: clientId, clientSubscriptionId: subscriptionId, clientRefHash: actor.clientRefHash,
      facts, binding: { subscriptionTypeId: p.subscriptionTypeId, policyVersion: p.policyVersion, policyDigest: p.policyDigest,
        publicationId: p.publicationId, mappingId: p.mappingId }, evidence: { instanceObservedAt: at, productObservedAt: at,
        sourceDigest: facts.sourceDigest, productEvidenceRef: 'evidence:product:' + serial, mappingRevision: b.mapping.revision + 1 },
      revision: 1, createdAt: at, updatedAt: at, refreshId: residencyDigest({ at, serial, clientId, subscriptionId, revision: b.mapping.revision }) };
  }
  async function mappingRevision() { return (await db.collection('subscription_provider_mappings').findOne({}))!.revision; }
  try {
    let b = await seed(), o = observation(b);
    const first = await repo.persist(b, o);
    assert.equal(first.revision, 1); assert.equal(await mappingRevision(), 2);
    const fence = await db.collection('subscription_projection_fences').findOne({});
    assert.equal(fence!.binding.mappingRevision, 2); assert.equal(fence!.bindingRevision, 2); assert.equal(fence!.lastProjectorReconciliationDigest, null); cases++;
    const replay = await repo.persist(b, o); assert.deepEqual(replay, first); assert.equal(await mappingRevision(), 2); cases++;
    b = await repo.binding(actor.tenantId); const fresh = observation(b);
    const updated = await repo.persist(b, fresh); assert.equal(updated.revision, 2); assert.equal(updated.createdAt, first.createdAt); cases++;
    b = await repo.binding(actor.tenantId);
    await assert.rejects(repo.persist(b, observation(b, { at: first.evidence.instanceObservedAt }))); assert.equal(await mappingRevision(), 3); cases++;
    const foreign = observation(b, { clientId: 'client:foreign' });
    await assert.rejects(repo.persist(b, foreign)); assert.equal(await mappingRevision(), 3); cases++;

    // Sub-ms edits must not silently rebind/extend the same issuance even when the v1 ms timestamp is identical.
    b = await seed();
    const paidRaw = purchaseTime.replace('Z', '001Z');
    const originalPaid = await repo.persist(b, observation(b, { paymentDate: paidRaw }));
    b = await repo.binding(actor.tenantId);
    const originalFence = await db.collection('subscription_projection_fences').findOne({});
    for (const paymentDate of [purchaseTime.replace('Z', '002Z'), paidRaw.replace('Z', '+00:00')]) {
      const edited = observation(b, { paymentDate });
      assert.equal(edited.facts.purchasedAt, originalPaid.facts.purchasedAt);
      await assert.rejects(repo.persist(b, edited), (e: any) => e.getResponse?.().code === 'RESIDENCY_SYNC_IMMUTABLE_PURCHASE_CHANGED');
      assert.equal(await mappingRevision(), 2);
      assert.deepEqual(await db.collection('subscription_projection_fences').findOne({}), originalFence);
      const saved = await db.collection(RESIDENCY_OBSERVATION_COLLECTION).findOne({});
      assert.equal(saved!.facts.paymentDateRaw, paidRaw); assert.equal(saved!.revision, 1); cases++;
    }

    b = await seed(); const a = observation(b), z = observation(b);
    const race = await Promise.allSettled([repo.persist(b, a), repo.persist(b, z)]);
    assert.equal(race.filter(x => x.status === 'fulfilled').length, 1); assert.equal(await mappingRevision(), 2);
    assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1); cases++;
    b = await repo.binding(actor.tenantId);
    await repo.persist(b, observation(b, { clientId: 'client:second', subscriptionId: 'subscription:second' }));
    assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 2); cases++;

    b = await seed(); await repo.persist(b, observation(b));
    b = await repo.binding(actor.tenantId); const held = await repo.persist(b, observation(b, { status: 'HOLD' }));
    assert.equal(held.facts.eligible, false); assert.equal(held.facts.providerStatus, 'HOLD'); cases++;
    b = await repo.binding(actor.tenantId); const resumed = await repo.persist(b, observation(b));
    assert.equal(resumed.facts.eligible, true); assert.equal(resumed.revision, 3); cases++;

    b = await seed(); const one = observation(b), two = observation(b, { clientId: 'client:second', subscriptionId: 'subscription:second' });
    const sharedRace = await Promise.allSettled([repo.persist(b, one), repo.persist(b, two)]);
    assert.equal(sharedRace.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = sharedRace[0].status === 'rejected' ? one : two;
    b = await repo.binding(actor.tenantId);
    await repo.persist(b, observation(b, { clientId: rejected.providerClientId, subscriptionId: rejected.clientSubscriptionId }));
    assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 2); cases++;

    b = await seed(); o = observation(b);
    await db.collection('subscription_policy_publications').updateOne({}, { $set: { state: 'DISABLED_FOR_NEW_OPERATIONS' } });
    await assert.rejects(repo.persist(b, o)); assert.equal(await mappingRevision(), 1);
    assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 0); cases++;

    b = await seed(); o = observation(b);
    const nativeDb = (repo as any).db, originalCollection = nativeDb.collection.bind(nativeDb);
    nativeDb.collection = (name: string) => {
      const collection = originalCollection(name);
      if (name !== RESIDENCY_OBSERVATION_COLLECTION) return collection;
      return new Proxy(collection, { get(target, key) {
        if (key === 'insertOne') return async () => { throw Error('SYNTHETIC_OBSERVATION_INSERT_FAILURE'); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    await assert.rejects(repo.persist(b, o)); nativeDb.collection = originalCollection;
    assert.equal(await mappingRevision(), 1); assert.equal((await db.collection('subscription_projection_fences').findOne({}))!.bindingRevision, 1);
    assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 0); cases++;

    b = await seed(); o = observation(b);
    async function commitLostResponse(afterCommit?: () => Promise<void>) {
      const nativeClient = (repo as any).client, start = nativeClient.startSession.bind(nativeClient);
      nativeClient.startSession = (...args: any[]) => {
        const session = start(...args), withTransaction = session.withTransaction.bind(session);
        session.withTransaction = async (...txArgs: any[]) => {
          await withTransaction(...txArgs); nativeClient.startSession = start;
          if (afterCommit) await afterCommit();
          throw Error('SYNTHETIC_COMMIT_REPLY_LOST');
        };
        return session;
      };
    }
    await commitLostResponse(); const recovered = await repo.persist(b, o);
    assert.equal(recovered.refreshId, o.refreshId); assert.equal(await mappingRevision(), 2); cases++;

    b = await seed(); o = observation(b);
    await commitLostResponse(async () => { const newer = await repo.binding(actor.tenantId); await repo.persist(newer, observation(newer)); });
    await assert.rejects(repo.persist(b, o)); assert.equal(await mappingRevision(), 3); cases++;

    b = await seed(); o = observation(b);
    await commitLostResponse(async () => { await db.collection(RESIDENCY_OBSERVATION_COLLECTION).updateOne({}, { $set: { 'facts.purchaseAmountMinor': 1 } }); });
    await assert.rejects(repo.persist(b, o)); cases++;

    b = await seed(); o = observation(b);
    o.evidence.instanceObservedAt = new Date(Date.now() - 31000).toISOString();
    await assert.rejects(repo.persist(b, o)); assert.equal(await mappingRevision(), 1); cases++;
    o = observation(b); o.evidence.productObservedAt = new Date(Date.now() + 10000).toISOString();
    await assert.rejects(repo.persist(b, o)); assert.equal(await mappingRevision(), 1); cases++;
    console.log(`residency local MongoDB replica-set transaction/recovery: ${cases} cases PASS`);
  } finally {
    await repo.onModuleDestroy(); await db.dropDatabase(); await client.close();
    if (oldUri === undefined) delete process.env.SUBSCRIPTIONS_MONGODB_URI; else process.env.SUBSCRIPTIONS_MONGODB_URI = oldUri;
    if (oldDb === undefined) delete process.env.SUBSCRIPTIONS_MONGODB_DB; else process.env.SUBSCRIPTIONS_MONGODB_DB = oldDb;
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
