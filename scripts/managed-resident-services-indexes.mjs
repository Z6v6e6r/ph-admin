import { MongoClient } from 'mongodb';

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const uri = String(
  process.env.RESIDENT_SERVICES_MONGODB_URI
    || process.env.SUBSCRIPTIONS_MONGODB_URI
    || process.env.MONGODB_URI
    || ''
).trim();
const dbName = String(
  process.env.RESIDENT_SERVICES_MONGODB_DB
    || process.env.SUBSCRIPTIONS_MONGODB_DB
    || process.env.MONGODB_DB
    || ''
).trim();
const collections = {
  passes: String(process.env.RESIDENT_SERVICES_PASSES_COLLECTION || 'cup_resident_passes').trim(),
  benefitRules: String(
    process.env.RESIDENT_SERVICES_BENEFIT_RULES_COLLECTION || 'cup_resident_benefit_rules'
  ).trim(),
  usage: String(process.env.RESIDENT_SERVICES_USAGE_COLLECTION || 'cup_resident_service_usage').trim(),
  issuances: String(
    process.env.RESIDENT_SERVICES_ISSUANCES_COLLECTION || 'cup_resident_service_issuances'
  ).trim(),
  returns: String(
    process.env.RESIDENT_SERVICES_RETURNS_COLLECTION || 'cup_resident_service_returns'
  ).trim(),
  journal: String(
    process.env.RESIDENT_SERVICES_JOURNAL_COLLECTION || 'cup_resident_service_journal'
  ).trim()
};

const plan = [
  [collections.passes, { passId: 1 }, { name: 'resident_pass_id_unique', unique: true }],
  [collections.passes, { tokenHash: 1 }, { name: 'resident_pass_token_unique', unique: true }],
  [
    collections.passes,
    { tenantId: 1, subscriptionInstanceId: 1, state: 1, expiresAt: 1 },
    { name: 'resident_pass_instance_state' }
  ],
  [
    collections.passes,
    { expiresAtDate: 1 },
    { name: 'resident_pass_expires_ttl', expireAfterSeconds: 86400 }
  ],
  [
    collections.benefitRules,
    { ruleId: 1 },
    { name: 'resident_benefit_rule_id_unique', unique: true }
  ],
  [
    collections.benefitRules,
    { tenantId: 1, subscriptionTypeId: 1, serviceKind: 1, stationScopeKey: 1 },
    { name: 'resident_benefit_rule_scope_unique', unique: true }
  ],
  [
    collections.benefitRules,
    { tenantId: 1, 'idempotency.actorId': 1, 'idempotency.keyHash': 1 },
    {
      name: 'resident_benefit_rule_idempotency_unique',
      unique: true,
      partialFilterExpression: { 'idempotency.keyHash': { $exists: true } }
    }
  ],
  [
    collections.benefitRules,
    { tenantId: 1, subscriptionTypeId: 1, serviceKind: 1, enabled: 1, updatedAt: -1 },
    { name: 'resident_benefit_rule_type' }
  ],
  [
    collections.usage,
    { tenantId: 1, clientRefHash: 1, serviceKind: 1, limitPeriod: 1, periodKey: 1 },
    { name: 'resident_service_usage_unique', unique: true }
  ],
  [
    collections.usage,
    { tenantId: 1, clientRefHash: 1, updatedAt: -1 },
    { name: 'resident_service_usage_client' }
  ],
  [
    collections.issuances,
    { issuanceId: 1 },
    { name: 'resident_issuance_id_unique', unique: true }
  ],
  [
    collections.issuances,
    { tenantId: 1, 'idempotency.keyHash': 1 },
    { name: 'resident_issuance_idempotency_unique', unique: true }
  ],
  [
    collections.issuances,
    { tenantId: 1, stationId: 1, issuedAt: -1, issuanceId: 1 },
    { name: 'resident_issuance_station' }
  ],
  [
    collections.issuances,
    { tenantId: 1, clientRefHash: 1, issuedAt: -1 },
    { name: 'resident_issuance_client' }
  ],
  [
    collections.returns,
    { returnId: 1 },
    { name: 'resident_return_id_unique', unique: true }
  ],
  [
    collections.returns,
    { tenantId: 1, 'idempotency.keyHash': 1 },
    { name: 'resident_return_idempotency_unique', unique: true }
  ],
  [
    collections.returns,
    { tenantId: 1, issuanceId: 1, returnedAt: -1 },
    { name: 'resident_return_issuance' }
  ],
  [
    collections.journal,
    { eventId: 1 },
    { name: 'resident_journal_event_unique', unique: true }
  ],
  [
    collections.journal,
    { tenantId: 1, occurredAt: -1, eventId: -1 },
    { name: 'resident_journal_tenant_time' }
  ],
  [
    collections.journal,
    { tenantId: 1, stationId: 1, occurredAt: -1, eventId: -1 },
    { name: 'resident_journal_station_time' }
  ],
  [
    collections.journal,
    { tenantId: 1, issuanceId: 1, occurredAt: -1 },
    { name: 'resident_journal_issuance' }
  ]
];

