import * as assert from 'node:assert/strict';
import { AmericanoRatingSimulationService } from '../src/tournaments/americano-rating-simulation.service';

const service = new AmericanoRatingSimulationService();

function approxEqual(actual: number, expected: number, epsilon = 0.0001): void {
  assert(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, received ${actual}`
  );
}

function main(): void {
  const result = service.simulateRating({
    players: [
      { id: 'Пара 1 игрок 1', rating: 1500, gameRating: 3.4 },
      { id: 'Пара 1 игрок 2', rating: 1500, gameRating: 4.0 },
      { id: 'Пара 2 игрок 1', rating: 1500, gameRating: 5.6 },
      { id: 'Пара 2 игрок 2', rating: 1500, gameRating: 3.0 }
    ],
    rounds: [
      {
        roundNumber: 1,
        matches: [
          {
            team1: ['Пара 1 игрок 1', 'Пара 1 игрок 2'],
            team2: ['Пара 2 игрок 1', 'Пара 2 игрок 2'],
            sets: [
              { team1: 3, team2: 6 },
              { team1: 4, team2: 6 }
            ]
          }
        ]
      }
    ]
  });

  const match = result.rounds[0].matches[0];
  assert.equal(match.played, true);
  assert.equal(match.totalTeam1, 7);
  assert.equal(match.totalTeam2, 12);

  const impactById = new Map(match.ratingImpact.map((entry) => [entry.id, entry]));

  approxEqual(impactById.get('Пара 1 игрок 1')!.expected, 0.2704);
  approxEqual(impactById.get('Пара 1 игрок 1')!.actual, 0.18243);
  approxEqual(impactById.get('Пара 1 игрок 1')!.delta, -0.02639);
  approxEqual(impactById.get('Пара 1 игрок 1')!.after, 3.37361);

  approxEqual(impactById.get('Пара 1 игрок 2')!.expected, 0.37011);
  approxEqual(impactById.get('Пара 1 игрок 2')!.delta, -0.05630);
  approxEqual(impactById.get('Пара 1 игрок 2')!.after, 3.9437);

  approxEqual(impactById.get('Пара 2 игрок 1')!.expected, 0.80837);
  approxEqual(impactById.get('Пара 2 игрок 1')!.delta, 0.00277);
  approxEqual(impactById.get('Пара 2 игрок 1')!.after, 5.60277);

  approxEqual(impactById.get('Пара 2 игрок 2')!.expected, 0.36455);
  approxEqual(impactById.get('Пара 2 игрок 2')!.delta, 0.13592);
  approxEqual(impactById.get('Пара 2 игрок 2')!.after, 3.13592);

  console.log('Americano rating simulation tests passed');
}

main();
