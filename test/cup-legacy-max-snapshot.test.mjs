import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { normalizeCup83MaxSnapshot, buildCup83MaxRestartUnion } from '../scripts/lib/cup-legacy-max-snapshot.mjs';

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
