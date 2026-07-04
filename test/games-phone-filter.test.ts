import * as assert from 'node:assert/strict';
import { GamesService } from '../src/games/games.service';
import { GameStatus } from '../src/games/games.types';

async function main() {
  const lkPadelHubClient = {
    async listGames() {
      return [
        {
          id: 'game-1',
          source: 'LK_PADELHUB' as const,
          name: 'Матч 1',
          status: GameStatus.ACTIVE,
          createdAt: '2026-06-18T10:00:00.000Z',
          organizerName: 'Alice',
          participantNames: ['Alice', 'Bob'],
          participantDetails: [
            { name: 'Alice', phone: '+7 (999) 111-22-33' },
            { name: 'Bob', phone: '+7 (999) 000-00-00' }
          ]
        },
        {
          id: 'game-2',
          source: 'LK_PADELHUB' as const,
          name: 'Матч 2',
          status: GameStatus.ACTIVE,
          createdAt: '2026-06-19T10:00:00.000Z',
          organizerName: 'Carol',
          participantNames: ['Carol', 'Dave'],
          participantDetails: [
            { name: 'Carol', phone: '+7 (999) 444-55-66' },
            { name: 'Dave', phone: '+7 (999) 777-88-99' }
          ]
        }
      ];
    },
    async getGameById() {
      return null;
    }
  };

  const service = new GamesService(lkPadelHubClient as never);

  const filtered = await service.findAll({
    phone: '8 (999) 111-22-33',
    page: 1,
    pageSize: 15,
    sortField: 'createdAt',
    sortDirection: 'desc'
  });

  assert.equal(filtered.total, 1);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.id, 'game-1');

  const partial = await service.findAll({
    phone: '4445566',
    page: 1,
    pageSize: 15,
    sortField: 'createdAt',
    sortDirection: 'desc'
  });

  assert.equal(partial.total, 1);
  assert.equal(partial.items[0]?.id, 'game-2');

  console.log('Games phone filter test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
