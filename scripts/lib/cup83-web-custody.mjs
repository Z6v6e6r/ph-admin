// Offline comparison of pinned private exports. No IO, DB, import or restart path.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const KINDS = ['commands', 'messages', 'serviceMessages', 'dialogs', 'clients'];
const need = (ok, code) => { if (!ok) throw Error(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys, code) => need(object(v) && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), code);
const sha = b => createHash('sha256').update(b).digest('hex');
const digest = v => typeof v === 'string' && v.length === 64 && /^[a-f0-9]+$/.test(v);
const encoded = v => Buffer.from(JSON.stringify(v) + '\n');
function parse(bytes, expectedHash, limit) {
  need(Buffer.isBuffer(bytes) && bytes.length <= limit && digest(expectedHash) && sha(bytes) === expectedHash, 'INPUT_HASH_OR_BOUND');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Error('INPUT_JSON'); }
  // Round trip rejects duplicate keys, unsupported JSON numbers and ambiguous encodings.
  need(encoded(value).equals(bytes), 'INPUT_SERIALIZATION'); return value;
}
function boundedData(value, depth = 0) {
  need(depth <= 32, 'ROW_DEPTH');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value), 'ROW_NUMBER'); return; }
  need(object(value) || Array.isArray(value), 'ROW_DATA');
  for (const child of Object.values(value)) boundedData(child, depth + 1);
}
function rowsByKind(rows, counts, maxRows = 20000) {
  exact(rows, KINDS, 'COLLECTION_SET'); exact(counts, KINDS, 'COUNT_SET');
  const result = {};
  for (const kind of KINDS) {
    need(Array.isArray(rows[kind]) && rows[kind].length <= maxRows && counts[kind] === rows[kind].length, 'ROW_COUNT');
    const map = result[kind] = new Map();
    for (const pair of rows[kind]) {
      need(Array.isArray(pair) && pair.length === 2, 'ROW_PAIR');
      const [id, row] = pair;
      need(typeof id === 'string' && id.length > 0 && id.length <= 200 && object(row)
        && row.id === id && !map.has(id) && !Object.hasOwn(row, '_id'), 'ROW_IDENTITY');
      boundedData(row); map.set(id, row);
    }
  }
  return result;
}
function restoreBsonUndefined(paths, maps) {
  need(Array.isArray(paths) && paths.length <= 100000, 'SIDECAR_BOUND');
  const seen = new Set();
  for (const entry of paths) {
    exact(entry, ['commandId', 'path'], 'SIDECAR_SHAPE');
    need(typeof entry.commandId === 'string', 'SIDECAR_ID');
    const separator = entry.commandId.indexOf(':');
    const kind = entry.commandId.slice(0, separator), id = entry.commandId.slice(separator + 1);
    need(KINDS.includes(kind) && maps[kind].has(id) && Array.isArray(entry.path)
      && entry.path.length > 0 && entry.path.length <= 33 && entry.path.every(k => typeof k === 'string'), 'SIDECAR_REFERENCE');
    const key = JSON.stringify([entry.commandId, entry.path]); need(!seen.has(key), 'SIDECAR_DUPLICATE'); seen.add(key);
    let parent = maps[kind].get(id);
    for (const field of entry.path.slice(0, -1)) {
      need((object(parent) || Array.isArray(parent)) && Object.hasOwn(parent, field), 'SIDECAR_PARENT'); parent = parent[field];
    }
    const field = entry.path.at(-1);
    need(object(parent) && !Object.hasOwn(parent, field), 'SIDECAR_VALUE_PRESENT');
    // Exact83's Mongo driver default ignoreUndefined=false serializes these own
    // undefined fields as BSON null. Never normalize other missing/null fields.
    Object.defineProperty(parent, field, { value: null, writable: true, enumerable: true, configurable: true });
  }
}

/** Owner must bind every configured, connected namespace and its complete bounded
 * collection inventories independently. A successful comparison is conditional on
 * those inputs; it proves neither producer drain nor live restart eligibility. */
