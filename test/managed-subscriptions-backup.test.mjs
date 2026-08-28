import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  MANAGED_SUBSCRIPTION_COLLECTIONS,
  createManagedSubscriptionsBackup,
  credentialFreeMongoTarget,
  validateBackupRoot,
  validateCreateGate,
  validateTargetAttestation
} from '../scripts/managed-subscriptions-backup-core.mjs';

const SHA = 'a'.repeat(64);
const SOURCE = {
  unit: 'phab-api-p27-b0fc2d3.service',
  releaseDir: '/opt/ph-admin-releases/p27-b0fc2d3-test',
  releaseSha: 'b0fc2d38b5b5f096fba3104d69382ea2cf46af0f'
};

function errorCode(code) {
  return (error) => error?.code === code;
}

function fakeAdapter(documentsByName = {}, indexesByName = {}) {
  return {
    async streamCollections(names, handler) {
      for (const name of names) {
        const documents = documentsByName[name] ?? [];
        await handler({
          name,
          exists: documentsByName[name] !== undefined,
          indexes: documentsByName[name] !== undefined
            ? (indexesByName[name] ?? [{ name: '_id_', key: { _id: 1 } }])
            : [],
          documents
        });
      }
    }
  };
}

async function secureTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'managed-subscriptions-backup-test-'));
  await chmod(root, 0o700);
  return realpath(root);
}

test('credential-free fingerprint is stable and never contains Mongo credentials', () => {
  const target = credentialFreeMongoTarget(
    'mongodb://backup-user:super-secret@db1.example:27017,db2.example:27017/dialog?replicaSet=rs0',
    'dialog'
  );
  assert.equal(target.scheme, 'mongodb');
  assert.equal(target.hosts, 'db1.example:27017,db2.example:27017');
  assert.equal(target.database, 'dialog');
  assert.match(target.targetSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(target), /backup-user|super-secret/);
  const changedOptions = credentialFreeMongoTarget(
    'mongodb://backup-user:super-secret@db1.example:27017,db2.example:27017/dialog?replicaSet=other',
    'dialog'
  );
  assert.notEqual(changedOptions.targetSha256, target.targetSha256);
});

test('target attestation fails closed on database and fingerprint drift', () => {
  const target = { database: 'dialog', targetSha256: SHA };
  assert.doesNotThrow(() => validateTargetAttestation(target, 'dialog', SHA));
  assert.throws(() => validateTargetAttestation(target, 'other', SHA), errorCode('BACKUP_DATABASE_MISMATCH'));
  assert.throws(
    () => validateTargetAttestation(target, 'dialog', 'b'.repeat(64)),
    errorCode('BACKUP_TARGET_SHA256_MISMATCH')
  );
});

test('create gate requires root and exact explicit confirmation', () => {
  assert.throws(() => validateCreateGate({}, 0), errorCode('BACKUP_CREATE_CONFIRMATION_REQUIRED'));
  assert.throws(
    () => validateCreateGate({ SUBSCRIPTIONS_BACKUP_CREATE: 'CONFIRM' }, 501),
    errorCode('BACKUP_ROOT_REQUIRED')
  );
  assert.doesNotThrow(() => validateCreateGate({ SUBSCRIPTIONS_BACKUP_CREATE: 'CONFIRM' }, 0));
});

test('backup root rejects broad, symlink and group-writable targets', async () => {
  await assert.rejects(() => validateBackupRoot('/', { requireRootOwner: false }), errorCode('BACKUP_ROOT_TOO_BROAD'));
  const root = await secureTempRoot();
  const link = `${root}-link`;
  await symlink(root, link);
  await assert.rejects(() => validateBackupRoot(link, { requireRootOwner: false }), errorCode('BACKUP_ROOT_UNSAFE'));
  await chmod(root, 0o777);
  await assert.rejects(
    () => validateBackupRoot(root, { requireRootOwner: false }),
    errorCode('BACKUP_ROOT_WRITABLE_BY_OTHERS')
  );
});

test('archive is root-only shaped, checksummed and contains no connection secret', async () => {
  const root = await secureTempRoot();
  const target = { database: 'dialog', targetSha256: SHA };
  const result = await createManagedSubscriptionsBackup({
    root,
    target,
    source: SOURCE,
    adapter: fakeAdapter({
      subscription_types: [{ _id: 'type-1', title: 'Synthetic' }],
      subscription_policy_versions: [{ _id: 'policy-1', token: 'not-a-real-token' }]
    }),
    serialize: JSON.stringify,
    now: new Date('2026-08-22T01:02:03.000Z'),
    requireRootOwner: false
  });
  assert.equal(result.totalDocuments, 2);
  assert.equal(result.collections.length, MANAGED_SUBSCRIPTION_COLLECTIONS.length);
  assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal((await lstat(result.archivePath)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(root, result.backupId))).mode & 0o777, 0o700);
  const archive = spawnSync('tar', ['-xOzf', result.archivePath, `${result.backupId}/manifest.json`], {
    encoding: 'utf8'
  });
  assert.equal(archive.status, 0);
  const manifest = JSON.parse(archive.stdout);
  assert.equal(manifest.schema, 'phab-production-managed-subscriptions-backup-v4');
  assert.equal(manifest.totalDocuments, 2);
  assert.equal(manifest.collections.length, MANAGED_SUBSCRIPTION_COLLECTIONS.length);
  assert.equal(MANAGED_SUBSCRIPTION_COLLECTIONS.length, 14);
  assert.equal(MANAGED_SUBSCRIPTION_COLLECTIONS.includes('subscription_instance_projector_checkpoints'), true);
  assert.equal(MANAGED_SUBSCRIPTION_COLLECTIONS.includes('subscription_projection_fences'), true);
  assert.equal(MANAGED_SUBSCRIPTION_COLLECTIONS.includes('subscription_runtime_binding_promotions'), true);
  const checkpointInventory = manifest.collections.find(
    (item) => item.name === 'subscription_instance_projector_checkpoints'
  );
  assert.equal(checkpointInventory.exists, false);
  assert.doesNotMatch(archive.stdout, /mongodb:\/\/|super-secret/);
  for (const item of manifest.collections) {
    for (const [file, expected] of [
      [item.documentFile, item.documentSha256],
      [item.indexFile, item.indexSha256]
    ]) {
      const member = spawnSync('tar', ['-xOzf', result.archivePath, `${result.backupId}/${file}`]);
      assert.equal(member.status, 0);
      assert.equal(createHash('sha256').update(member.stdout).digest('hex'), expected);
    }
  }
  assert.equal(await readFile(result.archivePath).then((value) => value.length > 0), true);
});

