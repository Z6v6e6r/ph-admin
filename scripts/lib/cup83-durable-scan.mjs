// Shared exact83 bounded scan for live-instance capture and an independent stopped-source reader.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { MongoClient, Db, Collection, FindCursor } from 'mongodb';

const VERSION = createRequire(import.meta.url)('mongodb/package.json').version;
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const COLLECTIONS = ['clients', 'dialogs', 'messages', 'serviceMessages', 'outbox'];
const CONFIG_COLLECTIONS = [...COLLECTIONS, 'responseMetrics'];
const KINDS = ['commands', 'messages', 'serviceMessages', 'dialogs', 'clients'];
const defaults = { totalMS: 30000, operationMS: 5000, cleanupMS: 1000,
  maxRowsPerCollection: 20000, maxBytes: 64 * 1024 * 1024, batchSize: 100 };
export class Cup83InventoryRefusal extends Error {}
const Refusal = Cup83InventoryRefusal;
const need = (ok, code) => { if (!ok) throw new Refusal(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys, code) => need(object(v)
  && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), code);
const own = (v, key) => {
  const d = Object.getOwnPropertyDescriptor(v, key);
  need(d && Object.hasOwn(d, 'value'), 'OWN_DATA_REQUIRED'); return d.value;
};
const bytes = value => Buffer.from(JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !/[\x00-\x1f]/.test(value);
export const cup83InventoryCollections = value => {
  exact(value, CONFIG_COLLECTIONS, 'COLLECTION_CONFIG');
  return Object.fromEntries([...CONFIG_COLLECTIONS].sort().map(key => {
    const v = own(value, key); need(name(v), 'COLLECTION_CONFIG'); return [key, v];
  }));
};
function topology(client) {
  const t = client.topology;
  need(t && t.isConnected() === true, 'DISCONNECTED_BACKEND');
  const d = t.description;
  need(['Single', 'ReplicaSetWithPrimary'].includes(d?.type)
    && d.servers instanceof Map && d.servers.size > 0 && d.servers.size <= 64, 'TOPOLOGY_UNSUPPORTED');
  const servers = [...d.servers.keys()].sort();
  need(servers.every(name) && (d.type !== 'Single' || servers.length === 1)
    && (d.type !== 'ReplicaSetWithPrimary' || name(d.setName)), 'TOPOLOGY_UNSUPPORTED');
  return { type: d.type, setName: d.setName ?? null, servers };
}
/** Private namespace mapping only; caller must not log the raw input/result. */
export function cup83DurableNamespaceBinding(value) {
  exact(value, ['topology', 'dbName', 'collections'], 'NAMESPACE_MAPPING');
  exact(value.topology, ['type', 'setName', 'servers'], 'TOPOLOGY_IDENTITY');
  const t = value.topology;
  need(['Single', 'ReplicaSetWithPrimary'].includes(t.type) && Array.isArray(t.servers)
    && t.servers.length >= 1 && t.servers.length <= 64 && t.servers.every(name)
    && new Set(t.servers).size === t.servers.length && isDeepStrictEqual(t.servers, [...t.servers].sort())
    && (t.type !== 'Single' || t.servers.length === 1)
    && (t.type !== 'ReplicaSetWithPrimary' || name(t.setName))
    && (t.setName === null || name(t.setName)) && name(value.dbName), 'TOPOLOGY_UNSUPPORTED');
  const collections = cup83InventoryCollections(value.collections);
  const clusterSha256 = hash(bytes(t)), collectionsSha256 = hash(bytes(collections));
  return { fingerprint: hash(bytes({ clusterSha256, dbName: value.dbName, collectionsSha256 })),
    collectionsSha256, clusterSha256 };
}
function plainClone(value, charge, depth = 0, seen = new Set()) {
  need(depth <= 32, 'ROW_DEPTH');
  if (value === null || typeof value === 'boolean') { charge(5); return value; }
  if (typeof value === 'number') { need(Number.isFinite(value), 'ROW_NUMBER'); charge(24); return value; }
  if (typeof value === 'string') { charge(Buffer.byteLength(value) * 6 + 2); return value; }
  need(object(value) || Array.isArray(value), 'ROW_DATA');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  need((array || proto === Object.prototype || proto === null) && !seen.has(value), 'ROW_DATA');
  const keys = Object.keys(value);
  need(!array || keys.length === value.length && keys.every((k, i) => k === String(i)), 'ROW_ARRAY');
  seen.add(value); charge(2);
  const result = array ? [] : Object.create(null);
  for (const key of keys) {
    charge(Buffer.byteLength(key) * 6 + 4);
    // Durable BSON null stays null; undefined is never repaired here. Only the
    // existing offline comparator restores capture-side undefined sidecars.
    Object.defineProperty(result, key, { value: plainClone(own(value, key), charge, depth + 1, seen),
      enumerable: true, writable: true, configurable: true });
  }
  seen.delete(value); return result;
}

/** Synchronous actual-driver handle/mapping checks only: no collection/query calls. */
export function bindCup83DurableBackends(backends) {
  need(VERSION === '6.21.0', 'DRIVER_UNSUPPORTED');
  need(Array.isArray(backends) && backends.length >= 1 && backends.length <= 3, 'BACKEND_SET');
  const expectedKeys = new Set(), groups = new Map(), physical = new Map(), bindings = [];
  for (const binding of backends) {
    exact(binding, ['key', 'client', 'db', 'dbName', 'collections', 'topology'], 'BACKEND_BINDING');
    const { key, client, db } = binding;
    need(['primary', 'web', 'max'].includes(key) && !expectedKeys.has(key), 'BACKEND_SET'); expectedKeys.add(key);
    need(client instanceof MongoClient && db instanceof Db && db.client === client, 'DRIVER_OR_HANDLE');
    need(name(binding.dbName) && db.databaseName === binding.dbName, 'DATABASE_IDENTITY');
    const collections = cup83InventoryCollections(binding.collections), cluster = topology(client);
    exact(binding.topology, ['type', 'setName', 'servers'], 'TOPOLOGY_IDENTITY');
    need(isDeepStrictEqual(cluster, binding.topology), 'TOPOLOGY_IDENTITY');
    for (const previous of bindings) if (!isDeepStrictEqual(previous.cluster, cluster)) {
      need(cluster.type !== 'Single' && previous.cluster.type !== 'Single'
        && cluster.setName !== previous.cluster.setName
        && !cluster.servers.some(server => previous.cluster.servers.includes(server)), 'TOPOLOGY_AMBIGUOUS');
    }
    need(db.bsonOptions.ignoreUndefined === false, 'COLLECTION_DRIVER_OR_SERIALIZATION');
    const { fingerprint, collectionsSha256, clusterSha256 } = cup83DurableNamespaceBinding({
      topology: cluster, dbName: binding.dbName, collections });
    for (const kind of CONFIG_COLLECTIONS) {
      const namespace = JSON.stringify([clusterSha256, binding.dbName, collections[kind]]);
      need(!physical.has(namespace) || physical.get(namespace) === kind, 'COLLECTION_DOMAIN_ALIAS'); physical.set(namespace, kind);
    }
    const saved = { binding, collections, cluster, fingerprint, collectionsSha256 }; bindings.push(saved);
    if (!groups.has(fingerprint)) groups.set(fingerprint, { ...saved, aliases: [], rows: undefined });
    groups.get(fingerprint).aliases.push(key);
  }
  need(expectedKeys.has('primary'), 'BACKEND_SET');
  const validateBackends = () => {
    for (const b of bindings) need(b.binding.db.databaseName === b.binding.dbName
      && isDeepStrictEqual(cup83InventoryCollections(b.binding.collections), b.collections)
      && isDeepStrictEqual(topology(b.binding.client), b.cluster), 'BACKEND_DRIFT');
  };
  return { bindings, groups, validateBackends };
}

/** Internal shared engine. prepare owns source-specific identity/connection checks;
 * it returns {identity,backends,validateSource,afterScan?,createProvenance?}.
 * No implicit connection, runtime composition or authority is supplied here. */
export async function scanCup83DurableInventory({ prepare, sink, limits = {}, profile = 'LIVE' }) {
  let current, sinkReady = false, stage = 'TARGET_VALIDATION', budget = 0;
  const controller = new AbortController();
  let settings = defaults;
  const bounded = async (operation, ms, code) => {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Refusal(code)), ms);
      })]);
    } finally { clearTimeout(timer); }
  };
  let deadline;
  const run = operation => {
    const remaining = deadline - performance.now();
    need(remaining > 0, 'TOTAL_TIMEOUT');
    return bounded(operation, Math.min(settings.operationMS, remaining), 'OPERATION_TIMEOUT');
  };
  try {
    need(VERSION === '6.21.0', 'DRIVER_UNSUPPORTED');
    need(['LIVE', 'POST_STOP'].includes(profile), 'SCAN_PROFILE');
    const caps = profile === 'POST_STOP' ? { ...defaults, maxRowsPerCollection: 32768, maxChargeBytes: 6 * defaults.maxBytes } : defaults;
    need(object(limits) && Object.keys(limits).every(k => Object.hasOwn(caps, k)), 'LIMITS');
    settings = { ...caps, ...limits };
    for (const [key, value] of Object.entries(settings))
      need(Number.isSafeInteger(value) && value > 0 && value <= caps[key], 'LIMITS');
    deadline = performance.now() + settings.totalMS;
    need(sink?.private === true && ['write', 'complete', 'abort'].every(k => typeof sink[k] === 'function'), 'PRIVATE_SINK');
    sinkReady = true;
    need(typeof prepare === 'function', 'PREPARE_REQUIRED');
    const source = await prepare({ run, settings, signal: controller.signal });
    need(typeof source.validateSource === 'function', 'BACKEND_SET');
    const { bindings, groups, validateBackends } = bindCup83DurableBackends(source.backends);
    const revalidate = () => { source.validateSource(); validateBackends(); };
    const chargeLimit = profile === 'POST_STOP' ? Math.min(settings.maxChargeBytes, 6 * settings.maxBytes) : settings.maxBytes;
    const charge = n => { budget += n; need(budget <= chargeLimit, 'BYTE_LIMIT'); };
    const copies = Object.fromEntries(KINDS.map(k => [k, new Map()])), scanned = new Map();
    const provenance = [];
    stage = 'READ_FAILED';
    for (const group of groups.values()) {
      group.rows = Object.fromEntries(KINDS.map(k => [k, []]));
      const collectionProvenance = [];
      for (const kind of COLLECTIONS) {
        revalidate();
        const physicalKey = JSON.stringify([hash(bytes(group.cluster)), group.binding.dbName, group.collections[kind]]);
        const outKind = kind === 'outbox' ? 'commands' : kind;
        if (scanned.has(physicalKey)) {
          const cached = scanned.get(physicalKey);
          group.rows[outKind] = cached.rows;
          collectionProvenance.push({ kind, collection: group.collections[kind], count: cached.rows.length,
            eof: true, readFromFingerprint: cached.fingerprint });
          continue;
        }
        const collection = group.binding.db.collection(group.collections[kind]);
        need(collection instanceof Collection && collection.client === group.binding.client
          && collection.dbName === group.binding.dbName && collection.collectionName === group.collections[kind]
          && collection.bsonOptions.ignoreUndefined === false, 'COLLECTION_DRIVER_OR_SERIALIZATION');
        const timeoutMS = Math.max(1, Math.min(settings.operationMS, Math.ceil(deadline - performance.now())));
        const options = { projection: { _id: 0 }, readPreference: 'primary', readConcern: { level: 'majority' },
          timeoutMS, maxTimeMS: timeoutMS, batchSize: settings.batchSize, allowPartialResults: false,
          signal: controller.signal };
        current = collection.find({}, options);
        need(current instanceof FindCursor && current.client === group.binding.client
          && current.namespace.db === group.binding.dbName && current.namespace.collection === group.collections[kind]
          && current.readPreference.mode === 'primary' && current.readConcern?.level === 'majority'
          && isDeepStrictEqual(current.cursorFilter, {})
          && isDeepStrictEqual(current.findOptions.projection, { _id: 0 })
          && current.findOptions.limit == null && current.findOptions.skip == null
          && current.findOptions.allowPartialResults === false && current.transform == null
          && !current.cursorOptions.tailable && !current.cursorOptions.awaitData && !current.findOptions.explain
          && current.cursorOptions.timeoutMS === timeoutMS && current.findOptions.maxTimeMS === timeoutMS
          && current.initialized === false, 'CURSOR_CONTRACT');
        const ids = new Set();
        while (true) {
          const value = await run(() => current.next());
          if (value === null) {
            // close() alone can manufacture a zero cursor id: require natural EOF
            // with no kill, no buffered rows and no query limit/partial results.
            need(current.id?.isZero() === true && current.closed === true && current.killed === false
              && current.bufferedCount() === 0, 'CURSOR_INCOMPLETE');
            break;
          }
          need(ids.size < settings.maxRowsPerCollection, 'COUNT_LIMIT');
          const row = plainClone(value, charge);
          need(object(row) && name(row.id) && !Object.hasOwn(row, '_id') && !ids.has(row.id), 'ROW_IDENTITY');
          ids.add(row.id);
          if (kind === 'messages' || kind === 'serviceMessages') {
            const system = ['direction', 'senderRole', 'kind'].some(k => row[k] === 'SYSTEM');
            need(system === (kind === 'serviceMessages'), 'MESSAGE_DOMAIN');
          }
          if (kind === 'outbox') need(['PENDING', 'LEASED', 'SENT', 'FAILED'].includes(row.status), 'COMMAND_STATUS');
          const previous = copies[outKind].get(row.id);
          need(previous === undefined || isDeepStrictEqual(previous, row), 'DURABLE_ROW_CONFLICT');
          copies[outKind].set(row.id, row); group.rows[outKind].push([row.id, row]);
        }
        await run(() => current.close({ timeoutMS: settings.cleanupMS })); current = undefined;
        scanned.set(physicalKey, { rows: group.rows[outKind], fingerprint: group.fingerprint });
        collectionProvenance.push({ kind, collection: group.collections[kind], count: ids.size, eof: true });
      }
      for (const rows of Object.values(group.rows)) rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      group.counts = Object.fromEntries(KINDS.map(k => [k, group.rows[k].length]));
      provenance.push({ fingerprint: group.fingerprint, collectionsSha256: group.collectionsSha256,
        backendKeys: group.aliases, topology: group.cluster, dbName: group.binding.dbName,
        collections: collectionProvenance, readPreference: 'primary', readConcern: 'majority', complete: true });
    }
    for (const id of copies.messages.keys()) need(!copies.serviceMessages.has(id), 'MESSAGE_DOMAIN_CONFLICT');
    revalidate();
    if (source.afterScan) await source.afterScan();
    revalidate();
    stage = 'SINK_FAILED';
    const namespaces = [];
    let serializedBytes = 0;
    for (const group of groups.values()) {
      const payload = bytes({ schema: 'PHAB_CUP83_WEB_DURABLE_INVENTORY_V1', sourceEpoch: SOURCE,
        fingerprint: group.fingerprint, collectionsSha256: group.collectionsSha256,
        complete: true, ignoreUndefined: false, rows: group.rows, counts: group.counts });
      serializedBytes += payload.length; need(serializedBytes <= settings.maxBytes, 'BYTE_LIMIT');
      const sha256 = hash(payload), file = 'cup83-durable-' + group.fingerprint + '.json';
      await run(() => sink.write(file, payload, { signal: controller.signal }));
      namespaces.push({ fingerprint: group.fingerprint, collectionsSha256: group.collectionsSha256, sha256 });
    }
    const privateProvenance = bytes(source.createProvenance ? source.createProvenance(provenance, { profile, chargedBytes: budget, chargeLimitBytes: chargeLimit,
        inventoryEncodedBytes: serializedBytes, outputLimitBytes: settings.maxBytes, maxRowsPerCollection: settings.maxRowsPerCollection })
      : { schema: 'PHAB_CUP83_DURABLE_PROVENANCE_V1', identity: source.identity,
        driverVersion: VERSION, namespaces: provenance, producerDrainProven: false, pointInTimeProven: false,
        restartAuthorized: false });
    serializedBytes += privateProvenance.length; need(serializedBytes <= settings.maxBytes, 'BYTE_LIMIT');
    const provenanceSha256 = hash(privateProvenance);
    await run(() => sink.write('cup83-durable-provenance.json', privateProvenance, { signal: controller.signal }));
    revalidate();
    const receipt = { status: 'BOUNDED_DURABLE_INVENTORIES_COLLECTED', namespaces, provenanceSha256,
      backendAliases: bindings.map(b => ({ key: b.binding.key, fingerprint: b.fingerprint })),
      counts: [...groups.values()].map(g => ({ fingerprint: g.fingerprint, counts: g.counts })),
      producerDrainProven: false, pointInTimeProven: false, restartAuthorized: false };
    await run(() => sink.complete(receipt, { signal: controller.signal }));
    return receipt;
  } catch (error) {
    controller.abort();
    let cleanupFailed = false;
    if (current) try {
      await bounded(() => current.close({ timeoutMS: settings.cleanupMS }), settings.cleanupMS, 'CLEANUP_TIMEOUT');
    } catch { cleanupFailed = true; }
    if (sinkReady) try {
      await bounded(() => sink.abort({ signal: AbortSignal.timeout(settings.cleanupMS) }), settings.cleanupMS, 'CLEANUP_TIMEOUT');
    } catch { cleanupFailed = true; }
    // Driver/sink errors can contain queries or data. Never propagate them.
    throw new Error(cleanupFailed ? 'CLEANUP_FAILED' : error instanceof Refusal ? error.message : stage);
  }
}
