#!/usr/bin/env node
// Verifies docs/release/cup133-joint-release-manifest.json against exact local checkouts and,
// optionally, the locally stored release artifacts. Read-only: hashes files and reads git metadata.
//   node scripts/verify-cup133-joint-release-manifest.mjs --cup <dir> --lk1 <dir> --lk2 <dir> [--artifacts <dir>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = fileURLToPath(new URL('../docs/release/cup133-joint-release-manifest.json', import.meta.url));
const SHA = /^[0-9a-f]{64}$/;
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function workerFilesDigest(files) {
  // Binary (code-unit) order, not locale order: the digest must be reproducible in any language.
  return sha256([...files].sort((a, b) => byCodeUnit(a.releasePath, b.releasePath))
    .map(file => `${file.sha256}  ${file.releasePath}\n`).join(''));
}

/** Inputs that must be produced before the joint release is complete. */
export function pendingInputs(manifest) {
  const pending = [];
  const frontend = manifest.components?.lk1?.frontend;
  if (!frontend || frontend.status !== 'RECORDED' || !frontend.expected?.files?.length) pending.push('lk1.frontend');
  const graph = manifest.nodeRedGraph;
  if (!graph || graph.status !== 'RECORDED' || !SHA.test(graph.expected?.finalSha256 ?? '')) pending.push('nodeRedGraph');
  return pending;
}

/** Checks that need only the manifest itself. */
export function verifyManifestConsistency(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 'PHUB_CUP133_JOINT_RELEASE_MANIFEST_V2') errors.push('schemaVersion');
  const { cup, lk1, lk2 } = manifest.components ?? {};
  const worker = lk1?.ratingWorker;
  if (!worker || worker.files?.length !== worker.fileCount) errors.push('worker fileCount');
  else if (workerFilesDigest(worker.files) !== worker.filesDigest) errors.push('worker filesDigest');
  if (worker?.files && new Set(worker.files.map(f => f.releasePath)).size !== worker.files.length) errors.push('worker duplicate paths');
  for (const entry of worker?.workers ?? []) {
    if (worker.files.find(f => f.releasePath === entry.entry)?.sha256 !== entry.sha256) errors.push(`worker entry ${entry.entry}`);
  }
  if ((worker?.workers ?? []).length !== 2) errors.push('worker entries');
  for (const [name, component] of Object.entries(manifest.components ?? {})) {
    if (!/^[0-9a-f]{40}$/.test(component.commit ?? '') || !/^[0-9a-f]{40}$/.test(component.tree ?? '')) errors.push(`${name} commit/tree`);
  }
  const runtime = cup?.runtimeArtifact;
  if (runtime?.runtimeManifest?.sourceCommit !== cup?.commit || !/^sha256:[0-9a-f]{64}$/.test(runtime?.artifactDigest ?? '')
      || !runtime?.files?.length) errors.push('cup runtimeArtifact');
  const all = [...(cup?.senderFiles ?? []), ...(worker?.files ?? []), ...(lk1?.levelReader ?? []), ...(lk2?.receiverFiles ?? []),
    ...(runtime?.files ?? []), ...(manifest.nodeRedGraph?.generators ?? [])];
  if (all.some(file => !SHA.test(file.sha256))) errors.push('file sha256 format');
  if (!SHA.test(lk1?.levelHelper?.sha256 ?? '')) errors.push('level helper');
  const comparison = manifest.acceptance?.workerReleaseComparison;
  if (manifest.acceptance?.result !== 'GO' || comparison?.filesCompared !== worker?.fileCount
      || comparison?.filesEqual !== worker?.fileCount || comparison?.finalCommit !== lk1?.commit) errors.push('acceptance');
  const frontend = lk1?.frontend;
  if (frontend?.status === 'RECORDED' && (frontend.release?.sourceCommit !== lk1.commit || frontend.release?.sourceDirty !== false
      || frontend.expected.files.length !== 32 || frontend.expected.files.some(file => !SHA.test(file.sha256)) || !SHA.test(frontend.artifact?.sha256 ?? ''))) errors.push('lk1 frontend');
  const graphExpected = manifest.nodeRedGraph?.expected;
  if (manifest.nodeRedGraph?.status === 'RECORDED' && ![graphExpected?.sourceSha256, graphExpected?.intermediateSha256, graphExpected?.finalSha256].every(h => SHA.test(h ?? ''))) errors.push('nodeRedGraph');
  if (!manifest.recovery?.rollbackOrder?.length || !manifest.recovery?.activationOrder?.length || !manifest.recovery?.ratingBoundary) errors.push('recovery');
  return errors;
}

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }

