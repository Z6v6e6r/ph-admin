import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAndFenceCup83Support } from '../scripts/lib/cup83-support-fence.mjs';
import { normalizeCup83MaxSnapshot, normalizeCup83PreDrainFence, buildCup83MaxRestartUnion,
  buildCup83FencedMaxRestartUnion } from '../scripts/lib/cup-legacy-max-snapshot.mjs';

// CI builds the existing backend before this test. No application instance or Mongo connection.
const require = createRequire(import.meta.url);
const { validateLegacyMaxSnapshot } = require('../dist/support/legacy-max-custody.js');
const enc = value => Buffer.from(JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const groups = ['MAX_BOT', 'MAX_ACADEMY_BOT'].flatMap(c => ['PENDING', 'LEASED', 'SENT', 'FAILED'].map(s => c + ':' + s));
function fixture() {
  const identity = { pid: 123, start: '123456.5', bootId: '11111111-1111-4111-8111-111111111111',
    sourceEpoch: '83b1c17bc4c5edaec65387b25b5695e48337c3cf', modulePath: '/synthetic/dist/support/support.service.js',
    entrypoint: '/synthetic/dist/main.js', nodeVersion: 'v22.13.1', processStartTicks: '98765' };
  const source = { pid: identity.pid, bootId: identity.bootId, startTicks: identity.processStartTicks,
    sourceCommit: identity.sourceEpoch, sourceTree: 'cfffdce4d5c69f0da7c50fbc90527bf00894d0fa', runtimeInventorySha256: 'a'.repeat(64) };
  const rows = groups.map((group, i) => {
    const [connector, status] = group.split(':');
    const command = { id: `synthetic-${i}`, connector, status, attempts: i,
      text: 'synthetic message', clientId: 'synthetic-client', dialogId: 'synthetic-dialog',
      leasedUntil: '2026-11-03T00:00:00.000Z', meta: { nested: { preserve: true } } };
    return [command.id, command];
  });
  const counts = Object.fromEntries(groups.map(key => [key, 1]));
  return { raw: { schema: 'SYNTHETIC_MAX_MAP_EXPORT_V1', identity, totalMapCount: 9, maxCount: 8,
    counts, rows, undefinedPaths: [{ commandId: 'synthetic-0', path: ['meta', 'nested', 'omitted'] }] },
  operation: { schema: 'PHUB_CUP83_MAX_DIAGNOSTIC_OPERATION_V1', target: 'lk-primary-147',
    sourceSha: source.sourceCommit, sourceTree: source.sourceTree, runtimeInventorySha256: source.runtimeInventorySha256,
    pid: identity.pid, bootId: identity.bootId, processStartTicks: identity.processStartTicks,
    modulePath: identity.modulePath, entrypoint: identity.entrypoint, nodeVersion: identity.nodeVersion,
    operationId: 'f'.repeat(32), expiresAt: '2026-11-02T23:00:00.000Z' },
  intent: { schema: 'PHUB_CUP83_EXPORT_INTENT_V1', manifestSha256: '', operationId: 'f'.repeat(32),
    pid: identity.pid, bootId: identity.bootId, startTicks: identity.processStartTicks, at: '2026-11-02T22:00:00.000Z' },
  captured: { status: 'CAPTURED', artifactSha256: '', counts, at: '2026-11-02T22:00:01.000Z' },
  terminal: { status: 'SUCCESS', artifactSha256: '', inspectorClosed: true, soleClientProven: false,
    drainProven: false, at: '2026-11-02T22:00:02.000Z' },
  expected: { hashes: {}, identity: structuredClone(identity), source, targetFingerprint: 'b'.repeat(64) } };
}
function seal(f) {
  const operation = Buffer.from(JSON.stringify(f.operation, null, 2) + '\n'), raw = enc(f.raw);
  f.intent.manifestSha256 = hash(operation); f.captured.artifactSha256 = hash(raw); f.terminal.artifactSha256 = hash(raw);
  const inputs = { raw, operation, intent: enc(f.intent), captured: enc(f.captured), terminal: enc(f.terminal) };
  f.expected.hashes = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, hash(value)]));
  return { inputs, expected: f.expected };
}
const run = f => { const { inputs, expected } = seal(f); return normalizeCup83MaxSnapshot(inputs, expected); };
const reject = (mutate, code) => { const f = fixture(); mutate(f); assert.throws(() => run(f), new RegExp(code)); };

test('exact private bytes preserve every command and pass the existing compiled importer validator', () => {
  const f = fixture(), { inputs, expected } = seal(f), before = Buffer.from(inputs.raw);
  const result = normalizeCup83MaxSnapshot(inputs, expected);
  const manifest = JSON.parse(result.importManifest), snapshot = JSON.parse(result.snapshot), receipt = JSON.parse(result.receipt);
  assert.deepEqual(validateLegacyMaxSnapshot(result.snapshot, manifest), f.raw.rows.map(([, row]) => row));
  assert.deepEqual(snapshot.commands, f.raw.rows.map(([, row]) => row));
  assert.equal(snapshot.capturedAt, f.captured.at);
  assert.equal(snapshot.source.startTicks, '98765'); assert.notEqual(snapshot.source.startTicks, f.raw.identity.start);
  assert.deepEqual(JSON.parse(result.undefinedPaths).undefinedPaths, f.raw.undefinedPaths);
  assert.equal(Object.hasOwn(snapshot.commands[0].meta.nested, 'omitted'), false);
  assert.equal(snapshot.commands[2].status, 'SENT', 'snapshot evidence is preserved, never promoted to durable ACK');
  assert.equal(receipt.scope, 'MAP_ONLY'); assert.equal(receipt.capturedAtSemantics, 'CAPTURE_ACK_TIME');
  for (const key of ['soleClientProven', 'drainProven', 'durableInventoryIncluded', 'targetVerified', 'importAuthorized']) assert.equal(receipt[key], false);
  assert.equal(receipt.inputSha256.raw, hash(before)); assert.ok(inputs.raw.equals(before));
  assert.equal(receipt.outputSha256.snapshot, hash(result.snapshot));
});

