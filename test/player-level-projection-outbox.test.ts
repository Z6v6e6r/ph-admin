import * as assert from 'node:assert/strict';
import { PlayerRatingRepository } from '../src/player-ratings/player-ratings.repository';
import {
  PadlHubPlayerLevelProjectionOutboxDocument,
  PlayerRatingActor
} from '../src/player-ratings/player-ratings.types';

const document: PadlHubPlayerLevelProjectionOutboxDocument = {
  playerKey: 'player:1',
  desiredRevision: 4,
  deliveredRevision: 2,
  desired: {
    schemaVersion: 1,
    sourceEventId: 'rating_evt:00000000-0000-4000-8000-000000000004',
    sourceRevision: 4,
    occurredAt: '2026-08-19T10:00:00.000Z',
    player: { externalClientId: 'viva-client-1' },
    sportCode: 'PADEL',
    level: { code: 'C+', numericValue: 3.63 },
    source: { eventType: 'RATING_MANUALLY_CHANGED', formulaVersion: 'padel-rating-grade-v1' }
  },
  status: 'PENDING',
  attempts: 0,
  maxAttempts: 20,
  nextAttemptAt: '2026-08-19T10:00:00.000Z',
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-19T10:00:00.000Z'
};

async function main(): Promise<void> {
  const updateCalls: any[] = [];
  const findAndUpdateCalls: any[] = [];
  const collection = {
    updateOne: async (...args: any[]) => {
      updateCalls.push(args);
      return { modifiedCount: 1 };
    },
    findOneAndUpdate: async (...args: any[]) => {
      findAndUpdateCalls.push(args);
      return document;
    }
  };
  const repository = new PlayerRatingRepository();
  (repository as any).db = { collection: () => collection };

  await (repository as any).upsertPadlHubProjection(document);
  const upsertPipeline = updateCalls.at(-1)?.[1];
  assert.match(
    JSON.stringify(upsertPipeline),
    /"desiredRevision".*"\$gt":\[4,\{"\$ifNull":\["\$desiredRevision",-1\]\}\]/,
    'a stale reconcile snapshot cannot replace a newer desired revision'
  );
  assert.match(JSON.stringify(upsertPipeline), /"attempts".*"\$gt".*0/);

  await repository.failPadlHubProjection({
    playerKey: document.playerKey,
    leaseOwner: 'worker-1',
    revision: 3,
    now: '2026-08-19T10:01:00.000Z',
    nextAttemptAt: '2026-08-19T10:02:00.000Z',
    errorCode: 'PADLHUB_LEVEL_PROJECTION_HTTP_503'
  });
  const failurePipeline = updateCalls.at(-1)?.[1];
  assert.match(
    JSON.stringify(failurePipeline),
    /"\$gt":\["\$desiredRevision",3\].*"PENDING"/,
    'failure of an older lease returns the newer desired snapshot to pending'
  );

  const actor: PlayerRatingActor = { id: 'admin-1', name: 'Admin', type: 'ADMIN' };
  await repository.retryPadlHubProjection(document.playerKey, actor);
  const retryCall = findAndUpdateCalls.at(-1);
  assert.deepEqual(retryCall?.[0]?.status?.$in, ['DEAD', 'FAILED_RETRYABLE']);
  assert.equal(retryCall?.[1]?.$set?.attempts, 0);
  assert.equal(retryCall?.[1]?.$set?.status, 'PENDING');
  assert.deepEqual(retryCall?.[1]?.$set?.lastManualRetryBy, actor);

  const previousEnabled = process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED;
  try {
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = 'false';
    const disabledIndexes: unknown[] = [];
    const disabledRepository = new PlayerRatingRepository();
    (disabledRepository as any).db = {
      collection: () => ({
        createIndex: async (...args: unknown[]) => {
          disabledIndexes.push(args);
          return 'index';
        }
      })
    };
    await (disabledRepository as any).ensureIndexes();
    assert.equal(disabledIndexes.length, 7, 'disabled worker creates no PadlHub outbox indexes');

    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = 'true';
    const enabledIndexes: unknown[] = [];
    const enabledRepository = new PlayerRatingRepository();
    (enabledRepository as any).db = {
      collection: () => ({
        createIndex: async (...args: unknown[]) => {
          enabledIndexes.push(args);
          return 'index';
        }
      })
    };
    await (enabledRepository as any).ensureIndexes();
    assert.equal(enabledIndexes.length, 9, 'enabled worker creates exactly two PadlHub indexes');
  } finally {
    if (previousEnabled === undefined) delete process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED;
    else process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = previousEnabled;
  }

  console.log('Player level projection outbox test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
