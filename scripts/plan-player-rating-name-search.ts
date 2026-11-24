import { Collection, Document, MongoClient, UpdateOneModel } from 'mongodb';
import { normalizePlayerName } from '../src/player-ratings/player-ratings.types';

const collectionName = 'player_rating_state';
const ownership = 'CUP_CANONICAL';

export function planNameSearchUpdate(row: Document): {
  kind: 'missing' | 'invalid' | 'stale';
  operation: UpdateOneModel<Document>;
} | { kind: 'unchanged' | 'unusableName' } {
  const nameSearch = typeof row.name === 'string' ? normalizePlayerName(row.name) : '';
  if (!nameSearch) return { kind: 'unusableName' };
  if (row.nameSearch === nameSearch) return { kind: 'unchanged' };

  const missing = row.nameSearch === undefined;
  const sameName = { $eq: ['$name', { $literal: row.name }] };
  const snapshotFields = missing
    ? { nameSearch: { $exists: false }, $expr: sameName }
    : {
        $expr: {
          $and: [sameName, { $eq: ['$nameSearch', { $literal: row.nameSearch }] }]
        }
      };
  const kind = missing ? 'missing' : typeof row.nameSearch === 'string' && row.nameSearch.trim() ? 'stale' : 'invalid';
  return {
    kind,
    operation: {
      filter: { _id: row._id, ownership, ...snapshotFields },
      update: { $set: { nameSearch } },
      collation: { locale: 'simple' }
    }
  };
}

export async function dryRunNameSearch(collection: Collection<Document>) {
  const counts = { scanned: 0, wouldUpdate: 0, missing: 0, invalid: 0, stale: 0, unchanged: 0, unusableName: 0 };
  const rows = collection.find({ ownership }, { projection: { _id: 1, name: 1, nameSearch: 1 }, maxTimeMS: 15000 });
  try {
    for await (const row of rows) {
      const plan = planNameSearchUpdate(row);
      counts.scanned++;
      counts[plan.kind]++;
      if ('operation' in plan) counts.wouldUpdate++;
    }
  } finally {
    await rows.close();
  }
  return { mode: 'dry-run', collection: collectionName, ...counts };
}

async function main() {
  const usage = 'Usage: PLAYER_RATINGS_DRY_RUN_URI=<read-only Mongo URI> PLAYER_RATINGS_DRY_RUN_DB=<db> npx --no-install ts-node scripts/plan-player-rating-name-search.ts';
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const uri = process.env.PLAYER_RATINGS_DRY_RUN_URI;
  const db = process.env.PLAYER_RATINGS_DRY_RUN_DB;
  if (args.length || !uri || !db?.trim()) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, readConcern: { level: 'majority' } });
  try {
    const report = await dryRunNameSearch(client.db(db).collection(collectionName));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Player rating nameSearch dry-run failed. Verify the connection, database name and read permission.');
    process.exitCode = 1;
  });
}
