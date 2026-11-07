// Read-only Linux observation for the exact CUP83 first-restart operator.
// Does not acquire locks, stop processes, read environment values or authorize restart.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const UNIT = 'phab-api-p32-2be5b1f.service';
const GROUP = `/sys/fs/cgroup/system.slice/${UNIT}`;
const LOCK = '/run/lock/phab-api-release.lock';
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (ok, code) => { if (!ok) throw Error(code); };
const defaults = {
  platform: process.platform, uid: () => process.getuid(), pid: () => process.pid,
  now: () => Date.now(), stat: p => fs.lstatSync(p),
  read(p) {
    const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const b = Buffer.alloc(1024 * 1024 + 1), n = fs.readSync(fd, b, 0, b.length, 0);
      need(n <= 1024 * 1024, 'STOP_GUARD_READ_LIMIT');
      return b.subarray(0, n).toString('utf8');
    } finally { fs.closeSync(fd); }
  },
  unit: () => execFileSync('/usr/bin/systemctl', ['show', UNIT,
    '--property=Id,LoadState,ActiveState,SubState,MainPID,ControlGroup,Job,NeedDaemonReload'],
  { encoding: 'utf8', timeout: 2000, maxBuffer: 16384, env: { PATH: '/usr/bin:/bin', LANG: 'C' } }),
};
function fields(text) {
  const out = Object.create(null);
  for (const line of text.trim().split('\n')) {
    const pos = line.indexOf('=');
    need(pos > 0 && !Object.hasOwn(out, line.slice(0, pos)), 'STOP_GUARD_UNIT');
    out[line.slice(0, pos)] = line.slice(pos + 1);
  }
  return out;
}
function processIdentity(pid, io) {
  const raw = io.read(`/proc/${pid}/stat`), end = raw.lastIndexOf(')');
  need(raw.startsWith(`${pid} (`) && end > 0, 'STOP_GUARD_PROCESS');
  const cols = raw.slice(end + 2).trim().split(/\s+/);
  need(cols.length >= 20 && /^\d+$/.test(cols[1]) && /^[1-9]\d*$/.test(cols[19]), 'STOP_GUARD_PROCESS');
  return { ppid: Number(cols[1]), startTicks: cols[19] };
}
function absent(path, io) {
  try { io.stat(path); return false; }
  catch (e) { if (e.code === 'ENOENT') return true; throw e; }
}

/** expected pins come from the operator's retained pre-stop capture. The caller
 * must own the existing release flock throughout scanning. Before/after evidence
 * is not a claim that unrelated Mongo/provider writers are drained. io is only
 * an explicit test seam; production callers use the default read-only adapters.
 */
