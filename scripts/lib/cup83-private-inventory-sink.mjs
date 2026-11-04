// Private local artifact adapter only; no runtime hook, database or network path.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const OWNER = '.cup83-inventory-owner.json';
const COMPLETION = 'cup83-durable-completion.json';
const QUARANTINE = 'cup83-durable-quarantine.json';
const PROVENANCE = 'cup83-durable-provenance.json';
const defaults = { maxBytes: 64 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024,
  maxFiles: 4, chunkBytes: 65536, writeMS: 5000, totalMS: 30000 };
const kinds = ['commands', 'messages', 'serviceMessages', 'dialogs', 'clients'];
class Refusal extends Error {}
const need = (ok, code) => { if (!ok) throw new Refusal(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys, code) => need(object(v)
  && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), code);
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const encode = v => Buffer.from(JSON.stringify(v) + '\n');
const hash = v => createHash('sha256').update(v).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const safeError = error => new Error(error instanceof Refusal ? error.message
  : error?.name === 'AbortError' ? 'PRIVATE_SINK_ABORTED' : 'PRIVATE_SINK_IO');

/** Operator must create/protect the exact directory and supply its fresh dev/ino
 * preimage plus expectedUid. No mkdir, chmod, chown, rename or deletion occurs.
 * Exclusive operator ownership is required throughout: checks detect drift but
 * cannot exclude a malicious concurrent process running as that same UID.
 *
 * The returned object implements collectCup83DurableInventory's sink contract.
 * Files are exclusive 0600, symlinks/hardlinks refuse, file and directory are
 * fsynced. abort preserves files IN PLACE and writes a quarantine marker; that
 * marker overrides any completion artifact. A partial/uncertain owner, completion
 * or quarantine file forbids replay. Cleanup is a separately authorized operation.
 *
 * Byte/count/deadline checks and event-loop yields bound cooperative writes.
 * In-process JavaScript cannot preempt a blocked OS write/fsync syscall. No success
 * receipt claims database completeness, producer drain, restart or live authority.
 */
