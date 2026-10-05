import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  inspectSubscriptionsDevMongoCustody, planSubscriptionsDevSentinelInstall,
  subscriptionsDevMongoTarget
} from '../scripts/managed-subscriptions-dev-mongo-preflight';
import { runSubscriptionsDevIndexes } from '../scripts/managed-subscriptions-dev-indexes';
import { subscriptionInstanceDevCanaryFixtureSentinel } from '../scripts/managed-subscriptions-instance-projector-dev-canary';

const env = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_ID: 'test-subscription-fixture',
  SUBSCRIPTIONS_MONGODB_URI: 'mongodb://127.0.0.1:27030/?replicaSet=rs0',
  SUBSCRIPTIONS_MONGODB_DB: 'test-subscription-fixture',
  SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false',
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ID: 'fixture:test:subscription-fixture',
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_NONCE_SHA256: 'sha256:' + 'a'.repeat(64)
});
const topology = () => ({
  hello: { isWritablePrimary: true, setName: 'rs0', hosts: ['127.0.0.1:27030'] },
  replicaSetConfig: { config: { members: [{ host: '127.0.0.1:27030' }] } }
});
const code = (expected: string) => (error: any) => error?.code === expected;

test('validates exact loopback rs0 custody and builds inert sentinel plan', () => {
  const configured = env();
  const target = subscriptionsDevMongoTarget(configured);
  const sentinel = subscriptionInstanceDevCanaryFixtureSentinel(configured, target);
  const result = inspectSubscriptionsDevMongoCustody(configured, { ...topology(), sentinel });
  assert.equal(result.write, false);
  assert.equal(result.sentinelVerified, true);
  const plan = planSubscriptionsDevSentinelInstall(configured, null);
  assert.equal(plan.action, 'INSERT_ONCE');
  assert.equal(plan.execute, false);
  assert.equal(plan.writeAuthorized, false);
  assert.equal(plan.documentSha256, createHash('sha256').update(JSON.stringify(sentinel)).digest('hex'));
  assert.equal(planSubscriptionsDevSentinelInstall(configured, sentinel).action, 'EXACT_REPLAY');
});

test('rejects wrong DB, direct connection, standalone, non-loopback member and sentinel drift', () => {
  assert.throws(() => subscriptionsDevMongoTarget({
    ...env(), SUBSCRIPTIONS_MONGODB_DB: 'phab_subscriptions_dev'
  }));
  assert.throws(() => subscriptionsDevMongoTarget({
    ...env(), SUBSCRIPTIONS_MONGODB_URI: 'mongodb://127.0.0.1:27030/?replicaSet=rs0&directConnection=true'
  }), code('SUBSCRIPTIONS_DEV_MONGO_REPLICA_URI_REQUIRED'));
  assert.throws(() => subscriptionsDevMongoTarget({
    ...env(), SUBSCRIPTIONS_MONGODB_URI: 'mongodb://127.0.0.1:27030/?replicaSet=rs0&REPLICASET=rs0'
  }), code('SUBSCRIPTIONS_DEV_MONGO_REPLICA_URI_REQUIRED'));
  const configured = env();
  const sentinel = subscriptionInstanceDevCanaryFixtureSentinel(configured, subscriptionsDevMongoTarget(configured));
  assert.throws(() => inspectSubscriptionsDevMongoCustody(configured, {
    ...topology(), hello: { isWritablePrimary: true }, sentinel
  }), code('SUBSCRIPTIONS_DEV_MONGO_TOPOLOGY_FORBIDDEN'));
  const outside = topology();
  outside.hello.hosts = ['outside.invalid:27030'];
  assert.throws(() => inspectSubscriptionsDevMongoCustody(configured, { ...outside, sentinel }),
    code('SUBSCRIPTIONS_DEV_MONGO_TOPOLOGY_FORBIDDEN'));
  assert.throws(() => inspectSubscriptionsDevMongoCustody(configured, { ...topology(), sentinel: null }),
    code('SUBSCRIPTIONS_DEV_MONGO_SENTINEL_MISMATCH'));
  assert.throws(() => planSubscriptionsDevSentinelInstall(configured, { ...sentinel, nonceSha256: 'drift' }),
    code('SUBSCRIPTIONS_DEV_MONGO_SENTINEL_IMMUTABLE_CONFLICT'));
});

test('DEV index wrapper never invokes index process before custody and exact target attestation', async () => {
  const configured = env();
  const target = subscriptionsDevMongoTarget(configured);
  const custody = {
    status: 'CUSTODY_VERIFIED', targetSha256: target.targetSha256, database: target.database,
    replicaSet: 'rs0', memberCount: 1, sentinelVerified: true, write: false
  };
  let runs = 0;
  const runner = (_mode: '--check' | '--apply', childEnv: NodeJS.ProcessEnv) => {
    runs += 1;
    assert.equal(childEnv.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED, 'true');
    assert.equal(childEnv.SUBSCRIPTIONS_AUTO_CREATE_INDEXES, 'false');
    return 0;
  };
  await assert.rejects(() => runSubscriptionsDevIndexes('--check', configured,
    async () => custody as any, runner), code('SUBSCRIPTIONS_DEV_INDEX_TARGET_ATTESTATION_MISMATCH'));
  assert.equal(runs, 0);
  const pinned = {
    ...configured, SUBSCRIPTIONS_INDEX_EXPECTED_DB: target.database,
    SUBSCRIPTIONS_INDEX_TARGET_SHA256: target.targetSha256
  };
  assert.equal(await runSubscriptionsDevIndexes('--check', pinned, async () => custody as any, runner), 0);
  assert.equal(runs, 1);
  await assert.rejects(() => runSubscriptionsDevIndexes('--check', pinned,
    async () => ({ ...custody, sentinelVerified: false }) as any, runner),
  code('SUBSCRIPTIONS_DEV_INDEX_TARGET_ATTESTATION_MISMATCH'));
  assert.equal(runs, 1);
  await assert.rejects(() => runSubscriptionsDevIndexes('--apply', pinned,
    async () => custody as any, runner), code('SUBSCRIPTIONS_DEV_INDEX_APPLY_CONFIRM_REQUIRED'));
  assert.equal(runs, 1);
});
