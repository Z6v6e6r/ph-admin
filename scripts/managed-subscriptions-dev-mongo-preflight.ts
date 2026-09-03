import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MongoClient } from 'mongodb';
import {
  SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION,
  assertSubscriptionInstanceDevCanaryReplicaSetTopology,
  subscriptionInstanceDevCanaryFixtureSentinel,
  subscriptionInstanceDevCanaryTarget
} from './managed-subscriptions-instance-projector-dev-canary';

export class SubscriptionsDevMongoPreflightError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'SubscriptionsDevMongoPreflightError'; }
}
const fail = (code: string): never => { throw new SubscriptionsDevMongoPreflightError(code); };

export function subscriptionsDevMongoTarget(env: NodeJS.ProcessEnv = process.env) {
  const target = subscriptionInstanceDevCanaryTarget(env);
  let uri: URL;
  try { uri = new URL(target.uri); } catch { return fail('SUBSCRIPTIONS_DEV_MONGO_URI_INVALID'); }
  const queryEntries = [...uri.searchParams.entries()];
  const replicaOptions = queryEntries.filter(([key]) => key.toLowerCase() === 'replicaset');
  if (queryEntries.length !== 1 || replicaOptions.length !== 1 || replicaOptions[0][1] !== 'rs0') {
    fail('SUBSCRIPTIONS_DEV_MONGO_REPLICA_URI_REQUIRED');
  }
  return target;
}

export function inspectSubscriptionsDevMongoCustody(
  env: NodeJS.ProcessEnv,
  input: {
    hello: Record<string, unknown>;
    replicaSetConfig: Record<string, unknown>;
    sentinel: unknown;
  }
) {
  const target = subscriptionsDevMongoTarget(env);
  try {
    assertSubscriptionInstanceDevCanaryReplicaSetTopology(input.hello, input.replicaSetConfig);
  } catch {
    fail('SUBSCRIPTIONS_DEV_MONGO_TOPOLOGY_FORBIDDEN');
  }
  const expectedSentinel = subscriptionInstanceDevCanaryFixtureSentinel(env, target);
  if (!isDeepStrictEqual(input.sentinel, expectedSentinel)) {
    fail('SUBSCRIPTIONS_DEV_MONGO_SENTINEL_MISMATCH');
  }
  return Object.freeze({
    status: 'CUSTODY_VERIFIED',
    targetSha256: target.targetSha256,
    database: target.database,
    replicaSet: 'rs0',
    memberCount: 1,
    sentinelVerified: true,
    write: false
  });
}

export function planSubscriptionsDevSentinelInstall(
  env: NodeJS.ProcessEnv,
  current: unknown
) {
  const target = subscriptionsDevMongoTarget(env);
  const expected = subscriptionInstanceDevCanaryFixtureSentinel(env, target);
  if (current !== null && !isDeepStrictEqual(current, expected)) {
    fail('SUBSCRIPTIONS_DEV_MONGO_SENTINEL_IMMUTABLE_CONFLICT');
  }
  return Object.freeze({
    schema: 'ph-admin-subscriptions-dev-sentinel-plan-v1',
    action: current === null ? 'INSERT_ONCE' : 'EXACT_REPLAY',
    collection: SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION,
    targetSha256: target.targetSha256,
    database: target.database,
    documentSha256: createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    execute: false,
    writeAuthorized: false
  });
}

export async function checkSubscriptionsDevMongoCustody(
  env: NodeJS.ProcessEnv = process.env,
  MongoClientCtor: typeof MongoClient = MongoClient
) {
  const target = subscriptionsDevMongoTarget(env);
  const client = new MongoClientCtor(target.uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
  try {
    await client.connect();
    const db = client.db(target.database);
    return inspectSubscriptionsDevMongoCustody(env, {
      hello: await db.admin().command({ hello: 1 }),
      replicaSetConfig: await db.admin().command({ replSetGetConfig: 1 }),
      sentinel: await db.collection<any>(SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION)
        .findOne({ _id: 'subscription_instance_dev_canary_fixture_sentinel:v1' })
    });
  } finally { await client.close().catch(() => undefined); }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === '--target-fingerprint') {
    const target = subscriptionsDevMongoTarget();
    console.log(JSON.stringify({ status: 'TARGET_VERIFIED', targetSha256: target.targetSha256, write: false }));
  } else if (mode === '--check') {
    console.log(JSON.stringify(await checkSubscriptionsDevMongoCustody()));
  } else {
    fail('SUBSCRIPTIONS_DEV_MONGO_PREFLIGHT_MODE_INVALID');
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : 'SUBSCRIPTIONS_DEV_MONGO_PREFLIGHT_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