test('UNKNOWN close remains diagnostic evidence, never closed, drained or import-authorized', () => {
  const f = fixture(); f.terminal = { status: 'UNKNOWN', signalAttempted: true, closeAttempted: true,
    artifactSha256: '', replayAllowed: false, at: '2026-11-02T22:01:00.000Z' };
  const result = run(f), receipt = JSON.parse(result.receipt);
  assert.equal(receipt.terminalStatus, 'UNKNOWN'); assert.equal(receipt.inspectorClosed, false);
  assert.equal(receipt.drainProven, false); assert.equal(receipt.importAuthorized, false);
  assert.deepEqual(validateLegacyMaxSnapshot(result.snapshot, JSON.parse(result.importManifest)), f.raw.rows.map(([, row]) => row));
});

test('zero MAX rows retain evidence without producing an import manifest or fabricated command', () => {
  const f = fixture(); Object.assign(f.raw, { maxCount: 0, rows: [], counts: {}, undefinedPaths: [] });
  f.captured.counts = Object.fromEntries(groups.map(key => [key, 0]));
  const result = run(f); assert.equal(result.snapshot, null); assert.equal(result.importManifest, null);
  assert.equal(JSON.parse(result.receipt).status, 'NO_IMPORTABLE_COMMANDS');
});

test('raw SHA, exact LF, UTF-8 and duplicate-key corruption are rejected before transformation', () => {
  const f = seal(fixture()); f.inputs.raw[0] = 0x5b;
  assert.throws(() => normalizeCup83MaxSnapshot(f.inputs, f.expected), /INPUT_BYTES_OR_HASH/);
  for (const change of [bytes => bytes.subarray(0, -1), bytes => Buffer.concat([bytes, Buffer.from('\n')]),
    bytes => Buffer.from(bytes.toString().replace('"maxCount":8', '"maxCount":8,"maxCount":8')),
    () => Buffer.from([0xff, 0xfe])]) {
    const pair = seal(fixture()); pair.inputs.raw = change(pair.inputs.raw); pair.expected.hashes.raw = hash(pair.inputs.raw);
    assert.throws(() => normalizeCup83MaxSnapshot(pair.inputs, pair.expected), /INPUT_SERIALIZATION|INPUT_JSON_UTF8/);
  }
});

test('source, process and receipt identities cannot be substituted', () => {
  for (const key of ['pid', 'bootId', 'processStartTicks', 'sourceEpoch', 'start', 'entrypoint', 'modulePath', 'nodeVersion']) {
    reject(f => { f.raw.identity[key] = key === 'pid' ? 456 : 'different'; }, 'CAPTURE_IDENTITY');
  }
  reject(f => { f.operation.sourceTree = 'c'.repeat(40); }, 'OPERATION_IDENTITY');
  reject(f => { f.operation.runtimeInventorySha256 = 'd'.repeat(64); }, 'SOURCE_IDENTITY');
  reject(f => { f.intent.operationId = 'e'.repeat(32); }, 'INTENT_BINDING');
  reject(f => { f.intent.pid++; }, 'INTENT_BINDING');
  reject(f => { f.expected.source.startTicks = f.raw.identity.start; }, 'SOURCE_IDENTITY');
  reject(f => { f.expected.targetFingerprint = 'bad'; }, 'TARGET_FINGERPRINT');
  reject(f => { f.intent.at = '2026-11-02T22:02:00.000Z'; }, 'CAPTURE_ORDER');
  reject(f => { f.captured.at = '2026-11-02'; }, 'TIMESTAMP_INVALID');
  for (const name of ['captured', 'terminal']) {
    const pair = seal(fixture()), value = JSON.parse(pair.inputs[name]); value.artifactSha256 = 'e'.repeat(64);
    pair.inputs[name] = enc(value); pair.expected.hashes[name] = hash(pair.inputs[name]);
    assert.throws(() => normalizeCup83MaxSnapshot(pair.inputs, pair.expected), /RECEIPT_BINDING|TERMINAL_BINDING/);
  }
});

