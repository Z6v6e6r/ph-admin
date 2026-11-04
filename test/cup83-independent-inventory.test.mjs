import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Collection, Long, MongoClient } from 'mongodb';
import { captureCup83LiveMapping, collectCup83DurableInventory } from '../scripts/lib/cup83-durable-inventory.mjs';
import { buildCup83DurableMappingManifest, collectCup83IndependentInventory } from '../scripts/lib/cup83-independent-inventory.mjs';
import { createCup83PrivateInventorySink } from '../scripts/lib/cup83-private-inventory-sink.mjs';

const sourceEpoch = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const names = { clients: 'clients', dialogs: 'dialogs', messages: 'messages', serviceMessages: 'serviceMessages',
  responseMetrics: 'responseMetrics', outbox: 'outbox' };
const topology = { type: 'Single', setName: null, servers: ['synthetic.invalid:27017'] };
const syntheticUri = 'mongodb://synthetic-user:synthetic-secret@synthetic.invalid:27017';
function memorySink() {
  const state = { writes: new Map(), quarantined: new Map(), aborts: 0, completion: undefined };
  state.sink = { private: true,
    async write(file, payload) { state.writes.set(file, Buffer.from(payload)); },
    async complete(receipt) { state.completion = receipt; },
    async abort() { state.aborts++; for (const [file, payload] of state.writes) state.quarantined.set(file, payload);
      state.writes.clear(); state.completion = undefined; } };
  return state;
}
async function fixture(keys = ['primary']) {
  const f = { mode: 'capture', readers: [], events: [], mutations: 0, data: new Map(), calls: [] };
  class SyntheticClient extends MongoClient {
    constructor(uri, options) {
      super(uri, options); // Real driver option/cursor contracts, never network.
      this.testOptions = options; this.testClosed = 0;
      this.topology = { isConnected: () => true, description: { type: topology.type,
        setName: topology.setName, servers: new Map(topology.servers.map(s => [s, {}])) } };
      if (f.mode === 'reader') f.readers.push(this);
    }
    async connect() { f.events.push('connect'); if (f.connect) await f.connect(this); return this; }
    async close() { this.testClosed++; f.events.push('close'); if (f.close) await f.close(this); }
    db(dbName, options) {
      const db = super.db(dbName, options), original = db.collection.bind(db);
      const forbidden = () => { f.mutations++; throw Error('synthetic forbidden mutation'); };
      db.command = forbidden; db.createCollection = forbidden; db.dropDatabase = forbidden;
      db.collection = collectionName => {
        const collection = original(collectionName);
        for (const method of ['insertOne', 'updateOne', 'deleteOne', 'bulkWrite', 'createIndex', 'drop']) collection[method] = forbidden;
        collection.find = (filter, options) => {
          f.calls.push({ dbName, collectionName, filter, options }); f.events.push('find');
          const cursor = Collection.prototype.find.call(collection, filter, options); let index = 0;
          cursor.next = async () => {
            cursor.initialized = true;
            if (f.next) return f.next({ cursor, dbName, collectionName, index: index++ });
            const rows = f.data.get(dbName)?.[collectionName] ?? [];
            if (index < rows.length) return structuredClone(rows[index++]);
            cursor.cursorId = Long.ZERO; cursor.isClosed = true; return null;
          };
          cursor.close = async () => { cursor.isClosed = true; this.s.activeCursors.delete(cursor); };
          return cursor;
        };
        return collection;
      };
      return db;
    }
  }
  f.Ctor = SyntheticClient;
  class Persistence {}
  class Support {}
  const support = new Support(), persistence = new Persistence(); support.persistence = persistence;
  persistence.backendStates = new Map(); persistence.backendConfigs = [];
  const backends = keys.map((key, index) => {
    const dbName = 'synthetic' + index, client = new SyntheticClient(syntheticUri), db = client.db(dbName);
    const config = { key, dbName, collections: { ...names } };
    Object.defineProperty(config, 'uri', { get() { throw Error('capture URI access forbidden'); } });
    persistence.backendConfigs.push(config); persistence.backendStates.set(key, { config, client, db });
    f.data.set(dbName, { clients: [{ id: 'p', phones: ['synthetic-private'] }],
      dialogs: [{ id: 'd', clientId: 'p' }], messages: [{ id: 'm', kind: 'TEXT' }],
      serviceMessages: [{ id: 's', kind: 'SYSTEM' }], outbox: [{ id: 'known-message', connector: 'MAX_BOT', status: 'LEASED' }] });
    return { key, client, db, dbName, collections: { ...names }, topology: structuredClone(topology) };
  });
  f.sourceIdentity = { sourceEpoch, pid: process.pid, start: String(performance.timeOrigin), nodeVersion: process.version };
  const capture = memorySink();
  const liveExpected = { identity: f.sourceIdentity, supportPrototype: Support.prototype, persistencePrototype: Persistence.prototype, backends };
  f.mapping = captureCup83LiveMapping({ support, expected: liveExpected });
  f.captureReceipt = await collectCup83DurableInventory({ support, sink: capture.sink,
    expected: liveExpected });
  f.provenance = capture.writes.get('cup83-durable-provenance.json');
  f.builderExpected = { provenanceSha256: hash(f.provenance), sourceIdentity: structuredClone(f.sourceIdentity),
    backends: backends.map(({ key, dbName, collections, topology }) => ({ key, dbName, collections, topology })) };
  const built = buildCup83DurableMappingManifest({ provenance: f.provenance, expected: f.builderExpected });
  f.manifest = built.manifest;
  f.expected = { manifestSha256: built.sha256, sourceIdentity: structuredClone(f.sourceIdentity), sourceProvenanceSha256: hash(f.provenance) };
  f.connections = backends.map(b => ({ key: b.key, uri: syntheticUri, dbName: b.dbName, collections: { ...b.collections } }));
  f.useMapping = () => {
    const built = buildCup83DurableMappingManifest({ mappingCapture: f.mapping.capture,
      expected: { mappingCaptureSha256: f.mapping.sha256, sourceIdentity: f.sourceIdentity } });
    f.manifest = built.manifest; f.expected = { manifestSha256: built.sha256, sourceIdentity: structuredClone(f.sourceIdentity),
      sourceCapture: { schema: 'PHAB_CUP83_LIVE_MAPPING_CAPTURE_V1', sha256: f.mapping.sha256 } };
  };
  f.storage = memorySink();
  f.guard = async context => {
    f.events.push('guard:' + context.phase);
    const proof = { schema: 'PHAB_CUP83_STOP_GUARD_V1', sourceIdentity: structuredClone(context.sourceIdentity),
      stopped: true, checkedAt: new Date().toISOString(), evidenceSha256: 'e'.repeat(64) };
    return f.guardHook ? f.guardHook(proof, context) : proof;
  };
  f.run = overrides => collectCup83IndependentInventory({ connections: f.connections, manifest: f.manifest,
    expected: f.expected, stopGuard: f.guard, sink: f.storage.sink, MongoClientCtor: f.Ctor, ...overrides });
  f.mode = 'reader'; f.events = []; f.calls = [];
  return f;
}

