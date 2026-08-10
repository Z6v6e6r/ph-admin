import * as assert from 'node:assert/strict';
import { normalizeStoredTournamentStandings } from '../src/tournaments/tournament-results-store.service';

function main() {
  const standings = normalizeStoredTournamentStandings([
    {
      id: 'player-1',
      name: ' Алиса ',
      rank: 1,
      matchesPlayed: 7,
      wins: 6,
      losses: 1,
      draws: 0,
      pointsFor: 93,
      pointsAgainst: 54,
      pointDiff: 39,
      totalPoints: 93,
      ratingBefore: 2.045,
      ratingAfter: 2.29691,
      ratingDelta: 0.25191
    },
    {
      name: 'Борис',
      tournamentPoints: '82',
      ratingBefore: '1,749',
      ratingAfter: '1,92895',
      deltaTotal: '0,17995'
    },
    { name: '   ', pointsFor: 999 },
    null
  ]);

  assert.equal(standings.length, 2);
  assert.deepEqual(standings[0], {
    id: 'player-1',
    name: 'Алиса',
    rank: 1,
    matchesPlayed: 7,
    wins: 6,
    losses: 1,
    draws: 0,
    pointsFor: 93,
    pointsAgainst: 54,
    pointDiff: 39,
    totalPoints: 93,
    ratingBefore: 2.045,
    ratingAfter: 2.29691,
    ratingDelta: 0.25191
  });
  assert.equal(standings[1].rank, 2);
  assert.equal(standings[1].totalPoints, 82);
  assert.equal(standings[1].ratingBefore, 1.749);
  assert.equal(standings[1].ratingAfter, 1.92895);
  assert.equal(standings[1].ratingDelta, 0.17995);
  assert.deepEqual(normalizeStoredTournamentStandings({}), []);

  console.log('tournament-results-store tests passed');
}

main();
