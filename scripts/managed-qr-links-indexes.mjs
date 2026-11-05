import { MongoClient } from 'mongodb';

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const uri = String(
  process.env.QR_LINKS_MONGODB_URI || process.env.MONGODB_URI || ''
).trim();
const dbName = String(
  process.env.QR_LINKS_MONGODB_DB || process.env.MONGODB_DB || ''
).trim();
const linksCollection = String(process.env.QR_LINKS_COLLECTION || 'cup_qr_links').trim();
const dailyStatsCollection = String(
  process.env.QR_LINKS_DAILY_STATS_COLLECTION || 'cup_qr_daily_stats'
).trim();
const settingsCollection = String(
  process.env.QR_LINKS_SETTINGS_COLLECTION || 'cup_qr_settings'
).trim();

const plan = [
  [linksCollection, { id: 1 }, { name: 'qr_link_id_unique', unique: true }],
  [linksCollection, { code: 1 }, { name: 'qr_link_code_unique', unique: true }],
  [
    linksCollection,
    { 'idempotency.actorId': 1, 'idempotency.key': 1 },
    { name: 'qr_link_idempotency_unique', unique: true, sparse: true }
  ],
  [linksCollection, { status: 1, createdAt: -1 }, { name: 'qr_link_status_created' }],
  [
    linksCollection,
    { stationId: 1, status: 1, createdAt: -1 },
    { name: 'qr_link_station_status_created' }
  ],
  [linksCollection, { updatedAt: -1 }, { name: 'qr_link_updated_at' }],
  [dailyStatsCollection, { qrId: 1, dateKey: 1 }, { name: 'qr_daily_unique', unique: true }],
  [dailyStatsCollection, { dateKey: 1 }, { name: 'qr_daily_date' }],
  [settingsCollection, { key: 1 }, { name: 'qr_settings_key_unique', unique: true }]
];

if (!uri || !dbName) {
  console.error('QR_LINKS_MONGODB_URI (or MONGODB_URI) and QR_LINKS_MONGODB_DB (or MONGODB_DB) are required');
  process.exit(2);
}
if (mode === 'apply' && process.env.QR_LINKS_INDEX_APPLY !== 'CONFIRM') {
  console.error('Refusing index mutation: set QR_LINKS_INDEX_APPLY=CONFIRM');
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
        Object.keys(keys).map((field) => [field.replace(/\./g, '_'), `$${field}`])
      );
      const duplicate = await db.collection(collectionName).aggregate([
        ...(options.sparse ? [{ $match: { $or: matchFields } }] : []),
        { $group: { _id: groupId, count: { $sum: 1 } } },
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
  else console.log(`managed QR links indexes: ${mode} OK`);
} finally {
  await client.close().catch(() => undefined);
}
