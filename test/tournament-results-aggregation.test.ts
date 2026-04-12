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
          tournamentId: 'tournament-1',
          startsAt: '2026-04-18T10:00:00.000Z',
          stationName: 'TestMiniApp',
          courtName: 'Корт 1',
          participantNames: ['Alice', 'Bob', 'Carol', 'Dave'],
          teamParticipantLines: ['Команда A', 'Alice', 'Bob', 'Команда B', 'Carol', 'Dave'],
          result: '6:4 6:3',
          resultLines: ['6:4', '6:3'],
          ratingDelta: '+10 / -10 (4 чел.)',
          ratingDeltaLines: [
            'Alice: 100 -> 105 (+5)',
            'Bob: 100 -> 105 (+5)',
            'Carol: 100 -> 95 (-5)',
            'Dave: 100 -> 95 (-5)'
          ]
        },
        {
          id: 'game-2',
          source: 'LK_PADELHUB' as const,
          name: 'Матч 2',
          status: GameStatus.ACTIVE,
          tournamentId: 'tournament-1',
          startsAt: '2026-04-18T11:00:00.000Z',
          stationName: 'TestMiniApp',
          courtName: 'Корт 2',
          participantNames: ['Alice', 'Carol', 'Bob', 'Dave'],
          teamParticipantLines: ['Команда A', 'Alice', 'Carol', 'Команда B', 'Bob', 'Dave'],
          result: '4:6 3:6',
          resultLines: ['4:6', '3:6'],
          ratingDelta: '+6 / -6 (4 чел.)',
          ratingDeltaLines: [
            'Alice: 105 -> 102 (-3)',
            'Carol: 95 -> 92 (-3)',
            'Bob: 105 -> 108 (+3)',
            'Dave: 95 -> 98 (+3)'
          ]
        },
        {
          id: 'game-other',
          source: 'LK_PADELHUB' as const,
          name: 'Чужой матч',
          status: GameStatus.ACTIVE,
          tournamentId: 'other-tournament',
          startsAt: '2026-04-18T12:00:00.000Z',
          participantNames: ['Other A', 'Other B'],
          resultLines: ['6:0']
        }
      ];
    },
    async getGameById() {
      return null;
    }
  };

  const service = new GamesService(lkPadelHubClient as never);
  const result = await service.getTournamentResults('tournament-1');

  assert.equal(result.tournamentId, 'tournament-1');
  assert.equal(result.summary.totalGames, 2);
  assert.equal(result.summary.gamesWithResult, 2);
  assert.equal(result.summary.uniquePlayers, 4);
  assert.equal(result.games.length, 2);
  assert.equal(result.matches.length, 2);
  assert.equal(result.standings.length, 4);

  const standingsByPlayer = new Map(
    result.standings.map((entry) => [entry.player, entry])
  );

  assert.deepEqual(standingsByPlayer.get('Alice'), {
    player: 'Alice',
    playedGames: 2,
    wins: 1,
    losses: 1,
    totalDelta: 2
  });
  assert.deepEqual(standingsByPlayer.get('Bob'), {
    player: 'Bob',
    playedGames: 2,
    wins: 2,
    losses: 0,
    totalDelta: 8
  });
  assert.deepEqual(standingsByPlayer.get('Carol'), {
    player: 'Carol',
    playedGames: 2,
    wins: 0,
    losses: 2,
    totalDelta: -8
  });
  assert.deepEqual(standingsByPlayer.get('Dave'), {
    player: 'Dave',
    playedGames: 2,
    wins: 1,
    losses: 1,
    totalDelta: -2
  });

  assert.equal(result.matches[0].teams.length, 2);
  assert.equal(result.matches[0].teams[0].players.join(', '), 'Alice, Bob');
  assert.equal(result.matches[1].resultLines.join(' / '), '4:6 / 3:6');

  console.log('Tournament results aggregation test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
