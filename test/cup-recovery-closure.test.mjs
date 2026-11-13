import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CUSTODY_FILES, verifyCustodySources, verifyCustodyCompilation } from '../scripts/lib/cup-max-recovery-closure.mjs';

test('actual baseline83 patch produces exactly the current five source modules; drift and sixth file refuse', () => {
  const source = path.resolve(import.meta.dirname, '..');
  const derived = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-closure-'));
  const baseline = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
  const git = (...args) => execFileSync('git', args, { cwd: derived, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    git('init', '--quiet');
    for (const name of CUSTODY_FILES.filter(name => name !== 'legacy-max-custody')) {
      const file = `src/support/${name}.ts`;
      const body = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: source });
      fs.mkdirSync(path.join(derived, 'src/support'), { recursive: true });
      fs.writeFileSync(path.join(derived, file), body);
    }
    git('add', 'src/support');
    git('apply', '--index', path.join(source, 'deploy/recovery/legacy-max-custody-83.patch'));
    const changed = CUSTODY_FILES.map(name => `src/support/${name}.ts`);
    verifyCustodySources(source, derived, changed);
    assert.throws(() => verifyCustodySources(source, derived, [...changed, 'src/foreign.ts']), /source closure/);
    assert.throws(() => verifyCustodySources(source, derived, changed.slice(1)), /source closure/);
    fs.appendFileSync(path.join(derived, changed[0]), '\n// synthetic detached change\n');
    assert.throws(() => verifyCustodySources(source, derived, changed), /source drift/);
  } finally { fs.rmSync(derived, { recursive: true, force: true }); }
});

test('compiled closure permits only five JS modules, preserves unrelated baseline and refuses partial/extra executables', () => {
  const row = (path, sha256) => ({ path, bytes: 1, sha256 });
  const before = CUSTODY_FILES.filter(n => n !== 'legacy-max-custody').map(n => row(`support/${n}.js`, 'old'));
  before.push(row('unrelated/retained.js', 'old'));
  const after = CUSTODY_FILES.map(n => row(`support/${n}.js`, 'new')).concat(before.at(-1));
  assert.equal(verifyCustodyCompilation(before, after).length, 5);
  assert.equal(verifyCustodyCompilation(before, after.concat(row('support/support.controller.d.ts', 'new'))).length, 5);
  assert.throws(() => verifyCustodyCompilation(before, after.concat(row('support/foreign.js', 'new'))), /closure expanded/);
  assert.throws(() => verifyCustodyCompilation(before, after.filter(r => r.path !== 'unrelated/retained.js')), /removed/);
  assert.throws(() => verifyCustodyCompilation(before, after.filter(r => r.path !== 'support/legacy-max-custody.js')), /closure size/);
  const wrong = after.map(r => r.path === 'support/max-outbox-policy.js' ? row('support/max-outbox-policy.d.ts', 'new') : r);
  assert.throws(() => verifyCustodyCompilation(before.filter(r => r.path !== 'support/max-outbox-policy.js'), wrong), /executable closure/);
});
