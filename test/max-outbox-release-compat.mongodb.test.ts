import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { LegacyMaxCustodyStore, legacyMaxHeld } from '../src/support/legacy-max-custody';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  assert.ok(uri, 'Pass the owned disposable loopback Mongo URI');
  const target = new URL(uri);
  assert.equal(target.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Loopback Mongo only');
  assert.equal(target.username + target.password + target.search + target.hash, '');
  assert.ok(target.pathname === '' || target.pathname === '/', 'Explicit owned fixture only');
  const dbName = 'cup_release_compat_' + randomUUID().replace(/-/g, '');
  const beforeEnv = { ...process.env };
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  let persistence: SupportPersistenceService | undefined;
  try {
    for (const key of ['MONGODB_URI', 'MONGODB_DB', 'GAMES_MONGODB_URI', 'GAMES_MONGODB_DB',
      'SUPPORT_WEB_MONGODB_URI', 'SUPPORT_WEB_MONGODB_DB', 'SUPPORT_MAX_MONGODB_URI', 'SUPPORT_MAX_MONGODB_DB']) delete process.env[key];
    process.env.SUPPORT_MONGODB_URI = uri;
    process.env.SUPPORT_MONGODB_DB = dbName;
    process.env.SUPPORT_OUTBOX_COLLECTION = 'support_outbox';
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy';
    process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS = '0';
    process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED = 'false';
    process.env.NODE_ENV = 'test';
    await client.connect();
    const db = client.db(dbName), coll = db.collection('support_outbox');
    const waitStatus = async (id: string, status: string) => {
      for (let i = 0; i < 100; i++) {
        if ((await coll.findOne({ id }))?.status === status) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail('Legacy durable transition not observed');
    };
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      await coll.deleteMany({});
      const id = randomUUID();
      await coll.insertOne({ id, connector, dialogId: 'synthetic', clientId: 'synthetic', text: 'synthetic',
        createdAt: new Date().toISOString(), status: Status.PENDING, attempts: 0 });
      persistence = new SupportPersistenceService();
      await persistence.onModuleInit();
      const service = new SupportService(persistence, {} as any, {} as any) as any;
      for (const command of (await persistence.loadState()).outbox) service.outbox.set(command.id, command);
      assert.equal((await service.pullOutbox(connector)).length, 1);
      await waitStatus(id, Status.LEASED);
      await service.ackOutbox(id);
      await waitStatus(id, Status.SENT);
      await persistence.onModuleDestroy();
      persistence = new SupportPersistenceService();
      await persistence.onModuleInit();
      const restarted = new SupportService(persistence, {} as any, {} as any) as any;
      for (const command of (await persistence.loadState()).outbox) restarted.outbox.set(command.id, command);
      assert.deepEqual(await restarted.pullOutbox(connector), []);
      await persistence.onModuleDestroy();
      persistence = undefined;
    }
    // Actual Mongo BSON/full-document $expr CAS, not a collection mock. Both legacy connectors.
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      await coll.deleteMany({});
      persistence = new SupportPersistenceService();
      await persistence.onModuleInit();
      const store = new LegacyMaxCustodyStore(coll as any);
      const command: Command = { id: randomUUID(), connector, dialogId: 'synthetic-dialog', clientId: 'synthetic-client',
        text: 'synthetic message', targetExternalChatId: 'synthetic-target', createdAt: new Date().toISOString(),
        status: Status.PENDING, attempts: 0 };
      const accepted = await store.transition(command, 'enqueue');
      const lease = (): Command => ({ ...accepted, status: Status.LEASED, attempts: 1,
        leasedUntil: new Date(Date.now() + 60000).toISOString(), meta: { legacyMaxLeaseId: randomUUID() } });
      const racing = await Promise.allSettled([store.transition(lease(), 'lease', accepted), store.transition(lease(), 'lease', accepted)]);
      assert.equal(racing.filter(result => result.status === 'fulfilled').length, 1, 'physical CAS permits one dispatch');
      const winner = racing.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Command>;
      assert.equal((await coll.findOne({ id: command.id }))!.attempts, 1);
      // Mongo applies the update, then returns a write concern error: only exact readback admits ACK.
      await db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
        data: { failCommands: ['update'], writeConcernError: { code: 64, errmsg: 'synthetic lost durable ACK' } } });
      try {
        const sent = await store.transition({ ...winner.value, status: Status.SENT, leasedUntil: undefined }, 'ack', winner.value);
        assert.equal(sent.status, Status.SENT);
      } finally { await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' }); }
      await store.metadata({ ...accepted, clientId: 'synthetic-moved-client', dialogId: 'synthetic-moved-dialog' });
      assert.equal((await coll.findOne({ id: command.id }))!.status, Status.SENT, 'stale metadata cannot resurrect SENT');
      const expired: Command = { ...command, id: randomUUID(), status: Status.LEASED, attempts: 1, leasedUntil: new Date(0).toISOString() };
      await coll.insertOne(structuredClone(expired));
      const service = new SupportService(persistence, {} as any, {} as any) as any;
      service.outbox.set(expired.id, structuredClone(expired));
      assert.deepEqual(await service.pullOutbox(connector), [], 'expired outcome is held without provider replay');
      const held = await coll.findOne({ id: expired.id });
      assert.equal(held!.status, Status.FAILED); assert.equal(legacyMaxHeld(held as unknown as Command), true);
      const unknownAcceptance: Command = { ...command, id: randomUUID() };
      await db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
        data: { failCommands: ['find'], errorCode: 50 } });
      try {
        await assert.rejects(service.acceptOutbox(unknownAcceptance), (error: any) => error.getStatus() === 503);
      } finally { await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' }); }
      assert.equal(service.outbox.has(unknownAcceptance.id), false);
      assert.equal((await coll.findOne({ id: unknownAcceptance.id }))!.status, Status.PENDING,
        'original durable PENDING survives its failed readback; no absent-original inference');
      const freshRetry: Command = { ...command, id: randomUUID() };
      await service.acceptOutbox(freshRetry);
      const freshClaims = await service.pullOutbox(connector);
      assert.equal(freshClaims.filter((value: Command) => value.id === freshRetry.id).length, 1);
      assert.equal(freshClaims.some((value: Command) => value.id === unknownAcceptance.id), false);
      const source = { pid: 123, bootId: randomUUID(), startTicks: '123456', sourceCommit: 'a'.repeat(40),
        sourceTree: 'b'.repeat(40), runtimeInventorySha256: 'c'.repeat(64) };
      const targetFingerprint = createHash('sha256').update(JSON.stringify({ hosts: client.options.hosts!.map(value => value.toString()),
        db: dbName, collection: coll.collectionName })).digest('hex');
      const memorySent: Command = { ...command, id: randomUUID(), status: Status.SENT };
      const snapshot = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', source, targetFingerprint,
        capturedAt: new Date().toISOString(), commands: [memorySent, unknownAcceptance] }));
      const manifest = { schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1' as const, source, targetFingerprint,
        snapshotSha256: createHash('sha256').update(snapshot).digest('hex') };
      await persistence.importLegacyMaxCustody(snapshot, manifest);
      const imported = await coll.findOne({ id: memorySent.id });
      assert.equal(imported!.status, Status.FAILED, 'snapshot-only SENT is evidence, never a manufactured ACK');
      assert.equal(imported!.meta.legacyMaxRestartCustody.sourceStatus, Status.SENT);
      assert.equal(legacyMaxHeld((await coll.findOne({ id: unknownAcceptance.id })) as unknown as Command), true);
      await persistence.importLegacyMaxCustody(snapshot, manifest);
      await persistence.onModuleDestroy();
      persistence = new SupportPersistenceService(); await persistence.onModuleInit();
      const restarted = new SupportService(persistence, {} as any, {} as any) as any;
      await restarted.onModuleInit();
      assert.equal(restarted.outbox.size, 0, 'sync0 bootstrap does not hydrate historical or held custody');
      assert.deepEqual(await restarted.pullOutbox(connector), []);
      assert.equal((await coll.findOne({ id: command.id }))!.status, Status.SENT);
      assert.deepEqual(await coll.findOne({ id: memorySent.id }), imported, 'restart preserves held evidence');
      assert.equal(legacyMaxHeld((await coll.findOne({ id: unknownAcceptance.id })) as unknown as Command), true,
        'fresh-UUID retry never licenses automatic replay of the retained original');
      restarted.onModuleDestroy();
      await persistence.onModuleDestroy(); persistence = undefined;
    }
    for (const marker of ['leaseToken', 'lastReceipt', 'terminalReason', 'queueSequence']) {
      await coll.deleteMany({});
      const id = randomUUID();
      await coll.insertOne({ id, connector: Route.MAX_BOT, status: Status.LEASED,
        [marker]: marker === 'lastReceipt' ? { token: randomUUID(), kind: 'ack' } : marker === 'leaseToken' ? randomUUID() : 'DELIVERY_UNKNOWN' });
      const before = await coll.findOne({ id });
      persistence = new SupportPersistenceService();
      await assert.rejects(persistence.onModuleInit(), /MAX_OUTBOX_RECEIPT_STATE_REQUIRES_V1/);
      assert.deepEqual(await coll.findOne({ id }), before);
      await persistence.onModuleDestroy();
    }
    await coll.deleteMany({});
    try {
      await db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
        data: { failCommands: ['find'], errorCode: 50 } });
      persistence = new SupportPersistenceService();
      await assert.rejects(persistence.onModuleInit(), /MAX_OUTBOX_LEGACY_AUTHORITY_NOT_READY/);
      await persistence.onModuleDestroy();
    } finally {
      await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
    const id = randomUUID();
    await coll.insertOne({ id, connector: Route.MAX_BOT, status: Status.LEASED, leaseToken: randomUUID() });
    const fenced = await coll.findOne({ id });
    persistence = new SupportPersistenceService();
    await assert.rejects(persistence.onModuleInit(), /MAX_OUTBOX_RECEIPT_STATE_REQUIRES_V1/);
    assert.deepEqual(await coll.findOne({ id }), fenced);
    await persistence.onModuleDestroy();
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
    persistence = new SupportPersistenceService();
    await persistence.onModuleInit();
    assert.deepEqual(await coll.findOne({ id }), fenced);
    console.log('Physical MAX compatibility: both legacy restart paths, fail-closed downgrade, unchanged v1 lease PASS');
  } finally {
    await persistence?.onModuleDestroy();
    await client.db(dbName).dropDatabase();
    await client.close();
    for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
    Object.assign(process.env, beforeEnv);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
