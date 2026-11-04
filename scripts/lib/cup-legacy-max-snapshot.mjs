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

/** Actual three-file captureAndFence input only. No diagnostic operation/intent,
 * CAPTURED acknowledgement, terminal receipt or runtime attestation is invented.
 * The full importer source is independently pinned by the caller; the primitive
 * verifies only pid/timeOrigin/nodeVersion/sourceEpoch, even if supplied8fields.
 * All original private bytes, including web evidence, must remain retained. */
export function normalizeCup83PreDrainFence(inputs, expected) {
  const names = ['raw', 'web', 'fence'];
  exact(inputs, names, 'FENCE_INPUT_SET');
  exact(expected, ['hashes', 'identity', 'source', 'targetFingerprint', 'fencedAt'], 'FENCE_EXPECTED');
  exact(expected.hashes, names, 'FENCE_EXPECTED_HASHES');
  exact(expected.source, ['pid', 'bootId', 'startTicks', 'sourceCommit', 'sourceTree', 'runtimeInventorySha256'], 'EXPECTED_SOURCE');
  const fields = ['pid', 'start', 'nodeVersion', 'sourceEpoch'];
  exact(expected.identity, Object.keys(expected.identity ?? {}).length === 8
    ? [...fields, 'bootId', 'processStartTicks', 'modulePath', 'entrypoint'] : fields, 'FENCE_EXPECTED_IDENTITY');
  const id = expected.identity, source = expected.source;
  need(Number.isSafeInteger(id.pid) && id.pid > 0 && typeof id.start === 'string'
    && matches(id.start, /^[0-9]+(?:\.[0-9]+)?$/) && id.sourceEpoch === SOURCE
    && matches(id.nodeVersion, /^v[0-9]+\.[0-9]+\.[0-9]+$/), 'FENCE_PROCESS_IDENTITY');
  need(source.pid === id.pid && source.sourceCommit === id.sourceEpoch && source.sourceTree === TREE
    && matches(source.bootId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
    && matches(source.startTicks, /^[1-9][0-9]{0,30}$/) && matches(source.runtimeInventorySha256, SHA), 'FENCE_SOURCE_BINDING');
  if (own(id, 'bootId')) need(id.bootId === source.bootId && id.processStartTicks === source.startTicks
    && [id.modulePath, id.entrypoint].every(p => typeof p === 'string' && p.startsWith('/')
      && !p.split('/').some(part => part === '.' || part === '..')), 'FENCE_SOURCE_BINDING');
  need(matches(expected.targetFingerprint, SHA), 'TARGET_FINGERPRINT');
  need(Buffer.isBuffer(inputs.raw) && Buffer.isBuffer(inputs.web) && inputs.raw.length + inputs.web.length <= LIMIT, 'FENCE_CAPTURE_BYTES');
  const raw = parse(inputs.raw, expected.hashes.raw, LIMIT), web = parse(inputs.web, expected.hashes.web, LIMIT);
  const fence = parse(inputs.fence, expected.hashes.fence, 4096);
  exact(raw, ['schema', 'identity', 'totalMapCount', 'maxCount', 'counts', 'rows', 'undefinedPaths'], 'EXPORT_SHAPE');
  exact(fence, ['schema', 'status', 'artifactSha256', 'webArtifactSha256', 'webCounts', 'totalMapCount', 'maxCount', 'counts', 'at', 'drainProven', 'replayAllowed'], 'FENCE_RECEIPT_SHAPE');
  need(raw.schema === 'SYNTHETIC_MAX_MAP_EXPORT_V1' && isDeepStrictEqual(raw.identity, id), 'FENCE_CAPTURE_IDENTITY');
  need(fence.schema === 'PHAB_CUP83_PRE_DRAIN_FENCE_V1' && fence.status === 'SUPPORT_TIMERS_FENCED'
    && fence.drainProven === false && fence.replayAllowed === false && fence.artifactSha256 === expected.hashes.raw
    && fence.webArtifactSha256 === expected.hashes.web, 'FENCE_RECEIPT_BINDING');
  need(timestamp(fence.at) === timestamp(expected.fencedAt), 'FENCE_TIME_BINDING');
  need(Number.isSafeInteger(raw.totalMapCount) && raw.totalMapCount >= 0 && raw.totalMapCount <= 5000
    && Number.isSafeInteger(raw.maxCount) && raw.maxCount >= 0 && raw.maxCount <= raw.totalMapCount
    && Array.isArray(raw.rows) && raw.rows.length === raw.maxCount && fence.totalMapCount === raw.totalMapCount
    && fence.maxCount === raw.maxCount, 'FENCE_EXPORT_COUNT');
  const counts = Object.fromEntries(groups.map(key => [key, 0])), byId = new Map();
  for (const pair of raw.rows) {
    need(Array.isArray(pair) && pair.length === 2, 'EXPORT_ROW'); command(pair[1], pair[0]);
    need(!byId.has(pair[0]), 'COMMAND_DUPLICATE'); byId.set(pair[0], pair[1]); counts[pair[1].connector + ':' + pair[1].status]++;
  }
  const sparse = Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
  need(isDeepStrictEqual(raw.counts, sparse) && isDeepStrictEqual(fence.counts, sparse), 'COUNTS_MISMATCH');
  sidecar(raw.undefinedPaths, byId);
  exact(web, ['schema', 'identity', 'rows', 'counts', 'undefinedPaths', 'durableCompletenessProven'], 'FENCE_WEB_SHAPE');
  need(web.schema === 'PHAB_CUP83_WEB_CUSTODY_V1' && isDeepStrictEqual(web.identity, id)
    && web.durableCompletenessProven === false, 'FENCE_WEB_BINDING');
  const kinds = ['commands', 'messages', 'serviceMessages', 'dialogs', 'clients'], maps = {}, webIds = new Map();
  exact(web.rows, kinds, 'FENCE_WEB_COLLECTIONS'); exact(web.counts, kinds, 'FENCE_WEB_COUNTS');
  need(isDeepStrictEqual(web.counts, fence.webCounts), 'FENCE_WEB_COUNTS');
  for (const kind of kinds) {
    const rows = web.rows[kind], map = maps[kind] = new Map();
    need(Array.isArray(rows) && rows.length <= (['messages', 'serviceMessages'].includes(kind) ? 20000 : 5000)
      && rows.length === web.counts[kind], 'FENCE_WEB_COUNTS');
    for (const pair of rows) {
      need(Array.isArray(pair) && pair.length === 2, 'FENCE_WEB_ROW'); const [key, row] = pair;
      need(typeof key === 'string' && key.length > 0 && key.length <= 200 && object(row) && row.id === key
        && !own(row, '_id') && !map.has(key), 'FENCE_WEB_ROW'); data(row); map.set(key, row); webIds.set(kind + ':' + key, row);
    }
  }
  need(web.counts.messages + web.counts.serviceMessages <= 20000
    && raw.maxCount + web.counts.commands <= raw.totalMapCount, 'FENCE_WEB_COUNTS');
  for (const kind of ['commands', 'messages', 'serviceMessages']) for (const [key, row] of maps[kind]) {
    need(row.connector === 'LK_WEB_MESSENGER' && maps.dialogs.has(row.dialogId) && maps.clients.has(row.clientId), 'FENCE_WEB_REFERENCE');
    if (kind === 'commands') need(STATES.includes(row.status) && !byId.has(key), 'FENCE_WEB_ROW');
    else need(['direction', 'senderRole', 'kind'].some(field => row[field] === 'SYSTEM') === (kind === 'serviceMessages')
      && !maps[kind === 'messages' ? 'serviceMessages' : 'messages'].has(key), 'FENCE_WEB_DOMAIN');
  }
  for (const row of maps.dialogs.values()) need(maps.clients.has(row.clientId), 'FENCE_WEB_REFERENCE');
  sidecar(web.undefinedPaths, webIds);
  const undefinedPaths = encoded({ schema: 'PHAB_CUP83_PRE_DRAIN_UNDEFINED_PATHS_V1', rawSha256: expected.hashes.raw,
    webSha256: expected.hashes.web, undefinedPaths: raw.undefinedPaths, webUndefinedPaths: web.undefinedPaths });
  const snapshot = raw.maxCount ? encoded({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', capturedAt: fence.at,
    source, targetFingerprint: expected.targetFingerprint, commands: raw.rows.map(([, row]) => row) }) : null;
  need(!snapshot || snapshot.length <= LIMIT, 'SNAPSHOT_BYTES_LIMIT');
  const importManifest = snapshot ? encoded({ schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1', snapshotSha256: hash(snapshot),
    targetFingerprint: expected.targetFingerprint, source }) : null;
  const receipt = encoded({ schema: 'PHAB_CUP83_PRE_DRAIN_NORMALIZATION_V1',
    status: snapshot ? 'DRAFT_PRE_DRAIN_MAP_SNAPSHOT' : 'NO_IMPORTABLE_COMMANDS', scope: 'PRE_DRAIN_MAP_AND_WEB_EVIDENCE',
    inputSha256: expected.hashes, expectedContextSha256: hash(encoded(expected)),
    outputSha256: { snapshot: snapshot ? hash(snapshot) : null, importManifest: importManifest ? hash(importManifest) : null, undefinedPaths: hash(undefinedPaths) },
    commandCount: raw.maxCount, counts, webArtifactSha256: expected.hashes.web, webCounts: web.counts,
    fencedAt: fence.at, capturedAtSemantics: 'FENCE_RECEIPT_TIME',
    primitiveVerifiedIdentityFields: fields, fullSourceBinding: 'INDEPENDENT_CALLER_PIN', sourceAttestationProven: false,
    inspectorClosedProven: false, soleClientProven: false, drainProven: false, durableInventoryIncluded: false,
    targetVerified: false, restartAuthorized: false, importAuthorized: false });
  return { snapshot, importManifest, undefinedPaths, receipt };
}

/** Draft union only. All old namespaces and every input byte must remain retained.
 * Capture/freeze, namespace completeness, target preparation and live import are
 * independently verified by the operator; this pure function cannot establish them. */
export function buildCup83MaxRestartUnion(mapInputs, mapExpected, durableInputs, expected, additionalMaps = []) {
  return restartUnion(mapInputs, mapExpected, durableInputs, expected, additionalMaps, false);
}

/** Honest pre-drain primary plus optional later diagnostic captures. Neither
 * normalization nor this draft union supplies drain/close/import authority. */
export function buildCup83FencedMaxRestartUnion(mapInputs, mapExpected, durableInputs, expected, maps = {}) {
  need(object(maps) && Object.keys(maps).every(key => ['priorMaps', 'laterMaps'].includes(key)), 'FENCE_MAP_SET');
  const { priorMaps = [], laterMaps = [] } = maps;
  need(Array.isArray(priorMaps) && Array.isArray(laterMaps) && priorMaps.length + laterMaps.length <= 2, 'UNION_MAP_COUNT');
  return restartUnion(mapInputs, mapExpected, durableInputs, expected, laterMaps, true, priorMaps);
}

function restartUnion(mapInputs, mapExpected, durableInputs, expected, additionalMaps, fenced, priorMaps = []) {
  need(Array.isArray(additionalMaps) && additionalMaps.length <= 2, 'UNION_MAP_COUNT');
  const multi = additionalMaps.length > 0;
  const laterPinKey = fenced ? 'laterMapContextSha256' : 'additionalMapContextSha256';
  exact(expected, ['mapContextSha256', 'inventories', ...(multi ? [laterPinKey] : []),
    ...(priorMaps.length ? ['priorMapContextSha256'] : [])], 'UNION_EXPECTED');
  need(expected.mapContextSha256 === hash(encoded(mapExpected)), 'UNION_MAP_CONTEXT');
  if (multi) need(Array.isArray(expected[laterPinKey])
    && expected[laterPinKey].length === additionalMaps.length, 'UNION_MAP_CONTEXT');
  if (priorMaps.length) need(Array.isArray(expected.priorMapContextSha256)
    && expected.priorMapContextSha256.length === priorMaps.length, 'UNION_MAP_CONTEXT');
  need(Array.isArray(durableInputs) && Array.isArray(expected.inventories)
    && durableInputs.length >= 1 && durableInputs.length <= 3
    && durableInputs.length === expected.inventories.length, 'UNION_INVENTORIES');
  const normalized = fenced ? normalizeCup83PreDrainFence(mapInputs, mapExpected) : normalizeCup83MaxSnapshot(mapInputs, mapExpected);
  const map = normalized.snapshot ? JSON.parse(normalized.snapshot) : { commands: [] };
  let capturedAt = JSON.parse(fenced ? mapInputs.fence : mapInputs.captured).at;
  const fencedAt = capturedAt, additionalMapEvidence = [], priorMapEvidence = [];
  let previousPriorAt;
  const rows = new Map(), origins = new Map(), namespaces = new Set();
  const mutable = new Set(['status', 'attempts', 'leasedUntil', 'lastError']);
  const immutable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)));
  let totalRows = 0, totalBytes = mapInputs.raw.length + (fenced ? mapInputs.web.length + mapInputs.fence.length : 0);
  function add(row, origin) {
    command(row, row.id);
    need(++totalRows <= 100000, 'UNION_INPUT_COUNT');
    const previous = rows.get(row.id);
    if (previous) need(isDeepStrictEqual(immutable(previous), immutable(row)), 'UNION_COMMAND_CONFLICT');
    else { rows.set(row.id, row); origins.set(row.id, []); }
    need(rows.size <= 50000, 'UNION_COMMAND_COUNT');
    origins.get(row.id).push(origin);
  }
  for (const [index, row] of map.commands.entries()) add(row, { kind: 'MAP', ...(fenced ? { phase: 'FENCE' } : {}), index });
  function consumeDiagnostic(bundle, mapIndex, prior) {
    exact(bundle, ['inputs', 'expected'], 'UNION_MAP_BUNDLE');
    const pins = prior ? expected.priorMapContextSha256 : expected[laterPinKey];
    need(pins[mapIndex] === hash(encoded(bundle.expected))
      && isDeepStrictEqual(bundle.expected.source, mapExpected.source)
      && (fenced ? ['pid', 'start', 'nodeVersion', 'sourceEpoch'].every(key => bundle.expected.identity[key] === mapExpected.identity[key])
        : isDeepStrictEqual(bundle.expected.identity, mapExpected.identity))
      && bundle.expected.targetFingerprint === mapExpected.targetFingerprint, 'UNION_MAP_CONTEXT');
    const next = normalizeCup83MaxSnapshot(bundle.inputs, bundle.expected);
    const at = JSON.parse(bundle.inputs.captured).at;
    if (prior) {
      need(timestamp(at) <= timestamp(fencedAt) && (!previousPriorAt || timestamp(at) >= timestamp(previousPriorAt)), 'UNION_PRIOR_MAP_ORDER');
      previousPriorAt = at;
    } else { need(timestamp(at) >= timestamp(capturedAt), 'UNION_MAP_ORDER'); capturedAt = at; }
    totalBytes += fenced ? Object.values(bundle.inputs).reduce((sum, bytes) => sum + bytes.length, 0) : bundle.inputs.raw.length;
    need(totalBytes <= 128 * 1024 * 1024, 'UNION_INPUT_BYTES');
    const nextMap = next.snapshot ? JSON.parse(next.snapshot) : { commands: [] };
    for (const [index, row] of nextMap.commands.entries()) add(row, { kind: 'MAP', ...(fenced ? { phase: prior ? 'PRIOR' : 'LATER' } : {}), map: mapIndex + 1, index });
    (prior ? priorMapEvidence : additionalMapEvidence).push({ inputSha256: bundle.expected.hashes,
      normalizationReceipt: JSON.parse(next.receipt), undefinedPaths: JSON.parse(next.undefinedPaths) });
  }
  for (const [index, bundle] of priorMaps.entries()) consumeDiagnostic(bundle, index, true);
  for (const [index, bundle] of additionalMaps.entries()) consumeDiagnostic(bundle, index, false);
  for (const [index, bytes] of durableInputs.entries()) {
    const pin = expected.inventories[index];
    exact(pin, ['sha256', 'targetFingerprint'], 'UNION_INVENTORY_PIN');
    need(matches(pin.targetFingerprint, SHA) && !namespaces.has(pin.targetFingerprint)
      && pin.targetFingerprint !== mapExpected.targetFingerprint, 'UNION_NAMESPACE');
    namespaces.add(pin.targetFingerprint);
    totalBytes += bytes.length; need(totalBytes <= 128 * 1024 * 1024, 'UNION_INPUT_BYTES');
    const inventory = parse(bytes, pin.sha256, 64 * 1024 * 1024);
    exact(inventory, ['schema', 'source', 'targetFingerprint', 'capturedAt', 'commands'], 'UNION_INVENTORY_SHAPE');
    need(inventory.schema === 'PHAB_CUP83_MAX_DURABLE_INVENTORY_V1'
      && inventory.targetFingerprint === pin.targetFingerprint
      && isDeepStrictEqual(inventory.source, mapExpected.source)
      && timestamp(inventory.capturedAt) >= timestamp(capturedAt)
      && Array.isArray(inventory.commands), 'UNION_INVENTORY_IDENTITY');
    const localIds = new Set();
    for (const [rowIndex, document] of inventory.commands.entries()) {
      need(object(document) && !localIds.has(document.id), 'UNION_DURABLE_DUPLICATE');
      localIds.add(document.id);
      // The original Mongo document, including _id and all conflicting transition
      // evidence, remains in the hash-bound private inventory. Only _id is omitted
      // from the importer's existing command contract.
      const row = Object.fromEntries(Object.entries(document).filter(([key]) => key !== '_id'));
      add(row, { kind: 'DURABLE', inventory: index, index: rowIndex });
    }
  }
  const batches = [], membership = [], commands = [...rows.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const envelope = commands => ({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', capturedAt,
    source: mapExpected.source, targetFingerprint: mapExpected.targetFingerprint, commands });
  const overhead = encoded(envelope([])).length;
  let batch = [], bytes = overhead;
  function flush() {
    if (!batch.length) return;
    const snapshot = encoded(envelope(batch));
    need(snapshot.length <= LIMIT && batch.length <= 5000, 'UNION_BATCH_LIMIT');
    const importManifest = encoded({ schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1',
      snapshotSha256: hash(snapshot), targetFingerprint: mapExpected.targetFingerprint, source: mapExpected.source });
    const batchIndex = batches.length;
    for (const row of batch) membership.push({ id: row.id, batch: batchIndex, origins: origins.get(row.id) });
    batches.push({ snapshot, importManifest }); batch = []; bytes = overhead;
  }
  for (const row of commands) {
    const size = Buffer.byteLength(JSON.stringify(row));
    need(overhead + size <= LIMIT, 'UNION_COMMAND_BYTES');
    if (batch.length === 5000 || bytes + size + (batch.length ? 1 : 0) > LIMIT) flush();
    bytes += size + (batch.length ? 1 : 0); batch.push(row);
  }
  flush();
  const provenance = encoded({ schema: fenced ? 'PHAB_CUP83_FENCED_MAX_UNION_PROVENANCE_V1'
    : multi ? 'PHAB_CUP83_MAX_UNION_PROVENANCE_V2' : 'PHAB_CUP83_MAX_UNION_PROVENANCE_V1',
    mapInputSha256: mapExpected.hashes, inventories: expected.inventories,
    ...(fenced ? { primaryFenceEvidence: { normalizationReceipt: JSON.parse(normalized.receipt),
      undefinedPaths: JSON.parse(normalized.undefinedPaths), webArtifactSha256: mapExpected.hashes.web } } : {}),
    ...(fenced ? { priorMapEvidence, laterMapEvidence: additionalMapEvidence } : multi ? { additionalMapEvidence } : {}),
    undefinedPathsSha256: hash(normalized.undefinedPaths), membership });
  const receipt = encoded({ schema: fenced ? 'PHAB_CUP83_FENCED_MAX_RESTART_UNION_V1'
    : multi ? 'PHAB_CUP83_MAX_RESTART_UNION_V2' : 'PHAB_CUP83_MAX_RESTART_UNION_V1', status: 'DRAFT_HELD_IMPORT_BATCHES',
    expectedContextSha256: hash(encoded(expected)), mapNormalizationReceiptSha256: hash(normalized.receipt),
    source: mapExpected.source, targetFingerprint: mapExpected.targetFingerprint,
    ...(fenced ? { webArtifactSha256: mapExpected.hashes.web, sourceAttestationProven: false, drainProven: false, restartAuthorized: false,
      mapCount: priorMaps.length + additionalMaps.length + 1, priorMapCount: priorMaps.length, laterMapCount: additionalMaps.length,
      preDrainFencedAt: fencedAt, lastMapCapturedAt: capturedAt } : multi ? { mapCount: additionalMaps.length + 1, lastMapCapturedAt: capturedAt } : {}),
    commandCount: commands.length, inputRowCount: totalRows, batchCount: batches.length,
    batches: batches.map((b, index) => ({ index, snapshotSha256: hash(b.snapshot), importManifestSha256: hash(b.importManifest) })),
    provenanceSha256: hash(provenance), undefinedPathsSha256: hash(normalized.undefinedPaths),
    oldNamespacesMustBeRetained: true, allInputBytesMustBeRetained: true,
    finalFreezeProven: false, namespaceCompletenessProven: false, targetVerified: false,
    providerDeliveryProven: false, importAuthorized: false });
  return { batches, provenance, undefinedPaths: normalized.undefinedPaths, receipt };
}
