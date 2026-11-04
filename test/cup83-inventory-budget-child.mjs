// Owned disposable synthetic child only. Never connect, import custody or send.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Collection, Long, MongoClient } from 'mongodb';
import { captureCup83LiveMapping } from '../scripts/lib/cup83-durable-inventory.mjs';
import { buildCup83DurableMappingManifest, collectCup83IndependentInventory } from '../scripts/lib/cup83-independent-inventory.mjs';
import { createCup83PrivateInventorySink } from '../scripts/lib/cup83-private-inventory-sink.mjs';
import { buildCup83MaxRestartUnion } from '../scripts/lib/cup-legacy-max-snapshot.mjs';
const encode = v => Buffer.from(JSON.stringify(v) + '\n');
const hash = v => createHash('sha256').update(v).digest('hex');
const sourceEpoch = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const names = { clients: 'clients', dialogs: 'dialogs', messages: 'messages', serviceMessages: 'serviceMessages',
  responseMetrics: 'responseMetrics', outbox: 'outbox' };
const counts = { outbox: 25372, messages: 10000, serviceMessages: 1500, dialogs: 3000, clients: 2000 };
const at = '2026-11-03T00:00:00.000Z', servers = ['synthetic.invalid:27017'];
const topology = { type: 'Single', setName: null, servers };
let mutations = 0, queries = 0, closes = 0;
const forbidden = () => { mutations++; throw Error('SYNTHETIC_OPERATION_FORBIDDEN'); };
function row(kind, i) {
  const clientId = 'client-' + i % 2000, dialogId = 'dialog-' + i % 3000;
  const common = { clientId, dialogId, connector: 'MAX_BOT', stationId: 'synthetic-station', stationName: 'Synthetic venue', createdAt: at };
  if (kind === 'outbox') return { ...common, id: 'max-' + String(i).padStart(6, '0'),
    connector: i % 2 ? 'MAX_ACADEMY_BOT' : 'MAX_BOT', status: i < 5 ? 'LEASED' : ['SENT', 'FAILED', 'PENDING'][i % 3],
    text: 'Synthetic retained MAX support history. ' + 'x'.repeat(256), attempts: i % 4,
    targetExternalChatId: 'synthetic-chat-' + i % 2000,
    ...(i < 5 ? { leasedUntil: at } : {}), meta: { sourceMessageId: 'known-message-' + i, note: 'Synthetic history, no provider send' } };
  if (kind === 'messages' || kind === 'serviceMessages') return { ...common,
    id: (kind === 'messages' ? 'message-' : 'system-') + i, kind: kind === 'messages' ? 'TEXT' : 'SYSTEM',
    direction: kind === 'messages' ? 'OUTBOUND' : 'SYSTEM', senderRole: kind === 'messages' ? 'STAFF' : 'SYSTEM',
    senderId: 'synthetic-staff', text: 'Synthetic support transcript. ' + 'z'.repeat(kind === 'messages' ? 256 : 128),
    externalMessageId: 'synthetic-external-' + i, meta: { retained: true, source: 'SYNTHETIC' } };
  if (kind === 'clients') return { id: 'client-' + i, displayName: 'Synthetic client ' + i, authStatus: 'VERIFIED', phones: [], emails: [],
    identities: ['MAX_BOT', 'MAX_ACADEMY_BOT'].map(connector => ({ connector, externalUserId: 'synthetic-user-' + i,
      externalChatId: 'synthetic-chat-' + i, linkedAt: at, lastSeenAt: at })), createdAt: at, updatedAt: at };
  return { id: 'dialog-' + i, clientId, stationId: 'synthetic-station', stationName: 'Synthetic venue',
    accessStationIds: ['synthetic-station'], writeStationIds: ['synthetic-station'], readOnlyStationIds: [],
    connectors: ['MAX_BOT', 'MAX_ACADEMY_BOT'], authStatus: 'VERIFIED', status: 'OPEN', phones: [], emails: [],
    unreadCount: 0, hasUnreadMessages: false, hasNewMessages: false, isResolved: false,
    pendingClientMessageIds: [], responseTimeTotalMs: 1000, responseCount: 2, averageFirstResponseMs: 500,
    lastMessageAt: at, lastMessageText: 'Synthetic latest retained message', createdAt: at, updatedAt: at };
}
class SyntheticClient extends MongoClient {
  constructor(uri, options) {
    super(uri, options); // Real constructors/cursors; connect below never delegates.
    this.topology = { isConnected: () => true, description: { ...topology, servers: new Map(servers.map(s => [s, {}])) } };
  }
  async connect() { return this; }
  async close() { closes++; }
  db(dbName, options) {
    const db = super.db(dbName, options), original = db.collection.bind(db);
    db.command = forbidden; db.createCollection = forbidden; db.dropDatabase = forbidden;
    db.collection = kind => {
      const collection = original(kind);
      for (const method of ['insertOne', 'updateOne', 'deleteOne', 'bulkWrite', 'createIndex', 'drop']) collection[method] = forbidden;
      collection.find = (filter, options) => {
        queries++; const cursor = Collection.prototype.find.call(collection, filter, options); let i = 0;
        cursor.next = async () => {
          cursor.initialized = true;
          if (i < counts[kind]) return row(kind, i++);
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
function emptyMapBundle() {
  const identity = { pid: 123, start: '123456.5', bootId: '11111111-1111-4111-8111-111111111111', sourceEpoch,
    modulePath: '/synthetic/dist/support/support.service.js', entrypoint: '/synthetic/dist/main.js', nodeVersion: 'v22.13.1', processStartTicks: '98765' };
  const source = { pid: identity.pid, bootId: identity.bootId, startTicks: identity.processStartTicks, sourceCommit: sourceEpoch,
    sourceTree: 'cfffdce4d5c69f0da7c50fbc90527bf00894d0fa', runtimeInventorySha256: 'a'.repeat(64) };
  const operation = encode({ schema: 'PHUB_CUP83_MAX_DIAGNOSTIC_OPERATION_V1', target: 'lk-primary-147', sourceSha: sourceEpoch,
    sourceTree: source.sourceTree, runtimeInventorySha256: source.runtimeInventorySha256, pid: identity.pid, bootId: identity.bootId,
    processStartTicks: identity.processStartTicks, modulePath: identity.modulePath, entrypoint: identity.entrypoint, nodeVersion: identity.nodeVersion,
    operationId: 'f'.repeat(32), expiresAt: '2026-11-02T23:00:00.000Z' });
  const raw = encode({ schema: 'SYNTHETIC_MAX_MAP_EXPORT_V1', identity, totalMapCount: 0, maxCount: 0, counts: {}, rows: [], undefinedPaths: [] });
  const fullCounts = Object.fromEntries(['MAX_BOT', 'MAX_ACADEMY_BOT'].flatMap(c => ['PENDING', 'LEASED', 'SENT', 'FAILED'].map(s => [c + ':' + s, 0])));
  const inputs = { raw, operation, intent: encode({ schema: 'PHUB_CUP83_EXPORT_INTENT_V1', manifestSha256: hash(operation), operationId: 'f'.repeat(32),
    pid: identity.pid, bootId: identity.bootId, startTicks: identity.processStartTicks, at: '2026-11-02T22:00:00.000Z' }),
    captured: encode({ status: 'CAPTURED', artifactSha256: hash(raw), counts: fullCounts, at: '2026-11-02T22:00:01.000Z' }),
    terminal: encode({ status: 'SUCCESS', artifactSha256: hash(raw), inspectorClosed: true, soleClientProven: false,
      drainProven: false, at: '2026-11-02T22:00:02.000Z' }) };
  return { inputs, expected: { hashes: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, hash(v)])), identity, source, targetFingerprint: 'b'.repeat(64) } };
}
async function main() {
  assert.ok(process.execArgv.includes('--max-old-space-size=512'));
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'cup83-budget-child-')));
  const stat = fs.statSync(directory), sink = createCup83PrivateInventorySink({ directory, expectedUid: process.getuid(), expectedDirectory: { dev: stat.dev, ino: stat.ino } });
  try {
    class Support {}
    class Persistence {}
    const support = new Support(), persistence = new Persistence(); support.persistence = persistence;
    const client = new SyntheticClient('mongodb://synthetic.invalid:27017'), db = client.db('synthetic');
    const config = { key: 'primary', dbName: 'synthetic', collections: { ...names } };
    Object.defineProperty(config, 'uri', { get() { throw Error('MAPPING_URI_FORBIDDEN'); } });
    persistence.backendConfigs = [config]; persistence.backendStates = new Map([['primary', { config, client, db }]]);
    const sourceIdentity = { sourceEpoch, pid: process.pid, start: String(performance.timeOrigin), nodeVersion: process.version };
    const mapping = captureCup83LiveMapping({ support, expected: { identity: sourceIdentity, supportPrototype: Support.prototype,
      persistencePrototype: Persistence.prototype, backends: [{ key: 'primary', client, db, dbName: 'synthetic', collections: names, topology }] } });
    assert.equal(queries, 0); // No pre-stop row scan despite25372 historical MAX.
    const built = buildCup83DurableMappingManifest({ mappingCapture: mapping.capture, expected: { mappingCaptureSha256: mapping.sha256, sourceIdentity } });
    const sourceCapture = { schema: 'PHAB_CUP83_LIVE_MAPPING_CAPTURE_V1', sha256: mapping.sha256 };
    const result = await collectCup83IndependentInventory({ manifest: built.manifest,
      expected: { manifestSha256: built.sha256, sourceIdentity, sourceCapture },
      connections: [{ key: 'primary', uri: 'mongodb://synthetic.invalid:27017', dbName: 'synthetic', collections: names }],
      stopGuard: async () => ({ schema: 'PHAB_CUP83_STOP_GUARD_V1', sourceIdentity, stopped: true,
        checkedAt: new Date().toISOString(), evidenceSha256: 'e'.repeat(64) }), sink, MongoClientCtor: SyntheticClient });
    assert.equal(closes, 1); assert.equal(queries, 5); assert.equal(mutations, 0); sink.close();
    const inventoryName = 'cup83-durable-' + result.collectorReceipt.namespaces[0].fingerprint + '.json';
    const durable = JSON.parse(fs.readFileSync(directory + '/' + inventoryName));
    assert.equal(durable.rows.commands.length, counts.outbox);
    assert.equal(durable.rows.commands.filter(([, row]) => row.status === 'LEASED').length, 5);
    const encodedBytes = fs.statSync(directory + '/' + inventoryName).size + fs.statSync(directory + '/cup83-durable-provenance.json').size;
    // Offline synthetic union only; use all25372 IDs without truncation/projection.
    const map = emptyMapBundle(), durableMax = encode({ schema: 'PHAB_CUP83_MAX_DURABLE_INVENTORY_V1', source: map.expected.source,
      targetFingerprint: 'd'.repeat(64), capturedAt: at, commands: durable.rows.commands.map(([, row]) => row) });
    const union = buildCup83MaxRestartUnion(map.inputs, map.expected, [durableMax], {
      mapContextSha256: hash(encode(map.expected)), inventories: [{ sha256: hash(durableMax), targetFingerprint: 'd'.repeat(64) }] });
    const { validateLegacyMaxSnapshot } = createRequire(import.meta.url)('../dist/support/legacy-max-custody.js');
    let validated = 0;
    for (const batch of union.batches) { assert.ok(batch.snapshot.length <= 32 * 1024 * 1024);
      const commands = validateLegacyMaxSnapshot(batch.snapshot, JSON.parse(batch.importManifest)); assert.ok(commands.length <= 5000); validated += commands.length; }
    assert.equal(validated, counts.outbox); assert.equal(union.batches.length, 6);
    return { maxCommands: counts.outbox, messages: counts.messages, serviceMessages: counts.serviceMessages, dialogs: counts.dialogs,
      clients: counts.clients, maxBatches: union.batches.length, encodedBytes, chargedBytes: result.scanBudget.chargedBytes,
      chargeLimitBytes: result.scanBudget.chargeLimitBytes, outputLimitBytes: result.scanBudget.outputLimitBytes,
      peakRssBytes: process.resourceUsage().maxRSS * 1024, mappingCaptureBytes: mapping.capture.length,
      networkConnections: 0, liveMutation: false };
  } finally { try { await sink.abort({ signal: new AbortController().signal }); } catch {} fs.rmSync(directory, { recursive: true, force: true }); }
}
main().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(() => { process.stderr.write('SYNTHETIC_BUDGET_FAILED\n'); process.exitCode = 1; });