test('real live capture → pinned manifest → independent owned clients retains exact inventory bytes and separate identities', async () => {
  const f = await fixture(['primary', 'web']), result = await f.run();
  assert.equal(result.status, 'BOUNDED_INDEPENDENT_DURABLE_INVENTORIES_COLLECTED');
  assert.deepEqual(result.collectorReceipt.namespaces, f.captureReceipt.namespaces);
  assert.deepEqual(f.events.filter(e => e.startsWith('guard:')), ['guard:BEFORE_CONNECT', 'guard:BEFORE_SCAN', 'guard:AFTER_SCAN']);
  assert.ok(f.events.indexOf('guard:BEFORE_CONNECT') < f.events.indexOf('connect'));
  assert.ok(f.events.indexOf('guard:BEFORE_SCAN') < f.events.indexOf('find'));
  assert.equal(f.readers.length, 2); assert.ok(f.readers.every(c => c.testClosed === 1 && c.s.activeCursors.size === 0));
  assert.equal(f.mutations, 0); assert.equal(result.restartAuthorized, false); assert.equal(result.producerDrainProven, false);
  assert.deepEqual(Object.keys(result.readerIdentity), ['pid', 'start', 'nodeVersion']);
  const provenance = JSON.parse(f.storage.writes.get('cup83-durable-provenance.json'));
  assert.equal(provenance.schema, 'PHAB_CUP83_INDEPENDENT_DURABLE_PROVENANCE_V1');
  assert.deepEqual(provenance.sourceIdentity, f.sourceIdentity); assert.deepEqual(provenance.readerIdentity, result.readerIdentity);
  assert.deepEqual(provenance.sourceCapture, { schema: 'PHAB_CUP83_DURABLE_PROVENANCE_V1', sha256: hash(f.provenance) });
  assert.equal(provenance.stopProofs.length, 3);
  for (const proof of provenance.stopProofs) assert.equal(hash(encode(proof.proof)), proof.sha256);
  assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  assert.equal([...f.storage.writes.values()].some(b => b.includes('synthetic-secret')), false);
  for (const client of f.readers) {
    const options = client.testOptions;
    for (const key of ['serverSelectionTimeoutMS', 'connectTimeoutMS', 'socketTimeoutMS', 'timeoutMS']) assert.equal(options[key], 5000);
    assert.equal(options.maxPoolSize, 1); assert.equal(options.retryReads, false); assert.equal(options.readPreference, 'primary');
    assert.deepEqual(options.readConcern, { level: 'majority' }); assert.equal(options.monitorCommands, false);
    assert.deepEqual(options.mongodbLogComponentSeverities, { default: 'off' });
  }
});

