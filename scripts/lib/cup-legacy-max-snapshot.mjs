// Offline normalization only. No filesystem, environment, application, DB or provider access.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const LIMIT = 32 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
// JavaScript $ also matches before a final line terminator; require the whole value.
const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const TREE = 'cfffdce4d5c69f0da7c50fbc90527bf00894d0fa';
const CONNECTORS = ['MAX_BOT', 'MAX_ACADEMY_BOT'];
const STATES = ['PENDING', 'LEASED', 'SENT', 'FAILED'];
const groups = CONNECTORS.flatMap(connector => STATES.map(state => connector + ':' + state));
const need = (ok, code) => { if (!ok) throw Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value) + '\n');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys, code) => need(object(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), code);
const timestamp = value => {
  need(typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value, 'TIMESTAMP_INVALID');
  return Date.parse(value);
};
function parse(bytes, digest, bound, pretty = false) {
  need(Buffer.isBuffer(bytes) && bytes.length <= bound && matches(digest, SHA)
    && hash(bytes) === digest, 'INPUT_BYTES_OR_HASH');
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(text); }
  catch { throw Error('INPUT_JSON_UTF8'); }
  // Journals/export are compact; the owner operation manifest may use two-space indentation.
  // Both representations reject duplicate keys, extra newlines and alternate numeric encodings.
  need(encoded(value).equals(bytes) || pretty && Buffer.from(JSON.stringify(value, null, 2) + '\n').equals(bytes), 'INPUT_SERIALIZATION');
  return value;
}
function data(value, depth = 0) {
  need(depth <= 32, 'COMMAND_DEPTH');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value), 'COMMAND_NUMBER'); return; }
  need(object(value) || Array.isArray(value), 'COMMAND_DATA');
  for (const child of Object.values(value)) data(child, depth + 1);
}
function command(row, key) {
  need(object(row) && typeof key === 'string' && matches(key, /^[A-Za-z0-9._:-]{1,200}$/)
    && row.id === key && CONNECTORS.includes(row.connector) && STATES.includes(row.status)
    && ['dialogId', 'clientId', 'text'].every(name => typeof row[name] === 'string')
    && Number.isSafeInteger(row.attempts) && row.attempts >= 0, 'COMMAND_INVALID');
  need(!['_id', 'leaseToken', 'lastReceipt', 'terminalReason'].some(name => own(row, name))
    && !own(row.meta ?? {}, 'legacyMaxRestartCustody'), 'COMMAND_CUSTODY_MARKER');
  data(row);
}
function sidecar(paths, byId) {
  need(Array.isArray(paths), 'UNDEFINED_PATHS_INVALID');
  const seen = new Set();
  for (const entry of paths) {
    exact(entry, ['commandId', 'path'], 'UNDEFINED_PATH_SHAPE');
    need(byId.has(entry.commandId) && Array.isArray(entry.path) && entry.path.length >= 1
      && entry.path.length <= 33 && entry.path.every(key => typeof key === 'string'), 'UNDEFINED_PATH_INVALID');
    const id = JSON.stringify([entry.commandId, entry.path]);
    need(!seen.has(id), 'UNDEFINED_PATH_DUPLICATE'); seen.add(id);
    let parent = byId.get(entry.commandId);
    for (const key of entry.path.slice(0, -1)) {
      need((object(parent) || Array.isArray(parent)) && own(parent, key), 'UNDEFINED_PARENT_MISSING');
      parent = parent[key];
    }
    need(object(parent) && !own(parent, entry.path.at(-1)), 'UNDEFINED_VALUE_PRESENT');
  }
}

/** `expected` must be owner-pinned independently of these untrusted input bytes.
 * Results are private draft artifacts, never a command to invoke the importer. */
