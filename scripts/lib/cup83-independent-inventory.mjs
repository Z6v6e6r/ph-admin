// Explicit independent read-only invocation. No env, CLI, runtime hook or top-level connection.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MongoClient } from 'mongodb';
import { Cup83InventoryRefusal, cup83DurableNamespaceBinding, cup83InventoryCollections,
  scanCup83DurableInventory } from './cup83-durable-scan.mjs';
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const SCHEMA = 'PHAB_CUP83_DURABLE_MAPPING_MANIFEST_V1';
const MAPPING_SCHEMA = 'PHAB_CUP83_LIVE_MAPPING_CAPTURE_V1';
const MAPPING_MANIFEST = 'PHAB_CUP83_DURABLE_MAPPING_MANIFEST_V2';
const need = (ok, code) => { if (!ok) throw new Cup83InventoryRefusal(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys, code) => need(object(v)
  && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), code);
const bytes = value => Buffer.from(JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exported = ['clients', 'dialogs', 'messages', 'serviceMessages', 'outbox'];
function identity(value) {
  exact(value, ['sourceEpoch', 'pid', 'start', 'nodeVersion'], 'SOURCE_IDENTITY');
  need(value.sourceEpoch === SOURCE && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.start === 'string' && /^\d{1,20}(\.\d{1,10})?$/.test(value.start)
    && typeof value.nodeVersion === 'string' && /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.nodeVersion), 'SOURCE_IDENTITY');
}
function parse(raw, expectedSha256) {
  need(Buffer.isBuffer(raw) && raw.length <= 1024 * 1024 && digest(expectedSha256)
    && hash(raw) === expectedSha256, 'PRIVATE_INPUT_HASH_OR_BOUND');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new Cup83InventoryRefusal('PRIVATE_INPUT_JSON'); }
  need(bytes(value).equals(raw), 'PRIVATE_INPUT_SERIALIZATION'); return value;
}
function mappings(backends, withHashes) {
  need(Array.isArray(backends) && backends.length >= 1 && backends.length <= 3, 'MANIFEST_BACKENDS');
  const keys = new Set();
  for (const b of backends) {
    exact(b, ['key', 'dbName', 'collections', 'topology', ...(withHashes ? ['fingerprint', 'collectionsSha256'] : [])], 'MANIFEST_BACKEND');
    need(['primary', 'web', 'max'].includes(b.key) && !keys.has(b.key), 'MANIFEST_BACKENDS'); keys.add(b.key);
    const computed = cup83DurableNamespaceBinding({ topology: b.topology, dbName: b.dbName, collections: b.collections });
    if (withHashes) need(b.fingerprint === computed.fingerprint && b.collectionsSha256 === computed.collectionsSha256, 'MANIFEST_MAPPING_HASH');
  }
  need(keys.has('primary'), 'MANIFEST_BACKENDS');
}
function directUri(uri) {
  need(typeof uri === 'string' && uri.length <= 16384 && uri.startsWith('mongodb://')
    && !uri.includes('#') && !/[\x00-\x20]/.test(uri), 'CONNECTION_URI');
  const index = uri.indexOf('?'), options = new URLSearchParams(index < 0 ? '' : uri.slice(index + 1)), seen = new Set();
  for (const [rawKey, value] of options) {
    const key = rawKey.toLowerCase();
    // Only the ordinary explicit direct/SCRAM options have an admitted consumer.
    // No SRV DNS branch, file-backed TLS, external auth, proxies or option paths.
    need(['authsource', 'authmechanism', 'replicaset', 'directconnection', 'tls', 'ssl'].includes(key)
      && !seen.has(key) && value.length > 0 && value.length <= 200, 'CONNECTION_URI_OPTIONS'); seen.add(key);
    if (key === 'authmechanism') need(['DEFAULT', 'SCRAM-SHA-1', 'SCRAM-SHA-256'].includes(value.toUpperCase()), 'CONNECTION_URI_OPTIONS');
    if (['directconnection', 'tls', 'ssl'].includes(key)) need(['true', 'false'].includes(value), 'CONNECTION_URI_OPTIONS');
  }
}

