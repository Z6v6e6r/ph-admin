import * as assert from 'node:assert/strict';
import { GamesService } from '../src/games/games.service';
import { Game, GameStatus } from '../src/games/games.types';

function game(overrides: Partial<Game> & Pick<Game, 'id'>): Game {
  const { id, ...rest } = overrides;
  return {
    id,
    source: 'LK_PADELHUB',
    name: overrides.name ?? id,
    status: overrides.status ?? GameStatus.ACTIVE,
    rawStatus: overrides.rawStatus ?? 'ACTIVE',
    createdAt: overrides.createdAt ?? '2026-08-01T10:00:00.000Z',
    participantNames: overrides.participantNames ?? [],
    participantDetails: overrides.participantDetails ?? [],
    ...rest
  };
}

async function main() {
  const games: Game[] = [
    game({
      id: 'public-new',
      name: 'Открытая игра новая',
      isPrivate: false,
      stationName: 'Сколково',
      gameDate: '2099-08-05',
      gameTime: '21:00-23:00',
      createdAt: '2026-08-02T10:00:00.000Z'
    }),
    game({
      id: 'public-old',
      name: 'Открытая игра старая',
      isPrivate: false,
      stationName: 'Сколково',
      gameDate: '2099-08-06',
      gameTime: '21:00-23:00',
      createdAt: '2026-08-01T10:00:00.000Z'
    }),
    game({
      id: 'community',
      communityPublished: true,
      isPrivate: true,
      stationName: 'Лужники',
      createdAt: '2026-07-31T10:00:00.000Z'
    }),
    game({
      id: 'hidden-past',
      isPrivate: true,
      gameDate: '2020-01-01',
      gameTime: '10:00-11:30',
      createdAt: '2026-07-30T10:00:00.000Z'
    })
  ];

  const service = new GamesService({
    async listGames() {
      return games;
    },
    async getGameById() {
      return null;
    }
  } as never);

  const firstPage = await service.findAll({
    publication: 'public',
    quickFilter: 'upcoming',
    page: 1,
    pageSize: 1,
    sortField: 'createdAt',
    sortDirection: 'desc'
  });
  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.totalPages, 2);
  assert.equal(firstPage.items[0]?.id, 'public-new');

  const secondPage = await service.findAll({
    publication: 'public',
    quickFilter: 'upcoming',
    page: 2,
    pageSize: 1,
    sortField: 'createdAt',
    sortDirection: 'desc'
  });
  assert.equal(secondPage.total, 2);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.items[0]?.id, 'public-old');

  const community = await service.findAll({ publication: 'community', page: 1, pageSize: 15 });
  assert.deepEqual(community.items.map((item) => item.id), ['community']);

  const stationAndQuery = await service.findAll({
    station: 'Сколково',
    query: 'старая',
    page: 1,
    pageSize: 15
  });
  assert.deepEqual(stationAndQuery.items.map((item) => item.id), ['public-old']);

  const noResult = await service.findAll({ quickFilter: 'noResult', page: 1, pageSize: 15 });
  assert.deepEqual(noResult.items.map((item) => item.id), ['hidden-past']);

  console.log('Games list filters pagination test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
