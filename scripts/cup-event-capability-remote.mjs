// Exact immutable CUP runtime/config adapter. It never reads .env file contents.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { RUNTIME_SOURCE, UNIT, DROP_IN, FLAGS, bodySha256, publishOwnDropIn,
  environmentIdentity, selectedSystemdFlags, assertReleaseFlock, eventDropIn,
  runVerifiedOperation, recoverEventCapability } from './cup-event-capability.mjs';

export function assertNativeBoundary(boundary = { platform: process.platform, uid: process.getuid?.(), host: os.hostname() }) {
  assert.equal(boundary.platform, 'linux', 'CUP_EVENT_PLATFORM');
  assert.equal(boundary.uid, 0, 'CUP_EVENT_ROOT_REQUIRED');
  assert.equal(boundary.host, '3170594-cd19972', 'CUP_EVENT_HOST');
}

export function verifyRuntimeInventory(root, manifest) {
  assert.equal(manifest.sourceCommit, RUNTIME_SOURCE, 'CUP_EVENT_RUNTIME_SOURCE');
  assert.equal(manifest.sourceTree, '7b1a9e9f5536914d130b41bbb7c9c4f74b0ea4a0', 'CUP_EVENT_RUNTIME_TREE');
  assert.equal(manifest.configurationIncluded, false, 'CUP_EVENT_RUNTIME_CONFIGURATION');
  assert.equal(manifest.databaseChanges, false, 'CUP_EVENT_RUNTIME_DATABASE');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'CUP_EVENT_RUNTIME_INVENTORY');
  const seen = new Set();
  for (const row of manifest.files) {
    assert(typeof row.path === 'string' && row.path && !path.isAbsolute(row.path)
      && !row.path.split('/').some(part => !part || part === '..' || part.startsWith('.env'))
      && /^[a-f0-9]{64}$/.test(row.sha256) && !seen.has(row.path), 'CUP_EVENT_RUNTIME_PATH');
    seen.add(row.path);
    const file = path.resolve(root, row.path), stat = fs.lstatSync(file);
    assert(file.startsWith(path.resolve(root) + '/') && stat.isFile() && !stat.isSymbolicLink(), 'CUP_EVENT_RUNTIME_FILE');
    assert.equal(fs.realpathSync(file), file, 'CUP_EVENT_RUNTIME_SYMLINK');
    assert.equal(bodySha256(fs.readFileSync(file)), row.sha256, 'CUP_EVENT_RUNTIME_HASH');
  }
  return { fileCount: seen.size, fingerprint: bodySha256(JSON.stringify(manifest)) };
}

export const RELEASE_LOCK = '/run/lock/phab-api-release.lock';
const RUNTIME = '/opt/ph-admin-releases/cup-38e80af';
const MANIFEST_SHA = '66745502e235dbb65fd524def0380df8314cd7dedfa025445e3fc98fe61d2ef4';
const command = (file, args, timeout = 10000) => execFileSync(file, args, {
  encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
});
const digest = value => bodySha256(JSON.stringify(value));

