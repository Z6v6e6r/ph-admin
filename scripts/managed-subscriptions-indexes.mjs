import { MongoClient } from 'mongodb';

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const uri = String(process.env.SUBSCRIPTIONS_MONGODB_URI || process.env.MONGODB_URI || '').trim();
const dbName = String(process.env.SUBSCRIPTIONS_MONGODB_DB || '').trim();
const includeTestRuntimeIndexes = ['1', 'true', 'yes'].includes(
  String(process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED || '').trim().toLowerCase()
);
const includeRuntimeContractIndexes = ['1', 'true', 'yes'].includes(
  String(process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED || '').trim().toLowerCase()
);

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
  ['subscription_release_programs', { subscriptionTypeId: 1, stationId: 1, state: 1 }, { name: 'subscription_release_type_station_state' }],
  ...(includeRuntimeContractIndexes ? [
    ['subscription_provider_mappings', { mappingId: 1 }, { unique: true, name: 'subscription_mapping_id_unique' }],
    ['subscription_provider_mappings', { tenantId: 1, provider: 1, providerProductId: 1, 'providerScope.kind': 1, 'providerScope.scopeId': 1 }, { unique: true, name: 'subscription_mapping_provider_scope_unique' }],
    ['subscription_provider_mappings', { tenantId: 1, 'idempotency.actorId': 1, 'idempotency.key': 1 }, { unique: true, name: 'subscription_mapping_idempotency_unique' }],
    ['subscription_provider_mappings', { subscriptionTypeId: 1, state: 1, updatedAt: -1 }, { name: 'subscription_mapping_type_state' }],
    ['subscription_policy_publications', { publicationId: 1 }, { unique: true, name: 'subscription_publication_id_unique' }],
    ['subscription_policy_publications', { subscriptionTypeId: 1, policyVersion: 1 }, { unique: true, name: 'subscription_publication_policy_version_unique' }],
    ['subscription_policy_publications', { subscriptionTypeId: 1, state: 1, effectiveAt: -1 }, { name: 'subscription_publication_runtime_lookup' }],
    ['subscription_policy_publications', { policyDigest: 1, publicationId: 1 }, { name: 'subscription_publication_digest' }],
    ['subscription_instances', { subscriptionInstanceId: 1 }, { unique: true, name: 'subscription_instance_id_unique' }],
    ['subscription_instances', { tenantId: 1, providerClientId: 1, clientSubscriptionId: 1 }, { unique: true, name: 'subscription_instance_provider_identity_unique' }],
    ['subscription_instances', { subscriptionTypeId: 1, state: 1, activeTo: 1, subscriptionInstanceId: 1 }, { name: 'subscription_instance_type_state_expiry' }],
    ['subscription_instances', { homeStationId: 1, state: 1, updatedAt: -1 }, { name: 'subscription_instance_station_state' }],
    ['subscription_instances', { clientRefHash: 1, state: 1, updatedAt: -1 }, { name: 'subscription_instance_client_state' }],
    ['subscription_entitlement_aggregates', { subscriptionInstanceId: 1 }, { unique: true, name: 'subscription_entitlement_aggregate_instance_unique' }],
    ['subscription_entitlement_aggregates', { 'reconciliation.state': 1, updatedAt: 1, subscriptionInstanceId: 1 }, { name: 'subscription_entitlement_aggregate_reconciliation' }],
    ['subscription_operations', { operationId: 1 }, { unique: true, name: 'subscription_operation_id_unique' }],
    ['subscription_operations', { tenantId: 1, 'actor.actorId': 1, kind: 1, 'idempotency.keyHash': 1 }, { unique: true, name: 'subscription_operation_idempotency_unique' }],
    ['subscription_operations', { subscriptionInstanceId: 1, createdAt: -1, operationId: 1 }, { name: 'subscription_operation_instance_time' }],
    ['subscription_operations', { state: 1, nextAttemptAt: 1, updatedAt: 1, operationId: 1 }, { name: 'subscription_operation_reconciliation' }],
    ['subscription_usage_ledger', { eventId: 1 }, { unique: true, name: 'subscription_usage_event_id_unique' }],
    ['subscription_usage_ledger', { subscriptionInstanceId: 1, occurredAt: 1, eventId: 1 }, { name: 'subscription_usage_instance_time' }],
    ['subscription_usage_ledger', { correlationId: 1, occurredAt: 1, eventId: 1 }, { name: 'subscription_usage_correlation_time' }],
    ['subscription_usage_ledger', { eventType: 1, occurredAt: 1, eventId: 1 }, { name: 'subscription_usage_type_time' }],
    ['subscription_outbox', { outboxEventId: 1 }, { unique: true, name: 'subscription_outbox_event_id_unique' }],
    ['subscription_outbox', { ledgerEventId: 1 }, { unique: true, name: 'subscription_outbox_ledger_event_unique' }],
    ['subscription_outbox', { status: 1, nextAttemptAt: 1, createdAt: 1, outboxEventId: 1 }, { name: 'subscription_outbox_delivery' }]
  ] : []),
  ...(includeTestRuntimeIndexes ? [
    ['subscription_test_offers', { offerId: 1 }, { unique: true, name: 'subscription_test_offer_id_unique' }],
    ['subscription_test_offers', { accessTokenHash: 1 }, { unique: true, name: 'subscription_test_offer_token_unique' }],
    ['subscription_test_offers', { 'idempotency.actorId': 1, 'idempotency.key': 1 }, { unique: true, name: 'subscription_test_offer_idempotency_unique' }],
    ['subscription_test_offers', { releaseProgramId: 1, policyVersion: 1 }, { unique: true, name: 'subscription_test_offer_program_policy_unique' }],
    ['subscription_test_offers', { stationId: 1, state: 1, updatedAt: -1 }, { name: 'subscription_test_offer_station_list' }],
    ['subscription_test_inventories', { offerId: 1 }, { unique: true, name: 'subscription_test_inventory_offer_unique' }],
    ['subscription_test_reservations', { reservationId: 1 }, { unique: true, name: 'subscription_test_reservation_id_unique' }],
    ['subscription_test_reservations', { purchaseId: 1 }, { unique: true, name: 'subscription_test_reservation_purchase_unique' }],
    ['subscription_test_reservations', { offerId: 1, status: 1, expiresAt: 1 }, { name: 'subscription_test_reservation_expiry' }],
    ['subscription_test_purchases', { purchaseId: 1 }, { unique: true, name: 'subscription_test_purchase_id_unique' }],
    ['subscription_test_purchases', { offerId: 1, 'idempotency.keyHash': 1 }, { unique: true, name: 'subscription_test_purchase_idempotency_unique' }],
    ['subscription_test_purchases', { offerId: 1, clientRefHash: 1, status: 1 }, { name: 'subscription_test_purchase_client_status' }],
    ['subscription_test_purchases', { offerId: 1, status: 1, expiresAt: 1 }, { name: 'subscription_test_purchase_expiry' }],
    ['subscription_test_purchases', { offerId: 1, inventoryFinalizedAt: 1, updatedAt: 1, purchaseId: 1, status: 1 }, { name: 'subscription_test_purchase_reconciliation' }],
    ['subscription_test_events', { eventId: 1 }, { unique: true, name: 'subscription_test_event_id_unique' }],
    ['subscription_test_events', { offerId: 1, occurredAt: 1 }, { name: 'subscription_test_event_offer_time' }],
    ['subscription_test_events', { purchaseId: 1, occurredAt: 1 }, { name: 'subscription_test_event_purchase_time' }]
  ] : [])
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
