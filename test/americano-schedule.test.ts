import * as assert from 'node:assert/strict';
import { AmericanoScheduleService } from '../src/tournaments/americano-schedule.service';
import {
  AmericanoGeneratorConfig,
  AmericanoPlayer,
  AmericanoScheduleResult
} from '../src/tournaments/americano-schedule.types';

const service = new AmericanoScheduleService();

function createPlayers(
  count: number,
  ratingFactory: (index: number) => number = (index) => 1400 + index * 25
): AmericanoPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${index + 1}`,
    rating: ratingFactory(index),
    verifiedFactor: 1,
    regularityFactor: 1,
    engagementFactor: 1,
    gamesPlayed: 20 + (index % 5)
  }));
}

function createConfig(mode: AmericanoGeneratorConfig['mode']): AmericanoGeneratorConfig {
  return {
    mode,
    useRatings: true,
    strictPartnerUniqueness: 'high',
    strictBalance: mode === 'competitive_americano' ? 'high' : 'medium',
    avoidRepeatOpponents: true,
    avoidRepeatPartners: true,
    distributeByesEvenly: true,
    localSearchIterations: 4,
    pairingExactThreshold: 16,
    matchExactThreshold: 12
  };
}

function assertRoundIntegrity(result: AmericanoScheduleResult, playerCount: number): void {
  const expectedByes = playerCount % 4;
  const expectedMatches = Math.floor(playerCount / 4);

  result.rounds.forEach((round) => {
    assert.equal(round.byes.length, expectedByes, `round ${round.roundNumber} bye count mismatch`);
    assert.equal(
      round.matches.length,
      expectedMatches,
      `round ${round.roundNumber} matches count mismatch`
    );

    const usedPlayers = new Set<string>();
    round.matches.forEach((match, matchIndex) => {
      const participants = [...match.team1, ...match.team2];
      assert.equal(
        new Set(participants).size,
        4,
        `round ${round.roundNumber} match ${matchIndex + 1} does not have 4 unique players`
      );
      participants.forEach((playerId) => {
        assert(!usedPlayers.has(playerId), `player ${playerId} appears twice in round ${round.roundNumber}`);
        usedPlayers.add(playerId);
      });
    });

    round.byes.forEach((playerId) => {
      assert(!usedPlayers.has(playerId), `bye player ${playerId} also appears in round ${round.roundNumber}`);
      usedPlayers.add(playerId);
    });

    assert.equal(
      usedPlayers.size,
      playerCount,
      `round ${round.roundNumber} does not cover all players exactly once`
    );
  });
}

function assertByeFairness(result: AmericanoScheduleResult): void {
  const byeCounts = Object.values(result.diagnostics.byesDistribution);
  const minBye = Math.min(...byeCounts);
  const maxBye = Math.max(...byeCounts);
  assert(
    maxBye - minBye <= 1,
    `bye distribution is not fair enough: min=${minBye}, max=${maxBye}`
  );
}

function averageBalance(result: AmericanoScheduleResult): number {
  return result.diagnostics.balance.averagePenalty;
}

function runSizeSmokeTests(): void {
  const sizes = [4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48];
  sizes.forEach((size) => {
    const result = service.generateSchedule({
      players: createPlayers(size),
      config: {
        ...createConfig('short_americano'),
        rounds: Math.min(size % 2 === 0 ? size - 1 : size, 6)
      }
    });
    assertRoundIntegrity(result, size);
    assertByeFairness(result);
  });
}

function runFullModeCoverageChecks(): void {
  [4, 5].forEach((size) => {
    const result = service.generateSchedule({
      players: createPlayers(size),
      config: createConfig('full_americano')
    });
    assertRoundIntegrity(result, size);
    assert.equal(
      result.diagnostics.repeatedPartnerPairs.length,
      0,
      `full americano should avoid repeated partners for ${size} players`
    );
  });
}

function runCompetitiveBalanceCheck(): void {
  const players = createPlayers(12, (index) => 1100 + index * 90);
  const fullResult = service.generateSchedule({
    players,
    config: {
      ...createConfig('full_americano'),
      rounds: 6
    }
  });
  const competitiveResult = service.generateSchedule({
    players,
    config: {
      ...createConfig('competitive_americano'),
      rounds: 6
    }
  });

  assert(
    averageBalance(competitiveResult) <= averageBalance(fullResult),
    'competitive americano should be at least as balanced as full americano on the same sample'
  );
}

function runExtremeRatingsCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(16, (index) => (index % 2 === 0 ? 1000 + index * 15 : 2200 - index * 10)),
    config: {
      ...createConfig('competitive_americano'),
      rounds: 6
    }
  });
  assertRoundIntegrity(result, 16);
}

function runEqualRatingsCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(16, () => 1500),
    config: {
      ...createConfig('short_americano'),
      rounds: 5
    }
  });
  assertRoundIntegrity(result, 16);
  assert(Number.isFinite(result.diagnostics.balance.averagePenalty));
}

function main(): void {
  runSizeSmokeTests();
  runFullModeCoverageChecks();
  runCompetitiveBalanceCheck();
  runExtremeRatingsCheck();
  runEqualRatingsCheck();
  console.log('Americano schedule tests passed');
}

main();
