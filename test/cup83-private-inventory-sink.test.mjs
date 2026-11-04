import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Collection, Long, MongoClient } from 'mongodb';
import { collectCup83DurableInventory } from '../scripts/lib/cup83-durable-inventory.mjs';
import { createCup83PrivateInventorySink } from '../scripts/lib/cup83-private-inventory-sink.mjs';

const OWNER = '.cup83-inventory-owner.json', COMPLETION = 'cup83-durable-completion.json';
const QUARANTINE = 'cup83-durable-quarantine.json', PROVENANCE = 'cup83-durable-provenance.json';
const fingerprint = 'a'.repeat(64), inventory = 'cup83-durable-' + fingerprint + '.json';
const hash = b => createHash('sha256').update(b).digest('hex');
const signal = () => new AbortController().signal;
const safeSignal = () => ({ signal: signal() });
function fixture(t, limits = {}) {
  // All mutations and cleanup below target this task-owned disposable directory.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'cup83-private-sink-test-')));
  const directory = path.join(root, 'inventory'); fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory), options = { directory, expectedUid: process.getuid(),
    expectedDirectory: { dev: stat.dev, ino: stat.ino }, limits };
  const f = { root, directory, options, sinks: [], file: name => path.join(directory, name) };
  f.create = overrides => { const sink = createCup83PrivateInventorySink({ ...options, ...overrides }); f.sinks.push(sink); return sink; };
  f.abort = async sink => { try { await sink.abort(safeSignal()); } catch { /* failure tests preserve evidence until task-owned cleanup */ } };
  t.after(async () => { for (const sink of f.sinks) await f.abort(sink); fs.rmSync(root, { recursive: true, force: true }); });
  return f;
}
function receipt(payload, provenance) {
  return { status: 'BOUNDED_DURABLE_INVENTORIES_COLLECTED',
    namespaces: [{ fingerprint, collectionsSha256: 'b'.repeat(64), sha256: hash(payload) }],
    provenanceSha256: hash(provenance), backendAliases: [{ key: 'primary', fingerprint }],
    counts: [{ fingerprint, counts: { commands: 1, messages: 1, serviceMessages: 1, dialogs: 1, clients: 1 } }],
    producerDrainProven: false, pointInTimeProven: false, restartAuthorized: false };
}
async function populated(f) {
  const sink = f.create(), payload = Buffer.from('{"synthetic":"private rows"}\n'), provenance = Buffer.from('{"private":"namespace provenance"}\n');
  await sink.write(inventory, payload, safeSignal()); await sink.write(PROVENANCE, provenance, safeSignal());
  return { sink, payload, provenance, receipt: receipt(payload, provenance) };
}

test('operator-created exact directory yields exclusive 0600 files, fsync and safe completion metadata', async t => {
  const f = fixture(t), realFsync = fs.fsyncSync;
  let fileSyncs = 0, directorySyncs = 0;
  fs.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) directorySyncs++; else fileSyncs++; return realFsync(fd); };
  let p, result;
  try { p = await populated(f); result = await p.sink.complete(p.receipt, safeSignal()); }
  finally { fs.fsyncSync = realFsync; }
  assert.equal(fileSyncs, 4); assert.equal(directorySyncs, 4); // owner + two inputs + completion
  assert.equal(result.status, 'PRIVATE_INVENTORY_FILES_COMPLETE'); assert.equal(result.artifactCount, 2);
  assert.equal(result.artifactBytes, p.payload.length + p.provenance.length);
  assert.equal(hash(fs.readFileSync(f.file(COMPLETION))), result.completionSha256);
  for (const name of [OWNER, inventory, PROVENANCE, COMPLETION]) {
    const stat = fs.lstatSync(f.file(name)); assert.ok(stat.isFile());
    assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid()); assert.equal(stat.nlink, 1);
  }
  assert.equal(fs.lstatSync(f.directory).mode & 0o7777, 0o700);
  assert.deepEqual(fs.readFileSync(f.file(inventory)), p.payload);
  assert.equal(JSON.stringify(result).includes('private rows'), false);
  assert.equal(JSON.stringify(result).includes(f.directory), false);
  assert.equal(result.restartAuthorized, false);
  const stored = JSON.parse(fs.readFileSync(f.file(COMPLETION)));
  assert.deepEqual(stored.collectorReceipt, p.receipt); assert.equal(stored.quarantineOverridesCompletion, true);
  p.sink.close();
});