export function createCup83PrivateInventorySink({ directory, expectedUid, expectedDirectory, limits = {} }) {
  let dirfd;
  try {
    need(typeof process.getuid === 'function' && Number.isInteger(fs.constants.O_NOFOLLOW)
      && Number.isInteger(fs.constants.O_DIRECTORY), 'PRIVATE_SINK_PLATFORM');
    need(Number.isSafeInteger(expectedUid) && expectedUid >= 0 && expectedUid === process.getuid(), 'PRIVATE_SINK_UID');
    exact(expectedDirectory, ['dev', 'ino'], 'PRIVATE_SINK_IDENTITY');
    need(Object.values(expectedDirectory).every(v => Number.isSafeInteger(v) && v >= 0), 'PRIVATE_SINK_IDENTITY');
    need(object(limits) && Object.keys(limits).every(k => Object.hasOwn(defaults, k)), 'PRIVATE_SINK_LIMITS');
    const settings = { ...defaults, ...limits };
    for (const [key, value] of Object.entries(settings))
      need(Number.isSafeInteger(value) && value > 0 && value <= defaults[key], 'PRIVATE_SINK_LIMITS');
    need(typeof directory === 'string' && path.isAbsolute(directory) && path.resolve(directory) === directory
      && fs.realpathSync(directory) === directory, 'PRIVATE_SINK_DIRECTORY');
    const initial = fs.lstatSync(directory);
    const privateDirectory = stat => stat.isDirectory() && !stat.isSymbolicLink()
      && stat.uid === expectedUid && (stat.mode & 0o7777) === 0o700;
    need(privateDirectory(initial) && same(initial, expectedDirectory), 'PRIVATE_SINK_DIRECTORY');
    const ancestry = [];
    for (let current = path.dirname(directory);; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      need(stat.isDirectory() && !stat.isSymbolicLink() && [0, expectedUid].includes(stat.uid)
        && (!(stat.mode & 0o022) || stat.uid === 0 && (stat.mode & 0o1000) !== 0), 'PRIVATE_SINK_ANCESTRY');
      ancestry.push({ path: current, stat });
      if (path.dirname(current) === current) break;
    }
    dirfd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    need(same(fs.fstatSync(dirfd), initial), 'PRIVATE_SINK_DRIFT');
    const directoryFd = dirfd;
    let phase = 'OPEN', active, aborting, artifactBytes = 0, closed = false;
    const started = performance.now(), files = new Map();
    const closeDirectory = () => {
      if (!closed) { closed = true; try { fs.closeSync(directoryFd); } catch (error) { throw safeError(error); } }
    };
    const revalidate = () => {
      need(!closed, 'PRIVATE_SINK_CLOSED');
      const after = fs.lstatSync(directory), opened = fs.fstatSync(directoryFd);
      need(privateDirectory(after) && privateDirectory(opened) && same(after, initial) && same(opened, initial)
        && fs.realpathSync(directory) === directory, 'PRIVATE_SINK_DRIFT');
      for (const entry of ancestry) {
        const now = fs.lstatSync(entry.path);
        need(now.isDirectory() && !now.isSymbolicLink() && same(now, entry.stat)
          && now.uid === entry.stat.uid && now.mode === entry.stat.mode, 'PRIVATE_SINK_ANCESTRY_DRIFT');
      }
    };
    const privateFile = (stat, record, size) => stat.isFile() && !stat.isSymbolicLink()
      && stat.uid === expectedUid && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1
      && same(stat, record) && stat.size === size;
    const verifyFile = (file, record, size) => {
      need(privateFile(fs.lstatSync(path.join(directory, file)), record, size), 'PRIVATE_SINK_FILE_DRIFT');
    };
    const check = (signal, deadline, allowed) => {
      need(signal instanceof AbortSignal, 'PRIVATE_SINK_SIGNAL');
      need(!signal.aborted && (allowed === 'QUARANTINE' || !['ABORTING', 'QUARANTINED'].includes(phase)), 'PRIVATE_SINK_ABORTED');
      need(performance.now() <= deadline, 'PRIVATE_SINK_TIMEOUT'); revalidate();
    };
    // Small fixed metadata and data writes share the same exclusive custody rules.
    const writeFile = async (file, payload, signal, deadline, allowed) => {
      let fd, record, position = 0;
      try {
        check(signal, deadline, allowed);
        fd = fs.openSync(path.join(directory, file), fs.constants.O_WRONLY | fs.constants.O_CREAT
          | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        record = fs.fstatSync(fd);
        need(privateFile(record, record, 0), 'PRIVATE_SINK_FILE_MODE');
        while (position < payload.length) {
          check(signal, deadline, allowed);
          const length = Math.min(settings.chunkBytes, payload.length - position);
          const count = fs.writeSync(fd, payload, position, length, position);
          need(Number.isSafeInteger(count) && count > 0 && count <= length, 'PRIVATE_SINK_WRITE_PROGRESS');
          position += count;
          need(privateFile(fs.fstatSync(fd), record, position), 'PRIVATE_SINK_FILE_DRIFT');
          verifyFile(file, record, position);
          if (position < payload.length) await nextTurn(undefined, { signal });
        }
        check(signal, deadline, allowed); fs.fsyncSync(fd); check(signal, deadline, allowed);
        fs.closeSync(fd); fd = undefined;
        verifyFile(file, record, payload.length); fs.fsyncSync(directoryFd); check(signal, deadline, allowed);
        const sha256 = hash(payload); check(signal, deadline, allowed);
        return { dev: record.dev, ino: record.ino, bytes: payload.length, sha256 };
      } finally { if (fd !== undefined) fs.closeSync(fd); }
    };
    // Synchronous exclusive marker pins this one invocation before returning a sink.
    const ownerPayload = encode({ schema: 'PHAB_CUP83_PRIVATE_SINK_OWNER_V1', pid: process.pid, uid: expectedUid });
    let ownerFd, owner;
    try {
      revalidate();
      for (const name of [COMPLETION, QUARANTINE]) {
        try { fs.lstatSync(path.join(directory, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new Refusal('PRIVATE_SINK_NO_REPLAY');
      }
      ownerFd = fs.openSync(path.join(directory, OWNER), fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      owner = fs.fstatSync(ownerFd); need(privateFile(owner, owner, 0), 'PRIVATE_SINK_FILE_MODE');
      const written = fs.writeSync(ownerFd, ownerPayload);
      need(written === ownerPayload.length, 'PRIVATE_SINK_WRITE_PROGRESS');
      fs.fsyncSync(ownerFd); fs.closeSync(ownerFd); ownerFd = undefined;
      fs.fsyncSync(directoryFd); revalidate(); verifyFile(OWNER, owner, ownerPayload.length);
    } finally { if (ownerFd !== undefined) fs.closeSync(ownerFd); }
    const start = (nextPhase, task) => {
      if (phase !== 'OPEN' || active) return Promise.reject(new Error('PRIVATE_SINK_STATE'));
      phase = nextPhase;
      const deadline = Math.min(started + settings.totalMS, performance.now() + settings.writeMS);
      active = (async () => {
        try {
          revalidate(); verifyFile(OWNER, owner, ownerPayload.length);
          const result = await task(deadline);
          need(phase === nextPhase, 'PRIVATE_SINK_ABORTED');
          phase = nextPhase === 'COMPLETING' ? 'COMPLETE' : 'OPEN';
          return result;
        } catch (error) {
          if (phase !== 'ABORTING') phase = 'FAILED';
          throw safeError(error);
        } finally { active = undefined; }
      })();
      return active;
    };
    const validateReceipt = receipt => {
      exact(receipt, ['status', 'namespaces', 'provenanceSha256', 'backendAliases', 'counts',
        'producerDrainProven', 'pointInTimeProven', 'restartAuthorized'], 'PRIVATE_SINK_RECEIPT');
      need(receipt.status === 'BOUNDED_DURABLE_INVENTORIES_COLLECTED' && receipt.producerDrainProven === false
        && receipt.pointInTimeProven === false && receipt.restartAuthorized === false
        && digest(receipt.provenanceSha256) && Array.isArray(receipt.namespaces)
        && receipt.namespaces.length >= 1 && receipt.namespaces.length <= 3, 'PRIVATE_SINK_RECEIPT');
      const namespaces = new Set();
      for (const n of receipt.namespaces) {
        exact(n, ['fingerprint', 'collectionsSha256', 'sha256'], 'PRIVATE_SINK_RECEIPT');
        need(Object.values(n).every(digest) && !namespaces.has(n.fingerprint), 'PRIVATE_SINK_RECEIPT');
        namespaces.add(n.fingerprint);
        need(files.get('cup83-durable-' + n.fingerprint + '.json')?.sha256 === n.sha256, 'PRIVATE_SINK_RECEIPT_HASH');
      }
      need(files.size === namespaces.size + 1 && files.get(PROVENANCE)?.sha256 === receipt.provenanceSha256,
        'PRIVATE_SINK_RECEIPT_HASH');
      need(Array.isArray(receipt.backendAliases) && receipt.backendAliases.length >= namespaces.size
        && receipt.backendAliases.length <= 3, 'PRIVATE_SINK_RECEIPT');
      const keys = new Set();
      for (const alias of receipt.backendAliases) {
        exact(alias, ['key', 'fingerprint'], 'PRIVATE_SINK_RECEIPT');
        need(['primary', 'web', 'max'].includes(alias.key) && !keys.has(alias.key)
          && namespaces.has(alias.fingerprint), 'PRIVATE_SINK_RECEIPT'); keys.add(alias.key);
      }
      need(new Set(receipt.backendAliases.map(a => a.fingerprint)).size === namespaces.size, 'PRIVATE_SINK_RECEIPT');
      need(keys.has('primary') && Array.isArray(receipt.counts) && receipt.counts.length === namespaces.size, 'PRIVATE_SINK_RECEIPT');
      const counted = new Set();
      for (const entry of receipt.counts) {
        exact(entry, ['fingerprint', 'counts'], 'PRIVATE_SINK_RECEIPT'); exact(entry.counts, kinds, 'PRIVATE_SINK_RECEIPT');
        need(namespaces.has(entry.fingerprint) && !counted.has(entry.fingerprint)
          && Object.values(entry.counts).every(v => Number.isSafeInteger(v) && v >= 0 && v <= 20000), 'PRIVATE_SINK_RECEIPT');
        counted.add(entry.fingerprint);
      }
      const payload = encode(receipt); need(payload.length <= 16384, 'PRIVATE_SINK_RECEIPT'); return payload;
    };
    const sink = {
      private: true,
      write(file, payload, { signal } = {}) {
        return start('WRITING', async deadline => {
          need(typeof file === 'string' && (file === PROVENANCE || /^cup83-durable-[a-f0-9]{64}\.json$/.test(file)), 'PRIVATE_SINK_FILENAME');
          need(Buffer.isBuffer(payload) && payload.length > 0 && payload.length <= settings.maxFileBytes
            && artifactBytes + payload.length <= settings.maxBytes && files.size < settings.maxFiles, 'PRIVATE_SINK_BOUND');
          need(!files.has(file), 'PRIVATE_SINK_NO_OVERWRITE');
          const record = await writeFile(file, payload, signal, deadline);
          files.set(file, record); artifactBytes += record.bytes;
          return { sha256: record.sha256, bytes: record.bytes };
        });
      },
      complete(receipt, { signal } = {}) {
        return start('COMPLETING', async deadline => {
          const payload = validateReceipt(receipt);
          for (const [file, record] of files) {
            check(signal, deadline); verifyFile(file, record, record.bytes);
            let fd;
            try {
              fd = fs.openSync(path.join(directory, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
              need(privateFile(fs.fstatSync(fd), record, record.bytes), 'PRIVATE_SINK_FILE_DRIFT');
              const digest = createHash('sha256'), chunk = Buffer.alloc(Math.min(settings.chunkBytes, record.bytes));
              let position = 0;
              while (position < record.bytes) {
                check(signal, deadline);
                const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, record.bytes - position), position);
                need(count > 0, 'PRIVATE_SINK_READBACK'); digest.update(chunk.subarray(0, count)); position += count;
                if (position < record.bytes) await nextTurn(undefined, { signal });
              }
              need(digest.digest('hex') === record.sha256, 'PRIVATE_SINK_READBACK');
              need(privateFile(fs.fstatSync(fd), record, record.bytes), 'PRIVATE_SINK_FILE_DRIFT');
            } finally { if (fd !== undefined) fs.closeSync(fd); }
          }
          const stored = encode({ schema: 'PHAB_CUP83_PRIVATE_SINK_COMPLETION_V1', collectorReceipt: JSON.parse(payload),
            artifactCount: files.size, artifactBytes, quarantineOverridesCompletion: true });
          const record = await writeFile(COMPLETION, stored, signal, deadline);
          return { status: 'PRIVATE_INVENTORY_FILES_COMPLETE', completionSha256: record.sha256,
            artifactCount: files.size, artifactBytes, restartAuthorized: false };
        });
      },
      abort({ signal } = {}) {
        if (aborting) return aborting;
        if (phase === 'QUARANTINED') return Promise.resolve({ status: 'PRIVATE_INVENTORY_QUARANTINED', artifactCount: files.size });
        phase = 'ABORTING';
        aborting = (async () => {
          try {
            if (active) await active.catch(() => {});
            const payload = encode({ schema: 'PHAB_CUP83_PRIVATE_SINK_QUARANTINE_V1', status: 'QUARANTINED',
              recordedArtifactCount: files.size, recordedArtifactBytes: artifactBytes, partialArtifactsMayExist: true,
              completionInvalid: true, restartAuthorized: false });
            await writeFile(QUARANTINE, payload, signal, performance.now() + settings.writeMS, 'QUARANTINE');
            phase = 'QUARANTINED'; closeDirectory();
            return { status: 'PRIVATE_INVENTORY_QUARANTINED', artifactCount: files.size };
          } catch (error) { phase = 'FAILED'; closeDirectory(); throw safeError(error); }
        })();
        return aborting;
      }
    };
    // COMPLETE keeps the pinned directory fd until optional quarantine. No process
    // lifetime hook is registered; caller may release it explicitly after success.
    sink.close = () => { need(phase === 'COMPLETE' || phase === 'QUARANTINED', 'PRIVATE_SINK_STATE'); closeDirectory(); };
    dirfd = undefined;
    return sink;
  } catch (error) {
    if (dirfd !== undefined) try { fs.closeSync(dirfd); } catch { /* keep the original safe refusal */ }
    throw safeError(error);
  }
}
