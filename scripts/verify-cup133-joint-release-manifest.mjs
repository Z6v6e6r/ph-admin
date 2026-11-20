#!/usr/bin/env node
// Verifies docs/release/cup133-joint-release-manifest.json (lk-primary-147 delivery) against exact
// local checkouts and, optionally, the local release artifacts. Read-only.
//   node scripts/verify-cup133-joint-release-manifest.mjs --cup <dir> --lk1 <dir> --lk2 <dir> [--artifacts <dir>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = fileURLToPath(new URL('../docs/release/cup133-joint-release-manifest.json', import.meta.url));
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function workerFilesDigest(files) {
  // Binary (code-unit) order, not locale order: the digest must be reproducible in any language.
  return sha256([...files].sort((a, b) => byCodeUnit(a.releasePath, b.releasePath))
    .map(file => `${file.sha256}  ${file.releasePath}\n`).join(''));
}

/** Checks that need only the manifest itself. */
export function verifyManifestConsistency(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 'PHUB_CUP133_JOINT_RELEASE_MANIFEST_V3') errors.push('schemaVersion');
  const { cup, lk1, lk2 } = manifest.sources ?? {};
  for (const [name, source] of Object.entries({ cup, lk1, lk2 })) {
    if (!COMMIT.test(source?.commit ?? '') || !COMMIT.test(source?.tree ?? '')) errors.push(`${name} commit/tree`);
  }
  if (cup?.copayCommits?.length !== 4 || cup.copayCommits.at(-1) !== cup.commit) errors.push('cup copayCommits');
  const rating = manifest.workers?.rating;
  if (!rating || rating.files?.length !== rating.fileCount || rating.fileCount !== 64) errors.push('rating worker fileCount');
  else if (workerFilesDigest(rating.files) !== rating.filesDigest) errors.push('rating worker filesDigest');
  for (const entry of rating?.workers ?? []) {
    if (rating.files.find(f => f.releasePath === entry.entry)?.sha256 !== entry.sha256) errors.push(`rating worker entry ${entry.entry}`);
  }
  const graph = manifest.nodeRedGraph;
  if (graph?.steps?.at(-1)?.sha256 !== graph?.finalSha256 || graph?.integrity?.status !== 'PASS' || graph?.integrity?.missingWireTargets !== 0
      || graph?.integrity?.nodes !== graph?.steps?.at(-1)?.nodes) errors.push('nodeRedGraph');
  const cancellation = manifest.workers?.cancellation;
  if (cancellation?.pinnedGraphSha256 !== graph?.finalSha256 || cancellation?.gatewayFunctionSha256 !== graph?.integrity?.gatewayFunctionSha256
      || cancellation?.sourceCommit !== lk1?.commit || !SHA.test(cancellation?.manifestSha256 ?? '')) errors.push('cancellation worker');
  const widget = manifest.widget;
  if (widget?.sourceCommit !== lk1?.commit || widget?.release?.sourceDirty !== false || widget?.files?.length !== 32
      || !widget?.publicAddresses?.equalToServedProduction?.allValuesPresent || widget?.tournamentSignupAddresses?.usesSeligerPath !== false) errors.push('widget');
  if (manifest.cupRuntime?.source !== cup?.commit || !SHA.test(manifest.cupRuntime?.runtimeManifestSha256 ?? '')) errors.push('cupRuntime');
  const all = [...(cup?.senderFiles ?? []), ...(rating?.files ?? []), ...(graph?.generators ?? []), ...(manifest.nginx?.files ?? []), ...(widget?.files ?? [])];
  if (all.some(file => !SHA.test(file.sha256))) errors.push('file sha256 format');
  if (!manifest.recovery?.rollbackOrder?.length || !manifest.recovery?.activationOrder?.length || !manifest.recovery?.ratingBoundary) errors.push('recovery');
  if (manifest.ratingAcceptance?.result !== 'GO') errors.push('ratingAcceptance');
  return errors;
}

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }

