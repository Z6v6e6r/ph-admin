import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const root = process.env.CUP_RECOVERY_ROOT;
assert.ok(root && root.startsWith('/'), 'Explicit derived83 compiled recovery root required');
const uri = process.argv[2], target = new URL(uri);
assert.equal(target.protocol, 'mongodb:');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Owned loopback Mongo only');
assert.equal(target.username + target.password + target.search + target.hash, '');
assert.ok(target.pathname === '' || target.pathname === '/');
const require = createRequire(resolve(root, 'package.json'));
require('reflect-metadata');
const { MongoClient } = require('mongodb');
const { LegacyMaxCustodyStore, legacyMaxHeld } = require(resolve(root, 'dist/support/legacy-max-custody.js'));
const { SupportPersistenceService } = require(resolve(root, 'dist/support/support-persistence.service.js'));
const { SupportService } = require(resolve(root, 'dist/support/support.service.js'));
const { MaxOutboxStore } = require(resolve(root, 'dist/support/max-outbox-store.js'));
const { SupportConnectorRoute: Route, SupportOutboxStatus: Status } = require(resolve(root, 'dist/support/support.types.js'));
const dbName = 'cup_recovery_custody_' + randomUUID().replaceAll('-', '');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: uri, SUPPORT_MONGODB_URI: uri,
  MONGODB_DB: dbName, SUPPORT_MONGODB_DB: dbName, SUPPORT_OUTBOX_COLLECTION: 'support_outbox',
  SUPPORT_WEB_MONGODB_URI: uri, SUPPORT_WEB_MONGODB_DB: dbName + '_web',
  SUPPORT_MAX_OUTBOX_MODE: 'legacy', SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
  QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false' });
for (const key of ['SUPPORT_MAX_MONGODB_URI', 'SUPPORT_MAX_MONGODB_DB', 'SUPPORT_MAX_OUTBOX_COLLECTION']) delete process.env[key];
globalThis.fetch = () => { throw Error('PROVIDER_CALL_PROHIBITED'); };
await client.connect();
let persistence, service;
const strip = row => { const result = { ...row }; delete result._id; return result; };
const seed = connector => ({ id: randomUUID(), connector, dialogId: 'synthetic-dialog',
  clientId: 'synthetic-client', text: 'synthetic', targetExternalChatId: 'synthetic-target',
  createdAt: new Date().toISOString(), status: Status.PENDING, attempts: 0 });