test('counts, tuples, IDs, connector/status and existing custody markers fail closed', () => {
  reject(f => { f.raw.maxCount++; }, 'EXPORT_COUNT');
  reject(f => { f.raw.totalMapCount = 5001; }, 'EXPORT_COUNT');
  reject(f => { f.raw.rows[1] = structuredClone(f.raw.rows[0]); }, 'COMMAND_DUPLICATE');
  reject(f => { f.raw.rows[0].push('extra'); }, 'EXPORT_ROW');
  reject(f => { f.raw.rows[0][1].id = 'other'; }, 'COMMAND_INVALID');
  reject(f => { f.raw.rows[0][1].connector = 'TG_BOT'; }, 'COMMAND_INVALID');
  reject(f => { f.raw.rows[0][1].status = 'ACK'; }, 'COMMAND_INVALID');
  reject(f => { f.raw.rows[0][1].attempts = -1; }, 'COMMAND_INVALID');
  reject(f => { f.raw.counts.extra = 1; }, 'COUNTS_MISMATCH');
  reject(f => { f.captured.counts = {}; }, 'COUNTS_MISMATCH');
  for (const key of ['_id', 'leaseToken', 'lastReceipt', 'terminalReason']) {
    reject(f => { f.raw.rows[0][1][key] = null; }, 'COMMAND_CUSTODY_MARKER');
  }
  reject(f => { f.raw.rows[0][1].meta.legacyMaxRestartCustody = null; }, 'COMMAND_CUSTODY_MARKER');
});

test('undefined sidecar is checked through own properties without restoring values', () => {
  reject(f => { f.raw.undefinedPaths.push(structuredClone(f.raw.undefinedPaths[0])); }, 'UNDEFINED_PATH_DUPLICATE');
  reject(f => { f.raw.undefinedPaths[0].commandId = 'missing'; }, 'UNDEFINED_PATH_INVALID');
  reject(f => { f.raw.undefinedPaths[0].path = ['meta', 'absent', 'leaf']; }, 'UNDEFINED_PARENT_MISSING');
  reject(f => { f.raw.undefinedPaths[0].path = ['meta', 'nested', 'preserve']; }, 'UNDEFINED_VALUE_PRESENT');
  reject(f => { f.raw.rows[0][1].meta.nested = []; }, 'UNDEFINED_VALUE_PRESENT');
  reject(f => { f.raw.undefinedPaths[0].path = ['__proto__', 'leaf']; }, 'UNDEFINED_PARENT_MISSING');
  reject(f => { f.raw.undefinedPaths[0].path = Array(34).fill('a'); }, 'UNDEFINED_PATH_INVALID');
});

test('bounded payload/depth and forbidden terminal claims are not weakened', () => {
  const pair = seal(fixture()); pair.inputs.raw = Buffer.alloc(32 * 1024 * 1024 + 2, 32);
  pair.expected.hashes.raw = hash(pair.inputs.raw);
  assert.throws(() => normalizeCup83MaxSnapshot(pair.inputs, pair.expected), /INPUT_BYTES_OR_HASH/);
  reject(f => { let current = f.raw.rows[0][1].meta; for (let i = 0; i < 33; i++) current = current.deep = {}; }, 'COMMAND_DEPTH');
  reject(f => { f.terminal.drainProven = true; }, 'TERMINAL_CLAIM');
  reject(f => { f.terminal.soleClientProven = true; }, 'TERMINAL_CLAIM');
  reject(f => { f.terminal.importAuthorized = true; }, 'TERMINAL_SHAPE');
  reject(f => { f.raw.unexpected = true; }, 'EXPORT_SHAPE');
});

test('digest, ID and epoch formats reject terminal line separators even with matching trusted hashes', () => {
  for (const suffix of ['\n', '\r', '\u2028', '\u2029']) {
    reject(f => { f.expected.targetFingerprint += suffix; }, 'TARGET_FINGERPRINT');
    reject(f => { f.operation.runtimeInventorySha256 += suffix; f.expected.source.runtimeInventorySha256 += suffix; }, 'OPERATION_IDENTITY');
    reject(f => { f.raw.rows[0][0] += suffix; f.raw.rows[0][1].id += suffix; }, 'COMMAND_INVALID');
    reject(f => { f.raw.identity.start += suffix; f.expected.identity.start += suffix; }, 'PROCESS_IDENTITY');
    reject(f => { f.operation.operationId += suffix; f.intent.operationId += suffix; }, 'INTENT_BINDING');
    const pair = seal(fixture()); pair.expected.hashes.raw += suffix;
    assert.throws(() => normalizeCup83MaxSnapshot(pair.inputs, pair.expected), /INPUT_BYTES_OR_HASH/);
  }
});