test('checkpoint collection is exported when present', async () => {
  const root = await secureTempRoot();
  const checkpointDocument = { checkpointId: 'checkpoint:1', state: 'CURRENT' };
  const checkpointIndexes = [
    { name: '_id_', key: { _id: 1 } },
    {
      name: 'subscription_instance_projector_checkpoint_id_unique',
      key: { checkpointId: 1 },
      unique: true
    }
  ];
  const result = await createManagedSubscriptionsBackup({
    root,
    target: { database: 'dialog', targetSha256: SHA },
    source: SOURCE,
    adapter: fakeAdapter(
      { subscription_instance_projector_checkpoints: [checkpointDocument] },
      { subscription_instance_projector_checkpoints: checkpointIndexes }
    ),
    serialize: JSON.stringify,
    now: new Date('2026-08-22T01:02:03.000Z'),
    requireRootOwner: false
  });
  const checkpoint = result.collections.find(
    (item) => item.name === 'subscription_instance_projector_checkpoints'
  );
  assert.equal(checkpoint.exists, true);
  assert.equal(checkpoint.count, 1);
  assert.equal(checkpoint.indexCount, 2);

  const manifestMember = spawnSync(
    'tar',
    ['-xOzf', result.archivePath, `${result.backupId}/manifest.json`],
    { encoding: 'utf8' }
  );
  assert.equal(manifestMember.status, 0);
  const manifest = JSON.parse(manifestMember.stdout);
  const checkpointManifest = manifest.collections.find(
    (item) => item.name === 'subscription_instance_projector_checkpoints'
  );
  assert.equal(checkpointManifest.count, 1);
  assert.equal(checkpointManifest.indexCount, 2);

  const documentMember = spawnSync(
    'tar',
    ['-xOzf', result.archivePath, `${result.backupId}/${checkpointManifest.documentFile}`]
  );
  assert.equal(documentMember.status, 0);
  assert.equal(documentMember.stdout.toString('utf8'), `${JSON.stringify(checkpointDocument)}\n`);
  assert.equal(
    createHash('sha256').update(documentMember.stdout).digest('hex'),
    checkpointManifest.documentSha256
  );

  const indexMember = spawnSync(
    'tar',
    ['-xOzf', result.archivePath, `${result.backupId}/${checkpointManifest.indexFile}`]
  );
  assert.equal(indexMember.status, 0);
  assert.deepEqual(JSON.parse(indexMember.stdout.toString('utf8')), checkpointIndexes);
  assert.equal(
    createHash('sha256').update(indexMember.stdout).digest('hex'),
    checkpointManifest.indexSha256
  );
});

test('document cap fails closed and removes the incomplete final directory', async () => {
  const root = await secureTempRoot();
  const now = new Date('2026-08-22T01:02:04.000Z');
  await assert.rejects(
    () => createManagedSubscriptionsBackup({
      root,
      target: { database: 'dialog', targetSha256: SHA },
      source: SOURCE,
      adapter: fakeAdapter({ subscription_types: [{ id: 1 }, { id: 2 }] }),
      serialize: JSON.stringify,
      now,
      maxDocuments: 1,
      requireRootOwner: false
    }),
    errorCode('BACKUP_DOCUMENT_LIMIT_EXCEEDED')
  );
  const expected = join(root, 'phab-prod-subscriptions-gate-b-20260822T010204Z');
  await assert.rejects(() => lstat(expected));
});

test('workspace collision fails closed without deleting a pre-existing path', async () => {
  const root = await secureTempRoot();
  const now = new Date('2026-08-22T01:02:05.000Z');
  const backupId = 'phab-prod-subscriptions-gate-b-20260822T010205Z';
  const collision = join(root, `.tmp-${backupId}-${process.pid}`);
  await mkdir(collision, { mode: 0o700 });

  await assert.rejects(
    () => createManagedSubscriptionsBackup({
      root,
      target: { database: 'dialog', targetSha256: SHA },
      source: SOURCE,
      adapter: fakeAdapter(),
      serialize: JSON.stringify,
      now,
      requireRootOwner: false
    }),
    errorCode('BACKUP_EXPORT_FAILED')
  );
  assert.equal((await lstat(collision)).isDirectory(), true);
});