try {
  const coll = client.db(dbName).collection('support_outbox');
  for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
    persistence = new SupportPersistenceService(); await persistence.onModuleInit();
    const store = new LegacyMaxCustodyStore(coll);
    const accepted = await store.transition(seed(connector), 'enqueue');
    const claim = () => ({ ...accepted, status: Status.LEASED, attempts: 1,
      leasedUntil: new Date(Date.now() + 60000).toISOString(), meta: { legacyMaxLeaseId: randomUUID() } });
    const race = await Promise.allSettled([store.transition(claim(), 'lease', accepted), store.transition(claim(), 'lease', accepted)]);
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    const leased = race.find(row => row.status === 'fulfilled').value;
    // Real Mongo commits, then the adapter loses its ACK. Only majority readback admits SENT.
    const lostAck = new LegacyMaxCustodyStore({
      findOne: (...args) => coll.findOne(...args),
      updateOne: async (...args) => { await coll.updateOne(...args); throw Error('SYNTHETIC_LOST_ACK'); }
    });
    const sent = await lostAck.transition({ ...leased, status: Status.SENT, leasedUntil: undefined }, 'ack', leased);
    assert.equal(sent.status, Status.SENT);
    await store.metadata({ ...accepted, clientId: 'synthetic-moved', dialogId: 'synthetic-moved' });
    assert.equal((await coll.findOne({ id: accepted.id })).status, Status.SENT);
    const unknownRow = seed(connector);
    const lostReadback = new LegacyMaxCustodyStore({
      updateOne: (...args) => coll.updateOne(...args),
      findOne: async () => { throw Error('SYNTHETIC_READBACK_UNAVAILABLE'); }
    });
    await assert.rejects(lostReadback.transition(unknownRow, 'enqueue'));
    assert.equal((await coll.findOne({ id: unknownRow.id })).status, Status.PENDING);
    const memorySent = { ...seed(connector), status: Status.SENT };
    const durableSent = strip(await coll.findOne({ id: accepted.id }));
    const source = { pid: 123, bootId: randomUUID(), startTicks: '123456',
      sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runtimeInventorySha256: 'c'.repeat(64) };
    const targetFingerprint = createHash('sha256').update(JSON.stringify({
      hosts: client.options.hosts.map(host => host.toString()), db: dbName, collection: coll.collectionName
    })).digest('hex');
    const bytes = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1',
      capturedAt: new Date().toISOString(), source, targetFingerprint, commands: [memorySent, unknownRow, durableSent] }));
    const manifest = { schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1', source, targetFingerprint,
      snapshotSha256: createHash('sha256').update(bytes).digest('hex') };
    await persistence.importLegacyMaxCustody(bytes, manifest);
    const heldBefore = await coll.findOne({ id: memorySent.id });
    assert.equal(heldBefore.status, Status.FAILED);
    assert.equal(heldBefore.meta.legacyMaxRestartCustody.sourceStatus, Status.SENT);
    assert.equal(legacyMaxHeld(heldBefore), true);
    assert.equal((await coll.findOne({ id: accepted.id })).status, Status.SENT);
    assert.equal(legacyMaxHeld(await coll.findOne({ id: unknownRow.id })), true);
    await persistence.importLegacyMaxCustody(bytes, manifest);
    assert.deepEqual(await coll.findOne({ id: memorySent.id }), heldBefore);
    await assert.rejects(store.importHeld({ ...memorySent, text: 'conflicting synthetic payload' }, manifest.snapshotSha256));
    await persistence.onModuleDestroy(); persistence = new SupportPersistenceService();
    await persistence.onModuleInit(); service = new SupportService(persistence, {}, {});
    await service.onModuleInit();
    assert.equal(service.outbox.size, 0, 'sync0 recovery never hydrates historical commands');
    service.outbox.set(memorySent.id, strip(heldBefore)); // explicit synthetic held input, never full hydration
    assert.deepEqual(await service.pullOutbox(connector), []);
    await assert.rejects(service.ackOutbox(memorySent.id));
    await assert.rejects(service.failOutbox(memorySent.id, 'synthetic', true));
    await store.metadata({ ...memorySent, clientId: 'synthetic-other', dialogId: 'synthetic-other' });
    const heldAfter = await coll.findOne({ id: memorySent.id });
    assert.equal(heldAfter.status, Status.FAILED);
    assert.deepEqual(heldAfter.meta, heldBefore.meta);
    const fresh = seed(connector); await service.acceptOutbox(fresh);
    assert.equal((await service.pullOutbox(connector)).filter(row => row.id === fresh.id).length, 1);
    await service.ackOutbox(fresh.id);
    assert.equal((await coll.findOne({ id: fresh.id })).status, Status.SENT);
    for (const field of ['leaseToken', 'lastReceipt', 'terminalReason']) {
      await assert.rejects(store.transition({ ...seed(connector), [field]: 'synthetic' }, 'enqueue'));
    }
    service.onModuleDestroy(); service = undefined;
    await persistence.onModuleDestroy(); persistence = undefined;
  }
  // Exact83 non-MAX paths remain synchronous and use the legacy persistence overload.
  const nonMax = seed(Route.TG_BOT);
  const fake = { isEnabled: () => true, persistOutboxCommand: () => undefined };
  const unrelated = new SupportService(fake, {}, {});
  unrelated.outbox.set(nonMax.id, nonMax);
  const pulled = unrelated.pullOutbox(nonMax.connector);
  assert.ok(Array.isArray(pulled)); assert.equal(pulled.length, 1);
  // Receipt-v1 stays delegated to its existing store; the new legacy writer is never selected.
  process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
  const receiptRow = { ...seed(Route.MAX_BOT), status: Status.LEASED, attempts: 1 };
  const calls = [];
  const receiptService = new SupportService({
    isEnabled: () => true,
    hasMaxOutbox: async id => id === receiptRow.id,
    pullMaxOutbox: async (...args) => { calls.push(['pull', ...args]); return [receiptRow]; },
    acceptMaxReceipt: async (...args) => { calls.push(['receipt', ...args]); return receiptRow; },
    persistOutboxCommand: () => assert.fail('Receipt-v1 must not use the legacy custody writer')
  }, {}, {});
  assert.throws(() => receiptService.pullOutbox(Route.MAX_BOT));
  assert.deepEqual(await receiptService.pullOutbox(Route.MAX_BOT, 2, 45, 'max-lease-v1'), [receiptRow]);
  assert.equal(await receiptService.ackOutbox(receiptRow.id, { leaseToken: 'synthetic' }), receiptRow);
  assert.equal(await receiptService.failOutbox(receiptRow.id, undefined, false, { leaseToken: 'synthetic' }), receiptRow);
  assert.deepEqual(calls.map(row => row[0]), ['pull', 'receipt', 'receipt']);
  assert.deepEqual(calls[0], ['pull', Route.MAX_BOT, 2, 45]);
  assert.equal(calls[1][2], 'ack'); assert.equal(calls[2][2], 'fail');
  // The actual derived83 binary must refuse legacy startup on a prospective tag
  // alone, before the first v1 claim can add token/receipt fields.
  const tagged = { ...seed(Route.MAX_BOT), meta: { maxOutboxProtocol: 'max-lease-v1' } };
  await coll.insertOne(tagged);
  const taggedBefore = await coll.findOne({ id: tagged.id }, { raw: true });
  process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy';
  persistence = new SupportPersistenceService();
  await assert.rejects(persistence.onModuleInit(), /MAX_OUTBOX_RECEIPT_STATE_REQUIRES_V1/);
  await persistence.onModuleDestroy(); persistence = undefined;
  assert((await coll.findOne({ id: tagged.id }, { raw: true })).equals(taggedBefore));
  await coll.deleteOne({ id: tagged.id });
  process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
  const missingAuthority = Object.assign(Object.create(SupportPersistenceService.prototype), {
    backendConfigs: [{ key: 'synthetic-max' }], backendStates: new Map(), resolveBackendKeyForConnector: () => 'synthetic-max'
  });
  await assert.rejects(missingAuthority.onModuleInit(), /MAX_OUTBOX_AUTHORITY_NOT_READY/);
  // Exercise the changed store/policy dependency closure, including permanent
  // archive/hold presence, using real BSON and a fresh compiled store instance.
  await coll.deleteMany({});
  const archive = [];
  for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
    for (const marker of ['legacyMaxRestartCustody', 'legacyMaxArchive']) {
      for (const status of Object.values(Status)) archive.push({ ...seed(connector), status, attempts: 999,
        leasedUntil: new Date(0).toISOString(), leaseToken: randomUUID(),
        meta: { maxOutboxProtocol: 'max-lease-v1', [marker]: null } });
    }
  }
  await coll.insertMany(archive);
  const archivedBytes = new Map(await Promise.all(archive.map(async r => [r.id, await coll.findOne({ id: r.id }, { raw: true })])));
  for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
    const store = new MaxOutboxStore(coll), fresh = seed(connector);
    await store.enqueue(fresh);
    const [claim] = await new MaxOutboxStore(coll).pull(connector, 10, 120);
    assert.equal(claim.id, fresh.id);
    assert.equal((await store.receipt(claim.id, 'ack', { leaseToken: claim.leaseToken })).status, Status.SENT);
  }
  for (const row of archive) {
    await assert.rejects(new MaxOutboxStore(coll).receipt(row.id, 'ack', { leaseToken: row.leaseToken }));
    assert((await coll.findOne({ id: row.id }, { raw: true })).equals(archivedBytes.get(row.id)));
  }
  console.log('Derived83 compiled custody: both MAX connectors, concurrent CAS, lost ACK/readback, held import/replay/conflict, sync0 restart, no resend, new commands, non-MAX and receipt-v1 delegation PASS');
} finally {
  service?.onModuleDestroy();
  if (persistence) await persistence.onModuleDestroy();
  await client.db(dbName).dropDatabase(); await client.db(dbName + '_web').dropDatabase(); await client.close();
}
