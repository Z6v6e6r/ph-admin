import * as assert from 'node:assert/strict';
import { AmericanoScheduleService } from '../src/tournaments/americano-schedule.service';
import { AmericanoGeneratorConfig, AmericanoPlayer } from '../src/tournaments/americano-schedule.types';

const service = new AmericanoScheduleService();

function createPlayers(count: number): AmericanoPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${index + 1}`,
    rating: 1300 + index * 40,
    verifiedFactor: 1,
    regularityFactor: 1,
    engagementFactor: 1,
    gamesPlayed: 20
  }));
}

function createConfig(mode: AmericanoGeneratorConfig['mode'], rounds?: number): AmericanoGeneratorConfig {
  return {
    mode,
    rounds,
    useRatings: true,
    firstRoundSeeding: 'auto',
    strictPartnerUniqueness: 'high',
    strictBalance: 'medium',
    avoidRepeatOpponents: true,
    avoidRepeatPartners: true,
    distributeByesEvenly: true,
    localSearchIterations: 4,
    pairingExactThreshold: 16,
    matchExactThreshold: 12
  };
}

function keyForTeam(team: [string, string]): string {
  return [...team].sort().join('|');
}

function keyForMatch(team1: [string, string], team2: [string, string]): string {
  return [keyForTeam(team1), keyForTeam(team2)].sort().join('::');
}

function assertNoRoundConflicts(rounds: Array<{ matches: Array<{ team1: [string, string]; team2: [string, string] }> }>): void {
  rounds.forEach((round, roundIndex) => {
    const used = new Set<string>();
    round.matches.forEach((match) => {
      [...match.team1, ...match.team2].forEach((playerId) => {
        assert(!used.has(playerId), `duplicate player ${playerId} in round ${roundIndex + 1}`);
        used.add(playerId);
      });
    });
  });
}

function runTeamAmericanoCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(8),
    config: createConfig('team_americano')
  });
  const uniqueMatches = new Set(
    result.rounds.flatMap((round) => round.matches.map((match) => keyForMatch(match.team1, match.team2)))
  );
  assert.equal(result.rounds.length, 3, 'team americano with 4 teams should have 3 rounds');
  assert.equal(uniqueMatches.size, 6, 'team americano should schedule each team-vs-team exactly once');
  assertNoRoundConflicts(result.rounds);
}

function runRoundRobinOddTeamsCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(6),
    config: createConfig('round_robin')
  });
  const uniqueMatches = new Set(
    result.rounds.flatMap((round) => round.matches.map((match) => keyForMatch(match.team1, match.team2)))
  );
  assert.equal(uniqueMatches.size, 3, 'round robin with 3 teams should schedule 3 unique matches');
  assert(result.rounds.some((round) => round.byes.length === 2), 'odd team round robin should produce a team bye');
  assertNoRoundConflicts(result.rounds);
}

function runTeamMexicanoCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(8),
    config: createConfig('team_mexicano', 3)
  });
  assert.equal(result.rounds.length, 3, 'team mexicano should respect explicit round count');
  assertNoRoundConflicts(result.rounds);
  const roundOne = result.rounds[0].matches.map((match) => keyForMatch(match.team1, match.team2)).sort();
  const roundTwo = result.rounds[1].matches.map((match) => keyForMatch(match.team1, match.team2)).sort();
  assert.notDeepEqual(roundOne, roundTwo, 'team mexicano should reshuffle pairings between rounds');
}

function runFlexCheck(): void {
  const result = service.generateSchedule({
    players: createPlayers(5),
    config: createConfig('flex_americano')
  });
  assert(result.rounds.length >= 5, 'flex americano should rotate enough rounds to cover byes');
  result.rounds.forEach((round) => {
    assert.equal(round.byes.length, 1, '5-player flex should have one bye each round');
    assert.equal(round.matches.length, 1, '5-player flex on default court count should schedule one match');
  });
  const byeCounts = Object.values(result.diagnostics.byesDistribution);
  assert.equal(Math.max(...byeCounts) - Math.min(...byeCounts), 0, 'flex should distribute byes evenly');
}

function main(): void {
  runTeamAmericanoCheck();
  runRoundRobinOddTeamsCheck();
  runTeamMexicanoCheck();
  runFlexCheck();
  console.log('Tournament new modes tests passed');
}

main();
