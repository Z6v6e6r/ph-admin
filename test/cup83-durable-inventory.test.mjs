import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BSON, Collection, Long, MongoClient, ReadPreference } from 'mongodb';
import { collectCup83DurableInventory } from '../scripts/lib/cup83-durable-inventory.mjs';
import { compareCup83WebCustody } from '../scripts/lib/cup83-web-custody.mjs';

const sourceEpoch = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const encode = v => Buffer.from(JSON.stringify(v) + '\n');
const hash = b => createHash('sha256').update(b).digest('hex');
const collections = { clients: 'clients', dialogs: 'dialogs', messages: 'messages',
  serviceMessages: 'serviceMessages', responseMetrics: 'responseMetrics', outbox: 'outbox' };
const topology = { type: 'ReplicaSetWithPrimary', setName: 'synthetic-set', servers: ['synthetic.invalid:27017'] };
const identity = { sourceEpoch, pid: process.pid, start: String(performance.timeOrigin), nodeVersion: process.version };
function rows() {
  return { clients: [{ id: 'p', phones: ['synthetic-private'] }],
    dialogs: [{ id: 'd', clientId: 'p', accessStationIds: ['a', 'b'] }],
    messages: [{ id: 'm', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER',
      kind: 'TEXT', senderRole: 'STAFF', direction: 'OUTBOUND', meta: { absent: null } }],
    serviceMessages: [{ id: 's', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER',
      kind: 'SYSTEM', meta: { absent: null } }],
    outbox: [{ id: 'c', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER', status: 'PENDING' },
      { id: 'leased-max', connector: 'MAX_BOT', status: 'LEASED', payload: { messageId: 'known-max-message' } }] };
}
function fixture(keys = ['primary']) {
  const f = { calls: [], cursors: [], mutations: 0, aborts: 0, writes: new Map(), quarantined: new Map(),
    hook: () => {}, data: new Map(), completed: undefined };
  class Persistence {}
  class Support {}
  const persistence = new Persistence(); persistence.backendStates = new Map(); persistence.backendConfigs = [];
  const support = new Support(); support.persistence = persistence;
  const backends = keys.map((key, index) => {
    // Driver constructors/options only. A tripwire forbids connect and commands.
    const client = new MongoClient('mongodb://synthetic.invalid:27017');
    const forbidden = () => { f.mutations++; throw Error('forbidden synthetic operation'); };
    client.connect = forbidden; client.bulkWrite = forbidden;
    client.topology = { isConnected: () => true, description: { type: topology.type,
      setName: topology.setName, servers: new Map(topology.servers.map(s => [s, {}])) } };
    const dbName = 'synthetic' + index, db = client.db(dbName);
    db.command = forbidden; db.createCollection = forbidden; db.dropDatabase = forbidden;
    const config = { key, dbName, collections: { ...collections } };
    // Accessing credentials is itself a test failure.
    Object.defineProperty(config, 'uri', { get() { throw Error('URI_ACCESS_FORBIDDEN'); } });
    const state = { config, client, db };
    persistence.backendConfigs.push(config); persistence.backendStates.set(key, state);
    f.data.set(key, rows());
    const originalCollection = db.collection.bind(db);
    db.collection = collectionName => {
      const collection = originalCollection(collectionName);
      for (const method of ['insertOne', 'updateOne', 'deleteOne', 'bulkWrite', 'createIndex', 'drop']) collection[method] = forbidden;
      collection.find = (filter, options) => {
        const record = { key, collectionName, filter, options }; f.calls.push(record);
        const kind = Object.keys(config.collections).find(k => config.collections[k] === collectionName);
        const cursor = Collection.prototype.find.call(collection, filter, options);
        f.cursors.push(cursor);
        let i = 0, closed = 0;
        cursor.next = async () => {
          cursor.initialized = true;
          if (f.next) return f.next({ cursor, kind, key, index: i++ });
          const data = f.data.get(key)[kind] ?? [];
          if (i < data.length) return structuredClone(data[i++]);
          cursor.cursorId = Long.ZERO; cursor.isClosed = true;
          return null;
        };
        cursor.close = async () => {
          closed++; cursor.isClosed = true; client.s.activeCursors.delete(cursor);
          if (f.close) await f.close({ cursor, closed });
        };
        cursor.closeCount = () => closed;
        f.hook({ cursor, collection, record });
        return cursor;
      };
      return collection;
    };
    return { key, client, db, dbName, collections: { ...collections }, topology: structuredClone(topology) };
  });
  f.expected = { identity: { ...identity }, supportPrototype: Support.prototype,
    persistencePrototype: Persistence.prototype, backends };
  f.support = support; f.persistence = persistence;
  f.sink = { private: true,
    async write(file, bytes, { signal }) { signal.throwIfAborted(); f.writes.set(file, Buffer.from(bytes)); },
    async complete(receipt, { signal }) { signal.throwIfAborted(); f.completed = receipt; },
    async abort() { f.aborts++; for (const [file, bytes] of f.writes) f.quarantined.set(file, bytes);
      f.writes.clear(); f.completed = undefined; } };
  f.run = limits => collectCup83DurableInventory({ support, expected: f.expected, sink: f.sink, limits });
  f.inventories = () => [...f.writes].filter(([n]) => n !== 'cup83-durable-provenance.json').map(([, b]) => JSON.parse(b));
  return f;
}

test('complete direct enumeration includes uncapped SYSTEM rows and preserves private history and MAX lease IDs', async () => {
  const f = fixture();
  for (let i = 0; i < 350; i++) f.data.get('primary').serviceMessages.push({ ...rows().serviceMessages[0], id: 'extra-' + i });
  const receipt = await f.run(), [inventory] = f.inventories();
  assert.equal(inventory.counts.serviceMessages, 351); assert.equal(inventory.counts.commands, 2);
  assert.equal(inventory.rows.commands.find(([id]) => id === 'leased-max')[1].status, 'LEASED');
  assert.equal(inventory.rows.commands.find(([id]) => id === 'leased-max')[1].payload.messageId, 'known-max-message');
  assert.equal(f.calls.length, 5); assert.equal(f.mutations, 0); assert.equal(f.aborts, 0);
  assert.ok(f.cursors.every(c => c.closed && c.closeCount() === 1));
  for (const { filter, options } of f.calls) {
    assert.deepEqual(filter, {}); assert.deepEqual(options.projection, { _id: 0 });
    assert.equal(options.readPreference, 'primary'); assert.deepEqual(options.readConcern, { level: 'majority' });
    assert.equal(options.allowPartialResults, false); assert.equal(options.limit, undefined);
    assert.ok(options.timeoutMS > 0 && options.timeoutMS <= 5000); assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(JSON.stringify(receipt).includes('synthetic-private'), false);
  assert.equal(JSON.stringify(receipt).includes('synthetic.invalid'), false);
  assert.equal(JSON.stringify(receipt).includes('leased-max'), false);
  assert.equal(receipt.restartAuthorized, false); assert.equal(receipt.producerDrainProven, false);
  assert.equal(receipt.pointInTimeProven, false);
  const provenance = JSON.parse(f.writes.get('cup83-durable-provenance.json'));
  assert.equal(provenance.namespaces[0].collections.length, 5);
  assert.ok(provenance.namespaces[0].collections.every(c => c.eof));
  assert.equal(hash(f.writes.get('cup83-durable-provenance.json')), receipt.provenanceSha256);
});

test('all configured backends are covered; aliases of one physical namespace are read once', async () => {
  const f = fixture(['primary', 'web', 'max']);
  const primary = f.expected.backends[0], web = f.expected.backends[1];
  const webState = f.persistence.backendStates.get('web');
  webState.client = primary.client; webState.db = primary.db; webState.config.dbName = primary.dbName;
  Object.assign(web, { client: primary.client, db: primary.db, dbName: primary.dbName });
  const receipt = await f.run();
  assert.equal(receipt.namespaces.length, 2); assert.equal(f.calls.length, 10);
  assert.equal(receipt.backendAliases.length, 3);
  assert.equal(receipt.backendAliases[0].fingerprint, receipt.backendAliases[1].fingerprint);
  const p = JSON.parse(f.writes.get('cup83-durable-provenance.json'));
  assert.deepEqual(p.namespaces[0].backendKeys, ['primary', 'web']);
});

test('partially shared physical collections retain semantic provenance and are also read once', async () => {
  const f = fixture(['primary', 'web']), [primary, web] = f.expected.backends;
  const state = f.persistence.backendStates.get('web');
  state.config.dbName = primary.dbName; web.dbName = primary.dbName;
  state.db.s.namespace.db = primary.dbName;
  state.config.collections.outbox = 'different-outbox'; web.collections.outbox = 'different-outbox';
  const result = await f.run();
  assert.equal(result.namespaces.length, 2); assert.equal(f.calls.length, 6);
  const p = JSON.parse(f.writes.get('cup83-durable-provenance.json'));
  assert.equal(p.namespaces[1].collections.filter(c => c.readFromFingerprint).length, 4);
});

test('physical collection aliases across domains are refused before reads', async () => {
  const f = fixture();
  f.expected.backends[0].collections.serviceMessages = 'messages';
  f.persistence.backendConfigs[0].collections.serviceMessages = 'messages';
  await assert.rejects(f.run(), /COLLECTION_DOMAIN_ALIAS/); assert.equal(f.calls.length, 0);
});

test('Single is supported only with one exact independently pinned address', async () => {
  const f = fixture();
  f.expected.backends[0].topology = { ...structuredClone(topology), type: 'Single', setName: null };
  Object.assign(f.expected.backends[0].client.topology.description, { type: 'Single', setName: null });
  assert.equal((await f.run()).namespaces.length, 1);
});

for (const type of ['Sharded', 'LoadBalanced']) test(type + ' topology is outside the exact collector contract', async () => {
  const f = fixture(); f.expected.backends[0].client.topology.description.type = type;
  await assert.rejects(f.run(), /TOPOLOGY_UNSUPPORTED/); assert.equal(f.calls.length, 0);
});

test('same replica-set name with distinct observed addresses is ambiguous, never deduplicated or complete', async () => {
  const f = fixture(['primary', 'web']), web = f.expected.backends[1];
  web.topology.servers = ['other-synthetic.invalid:27017'];
  web.client.topology.description.servers = new Map(web.topology.servers.map(s => [s, {}]));
  await assert.rejects(f.run(), /TOPOLOGY_AMBIGUOUS/);
  assert.equal(f.calls.length, 0); assert.equal(f.completed, undefined);
});

test('distinct Single addresses and conflicting replica identities at overlapping addresses are ambiguous', async () => {
  const f = fixture(['primary', 'web']);
  for (const b of f.expected.backends) {
    b.topology.type = 'Single'; b.topology.setName = null;
    Object.assign(b.client.topology.description, { type: 'Single', setName: null });
  }
  f.expected.backends[1].topology.servers = ['alias-synthetic.invalid:27017'];
  f.expected.backends[1].client.topology.description.servers = new Map([['alias-synthetic.invalid:27017', {}]]);
  await assert.rejects(f.run(), /TOPOLOGY_AMBIGUOUS/); assert.equal(f.calls.length, 0);
  const g = fixture(['primary', 'web']); g.expected.backends[1].topology.setName = 'other-set';
  g.expected.backends[1].client.topology.description.setName = 'other-set';
  await assert.rejects(g.run(), /TOPOLOGY_AMBIGUOUS/); assert.equal(g.calls.length, 0);
});

test('collected private bytes integrate with existing comparator including BSON undefined sidecars', async () => {
  const f = fixture(), data = f.data.get('primary');
  const captureRows = { commands: [[data.outbox[0].id, structuredClone(data.outbox[0])]],
    messages: [['m', structuredClone(data.messages[0])]], serviceMessages: [['s', structuredClone(data.serviceMessages[0])]],
    dialogs: [['d', structuredClone(data.dialogs[0])]], clients: [['p', structuredClone(data.clients[0])]] };
  delete captureRows.messages[0][1].meta.absent; delete captureRows.serviceMessages[0][1].meta.absent;
  // Driver serialization, rather than a collector repair, produces durable null.
  const original = structuredClone(captureRows.messages[0][1]); original.meta.absent = undefined;
  data.messages[0] = BSON.deserialize(BSON.serialize(original, f.expected.backends[0].db.bsonOptions));
  const capture = encode({ schema: 'PHAB_CUP83_WEB_CUSTODY_V1', identity, rows: captureRows,
    counts: Object.fromEntries(Object.entries(captureRows).map(([k, v]) => [k, v.length])),
    undefinedPaths: [{ commandId: 'messages:m', path: ['meta', 'absent'] },
      { commandId: 'serviceMessages:s', path: ['meta', 'absent'] }], durableCompletenessProven: false });
  const receipt = await f.run();
  const inventories = receipt.namespaces.map(n => f.writes.get('cup83-durable-' + n.fingerprint + '.json'));
  const result = compareCup83WebCustody({ capture, inventories }, { captureSha256: hash(capture), identity,
    namespaces: receipt.namespaces, ignoreUndefined: false });
  assert.equal(result.status, 'PINNED_WEB_CAPTURE_ROWS_MATCH'); assert.equal(result.restartAuthorized, false);
});

for (const [label, mutate, code] of [
  ['runtime', f => f.expected.identity.pid++, 'PROCESS_IDENTITY'],
  ['source', f => f.expected.identity.sourceEpoch = 'wrong', 'PROCESS_IDENTITY'],
  ['prototype', f => f.expected.supportPrototype = {}, 'INSTANCE_IDENTITY'],
  ['namespace omission', f => f.expected.backends.pop(), 'BACKEND_SET'],
  ['backend duplication', f => f.expected.backends.push(f.expected.backends[0]), 'BACKEND_SET'],
  ['configured omission', f => f.persistence.backendConfigs.pop(), 'BACKEND_SET'],
  ['database', f => f.expected.backends[0].dbName = 'wrong', 'DATABASE_IDENTITY'],
  ['collection', f => f.expected.backends[0].collections.outbox = 'wrong', 'COLLECTION_IDENTITY'],
  ['driver', f => { f.persistence.backendStates.get('primary').client = {}; f.expected.backends[0].client = {}; }, 'DRIVER_OR_HANDLE'],
  ['disconnect', f => f.expected.backends[0].client.topology.isConnected = () => false, 'DISCONNECTED_BACKEND'],
  ['topology', f => f.expected.backends[0].topology.servers = ['wrong.invalid:27017'], 'TOPOLOGY_IDENTITY'],
  ['unknown topology', f => f.expected.backends[0].client.topology.description.type = 'Unknown', 'TOPOLOGY_UNSUPPORTED'],
  ['disabled backend', f => delete f.persistence.backendStates.get('primary').db, 'OWN_DATA_REQUIRED'],
  ['serialization', f => f.expected.backends[0].db.s.bsonOptions.ignoreUndefined = true, 'COLLECTION_DRIVER_OR_SERIALIZATION'],
  ['sink', f => f.sink.private = false, 'PRIVATE_SINK'],
]) test('default deny: wrong ' + label, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.run(), new RegExp(code));
  assert.equal(f.mutations, 0); assert.equal(f.completed, undefined); assert.equal(f.writes.size, 0);
});