function unionFixture() {
  const map = seal(fixture());
  const inventory = { schema: 'PHAB_CUP83_MAX_DURABLE_INVENTORY_V1', source: map.expected.source,
    targetFingerprint: 'c'.repeat(64), capturedAt: '2026-11-02T22:02:00.000Z',
    commands: [{ ...JSON.parse(map.inputs.raw).rows[0][1], _id: 'synthetic-mongo-id', status: 'SENT' },
      { ...JSON.parse(map.inputs.raw).rows[0][1], id: 'durable-only', status: 'LEASED' }] };
  return { map, inventory };
}
function unionRun(f) {
  const bytes = enc(f.inventory);
  return buildCup83MaxRestartUnion(f.map.inputs, f.map.expected, [bytes], {
    mapContextSha256: hash(enc(f.map.expected)),
    inventories: [{ sha256: hash(bytes), targetFingerprint: f.inventory.targetFingerprint }] });
}
test('restart union retains Map and durable-only IDs, transition disagreements and private provenance', () => {
  const f = unionFixture(), before = structuredClone(f.inventory), result = unionRun(f);
  const commands = result.batches.flatMap(b => validateLegacyMaxSnapshot(b.snapshot, JSON.parse(b.importManifest)));
  assert.equal(commands.length, 9); assert.equal(commands.find(r => r.id === 'synthetic-0').status, 'PENDING');
  assert.equal(commands.find(r => r.id === 'durable-only').status, 'LEASED');
  assert.ok(commands.every(r => !Object.hasOwn(r, '_id')));
  assert.deepEqual(f.inventory, before);
  const provenance = JSON.parse(result.provenance);
  assert.equal(provenance.membership.find(r => r.id === 'synthetic-0').origins.length, 2);
  assert.equal(provenance.inventories[0].sha256, hash(enc(f.inventory)));
  const receipt = JSON.parse(result.receipt);
  for (const key of ['finalFreezeProven','namespaceCompletenessProven','targetVerified','providerDeliveryProven','importAuthorized']) assert.equal(receipt[key], false);
  assert.equal(receipt.oldNamespacesMustBeRetained, true);
});
test('union rejects conflicting payload or connector, duplicate durable IDs and receipt markers', () => {
  for (const mutate of [f => { f.inventory.commands[0].text = 'different'; },
    f => { f.inventory.commands[0].connector = 'MAX_ACADEMY_BOT'; },
    f => { f.inventory.commands.push(f.inventory.commands[0]); },
    f => { f.inventory.commands[0].leaseToken = 'receipt-v1'; }]) {
    const f = unionFixture(); mutate(f); assert.throws(() => unionRun(f), /UNION_COMMAND_CONFLICT|UNION_DURABLE_DUPLICATE|COMMAND_CUSTODY_MARKER/);
  }
});
test('union pins source, times, namespace isolation and complete byte sets', () => {
  for (const mutate of [f => { f.inventory.source = { ...f.inventory.source, pid: 999 }; },
    f => { f.inventory.capturedAt = '2026-11-02T21:00:00.000Z'; },
    f => { f.inventory.targetFingerprint = f.map.expected.targetFingerprint; }]) {
    const f = unionFixture(); mutate(f); assert.throws(() => unionRun(f), /UNION_INVENTORY_IDENTITY|UNION_NAMESPACE/);
  }
  const f = unionFixture(), bytes = enc(f.inventory);
  const expected = { mapContextSha256: hash(enc(f.map.expected)), inventories: [{ sha256: hash(bytes), targetFingerprint: f.inventory.targetFingerprint }] };
  assert.throws(() => buildCup83MaxRestartUnion(f.map.inputs, f.map.expected, [], expected), /UNION_INVENTORIES/);
  assert.throws(() => buildCup83MaxRestartUnion(f.map.inputs, f.map.expected, [Buffer.from('tampered')], expected), /INPUT_BYTES_OR_HASH/);
  assert.throws(() => buildCup83MaxRestartUnion(f.map.inputs, f.map.expected, [bytes], { ...expected, mapContextSha256: 'e'.repeat(64) }), /UNION_MAP_CONTEXT/);
});
test('union creates deterministic disjoint importer-compatible batches beyond5000 without truncation', () => {
  const f = unionFixture(), template = f.inventory.commands[1];
  f.inventory.commands = Array.from({ length: 5001 }, (_, i) => ({ ...template, id: 'durable-' + String(i).padStart(5, '0') }));
  const result = unionRun(f), again = unionRun(f);
  assert.equal(result.batches.length, 2);
  const commands = result.batches.flatMap(b => validateLegacyMaxSnapshot(b.snapshot, JSON.parse(b.importManifest)));
  assert.equal(commands.length, 5009); assert.equal(new Set(commands.map(r => r.id)).size, 5009);
  assert.deepEqual(result, again);
});

