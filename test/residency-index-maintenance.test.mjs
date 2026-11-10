import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { credentialFreeMongoTarget } from '../scripts/managed-subscriptions-backup-core.mjs';

test('residency-only maintenance creates exactly its two indexes, rejects wrong target and is replay-safe', async () => {
  const uri = process.env.RESIDENCY_TEST_MONGO_URI;
  assert.match(uri || '', /^mongodb:\/\/127\.0\.0\.1:\d+\//, 'explicit local test replica set required');
  const dbName = 'residency_index_test_' + process.pid + '_' + Date.now();
  const client = new MongoClient(uri); await client.connect(); const db = client.db(dbName);
  const env = { ...process.env, NODE_ENV: 'test', SUBSCRIPTIONS_MONGODB_URI: uri, SUBSCRIPTIONS_MONGODB_DB: dbName,
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'false', SUBSCRIPTIONS_TEST_RUNTIME_ENABLED: 'false',
    SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED: 'false', SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED: 'false',
    SUBSCRIPTIONS_INDEX_APPLY: 'CONFIRM', SUBSCRIPTIONS_INDEX_EXPECTED_DB: dbName,
    SUBSCRIPTIONS_INDEX_TARGET_SHA256: credentialFreeMongoTarget(uri, dbName).targetSha256 };
  const run = (args, extra = {}) => spawnSync(process.execPath, ['scripts/managed-subscriptions-indexes.mjs', ...args, '--residency-only'],
    { env: { ...env, ...extra }, encoding: 'utf8' });
  try {
    assert.equal(run(['--check']).status, 1); assert.equal(await db.listCollections().hasNext(), false);
    assert.notEqual(run(['--apply'], { SUBSCRIPTIONS_INDEX_TARGET_SHA256: '0'.repeat(64) }).status, 0);
    assert.equal(await db.listCollections().hasNext(), false);
    let result = run(['--apply']); assert.equal(result.status, 0, result.stderr);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    assert.deepEqual(collections.map(c => c.name), ['subscription_residency_provider_observations']);
    const indexes = await db.collection(collections[0].name).listIndexes().toArray();
    assert.equal(indexes.length, 3); assert.equal(indexes.filter(i => i.unique).length, 2);
    assert.equal(run(['--check']).status, 0);
    result = run(['--apply']); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await db.collection(collections[0].name).listIndexes().toArray(), indexes);
  } finally { await db.dropDatabase(); await client.close(); }
});