function fields(raw) {
  const out = {};
  for (const line of raw.trim().split('\n')) {
    const at = line.indexOf('=');
    assert(at > 0 && !Object.hasOwn(out, line.slice(0, at)), 'CUP_EVENT_UNIT_SHAPE');
    out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

function unit(name) {
  assert([UNIT, 'padlhub-jump-live.service'].includes(name), 'CUP_EVENT_UNIT_TARGET');
  return fields(command('/usr/bin/systemctl', ['show', name,
    '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ActiveState', '-p', 'WorkingDirectory',
    '-p', 'FragmentPath', '-p', 'DropInPaths', '-p', 'EnvironmentFiles', '-p', 'NeedDaemonReload']));
}

function metadata(file, hash = false) {
  let s;
  try { s = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const value = { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode & 0o7777,
    nlink: s.nlink, size: s.size, mtimeMs: s.mtimeMs, link: s.isSymbolicLink() };
  if (hash) {
    assert(!file.split('/').some(part => part.startsWith('.env')) && !file.endsWith('.env'), 'CUP_EVENT_ENV_CONTENT_FORBIDDEN');
    assert(s.isFile() && !s.isSymbolicLink() && s.uid === 0, 'CUP_EVENT_CONFIG_CUSTODY');
    value.sha256 = bodySha256(fs.readFileSync(file));
  }
  return value;
}

function processStat(pid) {
  assert(Number.isSafeInteger(pid) && pid > 1, 'CUP_EVENT_PID');
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), tail = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  assert(tail.length > 19 && /^\d+$/.test(tail[1]) && /^[1-9]\d*$/.test(tail[19]), 'CUP_EVENT_PROCESS_SHAPE');
  return { parent: Number(tail[1]), startTicks: tail[19] };
}

function assertNativeLock() {
  const s = fs.lstatSync(RELEASE_LOCK), dev = BigInt(s.dev), ancestors = [];
  let pid = process.pid;
  for (let i = 0; i < 12 && pid > 1; i++) { ancestors.push(pid); pid = processStat(pid).parent; }
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  assertReleaseFlock({ regular: s.isFile() && !s.isSymbolicLink(), uid: s.uid,
    mode: s.mode & 0o7777, nlink: s.nlink, major: major.toString(16).padStart(2, '0'),
    minor: minor.toString(16).padStart(2, '0'), ino: String(s.ino), ancestors }, fs.readFileSync('/proc/locks', 'utf8'));
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function configIdentity(u) {
  assert.equal(u.WorkingDirectory, RUNTIME, 'CUP_EVENT_RUNTIME_DIRECTORY');
  assert.equal(u.FragmentPath, `/etc/systemd/system/${UNIT}`, 'CUP_EVENT_UNIT_FRAGMENT');
  const directory = path.dirname(DROP_IN);
  assert.equal(fs.realpathSync(directory), directory, 'CUP_EVENT_DROP_IN_PARENT');
  const ds = fs.lstatSync(directory);
  assert(ds.isDirectory() && ds.uid === 0 && ds.gid === 0 && !(ds.mode & 0o2022), 'CUP_EVENT_DROP_IN_PARENT');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.conf')).map(name => path.join(directory, name)).filter(file => file !== DROP_IN).sort();
  const dropIns = files.map(file => ({ file, metadata: metadata(file, true) }));
  const envPaths = [...u.EnvironmentFiles.matchAll(/(\/[^\s]+) \(ignore_errors=(?:yes|no)\)/g)].map(match => match[1]);
  assert(envPaths.length > 0, 'CUP_EVENT_ENV_METADATA_UNAVAILABLE');
  const envMetadata = envPaths.map(file => ({ file, metadata: metadata(file), realPath: fs.realpathSync(file), target: metadata(fs.realpathSync(file)) }));
  const appEnv = `${RUNTIME}/.env`, appMeta = metadata(appEnv);
  envMetadata.push({ file: appEnv, metadata: appMeta, realPath: appMeta ? fs.realpathSync(appEnv) : null,
    target: appMeta ? metadata(fs.realpathSync(appEnv)) : null });
  return digest({ fragment: metadata(u.FragmentPath, true), dropIns, envMetadata, workingDirectory: u.WorkingDirectory, environmentFiles: u.EnvironmentFiles });
}

function runtimeIdentity() {
  const raw = fs.readFileSync(`${RUNTIME}/runtime-manifest.json`);
  assert.equal(bodySha256(raw), MANIFEST_SHA, 'CUP_EVENT_MANIFEST_PREIMAGE');
  const inventory = verifyRuntimeInventory(RUNTIME, JSON.parse(raw));
  const executable = `${RUNTIME}/runtime/node`;
  const executableMeta = metadata(executable, true);
  assert.equal(executableMeta.sha256, 'a3627568bc920247f5edecc025a040bfa3c3f76bf3456ac424f6ac76aa5e6a47', 'CUP_EVENT_NODE_EXECUTABLE');
  return digest({ ...inventory, executable: executableMeta });
}

function protectedIdentity() {
  const team = unit('padlhub-jump-live.service');
  assert.equal(team.ActiveState, 'active', 'CUP_EVENT_TEAM_NOT_ACTIVE');
  const pm = JSON.parse(command('/usr/local/bin/pm2', ['jlist'])).filter(row => row.name === 'node-red');
  assert.equal(pm.length, 1, 'CUP_EVENT_NODE_RED_IDENTITY');
  assert(pm[0].pid > 1 && pm[0].pm2_env.status === 'online', 'CUP_EVENT_NODE_RED_NOT_ACTIVE');
  assert.equal(publicStatus('https://padlhub.su/jump-live-api/health'), 200, 'CUP_EVENT_TEAM_HEALTH');
  return digest({ team, teamUnit: metadata('/etc/systemd/system/padlhub-jump-live.service', true),
    teamEnvironmentMetadata: metadata('/etc/padlhub-jump-live.env'),
    nodeRed: { pid: pm[0].pid, restarts: pm[0].pm2_env.restart_time, status: pm[0].pm2_env.status } });
}

function publicStatus(url) {
  return Number(command('/usr/bin/curl', ['--silent', '--show-error', '--connect-timeout', '3', '--max-time', '5',
    '--resolve', 'padlhub.su:443:127.0.0.1', '--output', '/dev/null', '--write-out', '%{http_code}', url], 7000));
}

function assertHealth() {
  assert.equal(publicStatus('https://padlhub.su/api/health'), 200, 'CUP_EVENT_HEALTH');
  const id = encodeURIComponent('community_1794221739126_корпспорт-падлхаб-2026');
  assert([401, 403].includes(publicStatus(`https://padlhub.su/api/communities/${id}`)), 'CUP_EVENT_ANONYMOUS_ACCESS');
}

function privateJson(file) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.uid === 0 && s.gid === 0 && s.nlink === 1 && (s.mode & 0o7777) === 0o600 && s.size <= 1024 * 1024, 'CUP_EVENT_PRIVATE_FILE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function createNativeIO(stage, plan) {
  assertNativeBoundary();
  assert.equal(process.getgid(), 0, 'CUP_EVENT_ROOT_GROUP');
  assert(/^\/root\/\.phab-exhibition-event-\d{8}T\d{6}Z-[a-f0-9-]+$/.test(stage), 'CUP_EVENT_STAGE');
  const ss = fs.lstatSync(stage);
  assert(ss.isDirectory() && !ss.isSymbolicLink() && ss.uid === 0 && ss.gid === 0 && (ss.mode & 0o7777) === 0o700 && fs.realpathSync(stage) === stage, 'CUP_EVENT_STAGE_CUSTODY');
  const ownedFile = path.join(stage, 'owned.json');
  const record = (name, value) => publishOwnDropIn(path.join(stage, name), JSON.stringify(value) + '\n');
  const io = {
    assertLock: assertNativeLock,
    record,
    monotonic: () => Number(process.hrtime.bigint() / 1000000n),
    sleep: delay,
    assertFreshRun() {
      for (const name of ['intent.json', 'owned.json', 'applied.json', 'complete.json', 'browser-post.json', 'recovery.json']) {
        try { fs.lstatSync(path.join(stage, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw Error('CUP_EVENT_RUN_ALREADY_STARTED');
      }
    },
    readBrowserProof() {
      const file = path.join(stage, 'browser-post.json'), intent = privateJson(path.join(stage, 'intent.json'));
      privateJson(file);
      const s = fs.lstatSync(file);
      assert(s.mtimeMs >= intent.startedAtMs && s.size <= 4096, 'CUP_EVENT_BROWSER_PROOF_FRESHNESS');
      return fs.readFileSync(file);
    },
    async snapshot() {
      assertNativeLock();
      const u = unit(UNIT), pid = Number(u.MainPID);
      assert(u.ActiveState === 'active' && pid > 1 && fs.realpathSync(`/proc/${pid}/cwd`) === RUNTIME
        && fs.realpathSync(`/proc/${pid}/exe`) === `${RUNTIME}/runtime/node`, 'CUP_EVENT_RUNTIME_PROCESS');
      const environment = environmentIdentity(fs.readFileSync(`/proc/${pid}/environ`, 'utf8'));
      const s = metadata(DROP_IN, true);
      assertHealth();
      const result = { host: os.hostname(), source: RUNTIME_SOURCE,
        runtimeFingerprint: runtimeIdentity(), configFingerprint: configIdentity(u), ...environment,
        protectedFingerprint: protectedIdentity(), pid, startTicks: processStat(pid).startTicks,
        restarts: Number(u.NRestarts), active: true, needReload: u.NeedDaemonReload !== 'no',
        own: s ? { sha256: s.sha256, uid: s.uid, gid: s.gid, mode: s.mode, nlink: s.nlink } : null };
      assert.equal(unit(UNIT).MainPID, u.MainPID, 'CUP_EVENT_SNAPSHOT_RACE');
      return result;
    },
    async publish(body) {
      publishOwnDropIn(DROP_IN, body, { beforeLink(identity) {
        record('owned.json', { ...identity, file: DROP_IN, sha256: bodySha256(body) });
      } });
    },
    async reload() { command('/usr/bin/systemctl', ['daemon-reload'], 30000); },
    async verifyEffectiveFlags() {
      assert.deepEqual(selectedSystemdFlags(command('/usr/bin/systemctl', ['show', UNIT, '-p', 'Environment', '--value'])), FLAGS, 'CUP_EVENT_SYSTEMD_PRECEDENCE');
    },
    async restart() {
      command('/usr/bin/systemctl', ['restart', UNIT], 90000);
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try { assertHealth(); ready = true; break; } catch { await delay(500); }
      }
      assert(ready, 'CUP_EVENT_RESTART_HEALTH');
    },
    async assertRestorable(before, body) {
      assertNativeLock();
      assert.equal(configIdentity(unit(UNIT)), before.configFingerprint, 'CUP_EVENT_FOREIGN_CONFIG');
      assert.equal(runtimeIdentity(), before.runtimeFingerprint, 'CUP_EVENT_FOREIGN_RUNTIME');
      const s = metadata(DROP_IN, true);
      if (!s) return { ownPresent: false };
      const owned = privateJson(ownedFile);
      assert(owned.file === DROP_IN && owned.sha256 === bodySha256(body) && s.sha256 === owned.sha256
        && s.dev === owned.dev && s.ino === owned.ino && s.uid === 0 && s.gid === 0 && s.mode === 0o600, 'CUP_EVENT_OWNERSHIP_DRIFT');
      if (s.nlink === 2) {
        assert(owned.temporary.startsWith(`${DROP_IN}.`) && owned.temporary.endsWith('.tmp'), 'CUP_EVENT_PENDING_PATH');
        const pending = metadata(owned.temporary, true);
        assert(pending && pending.dev === s.dev && pending.ino === s.ino && pending.nlink === 2 && pending.sha256 === s.sha256, 'CUP_EVENT_PENDING_CUSTODY');
        fs.unlinkSync(owned.temporary); syncDirectory(path.dirname(DROP_IN));
      } else assert.equal(s.nlink, 1, 'CUP_EVENT_EXTERNAL_LINK');
      return { ownPresent: true };
    },
    async removeOwned(body) {
      await io.assertRestorable(plan.before, body);
      fs.unlinkSync(DROP_IN); syncDirectory(path.dirname(DROP_IN));
    }
  };
  return io;
}

async function main() {
  const [action, planFile, ...extra] = process.argv.slice(2);
  assert(['inspect', 'preflight', 'apply', 'recover'].includes(action) && extra.length === 0
    && (action === 'inspect' ? planFile === undefined : typeof planFile === 'string'), 'CUP_EVENT_USAGE');
  const stage = path.dirname(fileURLToPath(import.meta.url));
  const boundaryIO = createNativeIO(stage);
  if (action === 'inspect') {
    await boundaryIO.assertLock();
    return { status: 'INSPECTED', snapshot: await boundaryIO.snapshot() };
  }
  assert.equal(planFile, path.join(stage, 'plan.json'), 'CUP_EVENT_PLAN_PATH');
  const plan = privateJson(planFile);
  eventDropIn(plan);
  assert.equal(plan.startupBehavior, 'preserve-existing-not-write-free', 'CUP_EVENT_STARTUP_SCOPE');
  const names = ['cup-event-capability.mjs', 'cup-event-capability-remote.mjs'].sort();
  assert.deepEqual(Object.keys(plan.scriptHashes).sort(), names, 'CUP_EVENT_SOURCE_CONTRACT');
  for (const name of names) {
    const file = path.join(stage, name), meta = metadata(file, true);
    assert(meta && meta.uid === 0 && meta.gid === 0 && meta.nlink === 1 && meta.mode === 0o600
      && meta.sha256 === plan.scriptHashes[name], 'CUP_EVENT_SCRIPT_PREIMAGE');
  }
  const io = createNativeIO(stage, plan);
  await io.assertLock();
  if (action === 'preflight') {
    assert.deepEqual(await io.snapshot(), plan.before, 'CUP_EVENT_PREIMAGE');
    await io.assertFreshRun();
    return { status: 'PREFLIGHT_PASS', source: RUNTIME_SOURCE, pid: plan.before.pid };
  }
  if (action === 'recover') {
    const intent = privateJson(path.join(stage, 'intent.json'));
    assert(intent.nonce === plan.nonce && digest(intent.before) === digest(plan.before), 'CUP_EVENT_RECOVERY_INTENT');
    const result = await recoverEventCapability(plan, io);
    await io.record('recovery.json', result);
    return result;
  }
  return runVerifiedOperation(plan, io);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => {
    const code = String(error?.message ?? '').match(/CUP_EVENT_[A-Z_]+/)?.[0] || 'CUP_EVENT_UNKNOWN';
    process.stdout.write(JSON.stringify({ ok: false, code }) + '\n'); process.exitCode = 1;
  });
}