function multipleMaps() {
  const f = unionFixture(), later = fixture();
  later.captured.at = '2026-11-02T22:01:01.000Z';
  later.terminal.at = '2026-11-02T22:01:02.000Z';
  later.raw.rows[1] = ['accepted-during-drain', { ...later.raw.rows[1][1], id: 'accepted-during-drain' }];
  const additional = seal(later);
  const run = () => {
    const bytes = enc(f.inventory);
    return buildCup83MaxRestartUnion(f.map.inputs, f.map.expected, [bytes], {
      mapContextSha256: hash(enc(f.map.expected)),
      additionalMapContextSha256: [hash(enc(additional.expected))],
      inventories: [{ sha256: hash(bytes), targetFingerprint: f.inventory.targetFingerprint }],
    }, [additional]);
  };
  return { f, later, additional, run };
}
test('pre-drain and final Maps retain disappeared and newly accepted IDs with separate hash-bound provenance', () => {
  const f = multipleMaps(), result = f.run();
  const commands = result.batches.flatMap(b => validateLegacyMaxSnapshot(b.snapshot, JSON.parse(b.importManifest)));
  assert.equal(commands.length, 10);
  for (const id of ['synthetic-1', 'accepted-during-drain', 'durable-only']) assert.ok(commands.some(c => c.id === id));
  const provenance = JSON.parse(result.provenance), receipt = JSON.parse(result.receipt);
  assert.equal(receipt.schema, 'PHAB_CUP83_MAX_RESTART_UNION_V2');
  assert.equal(receipt.mapCount, 2); assert.equal(receipt.finalFreezeProven, false);
  assert.deepEqual(provenance.additionalMapEvidence[0].inputSha256, f.additional.expected.hashes);
  assert.deepEqual(provenance.additionalMapEvidence[0].undefinedPaths.undefinedPaths, f.later.raw.undefinedPaths);
  assert.deepEqual(provenance.membership.find(c => c.id === 'accepted-during-drain').origins, [{ kind: 'MAP', map: 1, index: 1 }]);
  assert.deepEqual(result, f.run());
});
test('additional Maps reject foreign identity, target, payload conflict, byte tampering and inverted capture order', () => {
  for (const mutate of [
    f => { f.additional.expected.source = { ...f.additional.expected.source, pid: 999 }; },
    f => { f.additional.expected.targetFingerprint = 'e'.repeat(64); },
    f => { f.additional.inputs.raw = Buffer.from('tampered'); },
    f => { f.later.raw.rows[0][1].text = 'conflict'; Object.assign(f.additional, seal(f.later)); },
    f => { f.later.intent.at = '2026-11-02T21:00:00.000Z'; f.later.captured.at = '2026-11-02T21:00:01.000Z'; f.later.terminal.at = '2026-11-02T21:00:02.000Z'; Object.assign(f.additional, seal(f.later)); },
    f => { f.f.inventory.capturedAt = '2026-11-02T22:00:30.000Z'; },
  ]) {
    const f = multipleMaps(); mutate(f);
    assert.throws(() => f.run(), /UNION_MAP_CONTEXT|INPUT_BYTES_OR_HASH|UNION_COMMAND_CONFLICT|UNION_MAP_ORDER|UNION_INVENTORY_IDENTITY/);
  }
});
test('multi-Map entry remains bounded and requires exact complete additional context pins', () => {
  const f = multipleMaps(), bytes = enc(f.f.inventory), base = {
    mapContextSha256: hash(enc(f.f.map.expected)),
    inventories: [{ sha256: hash(bytes), targetFingerprint: f.f.inventory.targetFingerprint }],
  };
  assert.throws(() => buildCup83MaxRestartUnion(f.f.map.inputs, f.f.map.expected, [bytes], base, [f.additional]), /UNION_EXPECTED/);
  assert.throws(() => buildCup83MaxRestartUnion(f.f.map.inputs, f.f.map.expected, [bytes], { ...base, additionalMapContextSha256: [] }, [f.additional]), /UNION_MAP_CONTEXT/);
  assert.throws(() => buildCup83MaxRestartUnion(f.f.map.inputs, f.f.map.expected, [bytes], base, [f.additional, f.additional, f.additional]), /UNION_MAP_COUNT/);
});

function fencedFixture(t) {
  class Support {
    isPersistenceSyncInProgress = false;
    persistenceSyncIntervalMs = 100;
    clients = new Map([['client', { id: 'client', meta: { absent: undefined } }]]);
    dialogs = new Map([['dialog', { id: 'dialog', clientId: 'client', connectors: ['LK_WEB_MESSENGER'], accessStationIds: ['station'] }]]);
    messages = new Map([['dialog', [
      { id: 'message', clientId: 'client', dialogId: 'dialog', connector: 'LK_WEB_MESSENGER', direction: 'OUTBOUND', senderRole: 'STAFF', kind: 'TEXT' },
      { id: 'system', clientId: 'client', dialogId: 'dialog', connector: 'LK_WEB_MESSENGER', direction: 'SYSTEM', senderRole: 'SYSTEM', kind: 'SYSTEM' },
    ]]]);
    outbox = new Map([
      ['pre-only', { id: 'pre-only', clientId: 'client', dialogId: 'dialog', connector: 'MAX_BOT', status: 'LEASED', attempts: 1,
        text: 'synthetic private MAX', meta: { absent: undefined } }],
      ['max-sent', { id: 'max-sent', clientId: 'client', dialogId: 'dialog', connector: 'MAX_ACADEMY_BOT', status: 'SENT', attempts: 0, text: 'synthetic private MAX' }],
      ['web', { id: 'web', clientId: 'client', dialogId: 'dialog', connector: 'LK_WEB_MESSENGER', status: 'PENDING', text: 'synthetic private web' }],
    ]);
  }
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'cup83-fenced-normalization-test-'));
  fs.chmodSync(directory, 0o700); t.after(() => fs.rmSync(directory, { recursive: true }));
  const identity = { pid: process.pid, start: String(performance.timeOrigin), sourceEpoch: '83b1c17bc4c5edaec65387b25b5695e48337c3cf', nodeVersion: process.version };
  const support = new Support(), receipt = captureAndFenceCup83Support.call([support], identity, Support.prototype, directory);
  const inputs = { raw: fs.readFileSync(directory + '/pre-drain-map.json'), web: fs.readFileSync(directory + '/pre-drain-web.json'),
    fence: fs.readFileSync(directory + '/pre-drain-fence.json') };
  const source = { pid: identity.pid, bootId: '11111111-1111-4111-8111-111111111111', startTicks: '98765',
    sourceCommit: identity.sourceEpoch, sourceTree: 'cfffdce4d5c69f0da7c50fbc90527bf00894d0fa', runtimeInventorySha256: 'a'.repeat(64) };
  const f = { directory, support, inputs, raw: JSON.parse(inputs.raw), web: JSON.parse(inputs.web), fence: receipt,
    expected: { hashes: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, hash(v)])), identity, source,
      targetFingerprint: 'b'.repeat(64), fencedAt: receipt.at } };
  f.reseal = (rebind = true) => {
    f.inputs.raw = enc(f.raw); f.inputs.web = enc(f.web);
    if (rebind) { f.fence.artifactSha256 = hash(f.inputs.raw); f.fence.webArtifactSha256 = hash(f.inputs.web); }
    f.inputs.fence = enc(f.fence);
    f.expected.hashes = Object.fromEntries(Object.entries(f.inputs).map(([k, v]) => [k, hash(v)]));
  };
  f.durable = () => ({ schema: 'PHAB_CUP83_MAX_DURABLE_INVENTORY_V1', source: f.expected.source, targetFingerprint: 'd'.repeat(64),
    capturedAt: new Date(Date.parse(f.expected.fencedAt) + 1000).toISOString(),
    commands: [{ ...f.raw.rows[1][1], id: 'durable-only' }] });
  f.union = (value = f.durable(), additional = []) => {
    const inventory = enc(value);
    return buildCup83FencedMaxRestartUnion(f.inputs, f.expected, [inventory], { mapContextSha256: hash(enc(f.expected)),
      inventories: [{ sha256: hash(inventory), targetFingerprint: value.targetFingerprint }],
      ...(additional.length ? { laterMapContextSha256: additional.map(b => hash(enc(b.expected))) } : {}) }, { laterMaps: additional });
  };
  return f;
}

