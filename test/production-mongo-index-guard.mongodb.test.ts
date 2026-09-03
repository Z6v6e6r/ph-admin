import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ensureMongoIndex } from '../src/common/mongo-index.guard';
import { PlayerRatingRepository } from '../src/player-ratings/player-ratings.repository';

const uri = String(process.env.PRODUCTION_MONGO_INDEX_GUARD_TEST_URI ?? '').trim();
if (!uri) {
  throw new Error(
    'PRODUCTION_MONGO_INDEX_GUARD_TEST_URI is required for the Mongo integration test'
  );
}

async function main(): Promise<void> {
  const client = new MongoClient(uri, { monitorCommands: true });
  const dbName = `phab_index_guard_${process.pid}_${Date.now()}`;
  await client.connect();
  try {
    const collection = client.db(dbName).collection('records');
    await collection.insertOne({ id: 'fixture' });
    await collection.createIndex({ id: 1 }, { unique: true, name: 'id_unique' });

    const commands: string[] = [];
    client.on('commandStarted', (event) => commands.push(event.commandName));

    assert.equal(
      await ensureMongoIndex(
        collection,
        { id: 1 },
        { unique: true, name: 'id_unique' },
        { NODE_ENV: 'production' }
      ),
      'id_unique'
    );
    assert.ok(commands.includes('listIndexes'));
    assert.equal(commands.includes('createIndexes'), false);

    commands.length = 0;
    await assert.rejects(
      ensureMongoIndex(
        collection,
        { missing: 1 },
        { name: 'missing_1' },
        { NODE_ENV: 'production' }
      ),
      /MONGO_INDEX_NOT_READY:records:missing_1/
    );
    assert.ok(commands.includes('listIndexes'));
    assert.equal(commands.includes('createIndexes'), false);

    commands.length = 0;
    assert.equal(
      await ensureMongoIndex(
        collection,
        { developmentOnly: 1 },
        { name: 'developmentOnly_1' },
        { NODE_ENV: 'test' }
      ),
      'developmentOnly_1'
    );
    assert.ok(commands.includes('createIndexes'));

    const previousNodeEnv = process.env.NODE_ENV;
    const previousRatingsUri = process.env.PLAYER_RATINGS_MONGODB_URI;
    const previousRatingsDb = process.env.PLAYER_RATINGS_MONGODB_DB;
    const ratingsDbName = `${dbName}_ratings_missing`;
    try {
      process.env.NODE_ENV = 'production';
      process.env.PLAYER_RATINGS_MONGODB_URI = uri;
      process.env.PLAYER_RATINGS_MONGODB_DB = ratingsDbName;
      const repository = new PlayerRatingRepository();
      const internal = repository as unknown as { client?: unknown; db?: unknown };

      const concurrentAttempts = await Promise.allSettled([
        repository.connect(),
        repository.connect()
      ]);
      assert.deepEqual(
        concurrentAttempts.map((attempt) => attempt.status),
        ['rejected', 'rejected']
      );
      for (const attempt of concurrentAttempts) {
        assert.equal(attempt.status, 'rejected');
        assert.match(
          String(attempt.reason),
          /MONGO_INDEX_READINESS_CHECK_FAILED:(player_rating_state|rating_events|rating_projection_outbox):[^:]+:MongoServerError/
        );
      }
      assert.equal(internal.client, undefined);
      assert.equal(internal.db, undefined);

      await assert.rejects(
        repository.connect(),
        /MONGO_INDEX_READINESS_CHECK_FAILED:(player_rating_state|rating_events|rating_projection_outbox):[^:]+:MongoServerError/
      );
      assert.equal(internal.client, undefined);
      assert.equal(internal.db, undefined);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRatingsUri === undefined) delete process.env.PLAYER_RATINGS_MONGODB_URI;
      else process.env.PLAYER_RATINGS_MONGODB_URI = previousRatingsUri;
      if (previousRatingsDb === undefined) delete process.env.PLAYER_RATINGS_MONGODB_DB;
      else process.env.PLAYER_RATINGS_MONGODB_DB = previousRatingsDb;
      await client.db(ratingsDbName).dropDatabase().catch(() => undefined);
    }
  } finally {
    await client.db(dbName).dropDatabase().catch(() => undefined);
    await client.close();
  }

  console.log('Production Mongo index guard integration test passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
