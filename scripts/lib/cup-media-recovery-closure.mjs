import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CUSTODY_FILES } from './cup-max-recovery-closure.mjs';
import ts from 'typescript';

export const MEDIA_RECOVERY_TS = Object.freeze([
  ...CUSTODY_FILES.map(n => `src/support/${n}.ts`),
  ...['support-media-auth', 'support-media.controller', 'support-media-download', 'support-media.interceptor',
    'support-media.service', 'support-media-store'].map(n => `src/support/${n}.ts`),
  'src/support/support.controller.ts', 'src/support/support.module.ts',
  'src/messenger/messenger.controller.ts', 'src/messenger/messenger.service.ts',
  'src/common/messages/message-attachment.types.ts'
]);
export const MEDIA_RECOVERY_SOURCES = Object.freeze([
  ...MEDIA_RECOVERY_TS,
  'client-sdk/phab-admin-panel.js', 'package.json', 'package-lock.json'
]);
const modules = MEDIA_RECOVERY_SOURCES.filter(p => p.startsWith('src/')).map(p => p.slice(4, -3));
const sdk = ['phab-admin-panel.js', 'client-sdk/phab-admin-panel.js'];

function canonicalDeclaration(body) {
  const file = ts.createSourceFile('declaration.d.ts', body, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, 'Invalid recovery declaration');
  const printer = ts.createPrinter({ removeComments: true });
  const result = ts.transform(file, [context => node => {
    const visit = current => {
      const visited = ts.visitEachChild(current, visit, context);
      if (!ts.isUnionTypeNode(visited)) return visited;
      const types = [...visited.types].sort((a, b) => printer.printNode(ts.EmitHint.Unspecified, a, file)
        .localeCompare(printer.printNode(ts.EmitHint.Unspecified, b, file)));
      return ts.factory.updateUnionTypeNode(visited, types);
    };
    return ts.visitNode(node, visit);
  }]);
  try { return printer.printFile(result.transformed[0]); } finally { result.dispose(); }
}

/** Additional imports can reorder inferred type unions. Keep unrelated declaration bytes exact,
 * but only after AST equivalence (union order only) has been proved. Executables never qualify. */
export function restoreEquivalentRecoveryDeclarations(before, derivedDist) {
  const restored = [];
  for (const [name, body] of before) {
    if (modules.some(m => name === m + '.d.ts')) continue;
    const file = path.join(derivedDist, name), next = fs.readFileSync(file);
    if (body.equals(next)) continue;
    assert.equal(canonicalDeclaration(body.toString()), canonicalDeclaration(next.toString()), 'Unrelated declaration semantics changed');
    fs.writeFileSync(file, body); restored.push(name);
  }
  return restored;
}

export function verifyMediaRecoverySources(source, derived, changed) {
  assert.deepEqual([...changed].sort(), [...MEDIA_RECOVERY_SOURCES].sort(), 'Media recovery source closure expanded or incomplete');
  for (const name of changed) assert.ok(fs.readFileSync(path.join(source, name)).equals(fs.readFileSync(path.join(derived, name))), 'Media recovery source drift');
}
export function verifyMediaRecoveryCompilation(beforeRows, after) {
  const before = new Map(beforeRows.map(r => [r.path, r]));
  assert.ok(beforeRows.every(r => after.some(x => x.path === r.path)), 'Media recovery removed baseline file');
  const changed = after.filter(r => JSON.stringify(r) !== JSON.stringify(before.get(r.path)));
  const allowed = new Set([...modules.flatMap(m => ['js', 'd.ts', 'js.map'].map(ext => `${m}.${ext}`)), ...sdk]);
  assert.ok(changed.every(r => allowed.has(r.path)), 'Media recovery compiled closure expanded');
  const executable = changed.filter(r => r.path.endsWith('.js'));
  const required = [...modules.filter(m => m !== 'common/messages/message-attachment.types').map(m => m + '.js'), ...sdk].sort();
  assert.deepEqual(executable.map(r => r.path).sort(), required, 'Media recovery reader/custody closure incomplete');
  return executable;
}