export function createCup83StoppedProcessGuard(expected, io = defaults) {
  let snapshot;
  try { snapshot = JSON.parse(JSON.stringify(expected)); }
  catch { throw Error('STOP_GUARD_PINS'); }
  return async () => {
    try {
      const start = io.now(), { sourceIdentity: source, host, lockOwner } = snapshot;
      need(Object.keys(snapshot).sort().join() === 'host,lockOwner,sourceIdentity', 'STOP_GUARD_PINS');
      need(io.platform === 'linux' && io.uid() === 0, 'STOP_GUARD_PLATFORM');
      need(source?.sourceEpoch === SOURCE && source.pid === 2990149
        && typeof source.start === 'string' && /^[1-9]\d*(?:\.\d+)?$/.test(source.start) && Number.isFinite(Number(source.start))
        && /^v\d+\.\d+\.\d+$/.test(source.nodeVersion), 'STOP_GUARD_SOURCE');
      need(Object.keys(source).sort().join() === 'nodeVersion,pid,sourceEpoch,start', 'STOP_GUARD_SOURCE');
      need(hash(host?.machineIdSha256) && hash(host?.bootIdSha256)
        && Number.isSafeInteger(lockOwner?.pid) && lockOwner.pid > 1 && lockOwner.pid !== source.pid
        && /^[1-9]\d*$/.test(lockOwner.startTicks), 'STOP_GUARD_PINS');
      need(Object.keys(host).sort().join() === 'bootIdSha256,machineIdSha256'
        && Object.keys(lockOwner).sort().join() === 'pid,startTicks', 'STOP_GUARD_PINS');
      need(sha(io.read('/etc/machine-id')) === host.machineIdSha256
        && sha(io.read('/proc/sys/kernel/random/boot_id')) === host.bootIdSha256, 'STOP_GUARD_HOST');
      const lock = io.stat(LOCK);
      need(lock.isFile() && !lock.isSymbolicLink() && lock.uid === 0 && lock.nlink === 1
        && (lock.mode & 0o7777) === 0o600, 'STOP_GUARD_LOCK');
      for (const parent of ['/run/lock', '/run', '/']) {
        const st = io.stat(parent);
        need(st.isDirectory() && !st.isSymbolicLink() && st.uid === 0
          && (!(st.mode & 0o022) || (st.mode & 0o1000) !== 0), 'STOP_GUARD_LOCK');
      }
      need(processIdentity(lockOwner.pid, io).startTicks === lockOwner.startTicks, 'STOP_GUARD_OWNER');
      let pid = io.pid(), owns = false;
      for (let i = 0; i < 8 && pid > 1; i++) {
        if (pid === lockOwner.pid) { owns = true; break; }
        pid = processIdentity(pid, io).ppid;
      }
      need(owns, 'STOP_GUARD_OWNER');
      const dev = BigInt(lock.dev);
      const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
      const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
      const matching = io.read('/proc/locks').trim().split('\n').filter(line => {
        const c = line.trim().split(/\s+/), inode = c[5]?.split(':');
        return c.length === 8 && c[1] === 'FLOCK' && c[2] === 'ADVISORY' && c[3] === 'WRITE'
          && c[4] === String(lockOwner.pid) && inode?.length === 3
          && /^[a-f0-9]+$/i.test(inode[0]) && /^[a-f0-9]+$/i.test(inode[1]) && /^\d+$/.test(inode[2])
          && BigInt(`0x${inode[0]}`) === major && BigInt(`0x${inode[1]}`) === minor
          && BigInt(inode[2]) === BigInt(lock.ino) && c[6] === '0' && c[7] === 'EOF';
      });
      need(matching.length === 1, 'STOP_GUARD_FLOCK');
      const state = fields(io.unit());
      need(Object.keys(state).sort().join() === 'ActiveState,ControlGroup,Id,Job,LoadState,MainPID,NeedDaemonReload,SubState'
        && state.Id === UNIT && state.LoadState === 'loaded' && state.ActiveState === 'inactive'
        && state.SubState === 'dead' && state.MainPID === '0' && state.ControlGroup === ''
        && state.Job === '' && state.NeedDaemonReload === 'no', 'STOP_GUARD_UNIT');
      need(absent(`/proc/${source.pid}`, io), 'STOP_GUARD_OLD_PROCESS_PRESENT');
      const mounts = io.read('/proc/self/mountinfo');
      need(mounts.split('\n').some(l => l.split(' ')[4] === '/sys/fs/cgroup' && l.includes(' - cgroup2 ')), 'STOP_GUARD_CGROUP_MOUNT');
      let groupAbsent = absent(GROUP, io);
      if (!groupAbsent) {
        const st = io.stat(GROUP);
        need(st.isDirectory() && !st.isSymbolicLink() && st.uid === 0, 'STOP_GUARD_CGROUP');
        const events = io.read(`${GROUP}/cgroup.events`).trim().split('\n');
        need(events.filter(l => l.startsWith('populated ')).join() === 'populated 0'
          && io.read(`${GROUP}/cgroup.procs`).trim() === '', 'STOP_GUARD_CGROUP');
      }
      need(absent(`/proc/${source.pid}`, io) && io.unit().trim() === Object.entries(state).map(([k,v]) => `${k}=${v}`).join('\n'), 'STOP_GUARD_DRIFT');
      need(processIdentity(lockOwner.pid, io).startTicks === lockOwner.startTicks, 'STOP_GUARD_OWNER');
      const finalLock = io.stat(LOCK);
      need(finalLock.dev === lock.dev && finalLock.ino === lock.ino && finalLock.mode === lock.mode
        && finalLock.uid === 0 && finalLock.nlink === 1 && io.read('/proc/locks').split('\n').includes(matching[0]), 'STOP_GUARD_LOCK_DRIFT');
      const end = io.now(); need(end >= start && end - start <= 4000, 'STOP_GUARD_TIMEOUT');
      const evidence = { sourceIdentity: source, host, lockOwner, unit: state,
        lock: { dev: lock.dev, ino: lock.ino }, cgroupAbsent: groupAbsent, observedAt: new Date(end).toISOString() };
      return { schema: 'PHAB_CUP83_STOP_GUARD_V1', sourceIdentity: { ...source }, stopped: true,
        checkedAt: evidence.observedAt, evidenceSha256: sha(JSON.stringify(evidence) + '\n') };
    } catch (error) {
      // Filesystem/systemctl errors may include private paths or process details.
      throw Error(/^STOP_GUARD_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'STOP_GUARD_UNKNOWN');
    }
  };
}