export function compareCup83WebCustody(inputs, expected) {
  exact(inputs, ['capture', 'inventories'], 'INPUT_SET');
  exact(expected, ['captureSha256', 'identity', 'namespaces', 'ignoreUndefined'], 'EXPECTED_SET');
  need(expected.ignoreUndefined === false && object(expected.identity)
    && expected.identity.sourceEpoch === SOURCE, 'SOURCE_SERIALIZATION_CONTRACT');
  need(Array.isArray(expected.namespaces) && expected.namespaces.length > 0 && expected.namespaces.length <= 3
    && Array.isArray(inputs.inventories) && inputs.inventories.length === expected.namespaces.length, 'NAMESPACE_SET');
  const capture = parse(inputs.capture, expected.captureSha256, 32 * 1024 * 1024);
  exact(capture, ['schema', 'identity', 'rows', 'counts', 'undefinedPaths', 'durableCompletenessProven'], 'CAPTURE_SHAPE');
  need(capture.schema === 'PHAB_CUP83_WEB_CUSTODY_V1' && capture.durableCompletenessProven === false
    && isDeepStrictEqual(capture.identity, expected.identity), 'CAPTURE_IDENTITY');
  const required = rowsByKind(capture.rows, capture.counts);
  for (const kind of ['commands', 'messages', 'serviceMessages']) for (const [id, row] of required[kind]) {
    need(row.connector === 'LK_WEB_MESSENGER' && required.dialogs.has(row.dialogId)
      && required.clients.has(row.clientId), 'CAPTURE_REFERENCE');
    if (kind === 'commands') need(['PENDING', 'LEASED', 'SENT', 'FAILED'].includes(row.status), 'CAPTURE_STATUS');
    else {
      const service = row.direction === 'SYSTEM' || row.senderRole === 'SYSTEM' || row.kind === 'SYSTEM';
      need(service === (kind === 'serviceMessages')
        && !required[kind === 'messages' ? 'serviceMessages' : 'messages'].has(id), 'CAPTURE_MESSAGE_DOMAIN');
    }
  }
  for (const row of required.dialogs.values()) need(required.clients.has(row.clientId), 'CAPTURE_REFERENCE');
  restoreBsonUndefined(capture.undefinedPaths, required);
  const seen = new Set(), inventories = [];
  for (let i = 0; i < expected.namespaces.length; i++) {
    const binding = expected.namespaces[i];
    exact(binding, ['fingerprint', 'collectionsSha256', 'sha256'], 'NAMESPACE_BINDING');
    need(digest(binding.fingerprint) && digest(binding.collectionsSha256) && !seen.has(binding.fingerprint), 'NAMESPACE_IDENTITY');
    seen.add(binding.fingerprint);
    const value = parse(inputs.inventories[i], binding.sha256, 64 * 1024 * 1024);
    exact(value, ['schema', 'sourceEpoch', 'fingerprint', 'collectionsSha256', 'complete', 'ignoreUndefined', 'rows', 'counts'], 'INVENTORY_SHAPE');
    need(value.schema === 'PHAB_CUP83_WEB_DURABLE_INVENTORY_V1' && value.sourceEpoch === SOURCE
      && value.fingerprint === binding.fingerprint && value.collectionsSha256 === binding.collectionsSha256
      && value.complete === true && value.ignoreUndefined === false, 'INVENTORY_BINDING_OR_COMPLETENESS');
    inventories.push(rowsByKind(value.rows, value.counts, 32768));
  }
  // Reject conflicting duplicates, rather than letting loadState's timestamp and
  // backend-order tie-break hide a divergent identity, ACL or payload version.
  for (const kind of KINDS) for (const [id, row] of required[kind]) {
    const copies = inventories.filter(maps => maps[kind].has(id)).map(maps => maps[kind].get(id));
    need(copies.length > 0, 'MISSING_CAPTURED_ROW');
    need(copies.every(copy => isDeepStrictEqual(copy, row)), 'DURABLE_ROW_CONFLICT');
  }
  return { status: 'PINNED_WEB_CAPTURE_ROWS_MATCH', captureSha256: expected.captureSha256,
    inventorySha256: expected.namespaces.map(n => n.sha256), counts: { ...capture.counts },
    namespaceCount: inventories.length, producerDrainProven: false, restartAuthorized: false };
}
