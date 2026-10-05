#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  ManagedSubscriptionsBackupError,
  createManagedSubscriptionsBackup,
  credentialFreeMongoTarget,
  validateBackupCollectionSet,
  validateBackupRoot,
  validateBackupSource,
  validateTargetAttestation
} from './managed-subscriptions-backup-core.mjs';
import { mongoBackupAdapter } from './managed-subscriptions-backup.mjs';

export const REFERRAL_BACKUP_SCHEMA = 'phab-production-referral-links-backup-v1';

function text(source, name) {
  return String(source[name] ?? '').trim();
}

export function referralBackupCollections(source = process.env) {
  return [
    text(source, 'REFERRAL_LINKS_COLLECTION') || 'subscription_referral_links',
    text(source, 'REFERRAL_LINK_EVENTS_COLLECTION') || 'subscription_referral_link_events',
    text(source, 'REFERRAL_LINK_SALES_COLLECTION') || 'lk_tournament_subscription_sales'
  ];
}

export function validateReferralBackupCreateGate(
  source,
  uid = typeof process.getuid === 'function' ? process.getuid() : null
) {
  if (source.REFERRAL_LINKS_BACKUP_CREATE !== 'CONFIRM') {
    throw new ManagedSubscriptionsBackupError(
      'REFERRAL_BACKUP_CREATE_CONFIRMATION_REQUIRED',
      'Referral backup creation requires an explicit confirmation gate'
    );
  }
  if (uid !== 0) {
    throw new ManagedSubscriptionsBackupError(
      'REFERRAL_BACKUP_ROOT_REQUIRED',
      'Production referral backup creation must run as root'
    );
  }
}

function selectedMode(argv) {
  const selected = ['--target-fingerprint', '--check', '--create'].filter((item) => argv.includes(item));
  if (selected.length !== 1) {
    throw new ManagedSubscriptionsBackupError(
      'REFERRAL_BACKUP_MODE_INVALID',
      'Use exactly one of --target-fingerprint, --check or --create'
    );
  }
  return selected[0];
}

function sourceIdentity(env) {
  return {
    unit: text(env, 'REFERRAL_LINKS_BACKUP_SOURCE_UNIT'),
    releaseDir: text(env, 'REFERRAL_LINKS_BACKUP_SOURCE_RELEASE_DIR'),
    releaseSha: text(env, 'REFERRAL_LINKS_BACKUP_SOURCE_SHA')
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2), source = process.env) {
  const mode = selectedMode(argv);
  const uri = text(source, 'REFERRAL_LINKS_MONGODB_URI')
    || text(source, 'SUBSCRIPTIONS_MONGODB_URI')
    || text(source, 'MONGODB_URI');
  const database = text(source, 'REFERRAL_LINKS_MONGODB_DB')
    || text(source, 'SUBSCRIPTIONS_MONGODB_DB')
    || text(source, 'MONGODB_DB');
  const target = credentialFreeMongoTarget(uri, database);
  if (mode === '--target-fingerprint') {
    print(target);
    return;
  }

  validateTargetAttestation(
    target,
    text(source, 'REFERRAL_LINKS_BACKUP_EXPECTED_DB'),
    text(source, 'REFERRAL_LINKS_BACKUP_TARGET_SHA256')
  );
  const root = await validateBackupRoot(text(source, 'REFERRAL_LINKS_BACKUP_ROOT'));
  const collections = validateBackupCollectionSet(referralBackupCollections(source));
  const releaseSource = mode === '--create' ? validateBackupSource(sourceIdentity(source)) : null;
  if (mode === '--create') validateReferralBackupCreateGate(source);

  const { MongoClient, BSON } = await import('mongodb');
  const adapter = await mongoBackupAdapter({
    uri,
    database,
    MongoClient,
    EJSON: BSON.EJSON,
    collectionNames: collections
  });
  try {
    if (mode === '--check') {
      const metadata = await adapter.metadata();
      print({
        mode: 'check',
        schema: REFERRAL_BACKUP_SCHEMA,
        database,
        targetSha256: target.targetSha256,
        root,
        primaryVerified: adapter.primaryVerified,
        collections: metadata,
        totalDocuments: metadata.reduce((total, item) => total + item.count, 0)
      });
      return;
    }

    const result = await createManagedSubscriptionsBackup({
      root,
      target,
      source: releaseSource,
      adapter,
      serialize: adapter.serialize,
      collections,
      backupIdPrefix: 'phab-prod-referral-links-gate',
      manifestSchema: REFERRAL_BACKUP_SCHEMA,
      sourceEvidence: 'DECLARED_NOT_LIVE_ATTESTED',
      maxDocuments: text(source, 'REFERRAL_LINKS_BACKUP_MAX_DOCUMENTS') || undefined,
      maxBytes: text(source, 'REFERRAL_LINKS_BACKUP_MAX_BYTES') || undefined
    });
    print({ mode: 'create', schema: REFERRAL_BACKUP_SCHEMA, ...result });
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const code = error instanceof ManagedSubscriptionsBackupError ? error.code : 'REFERRAL_BACKUP_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