for (const [label, change] of [
  ['read preference', c => c.cursorOptions.readPreference = ReadPreference.secondary],
  ['read concern', c => c.cursorOptions.readConcern = { level: 'local' }],
  ['limit', c => c.findOptions.limit = 1], ['skip', c => c.findOptions.skip = 1],
  ['partial', c => c.findOptions.allowPartialResults = true],
  ['projection', c => c.findOptions.projection = { id: 1 }],
  ['filter', c => c.cursorFilter = { id: 'filtered' }],
  ['tailable', c => c.cursorOptions.tailable = true],
  ['timeout', c => c.cursorOptions.timeoutMS = 0],
  ['transformation', c => c.transform = row => row], ['already initialized', c => c.initialized = true],
]) test('refuses cursor ' + label, async () => {
  const f = fixture(); f.hook = ({ cursor }) => change(cursor);
  await assert.rejects(f.run(), /CURSOR_CONTRACT/); assert.ok(f.cursors[0].closeCount() >= 1);
  assert.equal(f.completed, undefined); assert.equal(f.aborts, 1);
});

for (const [label, mutate] of [
  ['live cursor ID', c => { c.cursorId = Long.ONE; c.isClosed = true; }],
  ['uninitialized ID', c => { c.cursorId = undefined; c.isClosed = true; }],
  ['killed cursor', c => { c.cursorId = Long.ZERO; c.isClosed = true; c.isKilled = true; }],
  ['buffered rows', c => { c.cursorId = Long.ZERO; c.isClosed = true; c.documents = { length: 1 }; }],
]) test('null without natural EOF rejects ' + label, async () => {
  const f = fixture(); f.next = ({ cursor }) => { mutate(cursor); return null; };
  await assert.rejects(f.run(), /CURSOR_INCOMPLETE/); assert.equal(f.completed, undefined);
});

