import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const implementation = await import('../scripts/cup-event-capability.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

const plan = () => ({
  host: '3170594-cd19972', unit: 'phab-api-p32-2be5b1f.service',
  runtimeSource: '38e80af9f5d855cf9ba28b616f4b651f7c658fa5',
  dropInPath: '/etc/systemd/system/phab-api-p32-2be5b1f.service.d/85-exhibition-event-capability.conf',
  flags: { PHAB_COMMUNITY_POLICIES_ENABLED: 'true', PHAB_COMMUNITY_POLICY_TYPES_ENABLED: 'EVENT' }
});

test('the exact current CUP target renders only the two selected existing flags', () => {
  assert.equal(typeof implementation.eventDropIn, 'function', 'the config-only procedure is missing');
  assert.equal(implementation.eventDropIn(plan()), '[Service]\nEnvironment=PHAB_COMMUNITY_POLICIES_ENABLED=true\nEnvironment=PHAB_COMMUNITY_POLICY_TYPES_ENABLED=EVENT\n');
});

test('mixed targets and additional flags are rejected, not normalized', () => {
  for (const change of [
    { host: 'other' }, { unit: 'padlhub-jump-live.service' },
    { runtimeSource: '26e3589210da20bf7226302fe94b0e1234bcd2a9' },
    { dropInPath: '/etc/other.conf' },
    { flags: { ...plan().flags, OTHER_FLAG: 'true' } },
    { flags: { ...plan().flags, PHAB_COMMUNITY_POLICY_TYPES_ENABLED: 'EVENT,LEAGUE' } }
  ]) assert.throws(() => implementation.eventDropIn({ ...plan(), ...change }));
});

test('a stale snapshot rejects before any configuration write or restart', async () => {
  assert.equal(typeof implementation.applyEventCapability, 'function', 'the guarded operation is missing');
  let writes = 0;
  const io = { assertLock() {}, snapshot: async () => ({ fingerprint: 'changed' }),
    publish: () => writes++, restart: () => writes++ };
  await assert.rejects(implementation.applyEventCapability({ ...plan(), before: { fingerprint: 'observed' } }, io), /CUP_EVENT_PREIMAGE/);
  assert.equal(writes, 0);
});

test('config publication is private, durable and refuses existing or symlink targets', t => {
  assert.equal(typeof implementation.publishOwnDropIn, 'function', 'durable no-clobber publication is missing');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-event-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'event.conf'), body = implementation.eventDropIn(plan());
  implementation.publishOwnDropIn(file, body);
  assert.equal(fs.readFileSync(file, 'utf8'), body);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file).nlink, 1);
  assert.throws(() => implementation.publishOwnDropIn(file, body));
  const link = path.join(root, 'linked.conf'); fs.symlinkSync(file, link);
  assert.throws(() => implementation.publishOwnDropIn(link, body));
  assert.equal(fs.readFileSync(file, 'utf8'), body);
});

function operationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-event-operation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = {
    host: '3170594-cd19972', source: plan().runtimeSource,
    runtimeFingerprint: '1'.repeat(64), configFingerprint: '2'.repeat(64),
    otherEnvironmentSha: '3'.repeat(64), protectedFingerprint: '4'.repeat(64),
    pid: 100, startTicks: '1000', restarts: 0, active: true, needReload: false,
    flags: { PHAB_COMMUNITY_POLICIES_ENABLED: null, PHAB_COMMUNITY_POLICY_TYPES_ENABLED: null }, own: null
  };
  const state = structuredClone(before), calls = [], file = path.join(root, 'event.conf');
  const io = {
    async assertLock() { calls.push('lock'); },
    async snapshot() { return structuredClone(state); },
    async publish(body) {
      calls.push('publish'); implementation.publishOwnDropIn(file, body);
      state.own = { sha256: implementation.bodySha256(body), uid: 0, gid: 0, mode: 0o600, nlink: 1 };
    },
    async reload() { calls.push('reload'); },
    async verifyEffectiveFlags() { calls.push('effective-flags'); },
    async restart() {
      calls.push('restart'); state.pid++; state.startTicks = String(Number(state.startTicks) + 1);
      state.flags = state.own ? { ...plan().flags } : { ...before.flags };
    },
    async assertRestorable() {
      assert.equal(state.configFingerprint, before.configFingerprint);
      return { ownPresent: state.own !== null };
    },
    async removeOwned(body) {
      calls.push('remove-owned'); assert.equal(fs.readFileSync(file, 'utf8'), body);
      fs.unlinkSync(file); state.own = null;
    }
  };
  return { plan: { ...plan(), before }, state, calls, io, file };
}

