import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ServiceUnavailableException } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import {
  syntheticProjectionTargetFingerprint,
  SubscriptionSyntheticCanonicalProjectionService
} from '../src/subscriptions/subscription-synthetic-canonical-projection.service';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const URI = process.env.SUBSCRIPTIONS_TEST_MONGODB_URI
  ?? 'mongodb://127.0.0.1:27029/?directConnection=true';
const DB = `phab_subscriptions_test_gate_d_synthetic_${process.pid}_${Date.now()}`;
const ENV_NAMES = [
  'NODE_ENV',
  'SUBSCRIPTIONS_MONGODB_URI',
  'SUBSCRIPTIONS_MONGODB_DB',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_AUTO_CREATE_INDEXES',
  'SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED',
  'SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS',
  'SUBSCRIPTIONS_SYNTHETIC_PROJECTION_APPLY',
  'SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256',
  'SUBSCRIPTIONS_INDEX_APPLY',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS',
  'SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

const restoreEnv = (): void => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

const domainCode = (code: string) => (error: unknown): boolean => {
  if (!(error instanceof ServiceUnavailableException)) return false;
  const response = error.getResponse();
  return Boolean(response && typeof response === 'object'
    && (response as Record<string, unknown>).code === code);
};

async function run(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTIONS_MONGODB_URI = URI;
  process.env.SUBSCRIPTIONS_MONGODB_DB = DB;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
  process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS = 'station:yasenevo';
  process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_APPLY = 'CONFIRM';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'iSkq6G';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
  process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256 =
    syntheticProjectionTargetFingerprint();
  process.env.SUBSCRIPTIONS_INDEX_APPLY = 'CONFIRM';

  const indexApply = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', 'scripts/managed-subscriptions-synthetic-indexes.ts', '--apply'],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8'
    }
  );
  assert.equal(indexApply.status, 0, indexApply.stderr || indexApply.stdout);

  const now = Date.now();
  const fixture = {
    schemaVersion: 1,
    sourceMode: 'SYNTHETIC_FIXTURE',
    tenantId: 'iSkq6G',
    targetId: 'synthetic:mongo-open-game-1',
    action: 'JOIN_GAME',
    state: 'ACTIVE',
    revision: 1,
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'synthetic_event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: new Date(now + 86_400_000).toISOString(),
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'synthetic_dictionary:mongo-r1',
    evidenceRef: 'synthetic_evidence:mongo-target-r1',
    priceEvidenceRef: 'synthetic_price_evidence:mongo-target-r1',
    observedAt: new Date(now - 5_000).toISOString(),
    expiresAt: new Date(now + 55_000).toISOString()
  };

  const repository = new SubscriptionsRepository();
  try {
    const producer = new SubscriptionSyntheticCanonicalProjectionService(repository);
    assert.equal((await producer.apply(fixture)).status, 'INSERTED');
    assert.equal((await producer.apply(fixture)).status, 'REPLAY');
    const revoked = {
      ...fixture,
      state: 'REVOKED',
      revision: 2,
      dictionaryRevision: 'synthetic_dictionary:mongo-r2',
      evidenceRef: 'synthetic_evidence:mongo-target-r2',
      priceEvidenceRef: 'synthetic_price_evidence:mongo-target-r2'
    };
    assert.equal((await producer.apply(revoked)).status, 'INSERTED');

    process.env.SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED = 'true';
    const resolver = new SubscriptionCanonicalTargetResolverService(repository);
    await assert.rejects(
      resolver.resolve({
        tenantId: 'iSkq6G',
        targetId: 'synthetic:mongo-open-game-1',
        action: 'JOIN_GAME',
        snapshotRevision: 1
      }),
      domainCode('SUBSCRIPTIONS_CANONICAL_TARGET_REVOKED')
    );

    const client = new MongoClient(URI);
    await client.connect();
    try {
      assert.equal(
        await client.db(DB).collection('subscription_canonical_target_snapshots').countDocuments(),
        2
      );
    } finally {
      await client.close();
    }
  } finally {
    await repository.close();
  }
}

const cleanup = async (): Promise<void> => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    await client.db(DB).dropDatabase();
    const databases = await client.db('admin').admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some((item) => item.name === DB), false);
  } finally {
    await client.close().catch(() => undefined);
    restoreEnv();
  }
};

run()
  .then(() => console.log('subscriptions synthetic canonical projection Mongo tests: OK'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