test('count and byte limits abort before any complete inventory is written', async () => {
  const f = fixture(); f.data.get('primary').clients.push({ id: 'second' });
  await assert.rejects(f.run({ maxRowsPerCollection: 1 }), /COUNT_LIMIT/);
  const g = fixture(); await assert.rejects(g.run({ maxBytes: 64 }), /BYTE_LIMIT/);
  const h = fixture(); await assert.rejects(h.run({ maxRowsPerCollection: 20001 }), /LIMITS/);
  for (const x of [f, g, h]) { assert.equal(x.completed, undefined); assert.equal(x.writes.size, 0); }
});

test('operation timeout and total deadline bound read work and close cursors', async () => {
  const f = fixture(); f.next = () => new Promise(() => {});
  await assert.rejects(f.run({ operationMS: 10, totalMS: 100 }), /OPERATION_TIMEOUT/);
  assert.ok(f.cursors[0].closeCount() >= 1); assert.equal(f.aborts, 1);
  const g = fixture(); g.next = async ({ cursor }) => {
    await new Promise(resolve => setTimeout(resolve, 10)); cursor.cursorId = Long.ZERO; cursor.isClosed = true; return null;
  };
  await assert.rejects(g.run({ totalMS: 15, operationMS: 15 }), /OPERATION_TIMEOUT|TOTAL_TIMEOUT/);
});