test('actual collector consumes the private filesystem adapter on synthetic driver cursors without connecting', async t => {
  const f = fixture(t), sink = f.create();
  const client = new MongoClient('mongodb://synthetic.invalid:27017'); // Construct options only.
  client.connect = () => { throw Error('SYNTHETIC_CONNECT_FORBIDDEN'); };
  client.topology = { isConnected: () => true,
    description: { type: 'Single', setName: null, servers: new Map([['synthetic.invalid:27017', {}]]) } };
  const db = client.db('synthetic'), collectionNames = Object.fromEntries(
    ['clients', 'dialogs', 'messages', 'serviceMessages', 'responseMetrics', 'outbox'].map(k => [k, k]));
  const original = db.collection.bind(db);
  db.collection = name => {
    const collection = original(name);
    collection.find = (filter, options) => {
      const cursor = Collection.prototype.find.call(collection, filter, options);
      cursor.next = async () => { cursor.cursorId = Long.ZERO; cursor.isClosed = true; return null; };
      cursor.close = async () => { cursor.isClosed = true; client.s.activeCursors.delete(cursor); };
      return cursor;
    };
    return collection;
  };
  class Persistence {}
  class Support {}
  const persistence = new Persistence(), support = new Support(); support.persistence = persistence;
  const config = { key: 'primary', dbName: 'synthetic', collections: collectionNames };
  persistence.backendConfigs = [config]; persistence.backendStates = new Map([['primary', { config, client, db }]]);
  const result = await collectCup83DurableInventory({ support, sink, expected: {
    identity: { sourceEpoch: '83b1c17bc4c5edaec65387b25b5695e48337c3cf', pid: process.pid,
      start: String(performance.timeOrigin), nodeVersion: process.version },
    supportPrototype: Support.prototype, persistencePrototype: Persistence.prototype,
    backends: [{ key: 'primary', client, db, dbName: 'synthetic', collections: { ...collectionNames },
      topology: { type: 'Single', setName: null, servers: ['synthetic.invalid:27017'] } }] } });
  const stored = JSON.parse(fs.readFileSync(f.file(COMPLETION)));
  assert.deepEqual(stored.collectorReceipt, result); assert.equal(stored.artifactCount, 2);
  assert.equal(result.restartAuthorized, false); assert.equal(client.s.activeCursors.size, 0); sink.close();
});

test('unexpected UID, directory identity, noncanonical paths and unsupported limits refuse before files', t => {
  for (const override of [
    { expectedUid: process.getuid() + 1 }, { expectedDirectory: { dev: -1, ino: 0 } },
    { expectedDirectory: { dev: 0, ino: 0 } }, { limits: { maxFiles: 5 } },
    { limits: { maxBytes: 0 } }, { limits: { unsupported: true } },
  ]) {
    const f = fixture(t); assert.throws(() => f.create(override), /PRIVATE_SINK_/);
    assert.deepEqual(fs.readdirSync(f.directory), []);
  }
  const f = fixture(t);
  for (const directory of ['relative', f.directory + '/', f.directory + '/..', f.root])
    assert.throws(() => f.create({ directory }), /PRIVATE_SINK_/);
});

