#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ManagedSubscriptionsBackupError,
  validateBackupCollectionSet,
  validateBackupSource
} from './managed-subscriptions-backup-core.mjs';
import { REFERRAL_BACKUP_SCHEMA, referralBackupCollections } from './referral-links-backup.mjs';
import { createPrivateArchiveSnapshot } from './lib/private-archive-snapshot.mjs';

function fail(code, message) {
  throw new ManagedSubscriptionsBackupError(code, message);
}

function required(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(code, 'Required backup verification input is missing');
  return normalized;
}

function tarText(archivePath, args, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync('/usr/bin/tar', args, {
    encoding: 'utf8',
    maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) fail('REFERRAL_BACKUP_ARCHIVE_INVALID', 'Backup archive cannot be read');
  return result.stdout;
}

function validateTarMemberTypes(archivePath, members, directories) {
  const verbose = tarText(archivePath, ['-tvzf', archivePath])
    .split(/\r?\n/)
    .filter(Boolean);
  if (verbose.length !== members.length) {
    fail('REFERRAL_BACKUP_MEMBER_TYPE_INVALID', 'Backup archive member types are ambiguous');
  }
  for (let index = 0; index < members.length; index += 1) {
    const expectedType = directories.has(members[index]) ? 'd' : '-';
    if (verbose[index][0] !== expectedType) {
      fail('REFERRAL_BACKUP_MEMBER_TYPE_INVALID', 'Backup archive contains a non-regular member');
    }
  }
}

async function hashTarMember(archivePath, member, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/tar', ['-xOzf', archivePath, member], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const hash = createHash('sha256');
    let bytes = 0;
    let lines = 0;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill('SIGKILL');
        return;
      }
      hash.update(chunk);
      for (const byte of chunk) if (byte === 10) lines += 1;
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (bytes > maxBytes) {
        reject(new ManagedSubscriptionsBackupError(
          'REFERRAL_BACKUP_MEMBER_LIMIT_EXCEEDED',
          'Backup member exceeds verification limit'
        ));
      } else if (code !== 0 || signal) {
        reject(new ManagedSubscriptionsBackupError(
          'REFERRAL_BACKUP_MEMBER_INVALID',
          'Backup member cannot be read'
        ));
      } else {
        resolve({ sha256: hash.digest('hex'), bytes, lines });
      }
    });
  });
}

