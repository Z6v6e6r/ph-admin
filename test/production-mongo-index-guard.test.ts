import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Collection, Document } from 'mongodb';
import {
  ensureMongoIndex,
  isMongoIndexReadinessError,
  isProductionRuntime
} from '../src/common/mongo-index.guard';
import { VivaTournamentSnapshotService } from '../src/integrations/viva/viva-tournament-snapshot.service';
import { ReferralLinksRepository } from '../src/referral-links/referral-links.repository';

function collectionDouble(input: {
  existing?: Document[];
  listError?: Error;
} = {}): {
  collection: Collection<Document>;
  createCalls: number;
  listCalls: number;
} {
  const state = { createCalls: 0, listCalls: 0 };
  const collection = {
    collectionName: 'guard_test',
    createIndex: async () => {
      state.createCalls += 1;
      return 'created_index';
    },
    listIndexes: () => ({
      toArray: async () => {
        state.listCalls += 1;
        if (input.listError) throw input.listError;
        return input.existing ?? [];
      }
    })
  } as unknown as Collection<Document>;
  return {
    collection,
    get createCalls() { return state.createCalls; },
    get listCalls() { return state.listCalls; }
  };
}

async function main(): Promise<void> {
  assert.equal(isProductionRuntime({ NODE_ENV: ' production ' }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: 'PRODUCTION' }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: 'test' }), false);
  assert.equal(isProductionRuntime({}), false);
  assert.equal(isMongoIndexReadinessError(new Error('MONGO_INDEX_NOT_READY:x:y')), true);
  assert.equal(isMongoIndexReadinessError(new Error('MONGO_INDEX_READINESS_CHECK_FAILED:x:y:z')), true);
  assert.equal(isMongoIndexReadinessError(new Error('other')), false);

  const development = collectionDouble();
  assert.equal(
    await ensureMongoIndex(
      development.collection,
      { id: 1 },
      { unique: true, name: 'id_1' },
      { NODE_ENV: 'development' }
    ),
    'created_index'
  );
  assert.equal(development.createCalls, 1);
  assert.equal(development.listCalls, 0);

  const productionReady = collectionDouble({
    existing: [{ name: 'id_1', key: { id: 1 }, unique: true }]
  });
  assert.equal(
    await ensureMongoIndex(
      productionReady.collection,
      { id: 1 },
      { unique: true, name: 'id_1' },
      { NODE_ENV: 'production' }
    ),
    'id_1'
  );
  assert.equal(productionReady.createCalls, 0);
  assert.equal(productionReady.listCalls, 1);

  const productionAutoNamed = collectionDouble({
    existing: [{ name: 'id_1', key: { id: 1 }, unique: true }]
  });
  assert.equal(
    await ensureMongoIndex(
      productionAutoNamed.collection,
      { id: 1 },
      { unique: true, name: 'managed_id_unique' },
      { NODE_ENV: 'production' }
    ),
    'id_1'
  );
  assert.equal(productionAutoNamed.createCalls, 0);

  const productionMismatched = collectionDouble({
    existing: [{ name: 'id_1', key: { id: 1 }, unique: false }]
  });
  await assert.rejects(
    ensureMongoIndex(
      productionMismatched.collection,
      { id: 1 },
      { unique: true, name: 'id_1' },
      { NODE_ENV: 'production' }
    ),
    /MONGO_INDEX_NOT_READY:guard_test:id_1/
  );
  assert.equal(productionMismatched.createCalls, 0);

  const productionMissing = collectionDouble();
  await assert.rejects(
    ensureMongoIndex(
      productionMissing.collection,
      { id: 1 },
      { unique: true, name: 'id_1' },
      { NODE_ENV: 'production' }
    ),
    /MONGO_INDEX_NOT_READY:guard_test:id_1/
  );
  assert.equal(productionMissing.createCalls, 0);

  const productionUnreadable = collectionDouble({ listError: new Error('private details') });
  try {
    await ensureMongoIndex(
      productionUnreadable.collection,
      { id: 1 },
      { unique: true, name: 'id_1' },
      { NODE_ENV: 'production' }
    );
    assert.fail('production readiness failure must reject');
  } catch (error) {
    assert.match(String(error), /MONGO_INDEX_READINESS_CHECK_FAILED:guard_test:id_1:Error/);
    assert.doesNotMatch(String(error), /private details/);
  }
  assert.equal(productionUnreadable.createCalls, 0);

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const referralRepository = new ReferralLinksRepository();
    const expectedReferralIndexes = [
      { name: 'referral_id_uq', key: { id: 1 }, unique: true }
    ];
    await assert.rejects(
      (referralRepository as any).verifyCollectionIndexes(
        {
          collectionName: 'referral_records',
          indexes: async () => []
        },
        expectedReferralIndexes
      ),
      /MONGO_INDEX_NOT_READY:referral_records:referral_id_uq/
    );
    await assert.rejects(
      (referralRepository as any).verifyCollectionIndexes(
        {
          collectionName: 'referral_records',
          indexes: async () => { throw new Error('private details'); }
        },
        expectedReferralIndexes
      ),
      /MONGO_INDEX_READINESS_CHECK_FAILED:referral_records:required_manifest:Error/
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  const snapshotEnvKeys = [
    'NODE_ENV',
    'VIVA_TOURNAMENT_SNAPSHOT_ENABLED',
    'VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL',
    'VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED',
    'VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI'
  ] as const;
  const previousSnapshotEnv = Object.fromEntries(
    snapshotEnvKeys.map((key) => [key, process.env[key]])
  );
  try {
    process.env.NODE_ENV = ' PRODUCTION ';
    process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'false';
    process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'false';
    process.env.VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED = 'true';
    process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI = 'mongodb://fixture.invalid';
    const snapshotService = new VivaTournamentSnapshotService({} as any);
    let preflightCalls = 0;
    (snapshotService as any).collection = async () => {
      preflightCalls += 1;
      return {};
    };
    await snapshotService.onModuleInit();
    assert.equal(
      preflightCalls,
      1,
      'public-revalidation-only production mode must run the Mongo index preflight'
    );
    await snapshotService.onModuleDestroy();
  } finally {
    for (const key of snapshotEnvKeys) {
      const value = previousSnapshotEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const sourceRoot = path.resolve(__dirname, '../src');
  const guardPath = path.join(sourceRoot, 'common/mongo-index.guard.ts');
  const offenders: string[] = [];
  let guardedCalls = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && fullPath !== guardPath) {
        const contents = fs.readFileSync(fullPath, 'utf8');
        guardedCalls += contents.match(/ensureMongoIndex\s*\(/g)?.length ?? 0;
        if (/\.createIndex(?:es)?\s*\(/.test(contents) || /\bcreateIndexes\s*:/.test(contents)) {
          offenders.push(path.relative(sourceRoot, fullPath));
        }
      }
    }
  };
  visit(sourceRoot);
  assert.deepEqual(
    offenders,
    [],
    `Production Mongo index guard bypassed by: ${offenders.join(', ')}`
  );
  assert.equal(guardedCalls, 79, 'all existing runtime Mongo index requests stay guarded');

  const referralSource = fs.readFileSync(
    path.join(sourceRoot, 'referral-links/referral-links.repository.ts'),
    'utf8'
  );
  assert.match(
    referralSource,
    /REFERRAL_LINKS_AUTO_CREATE_INDEXES,[\s\S]*?!isProductionRuntime\(\)/,
    'referral production verification must use the normalized production detector'
  );

  const readinessRethrowFiles: Record<string, number> = {
    'advertising/advertising.service.ts': 1,
    'auth/auth-persistence.service.ts': 1,
    'integrations/viva/viva-admin.service.ts': 1,
    'integrations/viva/viva-reference-cache.service.ts': 3,
    'integrations/viva/viva-tournament-snapshot.service.ts': 6,
    'messenger/messenger-persistence.service.ts': 1,
    'quick-replies/quick-replies-persistence.service.ts': 1,
    'referral-links/referral-links.repository.ts': 1,
    'support/support-persistence.service.ts': 1,
    'tournaments/tournaments-persistence.service.ts': 1,
    'web-push/web-push-persistence.service.ts': 1
  };
  for (const [relativePath, expectedRethrows] of Object.entries(readinessRethrowFiles)) {
    const contents = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
    const actualRethrows = contents.match(
      /if \(isMongoIndexReadinessError\(error\)\) throw error;/g
    )?.length ?? 0;
    assert.equal(
      actualRethrows,
      expectedRethrows,
      `${relativePath} must not downgrade a production index readiness failure`
    );
  }

  const playerRatingsRepository = fs.readFileSync(
    path.join(sourceRoot, 'player-ratings/player-ratings.repository.ts'),
    'utf8'
  );
  assert.match(
    playerRatingsRepository,
    /await this\.ensureIndexes\(db\);[\s\S]*?this\.client = client;[\s\S]*?this\.db = db;/,
    'player ratings must not publish Mongo state before index readiness succeeds'
  );
  assert.match(
    playerRatingsRepository,
    /catch \(error\) \{[\s\S]*?this\.client = undefined;[\s\S]*?this\.db = undefined;[\s\S]*?await client\.close\(\)[\s\S]*?throw error;/,
    'player ratings must clear Mongo state after an index readiness failure'
  );

  console.log('Production Mongo index guard test passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