test('actual primitive three private artifacts normalize and join durable known IDs through unchanged importer validator', t => {
  const f = fencedFixture(t), original = Object.fromEntries(Object.entries(f.inputs).map(([k, v]) => [k, Buffer.from(v)]));
  const result = normalizeCup83PreDrainFence(f.inputs, f.expected), receipt = JSON.parse(result.receipt);
  assert.deepEqual(validateLegacyMaxSnapshot(result.snapshot, JSON.parse(result.importManifest)), f.raw.rows.map(([, row]) => row));
  assert.equal(JSON.parse(result.snapshot).capturedAt, f.fence.at); assert.equal(receipt.capturedAtSemantics, 'FENCE_RECEIPT_TIME');
  assert.equal(receipt.schema, 'PHAB_CUP83_PRE_DRAIN_NORMALIZATION_V1'); assert.equal(receipt.webArtifactSha256, hash(f.inputs.web));
  assert.equal(receipt.fullSourceBinding, 'INDEPENDENT_CALLER_PIN');
  assert.deepEqual(receipt.primitiveVerifiedIdentityFields, ['pid', 'start', 'nodeVersion', 'sourceEpoch']);
  for (const flag of ['sourceAttestationProven', 'inspectorClosedProven', 'soleClientProven', 'drainProven', 'durableInventoryIncluded', 'targetVerified', 'restartAuthorized', 'importAuthorized']) assert.equal(receipt[flag], false);
  for (const field of ['operation', 'intent', 'terminalStatus', 'inspectorClosed']) assert.equal(Object.hasOwn(receipt, field), false);
  const sidecar = JSON.parse(result.undefinedPaths);
  assert.deepEqual(sidecar.undefinedPaths, f.raw.undefinedPaths); assert.deepEqual(sidecar.webUndefinedPaths, f.web.undefinedPaths);
  assert.equal(sidecar.webSha256, hash(f.inputs.web));
  assert.equal(Object.hasOwn(JSON.parse(result.snapshot).commands.find(row => row.id === 'pre-only').meta, 'absent'), false);
  const union = f.union(), commands = union.batches.flatMap(b => validateLegacyMaxSnapshot(b.snapshot, JSON.parse(b.importManifest)));
  assert.equal(commands.length, 3); assert.ok(commands.some(c => c.id === 'pre-only' && c.status === 'LEASED'));
  assert.ok(commands.some(c => c.id === 'durable-only')); assert.equal(commands.some(c => c.connector === 'LK_WEB_MESSENGER'), false);
  const provenance = JSON.parse(union.provenance), unionReceipt = JSON.parse(union.receipt);
  assert.equal(provenance.schema, 'PHAB_CUP83_FENCED_MAX_UNION_PROVENANCE_V1');
  assert.deepEqual(provenance.primaryFenceEvidence.normalizationReceipt, receipt);
  assert.deepEqual(provenance.primaryFenceEvidence.undefinedPaths, sidecar);
  assert.equal(unionReceipt.schema, 'PHAB_CUP83_FENCED_MAX_RESTART_UNION_V1');
  assert.equal(unionReceipt.webArtifactSha256, hash(f.inputs.web)); assert.equal(unionReceipt.restartAuthorized, false);
  assert.equal(unionReceipt.importAuthorized, false); assert.equal(unionReceipt.sourceAttestationProven, false);
  for (const [key, value] of Object.entries(original)) assert.ok(f.inputs[key].equals(value));
});

test('zero MAX capture retains actual web/fence evidence without fabricating commands', t => {
  const f = fencedFixture(t); f.raw.rows = []; f.raw.maxCount = 0; f.raw.counts = {}; f.raw.undefinedPaths = [];
  f.fence.maxCount = 0; f.fence.counts = {}; f.reseal();
  const result = normalizeCup83PreDrainFence(f.inputs, f.expected);
  assert.equal(result.snapshot, null); assert.equal(result.importManifest, null);
  assert.equal(JSON.parse(result.receipt).status, 'NO_IMPORTABLE_COMMANDS');
  assert.equal(JSON.parse(result.receipt).webArtifactSha256, hash(f.inputs.web));
});

