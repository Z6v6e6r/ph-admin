import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ResidencyObservationRepository, ResidencyBindingSnapshot } from '../src/subscriptions/residency-observation.repository';
import { ResidencyProviderSyncService } from '../src/subscriptions/residency-provider-sync.service';
import { RESIDENCY_PRODUCT_ID } from '../src/subscriptions/residency-booking-policy';
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

    // Service-level composite evidence on the same disposable replica set:
    // repeated confirmation and a restart must keep one residency instance, while a
    // disputed total or a refunded line must deny the right.
    const oldComposite = process.env.SUBSCRIPTIONS_RESIDENCY_COMPOSITE_LINES_ENABLED;
    const oldStudio = process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID;
    const oldTtl = process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS;
    process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID = 'studio:test';
    process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = '60';
    const compositeFixture = (subscriptionId = 'subscription:residency-test') => {
      const f: any = providerFixture();
      f.subscription.subscriptionId = subscriptionId;
      f.subscription.transactionId = 'transaction:' + subscriptionId;
      f.transaction.id = 'transaction:' + subscriptionId;
      f.subscription.purchaseDate = purchaseTime;
      f.subscription.activationDate = purchaseTime;
      f.subscription.expirationDate = new Date(Date.parse(purchaseTime) + 30 * 86400000).toISOString();
      f.transaction.paymentDate = purchaseTime;
      f.transaction.products = [
        { id: 'service:group-training', count: 1, cost: 160000, discount: 80000 },
        { id: RESIDENCY_PRODUCT_ID, count: 1, cost: 79000, discount: 0 }];
      f.transaction.sum = 239000; f.transaction.discount = 80000; f.transaction.toPay = 159000;
      return f;
    };
    const service = (read: () => any) => {
      const identity: any = { authorizeResidencyRefresh: async () => actor };
      const viva: any = { readResidencySubscriptionEvidence: async () => read() };
      class TestService extends ResidencyProviderSyncService { protected now() { return new Date(); } }
      return new TestService(identity, repo, viva);
    };
    const readAt = (fixture: any, at: string) => ({ ...fixture, instanceObservedAt: at, productObservedAt: at });
    try {
      process.env.SUBSCRIPTIONS_RESIDENCY_COMPOSITE_LINES_ENABLED = 'true';
      b = await seed();
      const composite = compositeFixture();
      let at = stamp();
      let sync = service(() => readAt(composite, at));
      const firstContext = await sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:residency-test' });
      const instanceId = firstContext.context.instance.subscriptionInstanceId;
      assert.equal(firstContext.context.instance.state, 'ACTIVE');
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1); cases++;

      at = stamp(); sync = service(() => readAt(composite, at));
      const repeatedContext = await sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:residency-test' });
      assert.equal(repeatedContext.context.instance.subscriptionInstanceId, instanceId);
      assert.equal(repeatedContext.context.instance.state, 'ACTIVE');
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1); cases++;

      await repo.onModuleDestroy(); repo = new ResidencyObservationRepository();
      at = stamp(); sync = service(() => readAt(composite, at));
      const restartedContext = await sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:residency-test' });
      assert.equal(restartedContext.context.instance.subscriptionInstanceId, instanceId);
      assert.equal(restartedContext.context.instance.state, 'ACTIVE');
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1); cases++;

      const beforeDispute = await mappingRevision();
      const disputed = compositeFixture(); disputed.transaction.toPay = 1;
      at = stamp(); sync = service(() => readAt(disputed, at));
      await assert.rejects(sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:residency-test' }),
        (e: any) => e.getResponse?.().code === 'RESIDENCY_SYNC_PAYMENT_AMOUNTS');
      assert.equal(await mappingRevision(), beforeDispute);
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1); cases++;

      b = await seed();
      const refunded = compositeFixture('subscription:refund-test');
      refunded.transaction.products[0].refunded = true;
      at = stamp(); sync = service(() => readAt(refunded, at));
      await assert.rejects(sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:refund-test' }),
        (e: any) => e.getResponse?.().code === 'RESIDENCY_SYNC_REFUND_OR_PENDING_REFUND');
      const denied = await db.collection(RESIDENCY_OBSERVATION_COLLECTION).findOne({});
      assert.equal(denied!.facts.eligible, false);
      at = stamp(); sync = service(() => readAt(refunded, at));
      await assert.rejects(sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:refund-test' }),
        (e: any) => e.getResponse?.().code === 'RESIDENCY_SYNC_REFUND_OR_PENDING_REFUND');
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 1);
      assert.equal((await db.collection(RESIDENCY_OBSERVATION_COLLECTION).findOne({}))!.facts.eligible, false); cases++;

      b = await seed();
      process.env.SUBSCRIPTIONS_RESIDENCY_COMPOSITE_LINES_ENABLED = 'false';
      const off = compositeFixture();
      at = stamp(); sync = service(() => readAt(off, at));
      await assert.rejects(sync.refresh('Bearer test', 'integration-token', { clientSubscriptionId: 'subscription:residency-test' }),
        (e: any) => e.getResponse?.().code === 'RESIDENCY_SYNC_PAYMENT_LINES');
      assert.equal(await db.collection(RESIDENCY_OBSERVATION_COLLECTION).countDocuments(), 0); cases++;
    } finally {
      if (oldComposite === undefined) delete process.env.SUBSCRIPTIONS_RESIDENCY_COMPOSITE_LINES_ENABLED;
      else process.env.SUBSCRIPTIONS_RESIDENCY_COMPOSITE_LINES_ENABLED = oldComposite;
      if (oldStudio === undefined) delete process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID;
      else process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID = oldStudio;
      if (oldTtl === undefined) delete process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS;
      else process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = oldTtl;
    }

    console.log(`residency local MongoDB replica-set transaction/recovery: ${cases} cases PASS`);
  } finally {
    await repo.onModuleDestroy(); await db.dropDatabase(); await client.close();
    if (oldUri === undefined) delete process.env.SUBSCRIPTIONS_MONGODB_URI; else process.env.SUBSCRIPTIONS_MONGODB_URI = oldUri;
    if (oldDb === undefined) delete process.env.SUBSCRIPTIONS_MONGODB_DB; else process.env.SUBSCRIPTIONS_MONGODB_DB = oldDb;
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