if (!uri || !dbName) {
  console.error(
    'RESIDENT_SERVICES_MONGODB_URI (or SUBSCRIPTIONS_MONGODB_URI/MONGODB_URI) and RESIDENT_SERVICES_MONGODB_DB (or SUBSCRIPTIONS_MONGODB_DB/MONGODB_DB) are required'
  );
  process.exit(2);
}
if (mode === 'apply' && process.env.RESIDENT_SERVICES_INDEX_APPLY !== 'CONFIRM') {
  console.error('Refusing index mutation: set RESIDENT_SERVICES_INDEX_APPLY=CONFIRM');
  process.exit(3);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
try {
  await client.connect();
  const db = client.db(dbName);
  if (mode === 'apply') {
    for (const [collectionName, keys, options] of plan.filter(([, , item]) => item.unique === true)) {
      const matchFields = Object.keys(keys).map((field) => ({ [field]: { $exists: true } }));
      const groupId = Object.fromEntries(
        Object.keys(keys).map((field) => [field.replace(/\./g, '_'), '$' + field])
      );
      const duplicate = await db.collection(collectionName).aggregate([
        ...(options.sparse ? [{ $match: { $or: matchFields } }] : []),
        { $group: { _id: groupId, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 }
      ]).hasNext();
      if (duplicate) throw new Error('DUPLICATE_PRECHECK_FAILED:' + collectionName + ':' + options.name);
    }
    for (const [collectionName, keys, options] of plan) {
      await db.collection(collectionName).createIndex(keys, options);
    }
  }

  let mismatches = 0;
  for (const collectionName of [...new Set(plan.map(([name]) => name))]) {
    const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
    const actual = exists ? await db.collection(collectionName).listIndexes().toArray() : [];
    const expected = plan.filter(([name]) => name === collectionName);
    const missing = expected.filter(([, key, options]) => {
      const item = actual.find((index) => index.name === options.name);
      return !item
        || JSON.stringify(item.key) !== JSON.stringify(key)
        || Boolean(item.unique) !== Boolean(options.unique)
        || Boolean(item.sparse) !== Boolean(options.sparse)
        || JSON.stringify(item.partialFilterExpression ?? null)
          !== JSON.stringify(options.partialFilterExpression ?? null)
        || (item.expireAfterSeconds ?? null) !== (options.expireAfterSeconds ?? null);
    }).map(([, , options]) => options.name);
    mismatches += missing.length;
    console.log(JSON.stringify({ collection: collectionName, missing }));
  }
  if (mismatches) process.exitCode = 1;
  else console.log('managed resident services indexes: ' + mode + ' OK');
} finally {
  await client.close().catch(() => undefined);
}