test('read exceptions are redacted and cleanup failure is explicit', async () => {
  const f = fixture(); f.next = () => { throw Error('synthetic-private query payload'); };
  await assert.rejects(f.run(), /^Error: READ_FAILED$/); assert.equal(f.aborts, 1);
  const g = fixture(); g.next = f.next; g.close = () => { throw Error('synthetic-private'); };
  await assert.rejects(g.run(), /^Error: CLEANUP_FAILED$/);
  const h = fixture(); h.next = f.next; h.sink.abort = async () => new Promise(() => {});
  await assert.rejects(h.run({ cleanupMS: 10 }), /^Error: CLEANUP_FAILED$/);
});

test('duplicate IDs, cross-backend conflicts, raw _id and wrong SYSTEM domains default deny', async () => {
  const f = fixture(); f.data.get('primary').clients.push(f.data.get('primary').clients[0]);
  await assert.rejects(f.run(), /ROW_IDENTITY/);
  const g = fixture(['primary', 'web']); g.data.get('web').clients[0].phones = ['conflict'];
  await assert.rejects(g.run(), /DURABLE_ROW_CONFLICT/);
  const h = fixture(); h.data.get('primary').clients[0]._id = 'not projected';
  await assert.rejects(h.run(), /ROW_IDENTITY/);
  const j = fixture(); j.data.get('primary').messages[0].kind = 'SYSTEM';
  await assert.rejects(j.run(), /MESSAGE_DOMAIN/);
  const k = fixture(); k.data.get('primary').serviceMessages[0].kind = 'TEXT';
  await assert.rejects(k.run(), /MESSAGE_DOMAIN/);
  const l = fixture(); l.data.get('primary').serviceMessages[0].id = l.data.get('primary').messages[0].id;
  await assert.rejects(l.run(), /MESSAGE_DOMAIN_CONFLICT/);
});