export async function verifyReferralBackup({
  archivePath,
  expectedArchiveSha256,
  expectedDatabase,
  expectedTargetSha256,
  expectedSource,
  collections,
  maxMemberBytes = 512 * 1024 * 1024
}) {
  const path = required(archivePath, 'REFERRAL_BACKUP_ARCHIVE_REQUIRED');
  if (!isAbsolute(path)) fail('REFERRAL_BACKUP_ARCHIVE_NOT_ABSOLUTE', 'Backup archive path must be absolute');
  const expectedArchive = required(expectedArchiveSha256, 'REFERRAL_BACKUP_ARCHIVE_SHA256_REQUIRED');
  const snapshot = await createPrivateArchiveSnapshot({
    archivePath: path,
    expectedSha256: expectedArchive,
    prefix: 'referral-backup-verify-',
    error: (kind, message) => new ManagedSubscriptionsBackupError(
      kind === 'ARCHIVE_UNSAFE'
        ? 'REFERRAL_BACKUP_ARCHIVE_UNSAFE'
        : kind === 'ARCHIVE_DRIFT'
          ? 'REFERRAL_BACKUP_ARCHIVE_DRIFT'
          : 'REFERRAL_BACKUP_ARCHIVE_SHA256_MISMATCH',
      message
    )
  });
  try {
  const snapshotPath = snapshot.path;

  const members = tarText(snapshotPath, ['-tzf', snapshotPath]).split(/\r?\n/).filter(Boolean);
  if (new Set(members).size !== members.length) {
    fail('REFERRAL_BACKUP_MEMBER_SET_MISMATCH', 'Backup archive contains duplicate members');
  }
  const manifestMembers = members.filter((item) => item.endsWith('/manifest.json'));
  if (manifestMembers.length !== 1) fail('REFERRAL_BACKUP_MANIFEST_INVALID', 'Backup manifest is missing or ambiguous');
  const manifestMember = manifestMembers[0];
  const root = manifestMember.slice(0, -'manifest.json'.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]+\/$/.test(root) || members.some((item) => !item.startsWith(root) || item.includes('..'))) {
    fail('REFERRAL_BACKUP_MEMBER_PATH_INVALID', 'Backup member path is unsafe');
  }
  let manifest;
  try {
    manifest = JSON.parse(tarText(snapshotPath, ['-xOzf', snapshotPath, manifestMember]));
  } catch {
    fail('REFERRAL_BACKUP_MANIFEST_INVALID', 'Backup manifest cannot be parsed');
  }
  const approvedDatabase = required(expectedDatabase, 'REFERRAL_BACKUP_EXPECTED_DATABASE_REQUIRED');
  const approvedTargetSha256 = required(expectedTargetSha256, 'REFERRAL_BACKUP_TARGET_SHA256_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(approvedTargetSha256)) {
    fail('REFERRAL_BACKUP_TARGET_SHA256_INVALID', 'Approved Mongo target digest is invalid');
  }
  if (!Number.isSafeInteger(maxMemberBytes) || maxMemberBytes < 1) {
    fail('REFERRAL_BACKUP_MEMBER_LIMIT_INVALID', 'Backup verification limit is invalid');
  }
  const expectedCollections = validateBackupCollectionSet(collections);
  const approvedSource = validateBackupSource(expectedSource);
  if (manifest.schema !== REFERRAL_BACKUP_SCHEMA
    || manifest.database !== approvedDatabase
    || manifest.targetSha256 !== approvedTargetSha256
    || manifest.sourceEvidence !== 'DECLARED_NOT_LIVE_ATTESTED'
    || JSON.stringify(manifest.source) !== JSON.stringify(approvedSource)
    || !Array.isArray(manifest.collections)
    || JSON.stringify(manifest.collections.map((item) => item.name)) !== JSON.stringify(expectedCollections)) {
    fail('REFERRAL_BACKUP_MANIFEST_MISMATCH', 'Backup manifest differs from the approved recovery target');
  }

  const requiredMembers = new Set([manifestMember]);
  for (const item of manifest.collections) {
    requiredMembers.add(`${root}${item.documentFile}`);
    requiredMembers.add(`${root}${item.indexFile}`);
  }
  const allowedMembers = new Set([root.slice(0, -1), root, ...requiredMembers]);
  if (members.some((item) => !allowedMembers.has(item))
    || [...requiredMembers].some((item) => !members.includes(item))) {
    fail('REFERRAL_BACKUP_MEMBER_SET_MISMATCH', 'Backup archive contains an unexpected member set');
  }
  validateTarMemberTypes(snapshotPath, members, new Set([root.slice(0, -1), root]));

  const verifiedCollections = [];
  for (const item of manifest.collections) {
    const documents = await hashTarMember(snapshotPath, `${root}${item.documentFile}`, maxMemberBytes);
    const indexes = await hashTarMember(snapshotPath, `${root}${item.indexFile}`, maxMemberBytes);
    if (documents.sha256 !== item.documentSha256
      || indexes.sha256 !== item.indexSha256
      || documents.lines !== item.count) {
      fail('REFERRAL_BACKUP_MEMBER_SHA256_MISMATCH', 'Backup member digest or count is invalid');
    }
    verifiedCollections.push({
      name: item.name,
      exists: item.exists === true,
      count: item.count,
      indexCount: item.indexCount,
      documentBytes: documents.bytes,
      indexBytes: indexes.bytes
    });
  }
  return {
    schema: manifest.schema,
    archiveSha256: expectedArchive,
    database: manifest.database,
    targetSha256: manifest.targetSha256,
    declaredSource: manifest.source,
    collections: verifiedCollections,
    totalDocuments: manifest.totalDocuments,
    totalBytes: manifest.totalBytes
  };
  } finally {
    await snapshot.cleanup().catch(() => undefined);
  }
}

async function main() {
  const result = await verifyReferralBackup({
    archivePath: process.env.REFERRAL_LINKS_BACKUP_ARCHIVE,
    expectedArchiveSha256: process.env.REFERRAL_LINKS_BACKUP_ARCHIVE_SHA256,
    expectedDatabase: process.env.REFERRAL_LINKS_BACKUP_EXPECTED_DB,
    expectedTargetSha256: process.env.REFERRAL_LINKS_BACKUP_TARGET_SHA256,
    expectedSource: {
      unit: process.env.REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_UNIT,
      releaseDir: process.env.REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_RELEASE_DIR,
      releaseSha: process.env.REFERRAL_LINKS_BACKUP_EXPECTED_SOURCE_SHA
    },
    collections: referralBackupCollections(process.env),
    maxMemberBytes: process.env.REFERRAL_LINKS_BACKUP_VERIFY_MAX_MEMBER_BYTES
      ? Number(process.env.REFERRAL_LINKS_BACKUP_VERIFY_MAX_MEMBER_BYTES)
      : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const code = error instanceof ManagedSubscriptionsBackupError ? error.code : 'REFERRAL_BACKUP_VERIFY_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
