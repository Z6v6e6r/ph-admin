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
          tournamentId: 'tournament-tiebreak',
          startsAt: '2026-04-18T10:00:00.000Z',
          participantNames: ['Alice', 'Ira', 'Bob', 'Nina'],
          teamParticipantLines: ['Команда A', 'Alice', 'Ira', 'Команда B', 'Bob', 'Nina'],
          resultLines: ['10:8'],
          ratingDeltaLines: [
            'Alice: 100 -> 99 (-1)',
            'Ira: 100 -> 101 (+1)',
            'Bob: 100 -> 101 (+1)',
            'Nina: 100 -> 99 (-1)'
          ]
        },
        {
          id: 'game-2',
          source: 'LK_PADELHUB' as const,
          name: 'Матч 2',
          status: GameStatus.ACTIVE,
          tournamentId: 'tournament-tiebreak',
          startsAt: '2026-04-18T11:00:00.000Z',
          participantNames: ['Bob', 'Oleg', 'Pavel', 'Roma'],
          teamParticipantLines: ['Команда A', 'Bob', 'Oleg', 'Команда B', 'Pavel', 'Roma'],
          resultLines: ['10:8'],
          ratingDeltaLines: [
            'Bob: 101 -> 111 (+10)',
            'Oleg: 100 -> 103 (+3)',
            'Pavel: 100 -> 95 (-5)',
            'Roma: 100 -> 92 (-8)'
          ]
        },
        {
          id: 'game-3',
          source: 'LK_PADELHUB' as const,
          name: 'Матч 3',
          status: GameStatus.ACTIVE,
          tournamentId: 'tournament-tiebreak',
          startsAt: '2026-04-18T12:00:00.000Z',
          participantNames: ['Alice', 'Sasha', 'Tanya', 'Vera'],
          teamParticipantLines: ['Команда A', 'Alice', 'Sasha', 'Команда B', 'Tanya', 'Vera'],
          resultLines: ['8:10'],
          ratingDeltaLines: [
            'Alice: 99 -> 89 (-10)',
            'Sasha: 100 -> 97 (-3)',
            'Tanya: 100 -> 105 (+5)',
            'Vera: 100 -> 108 (+8)'
          ]
        }
      ];
    },
    async getGameById() {
      return null;
    }
  };

  const service = new GamesService(lkPadelHubClient as never);
  const result = await service.getTournamentResults('tournament-tiebreak');

  const standingsByPlayer = new Map(result.standings.map((entry) => [entry.player, entry]));
  const alice = standingsByPlayer.get('Alice');
  const bob = standingsByPlayer.get('Bob');

  assert(alice, 'Alice standing must exist');
  assert(bob, 'Bob standing must exist');
  assert.equal(alice.playedGames, 2);
  assert.equal(bob.playedGames, 2);
  assert.equal(alice.scoredPoints, bob.scoredPoints);
  assert.equal(alice.pointsDiff, bob.pointsDiff);
  assert.equal(alice.wins, bob.wins);
  assert(bob.totalDelta > alice.totalDelta, 'Bob must have a bigger rating delta in fixture');

  const order = result.standings.map((entry) => entry.player);
  const aliceIndex = order.indexOf('Alice');
  const bobIndex = order.indexOf('Bob');

  assert(aliceIndex >= 0 && bobIndex >= 0, 'Alice and Bob must be present in standings order');
  assert(
    aliceIndex < bobIndex,
    'Alice should be above Bob by head-to-head despite equal points/diff/wins and lower rating delta'
  );

  console.log('Tournament results tiebreakers test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