test('independent collector integrates with unchanged filesystem sink; client close failure quarantines completion', async t => {
  for (const failClose of [false, true]) {
    const f = await fixture(), directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'cup83-independent-sink-test-')));
    const stat = fs.statSync(directory);
    const sink = createCup83PrivateInventorySink({ directory, expectedUid: process.getuid(), expectedDirectory: { dev: stat.dev, ino: stat.ino } });
    t.after(async () => { try { await sink.abort({ signal: new AbortController().signal }); } catch {} fs.rmSync(directory, { recursive: true, force: true }); });
    if (failClose) f.close = () => { throw Error(syntheticUri); };
    if (failClose) {
      await assert.rejects(f.run({ sink }), /^Error: INDEPENDENT_CLOSE_FAILED$/);
      assert.equal(JSON.parse(fs.readFileSync(directory + '/cup83-durable-quarantine.json')).completionInvalid, true);
      assert.ok(fs.existsSync(directory + '/cup83-durable-completion.json'));
    } else {
      const result = await f.run({ sink });
      assert.deepEqual(JSON.parse(fs.readFileSync(directory + '/cup83-durable-completion.json')).collectorReceipt, result.collectorReceipt);
      assert.equal(fs.existsSync(directory + '/cup83-durable-quarantine.json'), false); sink.close();
    }
  }
});

test('manifest builder binds actual provenance bytes/source and all six private collection names', async () => {
  const f = await fixture();
  const m = JSON.parse(f.manifest); assert.equal(m.backends[0].collections.responseMetrics, names.responseMetrics);
  for (const change of [
    expected => expected.provenanceSha256 = '0'.repeat(64), expected => expected.sourceIdentity.pid++,
    expected => expected.backends[0].collections.responseMetrics = 'unattested-metrics',
    expected => expected.backends[0].collections.serviceMessages = 'unattested-system',
    expected => expected.backends[0].topology.servers = ['unattested.invalid:27017'],
  ]) {
    const expected = structuredClone(f.builderExpected); change(expected);
    assert.throws(() => buildCup83DurableMappingManifest({ provenance: f.provenance, expected }), /PRIVATE_INPUT_HASH|SOURCE_PROVENANCE|SOURCE_NAMESPACE/);
  }
  for (const change of [v => v.namespaces[0].complete = false, v => v.namespaces[0].collections.pop(),
    v => v.namespaces[0].collections[0].eof = false, v => v.namespaces[0].backendKeys.push('max')]) {
    const value = JSON.parse(f.provenance); change(value); const provenance = encode(value);
    assert.throws(() => buildCup83DurableMappingManifest({ provenance, expected: { ...f.builderExpected, provenanceSha256: hash(provenance) } }), /SOURCE_NAMESPACE|SOURCE_COLLECTION/);
  }
});