/** Build PRIVATE manifest bytes from the actual pre-stop collector provenance.
 * expected = {provenanceSha256,sourceIdentity,backends:[{key,dbName,collections,topology}]}.
 * Source capture linkage means precisely PHAB_CUP83_DURABLE_PROVENANCE_V1 bytes,
 * not the in-memory Map capture. Full six-name mappings are explicit pre-stop
 * bindings: legacy provenance records only five names; its all-six hash verifies
 * responseMetrics without guessing or changing that legacy artifact's shape.
 * Alternative: {mappingCapture,expected:{mappingCaptureSha256,sourceIdentity}}
 * accepts actual captureCup83LiveMapping bytes without scanning any live rows.
 * It produces V2 with exact sourceCapture schema/hash linkage, never a fabricated
 * complete provenance. Returned private manifest bytes must not be logged.
 */
export function buildCup83DurableMappingManifest({ provenance, mappingCapture, expected }) {
  try {
    if (mappingCapture !== undefined) {
      need(provenance === undefined, 'MANIFEST_CAPTURE_SET');
      exact(expected, ['mappingCaptureSha256', 'sourceIdentity'], 'MANIFEST_EXPECTED'); identity(expected.sourceIdentity);
      const value = parse(mappingCapture, expected.mappingCaptureSha256);
      exact(value, ['schema', 'identity', 'driverVersion', 'backends', 'durableCompletenessProven', 'producerDrainProven', 'restartAuthorized'], 'MAPPING_CAPTURE');
      need(value.schema === MAPPING_SCHEMA && value.driverVersion === '6.21.0'
        && isDeepStrictEqual(value.identity, expected.sourceIdentity) && value.durableCompletenessProven === false
        && value.producerDrainProven === false && value.restartAuthorized === false, 'MAPPING_CAPTURE');
      mappings(value.backends, true);
      const manifest = bytes({ schema: MAPPING_MANIFEST, sourceIdentity: value.identity,
        sourceCapture: { schema: MAPPING_SCHEMA, sha256: expected.mappingCaptureSha256 }, backends: value.backends });
      return { manifest, sha256: hash(manifest) };
    }
    exact(expected, ['provenanceSha256', 'sourceIdentity', 'backends'], 'MANIFEST_EXPECTED');
    identity(expected.sourceIdentity); mappings(expected.backends, false);
    const value = parse(provenance, expected.provenanceSha256);
    exact(value, ['schema', 'identity', 'driverVersion', 'namespaces', 'producerDrainProven', 'pointInTimeProven', 'restartAuthorized'], 'SOURCE_PROVENANCE');
    need(value.schema === 'PHAB_CUP83_DURABLE_PROVENANCE_V1' && value.driverVersion === '6.21.0'
      && isDeepStrictEqual(value.identity, expected.sourceIdentity) && value.producerDrainProven === false
      && value.pointInTimeProven === false && value.restartAuthorized === false
      && Array.isArray(value.namespaces) && value.namespaces.length >= 1 && value.namespaces.length <= 3, 'SOURCE_PROVENANCE');
    const groups = new Map(), manifestBackends = expected.backends.map(b => {
      const computed = cup83DurableNamespaceBinding({ topology: b.topology, dbName: b.dbName, collections: b.collections });
      const result = { key: b.key, dbName: b.dbName, collections: cup83InventoryCollections(b.collections),
        topology: structuredClone(b.topology), fingerprint: computed.fingerprint, collectionsSha256: computed.collectionsSha256 };
      if (!groups.has(result.fingerprint)) groups.set(result.fingerprint, []);
      groups.get(result.fingerprint).push(result); return result;
    });
    need(groups.size === value.namespaces.length, 'SOURCE_NAMESPACE_SET');
    const seen = new Set();
    for (const n of value.namespaces) {
      exact(n, ['fingerprint', 'collectionsSha256', 'backendKeys', 'topology', 'dbName', 'collections', 'readPreference', 'readConcern', 'complete'], 'SOURCE_NAMESPACE');
      const matching = groups.get(n.fingerprint);
      need(matching && !seen.has(n.fingerprint) && n.collectionsSha256 === matching[0].collectionsSha256
        && n.dbName === matching[0].dbName && isDeepStrictEqual(n.topology, matching[0].topology)
        && Array.isArray(n.backendKeys) && isDeepStrictEqual([...n.backendKeys].sort(), matching.map(b => b.key).sort())
        && n.readPreference === 'primary' && n.readConcern === 'majority' && n.complete === true
        && Array.isArray(n.collections) && n.collections.length === exported.length, 'SOURCE_NAMESPACE');
      seen.add(n.fingerprint); const kinds = new Set();
      for (const c of n.collections) {
        exact(c, ['kind', 'collection', 'count', 'eof', ...(Object.hasOwn(c, 'readFromFingerprint') ? ['readFromFingerprint'] : [])], 'SOURCE_COLLECTION');
        need(exported.includes(c.kind) && !kinds.has(c.kind) && c.collection === matching[0].collections[c.kind]
          && Number.isSafeInteger(c.count) && c.count >= 0 && c.count <= 20000 && c.eof === true
          && (!Object.hasOwn(c, 'readFromFingerprint') || groups.has(c.readFromFingerprint)), 'SOURCE_COLLECTION'); kinds.add(c.kind);
      }
    }
    const manifest = bytes({ schema: SCHEMA, sourceIdentity: structuredClone(expected.sourceIdentity),
      sourceProvenanceSha256: expected.provenanceSha256, backends: manifestBackends });
    return { manifest, sha256: hash(manifest) };
  } catch (error) { throw new Error(error instanceof Cup83InventoryRefusal ? error.message : 'MANIFEST_BUILD_FAILED'); }
}

