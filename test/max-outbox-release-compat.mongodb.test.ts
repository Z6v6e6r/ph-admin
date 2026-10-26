import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  assert.ok(uri, 'Pass the owned disposable loopback Mongo URI');
  const target = new URL(uri);
  assert.equal(target.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Loopback Mongo only');
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
      assert.equal(service.pullOutbox(connector).length, 1);
      await waitStatus(id, Status.LEASED);
      await service.ackOutbox(id);
      await waitStatus(id, Status.SENT);
      await persistence.onModuleDestroy();
      persistence = new SupportPersistenceService();
      await persistence.onModuleInit();
      const restarted = new SupportService(persistence, {} as any, {} as any) as any;
      for (const command of (await persistence.loadState()).outbox) restarted.outbox.set(command.id, command);
      assert.deepEqual(restarted.pullOutbox(connector), []);
      await persistence.onModuleDestroy();
      persistence = undefined;
    }
    for (const marker of ['leaseToken', 'lastReceipt', 'terminalReason']) {
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
