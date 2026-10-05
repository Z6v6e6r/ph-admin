import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { AuthService } from '../src/auth/auth.service';
import { ensureMongoIndex } from '../src/common/mongo-index.guard';
import { Role } from '../src/common/rbac/role.enum';
import { MessengerPersistenceService } from '../src/messenger/messenger-persistence.service';
import { MessengerService } from '../src/messenger/messenger.service';
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

    const authDbName = `${dbName}_auth`;
    const authDb = client.db(authDbName);
    const previousAuthEnvironment = {
      NODE_ENV: process.env.NODE_ENV,
      ADMIN_AUTH_ENABLED: process.env.ADMIN_AUTH_ENABLED,
      ADMIN_AUTH_SECRET: process.env.ADMIN_AUTH_SECRET,
      ADMIN_AUTH_USERS_JSON: process.env.ADMIN_AUTH_USERS_JSON,
      QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED,
      TELEGRAM_STATION_MAPPINGS: process.env.TELEGRAM_STATION_MAPPINGS,
      MONGODB_DB: process.env.MONGODB_DB
    };
    try {
      await authDb.collection('admin_roles').insertOne({
        id: Role.SUPER_ADMIN,
        name: 'Fixture superadmin',
        permissions: ['*'],
        stationIds: [],
        isSystem: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      });
      await authDb.collection('admin_users').insertOne({
        id: 'fixture-admin',
        login: 'fixture_admin',
        password: 'not-used',
        roles: [Role.SUPER_ADMIN],
        roleIds: [Role.SUPER_ADMIN],
        stationIds: [],
        connectorRoutes: [],
        active: true
      });

      process.env.NODE_ENV = ' PRODUCTION ';
      process.env.ADMIN_AUTH_ENABLED = 'true';
      process.env.ADMIN_AUTH_SECRET = 'production-startup-write-guard-secret';
      delete process.env.ADMIN_AUTH_USERS_JSON;
      delete process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED;
      delete process.env.TELEGRAM_STATION_MAPPINGS;
      process.env.MONGODB_DB = authDbName;

      const persistence = new AuthPersistenceService();
      (persistence as unknown as { db: unknown }).db = authDb;
      const authService = new AuthService(persistence);
      commands.length = 0;

      await authService.onModuleInit();
      await authService.listAdminUsers();
      await authService.listAdminRoles();

      assert.ok(commands.includes('find'));
      assert.deepEqual(
        commands.filter((name) => ['insert', 'update', 'delete', 'findAndModify', 'bulkWrite'].includes(name)),
        [],
        'production auth bootstrap and refresh paths must issue no Mongo write command'
      );
      await assert.rejects(
        persistence.seedUsers([{
          id: 'forbidden-seed',
          login: 'forbidden_seed',
          password: 'not-used',
          roles: [Role.SUPER_ADMIN],
          roleIds: [Role.SUPER_ADMIN],
          stationIds: [],
          connectorRoutes: [],
          active: true
        }]),
        /AUTH_PRODUCTION_BOOTSTRAP_WRITE_FORBIDDEN:seedUsers/
      );
      await assert.rejects(
        persistence.seedRoles([{
          id: 'forbidden-role',
          name: 'Forbidden role',
          permissions: [],
          stationIds: [],
          isSystem: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }]),
        /AUTH_PRODUCTION_BOOTSTRAP_WRITE_FORBIDDEN:seedRoles/
      );
      assert.deepEqual(
        commands.filter((name) => ['insert', 'update', 'delete', 'findAndModify', 'bulkWrite'].includes(name)),
        []
      );

      const messengerPersistence = new MessengerPersistenceService();
      (messengerPersistence as unknown as { db: unknown }).db = authDb;
      const messenger = new MessengerService({} as never, {} as never, messengerPersistence);
      commands.length = 0;
      await messenger.onModuleInit();
      await messenger.onApplicationBootstrap();
      messenger.onModuleDestroy();
      assert.ok(commands.includes('find'));
      assert.deepEqual(
        commands.filter((name) => ['insert', 'update', 'delete', 'findAndModify', 'bulkWrite'].includes(name)),
        [],
        'production messenger bootstrap must hydrate without persisting defaults'
      );
    } finally {
      for (const [key, value] of Object.entries(previousAuthEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await authDb.dropDatabase().catch(() => undefined);
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
