import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureAndFenceCup83Support } from '../scripts/lib/cup83-support-fence.mjs';
const SOURCE = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const identity = () => ({ pid: process.pid, start: String(performance.timeOrigin),
  nodeVersion: process.version, sourceEpoch: SOURCE });
class Support {
  isPersistenceSyncInProgress = false;
  persistenceSyncIntervalMs = 100;
  outbox = new Map([['command-1', { id: 'command-1', connector: 'MAX_BOT', status: 'SENT',
    text: 'synthetic only', nested: { omitted: undefined } }]]);
}
function fixture(t) {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'cup83-fence-synthetic-')); fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const support = new Support();
  const run = (instances = [support], expected = identity(), proto = Support.prototype) =>
    captureAndFenceCup83Support.call(instances, expected, proto, directory);
  return { directory, support, run };
}
const unchanged = f => {
  assert.equal(f.support.persistenceSyncIntervalMs, 100);
  assert.deepEqual(fs.readdirSync(f.directory), []);
};
test('durably captures before fencing, preserving undefined sidecar and fixed counts only', t => {
  const f = fixture(t), result = f.run();
  const bytes = fs.readFileSync(f.directory + '/pre-drain-map.json');
  assert.equal(result.artifactSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.drainProven, false); assert.equal(result.replayAllowed, false);
  assert.equal(result.maxCount, 1); assert.equal(Object.hasOwn(result, 'rows'), false);
  assert.deepEqual(JSON.parse(bytes).undefinedPaths, [{ commandId: 'command-1', path: ['nested', 'omitted'] }]);
  assert.equal(f.support.persistenceSyncIntervalMs, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.directory + '/pre-drain-fence.json')), JSON.parse(JSON.stringify(result)));
  for (const file of fs.readdirSync(f.directory)) assert.equal(fs.statSync(f.directory + '/' + file).mode & 0o777, 0o600);
  assert.throws(f.run, /NO_REPLAY/);
});
test('active hydrate refuses before any file or field mutation', t => {
  const f = fixture(t); f.support.isPersistenceSyncInProgress = true;
  assert.throws(f.run, /ACTIVE_HYDRATE/); unchanged(f);
});
for (const [name, instances, expected, proto] of [
  ['duplicate instance', s => [s, new Support()], identity, () => Support.prototype],
  ['foreign prototype', s => [s], identity, () => Object.prototype],
  ['wrong pid', s => [s], () => ({ ...identity(), pid: 1 }), () => Support.prototype],
  ['wrong start', s => [s], () => ({ ...identity(), start: '0' }), () => Support.prototype],
  ['wrong source', s => [s], () => ({ ...identity(), sourceEpoch: 'other' }), () => Support.prototype],
]) test(name + ' refuses before mutation', t => {
  const f = fixture(t); assert.throws(() => f.run(instances(f.support), expected(), proto()), /IDENTITY|INSTANCE/); unchanged(f);
});
test('accessor field is never evaluated', t => {
  const f = fixture(t); let evaluated = false;
  Object.defineProperty(f.support, 'isPersistenceSyncInProgress', { get() { evaluated = true; return false; } });
  assert.throws(f.run, /OWN_DATA_REQUIRED/); assert.equal(evaluated, false); unchanged(f);
});
test('inherited timer setter is never executed', t => {
  const f = fixture(t); let evaluated = false;
  Object.defineProperty(Support.prototype, 'persistenceSyncTimer', { configurable: true, set() { evaluated = true; } });
  try { assert.throws(f.run, /TIMER_DESCRIPTOR/); assert.equal(evaluated, false); unchanged(f); }
  finally { delete Support.prototype.persistenceSyncTimer; }
});
test('oversized Map and nondata command refuse before mutation', t => {
  const f = fixture(t); f.support.outbox = new Map(Array.from({ length: 5001 }, (_, i) => [String(i), {}]));
  assert.throws(f.run, /COUNT_LIMIT/); unchanged(f);
  f.support.outbox = new Map([['x', { connector: 'MAX_BOT', id: 'x', status: 'SENT', get text() { throw Error('getter ran'); } }]]);
  assert.throws(f.run, /OWN_DATA_REQUIRED/); unchanged(f);
});
test('existing artifact and existing receipt independently refuse before fence', t => {
  const f = fixture(t);
  for (const file of ['pre-drain-map.json', 'pre-drain-fence.json']) {
    fs.writeFileSync(f.directory + '/' + file, 'retained', { mode: 0o600 });
    assert.throws(f.run, /NO_REPLAY/); assert.equal(f.support.persistenceSyncIntervalMs, 100);
    assert.equal(fs.readFileSync(f.directory + '/' + file, 'utf8'), 'retained');
    fs.unlinkSync(f.directory + '/' + file);
  }
});
test('symlink and nonprivate directory refuse without timer mutation', t => {
  const f = fixture(t), link = f.directory + '-link';
  fs.symlinkSync(f.directory, link); t.after(() => fs.unlinkSync(link));
  assert.throws(() => captureAndFenceCup83Support.call([f.support], identity(), Support.prototype, link), /PRIVATE_DIRECTORY/);
  fs.chmodSync(f.directory, 0o755); assert.throws(f.run, /PRIVATE_DIRECTORY/); unchanged(f);
});
test('snapshot fsync failure preserves timers and prevents replay', t => {
  const f = fixture(t), original = fs.fsyncSync;
  fs.fsyncSync = () => { throw Error('SYNTHETIC_FSYNC_FAILURE'); };
  try { assert.throws(f.run, /SYNTHETIC_FSYNC_FAILURE/); }
  finally { fs.fsyncSync = original; }
  assert.equal(f.support.persistenceSyncIntervalMs, 100);
  assert.equal(Object.hasOwn(f.support, 'persistenceSyncTimer'), false);
  assert.throws(f.run, /NO_REPLAY/);
});
test('both scheduled timers are fenced before another event-loop turn', async t => {
  const f = fixture(t); let callbacks = 0;
  f.support.persistenceSyncTimer = setInterval(() => callbacks++, 1);
  f.support.noReplyQuickReplyTimer = setInterval(() => callbacks++, 1);
  t.after(() => { clearInterval(f.support.persistenceSyncTimer); clearInterval(f.support.noReplyQuickReplyTimer); });
  f.run(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(callbacks, 0); assert.equal(f.support.persistenceSyncTimer, undefined);
  assert.equal(f.support.noReplyQuickReplyTimer, undefined);
});
test('lost receipt acknowledgement cannot replay a successful fence', t => {
  const f = fixture(t); f.run(); // Deliberately discard the return value.
  assert.throws(f.run, /NO_REPLAY/);
  assert.equal(JSON.parse(fs.readFileSync(f.directory + '/pre-drain-fence.json')).drainProven, false);
});

test('Inspector function serialization has no module closure dependency', t => {
  const f = fixture(t);
  const standalone = new Function('return (' + captureAndFenceCup83Support.toString() + ')')();
  const result = standalone.call([f.support], identity(), Support.prototype, f.directory);
  assert.equal(result.status, 'SUPPORT_TIMERS_FENCED'); assert.equal(result.drainProven, false);
});
test('receipt write failure after fence retains snapshot and refuses replay', t => {
  const f = fixture(t), original = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...args) => {
    if (++writes === 2) throw Error('SYNTHETIC_RECEIPT_WRITE_FAILURE');
    return original(...args);
  };
  try { assert.throws(f.run, /SYNTHETIC_RECEIPT_WRITE_FAILURE/); }
  finally { fs.writeFileSync = original; }
  assert.equal(f.support.persistenceSyncIntervalMs, 0);
  assert.equal(f.support.persistenceSyncTimer, undefined);
  assert.equal(f.support.noReplyQuickReplyTimer, undefined);
  assert.equal(JSON.parse(fs.readFileSync(f.directory + '/pre-drain-map.json')).maxCount, 1);
  assert.equal(fs.statSync(f.directory + '/pre-drain-fence.json').size, 0);
  assert.throws(f.run, /NO_REPLAY/);
});
