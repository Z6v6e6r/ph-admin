import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import {
  SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION,
  subscriptionInstanceDevCanaryFixtureSentinel
} from '../scripts/managed-subscriptions-instance-projector-dev-canary';
import { subscriptionInstanceProjectionTargetFingerprint } from '../src/subscriptions/subscription-provider-instance-projector.service';
import {
  manifestForHistory,
  PEPPER,
  record,
  twoPublicationHistory
} from './subscriptions-provider-instance-projector.test';

const execFileAsync = promisify(execFile);
type CanaryRow = { _id: string; [key: string]: any };

async function main(): Promise<void> {
  const uri = String(
    process.env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_MONGODB_TEST_URI ?? ''
  ).trim();
  if (!uri) {
    console.log('subscriptions instance DEV canary MongoDB test: SKIP');
    return;
  }
  const parsedUri = new URL(uri);
  assert.equal(parsedUri.protocol, 'mongodb:');
  assert.equal(parsedUri.username, '');
  assert.equal(parsedUri.password, '');
  assert.equal(parsedUri.pathname, '/');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsedUri.hostname));

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = `test-subscription-canary-${suffix}`;
  const targetSha256 = subscriptionInstanceProjectionTargetFingerprint(uri, database);
  const history = twoPublicationHistory();
  const records = [{
    ...record(),
    providerClientId: 'provider-client-canary-v1',
    clientSubscriptionId: 'client-subscription-canary-v1',
    purchasedAt: '2026-08-14T23:59:59.999Z',
    activeFrom: '2026-08-14T23:59:59.999Z',
    activeTo: '2027-08-14T23:59:59.999Z'
  }, {
    ...record(),
    providerClientId: 'provider-client-canary-v2',
    clientSubscriptionId: 'client-subscription-canary-v2',
    purchasedAt: '2026-08-15T00:00:00.000Z',
    activeFrom: '2026-08-15T00:00:00.000Z',
    activeTo: '2027-08-15T00:00:00.000Z'
  }];
  const productionShaped = manifestForHistory(records, history);
  const projectionInput = {
    ...productionShaped,
    schemaVersion: 3,
    sourceMode: 'DEV_VIVA_EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST',
    authority: {
      ...(productionShaped.authority as Record<string, unknown>),
      selectionMode: 'EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST',
      snapshotSemantics: 'EXACT_ALLOWLIST_AS_OF'
    }
  };
  const input = {
    schemaVersion: 1,
    sourceMode: 'DEV_EXACT_CLIENT_SUBSCRIPTION_CANARY',
    allowlistedClientSubscriptionIds: records.map((item) => item.clientSubscriptionId),
    projectionInput
  };
  const fixtureId = `fixture:test:subscription-projector-${suffix}`;
  const fixtureNonceSha256 = `sha256:${'9'.repeat(64)}`;
  const directory = await mkdtemp(join(tmpdir(), 'phab-instance-canary-'));
  const inputPath = join(directory, 'input.json');
  await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
  await chmod(inputPath, 0o600);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    SUBSCRIPTIONS_MONGODB_URI: uri,
    SUBSCRIPTIONS_MONGODB_DB: database,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_ID: `test-subscription-projector-${suffix}`,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ID: fixtureId,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_NONCE_SHA256: fixtureNonceSha256,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_SHA256: targetSha256,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_APPLY_CONFIRM:
      'APPLY_EXACTLY_TWO_DEV_SUBSCRIPTION_INSTANCES',
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT: inputPath,
    SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: PEPPER,
    SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false'
  };
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const script = join(
    process.cwd(),
    'scripts/managed-subscriptions-instance-projector-dev-canary.ts'
  );
  const run = async (mode: string, runEnv = env) => {
    const result = await execFileAsync(
      process.execPath,
      ['-r', 'ts-node/register', script, mode],
      { cwd: process.cwd(), env: runEnv, maxBuffer: 1_048_576 }
    );
    return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  };
  try {
    await client.connect();
    const db = client.db(database);
    const sentinel = subscriptionInstanceDevCanaryFixtureSentinel(env, {
      targetSha256,
      database
    });
    await Promise.all([
      db.collection(SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION)
        .insertOne(sentinel as any),
      db.collection('subscription_policy_publications').insertMany(structuredClone(history))
    ]);
    const fingerprint = await run('--plan-fingerprint');
    assert.equal(fingerprint.status, 'PLAN_READY');
    assert.equal(fingerprint.write, false);
    const planSha256 = String(fingerprint.planSha256);
    const applyEnv = {
      ...env,
      SUBSCRIPTIONS_INSTANCE_DEV_CANARY_PLAN_SHA256: planSha256
    };
    const runId = `subscription_instance_dev_canary:${planSha256.slice(7)}`;

    const canaryInstances = db.collection<CanaryRow>(
      'subscription_instance_dev_canary_instances'
    );
    await canaryInstances.createIndex({ clientSubscriptionId: 1 }, { unique: true });
    await canaryInstances.insertOne({
      _id: 'fixture-owned-conflict',
      runId: 'fixture:test:rollback-conflict',
      clientSubscriptionId: 'client-subscription-canary-v2'
    });
    await assert.rejects(
      run('--apply', applyEnv),
      (error: any) => String(error?.stderr ?? '').includes(
        'SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FAILED'
      )
    );
    assert.equal(await canaryInstances.countDocuments({ runId }), 0);
    assert.equal(
      await db.collection('subscription_instance_dev_canary_runs').countDocuments({ runId }),
      0
    );
    await canaryInstances.deleteOne({ _id: 'fixture-owned-conflict' });

    const inserted = await run('--apply', applyEnv);
    assert.equal(inserted.status, 'INSERTED');
    assert.equal(inserted.write, true);
    const stored = await canaryInstances.find(
      { runId }, { projection: { _id: 0 } }
    ).sort({ clientSubscriptionId: 1 }).toArray();
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map((item) => item.policyVersion).sort(), [1, 2]);
    assert.equal(await db.collection('subscription_instances').countDocuments({}), 0);
    assert.equal(
      await db.collection('subscription_instance_projector_checkpoints').countDocuments({}),
      0
    );
    const replay = await run('--apply', applyEnv);
    assert.equal(replay.status, 'EXACT_REPLAY');
    assert.equal(replay.write, false);

    await db.dropDatabase();
    const databases = await client.db('admin').admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some((item) => item.name === database), false);
    console.log('subscriptions instance DEV canary MongoDB test: OK');
  } finally {
    await client.db(database).dropDatabase().catch(() => undefined);
    await client.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
