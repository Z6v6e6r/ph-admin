#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  REFERRAL_RELEASE_SCHEMA,
  REQUIRED_REFERRAL_CONFIG,
  ReferralReleaseError
} from './build-referral-links-release.mjs';
import { createPrivateArchiveSnapshot } from './lib/private-archive-snapshot.mjs';

function fail(code, message) {
  throw new ReferralReleaseError(code, message);
}

function tarText(archivePath, args, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync('/usr/bin/tar', args, {
    encoding: 'utf8',
    maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) fail('REFERRAL_RELEASE_ARCHIVE_INVALID', 'Release archive cannot be read');
  return result.stdout;
}

function validateTarMemberTypes(archivePath, members, directories) {
  const verbose = tarText(archivePath, ['-tvzf', archivePath])
    .split(/\r?\n/)
    .filter(Boolean);
  if (verbose.length !== members.length) {
    fail('REFERRAL_RELEASE_MEMBER_TYPE_INVALID', 'Release archive member types are ambiguous');
  }
  for (let index = 0; index < members.length; index += 1) {
    const expectedType = directories.has(members[index]) ? 'd' : '-';
    if (verbose[index][0] !== expectedType) {
      fail('REFERRAL_RELEASE_MEMBER_TYPE_INVALID', 'Release archive contains a non-regular member');
    }
  }
}

function hashTarMember(archivePath, member, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/tar', ['-xOzf', archivePath, member], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const hash = createHash('sha256');
    let bytes = 0;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill('SIGKILL');
        return;
      }
      hash.update(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (bytes > maxBytes) {
        reject(new ReferralReleaseError('REFERRAL_RELEASE_MEMBER_LIMIT_EXCEEDED', 'Release member exceeds verification limit'));
      } else if (code !== 0 || signal) {
        reject(new ReferralReleaseError('REFERRAL_RELEASE_MEMBER_INVALID', 'Release member cannot be read'));
      } else {
        resolve({ bytes, sha256: hash.digest('hex') });
      }
    });
  });
}

