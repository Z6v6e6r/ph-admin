import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MANAGED_SUBSCRIPTION_COLLECTIONS = Object.freeze([
  'subscription_types',
  'subscription_policy_versions',
  'subscription_release_programs',
  'subscription_canonical_target_snapshots',
  'subscription_provider_mappings',
  'subscription_policy_publications',
  'subscription_projection_fences',
  'subscription_instances',
  'subscription_instance_projector_checkpoints',
  'subscription_entitlement_aggregates',
  'subscription_operations',
  'subscription_usage_ledger',
  'subscription_outbox'
]);

export class ManagedSubscriptionsBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManagedSubscriptionsBackupError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ManagedSubscriptionsBackupError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredText(value, code, message) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(code, message);
  return normalized;
}

export function credentialFreeMongoTarget(uriValue, databaseValue) {
  const uri = requiredText(
    uriValue,
    'BACKUP_MONGO_URI_REQUIRED',
    'Mongo connection is not configured'
  );
  const database = requiredText(
    databaseValue,
    'BACKUP_DATABASE_REQUIRED',
    'Subscription database is not configured'
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(database)) {
    fail('BACKUP_DATABASE_INVALID', 'Subscription database identifier is invalid');
  }
  const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)(.*)$/i.exec(uri);
  if (!match) fail('BACKUP_MONGO_URI_INVALID', 'Mongo connection format is invalid');
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const connectionSuffix = match[3] || '';
  const hosts = authority.slice(authority.lastIndexOf('@') + 1).trim().toLowerCase();
  if (!hosts || /[\s/@]/.test(hosts)) {
    fail('BACKUP_MONGO_TARGET_INVALID', 'Mongo target cannot be identified safely');
  }
  const canonical = JSON.stringify({ scheme, hosts, database, connectionSuffix });
  return {
    scheme,
    hosts,
    database,
    targetSha256: sha256(canonical)
  };
}

export function validateTargetAttestation(target, expectedDatabaseValue, expectedShaValue) {
  const expectedDatabase = requiredText(
    expectedDatabaseValue,
    'BACKUP_EXPECTED_DATABASE_REQUIRED',
    'Expected subscription database must be pinned'
  );
  const expectedSha = requiredText(
    expectedShaValue,
    'BACKUP_TARGET_SHA256_REQUIRED',
    'Credential-free Mongo target fingerprint must be pinned'
  );
  if (target.database !== expectedDatabase) {
    fail('BACKUP_DATABASE_MISMATCH', 'Configured subscription database differs from the approved target');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || target.targetSha256 !== expectedSha) {
    fail('BACKUP_TARGET_SHA256_MISMATCH', 'Mongo target fingerprint differs from the approved target');
  }
}

export function validateCreateGate(env, uid = typeof process.getuid === 'function' ? process.getuid() : null) {
  if (env.SUBSCRIPTIONS_BACKUP_CREATE !== 'CONFIRM') {
    fail('BACKUP_CREATE_CONFIRMATION_REQUIRED', 'Backup creation requires an explicit confirmation gate');
  }
  if (uid !== 0) {
    fail('BACKUP_ROOT_REQUIRED', 'Production backup creation must run as root');
  }
}

export async function validateBackupRoot(rootValue, { requireRootOwner = true } = {}) {
  const configured = requiredText(
    rootValue,
    'BACKUP_ROOT_REQUIRED',
    'Backup root is not configured'
  );
  if (!isAbsolute(configured)) fail('BACKUP_ROOT_NOT_ABSOLUTE', 'Backup root must be absolute');
  const normalized = resolve(configured);
  if (normalized === sep || normalized.split(sep).filter(Boolean).length < 2) {
    fail('BACKUP_ROOT_TOO_BROAD', 'Backup root is too broad');
  }
  const linkInfo = await lstat(normalized).catch(() => null);
  if (!linkInfo?.isDirectory() || linkInfo.isSymbolicLink()) {
    fail('BACKUP_ROOT_UNSAFE', 'Backup root must be an existing non-symlink directory');
  }
  const resolved = await realpath(normalized);
  if (resolved !== normalized) fail('BACKUP_ROOT_UNSAFE', 'Backup root must resolve exactly');
  const info = await stat(resolved);
  if (requireRootOwner && info.uid !== 0) {
    fail('BACKUP_ROOT_OWNER_INVALID', 'Backup root must be owned by root');
  }
  if ((info.mode & 0o022) !== 0) {
    fail('BACKUP_ROOT_WRITABLE_BY_OTHERS', 'Backup root must not be group/world writable');
  }
  await access(resolved, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  return resolved;
}

export function validateBackupCollectionSet(collectionsValue) {
  if (!Array.isArray(collectionsValue) || collectionsValue.length < 1 || collectionsValue.length > 64) {
    fail('BACKUP_COLLECTION_SET_INVALID', 'Backup collection set is invalid');
  }
  const collections = collectionsValue.map((value) => requiredText(
    value,
    'BACKUP_COLLECTION_NAME_INVALID',
    'Backup collection name is invalid'
  ));
  if (collections.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))) {
    fail('BACKUP_COLLECTION_NAME_INVALID', 'Backup collection name is invalid');
  }
  if (new Set(collections).size !== collections.length) {
    fail('BACKUP_COLLECTION_SET_INVALID', 'Backup collection set contains duplicates');
  }
  return collections;
}

