#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  MANAGED_SUBSCRIPTION_COLLECTIONS,
  ManagedSubscriptionsBackupError,
  createManagedSubscriptionsBackup,
  credentialFreeMongoTarget,
  validateBackupRoot,
  validateBackupSource,
  validateCreateGate,
  validateTargetAttestation
} from './managed-subscriptions-backup-core.mjs';

function env(name) {
  return String(process.env[name] ?? '').trim();
}

function mode() {
  const selected = ['--target-fingerprint', '--check', '--create'].filter((item) => process.argv.includes(item));
  if (selected.length !== 1) {
    throw new ManagedSubscriptionsBackupError(
      'BACKUP_MODE_INVALID',
      'Use exactly one of --target-fingerprint, --check or --create'
    );
  }
  return selected[0];
}

function safeSource() {
  return {
    unit: env('SUBSCRIPTIONS_BACKUP_SOURCE_UNIT'),
    releaseDir: env('SUBSCRIPTIONS_BACKUP_SOURCE_RELEASE_DIR'),
    releaseSha: env('SUBSCRIPTIONS_BACKUP_SOURCE_SHA')
  };
}

export async function mongoBackupAdapter({ uri, database, MongoClient, EJSON, collectionNames }) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 2,
    readPreference: 'primary'
  });
  await client.connect();
  const db = client.db(database);
  const hello = await db.admin().command({ hello: 1 });
  if (hello?.isWritablePrimary !== true) {
    await client.close().catch(() => undefined);
    throw new ManagedSubscriptionsBackupError(
      'BACKUP_PRIMARY_REQUIRED',
      'Approved Mongo primary could not be verified'
    );
  }

  async function metadata() {
    const names = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name)
    );
    const metadataCollections = [];
    for (const name of collectionNames) {
      const exists = names.has(name);
      const collection = db.collection(name);
      metadataCollections.push({
        name,
        exists,
        count: exists ? await collection.countDocuments({}) : 0,
        indexCount: exists ? (await collection.listIndexes().toArray()).length : 0
      });
    }
    return metadataCollections;
  }

  return {
    primaryVerified: true,
    metadata,
    serialize: (value) => EJSON.stringify(value, { relaxed: false }),
    async streamCollections(names, handler) {
      const existing = new Set(
        (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name)
      );
      const indexes = new Map();
      for (const name of names) {
        indexes.set(name, existing.has(name) ? await db.collection(name).listIndexes().toArray() : []);
      }
      const session = client.startSession();
      try {
        session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary' });
        for (const name of names) {
          const documents = existing.has(name)
            ? db.collection(name).find({}, { session, batchSize: 100 }).sort({ _id: 1 })
            : [];
          await handler({ name, exists: existing.has(name), indexes: indexes.get(name), documents });
        }
        await session.commitTransaction();
      } catch (error) {
        await session.abortTransaction().catch(() => undefined);
        throw error;
      } finally {
        await session.endSession();
      }
    },
    close: () => client.close()
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main() {
  const selectedMode = mode();
  const uri = env('SUBSCRIPTIONS_MONGODB_URI') || env('MONGODB_URI');
  const database = env('SUBSCRIPTIONS_MONGODB_DB');
  const target = credentialFreeMongoTarget(uri, database);
  if (selectedMode === '--target-fingerprint') {
    print(target);
    return;
  }
  validateTargetAttestation(
    target,
    env('SUBSCRIPTIONS_BACKUP_EXPECTED_DB'),
    env('SUBSCRIPTIONS_BACKUP_TARGET_SHA256')
  );
  const root = await validateBackupRoot(env('SUBSCRIPTIONS_BACKUP_ROOT'));
  const source = selectedMode === '--create' ? validateBackupSource(safeSource()) : null;
  if (selectedMode === '--create') validateCreateGate(process.env);
  const { MongoClient, BSON } = await import('mongodb');
  const adapter = await mongoBackupAdapter({
    uri,
    database,
    MongoClient,
    EJSON: BSON.EJSON,
    collectionNames: MANAGED_SUBSCRIPTION_COLLECTIONS
  });
  try {
    if (selectedMode === '--check') {
      const collections = await adapter.metadata();
      print({
        mode: 'check',
        database,
        targetSha256: target.targetSha256,
        root,
        primaryVerified: adapter.primaryVerified,
        collections,
        totalDocuments: collections.reduce((total, item) => total + item.count, 0)
      });
      return;
    }
    const result = await createManagedSubscriptionsBackup({
      root,
      target,
      source,
      adapter,
      serialize: adapter.serialize,
      maxDocuments: env('SUBSCRIPTIONS_BACKUP_MAX_DOCUMENTS') || undefined,
      maxBytes: env('SUBSCRIPTIONS_BACKUP_MAX_BYTES') || undefined
    });
    print({ mode: 'create', ...result });
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const code = error instanceof ManagedSubscriptionsBackupError
      ? error.code
      : 'BACKUP_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