test('the admitted operation publishes the exact delta and restarts only its CUP adapter', async t => {
  const f = operationFixture(t);
  const receipt = await implementation.applyEventCapability(f.plan, f.io);
  assert.equal(receipt?.status, 'APPLIED', 'the operation did not reach verified application');
  assert.equal(receipt.pid, 101);
  assert.deepEqual(f.calls, ['lock', 'publish', 'reload', 'effective-flags', 'restart']);
  assert.equal(fs.readFileSync(f.file, 'utf8'), implementation.eventDropIn(plan()));
});

test('a restart failure removes only the owned delta and restores the prior flags', async t => {
  const f = operationFixture(t), restart = f.io.restart;
  let fail = true;
  f.io.restart = async () => {
    if (fail) { fail = false; f.calls.push('restart-failed'); throw Error('private diagnostic must not escape'); }
    await restart();
  };
  await assert.rejects(implementation.applyEventCapability(f.plan, f.io), /^Error: CUP_EVENT_FAILED_RECOVERED$/);
  assert.equal(fs.existsSync(f.file), false);
  assert.deepEqual(f.state.flags, f.plan.before.flags);
  assert.equal(f.state.configFingerprint, f.plan.before.configFingerprint);
});

test('foreign config drift after reload stops before restarting or deleting anything', async t => {
  const f = operationFixture(t), reload = f.io.reload;
  f.io.reload = async () => { await reload(); f.state.configFingerprint = '5'.repeat(64); };
  await assert.rejects(implementation.applyEventCapability(f.plan, f.io), /CUP_EVENT_RECONCILE_REQUIRED/);
  assert.equal(f.calls.includes('restart'), false, 'foreign configuration was restarted');
  assert.equal(f.calls.includes('remove-owned'), false);
  assert.equal(fs.existsSync(f.file), true);
});

test('systemd flag parsing does not mistake quoted unrelated values for assignments', () => {
  assert.equal(typeof implementation.selectedSystemdFlags, 'function', 'the effective-config parser is missing');
  const raw = 'OTHER="value PHAB_COMMUNITY_POLICIES_ENABLED=false" PHAB_COMMUNITY_POLICIES_ENABLED=true PHAB_COMMUNITY_POLICY_TYPES_ENABLED=EVENT';
  assert.deepEqual(implementation.selectedSystemdFlags(raw), plan().flags);
  assert.throws(() => implementation.selectedSystemdFlags('OTHER="unfinished'));
  assert.throws(() => implementation.selectedSystemdFlags('PHAB_COMMUNITY_POLICIES_ENABLED=true PHAB_COMMUNITY_POLICIES_ENABLED=false'));
});

test('the systemd release lock must be a real ancestor-owned exclusive flock', () => {
  assert.equal(typeof implementation.assertReleaseFlock, 'function', 'release-lock ownership verification is missing');
  const pins = { uid: 0, mode: 0o600, nlink: 1, regular: true, major: '08', minor: '01', ino: '123', ancestors: [700, 600] };
  implementation.assertReleaseFlock(pins, '4: FLOCK ADVISORY WRITE 600 08:01:123 0 EOF');
  for (const line of ['4: FLOCK ADVISORY READ 600 08:01:123 0 EOF', '4: FLOCK ADVISORY WRITE 999 08:01:123 0 EOF', '4: FLOCK ADVISORY WRITE 600 08:01:124 0 EOF']) {
    assert.throws(() => implementation.assertReleaseFlock(pins, line));
  }
  assert.throws(() => implementation.assertReleaseFlock({ ...pins, nlink: 2 }, '4: FLOCK ADVISORY WRITE 600 08:01:123 0 EOF'));
});