export function normalizeCup83MaxSnapshot(inputs, expected) {
  const names = ['raw', 'operation', 'intent', 'captured', 'terminal'];
  exact(inputs, names, 'INPUT_SET');
  exact(expected, ['hashes', 'identity', 'source', 'targetFingerprint'], 'EXPECTED_SHAPE');
  exact(expected.hashes, names, 'EXPECTED_HASHES');
  exact(expected.source, ['pid', 'bootId', 'startTicks', 'sourceCommit', 'sourceTree', 'runtimeInventorySha256'], 'EXPECTED_SOURCE');
  exact(expected.identity, ['pid', 'start', 'bootId', 'sourceEpoch', 'modulePath', 'entrypoint', 'nodeVersion', 'processStartTicks'], 'EXPECTED_IDENTITY');
  need(typeof expected.targetFingerprint === 'string' && matches(expected.targetFingerprint, SHA), 'TARGET_FINGERPRINT');
  const raw = parse(inputs.raw, expected.hashes.raw, LIMIT + 1);
  const operation = parse(inputs.operation, expected.hashes.operation, 64 * 1024, true);
  const intent = parse(inputs.intent, expected.hashes.intent, 4096);
  const captured = parse(inputs.captured, expected.hashes.captured, 4096);
  const terminal = parse(inputs.terminal, expected.hashes.terminal, 4096);
  exact(raw, ['schema', 'identity', 'totalMapCount', 'maxCount', 'counts', 'rows', 'undefinedPaths'], 'EXPORT_SHAPE');
  need(raw.schema === 'SYNTHETIC_MAX_MAP_EXPORT_V1', 'EXPORT_SCHEMA');
  need(isDeepStrictEqual(raw.identity, expected.identity), 'CAPTURE_IDENTITY');
  const id = raw.identity, source = expected.source;
  need(Number.isSafeInteger(id.pid) && id.pid > 0
    && typeof id.start === 'string' && matches(id.start, /^[0-9]+(?:\.[0-9]+)?$/)
    && typeof id.bootId === 'string' && matches(id.bootId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
    && typeof id.processStartTicks === 'string' && matches(id.processStartTicks, /^[1-9][0-9]{0,30}$/)
    && [id.modulePath, id.entrypoint].every(path => typeof path === 'string' && path.startsWith('/')
      && !path.split('/').some(part => part === '.' || part === '..')), 'PROCESS_IDENTITY');
  need(operation.schema === 'PHUB_CUP83_MAX_DIAGNOSTIC_OPERATION_V1'
    && operation.target === 'lk-primary-147' && operation.sourceSha === SOURCE && operation.sourceTree === TREE
    && operation.pid === id.pid && operation.bootId === id.bootId && operation.processStartTicks === id.processStartTicks
    && operation.sourceSha === id.sourceEpoch && operation.modulePath === id.modulePath
    && operation.entrypoint === id.entrypoint && operation.nodeVersion === id.nodeVersion
    && id.nodeVersion === 'v22.13.1' && typeof operation.runtimeInventorySha256 === 'string'
    && matches(operation.runtimeInventorySha256, SHA), 'OPERATION_IDENTITY');
  need(isDeepStrictEqual(source, { pid: id.pid, bootId: id.bootId, startTicks: id.processStartTicks,
    sourceCommit: operation.sourceSha, sourceTree: operation.sourceTree,
    runtimeInventorySha256: operation.runtimeInventorySha256 }), 'SOURCE_IDENTITY');
  exact(intent, ['schema', 'manifestSha256', 'operationId', 'pid', 'bootId', 'startTicks', 'at'], 'INTENT_SHAPE');
  need(intent.schema === 'PHUB_CUP83_EXPORT_INTENT_V1' && intent.manifestSha256 === expected.hashes.operation
    && typeof operation.operationId === 'string' && matches(operation.operationId, /^[a-f0-9]{32}$/)
    && intent.operationId === operation.operationId && intent.pid === id.pid && intent.bootId === id.bootId
    && intent.startTicks === id.processStartTicks, 'INTENT_BINDING');
  exact(captured, ['status', 'artifactSha256', 'counts', 'at'], 'CAPTURE_RECEIPT_SHAPE');
  need(captured.status === 'CAPTURED' && captured.artifactSha256 === expected.hashes.raw, 'CAPTURE_RECEIPT_BINDING');
  need(Number.isSafeInteger(raw.maxCount) && Number.isSafeInteger(raw.totalMapCount)
    && raw.maxCount >= 0 && raw.maxCount <= raw.totalMapCount && raw.totalMapCount <= 5000
    && Array.isArray(raw.rows) && raw.rows.length === raw.maxCount, 'EXPORT_COUNT');
  const counts = Object.fromEntries(groups.map(key => [key, 0])), byId = new Map();
  for (const pair of raw.rows) {
    need(Array.isArray(pair) && pair.length === 2, 'EXPORT_ROW');
    command(pair[1], pair[0]);
    need(!byId.has(pair[0]), 'COMMAND_DUPLICATE'); byId.set(pair[0], pair[1]);
    counts[pair[1].connector + ':' + pair[1].status]++;
  }
  const sparse = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
  need(isDeepStrictEqual(raw.counts, sparse) && isDeepStrictEqual(captured.counts, counts), 'COUNTS_MISMATCH');
  sidecar(raw.undefinedPaths, byId);
  if (terminal.status === 'SUCCESS') {
    exact(terminal, ['status', 'artifactSha256', 'inspectorClosed', 'soleClientProven', 'drainProven', 'at'], 'TERMINAL_SHAPE');
    need(terminal.inspectorClosed === true && terminal.soleClientProven === false
      && terminal.drainProven === false, 'TERMINAL_CLAIM');
  } else {
    exact(terminal, ['status', 'signalAttempted', 'closeAttempted', 'artifactSha256', 'replayAllowed', 'at'], 'TERMINAL_SHAPE');
    need(terminal.status === 'UNKNOWN' && terminal.signalAttempted === true
      && typeof terminal.closeAttempted === 'boolean' && terminal.replayAllowed === false, 'TERMINAL_CLAIM');
  }
  need(terminal.artifactSha256 === expected.hashes.raw, 'TERMINAL_BINDING');
  need(timestamp(intent.at) <= timestamp(captured.at) && timestamp(captured.at) <= timestamp(terminal.at), 'CAPTURE_ORDER');
  const undefinedPaths = encoded({ schema: 'PHAB_CUP83_UNDEFINED_PATHS_V1', rawSha256: expected.hashes.raw,
    undefinedPaths: raw.undefinedPaths });
  const snapshot = raw.maxCount ? encoded({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1',
    capturedAt: captured.at, source, targetFingerprint: expected.targetFingerprint,
    commands: raw.rows.map(([, row]) => row) }) : null;
  need(!snapshot || snapshot.length <= LIMIT, 'SNAPSHOT_BYTES_LIMIT');
  const importManifest = snapshot ? encoded({ schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1',
    snapshotSha256: hash(snapshot), targetFingerprint: expected.targetFingerprint, source }) : null;
  const receipt = encoded({ schema: 'PHAB_CUP83_SNAPSHOT_NORMALIZATION_V1',
    status: snapshot ? 'DRAFT_MAP_SNAPSHOT' : 'NO_IMPORTABLE_COMMANDS', scope: 'MAP_ONLY',
    inputSha256: expected.hashes, expectedContextSha256: hash(encoded(expected)),
    outputSha256: { snapshot: snapshot ? hash(snapshot) : null, importManifest: importManifest ? hash(importManifest) : null,
      undefinedPaths: hash(undefinedPaths) }, commandCount: raw.maxCount, counts,
    capturedAtSemantics: 'CAPTURE_ACK_TIME', terminalStatus: terminal.status,
    inspectorClosed: terminal.status === 'SUCCESS', soleClientProven: false,
    drainProven: false, durableInventoryIncluded: false, targetVerified: false, importAuthorized: false });
  return { snapshot, importManifest, undefinedPaths, receipt };
}