test('unsupported durable JSON values are refused without normalizing undefined', async () => {
  for (const value of [undefined, new Date(), Infinity, Buffer.from('private')]) {
    const f = fixture(); f.data.get('primary').clients[0].unsupported = value;
    await assert.rejects(f.run(), /ROW_DATA|ROW_NUMBER/);
  }
  const f = fixture(); let value = f.data.get('primary').clients[0];
  for (let i = 0; i < 40; i++) value = value.deep = {};
  await assert.rejects(f.run(), /ROW_DEPTH/);
});

test('private partial writes and failed completion are quarantined, never marked complete or deleted', async () => {
  for (const failComplete of [false, true]) {
    const f = fixture(), originalWrite = f.sink.write;
    f.sink.write = async (...args) => {
      await originalWrite(...args);
      if (!failComplete) throw Error('synthetic-private sink error');
    };
    if (failComplete) f.sink.complete = async receipt => { f.completed = receipt; throw Error('synthetic-private'); };
    await assert.rejects(f.run(), /^Error: SINK_FAILED$/);
    assert.equal(f.completed, undefined); assert.equal(f.writes.size, 0);
    assert.ok(f.quarantined.size > 0); assert.equal(f.aborts, 1);
  }
});

test('timed-out sink writes receive abort signal and preserve private partial evidence', async () => {
  const f = fixture(), write = f.sink.write;
  f.sink.write = async (...args) => { await write(...args); return new Promise(() => {}); };
  await assert.rejects(f.run({ operationMS: 10 }), /OPERATION_TIMEOUT/);
  assert.equal(f.aborts, 1); assert.equal(f.quarantined.size, 1); assert.equal(f.completed, undefined);
});

test('backend drift during read or sink write invalidates complete custody', async () => {
  const f = fixture(); f.hook = () => { f.expected.backends[0].client.topology.description.setName = 'drift'; };
  await assert.rejects(f.run(), /BACKEND_DRIFT/);
  const g = fixture(), write = g.sink.write;
  g.sink.write = async (...args) => { await write(...args); g.persistence.backendStates.delete('primary'); };
  await assert.rejects(g.run(), /BACKEND_DRIFT/); assert.equal(g.completed, undefined); assert.ok(g.quarantined.size > 0);
});
