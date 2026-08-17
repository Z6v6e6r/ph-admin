#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MANAGED_FRAGMENT_PATH = resolve(
  SCRIPT_DIR,
  '../deploy/server-147/nginx-public-tournaments-location.conf'
);
const MANAGED_START = '# BEGIN PHAB MANAGED PUBLIC TOURNAMENT ROUTES';
const MANAGED_END = '# END PHAB MANAGED PUBLIC TOURNAMENT ROUTES';
const LEGACY_LOCATION_SIGNATURE = 'location ^~ /api/tournaments/public/ {';
const LEGACY_REWRITE =
  'rewrite ^/api/tournaments/public/([^/?#]+)$ https://padlhub.ru/tournaments?slug=$1 permanent;';
const MANAGED_REWRITE =
  'rewrite ^/api/tournaments/public/(?!list$|showcase$)([^/?#]+)$ https://padlhub.ru/tournaments?slug=$1 permanent;';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function assertRegularFile(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${path}`);
  }
  return stat;
}

function assertPathAbsent(path, label) {
  try {
    lstatSync(path);
    throw new Error(`${label} already exists: ${path}`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function findLocationBlocks(source, signature) {
  const blocks = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const start = source.indexOf(signature, searchFrom);
    if (start < 0) break;
    const openBrace = source.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let index = openBrace; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) {
      throw new Error(`unterminated nginx location block: ${signature}`);
    }
    blocks.push({ start, end, value: source.slice(start, end) });
    searchFrom = end;
  }
  return blocks;
}

function readManagedFragment() {
  return readFileSync(MANAGED_FRAGMENT_PATH, 'utf8').trim();
}

function validateManagedFragment(fragment) {
  if (!fragment.startsWith(MANAGED_START) || !fragment.endsWith(MANAGED_END)) {
    throw new Error('managed public tournament nginx fragment has invalid markers');
  }
  if (!fragment.includes(MANAGED_REWRITE)) {
    throw new Error('managed fragment must preserve the exact public-card redirect');
  }
  if (!fragment.includes('proxy_pass http://127.0.0.1:3000;')) {
    throw new Error('managed fragment must proxy nested public tournament routes to ph-admin');
  }
  if (!fragment.includes('Access-Control-Allow-Headers "Origin, Content-Type, Accept, Authorization,')) {
    throw new Error('managed fragment must allow the LK Authorization header');
  }
}

export function createTournamentPublicNginxCandidate(source) {
  const managedFragment = readManagedFragment();
  validateManagedFragment(managedFragment);

  const managedStartCount = source.split(MANAGED_START).length - 1;
  const managedEndCount = source.split(MANAGED_END).length - 1;
  if (managedStartCount || managedEndCount) {
    if (managedStartCount !== 1 || managedEndCount !== 1) {
      throw new Error('managed public tournament nginx markers are duplicated or incomplete');
    }
    const start = source.indexOf(MANAGED_START);
    const end = source.indexOf(MANAGED_END, start) + MANAGED_END.length;
    const existing = source.slice(start, end).trim();
    if (existing !== managedFragment) {
      throw new Error('managed public tournament nginx block differs from the audited fragment');
    }
    return source;
  }

  const locations = findLocationBlocks(source, LEGACY_LOCATION_SIGNATURE);
  if (locations.length !== 1) {
    throw new Error(`expected exactly one legacy public tournament location, found ${locations.length}`);
  }
  const legacy = locations[0];
  const expectedLegacy = normalizeWhitespace(
    `${LEGACY_LOCATION_SIGNATURE}\n    ${LEGACY_REWRITE}\n}`
  );
  if (normalizeWhitespace(legacy.value) !== expectedLegacy) {
    throw new Error('legacy public tournament location differs from the audited preimage');
  }

  return `${source.slice(0, legacy.start)}${managedFragment}${source.slice(legacy.end)}`;
}

export function buildCandidate({ sourcePath, outputPath, expectedSourceSha256 }) {
  if (resolve(sourcePath) === resolve(outputPath)) {
    throw new Error('candidate output must differ from the source nginx config');
  }
  assertPathAbsent(outputPath, 'candidate output');
  const sourceStat = assertRegularFile(sourcePath, 'source nginx config');
  const source = readFileSync(sourcePath, 'utf8');
  const actualSourceSha256 = sha256(source);
  if (actualSourceSha256 !== expectedSourceSha256) {
    throw new Error(
      `source nginx SHA-256 mismatch: expected ${expectedSourceSha256}, got ${actualSourceSha256}`
    );
  }
  const candidate = createTournamentPublicNginxCandidate(source);
  writeFileSync(outputPath, candidate, { mode: sourceStat.mode, flag: 'wx' });
  chmodSync(outputPath, sourceStat.mode);
  return {
    sourceSha256: actualSourceSha256,
    candidateSha256: sha256(candidate),
    changed: candidate !== source
  };
}

export function applyCandidate({
  sourcePath,
  candidatePath,
  backupPath,
  expectedSourceSha256,
  expectedCandidateSha256,
  beforeReplace
}) {
  const sourceStat = assertRegularFile(sourcePath, 'source nginx config');
  assertRegularFile(candidatePath, 'candidate nginx config');
  const source = readFileSync(sourcePath);
  const candidate = readFileSync(candidatePath);
  const sourceDigest = sha256(source);
  const candidateDigest = sha256(candidate);
  if (sourceDigest !== expectedSourceSha256) {
    throw new Error(`source nginx SHA-256 mismatch before apply: ${sourceDigest}`);
  }
  if (candidateDigest !== expectedCandidateSha256) {
    throw new Error(`candidate nginx SHA-256 mismatch before apply: ${candidateDigest}`);
  }
  const rebuiltCandidate = createTournamentPublicNginxCandidate(source.toString('utf8'));
  if (!candidate.equals(Buffer.from(rebuiltCandidate))) {
    throw new Error('candidate nginx config does not match the audited source transformation');
  }

  if (dirname(resolve(backupPath)) !== dirname(resolve(sourcePath))) {
    throw new Error('backup nginx config must be a sibling of the source config');
  }
  if (resolve(backupPath) === resolve(sourcePath)) {
    throw new Error('backup nginx config must differ from the source config');
  }

  assertPathAbsent(backupPath, 'backup path');

  const temporaryPath = `${sourcePath}.phab-public-tournaments-${process.pid}.tmp`;
  copyFileSync(sourcePath, backupPath, constants.COPYFILE_EXCL);
  chmodSync(backupPath, sourceStat.mode);
  const backupDigest = sha256(readFileSync(backupPath));
  if (backupDigest !== expectedSourceSha256) {
    throw new Error(`backup nginx SHA-256 mismatch before apply: ${backupDigest}`);
  }
  try {
    writeFileSync(temporaryPath, candidate, { mode: sourceStat.mode, flag: 'wx' });
    chmodSync(temporaryPath, sourceStat.mode);
    if (typeof beforeReplace === 'function') beforeReplace();
    const finalSourceDigest = sha256(readFileSync(sourcePath));
    if (finalSourceDigest !== expectedSourceSha256) {
      throw new Error(`source nginx SHA-256 drifted before replace: ${finalSourceDigest}`);
    }
    renameSync(temporaryPath, sourcePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (_cleanupError) {
      // Nothing to clean up.
    }
    throw error;
  }

  return { sourceSha256: sourceDigest, candidateSha256: candidateDigest, backupPath };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${name ?? '<end>'}`);
    }
    args[name.slice(2)] = value;
  }
  return args;
}

function required(args, name) {
  const value = String(args[name] ?? '').trim();
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.command === 'build') {
    result = buildCandidate({
      sourcePath: required(args, 'source'),
      outputPath: required(args, 'output'),
      expectedSourceSha256: required(args, 'expected-source-sha256')
    });
  } else if (args.command === 'apply') {
    result = applyCandidate({
      sourcePath: required(args, 'source'),
      candidatePath: required(args, 'candidate'),
      backupPath: required(args, 'backup'),
      expectedSourceSha256: required(args, 'expected-source-sha256'),
      expectedCandidateSha256: required(args, 'expected-candidate-sha256')
    });
  } else {
    throw new Error('usage: patch-tournament-public-nginx.mjs <build|apply> [options]');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
