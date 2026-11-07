// Explicit live-instance adapter. No connection creation, env/URI reads or runtime wiring.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Cup83InventoryRefusal, bindCup83DurableBackends, cup83InventoryCollections, scanCup83DurableInventory } from './cup83-durable-scan.mjs';
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const need = (ok, code) => { if (!ok) throw new Cup83InventoryRefusal(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys, code) => need(object(v)
  && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), code);
const own = (v, key) => {
  const d = Object.getOwnPropertyDescriptor(v, key);
  need(d && Object.hasOwn(d, 'value'), 'OWN_DATA_REQUIRED'); return d.value;
};
/**
 * Caller owns exact-target authorization, an exclusive producer/drain boundary,
 * loaded prototypes and private sink. This does not create/connect a MongoClient,
 * inspect URIs/env, acknowledge, import, resend, change leases or authorize restart.
 *
 * expected = { identity: {sourceEpoch,pid,start,nodeVersion}, supportPrototype,
 *   persistencePrototype, backends: [{key,client,db,dbName,collections,topology}] }.
 * Every configured backend must be connected and explicitly mapped. topology is
 * {type,setName,servers:sortedAddresses}; use independently pinned private inputs.
 * Only Single/ReplicaSetWithPrimary are supported. Exact observed topology is
 * the deduplication identity, conditional on operator verification of those live
 * handles/addresses. Distinct Single address sets, overlapping distinct topology
 * sets, and one replica-set name with differing addresses are ambiguous and refuse.
 * This module alone does not establish compatibility with the live CUP instance.
 *
 * sink = {private:true, write(name,buffer,{signal}), complete(receipt,{signal}),
 *   abort({signal})}. The operator must verify private custody (including actual
 * filesystem permissions); private:true is only an explicit adapter assertion.
 * It must exclusively stage new artifacts, honor abort signals, and quarantine
 * partial evidence on abort, including a timed-out write, without deleting it or
 * marking it complete. Cleanup/deletion needs separate caller authority. Its
 * completion is conditional on this trusted adapter contract. No rows are returned.
 * Majority cursors to EOF prove bounded enumeration, NOT a cross-collection point
 * in time or producer drain. Operator must separately establish those conditions.
 *
 * Offline consumption: read the inventory files from the private sink in receipt
 * order; pass their bytes and receipt.namespaces to compareCup83WebCustody with
 * the independently pinned pre-drain capture identity/hash and ignoreUndefined:false.
 */
function prepareLive(support, expected) {
  exact(expected, ['identity', 'supportPrototype', 'persistencePrototype', 'backends'], 'EXPECTED_SHAPE');
  exact(expected.identity, ['sourceEpoch', 'pid', 'start', 'nodeVersion'], 'PROCESS_IDENTITY');
  need(expected.identity.sourceEpoch === SOURCE && expected.identity.pid === process.pid
    && expected.identity.start === String(performance.timeOrigin) && expected.identity.nodeVersion === process.version, 'PROCESS_IDENTITY');
  need(object(expected.supportPrototype) && object(expected.persistencePrototype)
    && Object.getPrototypeOf(support) === expected.supportPrototype, 'INSTANCE_IDENTITY');
  const persistence = own(support, 'persistence');
  need(Object.getPrototypeOf(persistence) === expected.persistencePrototype, 'INSTANCE_IDENTITY');
  const states = own(persistence, 'backendStates'), configs = own(persistence, 'backendConfigs');
  need(states instanceof Map && states.size >= 1 && states.size <= 3 && states.has('primary')
    && Array.isArray(configs) && configs.length === states.size && Array.isArray(expected.backends)
    && expected.backends.length === states.size, 'BACKEND_SET');
  const configKeys = new Set(), saved = [];
  for (const config of configs) {
    const key = own(config, 'key');
    need(!configKeys.has(key) && states.get(key)?.config === config, 'BACKEND_SET'); configKeys.add(key);
  }
  for (const binding of expected.backends) {
    exact(binding, ['key', 'client', 'db', 'dbName', 'collections', 'topology'], 'BACKEND_BINDING');
    need(states.has(binding.key), 'BACKEND_SET');
    const state = states.get(binding.key), config = own(state, 'config');
    need(own(config, 'key') === binding.key, 'BACKEND_BINDING');
    need(own(state, 'client') === binding.client && own(state, 'db') === binding.db, 'DRIVER_OR_HANDLE');
    need(own(config, 'dbName') === binding.dbName, 'DATABASE_IDENTITY');
    const collections = cup83InventoryCollections(own(config, 'collections'));
    need(isDeepStrictEqual(collections, cup83InventoryCollections(binding.collections)), 'COLLECTION_IDENTITY');
    saved.push({ state, config, binding, collections });
  }
  const validateSource = () => {
    need(own(persistence, 'backendStates') === states && states.size === saved.length
      && own(persistence, 'backendConfigs') === configs && configs.length === saved.length, 'BACKEND_DRIFT');
    for (const b of saved) need(states.get(b.binding.key) === b.state && configs.includes(b.config)
      && own(b.state, 'config') === b.config && own(b.config, 'key') === b.binding.key
      && own(b.state, 'client') === b.binding.client && own(b.state, 'db') === b.binding.db
      && own(b.config, 'dbName') === b.binding.dbName
      && isDeepStrictEqual(cup83InventoryCollections(own(b.config, 'collections')), b.collections), 'BACKEND_DRIFT');
  };
  return { identity: expected.identity, backends: expected.backends, validateSource };
}

export function collectCup83DurableInventory({ support, expected, sink, limits = {} }) {
  return scanCup83DurableInventory({ sink, limits, prepare: () => prepareLive(support, expected) });
}

/** Explicit synchronous LIVE mapping-only capture. Returns PRIVATE bytes for an
 * authorized private sink; do not log them. Reads only the pinned actual instance,
 * persistence state, connected handles/topology and full six collection names.
 * No Mongo queries, hydration, row reads or URI/env access. It proves no durable
 * completeness/drain and does not raise the live collector's 20k/64MiB bounds. */
export function captureCup83LiveMapping({ support, expected }) {
  try {
    const source = prepareLive(support, expected);
    const { bindings, validateBackends } = bindCup83DurableBackends(source.backends);
    source.validateSource(); validateBackends();
    const capture = Buffer.from(JSON.stringify({ schema: 'PHAB_CUP83_LIVE_MAPPING_CAPTURE_V1',
      identity: source.identity, driverVersion: '6.21.0', backends: bindings.map(b => ({
        key: b.binding.key, dbName: b.binding.dbName, collections: b.collections, topology: b.cluster,
        fingerprint: b.fingerprint, collectionsSha256: b.collectionsSha256 })),
      durableCompletenessProven: false, producerDrainProven: false, restartAuthorized: false }) + '\n');
    need(capture.length <= 1024 * 1024, 'MAPPING_CAPTURE_BOUND');
    return { capture, sha256: createHash('sha256').update(capture).digest('hex') };
  } catch (error) { throw new Error(error instanceof Cup83InventoryRefusal ? error.message : 'MAPPING_CAPTURE_FAILED'); }
}