/** Explicit private descriptors = [{key,uri,dbName,collections}]. The guard is a
 * trusted operator dependency, not a proof created here. It receives {phase,
 * sourceIdentity,sourceProvenanceSha256,signal} and must return exactly
 * {schema:'PHAB_CUP83_STOP_GUARD_V1',sourceIdentity,stopped:true,checkedAt,evidenceSha256}.
 * checkedAt must be canonical UTC ISO, no future timestamp, at most 5000ms old;
 * each callback has a <=5000ms wait. Real Linux evidence/actor exclusion remains
 * the operator's responsibility. The three checks do not prove other writers
 * drained, a cross-collection snapshot, or permission to restart.
 *
 * MongoClientCtor defaults to the pinned driver, injectable only for synthetic
 * actual-driver subclasses. All clients are owned/closed here; no old handles or
 * fake SupportService/PID are used. Credentials/URI never enter artifacts/results.
 * Admitted URIs are mongodb:// only, with optional authSource/authMechanism,
 * replicaSet/directConnection and TLS/SSL booleans using default CA trust. Only
 * default/SCRAM-SHA-1/SCRAM-SHA-256 auth is supported; unknown/duplicate options,
 * SRV, credential mechanisms/properties and TLS file paths refuse BEFORE client
 * construction. A real URI still needs operator read-only target admission.
 * Native connection timeouts and finally-close are bounded; JavaScript cannot
 * hard-preempt blocked OS/network work. No generic credential resolver is used.
 * POST_STOP alone admits32768 rows/collection and a conservative charge up to
 * 6*64MiB; actual serialized output stays64MiB. The live collector remains20k,
 * charge/output64MiB. Run this reader in its separately owned bounded process;
 * no live process heap setting is changed or increased by these helpers.
 * The sink is unchanged; caller releases its optional fd with close after success.
 */
