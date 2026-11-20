#!/usr/bin/env node
// Verifies docs/release/cup133-joint-release-manifest.json against exact local checkouts.
// Read-only: hashes files and reads git metadata. Usage:
//   node scripts/verify-cup133-joint-release-manifest.mjs --cup <dir> --lk1 <dir> --lk2 <dir>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = fileURLToPath(new URL('../docs/release/cup133-joint-release-manifest.json', import.meta.url));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

export function workerFilesDigest(files) {
  // Binary (code-unit) order, not locale order: the digest must be reproducible in any language.
  return sha256([...files].sort((a, b) => (a.releasePath < b.releasePath ? -1 : a.releasePath > b.releasePath ? 1 : 0))
    .map(file => `${file.sha256}  ${file.releasePath}\n`).join(''));
}

/** Checks that need only the manifest itself. */
export function verifyManifestConsistency(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 'PHUB_CUP133_JOINT_RELEASE_MANIFEST_V1') errors.push('schemaVersion');
  const worker = manifest.components?.lk1?.ratingWorker;
  if (!worker || worker.files?.length !== worker.fileCount) errors.push('worker fileCount');
  else if (workerFilesDigest(worker.files) !== worker.filesDigest) errors.push('worker filesDigest');
  if (worker?.files && new Set(worker.files.map(f => f.releasePath)).size !== worker.files.length) errors.push('worker duplicate paths');
  for (const [name, component] of Object.entries(manifest.components ?? {})) {
    if (!/^[0-9a-f]{40}$/.test(component.commit ?? '') || !/^[0-9a-f]{40}$/.test(component.tree ?? '')) errors.push(`${name} commit/tree`);
  }
  const all = [
    ...(manifest.components?.cup?.senderFiles ?? []), ...(worker?.files ?? []),
    ...(manifest.components?.lk1?.levelReader ?? []), ...(manifest.components?.lk2?.receiverFiles ?? [])
  ];
  if (all.some(file => !/^[0-9a-f]{64}$/.test(file.sha256))) errors.push('file sha256 format');
  const comparison = manifest.acceptance?.workerReleaseComparison;
  if (manifest.acceptance?.result !== 'GO' || comparison?.filesCompared !== worker?.fileCount
      || comparison?.filesEqual !== worker?.fileCount || comparison?.finalCommit !== manifest.components?.lk1?.commit) errors.push('acceptance');
  return errors;
}

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }

function checkCheckout(name, dir, component, errors) {
  if (git(dir, 'rev-parse', 'HEAD') !== component.commit) errors.push(`${name}: HEAD is not ${component.commit}`);
  if (git(dir, 'rev-parse', 'HEAD^{tree}') !== component.tree) errors.push(`${name}: tree is not ${component.tree}`);
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

export function verifyAgainstCheckouts(manifest, dirs) {
  const errors = verifyManifestConsistency(manifest);
  const { cup, lk1, lk2 } = manifest.components;
  checkCheckout('cup', dirs.cup, cup, errors);
  checkCheckout('lk1', dirs.lk1, lk1, errors);
  checkCheckout('lk2', dirs.lk2, lk2, errors);
  checkFiles('cup', dirs.cup, cup.senderFiles, 'path', errors);
  checkFiles('lk1 worker', dirs.lk1, lk1.ratingWorker.files, 'sourcePath', errors);
  checkFiles('lk1 reader', dirs.lk1, lk1.levelReader, 'path', errors);
  checkFiles('lk2', dirs.lk2, lk2.receiverFiles, 'path', errors);
  const built = readWorkerBuildList(dirs.lk1).map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  const listed = lk1.ratingWorker.files.map(f => `${f.sourcePath}=>${f.releasePath}`).sort();
  if (JSON.stringify(built) !== JSON.stringify(listed)) errors.push('lk1 worker: file list differs from build_rating_worker_release.mjs');
  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; };
  const dirs = { cup: arg('--cup'), lk1: arg('--lk1'), lk2: arg('--lk2') };
  if (!dirs.cup || !dirs.lk1 || !dirs.lk2) { console.error('Usage: --cup <dir> --lk1 <dir> --lk2 <dir>'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = verifyAgainstCheckouts(manifest, dirs);
  const { cup, lk1, lk2 } = manifest.components;
  console.log(JSON.stringify({ ok: errors.length === 0, errors,
    cup: cup.commit, lk1: lk1.commit, lk2: lk2.commit, workerFiles: lk1.ratingWorker.fileCount, workerFilesDigest: lk1.ratingWorker.filesDigest,
    checkedFiles: cup.senderFiles.length + lk1.ratingWorker.files.length + lk1.levelReader.length + lk2.receiverFiles.length }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