export async function verifyReferralLinksRelease({
  archivePath,
  expectedArchiveSha256,
  expectedSourceCommit,
  maxMemberBytes = 512 * 1024 * 1024
}) {
  const path = String(archivePath ?? '').trim();
  if (!isAbsolute(path)) fail('REFERRAL_RELEASE_ARCHIVE_NOT_ABSOLUTE', 'Release archive must be absolute');
  const approvedArchive = String(expectedArchiveSha256 ?? '').trim();
  const snapshot = await createPrivateArchiveSnapshot({
    archivePath: path,
    expectedSha256: approvedArchive,
    prefix: 'referral-release-verify-',
    error: (kind, message) => new ReferralReleaseError(
      kind === 'ARCHIVE_UNSAFE'
        ? 'REFERRAL_RELEASE_ARCHIVE_UNSAFE'
        : kind === 'ARCHIVE_DRIFT'
          ? 'REFERRAL_RELEASE_ARCHIVE_DRIFT'
          : 'REFERRAL_RELEASE_ARCHIVE_SHA256_MISMATCH',
      message
    )
  });
  try {
  const snapshotPath = snapshot.path;
  const approvedSource = String(expectedSourceCommit ?? '').trim();
  if (!/^[a-f0-9]{40}$/.test(approvedSource)) {
    fail('REFERRAL_RELEASE_SOURCE_SHA_INVALID', 'Approved source SHA is invalid');
  }
  if (!Number.isSafeInteger(maxMemberBytes) || maxMemberBytes < 1) {
    fail('REFERRAL_RELEASE_MEMBER_LIMIT_INVALID', 'Release verification limit is invalid');
  }

  const members = tarText(snapshotPath, ['-tzf', snapshotPath]).split(/\r?\n/).filter(Boolean);
  if (new Set(members).size !== members.length) {
    fail('REFERRAL_RELEASE_MEMBER_SET_MISMATCH', 'Release archive contains duplicate members');
  }
  const manifestMembers = members.filter((item) => item.endsWith('/release-manifest.json'));
  if (manifestMembers.length !== 1) fail('REFERRAL_RELEASE_MANIFEST_INVALID', 'Release manifest is missing or ambiguous');
  const manifestMember = manifestMembers[0];
  const root = manifestMember.slice(0, -'release-manifest.json'.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]+\/$/.test(root) || members.some((item) => !item.startsWith(root) || item.includes('..'))) {
    fail('REFERRAL_RELEASE_MEMBER_PATH_INVALID', 'Release member path is unsafe');
  }
  let manifest;
  try {
    manifest = JSON.parse(tarText(snapshotPath, ['-xOzf', snapshotPath, manifestMember]));
  } catch {
    fail('REFERRAL_RELEASE_MANIFEST_INVALID', 'Release manifest cannot be parsed');
  }
  if (manifest.schema !== REFERRAL_RELEASE_SCHEMA
    || manifest.sourceCommit !== approvedSource
    || manifest.sourceDirty !== false
    || manifest.buildSource !== 'PRIVATE_GIT_ARCHIVE'
    || JSON.stringify(manifest.requiredRuntimeConfig) !== JSON.stringify(REQUIRED_REFERRAL_CONFIG)
    || manifest.activationDefaults?.REFERRAL_LINKS_ENABLED !== false
    || manifest.activationDefaults?.REFERRAL_LINKS_AUTO_CREATE_INDEXES !== false
    || !Array.isArray(manifest.artifacts)
    || manifest.artifacts.length < 4
    || manifest.artifacts.length > 10000) {
    fail('REFERRAL_RELEASE_MANIFEST_MISMATCH', 'Release manifest differs from the approved contract');
  }

  const requiredMembers = new Set([manifestMember]);
  const allowedDirectories = new Set([root.slice(0, -1), root]);
  for (const artifact of manifest.artifacts) {
    if (!artifact || !/^[A-Za-z0-9][A-Za-z0-9._/-]+$/.test(artifact.path) || artifact.path.includes('..')) {
      fail('REFERRAL_RELEASE_ARTIFACT_PATH_INVALID', 'Release artifact path is invalid');
    }
    requiredMembers.add(`${root}${artifact.path}`);
    const parts = artifact.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(`${root}${parts.slice(0, index).join('/')}/`);
    }
  }
  if (requiredMembers.size !== manifest.artifacts.length + 1) {
    fail('REFERRAL_RELEASE_ARTIFACT_SET_INVALID', 'Release manifest contains duplicate artifacts');
  }
  const allowedMembers = new Set([...allowedDirectories, ...requiredMembers]);
  if (members.some((item) => !allowedMembers.has(item))
    || [...requiredMembers].some((item) => !members.includes(item))) {
    fail('REFERRAL_RELEASE_MEMBER_SET_MISMATCH', 'Release archive contains an unexpected member set');
  }
  validateTarMemberTypes(snapshotPath, members, allowedDirectories);
  for (const artifact of manifest.artifacts) {
    const actual = await hashTarMember(snapshotPath, `${root}${artifact.path}`, maxMemberBytes);
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      fail('REFERRAL_RELEASE_ARTIFACT_SHA256_MISMATCH', 'Release artifact digest differs from manifest');
    }
  }
  if (!manifest.artifacts.some((item) => item.path === 'dist/client-sdk/phab-referral-links-admin.js')) {
    fail('REFERRAL_RELEASE_CLIENT_BUNDLE_MISSING', 'Referral admin client bundle is absent from release');
  }
  return {
    schema: manifest.schema,
    sourceCommit: manifest.sourceCommit,
    archiveSha256: approvedArchive,
    artifactCount: manifest.artifacts.length,
    activationDefaults: manifest.activationDefaults
  };
  } finally {
    await snapshot.cleanup().catch(() => undefined);
  }
}

async function main() {
  const result = await verifyReferralLinksRelease({
    archivePath: process.env.REFERRAL_RELEASE_ARCHIVE,
    expectedArchiveSha256: process.env.REFERRAL_RELEASE_ARCHIVE_SHA256,
    expectedSourceCommit: process.env.REFERRAL_RELEASE_SOURCE_SHA,
    maxMemberBytes: process.env.REFERRAL_RELEASE_VERIFY_MAX_MEMBER_BYTES
      ? Number(process.env.REFERRAL_RELEASE_VERIFY_MAX_MEMBER_BYTES)
      : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReferralReleaseError ? error.code : 'REFERRAL_RELEASE_VERIFY_FAILED'}\n`);
    process.exitCode = 1;
  });
}