export async function collectCup83IndependentInventory({ connections, manifest, expected, stopGuard,
  sink, limits = {}, MongoClientCtor = MongoClient }) {
  const owned = [], proofs = [];
  const readerIdentity = { pid: process.pid, start: String(performance.timeOrigin), nodeVersion: process.version };
  let cleanupMS = 1000, collectorReceipt, validatedManifest, manifestSha256, sourceCapture, scanBudget, success = false, failure;
  const bounded = async (operation, code) => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), cleanupMS);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    collectorReceipt = await scanCup83DurableInventory({ sink, limits, profile: 'POST_STOP', prepare: async ({ run, settings, signal }) => {
      cleanupMS = settings.cleanupMS;
      need(object(expected), 'INDEPENDENT_EXPECTED');
      identity(expected.sourceIdentity);
      manifestSha256 = expected.manifestSha256;
      validatedManifest = parse(manifest, manifestSha256);
      if (validatedManifest.schema === SCHEMA) {
        exact(expected, ['manifestSha256', 'sourceIdentity', 'sourceProvenanceSha256'], 'INDEPENDENT_EXPECTED');
        exact(validatedManifest, ['schema', 'sourceIdentity', 'sourceProvenanceSha256', 'backends'], 'MANIFEST_SHAPE');
        need(isDeepStrictEqual(validatedManifest.sourceIdentity, expected.sourceIdentity) && digest(expected.sourceProvenanceSha256)
          && validatedManifest.sourceProvenanceSha256 === expected.sourceProvenanceSha256, 'MANIFEST_SOURCE');
        sourceCapture = { schema: 'PHAB_CUP83_DURABLE_PROVENANCE_V1', sha256: validatedManifest.sourceProvenanceSha256 };
      } else {
        need(validatedManifest.schema === MAPPING_MANIFEST, 'MANIFEST_SHAPE');
        exact(expected, ['manifestSha256', 'sourceIdentity', 'sourceCapture'], 'INDEPENDENT_EXPECTED');
        exact(validatedManifest, ['schema', 'sourceIdentity', 'sourceCapture', 'backends'], 'MANIFEST_SHAPE');
        exact(validatedManifest.sourceCapture, ['schema', 'sha256'], 'MANIFEST_SOURCE');
        need(isDeepStrictEqual(validatedManifest.sourceIdentity, expected.sourceIdentity)
          && validatedManifest.sourceCapture.schema === MAPPING_SCHEMA && digest(validatedManifest.sourceCapture.sha256)
          && isDeepStrictEqual(validatedManifest.sourceCapture, expected.sourceCapture), 'MANIFEST_SOURCE');
        sourceCapture = structuredClone(validatedManifest.sourceCapture);
      }
      mappings(validatedManifest.backends, true);
      need(typeof stopGuard === 'function', 'STOP_GUARD_REQUIRED');
      need(Array.isArray(connections) && connections.length === validatedManifest.backends.length, 'CONNECTION_SET');
      const selected = [], seen = new Set();
      for (const descriptor of connections) {
        exact(descriptor, ['key', 'uri', 'dbName', 'collections'], 'CONNECTION_DESCRIPTOR');
        const target = validatedManifest.backends.find(b => b.key === descriptor.key);
        need(target && !seen.has(descriptor.key) && descriptor.dbName === target.dbName
          && isDeepStrictEqual(cup83InventoryCollections(descriptor.collections), target.collections), 'CONNECTION_MAPPING');
        directUri(descriptor.uri);
        seen.add(descriptor.key); selected.push({ uri: descriptor.uri, target });
      }
      const guard = async phase => {
        let proof;
        try { proof = await run(() => stopGuard({ phase, sourceIdentity: structuredClone(validatedManifest.sourceIdentity),
          sourceCapture: structuredClone(sourceCapture),
          ...(validatedManifest.schema === SCHEMA ? { sourceProvenanceSha256: validatedManifest.sourceProvenanceSha256 } : {}), signal })); }
        catch { throw new Cup83InventoryRefusal('STOP_GUARD_UNAVAILABLE'); }
        exact(proof, ['schema', 'sourceIdentity', 'stopped', 'checkedAt', 'evidenceSha256'], 'STOP_GUARD_PROOF');
        const timestamp = typeof proof.checkedAt === 'string' ? Date.parse(proof.checkedAt) : NaN, now = Date.now();
        need(proof.schema === 'PHAB_CUP83_STOP_GUARD_V1' && proof.stopped === true
          && isDeepStrictEqual(proof.sourceIdentity, validatedManifest.sourceIdentity) && digest(proof.evidenceSha256)
          && Number.isFinite(timestamp) && new Date(timestamp).toISOString() === proof.checkedAt
          && timestamp <= now && now - timestamp <= 5000, 'STOP_GUARD_PROOF');
        proofs.push({ phase, sha256: hash(bytes(proof)), proof: structuredClone(proof) });
      };
      await guard('BEFORE_CONNECT');
      const backends = [];
      for (const { uri, target } of selected) {
        let client;
        try {
          client = new MongoClientCtor(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
            socketTimeoutMS: 5000, timeoutMS: 5000, maxPoolSize: 1, retryReads: false,
            readPreference: 'primary', readConcern: { level: 'majority' }, monitorCommands: false,
            mongodbLogComponentSeverities: { default: 'off' } });
          need(client instanceof MongoClient, 'DRIVER_OR_HANDLE'); owned.push(client);
          await run(() => client.connect());
        } catch (error) { throw new Cup83InventoryRefusal(error instanceof Cup83InventoryRefusal
          && error.message === 'OPERATION_TIMEOUT' ? 'INDEPENDENT_CONNECT_TIMEOUT' : 'INDEPENDENT_CONNECT_FAILED'); }
        backends.push({ key: target.key, client, db: client.db(target.dbName), dbName: target.dbName,
          collections: structuredClone(target.collections), topology: structuredClone(target.topology) });
      }
      await guard('BEFORE_SCAN');
      return { identity: validatedManifest.sourceIdentity, backends, validateSource: () => {},
        afterScan: () => guard('AFTER_SCAN'), createProvenance: (namespaces, budget) => {
          scanBudget = budget;
          return { schema: validatedManifest.schema === SCHEMA ? 'PHAB_CUP83_INDEPENDENT_DURABLE_PROVENANCE_V1'
            : 'PHAB_CUP83_INDEPENDENT_DURABLE_PROVENANCE_V2', sourceIdentity: validatedManifest.sourceIdentity,
          readerIdentity, sourceCapture, mappingManifestSha256: manifestSha256, driverVersion: '6.21.0',
          stopProofs: proofs, namespaces, scanBudget,
          producerDrainProven: false, pointInTimeProven: false, restartAuthorized: false };
        } };
    } });
    success = true;
  } catch (error) { failure = error; }
  finally {
    const closed = await Promise.allSettled(owned.map(client => bounded(() => client.close(), 'INDEPENDENT_CLOSE_FAILED')));
    if (closed.some(result => result.status === 'rejected')) {
      failure = new Error('INDEPENDENT_CLOSE_FAILED');
      // A late close failure invalidates even a written completion; quarantine
      // preserves its bytes. The filesystem adapter keeps its fd until acceptance.
      if (success) try {
        await bounded(() => sink.abort({ signal: AbortSignal.timeout(cleanupMS) }), 'INDEPENDENT_SINK_ABORT_FAILED');
      } catch { failure = new Error('INDEPENDENT_CLEANUP_FAILED'); }
    }
  }
  if (failure) throw failure;
  return { status: 'BOUNDED_INDEPENDENT_DURABLE_INVENTORIES_COLLECTED', collectorReceipt, readerIdentity,
    ...(validatedManifest.schema === SCHEMA ? { sourceProvenanceSha256: validatedManifest.sourceProvenanceSha256 } : { sourceCapture }),
    mappingManifestSha256: manifestSha256, scanBudget,
    stopProofSha256: proofs.map(({ phase, sha256 }) => ({ phase, sha256 })),
    producerDrainProven: false, pointInTimeProven: false, restartAuthorized: false };
}
