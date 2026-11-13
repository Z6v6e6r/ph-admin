import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const CUSTODY_FILES = Object.freeze(['legacy-max-custody', 'max-outbox-policy', 'max-outbox-store',
  'support-persistence.service', 'support.service']);

export function verifyCustodySources(source, derived, changed) {
  const expected = CUSTODY_FILES.map(name => `src/support/${name}.ts`).sort();
  assert.deepEqual([...changed].sort(), expected, 'Custody source closure expanded');
  for (const name of expected) assert.ok(fs.readFileSync(path.join(derived, name))
    .equals(fs.readFileSync(path.join(source, name))), 'Custody source drift');
}

export function verifyCustodyCompilation(beforeRows, after) {
  const before = new Map(beforeRows.map(row => [row.path, row]));
  assert.ok([...before.keys()].every(name => after.some(row => row.path === name)), 'Recovery removed compiled files');
  const changed = after.filter(row => JSON.stringify(row) !== JSON.stringify(before.get(row.path)));
  const allowed = new Set(CUSTODY_FILES.flatMap(name => ['js', 'd.ts', 'js.map'].map(ext => `support/${name}.${ext}`)));
  // The unchanged baseline controller can infer a changed asynchronous reply return type.
  allowed.add('support/support.controller.d.ts');
  assert.ok(changed.length >= 5 && changed.length <= 16, 'Recovery compiled closure size');
  assert.ok(changed.every(row => allowed.has(row.path)), 'Recovery compiled closure expanded');
  const executable = changed.filter(row => row.path.endsWith('.js'));
  assert.deepEqual(executable.map(row => row.path).sort(), CUSTODY_FILES.map(name => `support/${name}.js`).sort(),
    'Recovery executable closure mismatch');
  return executable;
}
