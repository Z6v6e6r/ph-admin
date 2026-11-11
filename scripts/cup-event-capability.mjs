// Exact-target CUP EVENT configuration; no business writes or credential handling.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const UNIT = 'phab-api-p32-2be5b1f.service';
export const RUNTIME_SOURCE = '38e80af9f5d855cf9ba28b616f4b651f7c658fa5';
export const DROP_IN = `/etc/systemd/system/${UNIT}.d/85-exhibition-event-capability.conf`;
export const FLAGS = Object.freeze({
  PHAB_COMMUNITY_POLICIES_ENABLED: 'true',
  PHAB_COMMUNITY_POLICY_TYPES_ENABLED: 'EVENT'
});

export function eventDropIn(plan) {
  assert.equal(plan.host, '3170594-cd19972', 'CUP_EVENT_TARGET');
  assert.equal(plan.unit, UNIT, 'CUP_EVENT_TARGET');
  assert.equal(plan.runtimeSource, RUNTIME_SOURCE, 'CUP_EVENT_RUNTIME');
  assert.equal(plan.dropInPath, DROP_IN, 'CUP_EVENT_TARGET');
  assert.deepEqual(plan.flags, FLAGS, 'CUP_EVENT_FLAGS');
  return '[Service]\nEnvironment=PHAB_COMMUNITY_POLICIES_ENABLED=true\nEnvironment=PHAB_COMMUNITY_POLICY_TYPES_ENABLED=EVENT\n';
}

export async function applyEventCapability(plan, io) {
  const body = eventDropIn(plan);
  await io.assertLock();
  assert.deepEqual(await io.snapshot(), plan.before, 'CUP_EVENT_PREIMAGE');
  const before = plan.before;
  assert.equal(before.own, null, 'CUP_EVENT_EXISTING_DROP_IN');
  assert.equal(before.active, true, 'CUP_EVENT_SOURCE_NOT_ACTIVE');
  assert.equal(before.needReload, false, 'CUP_EVENT_FOREIGN_RELOAD');
  const unchanged = after => {
    for (const key of ['host', 'source', 'runtimeFingerprint', 'configFingerprint', 'otherEnvironmentSha', 'protectedFingerprint', 'restarts']) {
      assert.deepEqual(after[key], before[key], 'CUP_EVENT_UNSELECTED_DRIFT');
    }
  };
  let restartAttempted = false, reloadAttempted = false;
  try {
    await io.publish(body);
    reloadAttempted = true;
    await io.reload();
    await io.verifyEffectiveFlags();
    const prepared = await io.snapshot(); unchanged(prepared);
    assert(prepared.pid === before.pid && prepared.startTicks === before.startTicks && prepared.active && !prepared.needReload, 'CUP_EVENT_PRE_RESTART_DRIFT');
    assert.deepEqual(prepared.flags, before.flags, 'CUP_EVENT_PRE_RESTART_DRIFT');
    assert.deepEqual(prepared.own, { sha256: bodySha256(body), uid: 0, gid: 0, mode: 0o600, nlink: 1 }, 'CUP_EVENT_DROP_IN_CUSTODY');
    restartAttempted = true;
    await io.restart();
    const after = await io.snapshot();
    unchanged(after);
    assert(after.pid > 1 && after.pid !== before.pid && after.startTicks !== before.startTicks && after.active && !after.needReload, 'CUP_EVENT_RESTART_FAILED');
    assert.deepEqual(after.flags, FLAGS, 'CUP_EVENT_FLAGS_NOT_EFFECTIVE');
    assert.deepEqual(after.own, { sha256: bodySha256(body), uid: 0, gid: 0, mode: 0o600, nlink: 1 }, 'CUP_EVENT_DROP_IN_CUSTODY');
    return { status: 'APPLIED', pid: after.pid, restarts: after.restarts, beforePid: before.pid, after };
  } catch {
    try {
      await recoverEventCapability(plan, io, { restartAttempted, reloadAttempted });
    } catch { throw Error('CUP_EVENT_RECONCILE_REQUIRED'); }
    throw Error('CUP_EVENT_FAILED_RECOVERED');
  }
}

export async function recoverEventCapability(plan, io, { restartAttempted = true, reloadAttempted = true } = {}) {
  const body = eventDropIn(plan), before = plan.before;
  await io.assertLock();
  const custody = await io.assertRestorable(before, body);
  if (custody.ownPresent) await io.removeOwned(body);
  if (custody.ownPresent || reloadAttempted) await io.reload();
  if (restartAttempted) await io.restart();
  const restored = await io.snapshot();
  for (const key of ['host', 'source', 'runtimeFingerprint', 'configFingerprint', 'otherEnvironmentSha', 'protectedFingerprint', 'restarts']) {
    assert.deepEqual(restored[key], before[key], 'CUP_EVENT_RECOVERY_DRIFT');
  }
  assert(restored.active && !restored.needReload && restored.pid > 1, 'CUP_EVENT_RECOVERY_NOT_ACTIVE');
  assert.equal(restored.own, null, 'CUP_EVENT_RECOVERY_DROP_IN');
  assert.deepEqual(restored.flags, before.flags, 'CUP_EVENT_RECOVERY_FLAGS');
  return { status: 'RECOVERED', pid: restored.pid, restarts: restored.restarts };
}

