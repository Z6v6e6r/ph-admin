import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MEDIA_RECOVERY_SOURCES, verifyMediaRecoverySources, verifyMediaRecoveryCompilation, restoreEquivalentRecoveryDeclarations, verifyMediaRecoveryCandidateHash, MEDIA_RECOVERY_SDK_SHA256, MEDIA_FPR_CANDIDATE_SDK_SHA256 } from '../scripts/lib/cup-media-recovery-closure.mjs';
test('actual recovery patch derives exactly21 reviewed sources with the pinned historical photo SDK', t => {
  assert.equal(MEDIA_RECOVERY_SOURCES.length, 21);
  const root = path.resolve(import.meta.dirname, '..'), derived = fs.mkdtempSync(path.join(os.tmpdir(), 'media-recovery-source-'));
  t.after(() => fs.rmSync(derived, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: derived, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  const baseline = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
  const baselineFiles = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { cwd: root, encoding: 'utf8' }).trim().split('\n'));
  for (const file of MEDIA_RECOVERY_SOURCES) {
    if (!baselineFiles.has(file)) continue; // Only verified new reader modules may be absent.
    const body = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    fs.mkdirSync(path.dirname(path.join(derived, file)), { recursive: true }); fs.writeFileSync(path.join(derived, file), body);
  }
  git('add', '.');
  git('apply', '--index', '--unidiff-zero', path.join(root, 'deploy/recovery/support-media-custody-83.patch'));
  verifyMediaRecoverySources(root, derived, MEDIA_RECOVERY_SOURCES);
  assert.throws(() => verifyMediaRecoverySources(root, derived, [...MEDIA_RECOVERY_SOURCES, 'src/foreign.ts']), /closure/);
  for (const file of ['src/integrations/viva/viva-request-governor.service.ts', 'src/integrations/viva/viva-tournaments.service.ts']) {
    const target = path.join(derived, file), original = fs.readFileSync(target);
    fs.appendFileSync(target, '\n// stale governor\n');
    assert.throws(() => verifyMediaRecoverySources(root, derived, MEDIA_RECOVERY_SOURCES), /source drift/);
    fs.writeFileSync(target, original);
  }
});
test('SDK compatibility permits only the exact reviewed FPR pair; backend parity remains exact', () => {
  for (const name of ['phab-admin-panel.js', 'client-sdk/phab-admin-panel.js']) {
    verifyMediaRecoveryCandidateHash(name, MEDIA_FPR_CANDIDATE_SDK_SHA256, MEDIA_RECOVERY_SDK_SHA256);
    verifyMediaRecoveryCandidateHash(name, MEDIA_RECOVERY_SDK_SHA256, MEDIA_RECOVERY_SDK_SHA256);
    assert.throws(() => verifyMediaRecoveryCandidateHash(name, '0'.repeat(64), MEDIA_RECOVERY_SDK_SHA256), /candidate SDK drift/);
    assert.throws(() => verifyMediaRecoveryCandidateHash(name, MEDIA_FPR_CANDIDATE_SDK_SHA256, '0'.repeat(64)), /recovery SDK drift/);
  }
  assert.throws(() => verifyMediaRecoveryCandidateHash('support/support.service.js', MEDIA_FPR_CANDIDATE_SDK_SHA256, MEDIA_RECOVERY_SDK_SHA256), /compiled closure mismatch/);
  assert.throws(() => verifyMediaRecoveryCandidateHash('unrelated.js', MEDIA_FPR_CANDIDATE_SDK_SHA256, MEDIA_RECOVERY_SDK_SHA256), /compiled closure mismatch/);
});
test('media-aware recovery requires the explicit reader, custody and SDK closure and forbids unrelated changes', () => {
  const row = (path, sha256) => ({ path, bytes: 1, sha256 });
  const modules = MEDIA_RECOVERY_SOURCES.filter(p => p.startsWith('src/')).map(p => p.slice(4, -3));
  const executables = modules.filter(p => p !== 'common/messages/message-attachment.types').map(p => p + '.js')
    .concat('phab-admin-panel.js', 'client-sdk/phab-admin-panel.js');
  const before = [row('unrelated/payment.js', 'unchanged')];
  const after = before.concat(executables.map(p => row(p, 'new')));
  assert.equal(verifyMediaRecoveryCompilation(before, after).length, 19);
  for (const name of ['viva-request-governor.service', 'viva-tournaments.service']) {
    assert.throws(() => verifyMediaRecoveryCompilation(before, after.filter(p => p.path !== `integrations/viva/${name}.js`)), /incomplete/);
  }
  assert.throws(() => verifyMediaRecoveryCompilation(before, after.filter(p => p.path !== 'support/support-media.service.js')), /incomplete/);
  assert.throws(() => verifyMediaRecoveryCompilation(before, after.concat(row('unrelated/payment.js', 'changed'))), /expanded/);
  assert.throws(() => verifyMediaRecoveryCompilation(before, after.filter(p => p.path !== 'unrelated/payment.js')), /removed/);
});
test('only semantically equivalent union-order declarations can be restored; runtime and changed types remain closed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-recovery-declarations-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = Buffer.from('export declare const permissions: ("read" | "write")[];\n');
  const before = new Map([['unrelated.d.ts', original]]);
  fs.writeFileSync(path.join(root, 'unrelated.d.ts'), 'export declare const permissions: ("write" | "read")[];\n');
  assert.deepEqual(restoreEquivalentRecoveryDeclarations(before, root), ['unrelated.d.ts']);
  assert(fs.readFileSync(path.join(root, 'unrelated.d.ts')).equals(original));
  fs.writeFileSync(path.join(root, 'unrelated.d.ts'), 'export declare const permissions: ("admin" | "read")[];\n');
  assert.throws(() => restoreEquivalentRecoveryDeclarations(before, root), /semantics changed/);
});