test('directory mode and writable ancestry refuse; no mode or owner is repaired', t => {
  const f = fixture(t); fs.chmodSync(f.directory, 0o750);
  assert.throws(() => f.create(), /PRIVATE_SINK_DIRECTORY/); assert.equal(fs.statSync(f.directory).mode & 0o777, 0o750);
  fs.chmodSync(f.directory, 0o700); fs.chmodSync(f.root, 0o770);
  assert.throws(() => f.create(), /PRIVATE_SINK_ANCESTRY/); fs.chmodSync(f.root, 0o700);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('symlink directory or ancestor refuses without touching the destination', t => {
  const f = fixture(t), link = path.join(f.root, 'linked'); fs.symlinkSync(f.directory, link);
  assert.throws(() => f.create({ directory: link }), /PRIVATE_SINK_DIRECTORY/);
  const parent = path.join(f.root, 'linked-parent'); fs.symlinkSync(f.root, parent);
  assert.throws(() => f.create({ directory: path.join(parent, 'inventory') }), /PRIVATE_SINK_DIRECTORY/);
  assert.deepEqual(fs.readdirSync(f.directory), []);
  const regularFile = path.join(f.root, 'regular-file'); fs.writeFileSync(regularFile, 'synthetic', { mode: 0o600 });
  assert.throws(() => f.create({ directory: regularFile }), /PRIVATE_SINK_DIRECTORY/);
});

test('exclusive owner prevents replay; pre-existing completion/quarantine remains untouched', t => {
  const f = fixture(t); f.create(); const original = fs.readFileSync(f.file(OWNER));
  assert.throws(() => f.create(), /PRIVATE_SINK_IO/); assert.deepEqual(fs.readFileSync(f.file(OWNER)), original);
  for (const name of [COMPLETION, QUARANTINE]) {
    const g = fixture(t); fs.writeFileSync(g.file(name), 'synthetic preimage', { mode: 0o600 });
    assert.throws(() => g.create(), /PRIVATE_SINK_NO_REPLAY/);
    assert.equal(fs.readFileSync(g.file(name), 'utf8'), 'synthetic preimage');
    assert.equal(fs.existsSync(g.file(OWNER)), false);
  }
});

test('artifact collisions, symlinks and unsupported filenames never overwrite or traverse', async t => {
  for (const linked of [false, true]) {
    const f = fixture(t), sink = f.create(), target = path.join(f.root, 'protected');
    fs.writeFileSync(target, 'synthetic original', { mode: 0o600 });
    if (linked) fs.symlinkSync(target, f.file(inventory)); else fs.writeFileSync(f.file(inventory), 'synthetic original', { mode: 0o600 });
    await assert.rejects(sink.write(inventory, Buffer.from('replacement'), safeSignal()), /PRIVATE_SINK_IO/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic original');
    assert.equal(fs.readFileSync(f.file(inventory), 'utf8'), 'synthetic original'); await f.abort(sink);
  }
  for (const name of ['../escape', '/absolute', 'other.json', COMPLETION, QUARANTINE, inventory + '/nested']) {
    const f = fixture(t), sink = f.create();
    await assert.rejects(sink.write(name, Buffer.from('synthetic'), safeSignal()), /PRIVATE_SINK_FILENAME/);
    assert.deepEqual(fs.readdirSync(f.directory), [OWNER]);
  }
});

test('bounded writes reject wrong types, byte/count limits and missing signals', async t => {
  for (const payload of ['raw string', new Uint8Array(3), Buffer.alloc(0), Buffer.alloc(65)]) {
    const f = fixture(t, { maxFileBytes: 64 }), sink = f.create();
    await assert.rejects(sink.write(inventory, payload, safeSignal()), /PRIVATE_SINK_BOUND/);
    assert.equal(fs.existsSync(f.file(inventory)), false);
  }
  const f = fixture(t, { maxBytes: 4 }), sink = f.create();
  await sink.write(inventory, Buffer.from('1234'), safeSignal());
  await assert.rejects(sink.write(PROVENANCE, Buffer.from('1'), safeSignal()), /PRIVATE_SINK_BOUND/);
  const g = fixture(t, { maxFiles: 1 }), one = g.create();
  await one.write(inventory, Buffer.from('1'), safeSignal());
  await assert.rejects(one.write(PROVENANCE, Buffer.from('1'), safeSignal()), /PRIVATE_SINK_BOUND/);
  const h = fixture(t), missing = h.create();
  await assert.rejects(missing.write(inventory, Buffer.from('1')), /PRIVATE_SINK_SIGNAL/);
});

test('same sink never overwrites a prior artifact', async t => {
  const f = fixture(t), sink = f.create(), payload = Buffer.from('synthetic first');
  await sink.write(inventory, payload, safeSignal());
  await assert.rejects(sink.write(inventory, Buffer.from('second'), safeSignal()), /PRIVATE_SINK_NO_OVERWRITE/);
  assert.deepEqual(fs.readFileSync(f.file(inventory)), payload);
});

test('pre-aborted and mid-write signals preserve evidence, quarantine and forbid completion', async t => {
  const f = fixture(t), sink = f.create(), before = new AbortController(); before.abort();
  await assert.rejects(sink.write(inventory, Buffer.alloc(1), { signal: before.signal }), /PRIVATE_SINK_ABORTED/);
  assert.equal(fs.existsSync(f.file(inventory)), false); await sink.abort(safeSignal());
  const g = fixture(t, { chunkBytes: 64 }), partial = g.create(), controller = new AbortController();
  const pending = partial.write(inventory, Buffer.alloc(8192, 7), { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /PRIVATE_SINK_ABORTED/);
  const size = fs.statSync(g.file(inventory)).size; assert.ok(size > 0 && size < 8192);
  const original = fs.readFileSync(g.file(inventory)); await partial.abort(safeSignal());
  assert.deepEqual(fs.readFileSync(g.file(inventory)), original);
  assert.equal(JSON.parse(fs.readFileSync(g.file(QUARANTINE))).completionInvalid, true);
  assert.equal(fs.existsSync(g.file(COMPLETION)), false);
  await assert.rejects(partial.complete({}, safeSignal()), /PRIVATE_SINK_STATE/);
});

test('abort during an active write waits for it to stop and preserves partial bytes in place', async t => {
  const f = fixture(t, { chunkBytes: 32 }), sink = f.create();
  const writing = sink.write(inventory, Buffer.alloc(4096, 3), safeSignal());
  const rejected = assert.rejects(writing, /PRIVATE_SINK_ABORTED/);
  const [result, duplicate] = await Promise.all([sink.abort(safeSignal()), sink.abort(safeSignal())]); await rejected;
  assert.deepEqual(result, duplicate);
  assert.equal(result.status, 'PRIVATE_INVENTORY_QUARANTINED');
  assert.ok(fs.statSync(f.file(inventory)).size < 4096);
  const marker = fs.readFileSync(f.file(QUARANTINE)); await sink.abort(safeSignal());
  assert.deepEqual(fs.readFileSync(f.file(QUARANTINE)), marker);
});

test('deadline bounds are cooperative and preserve partial output without success', async t => {
  const f = fixture(t, { chunkBytes: 1, writeMS: 1 }), sink = f.create();
  await assert.rejects(sink.write(inventory, Buffer.alloc(65536), safeSignal()), /PRIVATE_SINK_TIMEOUT/);
  assert.equal(fs.existsSync(f.file(COMPLETION)), false);
  if (fs.existsSync(f.file(inventory))) assert.ok(fs.statSync(f.file(inventory)).size < 65536);
});

test('partial write error and fsync error preserve artifacts and redact filesystem errors', async t => {
  const f = fixture(t, { chunkBytes: 32 }), sink = f.create(), realWrite = fs.writeSync;
  let calls = 0;
  fs.writeSync = (...args) => { if (++calls === 2) throw Error('synthetic-private path and payload'); return realWrite(...args); };
  try { await assert.rejects(sink.write(inventory, Buffer.alloc(100, 2), safeSignal()), /^Error: PRIVATE_SINK_IO$/); }
  finally { fs.writeSync = realWrite; }
  assert.equal(fs.statSync(f.file(inventory)).size, 32); await sink.abort(safeSignal());
  assert.equal(fs.statSync(f.file(inventory)).size, 32);
  const g = fixture(t), failing = g.create(), realSync = fs.fsyncSync;
  fs.fsyncSync = () => { throw Error('synthetic-private fsync path'); };
  try { await assert.rejects(failing.write(inventory, Buffer.from('persist me'), safeSignal()), /^Error: PRIVATE_SINK_IO$/); }
  finally { fs.fsyncSync = realSync; }
  assert.equal(fs.readFileSync(g.file(inventory), 'utf8'), 'persist me');
  await failing.abort(safeSignal()); assert.ok(fs.existsSync(g.file(QUARANTINE)));
});

test('directory replacement, directory mode drift and ancestor mode drift refuse further writes', async t => {
  for (const mutate of [
    f => { fs.renameSync(f.directory, f.directory + '-retained'); fs.mkdirSync(f.directory, { mode: 0o700 }); },
    f => fs.chmodSync(f.directory, 0o750), f => fs.chmodSync(f.root, 0o750),
  ]) {
    const f = fixture(t), sink = f.create(); mutate(f);
    await assert.rejects(sink.write(inventory, Buffer.from('private'), safeSignal()), /PRIVATE_SINK_.*DRIFT/);
    assert.equal(fs.existsSync(f.file(inventory)), false); await f.abort(sink);
  }
});

test('file mode, hardlink and same-inode content drift prevent completion', async t => {
  for (const mutate of [
    f => fs.chmodSync(f.file(inventory), 0o640),
    f => fs.linkSync(f.file(inventory), path.join(f.root, 'extra-link')),
    f => { const fd = fs.openSync(f.file(inventory), 'r+'); try { fs.writeSync(fd, Buffer.from('X'), 0, 1, 0); } finally { fs.closeSync(fd); } },
  ]) {
    const f = fixture(t), p = await populated(f); mutate(f);
    await assert.rejects(p.sink.complete(p.receipt, safeSignal()), /PRIVATE_SINK_FILE_DRIFT|PRIVATE_SINK_READBACK/);
    assert.equal(fs.existsSync(f.file(COMPLETION)), false);
  }
});

test('receipt rejects raw fields, fabricated hashes/counts, namespace omission and restart claims', async t => {
  for (const mutate of [
    r => r.rawPrivate = 'must never be written', r => r.restartAuthorized = true,
    r => r.namespaces[0].sha256 = '0'.repeat(64), r => r.provenanceSha256 = '0'.repeat(64),
    r => r.counts[0].counts.clients = -1, r => r.backendAliases[0].key = 'raw-name',
    r => r.namespaces = [], r => r.counts.push(r.counts[0]),
  ]) {
    const f = fixture(t), p = await populated(f); mutate(p.receipt);
    await assert.rejects(p.sink.complete(p.receipt, safeSignal()), /PRIVATE_SINK_RECEIPT/);
    assert.equal(fs.existsSync(f.file(COMPLETION)), false);
  }
});

test('failed completion receipt write remains private and quarantine overrides its uncertain bytes', async t => {
  const f = fixture(t), p = await populated(f), realSync = fs.fsyncSync;
  fs.fsyncSync = () => { throw Error('synthetic private completion failure'); };
  try { await assert.rejects(p.sink.complete(p.receipt, safeSignal()), /^Error: PRIVATE_SINK_IO$/); }
  finally { fs.fsyncSync = realSync; }
  assert.ok(fs.existsSync(f.file(COMPLETION)));
  const before = fs.readFileSync(f.file(COMPLETION)); await p.sink.abort(safeSignal());
  assert.deepEqual(fs.readFileSync(f.file(COMPLETION)), before);
  assert.equal(JSON.parse(fs.readFileSync(f.file(QUARANTINE))).completionInvalid, true);
  assert.throws(() => f.create(), /PRIVATE_SINK_NO_REPLAY/);
});

test('abort after completion invalidates proof without deleting successful artifacts', async t => {
  const f = fixture(t), p = await populated(f); await p.sink.complete(p.receipt, safeSignal());
  const before = fs.readFileSync(f.file(COMPLETION)), result = await p.sink.abort(safeSignal());
  assert.equal(result.status, 'PRIVATE_INVENTORY_QUARANTINED');
  assert.deepEqual(fs.readFileSync(f.file(COMPLETION)), before); assert.ok(fs.existsSync(f.file(inventory)));
  assert.equal(fs.statSync(f.file(QUARANTINE)).mode & 0o7777, 0o600);
});

test('concurrent abort prevents completion from resolving successful custody', async t => {
  const f = fixture(t, { chunkBytes: 16 }), p = await populated(f);
  const completing = p.sink.complete(p.receipt, safeSignal());
  const rejected = assert.rejects(completing, /PRIVATE_SINK_ABORTED/);
  await p.sink.abort(safeSignal()); await rejected;
  assert.equal(JSON.parse(fs.readFileSync(f.file(QUARANTINE))).completionInvalid, true);
  assert.deepEqual(fs.readFileSync(f.file(inventory)), p.payload);
});

test('post-stop consumer count32768 is accepted but32769 is refused; file byte caps unchanged', async t => {
  const f = fixture(t), p = await populated(f); p.receipt.counts[0].counts.commands = 32768;
  assert.equal((await p.sink.complete(p.receipt, safeSignal())).artifactCount, 2); p.sink.close();
  const g = fixture(t), q = await populated(g); q.receipt.counts[0].counts.commands = 32769;
  await assert.rejects(q.sink.complete(q.receipt, safeSignal()), /PRIVATE_SINK_RECEIPT/);
  assert.equal(fs.existsSync(g.file(COMPLETION)), false);
});