function checkCheckout(name, dir, component, errors, ownedPaths = []) {
  const head = git(dir, 'rev-parse', 'HEAD');
  if (head === component.commit) {
    if (git(dir, 'rev-parse', 'HEAD^{tree}') !== component.tree) errors.push(`${name}: tree is not ${component.tree}`);
  } else if (!ownedPaths.length) {
    errors.push(`${name}: HEAD is not ${component.commit}`);
  } else {
    // A later head is accepted only when it adds manifest-owned files on top of the pinned commit.
    let descendant = true;
    try { git(dir, 'merge-base', '--is-ancestor', component.commit, head); } catch { descendant = false; }
    const changed = descendant ? git(dir, 'diff', '--name-only', component.commit, head).split('\n').filter(Boolean) : [];
    if (!descendant) errors.push(`${name}: HEAD does not contain ${component.commit}`);
    else if (changed.some(file => !ownedPaths.includes(file))) errors.push(`${name}: changes after ${component.commit} outside the manifest`);
  }
  if (git(dir, 'status', '--porcelain', '--untracked-files=no')) errors.push(`${name}: tracked files are modified`);
}

function checkFiles(name, dir, files, key, errors) {
  for (const file of files) {
    const target = path.join(dir, file[key]);
    if (!fs.existsSync(target)) { errors.push(`${name}: ${file[key]} missing`); continue; }
    const actual = sha256(fs.readFileSync(target));
    if (actual !== file.sha256) errors.push(`${name}: ${file[key]} sha256 ${actual}`);
  }
}

/** The worker file list must equal the release builder's list in the exact LK1 checkout. */
export function readWorkerBuildList(lk1Dir) {
  const source = fs.readFileSync(path.join(lk1Dir, 'scripts/build_rating_worker_release.mjs'), 'utf8');
  const block = source.split('const files = [')[1]?.split('];')[0] ?? '';
  return [...block.matchAll(/\[\s*["']([^"']+)["'],\s*["']([^"']+)["']\s*\]/g)].map(([, sourcePath, releasePath]) => ({ sourcePath, releasePath }));
}

