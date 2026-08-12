import { MongoClient } from 'mongodb';

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const uri = String(process.env.SUBSCRIPTIONS_MONGODB_URI || process.env.MONGODB_URI || '').trim();
const dbName = String(process.env.SUBSCRIPTIONS_MONGODB_DB || '').trim();

const plan = [
  ['subscription_types', { subscriptionTypeId: 1 }, { unique: true, name: 'subscription_type_id_unique' }],
  ['subscription_types', { codeNorm: 1 }, { unique: true, name: 'subscription_type_code_norm_unique' }],
  ['subscription_types', { 'idempotency.actorId': 1, 'idempotency.key': 1 }, { unique: true, name: 'subscription_type_idempotency_unique' }],
  ['subscription_types', { state: 1, updatedAt: -1, subscriptionTypeId: 1 }, { name: 'subscription_type_list' }],
  ['subscription_policy_versions', { subscriptionTypeId: 1, version: 1 }, { unique: true, name: 'subscription_policy_version_unique' }],
  ['subscription_policy_versions', { 'idempotency.actorId': 1, 'idempotency.key': 1 }, { unique: true, name: 'subscription_policy_idempotency_unique' }],
  ['subscription_policy_versions', { subscriptionTypeId: 1, status: 1, version: -1 }, { name: 'subscription_policy_list' }],
  ['subscription_release_programs', { releaseProgramId: 1 }, { unique: true, name: 'subscription_release_program_id_unique' }],
  ['subscription_release_programs', { 'idempotency.actorId': 1, 'idempotency.key': 1 }, { unique: true, name: 'subscription_release_idempotency_unique' }],
  ['subscription_release_programs', { stationId: 1, state: 1, updatedAt: -1, releaseProgramId: 1 }, { name: 'subscription_release_station_list' }],
  ['subscription_release_programs', { subscriptionTypeId: 1, stationId: 1, state: 1 }, { name: 'subscription_release_type_station_state' }]
];

if (!uri || !dbName) {
  console.error('SUBSCRIPTIONS_MONGODB_URI (or MONGODB_URI) and SUBSCRIPTIONS_MONGODB_DB are required');
  process.exit(2);
}
if (mode === 'apply' && process.env.SUBSCRIPTIONS_INDEX_APPLY !== 'CONFIRM') {
  console.error('Refusing index mutation: set SUBSCRIPTIONS_INDEX_APPLY=CONFIRM');
  process.exit(3);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
try {
  await client.connect();
  const db = client.db(dbName);
  if (mode === 'apply') {
    for (const [collectionName, keys, options] of plan.filter(([, , item]) => item.unique === true)) {
      const groupId = Object.fromEntries(
        Object.keys(keys).map((field, index) => [`field${index + 1}`, `$${field}`])
      );
      const duplicate = await db.collection(collectionName).aggregate([
        { $group: { _id: groupId, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 }
      ]).hasNext();
      if (duplicate) {
        throw new Error(`DUPLICATE_PRECHECK_FAILED:${collectionName}:${options.name}`);
      }
    }
  }
  const byCollection = new Map();
  for (const [collectionName, keys, options] of plan) {
    if (mode === 'apply') await db.collection(collectionName).createIndex(keys, options);
    if (!byCollection.has(collectionName)) byCollection.set(collectionName, []);
    byCollection.get(collectionName).push(options.name);
  }
  let missingCount = 0;
  for (const [collectionName, expectedNames] of byCollection) {
    const collection = db.collection(collectionName);
    const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
    const actualIndexes = exists ? await collection.listIndexes().toArray() : [];
    const expected = plan
      .filter(([plannedCollection]) => plannedCollection === collectionName)
      .map(([, keys, options]) => ({ name: options.name, key: keys, unique: options.unique === true }));
    const missing = expected
      .filter((spec) => {
        const actual = actualIndexes.find((item) => item.name === spec.name);
        return !actual
          || JSON.stringify(actual.key) !== JSON.stringify(spec.key)
          || Boolean(actual.unique) !== spec.unique;
      })
      .map((spec) => spec.name);
    missingCount += missing.length;
    console.log(JSON.stringify({ collection: collectionName, expected: expectedNames, missing }));
  }
  if (missingCount) process.exitCode = 1;
  else console.log(`managed subscription indexes: ${mode} OK`);
} finally {
  await client.close().catch(() => undefined);
}