test('runtime inventory reads only pinned ordinary artifacts, never environment files', async t => {
  const native = await import('../scripts/cup-event-capability-remote.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof native.verifyRuntimeInventory, 'function', 'runtime verification is missing');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.js'), 'synthetic artifact');
  const manifest = { sourceCommit: plan().runtimeSource, sourceTree: '7b1a9e9f5536914d130b41bbb7c9c4f74b0ea4a0',
    configurationIncluded: false, databaseChanges: false,
    files: [{ path: 'main.js', sha256: implementation.bodySha256('synthetic artifact') }] };
  assert.equal(native.verifyRuntimeInventory(root, manifest).fileCount, 1);
  fs.writeFileSync(path.join(root, 'main.js'), 'changed');
  assert.throws(() => native.verifyRuntimeInventory(root, manifest));
  for (const bad of ['../outside', '.env', 'nested/.env.private']) {
    assert.throws(() => native.verifyRuntimeInventory(root, { ...manifest, files: [{ path: bad, sha256: '0'.repeat(64) }] }));
  }
});

test('publication records inode custody before the new config becomes visible', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-custody-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'event.conf'); let captured;
  implementation.publishOwnDropIn(file, 'synthetic', { beforeLink(value) {
    assert.equal(fs.existsSync(file), false); captured = value;
  } });
  assert(captured, 'custody was not recorded before publication');
  assert.equal(captured.ino, fs.statSync(file).ino);
});

test('the native adapter refuses a non-Linux, non-root or wrong-host boundary', async () => {
  const native = await import('../scripts/cup-event-capability-remote.mjs');
  assert.equal(typeof native.assertNativeBoundary, 'function', 'native execution boundary is missing');
  native.assertNativeBoundary({ platform: 'linux', uid: 0, host: '3170594-cd19972' });
  for (const bad of [{ platform: 'darwin', uid: 0, host: '3170594-cd19972' }, { platform: 'linux', uid: 501, host: '3170594-cd19972' }, { platform: 'linux', uid: 0, host: 'other' }]) {
    assert.throws(() => native.assertNativeBoundary(bad));
  }
});

test('post-apply observation failure can recover the owned config without business rollback', async t => {
  assert.equal(typeof implementation.recoverEventCapability, 'function', 'post-apply recovery is missing');
  const f = operationFixture(t);
  await implementation.applyEventCapability(f.plan, f.io);
  const result = await implementation.recoverEventCapability(f.plan, f.io);
  assert.equal(result.status, 'RECOVERED');
  assert.equal(fs.existsSync(f.file), false);
  assert.deepEqual(f.state.flags, f.plan.before.flags);
});

test('process environment comparison exposes no secrets and excludes only known volatile fields', () => {
  assert.equal(typeof implementation.environmentIdentity, 'function', 'redacted environment identity is missing');
  const a = implementation.environmentIdentity('SECRET=synthetic-private\0PORT=3000\0INVOCATION_ID=one\0');
  const b = implementation.environmentIdentity('SECRET=synthetic-private\0PORT=3000\0INVOCATION_ID=two\0PHAB_COMMUNITY_POLICIES_ENABLED=true\0PHAB_COMMUNITY_POLICY_TYPES_ENABLED=EVENT\0');
  assert.equal(a.otherEnvironmentSha, b.otherEnvironmentSha);
  assert.deepEqual(b.flags, plan().flags);
  assert(!JSON.stringify(a).includes('synthetic-private'));
  assert.notEqual(a.otherEnvironmentSha, implementation.environmentIdentity('SECRET=changed\0PORT=3000\0').otherEnvironmentSha);
});

test('native construction cannot run host commands outside the admitted Linux root boundary', async () => {
  const native = await import('../scripts/cup-event-capability-remote.mjs');
  assert.equal(typeof native.createNativeIO, 'function', 'the real operator adapter is missing');
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    assert.throws(() => native.createNativeIO('/not-an-admitted-stage'), /CUP_EVENT_(PLATFORM|ROOT_REQUIRED)/);
  }
});