for (const [label, change, pattern] of [
  ['missing guard', f => f.guard = undefined, /STOP_GUARD_REQUIRED/],
  ['missing connection', f => f.connections = [], /CONNECTION_SET/],
  ['extra connection', f => f.connections.push(f.connections[0]), /CONNECTION_SET/],
  ['database mapping', f => f.connections[0].dbName = 'other', /CONNECTION_MAPPING/],
  ['sixth collection mapping', f => f.connections[0].collections.responseMetrics = 'other', /CONNECTION_MAPPING/],
  ['manifest hash', f => f.expected.manifestSha256 = '0'.repeat(64), /PRIVATE_INPUT_HASH_OR_BOUND/],
  ['source identity', f => f.expected.sourceIdentity.pid++, /MANIFEST_SOURCE/],
  ['source capture', f => f.expected.sourceProvenanceSha256 = '0'.repeat(64), /MANIFEST_SOURCE/],
  ['URI type', f => f.connections[0].uri = 'https://synthetic-secret', /CONNECTION_URI/],
]) test('rejects ' + label + ' before connection', async () => {
  const f = await fixture(); change(f); await assert.rejects(f.run(), pattern);
  assert.equal(f.readers.length, 0); assert.equal(f.storage.aborts, 1); assert.equal(f.storage.completion, undefined);
});

test('computed manifest fingerprint mismatch refuses even when caller pins those modified bytes', async () => {
  const f = await fixture(), value = JSON.parse(f.manifest); value.backends[0].collectionsSha256 = '0'.repeat(64);
  f.manifest = encode(value); f.expected.manifestSha256 = hash(f.manifest);
  await assert.rejects(f.run(), /MANIFEST_MAPPING_HASH/); assert.equal(f.readers.length, 0);
});

for (const suffix of [
  '?authMechanism=MONGODB-AWS', '?authMechanism=MONGODB-OIDC', '?authMechanism=GSSAPI', '?authMechanism=MONGODB-X509',
  '?authMechanismProperties=ENVIRONMENT:aws', '?tlsCAFile=/synthetic/private/ca.pem',
  '?tlsCertificateKeyFile=/synthetic/private/key.pem', '?tlsCRLFile=/synthetic/private/crl.pem',
  '?proxyHost=synthetic.invalid', '?authSource=admin&AUTHSOURCE=other', '?%61uthMechanism=GSSAPI',
]) test('external/file/ambiguous connection option refuses before constructor: ' + suffix.split('=')[0], async () => {
  const f = await fixture(); f.connections[0].uri = syntheticUri + suffix;
  await assert.rejects(f.run(), /^Error: CONNECTION_URI_OPTIONS$/); assert.equal(f.readers.length, 0);
});

test('SRV URI refuses before construction, ordinary SCRAM and default-CA TLS options remain explicit', async () => {
  const f = await fixture(); f.connections[0].uri = 'mongodb+srv://synthetic.invalid';
  await assert.rejects(f.run(), /^Error: CONNECTION_URI$/); assert.equal(f.readers.length, 0);
  for (const mechanism of ['SCRAM-SHA-1', 'SCRAM-SHA-256', 'DEFAULT']) {
    const g = await fixture(); g.connections[0].uri += '?authSource=admin&authMechanism=' + mechanism + '&tls=true&directConnection=true';
    assert.equal((await g.run()).restartAuthorized, false);
  }
});

test('unsupported injected driver type is rejected before connect and private errors are redacted', async () => {
  const f = await fixture();
  await assert.rejects(f.run({ MongoClientCtor: class Unsupported {} }), /^Error: INDEPENDENT_CONNECT_FAILED$/);
  assert.equal(f.readers.length, 0); assert.equal(f.storage.aborts, 1);
});

for (const phase of ['BEFORE_CONNECT', 'BEFORE_SCAN', 'AFTER_SCAN']) test('old writer still present at ' + phase + ' refuses and closes owned clients', async () => {
  const f = await fixture(); f.guardHook = (proof, ctx) => { if (ctx.phase === phase) proof.stopped = false; return proof; };
  await assert.rejects(f.run(), /STOP_GUARD_PROOF/);
  assert.equal(f.storage.completion, undefined); assert.equal(f.storage.writes.size, 0); assert.equal(f.storage.aborts, 1);
  assert.equal(f.readers.length, phase === 'BEFORE_CONNECT' ? 0 : 1); assert.ok(f.readers.every(c => c.testClosed === 1));
  if (phase !== 'AFTER_SCAN') assert.equal(f.calls.length, 0);
});

for (const [label, change] of [
  ['stale', p => p.checkedAt = new Date(Date.now() - 6000).toISOString()],
  ['future', p => p.checkedAt = new Date(Date.now() + 10000).toISOString()],
  ['wrong old identity', p => p.sourceIdentity.start = '1'],
  ['bad evidence hash', p => p.evidenceSha256 = syntheticUri],
  ['unknown proof fields', p => p.extra = syntheticUri],
]) test('guard refuses ' + label + ' proof without leaking values', async () => {
  const f = await fixture(); f.guardHook = p => { change(p); return p; };
  await assert.rejects(f.run(), /^Error: STOP_GUARD_PROOF$/); assert.equal(f.readers.length, 0);
});