function checkCheckout(name, dir, source, errors, ownedPaths = []) {
  const head = git(dir, 'rev-parse', 'HEAD');
  if (head === source.commit) {
    if (git(dir, 'rev-parse', 'HEAD^{tree}') !== source.tree) errors.push(`${name}: tree is not ${source.tree}`);
  } else if (!ownedPaths.length) {
    errors.push(`${name}: HEAD is not ${source.commit}`);
  } else {
    // A later head is accepted only when it adds manifest-owned files on top of the pinned commit.
    let descendant = true;
    try { git(dir, 'merge-base', '--is-ancestor', source.commit, head); } catch { descendant = false; }
    const changed = descendant ? git(dir, 'diff', '--name-only', source.commit, head).split('\n').filter(Boolean) : [];
    if (!descendant) errors.push(`${name}: HEAD does not contain ${source.commit}`);
    else if (changed.some(file => !ownedPaths.includes(file))) errors.push(`${name}: changes after ${source.commit} outside the manifest`);
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

/** The rating worker file list must equal the release builder's list in the exact LK1 checkout. */
export function readWorkerBuildList(lk1Dir) {
  const source = fs.readFileSync(path.join(lk1Dir, 'scripts/build_rating_worker_release.mjs'), 'utf8');
  const block = source.split('const files = [')[1]?.split('];')[0] ?? '';
  return [...block.matchAll(/\[\s*["']([^"']+)["'],\s*["']([^"']+)["']\s*\]/g)].map(([, sourcePath, releasePath]) => ({ sourcePath, releasePath }));
}

function sumsMatch(file, expectedSha, errors, label) {
  if (!fs.existsSync(file)) { errors.push(`artifacts: ${label} missing`); return null; }
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== expectedSha) errors.push(`artifacts: ${label} differs`);
  return bytes.toString('utf8');
}

export function verifyArtifacts(manifest, dir, errors) {
  const { widget, workers, nodeRedGraph, cupRuntime, localArtifacts } = manifest;
  const widgetSums = sumsMatch(path.join(dir, 'lk1-widget-09c83d4c/SHA256SUMS'), localArtifacts.widgetSha256Sums, errors, 'widget SHA256SUMS');
  if (widgetSums !== null) {
    const listed = widgetSums.trim().split('\n').sort();
    const expected = widget.files.map(file => `${file.sha256}  ${file.path}`).sort();
    if (JSON.stringify(listed) !== JSON.stringify(expected)) errors.push('artifacts: widget files differ from the manifest');
  }
  checkFiles('artifacts', dir, [widget.artifact], 'file', errors);
  sumsMatch(path.join(dir, 'cancel-worker-09c83d4c.SHA256SUMS'), localArtifacts.cancelWorkerSha256Sums, errors, 'cancellation worker SHA256SUMS');
  sumsMatch(path.join(dir, 'cancel-worker-09c83d4c/manifest.json'), workers.cancellation.manifestSha256, errors, 'cancellation worker manifest');
  sumsMatch(path.join(dir, 'private-graph-09c83d4c/complete.json'), nodeRedGraph.finalSha256, errors, 'final graph');
  sumsMatch(path.join(dir, 'kit/cup-runtime/runtime-manifest.json'), cupRuntime.runtimeManifestSha256, errors, 'CUP runtime manifest');
  sumsMatch(path.join(dir, 'kit/SHA256SUMS'), localArtifacts.kitSha256SumsSha256, errors, 'kit SHA256SUMS');
}

export function verifyAgainstCheckouts(manifest, dirs) {
  const errors = verifyManifestConsistency(manifest);
  const { cup, lk1, lk2 } = manifest.sources;
  checkCheckout('cup', dirs.cup, cup, errors, cup.manifestOwnedPaths);
  checkCheckout('lk1', dirs.lk1, lk1, errors);
  checkCheckout('lk2', dirs.lk2, lk2, errors);
  checkFiles('cup', dirs.cup, cup.senderFiles, 'path', errors);
  checkFiles('lk1 rating worker', dirs.lk1, manifest.workers.rating.files, 'sourcePath', errors);
  checkFiles('lk1 graph generators', dirs.lk1, manifest.nodeRedGraph.generators, 'path', errors);
  checkFiles('lk1 nginx', dirs.lk1, manifest.nginx.files, 'path', errors);
  checkFiles('lk1 cancellation builder', dirs.lk1, [{ path: 'scripts/lk1_unpaid_cancel_service/build_bundle.mjs', sha256: manifest.workers.cancellation.builderSha256 },
    { path: 'scripts/lib/lk1LiveGatewayGuard.mjs', sha256: manifest.workers.cancellation.guardSha256 }], 'path', errors);
  checkFiles('lk2', dirs.lk2, lk2.receiverFiles, 'path', errors);
  const built = readWorkerBuildList(dirs.lk1).map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  const listed = manifest.workers.rating.files.map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  if (JSON.stringify(built) !== JSON.stringify(listed)) errors.push('lk1 rating worker: file list differs from build_rating_worker_release.mjs');
  if (dirs.artifacts) verifyArtifacts(manifest, dirs.artifacts, errors);
  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; };
  const dirs = { cup: arg('--cup'), lk1: arg('--lk1'), lk2: arg('--lk2'), artifacts: arg('--artifacts') };
  if (!dirs.cup || !dirs.lk1 || !dirs.lk2) { console.error('Usage: --cup <dir> --lk1 <dir> --lk2 <dir> [--artifacts <dir>]'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = verifyAgainstCheckouts(manifest, dirs);
  console.log(JSON.stringify({ ok: errors.length === 0, errors, artifactsChecked: Boolean(dirs.artifacts),
    cup: manifest.sources.cup.commit, lk1: manifest.sources.lk1.commit, lk2: manifest.sources.lk2.commit,
    cupRuntimeManifest: manifest.cupRuntime.runtimeManifestSha256, finalGraph: manifest.nodeRedGraph.finalSha256,
    cancellationWorker: manifest.workers.cancellation.manifestSha256, ratingWorker: manifest.workers.rating.filesDigest,
    widgetRelease: manifest.widget.release.version }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