export async function runVerifiedOperation(plan, io) {
  eventDropIn(plan);
  assert(/^[a-f0-9-]{36}$/.test(plan.nonce) && /^[a-f0-9]{64}$/.test(plan.browserProofSha256), 'CUP_EVENT_PROOF_PLAN');
  await io.assertLock();
  assert.deepEqual(await io.snapshot(), plan.before, 'CUP_EVENT_PREIMAGE');
  await io.assertFreshRun();
  await io.record('intent.json', { nonce: plan.nonce, startedAtMs: Date.now(), before: plan.before });
  let applied;
  try {
    applied = await applyEventCapability(plan, io);
    await io.record('applied.json', applied);
    const start = io.monotonic(); let samples = 1;
    do {
      await io.sleep(30000);
      await io.assertLock();
      assert.deepEqual(await io.snapshot(), applied.after, 'CUP_EVENT_OBSERVATION_DRIFT');
      samples++;
      assert(samples <= 10 && io.monotonic() - start < 300000, 'CUP_EVENT_OBSERVATION_DEADLINE');
    } while (io.monotonic() - start < 120000);
    const proof = await io.readBrowserProof();
    assert.equal(bodySha256(proof), plan.browserProofSha256, 'CUP_EVENT_BROWSER_PROOF');
    const receipt = { status: 'PASS', pid: applied.pid, restarts: applied.restarts,
      source: RUNTIME_SOURCE, nonce: plan.nonce, samples, browserProofSha256: plan.browserProofSha256,
      observedMs: io.monotonic() - start, after: applied.after };
    await io.record('complete.json', receipt);
    return receipt;
  } catch (error) {
    if (!applied) throw error;
    try { await recoverEventCapability(plan, io); }
    catch { throw Error('CUP_EVENT_OBSERVATION_RECONCILE'); }
    throw Error('CUP_EVENT_OBSERVATION_FAILED_RECOVERED');
  }
}

const sha = value => createHash('sha256').update(value).digest('hex');
export const bodySha256 = sha;

export function selectedSystemdFlags(raw) {
  const tokens = []; let token = '', quoted = false, escaped = false;
  for (const char of raw) {
    if (escaped) { token += char; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (/\s/.test(char) && !quoted) { if (token) tokens.push(token); token = ''; }
    else token += char;
  }
  assert(!quoted && !escaped, 'CUP_EVENT_SYSTEMD_ENV_SHAPE');
  if (token) tokens.push(token);
  const result = Object.fromEntries(Object.keys(FLAGS).map(key => [key, null])), seen = new Set();
  for (const item of tokens) {
    const at = item.indexOf('='), key = item.slice(0, at);
    if (at < 1 || !Object.hasOwn(FLAGS, key)) continue;
    assert(!seen.has(key), 'CUP_EVENT_SYSTEMD_ENV_DUPLICATE');
    seen.add(key); result[key] = item.slice(at + 1);
  }
  return result;
}

export function assertReleaseFlock(pins, locks) {
  assert(pins.regular && pins.uid === 0 && pins.mode === 0o600 && pins.nlink === 1, 'CUP_EVENT_LOCK_CUSTODY');
  const matches = locks.trim().split('\n').filter(line => {
    const c = line.trim().split(/\s+/), inode = c[5]?.split(':');
    return c.length === 8 && c[1] === 'FLOCK' && c[2] === 'ADVISORY' && c[3] === 'WRITE'
      && pins.ancestors.includes(Number(c[4])) && inode?.length === 3
      && inode[0] === pins.major && inode[1] === pins.minor && inode[2] === pins.ino
      && c[6] === '0' && c[7] === 'EOF';
  });
  assert.equal(matches.length, 1, 'CUP_EVENT_RELEASE_LOCK_NOT_OWNED');
}

export function environmentIdentity(raw) {
  const env = new Map();
  for (const item of raw.split('\0').filter(Boolean)) {
    const at = item.indexOf('='), key = item.slice(0, at);
    assert(at > 0 && !env.has(key), 'CUP_EVENT_PROCESS_ENV_SHAPE');
    env.set(key, item.slice(at + 1));
  }
  const flags = Object.fromEntries(Object.keys(FLAGS).map(key => [key, env.has(key) ? env.get(key) : null]));
  for (const key of Object.keys(flags)) {
    if (![null, '', 'true', 'false', 'EVENT'].includes(flags[key])) flags[key] = 'UNEXPECTED';
  }
  for (const key of [...Object.keys(FLAGS), 'INVOCATION_ID', 'JOURNAL_STREAM', 'SYSTEMD_EXEC_PID']) env.delete(key);
  return { flags, otherEnvironmentSha: sha(JSON.stringify([...env].sort(([a], [b]) => a.localeCompare(b)))) };
}

function syncParent(file) {
  const fd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function publishOwnDropIn(file, body, hooks = {}) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let identity, linked = false;
  try {
    try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, body); fs.fsyncSync(fd); identity = fs.fstatSync(fd); }
    finally { fs.closeSync(fd); }
    hooks.beforeLink?.({ temporary, dev: identity.dev, ino: identity.ino });
    fs.linkSync(temporary, file); linked = true;
    hooks.afterLink?.();
    fs.unlinkSync(temporary);
    syncParent(file);
  } catch {
    try {
      for (const target of linked ? [file, temporary] : [temporary]) {
        if (!fs.existsSync(target)) continue;
        const s = fs.lstatSync(target);
        assert(s.isFile() && !s.isSymbolicLink() && identity && s.dev === identity.dev && s.ino === identity.ino && s.nlink <= 2 && sha(fs.readFileSync(target)) === sha(body));
        fs.unlinkSync(target);
      }
      syncParent(file);
    } catch { throw Error('CUP_EVENT_PUBLICATION_RECONCILE'); }
    throw Error('CUP_EVENT_PUBLICATION_FAILED');
  }
}
