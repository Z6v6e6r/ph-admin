import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createManagedSubscriptionsBackup
} from '../scripts/managed-subscriptions-backup-core.mjs';
import { mongoBackupAdapter } from '../scripts/managed-subscriptions-backup.mjs';
import {
  REFERRAL_BACKUP_SCHEMA,
  referralBackupCollections,
  validateReferralBackupCreateGate
} from '../scripts/referral-links-backup.mjs';
import { verifyReferralBackup } from '../scripts/referral-links-backup-verify.mjs';

const TARGET_SHA = 'a'.repeat(64);
const SOURCE = {
  unit: 'phab-api-p32-2be5b1f.service',
  releaseDir: '/opt/ph-admin-releases/p32-2be5b1f-test',
  releaseSha: '2be5b1f1973f1694f727db3fa0be5673f83b566b'
};

function errorCode(code) {
  return (error) => error?.code === code;
}

async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function fakeAdapter(documentsByName) {
  return {
    async streamCollections(names, handler) {
      for (const name of names) {
        const documents = documentsByName[name] ?? [];
        await handler({
          name,
          exists: Object.hasOwn(documentsByName, name),
          indexes: Object.hasOwn(documentsByName, name) ? [{ name: '_id_', key: { _id: 1 } }] : [],
          documents
        });
      }
    }
  };
}

class FakeMongoClient {
  constructor() {
    this.closed = false;
  }

  async connect() {}

  db() {
    const records = {
      links: { count: 2, indexes: [{ name: '_id_' }] },
      events: { count: 3, indexes: [{ name: '_id_' }, { name: 'createdAt_1' }] }
    };
    return {
      admin: () => ({ command: async () => ({ isWritablePrimary: true }) }),
      listCollections: () => ({
        toArray: async () => Object.keys(records).map((name) => ({ name }))
      }),
      collection: (name) => ({
        countDocuments: async () => records[name]?.count ?? 0,
        listIndexes: () => ({ toArray: async () => records[name]?.indexes ?? [] })
      })
    };
  }

  async close() {
    this.closed = true;
  }
}

async function privateRoot() {
  const root = await mkdtemp(join(tmpdir(), 'referral-backup-test-'));
  await chmod(root, 0o700);
  return realpath(root);
}

test('referral collection set follows explicit production collection names', () => {
  assert.deepEqual(referralBackupCollections({}), [
    'subscription_referral_links',
    'subscription_referral_link_events',
    'lk_tournament_subscription_sales'
  ]);
  assert.deepEqual(referralBackupCollections({
    REFERRAL_LINKS_COLLECTION: 'links_v2',
    REFERRAL_LINK_EVENTS_COLLECTION: 'events_v2',
    REFERRAL_LINK_SALES_COLLECTION: 'sales_v2'
  }), ['links_v2', 'events_v2', 'sales_v2']);
});

test('mongo backup adapter reports metadata for the requested collection set', async () => {
  const adapter = await mongoBackupAdapter({
    uri: 'mongodb://synthetic.invalid/games',
    database: 'games',
    MongoClient: FakeMongoClient,
    EJSON: { stringify: JSON.stringify },
    collectionNames: ['links', 'events', 'sales']
  });
  try {
    assert.deepEqual(await adapter.metadata(), [
      { name: 'links', exists: true, count: 2, indexCount: 1 },
      { name: 'events', exists: true, count: 3, indexCount: 2 },
      { name: 'sales', exists: false, count: 0, indexCount: 0 }
    ]);
  } finally {
    await adapter.close();
  }
});

test('production referral backup requires root and an exact confirmation', () => {
  assert.throws(() => validateReferralBackupCreateGate({}, 0), errorCode('REFERRAL_BACKUP_CREATE_CONFIRMATION_REQUIRED'));
  assert.throws(
    () => validateReferralBackupCreateGate({ REFERRAL_LINKS_BACKUP_CREATE: 'CONFIRM' }, 501),
    errorCode('REFERRAL_BACKUP_ROOT_REQUIRED')
  );
  assert.doesNotThrow(() => validateReferralBackupCreateGate({ REFERRAL_LINKS_BACKUP_CREATE: 'CONFIRM' }, 0));
});