function utcId(date, prefix) {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${prefix}-${iso}`;
}

function safePositiveInteger(value, fallback, code) {
  const normalized = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail(code, 'Backup safety limit is invalid');
  return normalized;
}

async function fileSha256(path) {
  return sha256(await readFile(path));
}

function defaultTar({ workspaceRoot, backupId, destination }) {
  const result = spawnSync('/usr/bin/tar', ['-C', workspaceRoot, '-czf', destination, backupId], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
  });
  if (result.status !== 0) fail('BACKUP_ARCHIVE_FAILED', 'Backup archive could not be created');
}

export function validateBackupSource(source) {
  const releaseSha = requiredText(
    source?.releaseSha,
    'BACKUP_SOURCE_SHA_REQUIRED',
    'Source release SHA must be pinned'
  );
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    fail('BACKUP_SOURCE_SHA_INVALID', 'Source release SHA is invalid');
  }
  const unit = requiredText(
    source?.unit,
    'BACKUP_SOURCE_UNIT_REQUIRED',
    'Source service unit must be pinned'
  );
  if (!/^[A-Za-z0-9@_.:-]+\.service$/.test(unit)) {
    fail('BACKUP_SOURCE_UNIT_INVALID', 'Source service unit is invalid');
  }
  const releaseDir = requiredText(
    source?.releaseDir,
    'BACKUP_SOURCE_RELEASE_DIR_REQUIRED',
    'Source release directory must be pinned'
  );
  if (!isAbsolute(releaseDir) || basename(releaseDir) === '') {
    fail('BACKUP_SOURCE_RELEASE_DIR_INVALID', 'Source release directory is invalid');
  }
  return { unit, releaseDir, releaseSha };
}

export async function createManagedSubscriptionsBackup({
  root,
  target,
  source,
  adapter,
  serialize,
  now = new Date(),
  maxDocuments = 100000,
  maxBytes = 512 * 1024 * 1024,
  requireRootOwner = true,
  collections = MANAGED_SUBSCRIPTION_COLLECTIONS,
  backupIdPrefix = 'phab-prod-subscriptions-gate-b',
  manifestSchema = 'phab-production-managed-subscriptions-backup-v4',
  sourceEvidence,
  tar = defaultTar
}) {
  const backupRoot = await validateBackupRoot(root, { requireRootOwner });
  if (!target || !/^[a-f0-9]{64}$/.test(String(target.targetSha256 ?? ''))) {
    fail('BACKUP_TARGET_REQUIRED', 'Approved Mongo target is required');
  }
  const safeSource = validateBackupSource(source);
  if (!adapter || typeof adapter.streamCollections !== 'function') {
    fail('BACKUP_ADAPTER_REQUIRED', 'Backup data adapter is unavailable');
  }
  if (typeof serialize !== 'function') fail('BACKUP_SERIALIZER_REQUIRED', 'Canonical serializer is unavailable');
  const safeCollections = validateBackupCollectionSet(collections);
  const safeBackupIdPrefix = requiredText(
    backupIdPrefix,
    'BACKUP_ID_PREFIX_INVALID',
    'Backup identifier prefix is invalid'
  );
  if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(safeBackupIdPrefix)) {
    fail('BACKUP_ID_PREFIX_INVALID', 'Backup identifier prefix is invalid');
  }
  const safeManifestSchema = requiredText(
    manifestSchema,
    'BACKUP_MANIFEST_SCHEMA_INVALID',
    'Backup manifest schema is invalid'
  );
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(safeManifestSchema)) {
    fail('BACKUP_MANIFEST_SCHEMA_INVALID', 'Backup manifest schema is invalid');
  }
  const documentLimit = safePositiveInteger(maxDocuments, 100000, 'BACKUP_DOCUMENT_LIMIT_INVALID');
  const byteLimit = safePositiveInteger(maxBytes, 512 * 1024 * 1024, 'BACKUP_BYTE_LIMIT_INVALID');
  const backupId = utcId(now, safeBackupIdPrefix);
  const finalDirectory = join(backupRoot, backupId);
  const workspaceRoot = join(backupRoot, `.tmp-${backupId}-${process.pid}`);
  const contentRoot = join(workspaceRoot, backupId);
  const partialArchive = join(finalDirectory, `.${backupId}.partial.tar.gz`);
  const finalArchive = join(finalDirectory, `${backupId}.tar.gz`);
  let createdWorkspaceRoot = false;
  let createdFinalDirectory = false;
  let totalDocuments = 0;
  let totalBytes = 0;
  const manifestCollections = [];
  const seen = new Set();

  try {
    await mkdir(workspaceRoot, { mode: 0o700 });
    createdWorkspaceRoot = true;
    await mkdir(contentRoot, { mode: 0o700 });
    await mkdir(finalDirectory, { mode: 0o700 });
    createdFinalDirectory = true;
    await chmod(workspaceRoot, 0o700);
    await chmod(contentRoot, 0o700);
    await chmod(finalDirectory, 0o700);

    await adapter.streamCollections(safeCollections, async (item) => {
      const expectedName = safeCollections[manifestCollections.length];
      if (!item || item.name !== expectedName || seen.has(item.name)) {
        fail('BACKUP_COLLECTION_ORDER_INVALID', 'Backup adapter returned an unexpected collection');
      }
      seen.add(item.name);
      const number = String(manifestCollections.length + 1).padStart(3, '0');
      const documentFile = `collection-${number}.ndjson`;
      const indexFile = `collection-${number}.indexes.json`;
      const documentPath = join(contentRoot, documentFile);
      const indexPath = join(contentRoot, indexFile);
      const documentHash = createHash('sha256');
      const file = await open(documentPath, 'wx', 0o600);
      let count = 0;
      try {
        for await (const document of item.documents ?? []) {
          const line = `${serialize(document)}\n`;
          const bytes = Buffer.byteLength(line);
          count += 1;
          totalDocuments += 1;
          totalBytes += bytes;
          if (totalDocuments > documentLimit) {
            fail('BACKUP_DOCUMENT_LIMIT_EXCEEDED', 'Backup document limit was exceeded');
          }
          if (totalBytes > byteLimit) fail('BACKUP_BYTE_LIMIT_EXCEEDED', 'Backup byte limit was exceeded');
          documentHash.update(line);
          await file.write(line);
        }
      } finally {
        await file.close();
      }
      if (item.exists !== true && count !== 0) {
        fail('BACKUP_MISSING_COLLECTION_NOT_EMPTY', 'Missing collection unexpectedly returned documents');
      }
      await chmod(documentPath, 0o600);
      const indexPayload = `${serialize(Array.isArray(item.indexes) ? item.indexes : [])}\n`;
      totalBytes += Buffer.byteLength(indexPayload);
      if (totalBytes > byteLimit) fail('BACKUP_BYTE_LIMIT_EXCEEDED', 'Backup byte limit was exceeded');
      await writeFile(indexPath, indexPayload, { mode: 0o600, flag: 'wx' });
      await chmod(indexPath, 0o600);
      manifestCollections.push({
        name: item.name,
        exists: item.exists === true,
        count,
        indexCount: Array.isArray(item.indexes) ? item.indexes.length : 0,
        documentFile,
        indexFile,
        documentSha256: documentHash.digest('hex'),
        indexSha256: await fileSha256(indexPath)
      });
    });

    if (manifestCollections.length !== safeCollections.length) {
      fail('BACKUP_COLLECTION_SET_INCOMPLETE', 'Backup adapter did not return every managed collection');
    }
    const manifest = {
      schema: safeManifestSchema,
      createdAt: now.toISOString(),
      database: target.database,
      targetSha256: target.targetSha256,
      source: safeSource,
      collections: manifestCollections,
      totalDocuments,
      totalBytes
    };
    if (sourceEvidence !== undefined) {
      manifest.sourceEvidence = requiredText(
        sourceEvidence,
        'BACKUP_SOURCE_EVIDENCE_INVALID',
        'Backup source evidence label is invalid'
      );
    }
    const manifestPath = join(contentRoot, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(manifestPath, 0o600);
    tar({ workspaceRoot, backupId, destination: partialArchive });
    await chmod(partialArchive, 0o600);
    await rename(partialArchive, finalArchive);
    await chmod(finalArchive, 0o600);
    const archiveSha256 = await fileSha256(finalArchive);
    await rm(workspaceRoot, { recursive: true, force: false });
    return {
      backupId,
      archivePath: finalArchive,
      archiveSha256,
      database: target.database,
      targetSha256: target.targetSha256,
      totalDocuments,
      totalBytes,
      collections: manifestCollections.map(({ name, exists, count, indexCount }) => ({
        name,
        exists,
        count,
        indexCount
      }))
    };
  } catch (error) {
    if (createdWorkspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    if (createdFinalDirectory) {
      await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof ManagedSubscriptionsBackupError) throw error;
    fail('BACKUP_EXPORT_FAILED', 'Managed subscription backup export failed');
  }
}