test('missing, partial and hash-drifted real private artifacts refuse before normalization', t => {
  for (const key of ['raw', 'web', 'fence']) {
    const f = fencedFixture(t), missing = { ...f.inputs }; delete missing[key];
    assert.throws(() => normalizeCup83PreDrainFence(missing, f.expected), /FENCE_INPUT_SET/);
    const file = { raw: 'pre-drain-map.json', web: 'pre-drain-web.json', fence: 'pre-drain-fence.json' }[key];
    fs.truncateSync(f.directory + '/' + file, 0); f.inputs[key] = fs.readFileSync(f.directory + '/' + file);
    assert.throws(() => normalizeCup83PreDrainFence(f.inputs, f.expected), /INPUT_BYTES_OR_HASH/);
    f.expected.hashes[key] = hash(f.inputs[key]);
    assert.throws(() => normalizeCup83PreDrainFence(f.inputs, f.expected), /INPUT_JSON_UTF8/);
  }
});

test('incomplete fence, missing web linkage and false authority flags fail closed with repinned bytes', t => {
  for (const mutate of [
    f => f.fence.status = 'CAPTURED', f => f.fence.drainProven = true, f => f.fence.replayAllowed = true,
    f => delete f.fence.webArtifactSha256, f => f.fence.webArtifactSha256 = '0'.repeat(64),
  ]) {
    const f = fencedFixture(t); mutate(f); f.reseal(false);
    assert.throws(() => normalizeCup83PreDrainFence(f.inputs, f.expected), /FENCE_RECEIPT/);
  }
});

test('process/source/time drift refuse; four primitive fields never attest independently pinned Linux metadata', t => {
  for (const mutate of [
    f => f.raw.identity.pid++, f => f.web.identity.start = '1', f => f.expected.source.pid++,
    f => f.expected.source.sourceTree = '0'.repeat(40), f => f.expected.source.runtimeInventorySha256 = 'invalid',
    f => f.fence.at = new Date(Date.parse(f.fence.at) + 1000).toISOString(), f => f.fence.at = '2026-11-04',
  ]) {
    const f = fencedFixture(t); mutate(f); f.reseal();
    assert.throws(() => normalizeCup83PreDrainFence(f.inputs, f.expected), /FENCE_CAPTURE_IDENTITY|FENCE_WEB_BINDING|FENCE_SOURCE_BINDING|FENCE_TIME_BINDING|TIMESTAMP_INVALID/);
  }
  const f = fencedFixture(t); f.expected.source.bootId = '22222222-2222-4222-8222-222222222222';
  const receipt = JSON.parse(normalizeCup83PreDrainFence(f.inputs, f.expected).receipt);
  assert.equal(receipt.sourceAttestationProven, false); assert.equal(receipt.fullSourceBinding, 'INDEPENDENT_CALLER_PIN');
});

test('malformed MAX rows/counts/sidecars and dropped web references/domains/sidecars refuse', t => {
  for (const mutate of [
    f => f.raw.rows[0][1].attempts = -1, f => f.raw.rows[0][0] = 'wrong',
    f => f.raw.rows[0][1].leaseToken = 'forbidden', f => f.raw.undefinedPaths[0].path = ['id'],
    f => f.fence.maxCount++, f => f.fence.counts = Object.fromEntries(groups.map(key => [key, f.fence.counts[key] ?? 0])),
    f => f.fence.webCounts.clients++, f => f.web.rows.dialogs = [],
    f => { Object.assign(f.web.rows.serviceMessages[0][1], { kind: 'TEXT', direction: 'INBOUND', senderRole: 'CLIENT' }); },
    f => f.web.undefinedPaths[0].path = ['id'], f => f.web.durableCompletenessProven = true,
  ]) {
    const f = fencedFixture(t); mutate(f); f.reseal();
    assert.throws(() => normalizeCup83PreDrainFence(f.inputs, f.expected), /COMMAND_|UNDEFINED_|COUNTS_MISMATCH|FENCE_EXPORT_COUNT|FENCE_WEB_/);
  }
});

test('fenced union rejects earlier durable evidence and additional diagnostic source/process drift', t => {
  const f = fencedFixture(t), durable = f.durable(); durable.capturedAt = new Date(Date.parse(f.fence.at) - 1).toISOString();
  assert.throws(() => f.union(durable), /UNION_INVENTORY_IDENTITY/);
  const foreign = seal(fixture()); assert.throws(() => f.union(f.durable(), [foreign]), /UNION_MAP_CONTEXT/);
});

test('pre-drain MAX and web share the original32MiB byte limit', t => {
  const f = fencedFixture(t);
  assert.throws(() => normalizeCup83PreDrainFence({ raw: Buffer.alloc(17 * 1024 * 1024), web: Buffer.alloc(17 * 1024 * 1024),
    fence: f.inputs.fence }, f.expected), /FENCE_CAPTURE_BYTES/);
});