test('synthetic referral backup is private, complete and recovery-verifiable', async () => {
  const root = await privateRoot();
  try {
    const collections = referralBackupCollections({});
    const result = await createManagedSubscriptionsBackup({
      root,
      target: { database: 'games', targetSha256: TARGET_SHA },
      source: SOURCE,
      adapter: fakeAdapter({
        subscription_referral_links: [{ _id: 'link-1', publicToken: 'synthetic-token' }],
        subscription_referral_link_events: [{ _id: 'event-1', kind: 'OPEN' }],
        lk_tournament_subscription_sales: [{ _id: 'sale-1', status: 'PAID' }]
      }),
      serialize: JSON.stringify,
      now: new Date('2026-08-27T01:02:03.000Z'),
      requireRootOwner: false,
      collections,
      backupIdPrefix: 'phab-prod-referral-links-gate',
      manifestSchema: REFERRAL_BACKUP_SCHEMA,
      sourceEvidence: 'DECLARED_NOT_LIVE_ATTESTED'
    });
    const verified = await verifyReferralBackup({
      archivePath: result.archivePath,
      expectedArchiveSha256: result.archiveSha256,
      expectedDatabase: 'games',
      expectedTargetSha256: TARGET_SHA,
      expectedSource: SOURCE,
      collections
    });
    assert.equal(verified.totalDocuments, 3);
    assert.deepEqual(verified.collections.map(({ name, count }) => ({ name, count })), [
      { name: 'subscription_referral_links', count: 1 },
      { name: 'subscription_referral_link_events', count: 1 },
      { name: 'lk_tournament_subscription_sales', count: 1 }
    ]);
    await assert.rejects(() => verifyReferralBackup({
      archivePath: result.archivePath,
      expectedArchiveSha256: 'b'.repeat(64),
      expectedDatabase: 'games',
      expectedTargetSha256: TARGET_SHA,
      expectedSource: SOURCE,
      collections
    }), errorCode('REFERRAL_BACKUP_ARCHIVE_SHA256_MISMATCH'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup verifier rejects a symlink member even when the archive digest is approved', async () => {
  const root = await privateRoot();
  try {
    const collections = referralBackupCollections({});
    const result = await createManagedSubscriptionsBackup({
      root,
      target: { database: 'games', targetSha256: TARGET_SHA },
      source: SOURCE,
      adapter: fakeAdapter({
        subscription_referral_links: [{ _id: 'link-1' }],
        subscription_referral_link_events: [],
        lk_tournament_subscription_sales: []
      }),
      serialize: JSON.stringify,
      requireRootOwner: false,
      collections,
      backupIdPrefix: 'phab-prod-referral-links-gate',
      manifestSchema: REFERRAL_BACKUP_SCHEMA,
      sourceEvidence: 'DECLARED_NOT_LIVE_ATTESTED'
    });
    const tamperRoot = join(root, 'tamper');
    await mkdir(tamperRoot, { mode: 0o700 });
    execFileSync('/usr/bin/tar', ['-C', tamperRoot, '-xzf', result.archivePath]);
    const documentPath = join(tamperRoot, result.backupId, 'collection-001.ndjson');
    await rm(documentPath);
    await symlink('collection-001.indexes.json', documentPath);
    const badArchive = join(root, 'symlink-member.tar.gz');
    execFileSync('/usr/bin/tar', ['-C', tamperRoot, '-czf', badArchive, result.backupId]);
    await chmod(badArchive, 0o600);
    const badArchiveSha256 = await fileSha256(badArchive);
    await assert.rejects(() => verifyReferralBackup({
      archivePath: badArchive,
      expectedArchiveSha256: badArchiveSha256,
      expectedDatabase: 'games',
      expectedTargetSha256: TARGET_SHA,
      expectedSource: SOURCE,
      collections
    }), errorCode('REFERRAL_BACKUP_MEMBER_TYPE_INVALID'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup creation fails closed on duplicate configured collection names', async () => {
  const root = await privateRoot();
  try {
    await assert.rejects(() => createManagedSubscriptionsBackup({
      root,
      target: { database: 'games', targetSha256: TARGET_SHA },
      source: SOURCE,
      adapter: fakeAdapter({}),
      serialize: JSON.stringify,
      requireRootOwner: false,
      collections: ['same_collection', 'same_collection'],
      backupIdPrefix: 'phab-prod-referral-links-gate',
      manifestSchema: REFERRAL_BACKUP_SCHEMA
    }), errorCode('BACKUP_COLLECTION_SET_INVALID'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
