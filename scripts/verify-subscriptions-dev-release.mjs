#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BackendReleaseAttestationError, DEV_RELEASE_SCHEMA, DEV_RELEASE_TARGET,
  releaseIdentity, validateReleaseTarget
} from './build-backend-release-attestation.mjs';
import { createPrivateArchiveSnapshot } from './lib/private-archive-snapshot.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const fail = (code, message) => { throw new BackendReleaseAttestationError(code, message); };

function tarText(path, args, maxBuffer = 8 * 1024 * 1024) {
  const result = spawnSync('/usr/bin/tar', args, {
    encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) fail('SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_INVALID', 'Release archive cannot be read');
  return result.stdout;
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !/[\u0000-\u0020\u007f\\]/.test(value)
    && !value.startsWith('/') && !value.endsWith('/')
    && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function validateMemberTypes(path, members, directories) {
  const verbose = tarText(path, ['-tvzf', path]).split(/\r?\n/).filter(Boolean);
  if (verbose.length !== members.length) {
    fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_TYPE_INVALID', 'Release member types are ambiguous');
  }
  for (let index = 0; index < members.length; index += 1) {
    if (verbose[index]?.[0] !== (directories.has(members[index]) ? 'd' : '-')) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_TYPE_INVALID', 'Release contains a non-regular member');
    }
  }
}

function hashMember(path, member, limit) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/tar', ['-xOzf', path, member], { stdio: ['ignore', 'pipe', 'ignore'] });
    const hash = createHash('sha256');
    let bytes = 0;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) child.kill('SIGKILL');
      else hash.update(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (bytes > limit) reject(new BackendReleaseAttestationError(
        'SUBSCRIPTIONS_DEV_RELEASE_MEMBER_LIMIT_EXCEEDED', 'Release member exceeds limit'
      ));
      else if (code !== 0 || signal) reject(new BackendReleaseAttestationError(
        'SUBSCRIPTIONS_DEV_RELEASE_MEMBER_INVALID', 'Release member cannot be read'
      ));
      else resolve({ bytes, sha256: hash.digest('hex') });
    });
  });
}