test('the held-lock operation completes only after stable observation and matching browser evidence', async t => {
  assert.equal(typeof implementation.runVerifiedOperation, 'function', 'the complete operation is missing');
  const f = operationFixture(t), proof = 'synthetic browser evidence\n'; let clock = 0;
  f.plan.nonce = '12345678-1234-4234-8234-123456789012';
  f.plan.browserProofSha256 = implementation.bodySha256(proof);
  Object.assign(f.io, { assertFreshRun() {}, record(name, value) {
    fs.writeFileSync(path.join(path.dirname(f.file), name), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  }, monotonic: () => clock, sleep: async ms => { clock += ms; }, readBrowserProof: () => Buffer.from(proof) });
  const result = await implementation.runVerifiedOperation(f.plan, f.io);
  assert.equal(result.status, 'PASS');
  assert.equal(result.pid, 101);
  assert(clock >= 120000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(f.file), 'complete.json'))).status, 'PASS');
});

test('the real CLI rejects unknown actions without exposing diagnostics or doing work', () => {
  const file = new URL('../scripts/cup-event-capability-remote.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(file), 'not-an-action'], { encoding: 'utf8' });
  assert.equal(result.status, 1, 'the CLI did not enforce its action boundary');
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: 'CUP_EVENT_USAGE' });
  assert.equal(result.stderr, '');
});

test('an effective-config failure restores the file delta without an unnecessary CUP restart', async t => {
  const f = operationFixture(t);
  f.io.verifyEffectiveFlags = async () => { throw Error('precedence mismatch'); };
  await assert.rejects(implementation.applyEventCapability(f.plan, f.io), /CUP_EVENT_FAILED_RECOVERED/);
  assert(!fs.existsSync(f.file)); assert(!f.calls.includes('restart'));
  assert.equal(f.state.pid, f.plan.before.pid);
});

test('post-apply wrong flags or protected-service drift cannot pass', async t => {
  for (const key of ['flags', 'protectedFingerprint', 'otherEnvironmentSha', 'restarts']) {
    const f = operationFixture(t), restart = f.io.restart;
    let first = true;
    f.io.restart = async () => {
      await restart();
      if (first) {
        first = false;
        if (key === 'flags') f.state.flags = { ...plan().flags, PHAB_COMMUNITY_POLICIES_ENABLED: 'false' };
        else if (key === 'restarts') f.state.restarts++;
        else f.state[key] = '9'.repeat(64);
      }
    };
    await assert.rejects(implementation.applyEventCapability(f.plan, f.io), /CUP_EVENT_(FAILED_RECOVERED|RECONCILE_REQUIRED)/);
  }
});

test('atomic publication cleans its own failed link pair but preserves changed foreign bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-link-fault-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a.conf'), b = path.join(root, 'b.conf');
  assert.throws(() => implementation.publishOwnDropIn(a, 'owned', { afterLink() { throw Error('fault'); } }), /CUP_EVENT_PUBLICATION_FAILED/);
  assert(!fs.existsSync(a));
  assert.throws(() => implementation.publishOwnDropIn(b, 'owned', { afterLink() { fs.writeFileSync(b, 'foreign'); throw Error('fault'); } }), /CUP_EVENT_PUBLICATION_RECONCILE/);
  assert.equal(fs.readFileSync(b, 'utf8'), 'foreign');
});

test('a mismatched browser proof recovers flags and never declares completion', async t => {
  const f = operationFixture(t); let clock = 0;
  Object.assign(f.plan, { nonce: '12345678-1234-4234-8234-123456789012', browserProofSha256: '0'.repeat(64) });
  Object.assign(f.io, { assertFreshRun() {}, record(name, value) { fs.writeFileSync(path.join(path.dirname(f.file), name), JSON.stringify(value), { flag: 'wx' }); },
    monotonic: () => clock, sleep: async ms => { clock += ms; }, readBrowserProof: () => Buffer.from('wrong') });
  await assert.rejects(implementation.runVerifiedOperation(f.plan, f.io), /CUP_EVENT_OBSERVATION_FAILED_RECOVERED/);
  assert(!fs.existsSync(f.file));
  assert(!fs.existsSync(path.join(path.dirname(f.file), 'complete.json')));
  assert.deepEqual(f.state.flags, f.plan.before.flags);
});

test('owned publication enforces exact private modes even under a restrictive inherited umask', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'event.conf'), old = process.umask(0o777);
  try { implementation.publishOwnDropIn(file, 'synthetic'); }
  finally { process.umask(old); }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
