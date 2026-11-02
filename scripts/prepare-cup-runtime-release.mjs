// Build only: no SSH, credentials, production config, database mutation or publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.equal(process.platform, 'linux', 'Release builds require Linux');
assert.equal(process.arch, 'x64', 'Release builds require x64');
assert.equal(process.versions.node.split('.')[0], '22', 'Release builds require Node22');
const source = process.cwd();
const output = path.resolve(process.argv[2]);
const mongoUri = process.argv[3];
assert.ok(mongoUri, 'Owned test Mongo URI required');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['127.0.0.1', 'localhost'].includes(mongoUrl.hostname));
assert.ok(!fs.existsSync(output), 'Output must be fresh');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-release-build-'));
const run = (file, args, cwd = source, env = {}) => execFileSync(file, args, {
  cwd, env: { ...process.env, ...env }, stdio: 'inherit', timeout: 600000
});
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const inventory = root => {
  const rows = [];
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.endsWith('.tsbuildinfo')) continue;
      const file = path.join(directory, name), info = fs.lstatSync(file);
      assert.ok(!info.isSymbolicLink(), 'Unexpected runtime symlink');
      assert.ok(!name.startsWith('.env'), 'Environment files are never runtime payload');
      if (info.isDirectory()) visit(file);
      else {
        assert.ok(info.isFile(), 'Unexpected runtime special file');
        rows.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: info.size,
          sha256: hash(fs.readFileSync(file)) });
      }
    }
  }
  visit(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
};
const sourceCommit = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
assert.equal(git('status', '--porcelain'), '', 'Tracked source must be clean');
const baseline = '8a68cdec6a15a0065acbab90c08b25237133d076';
const patchFile = path.join(source, 'deploy/recovery/tournament-state-safe-8a68.patch');
const recovery = path.join(scratch, 'recovery');
run('git', ['worktree', 'add', '--detach', recovery, baseline]);
try {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], recovery);
  run('npm', ['run', 'build'], recovery);
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: recovery, encoding: 'utf8' }).trim(), '');
  const baselineCompiled = new Map(inventory(path.join(recovery, 'dist')).map(row => [row.path, row]));
  run('git', ['apply', '--index', patchFile], recovery);
  const derivedSourceTree = execFileSync('git', ['write-tree'], { cwd: recovery, encoding: 'utf8' }).trim();
  run('npm', ['run', 'build'], recovery);
  const candidateCompiled = inventory(path.join(recovery, 'dist'));
  const compilerDelta = candidateCompiled.filter(row => JSON.stringify(row) !== JSON.stringify(baselineCompiled.get(row.path)));
  assert.ok(compilerDelta.length >= 2 && compilerDelta.length <= 6);
  assert.ok(compilerDelta.every(row => /^tournaments\/tournaments(?:-persistence)?\.service\.(?:js|d\.ts|js\.map)$/.test(row.path)));
  // Recovery is an executable-only overlay: preserve the active release's declarations/maps.
  const delta = compilerDelta.filter(row => row.path.endsWith('.js'));
  assert.equal(delta.length, 2);
  const recoveryPayload = path.join(scratch, 'recovery-payload'); fs.mkdirSync(recoveryPayload);
  for (const row of delta) {
    const file = path.join(recoveryPayload, 'dist', row.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(recovery, 'dist', row.path), file);
  }
  run(process.execPath, [path.join(source, 'test/cup-recovery-state-safety.test.mjs')], source, { CUP_RECOVERY_ROOT: recovery });
  run(process.execPath, [path.join(source, 'test/cup-recovery-capacity.mongodb.test.mjs'), mongoUri], source, { CUP_RECOVERY_ROOT: recovery });
  fs.writeFileSync(path.join(output, 'recovery-manifest.json'), JSON.stringify({
    schema: 'PHAB_CUP_PAYMENT_SAFE_RECOVERY_V1', sourceCommit, sourceTree, baselineCommit: baseline,
    derivedSourceTree, patchSha256: hash(fs.readFileSync(patchFile)), nodeVersion: process.version,
    delta: delta.map(row => ({ ...row, path: 'dist/' + row.path, expectedPreviousSha256: baselineCompiled.get(row.path)?.sha256 }))
  }, null, 2) + '\n');
  run('tar', ['-czf', path.join(output, 'recovery-runtime-delta.tgz'), '-C', recoveryPayload, 'dist']);
} finally {
  run('git', ['worktree', 'remove', '--force', recovery]);
}
// Additional recovery for the installed83 runtime. The historical8a tournament-only
// artifact above remains distinct; it cannot represent MAX restart custody compatibility.
const custodyBaseline = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const custodyFiles = ['legacy-max-custody', 'support-persistence.service', 'support.service'];
const custodySourcePaths = custodyFiles.map(name => `src/support/${name}.ts`).sort();
const custodyPatch = path.join(source, 'deploy/recovery/legacy-max-custody-83.patch');
const custodyRoot = path.join(scratch, 'custody-recovery');
const custodyPayload = path.join(scratch, 'custody-recovery-payload');
let custodyDelta;
run('git', ['worktree', 'add', '--detach', custodyRoot, custodyBaseline]);
try {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], custodyRoot);
  run('npm', ['run', 'build'], custodyRoot);
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: custodyRoot, encoding: 'utf8' }).trim(), '');
  const before = new Map(inventory(path.join(custodyRoot, 'dist')).map(row => [row.path, row]));
  run('git', ['apply', '--index', custodyPatch], custodyRoot);
  const changed = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: custodyRoot, encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(changed, custodySourcePaths);
  // A future source change must explicitly review/regenerate this exact recovery closure.
  for (const name of custodySourcePaths) assert.ok(fs.readFileSync(path.join(custodyRoot, name)).equals(fs.readFileSync(path.join(source, name))), 'Custody source drift');
  const derivedSourceTree = execFileSync('git', ['write-tree'], { cwd: custodyRoot, encoding: 'utf8' }).trim();
  run('npm', ['run', 'build'], custodyRoot);
  const after = inventory(path.join(custodyRoot, 'dist'));
  assert.ok([...before.keys()].every(name => after.some(row => row.path === name)), 'Recovery removed compiled files');
  const changedCompiled = after.filter(row => JSON.stringify(row) !== JSON.stringify(before.get(row.path)));
  const allowed = new Set(custodyFiles.flatMap(name => ['js', 'd.ts', 'js.map'].map(ext => `support/${name}.${ext}`)));
  // The unchanged controller infers the updated asynchronous reply return type.
  allowed.add('support/support.controller.d.ts');
  assert.ok(changedCompiled.length >= 3 && changedCompiled.length <= 10);
  assert.ok(changedCompiled.every(row => allowed.has(row.path)), 'Recovery compiled closure expanded');
  custodyDelta = changedCompiled.filter(row => row.path.endsWith('.js'));
  assert.deepEqual(custodyDelta.map(row => row.path).sort(), custodyFiles.map(name => `support/${name}.js`).sort());
  fs.mkdirSync(custodyPayload);
  for (const row of custodyDelta) {
    const file = path.join(custodyPayload, 'dist', row.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(custodyRoot, 'dist', row.path), file);
  }
  run(process.execPath, [path.join(source, 'test/cup-recovery-legacy-max.test.mjs'), mongoUri], source, { CUP_RECOVERY_ROOT: custodyRoot });
  fs.writeFileSync(path.join(output, 'legacy-max-recovery-manifest.json'), JSON.stringify({
    schema: 'PHAB_CUP_LEGACY_MAX_SAFE_RECOVERY_V1', sourceCommit, sourceTree,
    baselineCommit: custodyBaseline, derivedSourceTree, patchSha256: hash(fs.readFileSync(custodyPatch)),
    nodeVersion: process.version, maxOutboxMode: 'legacy', persistenceSyncIntervalMs: 0,
    automaticHydrationAllowed: false, firstRestartCustodyProven: false,
    delta: custodyDelta.map(row => ({ ...row, path: 'dist/' + row.path,
      expectedPreviousSha256: before.get(row.path)?.sha256 ?? null }))
  }, null, 2) + '\n');
  run('tar', ['-czf', path.join(output, 'legacy-max-recovery-runtime-delta.tgz'), '-C', custodyPayload, 'dist']);
} finally {
  run('git', ['worktree', 'remove', '--force', custodyRoot]);
}
run('npm', ['run', 'build']);
for (const row of custodyDelta) assert.equal(hash(fs.readFileSync(path.join(source, 'dist', row.path))), row.sha256, 'Candidate/recovery compiled custody mismatch');
const runtime = path.join(scratch, 'runtime'); fs.mkdirSync(runtime);
for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, name), path.join(runtime, name));
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
// npm executable shims are build tools; no symlink or env file enters the deployment archive.
function stripShims(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name), info = fs.lstatSync(file);
    if (name === '.bin' || name.startsWith('.env') || name.endsWith('.tsbuildinfo')) fs.rmSync(file, { recursive: true, force: true });
    else if (info.isDirectory()) stripShims(file);
    else assert.ok(info.isFile() && !info.isSymbolicLink());
  }
}
for (const name of ['dist', 'client-sdk']) fs.cpSync(path.join(source, name), path.join(runtime, name), { recursive: true });
stripShims(runtime);
const manifest = { schema: 'PHAB_CUP_RUNTIME_RELEASE_V1', repository: 'Z6v6e6r/ph-admin',
  sourceCommit, sourceTree, nodeVersion: process.version, files: inventory(runtime),
  runtimeNode: 'Preserve the independently verified active runtime/node executable; do not use host PATH',
  configurationIncluded: false, databaseChanges: false };
fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
run('tar', ['-czf', path.join(output, 'cup-runtime.tgz'), '-C', runtime, 'dist', 'client-sdk', 'node_modules', 'package.json', 'package-lock.json']);
const checksums = inventory(output).map(row => `${row.sha256}  ${row.path}`).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'SHA256SUMS'), checksums);
assert.equal(git('status', '--porcelain'), '', 'Build altered tracked source');
console.log(JSON.stringify({ sourceCommit, sourceTree, output, result: 'BUILT_AND_RECOVERY_REHEARSED_NO_DEPLOY' }));