test('guard errors and waits are bounded/redacted before connecting', async () => {
  const f = await fixture(); f.guardHook = () => { throw Error(syntheticUri); };
  await assert.rejects(f.run(), /^Error: STOP_GUARD_UNAVAILABLE$/);
  const g = await fixture(); g.guardHook = () => new Promise(() => {});
  await assert.rejects(g.run({ limits: { operationMS: 10 } }), /^Error: STOP_GUARD_UNAVAILABLE$/);
  assert.equal(f.readers.length + g.readers.length, 0);
});

test('connect failure/timeout are redacted, close clients and quarantine; second target failure closes both', async () => {
  const f = await fixture(['primary', 'web']); let attempt = 0;
  f.connect = () => { if (++attempt === 2) throw Error(syntheticUri); };
  await assert.rejects(f.run(), /^Error: INDEPENDENT_CONNECT_FAILED$/);
  assert.equal(f.readers.length, 2); assert.ok(f.readers.every(c => c.testClosed === 1)); assert.equal(f.storage.aborts, 1);
  const g = await fixture(); g.connect = () => new Promise(() => {});
  await assert.rejects(g.run({ limits: { operationMS: 10 } }), /^Error: INDEPENDENT_CONNECT_TIMEOUT$/);
  assert.equal(g.readers[0].testClosed, 1); assert.equal(g.storage.aborts, 1);
});

test('connected actual topology must equal captured topology before any scan', async () => {
  const f = await fixture(); f.connect = c => { c.topology.description.servers = new Map([['wrong.invalid:27017', {}]]); };
  await assert.rejects(f.run(), /TOPOLOGY_IDENTITY/); assert.equal(f.calls.length, 0); assert.equal(f.readers[0].testClosed, 1);
});

test('scan error after connection aborts/quarantines and closes every owned client', async () => {
  const f = await fixture(['primary', 'web']); f.next = () => { throw Error(syntheticUri + ' synthetic-private row'); };
  await assert.rejects(f.run(), /^Error: READ_FAILED$/);
  assert.equal(f.storage.aborts, 1); assert.ok(f.readers.every(c => c.testClosed === 1 && c.s.activeCursors.size === 0));
});

test('post-scan close failure/timeout invalidates completion with bounded private sink cleanup', async () => {
  for (const timeout of [false, true]) {
    const f = await fixture(); f.close = () => { if (timeout) return new Promise(() => {}); throw Error(syntheticUri); };
    await assert.rejects(f.run({ limits: { cleanupMS: 10 } }), /^Error: INDEPENDENT_CLOSE_FAILED$/);
    assert.equal(f.storage.completion, undefined); assert.equal(f.storage.aborts, 1); assert.equal(f.storage.quarantined.size, 2);
  }
  const f = await fixture(); f.close = () => { throw Error(syntheticUri); };
  f.storage.sink.abort = async () => { throw Error(syntheticUri); };
  await assert.rejects(f.run(), /^Error: INDEPENDENT_CLEANUP_FAILED$/);
});

test('post-scan guard failure occurs before inventory writes even after all cursors reached EOF', async () => {
  const f = await fixture(); f.guardHook = (proof, ctx) => { if (ctx.phase === 'AFTER_SCAN') throw Error(syntheticUri); return proof; };
  await assert.rejects(f.run(), /^Error: STOP_GUARD_UNAVAILABLE$/); assert.equal(f.calls.length, 5);
  assert.equal(f.storage.writes.size, 0); assert.equal(f.storage.completion, undefined); assert.equal(f.readers[0].testClosed, 1);
});

