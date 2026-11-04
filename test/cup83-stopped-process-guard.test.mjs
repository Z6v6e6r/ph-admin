import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCup83StoppedProcessGuard } from '../scripts/lib/cup83-stopped-process-guard.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const UNIT = 'phab-api-p32-2be5b1f.service', GROUP = `/sys/fs/cgroup/system.slice/${UNIT}`;
const LOCK = '/run/lock/phab-api-release.lock';
function fixture() {
  const expected = {
    sourceIdentity: { sourceEpoch: '83b1c17bc4c5edaec65387b25b5695e48337c3cf', pid: 2990149,
      start: '1793700000000.125', nodeVersion: 'v22.20.0' },
    host: { machineIdSha256: hash('machine\n'), bootIdSha256: hash('boot\n') },
    lockOwner: { pid: 42, startTicks: '12345' },
  };
  const stat = (file = false, changes = {}) => ({ isFile: () => file, isDirectory: () => !file,
    isSymbolicLink: () => false, uid: 0, nlink: 1, mode: file ? 0o100600 : 0o40755,
    dev: 2049, ino: 99, ...changes });
  const processStat = (pid, ppid, start) => `${pid} (safe name) ${['S', String(ppid), ...Array(17).fill('0'), start].join(' ')}`;
  const data = new Map([
    ['/etc/machine-id', 'machine\n'], ['/proc/sys/kernel/random/boot_id', 'boot\n'],
    ['/proc/42/stat', processStat(42, 1, '12345')], ['/proc/43/stat', processStat(43, 42, '12346')],
    ['/proc/locks', '1: FLOCK ADVISORY WRITE 42 08:01:99 0 EOF\n'],
    ['/proc/self/mountinfo', '1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n'],
    [`${GROUP}/cgroup.events`, 'populated 0\nfrozen 0\n'], [`${GROUP}/cgroup.procs`, ''],
  ]);
  const metadata = new Map([[LOCK, stat(true)], ['/run/lock', stat(false, { mode: 0o41777 })],
    ['/run', stat()], ['/', stat()], [GROUP, stat()]]);
  const absent = () => { const e = Error('private host path must not escape'); e.code = 'ENOENT'; throw e; };
  const state = { Id: UNIT, LoadState: 'loaded', ActiveState: 'inactive', SubState: 'dead',
    MainPID: '0', ControlGroup: '', Job: '', NeedDaemonReload: 'no' };
  const io = { platform: 'linux', uid: () => 0, pid: () => 43, now: () => 1793766000000,
    stat: p => metadata.get(p) ?? absent(), read: p => data.has(p) ? data.get(p) : absent(),
    unit: () => Object.entries(state).map(([k,v]) => `${k}=${v}`).join('\n') + '\n' };
  return { expected, io, metadata, data, state, stat };
}
test('bound stopped source + held ancestor flock produce safe observation only', async () => {
  const f = fixture(), proof = await createCup83StoppedProcessGuard(f.expected, f.io)();
  assert.deepEqual(Object.keys(proof).sort(), ['checkedAt','evidenceSha256','schema','sourceIdentity','stopped']);
  assert.equal(proof.stopped, true); assert.equal(proof.schema, 'PHAB_CUP83_STOP_GUARD_V1');
  assert.deepEqual(proof.sourceIdentity, f.expected.sourceIdentity);
  assert.match(proof.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(proof), /private host|machine\n|FLOCK|cgroup/);
});
test('removed cgroup is accepted only with stopped unit and absent old process', async () => {
  const f = fixture(); f.metadata.delete(GROUP);
  assert.equal((await createCup83StoppedProcessGuard(f.expected, f.io)()).stopped, true);
});
const cases = {
  nonLinux: f => { f.io.platform = 'darwin'; },
  wrongBoot: f => { f.data.set('/proc/sys/kernel/random/boot_id','other\n'); },
  wrongMachine: f => { f.data.set('/etc/machine-id','other\n'); },
  oldProcessPresent: f => { f.metadata.set('/proc/2990149',f.stat()); },
  reusedOwner: f => { f.expected.lockOwner.startTicks='12344'; },
  unrelatedLockOwner: f => { f.io.pid=()=>44; f.data.set('/proc/44/stat','44 (reader) '+['S','1',...Array(17).fill('0'),'3456'].join(' ')); },
  noFlock: f => { f.data.set('/proc/locks',''); },
  readLock: f => { f.data.set('/proc/locks',f.data.get('/proc/locks').replace('WRITE','READ')); },
  symlinkLock: f => { f.metadata.set(LOCK,f.stat(true,{isSymbolicLink:()=>true})); },
  publicLock: f => { f.metadata.set(LOCK,f.stat(true,{mode:0o100644})); },
  hardlinkedLock: f => { f.metadata.set(LOCK,f.stat(true,{nlink:2})); },
  unsafeAncestor: f => { f.metadata.set('/run',f.stat(false,{mode:0o40777})); },
  activeUnit: f => { f.state.ActiveState='active'; },
  pendingRestart: f => { f.state.Job='123'; },
  wrongUnit: f => { f.state.Id='other.service'; },
  unknownUnitField: f => { f.state.Extra='unsupported'; },
  wrongCgroupMount: f => { f.data.set('/proc/self/mountinfo',''); },
  populatedDescendant: f => { f.data.set(`${GROUP}/cgroup.events`,'populated 1\n'); },
  directGroupProcess: f => { f.data.set(`${GROUP}/cgroup.procs`,'88\n'); },
  cgroupSymlink: f => { f.metadata.set(GROUP,f.stat(false,{isSymbolicLink:()=>true})); },
  staleObservation: f => { let calls=0; f.io.now=()=>1793766000000+(calls++?4001:0); },
  invalidSource: f => { f.expected.sourceIdentity.pid=20; },
};
for (const [name, change] of Object.entries(cases)) test(`refuses ${name}`, async () => {
  const f=fixture(); change(f);
  await assert.rejects(createCup83StoppedProcessGuard(f.expected,f.io), /^Error: STOP_GUARD_/);
});
test('unit and lock drift between observations refuse', async () => {
  for (const kind of ['unit','lock']) {
    const f=fixture(); let calls=0;
    if(kind==='unit') { const read=f.io.unit; f.io.unit=()=>{if(calls++)f.state.MainPID='88';return read();}; }
    else { const read=f.io.stat; f.io.stat=p=>p===LOCK&&calls++>0?f.stat(true,{ino:100}):read(p); }
    await assert.rejects(createCup83StoppedProcessGuard(f.expected,f.io), /^Error: STOP_GUARD_/);
  }
});
test('private adapter errors are redacted', async () => {
  const f=fixture(); f.io.unit=()=>{throw Error('secret-private-error');};
  await assert.rejects(createCup83StoppedProcessGuard(f.expected,f.io), {message:'STOP_GUARD_UNKNOWN'});
});
test('caller mutation does not rewrite pinned source identity', async () => {
  const f=fixture(),guard=createCup83StoppedProcessGuard(f.expected,f.io);
  f.expected.sourceIdentity.start='1'; const first=await guard(); first.sourceIdentity.start='2';
  assert.equal((await guard()).sourceIdentity.start,'1793700000000.125');
});