export function verifyArtifacts(manifest, dir, errors) {
  const { cup, lk1 } = manifest.components;
  const sums = path.join(dir, 'cup-runtime/SHA256SUMS');
  if (!fs.existsSync(sums)) { errors.push('artifacts: cup-runtime/SHA256SUMS missing'); return; }
  if (sha256(fs.readFileSync(sums)) !== manifest.localArtifacts.cupRuntimeSha256Sums) errors.push('artifacts: cup SHA256SUMS differs');
  checkFiles('artifacts cup', path.join(dir, 'cup-runtime'), cup.runtimeArtifact.files, 'path', errors);
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(dir, 'cup-runtime/runtime-manifest.json'), 'utf8'));
  if (runtimeManifest.sourceCommit !== cup.commit || runtimeManifest.files?.length !== cup.runtimeArtifact.runtimeManifest.fileCount) errors.push('artifacts: cup runtime-manifest');
  if (sha256(fs.readFileSync(path.join(dir, 'lk1-SHA256SUMS'))) !== manifest.localArtifacts.lk1Sha256Sums) errors.push('artifacts: lk1 SHA256SUMS differs');
  const frontend = lk1.frontend;
  if (frontend?.status === 'RECORDED') {
    const frontendSums = path.join(dir, 'lk1-frontend/SHA256SUMS');
    if (!fs.existsSync(frontendSums) || sha256(fs.readFileSync(frontendSums)) !== manifest.localArtifacts.lk1FrontendSha256Sums) errors.push('artifacts: lk1 frontend SHA256SUMS differs');
    else {
      const listed = fs.readFileSync(frontendSums, 'utf8').trim().split('\n').map(line => line.split('  ')).map(([hash, file]) => `${hash}  ${file}`).sort();
      const expected = frontend.expected.files.map(file => `${file.sha256}  ${file.path}`).sort();
      if (JSON.stringify(listed) !== JSON.stringify(expected)) errors.push('artifacts: lk1 frontend files differ from the manifest');
    }
    checkFiles('artifacts lk1 frontend', dir, [frontend.artifact], 'file', errors);
  }
  const graph = manifest.nodeRedGraph;
  if (graph?.status === 'RECORDED') {
    const graphDir = path.join(dir, 'private-graph');
    const graphSums = path.join(graphDir, 'SHA256SUMS');
    if (!fs.existsSync(graphSums) || sha256(fs.readFileSync(graphSums)) !== manifest.localArtifacts.privateGraphSha256Sums) errors.push('artifacts: private graph SHA256SUMS differs');
    const finalGraph = path.join(graphDir, 'final.flow.json');
    if (!fs.existsSync(finalGraph) || sha256(fs.readFileSync(finalGraph)) !== graph.expected.finalSha256) errors.push('artifacts: final graph differs');
  }
  checkFiles('artifacts lk1', dir, [
    { path: lk1.ratingWorker.releaseArtifact.file, sha256: lk1.ratingWorker.releaseArtifact.sha256 },
    { path: 'lk1-level-helper/level.mjs', sha256: lk1.levelHelper.sha256 }
  ], 'path', errors);
}

export function verifyAgainstCheckouts(manifest, dirs) {
  const errors = verifyManifestConsistency(manifest);
  const { cup, lk1, lk2 } = manifest.components;
  checkCheckout('cup', dirs.cup, cup, errors, cup.manifestOwnedPaths);
  checkCheckout('lk1', dirs.lk1, lk1, errors);
  checkCheckout('lk2', dirs.lk2, lk2, errors);
  checkFiles('cup', dirs.cup, cup.senderFiles, 'path', errors);
  checkFiles('lk1 worker', dirs.lk1, lk1.ratingWorker.files, 'sourcePath', errors);
  checkFiles('lk1 reader', dirs.lk1, lk1.levelReader, 'path', errors);
  checkFiles('lk1 graph generators', dirs.lk1, manifest.nodeRedGraph.generators, 'path', errors);
  checkFiles('lk2', dirs.lk2, lk2.receiverFiles, 'path', errors);
  const built = readWorkerBuildList(dirs.lk1).map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  const listed = lk1.ratingWorker.files.map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  if (JSON.stringify(built) !== JSON.stringify(listed)) errors.push('lk1 worker: file list differs from build_rating_worker_release.mjs');
  if (dirs.artifacts) verifyArtifacts(manifest, dirs.artifacts, errors);
  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; };
  const dirs = { cup: arg('--cup'), lk1: arg('--lk1'), lk2: arg('--lk2'), artifacts: arg('--artifacts') };
  if (!dirs.cup || !dirs.lk1 || !dirs.lk2) { console.error('Usage: --cup <dir> --lk1 <dir> --lk2 <dir> [--artifacts <dir>]'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = verifyAgainstCheckouts(manifest, dirs);
  const pending = pendingInputs(manifest);
  const { cup, lk1, lk2 } = manifest.components;
  console.log(JSON.stringify({ ok: errors.length === 0, releaseComplete: errors.length === 0 && pending.length === 0, pending, errors,
    cup: cup.commit, cupRuntimeArtifact: cup.runtimeArtifact.artifactDigest, lk1: lk1.commit, lk2: lk2.commit,
    workerFilesDigest: lk1.ratingWorker.filesDigest, levelHelper: lk1.levelHelper.sha256, artifactsChecked: Boolean(dirs.artifacts) }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