test('historical prior diagnostic + fence + final diagnostic retains every phase known ID without changing old paths', () => {
  // Pure historical format fixture; the preceding integration executes the actual
  // primitive on the current Node without spoofing its identity or fabricating journals.
  const diagnostic = fixture(), fullSource = diagnostic.expected.source;
  const raw = structuredClone(diagnostic.raw); raw.rows.push(['pre-only', { ...raw.rows[0][1], id: 'pre-only' }]);
  raw.maxCount++; raw.totalMapCount++; raw.counts['MAX_BOT:PENDING']++;
  const web = { schema: 'PHAB_CUP83_WEB_CUSTODY_V1', identity: raw.identity,
    rows: { commands: [], messages: [], serviceMessages: [], dialogs: [], clients: [] },
    counts: { commands: 0, messages: 0, serviceMessages: 0, dialogs: 0, clients: 0 }, undefinedPaths: [], durableCompletenessProven: false };
  const inputs = { raw: enc(raw), web: enc(web) };
  const at = '2026-11-02T21:59:59.000Z';
  inputs.fence = enc({ schema: 'PHAB_CUP83_PRE_DRAIN_FENCE_V1', status: 'SUPPORT_TIMERS_FENCED',
    artifactSha256: hash(inputs.raw), webArtifactSha256: hash(inputs.web), webCounts: web.counts,
    totalMapCount: raw.totalMapCount, maxCount: raw.maxCount, counts: raw.counts, at, drainProven: false, replayAllowed: false });
  const expected = { hashes: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, hash(v)])), identity: raw.identity,
    source: fullSource, targetFingerprint: diagnostic.expected.targetFingerprint, fencedAt: at };
  diagnostic.raw.rows[1] = ['final-only', { ...diagnostic.raw.rows[1][1], id: 'final-only' }];
  const final = seal(diagnostic), durable = enc({ schema: 'PHAB_CUP83_MAX_DURABLE_INVENTORY_V1', source: fullSource,
    targetFingerprint: 'd'.repeat(64), capturedAt: '2026-11-02T22:00:03.000Z', commands: [] });
  const earlier = fixture(); earlier.raw.rows[0] = ['prior-only', { ...earlier.raw.rows[0][1], id: 'prior-only' }];
  earlier.raw.undefinedPaths[0].commandId = 'prior-only';
  earlier.intent.at = '2026-11-02T21:59:49.000Z'; earlier.captured.at = '2026-11-02T21:59:50.000Z'; earlier.terminal.at = '2026-11-02T21:59:51.000Z';
  const prior = seal(earlier);
  const run = (priorMaps = [prior], laterMaps = [final]) => buildCup83FencedMaxRestartUnion(inputs, expected, [durable], {
    mapContextSha256: hash(enc(expected)), ...(priorMaps.length ? { priorMapContextSha256: priorMaps.map(b => hash(enc(b.expected))) } : {}),
    ...(laterMaps.length ? { laterMapContextSha256: laterMaps.map(b => hash(enc(b.expected))) } : {}),
    inventories: [{ sha256: hash(durable), targetFingerprint: 'd'.repeat(64) }] }, { priorMaps, laterMaps });
  const result = run();
  const commands = result.batches.flatMap(b => validateLegacyMaxSnapshot(b.snapshot, JSON.parse(b.importManifest)));
  assert.equal(commands.length, 11); for (const id of ['prior-only', 'pre-only', 'synthetic-1', 'final-only']) assert.ok(commands.some(c => c.id === id));
  assert.equal(JSON.parse(result.receipt).lastMapCapturedAt, diagnostic.captured.at);
  assert.equal(JSON.parse(result.receipt).mapCount, 3); assert.equal(JSON.parse(result.receipt).priorMapCount, 1);
  assert.deepEqual(JSON.parse(result.provenance).priorMapEvidence[0].inputSha256, prior.expected.hashes);
  assert.deepEqual(JSON.parse(result.provenance).membership.find(row => row.id === 'prior-only').origins,
    [{ kind: 'MAP', phase: 'PRIOR', map: 1, index: 0 }]);
  assert.equal(JSON.parse(result.provenance).laterMapEvidence[0].normalizationReceipt.schema, 'PHAB_CUP83_SNAPSHOT_NORMALIZATION_V1');
  assert.equal(JSON.parse(result.provenance).primaryFenceEvidence.normalizationReceipt.sourceAttestationProven, false);
  assert.throws(() => run([final], []), /UNION_PRIOR_MAP_ORDER/);
  assert.throws(() => run([], [prior]), /UNION_MAP_ORDER/);
  assert.throws(() => run([prior, prior], [final]), /UNION_MAP_COUNT/);
  const newerPrior = fixture(); newerPrior.intent.at = '2026-11-02T21:59:54.000Z';
  newerPrior.captured.at = '2026-11-02T21:59:55.000Z'; newerPrior.terminal.at = '2026-11-02T21:59:56.000Z';
  assert.throws(() => run([seal(newerPrior), prior], []), /UNION_PRIOR_MAP_ORDER/);
  const badPin = { mapContextSha256: hash(enc(expected)), priorMapContextSha256: ['0'.repeat(64)],
    inventories: [{ sha256: hash(durable), targetFingerprint: 'd'.repeat(64) }] };
  assert.throws(() => buildCup83FencedMaxRestartUnion(inputs, expected, [durable], badPin, { priorMaps: [prior] }), /UNION_MAP_CONTEXT/);
});