test('actual synchronous mapping-only capture builds independent manifest with exact schema/hash linkage and no fabricated completeness', async () => {
  const f = await fixture(); f.useMapping(); const value = JSON.parse(f.manifest);
  assert.equal(value.schema, 'PHAB_CUP83_DURABLE_MAPPING_MANIFEST_V2');
  assert.deepEqual(value.sourceCapture, f.expected.sourceCapture); assert.equal(Object.hasOwn(value, 'complete'), false);
  const result = await f.run(); assert.deepEqual(result.sourceCapture, f.expected.sourceCapture);
  assert.equal(result.scanBudget.maxRowsPerCollection, 32768); assert.equal(result.scanBudget.outputLimitBytes, 64 * 1024 * 1024);
  assert.equal(result.scanBudget.chargeLimitBytes, 6 * 64 * 1024 * 1024);
  const provenance = JSON.parse(f.storage.writes.get('cup83-durable-provenance.json'));
  assert.equal(provenance.schema, 'PHAB_CUP83_INDEPENDENT_DURABLE_PROVENANCE_V2');
  assert.deepEqual(provenance.sourceCapture, f.expected.sourceCapture);
});

test('mapping-only builder rejects tampered full mappings, false schema/completeness and independent capture linkage drift', async () => {
  const f = await fixture();
  for (const change of [v => v.backends[0].collections.responseMetrics = 'unattested',
    v => v.durableCompletenessProven = true, v => v.complete = true, v => v.schema = 'PHAB_CUP83_DURABLE_PROVENANCE_V1']) {
    const value = JSON.parse(f.mapping.capture); change(value); const mappingCapture = encode(value);
    assert.throws(() => buildCup83DurableMappingManifest({ mappingCapture,
      expected: { mappingCaptureSha256: hash(mappingCapture), sourceIdentity: f.sourceIdentity } }), /MANIFEST_MAPPING_HASH|MAPPING_CAPTURE/);
  }
  assert.throws(() => buildCup83DurableMappingManifest({ mappingCapture: f.mapping.capture,
    expected: { mappingCaptureSha256: '0'.repeat(64), sourceIdentity: f.sourceIdentity } }), /PRIVATE_INPUT_HASH/);
  f.useMapping(); f.expected.sourceCapture.schema = 'PHAB_CUP83_DURABLE_PROVENANCE_V1';
  await assert.rejects(f.run(), /MANIFEST_SOURCE/); assert.equal(f.readers.length, 0);
});

test('post-stop profile refuses32769 rows and charge ceilings beyond384MiB without widening output', async () => {
  const f = await fixture(); f.useMapping();
  f.next = ({ cursor, collectionName, index }) => {
    if (collectionName === 'outbox' && index < 32769) return { id: 'bounded-' + index, status: 'SENT' };
    cursor.cursorId = Long.ZERO; cursor.isClosed = true; return null;
  };
  await assert.rejects(f.run(), /COUNT_LIMIT/); assert.equal(f.storage.completion, undefined);
  const g = await fixture(); await assert.rejects(g.run({ limits: { maxRowsPerCollection: 32769 } }), /LIMITS/);
  const h = await fixture(); await assert.rejects(h.run({ limits: { maxChargeBytes: 6 * 64 * 1024 * 1024 + 1 } }), /LIMITS/);
  assert.equal(g.readers.length + h.readers.length, 0);
});

test('independent conservative-charge and actual encoded-output bounds each fail closed', async () => {
  const f = await fixture(); f.useMapping();
  await assert.rejects(f.run({ limits: { maxChargeBytes: 16 } }), /BYTE_LIMIT/); assert.equal(f.storage.writes.size, 0);
  const g = await fixture(); g.useMapping(); g.data.get('synthetic0').clients[0].text = '"'.repeat(3000);
  // Escaped output >4096 bytes while conservative charge remains below6*4096.
  await assert.rejects(g.run({ limits: { maxBytes: 4096 } }), /BYTE_LIMIT/); assert.equal(g.storage.writes.size, 0);
  assert.equal(g.storage.completion, undefined);
});

test('owned512MiB child handles25372MAX plus realistic history/identity corpus and six unchanged union batches', t => {
  const run = spawnSync(process.execPath, ['--max-old-space-size=512', fileURLToPath(new URL('./cup83-inventory-budget-child.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr); const summary = JSON.parse(run.stdout);
  assert.equal(summary.maxCommands, 25372); assert.ok(summary.maxBatches >= 6);
  assert.ok(summary.encodedBytes <= 64 * 1024 * 1024); assert.ok(summary.chargedBytes <= 6 * 64 * 1024 * 1024);
  assert.ok(summary.chargedBytes > 64 * 1024 * 1024); assert.ok(summary.peakRssBytes < 512 * 1024 * 1024);
  assert.equal(summary.networkConnections, 0); assert.equal(summary.liveMutation, false);
  t.diagnostic(JSON.stringify(summary));
});
