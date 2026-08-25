import { MongoClient } from 'mongodb';

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const uri = String(process.env.REFERRAL_LINKS_MONGODB_URI || process.env.SUBSCRIPTIONS_MONGODB_URI || process.env.MONGODB_URI || '').trim();
const dbName = String(process.env.REFERRAL_LINKS_MONGODB_DB || process.env.SUBSCRIPTIONS_MONGODB_DB || process.env.MONGODB_DB || '').trim();
const linksCollection = String(process.env.REFERRAL_LINKS_COLLECTION || 'subscription_referral_links').trim();
const eventsCollection = String(process.env.REFERRAL_LINK_EVENTS_COLLECTION || 'subscription_referral_link_events').trim();
const salesCollection = String(process.env.REFERRAL_LINK_SALES_COLLECTION || 'lk_tournament_subscription_sales').trim();

const plan = [
  [linksCollection, { linkId: 1 }, { name: 'referral_link_id_unique', unique: true }],
  [linksCollection, { publicToken: 1 }, { name: 'referral_link_public_token_unique', unique: true }],
  [linksCollection, { legacyAttributionKey: 1 }, { name: 'referral_link_legacy_key_unique', unique: true, sparse: true }],
  [linksCollection, { 'idempotency.actorId': 1, 'idempotency.key': 1 }, { name: 'referral_link_idempotency_unique', unique: true, sparse: true }],
  [linksCollection, { status: 1, validFrom: 1, validTo: 1 }, { name: 'referral_link_status_period' }],
  [eventsCollection, { eventId: 1 }, { name: 'referral_link_event_id_unique', unique: true }],
  [eventsCollection, { linkId: 1, occurredAt: 1 }, { name: 'referral_link_event_time' }],
  [eventsCollection, { linkId: 1, visitId: 1, kind: 1 }, { name: 'referral_link_event_visit_kind' }],
  [eventsCollection, { linkId: 1, dayKey: 1, kind: 1 }, { name: 'referral_link_event_daily' }],
  [salesCollection, { referralLinkId: 1, createdAt: 1 }, { name: 'referral_sale_link_created' }],
  [salesCollection, { referralLinkId: 1, paidAt: 1 }, { name: 'referral_sale_link_paid' }],
  [salesCollection, { referralToken: 1, createdAt: 1 }, { name: 'referral_sale_token_created' }],
  [salesCollection, { referralToken: 1, paidAt: 1 }, { name: 'referral_sale_token_paid' }],
  [salesCollection, { trainerQrCode: 1, createdAt: 1 }, { name: 'referral_sale_legacy_created' }],
  [salesCollection, { trainerQrCode: 1, paidAt: 1 }, { name: 'referral_sale_legacy_paid' }]
];

if (!uri || !dbName) {
  console.error('REFERRAL_LINKS_MONGODB_URI (or fallback) and REFERRAL_LINKS_MONGODB_DB are required');
  process.exit(2);
}
if (mode === 'apply' && process.env.REFERRAL_LINK_INDEX_APPLY !== 'CONFIRM') {
  console.error('Refusing index mutation: set REFERRAL_LINK_INDEX_APPLY=CONFIRM');
  process.exit(3);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
try {
  await client.connect();
  const db = client.db(dbName);
  if (mode === 'apply') {
    for (const [collectionName, keys, options] of plan.filter(([, , item]) => item.unique === true)) {
      const matchFields = Object.keys(keys).map((field) => ({ [field]: { $exists: true } }));
      const duplicate = await db.collection(collectionName).aggregate([
        ...(options.sparse ? [{ $match: { $or: matchFields } }] : []),
        { $group: { _id: Object.fromEntries(Object.keys(keys).map((field) => [field.replace(/\./g, '_'), `$${field}`])), count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 }
      ]).hasNext();
      if (duplicate) throw new Error(`DUPLICATE_PRECHECK_FAILED:${collectionName}:${options.name}`);
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
        || Boolean(item.sparse) !== Boolean(options.sparse);
    }).map(([, , options]) => options.name);
    mismatches += missing.length;
    console.log(JSON.stringify({ collection: collectionName, missing }));
  }
  if (mismatches) process.exitCode = 1;
  else console.log(`managed referral links indexes: ${mode} OK`);
} finally {
  await client.close().catch(() => undefined);
}