export async function verifySubscriptionsDevRelease({
  archivePath, expectedArchiveSha256, expectedSourceCommit, expectedSourceTree,
  maxMemberBytes = 512 * 1024 * 1024,
  trustedSourceIdentity = () => ({
    commit: execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim(),
    tree: execFileSync('git', ['show', '-s', '--format=%T', 'refs/remotes/origin/main'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  })
}) {
  const path = String(archivePath ?? '').trim();
  if (!isAbsolute(path)) fail('SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_NOT_ABSOLUTE', 'Archive must be absolute');
  const sourceCommit = String(expectedSourceCommit ?? '').trim();
  const sourceTree = String(expectedSourceTree ?? '').trim();
  if (!GIT_SHA.test(sourceCommit) || !GIT_SHA.test(sourceTree)) {
    fail('SUBSCRIPTIONS_DEV_RELEASE_SOURCE_INVALID', 'Expected source commit and tree must be exact');
  }
  let trusted;
  try { trusted = trustedSourceIdentity(); }
  catch { fail('SUBSCRIPTIONS_DEV_RELEASE_TRUSTED_REF_UNAVAILABLE', 'Trusted source ref is unavailable'); }
  if (trusted?.commit !== sourceCommit || trusted?.tree !== sourceTree) {
    fail('SUBSCRIPTIONS_DEV_RELEASE_TRUSTED_REF_MISMATCH', 'Release source is not exact origin/main');
  }
  if (!Number.isSafeInteger(maxMemberBytes) || maxMemberBytes < 1) {
    fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_LIMIT_INVALID', 'Verification limit is invalid');
  }
  const archiveSha256 = String(expectedArchiveSha256 ?? '').trim();
  const snapshot = await createPrivateArchiveSnapshot({
    archivePath: path, expectedSha256: archiveSha256, prefix: 'subscriptions-dev-release-verify-',
    error: (kind, message) => new BackendReleaseAttestationError(
      kind === 'ARCHIVE_UNSAFE' ? 'SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_UNSAFE'
        : kind === 'ARCHIVE_DRIFT' ? 'SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_DRIFT'
          : 'SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_SHA256_MISMATCH', message
    )
  });
  try {
    const members = tarText(snapshot.path, ['-tzf', snapshot.path]).split(/\r?\n/).filter(Boolean);
    if (members.length < 2 || new Set(members).size !== members.length) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_SET_INVALID', 'Archive member set is empty or duplicated');
    }
    const rootName = releaseIdentity(DEV_RELEASE_TARGET, sourceCommit, 'subscriptions-dev').rootName;
    const root = rootName + '/';
    if (members.some((member) => !member.startsWith(root)
      || /[\u0000-\u0020\u007f\\]/.test(member)
      || member.split('/').some((part) => part === '.' || part === '..'))) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_PATH_INVALID', 'Archive has an unsafe or unexpected root');
    }
    const manifestMember = root + 'release-manifest.json';
    if (members.filter((member) => member.endsWith('/release-manifest.json')).length !== 1
      || !members.includes(manifestMember)) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MANIFEST_INVALID', 'Release manifest is missing or ambiguous');
    }
    let manifest;
    let manifestText;
    try {
      manifestText = tarText(snapshot.path, ['-xOzf', snapshot.path, manifestMember]);
      manifest = JSON.parse(manifestText);
    }
    catch { fail('SUBSCRIPTIONS_DEV_RELEASE_MANIFEST_INVALID', 'Release manifest cannot be parsed'); }
    let target;
    try { target = validateReleaseTarget(manifest.target, 'subscriptions-dev'); }
    catch { fail('SUBSCRIPTIONS_DEV_RELEASE_TARGET_MISMATCH', 'Release target differs from approved DEV target'); }
    const manifestKeys = [
      'schema', 'repository', 'component', 'sourceCommit', 'sourceTree', 'sourceTrustedRef',
      'sourceCommitTime', 'sourceDirty', 'serviceName', 'profile', 'target', 'targetSha256',
      'builderSourceCommit', 'activationAuthorized', 'buildCommand', 'entrypoint', 'nodeVersion',
      'npmVersion', 'packageLockSha256', 'format', 'artifactScan', 'runtimeFileCount', 'runtimeFiles'
    ];
    if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(manifestKeys.sort())
      || manifest.schema !== DEV_RELEASE_SCHEMA
      || manifest.repository !== DEV_RELEASE_TARGET.repository
      || manifest.component !== DEV_RELEASE_TARGET.component
      || manifest.sourceCommit !== sourceCommit || manifest.sourceTree !== sourceTree
      || manifest.sourceDirty !== false || manifest.serviceName !== DEV_RELEASE_TARGET.serviceName
      || manifest.profile !== 'subscriptions-dev' || manifest.builderSourceCommit !== sourceCommit
      || manifest.activationAuthorized !== false
      || manifest.targetSha256 !== createHash('sha256').update(JSON.stringify(target)).digest('hex')
      || manifest.entrypoint !== DEV_RELEASE_TARGET.entrypoint
      || manifest.buildCommand !== DEV_RELEASE_TARGET.buildCommand
      || manifest.nodeVersion !== DEV_RELEASE_TARGET.nodeVersion
      || manifest.npmVersion !== DEV_RELEASE_TARGET.npmVersion
      || manifest.sourceTrustedRef !== 'refs/remotes/origin/main'
      || !Number.isFinite(Date.parse(manifest.sourceCommitTime))
      || !SHA256.test(manifest.packageLockSha256) || manifest.format !== 'tar.gz'
      || JSON.stringify(Object.keys(manifest.artifactScan ?? {}).sort()) !== JSON.stringify([
        'binaryFilesSkipped', 'piiMatches', 'piiScope', 'regularFiles', 'secretMatches', 'textFilesScanned'
      ].sort())
      || manifest.artifactScan.regularFiles !== manifest.runtimeFileCount
      || !Number.isSafeInteger(manifest.artifactScan.textFilesScanned)
      || !Number.isSafeInteger(manifest.artifactScan.binaryFilesSkipped)
      || manifest.artifactScan.secretMatches !== 0 || manifest.artifactScan.piiMatches !== 0
      || manifest.artifactScan.piiScope !== 'first-party-code'
      || !Array.isArray(manifest.runtimeFiles) || manifest.runtimeFiles.length < 5
      || manifest.runtimeFiles.length > 100000 || manifest.runtimeFileCount !== manifest.runtimeFiles.length) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MANIFEST_MISMATCH', 'Manifest differs from approved contract');
    }
    const requiredFiles = new Set([manifestMember]);
    const directories = new Set([rootName, root]);
    const paths = new Set();
    for (const file of manifest.runtimeFiles) {
      if (!file || JSON.stringify(Object.keys(file).sort()) !== JSON.stringify(['bytes', 'path', 'sha256'])
        || !safeRelativePath(file.path) || !Number.isSafeInteger(file.bytes)
        || file.bytes < 0 || !SHA256.test(file.sha256) || paths.has(file.path)) {
        fail('SUBSCRIPTIONS_DEV_RELEASE_INVENTORY_INVALID', 'Runtime inventory is invalid or duplicated');
      }
      paths.add(file.path);
      requiredFiles.add(root + file.path);
      const parts = file.path.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        directories.add(root + parts.slice(0, index).join('/') + '/');
      }
    }
    for (const required of ['dist/main.js', 'package.json', 'package-lock.json']) {
      if (!paths.has(required)) fail('SUBSCRIPTIONS_DEV_RELEASE_REQUIRED_FILE_MISSING', 'Required runtime file absent');
    }
    const allowed = new Set([...directories, ...requiredFiles]);
    if (members.some((member) => !allowed.has(member))
      || [...requiredFiles].some((member) => !members.includes(member))) {
      fail('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_SET_INVALID', 'Archive and manifest inventories differ');
    }
    validateMemberTypes(snapshot.path, members, directories);
    for (const file of manifest.runtimeFiles) {
      const actual = await hashMember(snapshot.path, root + file.path, maxMemberBytes);
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
        fail('SUBSCRIPTIONS_DEV_RELEASE_FILE_MISMATCH', 'Runtime file differs from inventory');
      }
    }
    return Object.freeze({
      schema: manifest.schema, sourceCommit, sourceTree, archiveSha256,
      targetSha256: manifest.targetSha256, serviceName: manifest.serviceName,
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
      runtimeInventorySha256: createHash('sha256')
        .update(JSON.stringify(manifest.runtimeFiles)).digest('hex'),
      runtimeFileCount: manifest.runtimeFileCount, activationAuthorized: false
    });
  } finally { await snapshot.cleanup().catch(() => undefined); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  verifySubscriptionsDevRelease({
    archivePath: process.env.SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE,
    expectedArchiveSha256: process.env.SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_SHA256,
    expectedSourceCommit: process.env.SUBSCRIPTIONS_DEV_RELEASE_SOURCE_SHA,
    expectedSourceTree: process.env.SUBSCRIPTIONS_DEV_RELEASE_SOURCE_TREE
  }).then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch((error) => {
    process.stderr.write((error instanceof BackendReleaseAttestationError
      ? error.code : 'SUBSCRIPTIONS_DEV_RELEASE_VERIFY_FAILED') + '\n');
    process.exitCode = 1;
  });
}
