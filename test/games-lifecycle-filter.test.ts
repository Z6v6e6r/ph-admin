import * as assert from 'node:assert/strict';
import { GamesService } from '../src/games/games.service';
import { Game, GameStatus } from '../src/games/games.types';

const games: Game[] = [
  {
    id: 'active',
    source: 'LK_PADELHUB',
    name: 'Active game',
    status: GameStatus.ACTIVE,
    rawStatus: 'ACTIVE'
  },
  {
    id: 'draft',
    source: 'LK_PADELHUB',
    name: 'Draft game',
    status: GameStatus.DRAFT,
    rawStatus: 'PAYMENT_PENDING'
  },
  {
    id: 'cancelled-archived',
    source: 'LK_PADELHUB',
    name: 'Cancelled archived game',
    status: GameStatus.CANCELLED,
    rawStatus: 'CANCELLED',
    archived: true
  },
  {
    id: 'canceled-legacy',
    source: 'LK_PADELHUB',
    name: 'Legacy canceled game',
    status: GameStatus.ARCHIVED,
    rawStatus: 'CANCELED',
    archived: true
  },
  {
    id: 'manually-archived',
    source: 'LK_PADELHUB',
    name: 'Manually archived game',
    status: GameStatus.ARCHIVED,
    rawStatus: 'ARCHIVED',
    archived: true
  }
];

async function main() {
  const lkPadelHubClient = {
    async listGames() {
      return games;
    },
    async getGameById() {
      return null;
    }
  };
  const service = new GamesService(lkPadelHubClient as never);

  const legacy = await service.findAll({ pageSize: 100 });
  assert.deepEqual(
    legacy.items.map((game) => game.id).sort(),
    games.map((game) => game.id).sort(),
    'omitting lifecycle must preserve the existing in-memory list contract'
  );

  const active = await service.findAll({ lifecycle: 'active', pageSize: 100 });
  assert.deepEqual(active.items.map((game) => game.id).sort(), ['active', 'draft']);

  const cancelled = await service.findAll({ lifecycle: 'cancelled', pageSize: 100 });
  assert.deepEqual(cancelled.items.map((game) => game.id).sort(), [
    'canceled-legacy',
    'cancelled-archived'
  ]);

  const all = await service.findAll({ lifecycle: 'all', pageSize: 100 });
  assert.deepEqual(all.items.map((game) => game.id).sort(), [
    'active',
    'canceled-legacy',
    'cancelled-archived',
    'draft'
  ]);

  const internals = service as unknown as {
    normalizeMongoStatus(rawStatus: string | null, archived: unknown): GameStatus;
    buildMongoLifecycleFilter(lifecycle?: 'active' | 'cancelled' | 'all'): Record<string, any>;
  };

  assert.equal(
    internals.normalizeMongoStatus('CANCELLED', true),
    GameStatus.CANCELLED,
    'cancellation must win over the historical archived flag'
  );
  assert.equal(internals.normalizeMongoStatus('CANCELED', false), GameStatus.CANCELLED);
  assert.equal(internals.normalizeMongoStatus('ARCHIVED', true), GameStatus.ARCHIVED);

  const cancelledMongoFilter = internals.buildMongoLifecycleFilter('cancelled');
  assert.equal(cancelledMongoFilter.archived, undefined);
  assert.equal(cancelledMongoFilter.status.$regex.test('CANCELLED'), true);
  assert.equal(cancelledMongoFilter.status.$regex.test('CANCELED'), true);

  const activeMongoFilter = internals.buildMongoLifecycleFilter('active');
  assert.deepEqual(activeMongoFilter.archived, { $ne: true });
  assert.equal(activeMongoFilter.$nor[0].status.$regex.test('CANCELLED'), true);

  const allMongoFilter = internals.buildMongoLifecycleFilter('all');
  assert.deepEqual(allMongoFilter.$or[0], { archived: { $ne: true } });
  assert.equal(allMongoFilter.$or[1].status.$regex.test('CANCELED'), true);

  console.log('Games lifecycle filter test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
