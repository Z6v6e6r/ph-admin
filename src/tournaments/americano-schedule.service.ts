import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AmericanoGenerateScheduleInput,
  AmericanoGeneratorConfig,
  AmericanoHistoricalMatch,
  AmericanoHistoricalRound,
  AmericanoMatch,
  AmericanoPair,
  AmericanoPenaltyWeights,
  AmericanoPlayer,
  AmericanoRound,
  AmericanoScheduleDiagnostics,
  AmericanoScheduleResult
} from './americano-schedule.types';

interface ResolvedGeneratorConfig extends AmericanoGeneratorConfig {
  rounds: number;
  courts: number | null;
  roundExactThreshold: number;
  balanceOutlierThreshold: number;
  balanceOutlierWeight: number;
  historyDepth: number;
  localSearchIterations: number;
  pairingExactThreshold: number;
  matchExactThreshold: number;
  weights: AmericanoPenaltyWeights;
}

interface PairBreakdown {
  total: number;
  repeatedPenalty: number;
  immediatePenalty: number;
  internalImbalancePenalty: number;
}

interface MatchBreakdown {
  total: number;
  repeatedOpponentsPenalty: number;
  recentOpponentsPenalty: number;
  balancePenalty: number;
  balanceWeighted: number;
  balanceOutlierPenalty: number;
}

interface ByeBreakdown {
  total: number;
}

interface RoundEvaluation {
  byes: string[];
  pairs: AmericanoPair[];
  matches: AmericanoMatch[];
  totalCost: number;
}

interface GeneratorState {
  playersById: Map<string, AmericanoPlayer>;
  partnerCount: Map<string, Map<string, number>>;
  opponentCount: Map<string, Map<string, number>>;
  byeCount: Map<string, number>;
  lastPartner: Map<string, string | null>;
  lastOpponents: Map<string, string[]>;
  lastByeRound: Map<string, number | null>;
  lastPartnerRound: Map<string, Map<string, number>>;
  lastOpponentRound: Map<string, Map<string, number>>;
  playerStrengthCache: Map<string, number>;
  pairStrengthCache: Map<string, number>;
  ratingScale: number;
}

const DEFAULT_WEIGHTS: AmericanoPenaltyWeights = {
  partnerRepeat: 1000,
  partnerImmediateRepeat: 1200,
  opponentRepeat: 150,
  opponentRecentRepeat: 250,
  balance: 100,
  unevenBye: 300,
  consecutiveBye: 700,
  pairInternalImbalance: 30
};

const DEFAULT_LOCAL_SEARCH_ITERATIONS = 6;
const DEFAULT_PAIRING_EXACT_THRESHOLD = 16;
const DEFAULT_MATCH_EXACT_THRESHOLD = 12;

@Injectable()
export class AmericanoScheduleService {
  generateSchedule(input: AmericanoGenerateScheduleInput): AmericanoScheduleResult {
    const players = this.validatePlayers(input.players);
    const config = this.resolveConfig(players, input.config);
    const history = this.normalizeHistory(input.history, players);
    const state = this.createState(players, config, history);

    if (config.mode === 'full_americano' && Math.floor(players.length / 4) === 1) {
      const rounds = this.generateSingleMatchFullTournament(players, state, config);
      return {
        rounds,
        diagnostics: this.buildDiagnostics(players, rounds)
      };
    }

    const rounds: AmericanoRound[] = [];

    for (let roundIndex = 0; roundIndex < config.rounds; roundIndex += 1) {
      const round = this.generateRound(players, state, config, roundIndex);
      this.commitRoundToState(round.matches, round.byes, state, roundIndex);
      rounds.push({
        roundNumber: roundIndex + 1,
        matches: round.matches,
        byes: round.byes
      });
    }

    return {
      rounds,
      diagnostics: this.buildDiagnostics(players, rounds)
    };
  }

  private generateSingleMatchFullTournament(
    players: AmericanoPlayer[],
    initialState: GeneratorState,
    config: ResolvedGeneratorConfig
  ): AmericanoRound[] {
    const byeSelectionState = this.cloneState(initialState);
    const byesByRound: string[][] = [];

    for (let roundIndex = 0; roundIndex < config.rounds; roundIndex += 1) {
      const byes = this.selectByes(players, byeSelectionState, config, roundIndex);
      byesByRound.push(byes);
      this.commitByesOnly(byes, byeSelectionState, roundIndex);
    }

    const solve = (
      roundIndex: number,
      state: GeneratorState
    ): { cost: number; rounds: AmericanoRound[] } => {
      if (roundIndex >= config.rounds) {
        return { cost: 0, rounds: [] };
      }

      const byes = byesByRound[roundIndex];
      const activeIds = players
        .map((player) => player.id)
        .filter((playerId) => !byes.includes(playerId));
      const pairings = this.listSingleMatchPairings(activeIds);

      let best = {
        cost: Number.POSITIVE_INFINITY,
        rounds: [] as AmericanoRound[]
      };

      pairings.forEach(([team1, team2]) => {
        const match = this.createMatch(team1, team2, state, config, roundIndex, 0);
        const nextState = this.cloneState(state);
        this.commitRoundToState([match], [], nextState, roundIndex);
        const suffix = solve(roundIndex + 1, nextState);
        const totalCost = match.quality.totalCost + suffix.cost;

        if (totalCost < best.cost) {
          best = {
            cost: totalCost,
            rounds: [
              {
                roundNumber: roundIndex + 1,
                matches: [match],
                byes
              },
              ...suffix.rounds
            ]
          };
        }
      });

      return best;
    };

    return solve(0, this.cloneState(initialState)).rounds;
  }

  private validatePlayers(players: AmericanoPlayer[]): AmericanoPlayer[] {
    if (!Array.isArray(players) || players.length < 4 || players.length > 48) {
      throw new BadRequestException('Americano schedule supports from 4 to 48 players');
    }

    const ids = new Set<string>();
    return players.map((player) => {
      const id = String(player?.id ?? '').trim();
      if (!id) {
        throw new BadRequestException('Every player must have a non-empty id');
      }
      if (ids.has(id)) {
        throw new BadRequestException(`Duplicate player id ${id}`);
      }
      ids.add(id);

      const rating = Number(player?.rating);
      if (!Number.isFinite(rating)) {
        throw new BadRequestException(`Player ${id} must have a numeric rating`);
      }

      return {
        id,
        rating,
        verifiedFactor: this.clampOptional(player.verifiedFactor, 0.1, 1),
        regularityFactor: this.clampOptional(player.regularityFactor, 0.5, 1),
        engagementFactor: this.clampOptional(player.engagementFactor, 0.9, 1),
        gamesPlayed: this.normalizePositiveInteger(player.gamesPlayed),
        lastGameAt: player.lastGameAt ?? null
      };
    });
  }

  private normalizeHistory(
    history: AmericanoHistoricalRound[] | undefined,
    players: AmericanoPlayer[]
  ): AmericanoHistoricalRound[] {
    if (!Array.isArray(history) || history.length === 0) {
      return [];
    }

    const playerIds = new Set(players.map((player) => player.id));
    return history.map((round, index) => {
      const matches = Array.isArray(round?.matches) ? round.matches : [];
      const byes = Array.isArray(round?.byes)
        ? round.byes
            .map((playerId) => String(playerId ?? '').trim())
            .filter((playerId) => playerIds.has(playerId))
        : [];

      matches.forEach((match, matchIndex) => {
        this.validateHistoricalMatch(match, playerIds, index, matchIndex);
      });

      return {
        roundNumber: round.roundNumber,
        matches,
        byes
      };
    });
  }

  private validateHistoricalMatch(
    match: AmericanoHistoricalMatch,
    playerIds: Set<string>,
    roundIndex: number,
    matchIndex: number
  ): void {
    const ids = [...match.team1, ...match.team2].map((playerId) => String(playerId ?? '').trim());
    if (ids.length !== 4 || new Set(ids).size !== 4) {
      throw new BadRequestException(
        `History round ${roundIndex + 1} match ${matchIndex + 1} must contain 4 unique players`
      );
    }
    ids.forEach((playerId) => {
      if (!playerIds.has(playerId)) {
        throw new BadRequestException(
          `History round ${roundIndex + 1} match ${matchIndex + 1} references unknown player ${playerId}`
        );
      }
    });
  }

  private resolveConfig(
    players: AmericanoPlayer[],
    config: AmericanoGeneratorConfig
  ): ResolvedGeneratorConfig {
    const rounds =
      typeof config.rounds === 'number' && Number.isFinite(config.rounds) && config.rounds > 0
        ? Math.floor(config.rounds)
        : this.resolveDefaultRounds(players.length, config.mode);

    const courts =
      typeof config.courts === 'number' && Number.isFinite(config.courts) && config.courts > 0
        ? Math.floor(config.courts)
        : null;
    const historyDepth =
      typeof config.historyDepth === 'number' && Number.isFinite(config.historyDepth)
        ? Math.max(0, Math.floor(config.historyDepth))
        : 0;
    const roundExactThreshold =
      typeof config.roundExactThreshold === 'number' && Number.isFinite(config.roundExactThreshold)
        ? Math.max(0, Math.floor(config.roundExactThreshold))
        : 12;
    const balanceOutlierThreshold =
      typeof config.balanceOutlierThreshold === 'number' &&
      Number.isFinite(config.balanceOutlierThreshold)
        ? Math.max(0, config.balanceOutlierThreshold)
        : 1.1;
    const balanceOutlierWeight =
      typeof config.balanceOutlierWeight === 'number' &&
      Number.isFinite(config.balanceOutlierWeight)
        ? Math.max(0, config.balanceOutlierWeight)
        : 120;
    const localSearchIterations =
      typeof config.localSearchIterations === 'number' &&
      Number.isFinite(config.localSearchIterations)
        ? Math.max(1, Math.floor(config.localSearchIterations))
        : DEFAULT_LOCAL_SEARCH_ITERATIONS;
    const pairingExactThreshold =
      typeof config.pairingExactThreshold === 'number' &&
      Number.isFinite(config.pairingExactThreshold)
        ? Math.min(28, Math.max(8, Math.floor(config.pairingExactThreshold)))
        : DEFAULT_PAIRING_EXACT_THRESHOLD;
    const matchExactThreshold =
      typeof config.matchExactThreshold === 'number' &&
      Number.isFinite(config.matchExactThreshold)
        ? Math.min(14, Math.max(4, Math.floor(config.matchExactThreshold)))
        : DEFAULT_MATCH_EXACT_THRESHOLD;

    return {
      ...config,
      rounds,
      courts,
      firstRoundSeeding: config.firstRoundSeeding ?? 'auto',
      roundExactThreshold,
      balanceOutlierThreshold,
      balanceOutlierWeight,
      historyDepth,
      localSearchIterations,
      pairingExactThreshold,
      matchExactThreshold,
      weights: this.resolveWeights(config)
    };
  }

  private resolveDefaultRounds(playerCount: number, mode: AmericanoGeneratorConfig['mode']): number {
    const fullCoverageRounds = playerCount % 2 === 0 ? playerCount - 1 : playerCount;
    if (mode === 'full_americano') {
      return fullCoverageRounds;
    }
    if (mode === 'short_americano') {
      return Math.min(fullCoverageRounds, Math.max(3, Math.ceil(playerCount / 2)));
    }
    return Math.min(fullCoverageRounds, Math.max(4, Math.ceil(playerCount / 2)));
  }

  private resolveWeights(config: AmericanoGeneratorConfig): AmericanoPenaltyWeights {
    const weights: AmericanoPenaltyWeights = {
      ...DEFAULT_WEIGHTS,
      ...(config.weights ?? {})
    };

    const partnerStrictnessMultiplier =
      config.strictPartnerUniqueness === 'high'
        ? 1.25
        : config.strictPartnerUniqueness === 'low'
          ? 0.7
          : 1;
    const balanceStrictnessMultiplier =
      config.strictBalance === 'high' ? 1.35 : config.strictBalance === 'low' ? 0.7 : 1;

    if (config.mode === 'full_americano') {
      weights.partnerRepeat *= 1.35;
      weights.partnerImmediateRepeat *= 1.2;
      weights.balance *= 0.9;
    } else if (config.mode === 'short_americano') {
      weights.partnerRepeat *= 1.1;
      weights.balance *= 1.05;
    } else {
      weights.balance *= 1.55;
      weights.partnerRepeat *= 0.9;
      weights.opponentRepeat *= 1.1;
    }

    weights.partnerRepeat *= partnerStrictnessMultiplier;
    weights.partnerImmediateRepeat *= partnerStrictnessMultiplier;
    weights.balance *= balanceStrictnessMultiplier;
    weights.pairInternalImbalance *= balanceStrictnessMultiplier;

    if (!config.useRatings) {
      weights.balance = 0;
      weights.pairInternalImbalance = 0;
    }
    if (!config.avoidRepeatOpponents) {
      weights.opponentRepeat *= 0.2;
      weights.opponentRecentRepeat *= 0.2;
    }
    if (!config.avoidRepeatPartners) {
      weights.partnerRepeat *= 0.35;
      weights.partnerImmediateRepeat *= 0.35;
    }
    if (!config.distributeByesEvenly) {
      weights.unevenBye *= 0.25;
      weights.consecutiveBye *= 0.5;
    }

    return weights;
  }

  private createState(
    players: AmericanoPlayer[],
    config: ResolvedGeneratorConfig,
    history: AmericanoHistoricalRound[]
  ): GeneratorState {
    const playersById = new Map(players.map((player) => [player.id, player]));
    const partnerCount = new Map<string, Map<string, number>>();
    const opponentCount = new Map<string, Map<string, number>>();
    const lastPartner = new Map<string, string | null>();
    const lastOpponents = new Map<string, string[]>();
    const byeCount = new Map<string, number>();
    const lastByeRound = new Map<string, number | null>();
    const lastPartnerRound = new Map<string, Map<string, number>>();
    const lastOpponentRound = new Map<string, Map<string, number>>();
    const playerStrengthCache = new Map<string, number>();
    const pairStrengthCache = new Map<string, number>();

    players.forEach((player) => {
      partnerCount.set(player.id, new Map());
      opponentCount.set(player.id, new Map());
      lastPartner.set(player.id, null);
      lastOpponents.set(player.id, []);
      byeCount.set(player.id, 0);
      lastByeRound.set(player.id, null);
      lastPartnerRound.set(player.id, new Map());
      lastOpponentRound.set(player.id, new Map());
    });

    const strengthValues = players.map((player) => {
      const strength = this.getPlayerStrength(player, playerStrengthCache);
      return strength;
    });
    const minStrength = Math.min(...strengthValues);
    const maxStrength = Math.max(...strengthValues);
    const ratingScale = Math.max(100, maxStrength - minStrength);

    const state: GeneratorState = {
      playersById,
      partnerCount,
      opponentCount,
      byeCount,
      lastPartner,
      lastOpponents,
      lastByeRound,
      lastPartnerRound,
      lastOpponentRound,
      playerStrengthCache,
      pairStrengthCache,
      ratingScale
    };

    const historyRounds =
      config.historyDepth > 0 ? history.slice(Math.max(0, history.length - config.historyDepth)) : [];
    const historyOffset = -historyRounds.length;
    historyRounds.forEach((round, index) => {
      this.commitRoundToState(
        round.matches.map((match) => ({
          court: null,
          team1: this.normalizePair(match.team1),
          team2: this.normalizePair(match.team2),
          quality: {
            balanceScore: 0,
            repeatedPartnersPenalty: 0,
            repeatedOpponentsPenalty: 0,
            totalCost: 0
          }
        })),
        round.byes ?? [],
        state,
        historyOffset + index
      );
    });

    return state;
  }

  private generateRound(
    players: AmericanoPlayer[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): RoundEvaluation {
    const byes = this.selectByes(players, state, config, roundIndex);
    const byesSet = new Set(byes);
    const availablePlayerIds = players
      .map((player) => player.id)
      .filter((playerId) => !byesSet.has(playerId));

    if (this.shouldUseSeededFirstRound(state, config, roundIndex)) {
      return this.buildSeededOpeningRound(availablePlayerIds, byes, state, config, roundIndex);
    }

    if (this.shouldUseExactRoundOptimization(availablePlayerIds, config)) {
      return this.buildExactRound(availablePlayerIds, byes, state, config, roundIndex);
    }

    const pairs = this.buildPairs(availablePlayerIds, state, config, roundIndex);
    const matches = this.buildMatchesFromPairs(pairs, state, config, roundIndex);
    let bestRound = this.evaluateRound(pairs, matches, byes, state, config, roundIndex);

    const optimizedPairs = this.optimizePairing(bestRound.pairs, state, config, roundIndex);
    if (!this.samePairing(bestRound.pairs, optimizedPairs)) {
      const optimizedMatches = this.buildMatchesFromPairs(
        optimizedPairs,
        state,
        config,
        roundIndex
      );
      const improvedRound = this.evaluateRound(
        optimizedPairs,
        optimizedMatches,
        byes,
        state,
        config,
        roundIndex
      );
      if (improvedRound.totalCost < bestRound.totalCost) {
        bestRound = improvedRound;
      }
    }

    return this.optimizeByes(bestRound, players, state, config, roundIndex);
  }

  private shouldUseExactRoundOptimization(
    availablePlayerIds: string[],
    config: ResolvedGeneratorConfig
  ): boolean {
    return (
      config.roundExactThreshold > 0 &&
      availablePlayerIds.length > 0 &&
      availablePlayerIds.length <= config.roundExactThreshold
    );
  }

  private shouldUseSeededFirstRound(
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): boolean {
    if (!config.useRatings || roundIndex !== 0) {
      return false;
    }
    if (config.firstRoundSeeding === 'off') {
      return false;
    }
    if (config.firstRoundSeeding === 'rating_quartets') {
      return true;
    }
    return this.isStateEmpty(state);
  }

  private buildSeededOpeningRound(
    availablePlayerIds: string[],
    byes: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): RoundEvaluation {
    const sortedIds = [...availablePlayerIds].sort((leftId, rightId) => {
      const strengthDiff =
        this.getPlayerStrengthById(leftId, state) - this.getPlayerStrengthById(rightId, state);
      if (strengthDiff !== 0) {
        return strengthDiff;
      }
      return leftId.localeCompare(rightId);
    });

    const pairs: AmericanoPair[] = [];
    const matches: AmericanoMatch[] = [];

    for (let index = 0; index < sortedIds.length; index += 4) {
      const quartet = sortedIds.slice(index, index + 4);
      if (quartet.length !== 4) {
        throw new BadRequestException('Seeded opening round expects complete quartets');
      }
      const [team1, team2] = this.buildQuartetSeededMatch(quartet);
      pairs.push(team1, team2);
      matches.push(
        this.createMatch(team1, team2, state, config, roundIndex, matches.length)
      );
    }

    return this.evaluateRound(pairs, matches, byes, state, config, roundIndex);
  }

  private buildQuartetSeededMatch(quartet: string[]): [AmericanoPair, AmericanoPair] {
    const sortedQuartet = [...quartet].sort((left, right) => left.localeCompare(right));
    return [
      this.normalizePair([sortedQuartet[0], sortedQuartet[2]]),
      this.normalizePair([sortedQuartet[1], sortedQuartet[3]])
    ];
  }

  private buildExactRound(
    availablePlayerIds: string[],
    byes: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): RoundEvaluation {
    const ids = [...availablePlayerIds].sort();
    const memo = new Map<string, { totalCost: number; matches: AmericanoMatch[] }>();

    const solve = (remainingIds: string[]): { totalCost: number; matches: AmericanoMatch[] } => {
      if (remainingIds.length === 0) {
        return { totalCost: 0, matches: [] };
      }

      const key = remainingIds.join('|');
      const cached = memo.get(key);
      if (cached) {
        return cached;
      }

      const anchor = remainingIds[0];
      const rest = remainingIds.slice(1);
      let best = {
        totalCost: Number.POSITIVE_INFINITY,
        matches: [] as AmericanoMatch[]
      };
      let bestSignature = '';

      const quartets = this.pickCombinations(rest, 3).map((group) => [anchor, ...group].sort());

      quartets.forEach((quartet) => {
        const remainingAfterQuartet = remainingIds.filter((playerId) => !quartet.includes(playerId));
        const quartetMatch = this.selectBestMatchForQuartet(quartet, state, config, roundIndex);
        const quartetPairs: AmericanoPair[] = [quartetMatch.team1, quartetMatch.team2];
        const quartetCost = this.evaluateRound(
          quartetPairs,
          [quartetMatch],
          [],
          state,
          config,
          roundIndex
        ).totalCost;
        const suffix = solve(remainingAfterQuartet);
        const totalCost = this.roundNumber(quartetCost + suffix.totalCost);
        const signature = [
          this.matchSignature(quartetMatch),
          ...suffix.matches.map((match) => this.matchSignature(match))
        ]
          .sort()
          .join(',');

        if (
          totalCost < best.totalCost ||
          (totalCost === best.totalCost &&
            (bestSignature === '' || signature.localeCompare(bestSignature) < 0))
        ) {
          best = {
            totalCost,
            matches: [quartetMatch, ...suffix.matches]
          };
          bestSignature = signature;
        }
      });

      memo.set(key, best);
      return best;
    };

    const solved = solve(ids);
    const matches = solved.matches.map((match, index) => ({
      ...match,
      court: this.resolveCourt(index, config)
    }));

    return this.evaluateRound(
      matches.flatMap((match) => [match.team1, match.team2]),
      matches,
      byes,
      state,
      config,
      roundIndex
    );
  }

  private selectBestMatchForQuartet(
    quartet: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoMatch {
    const options = this.listSingleMatchPairings(quartet);
    let bestMatch: AmericanoMatch | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestSignature = '';

    options.forEach((option) => {
      const match = this.createMatch(option[0], option[1], state, config, roundIndex, 0);
      const quartetCost = this.evaluateRound(
        [match.team1, match.team2],
        [match],
        [],
        state,
        config,
        roundIndex
      ).totalCost;
      const signature = this.matchSignature(match);
      if (
        quartetCost < bestCost ||
        (quartetCost === bestCost &&
          (bestSignature === '' || signature.localeCompare(bestSignature) < 0))
      ) {
        bestMatch = match;
        bestCost = quartetCost;
        bestSignature = signature;
      }
    });

    if (!bestMatch) {
      throw new BadRequestException('Failed to resolve best quartet match');
    }

    return bestMatch;
  }

  private selectByes(
    players: AmericanoPlayer[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): string[] {
    const byeCountNeeded = players.length % 4;
    if (byeCountNeeded === 0) {
      return [];
    }

    const playerIds = this.buildByeCandidatePool(players, state, byeCountNeeded, roundIndex);
    const combinations = this.pickCombinations(playerIds, byeCountNeeded);
    let bestByes: string[] = [];
    let bestCost = Number.POSITIVE_INFINITY;

    combinations.forEach((candidateByes) => {
      const cost = candidateByes.reduce((sum, playerId) => {
        return sum + this.getByeBreakdown(playerId, state, config, roundIndex).total;
      }, 0);
      const normalized = [...candidateByes].sort();
      const encoded = normalized.join('|');
      const bestEncoded = bestByes.join('|');
      if (
        cost < bestCost ||
        (cost === bestCost && (!bestEncoded || encoded.localeCompare(bestEncoded) < 0))
      ) {
        bestCost = cost;
        bestByes = normalized;
      }
    });

    return bestByes;
  }

  private buildByeCandidatePool(
    players: AmericanoPlayer[],
    state: GeneratorState,
    byeCountNeeded: number,
    roundIndex: number
  ): string[] {
    const counts = [...new Set(players.map((player) => state.byeCount.get(player.id) ?? 0))].sort(
      (left, right) => left - right
    );

    const buildPool = (allowConsecutive: boolean): string[] => {
      const pool: string[] = [];
      for (const count of counts) {
        const batch = players
          .filter((player) => (state.byeCount.get(player.id) ?? 0) === count)
          .filter((player) => {
            if (allowConsecutive) {
              return true;
            }
            const lastByeRound = state.lastByeRound.get(player.id);
            return !(typeof lastByeRound === 'number' && roundIndex - lastByeRound === 1);
          })
          .map((player) => player.id);
        pool.push(...batch);
        if (pool.length >= byeCountNeeded) {
          break;
        }
      }
      return pool;
    };

    const strictPool = buildPool(false);
    if (strictPool.length >= byeCountNeeded) {
      return strictPool;
    }
    return buildPool(true);
  }

  private buildPairs(
    availablePlayerIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoPair[] {
    if (availablePlayerIds.length <= config.pairingExactThreshold) {
      return this.buildPairsExact(availablePlayerIds, state, config, roundIndex);
    }

    const attempts = Math.max(4, Math.min(10, config.localSearchIterations + 2));
    let bestPairs: AmericanoPair[] = [];
    let bestCost = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const greedyPairs = this.buildPairsGreedy(availablePlayerIds, state, config, roundIndex, attempt);
      const optimizedPairs = this.optimizePairing(greedyPairs, state, config, roundIndex);
      const cost = this.sumPairCosts(optimizedPairs, state, config, roundIndex);
      if (cost < bestCost) {
        bestCost = cost;
        bestPairs = optimizedPairs;
      }
    }

    return bestPairs;
  }

  private buildPairsExact(
    availablePlayerIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoPair[] {
    const ids = [...availablePlayerIds].sort();
    const memo = new Map<number, { cost: number; pairs: AmericanoPair[] }>();
    const fullMask = (1 << ids.length) - 1;

    const solve = (mask: number): { cost: number; pairs: AmericanoPair[] } => {
      if (mask === 0) {
        return { cost: 0, pairs: [] };
      }

      const cached = memo.get(mask);
      if (cached) {
        return cached;
      }

      let firstIndex = 0;
      while (((mask >> firstIndex) & 1) === 0) {
        firstIndex += 1;
      }

      let best = {
        cost: Number.POSITIVE_INFINITY,
        pairs: [] as AmericanoPair[]
      };

      for (let partnerIndex = firstIndex + 1; partnerIndex < ids.length; partnerIndex += 1) {
        if (((mask >> partnerIndex) & 1) === 0) {
          continue;
        }
        const pair = this.normalizePair([ids[firstIndex], ids[partnerIndex]]);
        const pairCost = this.getPairBreakdown(pair[0], pair[1], state, config, roundIndex).total;
        const nextMask = mask ^ (1 << firstIndex) ^ (1 << partnerIndex);
        const suffix = solve(nextMask);
        const totalCost = pairCost + suffix.cost;
        if (totalCost < best.cost) {
          best = {
            cost: totalCost,
            pairs: [pair, ...suffix.pairs]
          };
        }
      }

      memo.set(mask, best);
      return best;
    };

    return solve(fullMask).pairs;
  }

  private buildPairsGreedy(
    availablePlayerIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number,
    attempt: number
  ): AmericanoPair[] {
    const rng = this.createRng(this.seedFromRound(availablePlayerIds, roundIndex, attempt));
    const remaining = new Set(availablePlayerIds);
    const pairs: AmericanoPair[] = [];

    while (remaining.size > 0) {
      const remainingIds = [...remaining];
      const anchor = this.selectPairAnchor(remainingIds, state, config, roundIndex, rng);
      remaining.delete(anchor);

      const partnerCandidates = [...remaining].map((playerId) => ({
        playerId,
        breakdown: this.getPairBreakdown(anchor, playerId, state, config, roundIndex)
      }));

      const hasFreshPartner = partnerCandidates.some(
        (candidate) =>
          this.getMatrixValue(state.partnerCount, anchor, candidate.playerId) === 0 &&
          !this.isImmediatePartnerRepeat(anchor, candidate.playerId, state, roundIndex)
      );
      const filteredCandidates =
        hasFreshPartner && config.avoidRepeatPartners
          ? partnerCandidates.filter(
              (candidate) =>
                this.getMatrixValue(state.partnerCount, anchor, candidate.playerId) === 0 &&
                !this.isImmediatePartnerRepeat(anchor, candidate.playerId, state, roundIndex)
            )
          : partnerCandidates;

      filteredCandidates.sort((left, right) => {
        const leftFuture = this.estimateFuturePairCost(
          left.playerId,
          [...remaining].filter((playerId) => playerId !== left.playerId),
          state,
          config,
          roundIndex
        );
        const rightFuture = this.estimateFuturePairCost(
          right.playerId,
          [...remaining].filter((playerId) => playerId !== right.playerId),
          state,
          config,
          roundIndex
        );
        const leftScore = left.breakdown.total + leftFuture;
        const rightScore = right.breakdown.total + rightFuture;
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return rng() < 0.5 ? -1 : 1;
      });

      const partnerId = filteredCandidates[0]?.playerId;
      if (!partnerId) {
        throw new BadRequestException('Failed to build valid Americano pairs');
      }
      remaining.delete(partnerId);
      pairs.push(this.normalizePair([anchor, partnerId]));
    }

    return pairs;
  }

  private selectPairAnchor(
    remainingIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number,
    rng: () => number
  ): string {
    const ranked = [...remainingIds].sort((left, right) => {
      const leftSummary = this.describePairOptions(left, remainingIds, state, config, roundIndex);
      const rightSummary = this.describePairOptions(right, remainingIds, state, config, roundIndex);
      if (leftSummary.freshPartners !== rightSummary.freshPartners) {
        return leftSummary.freshPartners - rightSummary.freshPartners;
      }
      if (leftSummary.bestCost !== rightSummary.bestCost) {
        return rightSummary.bestCost - leftSummary.bestCost;
      }
      return rng() < 0.5 ? -1 : 1;
    });
    return ranked[0];
  }

  private describePairOptions(
    playerId: string,
    remainingIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): { freshPartners: number; bestCost: number } {
    const candidates = remainingIds
      .filter((candidateId) => candidateId !== playerId)
      .map((candidateId) => ({
        candidateId,
        breakdown: this.getPairBreakdown(playerId, candidateId, state, config, roundIndex)
      }));
    const freshPartners = candidates.filter(
      (candidate) =>
        this.getMatrixValue(state.partnerCount, playerId, candidate.candidateId) === 0 &&
        !this.isImmediatePartnerRepeat(playerId, candidate.candidateId, state, roundIndex)
    ).length;
    const bestCost =
      candidates.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...candidates.map((candidate) => candidate.breakdown.total));
    return { freshPartners, bestCost };
  }

  private estimateFuturePairCost(
    playerId: string,
    remainingIds: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): number {
    if (remainingIds.length === 0) {
      return 0;
    }
    const nextCosts = remainingIds.map((candidateId) =>
      this.getPairBreakdown(playerId, candidateId, state, config, roundIndex).total
    );
    return Math.min(...nextCosts) * 0.15;
  }

  private optimizePairing(
    initialPairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoPair[] {
    const pairs = initialPairs.map((pair) => this.normalizePair(pair));

    for (let iteration = 0; iteration < config.localSearchIterations; iteration += 1) {
      let improved = false;

      for (let leftIndex = 0; leftIndex < pairs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < pairs.length; rightIndex += 1) {
          const [a, b] = pairs[leftIndex];
          const [c, d] = pairs[rightIndex];
          const currentCost =
            this.getPairBreakdown(a, b, state, config, roundIndex).total +
            this.getPairBreakdown(c, d, state, config, roundIndex).total;
          const options: AmericanoPair[][] = [
            [this.normalizePair([a, c]), this.normalizePair([b, d])],
            [this.normalizePair([a, d]), this.normalizePair([b, c])]
          ];

          let bestOption = pairs.slice();
          let bestCost = currentCost;

          options.forEach((option) => {
            const optionCost =
              this.getPairBreakdown(option[0][0], option[0][1], state, config, roundIndex).total +
              this.getPairBreakdown(option[1][0], option[1][1], state, config, roundIndex).total;
            if (optionCost < bestCost) {
              bestCost = optionCost;
              bestOption = pairs.slice();
              bestOption[leftIndex] = option[0];
              bestOption[rightIndex] = option[1];
            }
          });

          if (bestCost + 1e-6 < currentCost) {
            pairs.splice(0, pairs.length, ...bestOption);
            improved = true;
          }
        }
      }

      if (!improved) {
        break;
      }
    }

    return pairs;
  }

  private buildMatchesFromPairs(
    pairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoMatch[] {
    if (pairs.length <= config.matchExactThreshold) {
      return this.buildMatchesExact(pairs, state, config, roundIndex);
    }
    const greedyMatches = this.buildMatchesGreedy(pairs, state, config, roundIndex);
    return this.optimizeMatches(greedyMatches, state, config, roundIndex);
  }

  private buildMatchesExact(
    pairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoMatch[] {
    const memo = new Map<number, { cost: number; matches: Array<[number, number]> }>();
    const fullMask = (1 << pairs.length) - 1;

    const solve = (mask: number): { cost: number; matches: Array<[number, number]> } => {
      if (mask === 0) {
        return { cost: 0, matches: [] };
      }

      const cached = memo.get(mask);
      if (cached) {
        return cached;
      }

      let firstIndex = 0;
      while (((mask >> firstIndex) & 1) === 0) {
        firstIndex += 1;
      }

      let best = {
        cost: Number.POSITIVE_INFINITY,
        matches: [] as Array<[number, number]>
      };

      for (let otherIndex = firstIndex + 1; otherIndex < pairs.length; otherIndex += 1) {
        if (((mask >> otherIndex) & 1) === 0) {
          continue;
        }
        const breakdown = this.getMatchBreakdown(
          pairs[firstIndex],
          pairs[otherIndex],
          state,
          config,
          roundIndex
        );
        const nextMask = mask ^ (1 << firstIndex) ^ (1 << otherIndex);
        const suffix = solve(nextMask);
        const totalCost = breakdown.total + suffix.cost;
        if (totalCost < best.cost) {
          best = {
            cost: totalCost,
            matches: [[firstIndex, otherIndex], ...suffix.matches]
          };
        }
      }

      memo.set(mask, best);
      return best;
    };

    return solve(fullMask).matches.map(([leftIndex, rightIndex], index) =>
      this.createMatch(pairs[leftIndex], pairs[rightIndex], state, config, roundIndex, index)
    );
  }

  private buildMatchesGreedy(
    pairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoMatch[] {
    const remaining = new Set(pairs.map((_, index) => index));
    const matches: AmericanoMatch[] = [];

    while (remaining.size > 0) {
      const remainingIndices = [...remaining];
      const anchorIndex = remainingIndices.sort((leftIndex, rightIndex) => {
        const leftCost = this.describeMatchOptions(leftIndex, remainingIndices, pairs, state, config, roundIndex);
        const rightCost = this.describeMatchOptions(
          rightIndex,
          remainingIndices,
          pairs,
          state,
          config,
          roundIndex
        );
        if (leftCost.bestCost !== rightCost.bestCost) {
          return rightCost.bestCost - leftCost.bestCost;
        }
        return leftCost.optionCount - rightCost.optionCount;
      })[0];

      remaining.delete(anchorIndex);
      const opponentCandidates = [...remaining].map((otherIndex) => ({
        otherIndex,
        breakdown: this.getMatchBreakdown(pairs[anchorIndex], pairs[otherIndex], state, config, roundIndex)
      }));
      opponentCandidates.sort((left, right) => left.breakdown.total - right.breakdown.total);

      const opponentIndex = opponentCandidates[0]?.otherIndex;
      if (opponentIndex === undefined) {
        throw new BadRequestException('Failed to build valid Americano matches');
      }
      remaining.delete(opponentIndex);
      matches.push(
        this.createMatch(pairs[anchorIndex], pairs[opponentIndex], state, config, roundIndex, matches.length)
      );
    }

    return matches;
  }

  private describeMatchOptions(
    anchorIndex: number,
    remainingIndices: number[],
    pairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): { optionCount: number; bestCost: number } {
    const costs = remainingIndices
      .filter((candidateIndex) => candidateIndex !== anchorIndex)
      .map((candidateIndex) =>
        this.getMatchBreakdown(pairs[anchorIndex], pairs[candidateIndex], state, config, roundIndex).total
      );
    return {
      optionCount: costs.length,
      bestCost: costs.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...costs)
    };
  }

  private optimizeMatches(
    initialMatches: AmericanoMatch[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): AmericanoMatch[] {
    const matches = initialMatches.map((match) => ({
      ...match,
      team1: this.normalizePair(match.team1),
      team2: this.normalizePair(match.team2)
    }));

    for (let iteration = 0; iteration < config.localSearchIterations; iteration += 1) {
      let improved = false;

      for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
          const currentPairs = [
            matches[leftIndex].team1,
            matches[leftIndex].team2,
            matches[rightIndex].team1,
            matches[rightIndex].team2
          ];
          const currentCost =
            this.getMatchBreakdown(
              matches[leftIndex].team1,
              matches[leftIndex].team2,
              state,
              config,
              roundIndex
            ).total +
            this.getMatchBreakdown(
              matches[rightIndex].team1,
              matches[rightIndex].team2,
              state,
              config,
              roundIndex
            ).total;
          const options: Array<Array<[AmericanoPair, AmericanoPair]>> = [
            [
              [currentPairs[0], currentPairs[2]],
              [currentPairs[1], currentPairs[3]]
            ],
            [
              [currentPairs[0], currentPairs[3]],
              [currentPairs[1], currentPairs[2]]
            ]
          ];

          let bestCost = currentCost;
          let bestOption: Array<[AmericanoPair, AmericanoPair]> | null = null;

          options.forEach((option) => {
            const optionCost =
              this.getMatchBreakdown(option[0][0], option[0][1], state, config, roundIndex).total +
              this.getMatchBreakdown(option[1][0], option[1][1], state, config, roundIndex).total;
            if (optionCost < bestCost) {
              bestCost = optionCost;
              bestOption = option;
            }
          });

          if (bestOption && bestCost + 1e-6 < currentCost) {
            matches[leftIndex] = this.createMatch(
              bestOption[0][0],
              bestOption[0][1],
              state,
              config,
              roundIndex,
              leftIndex
            );
            matches[rightIndex] = this.createMatch(
              bestOption[1][0],
              bestOption[1][1],
              state,
              config,
              roundIndex,
              rightIndex
            );
            improved = true;
          }
        }
      }

      if (!improved) {
        break;
      }
    }

    return matches.map((match, index) => ({
      ...match,
      court: this.resolveCourt(index, config)
    }));
  }

  private evaluateRound(
    pairs: AmericanoPair[],
    matches: AmericanoMatch[],
    byes: string[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): RoundEvaluation {
    const pairCost = this.sumPairCosts(pairs, state, config, roundIndex);
    const matchCost = matches.reduce((sum, match) => sum + match.quality.totalCost, 0);
    const byeCost = byes.reduce((sum, playerId) => {
      return sum + this.getByeBreakdown(playerId, state, config, roundIndex).total;
    }, 0);
    return {
      byes: [...byes].sort(),
      pairs: pairs.map((pair) => this.normalizePair(pair)),
      matches,
      totalCost: this.roundNumber(pairCost + matchCost + byeCost)
    };
  }

  private optimizeByes(
    initialRound: RoundEvaluation,
    players: AmericanoPlayer[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): RoundEvaluation {
    if (initialRound.byes.length === 0) {
      return initialRound;
    }

    let bestRound = initialRound;
    const activePlayerIds = initialRound.pairs.flatMap((pair) => pair);
    const byeSet = new Set(initialRound.byes);

    for (const byePlayerId of initialRound.byes) {
      for (const activePlayerId of activePlayerIds) {
        if (byeSet.has(activePlayerId)) {
          continue;
        }
        const swappedByes = initialRound.byes
          .filter((playerId) => playerId !== byePlayerId)
          .concat(activePlayerId)
          .sort();
        if (!this.isByeSelectionAllowed(swappedByes, players, state, roundIndex)) {
          continue;
        }
        const activeIds = players
          .map((player) => player.id)
          .filter((playerId) => !swappedByes.includes(playerId));
        const swappedPairs = this.buildPairs(activeIds, state, config, roundIndex);
        const swappedMatches = this.buildMatchesFromPairs(swappedPairs, state, config, roundIndex);
        const swappedRound = this.evaluateRound(
          swappedPairs,
          swappedMatches,
          swappedByes,
          state,
          config,
          roundIndex
        );
        if (swappedRound.totalCost < bestRound.totalCost) {
          bestRound = swappedRound;
        }
      }
    }

    return bestRound;
  }

  private isByeSelectionAllowed(
    candidateByes: string[],
    players: AmericanoPlayer[],
    state: GeneratorState,
    roundIndex: number
  ): boolean {
    const pool = new Set(this.buildByeCandidatePool(players, state, candidateByes.length, roundIndex));
    return candidateByes.every((playerId) => pool.has(playerId));
  }

  private createMatch(
    team1: AmericanoPair,
    team2: AmericanoPair,
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number,
    matchIndex: number
  ): AmericanoMatch {
    const normalizedTeam1 = this.normalizePair(team1);
    const normalizedTeam2 = this.normalizePair(team2);
    const pair1Breakdown = this.getPairBreakdown(
      normalizedTeam1[0],
      normalizedTeam1[1],
      state,
      config,
      roundIndex
    );
    const pair2Breakdown = this.getPairBreakdown(
      normalizedTeam2[0],
      normalizedTeam2[1],
      state,
      config,
      roundIndex
    );
    const matchBreakdown = this.getMatchBreakdown(
      normalizedTeam1,
      normalizedTeam2,
      state,
      config,
      roundIndex
    );

    return {
      court: this.resolveCourt(matchIndex, config),
      team1: normalizedTeam1,
      team2: normalizedTeam2,
      quality: {
        balanceScore: this.roundNumber(matchBreakdown.balancePenalty),
        repeatedPartnersPenalty: this.roundNumber(
          pair1Breakdown.repeatedPenalty +
            pair1Breakdown.immediatePenalty +
            pair2Breakdown.repeatedPenalty +
            pair2Breakdown.immediatePenalty
        ),
        repeatedOpponentsPenalty: this.roundNumber(
          matchBreakdown.repeatedOpponentsPenalty + matchBreakdown.recentOpponentsPenalty
        ),
        totalCost: this.roundNumber(
          pair1Breakdown.total + pair2Breakdown.total + matchBreakdown.total
        )
      }
    };
  }

  private resolveCourt(index: number, config: ResolvedGeneratorConfig): number | null {
    if (!config.courts || config.courts <= 0) {
      return null;
    }
    return (index % config.courts) + 1;
  }

  private sumPairCosts(
    pairs: AmericanoPair[],
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): number {
    return this.roundNumber(
      pairs.reduce((sum, pair) => {
        return sum + this.getPairBreakdown(pair[0], pair[1], state, config, roundIndex).total;
      }, 0)
    );
  }

  private getPairBreakdown(
    playerAId: string,
    playerBId: string,
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): PairBreakdown {
    const repeatedPartners = this.getMatrixValue(state.partnerCount, playerAId, playerBId);
    const repeatedPenalty = repeatedPartners * config.weights.partnerRepeat;
    const immediatePenalty = this.isImmediatePartnerRepeat(playerAId, playerBId, state, roundIndex)
      ? config.weights.partnerImmediateRepeat
      : 0;

    let internalImbalancePenalty = 0;
    if (config.useRatings) {
      const strengthGap = Math.abs(
        this.getPlayerStrengthById(playerAId, state) - this.getPlayerStrengthById(playerBId, state)
      );
      internalImbalancePenalty =
        (strengthGap / Math.max(1, state.ratingScale)) * config.weights.pairInternalImbalance;
    }

    return {
      repeatedPenalty: this.roundNumber(repeatedPenalty),
      immediatePenalty: this.roundNumber(immediatePenalty),
      internalImbalancePenalty: this.roundNumber(internalImbalancePenalty),
      total: this.roundNumber(repeatedPenalty + immediatePenalty + internalImbalancePenalty)
    };
  }

  private isImmediatePartnerRepeat(
    playerAId: string,
    playerBId: string,
    state: GeneratorState,
    roundIndex: number
  ): boolean {
    const lastRound = this.getNestedValue(state.lastPartnerRound, playerAId, playerBId);
    return typeof lastRound === 'number' && roundIndex - lastRound === 1;
  }

  private getMatchBreakdown(
    pair1: AmericanoPair,
    pair2: AmericanoPair,
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): MatchBreakdown {
    let repeatedOpponentsPenalty = 0;
    let recentOpponentsPenalty = 0;

    pair1.forEach((leftPlayerId) => {
      pair2.forEach((rightPlayerId) => {
        const repeats = this.getMatrixValue(state.opponentCount, leftPlayerId, rightPlayerId);
        repeatedOpponentsPenalty += repeats * config.weights.opponentRepeat;

        const lastRound = this.getNestedValue(state.lastOpponentRound, leftPlayerId, rightPlayerId);
        if (typeof lastRound === 'number') {
          const distance = roundIndex - lastRound;
          if (distance === 1) {
            recentOpponentsPenalty += config.weights.opponentRecentRepeat;
          } else if (distance === 2) {
            recentOpponentsPenalty += config.weights.opponentRecentRepeat * 0.5;
          }
        }
      });
    });

    const balancePenalty = config.useRatings
      ? this.calculateBalancePenalty(pair1, pair2, state)
      : 0;
    const balanceWeighted = balancePenalty * config.weights.balance;
    const balanceOutlierPenalty =
      config.useRatings && config.balanceOutlierWeight > 0
        ? Math.max(0, balancePenalty - config.balanceOutlierThreshold) *
          config.balanceOutlierWeight
        : 0;

    return {
      repeatedOpponentsPenalty: this.roundNumber(repeatedOpponentsPenalty),
      recentOpponentsPenalty: this.roundNumber(recentOpponentsPenalty),
      balancePenalty: this.roundNumber(balancePenalty),
      balanceWeighted: this.roundNumber(balanceWeighted),
      balanceOutlierPenalty: this.roundNumber(balanceOutlierPenalty),
      total: this.roundNumber(
        repeatedOpponentsPenalty +
          recentOpponentsPenalty +
          balanceWeighted +
          balanceOutlierPenalty
      )
    };
  }

  private getByeBreakdown(
    playerId: string,
    state: GeneratorState,
    config: ResolvedGeneratorConfig,
    roundIndex: number
  ): ByeBreakdown {
    const byeCounts = [...state.byeCount.values()];
    const minBye = Math.min(...byeCounts);
    const currentBye = state.byeCount.get(playerId) ?? 0;
    const projectedBye = currentBye + 1;
    const unevenPenalty =
      Math.max(0, projectedBye - (minBye + 1)) * config.weights.unevenBye +
      Math.max(0, currentBye - minBye) * (config.weights.unevenBye * 0.35);
    const lastByeRound = state.lastByeRound.get(playerId);
    const consecutivePenalty =
      typeof lastByeRound === 'number' && roundIndex - lastByeRound === 1
        ? config.weights.consecutiveBye
        : 0;

    return {
      total: this.roundNumber(unevenPenalty + consecutivePenalty)
    };
  }

  private calculateBalancePenalty(
    pair1: AmericanoPair,
    pair2: AmericanoPair,
    state: GeneratorState
  ): number {
    const pair1Strength = this.getPairStrength(pair1, state);
    const pair2Strength = this.getPairStrength(pair2, state);
    const divisor = Math.max(100, state.ratingScale * 0.9);
    const expectations = [
      this.expectedScore(this.getPlayerStrengthById(pair1[0], state), pair2Strength, divisor),
      this.expectedScore(this.getPlayerStrengthById(pair1[1], state), pair2Strength, divisor),
      this.expectedScore(this.getPlayerStrengthById(pair2[0], state), pair1Strength, divisor),
      this.expectedScore(this.getPlayerStrengthById(pair2[1], state), pair1Strength, divisor)
    ];

    return this.roundNumber(
      expectations.reduce((sum, expectation) => sum + Math.abs(expectation - 0.5), 0)
    );
  }

  private expectedScore(playerStrength: number, opponentPairStrength: number, divisor: number): number {
    return 1 / (1 + 10 ** ((opponentPairStrength - playerStrength) / divisor));
  }

  private getPairStrength(pair: AmericanoPair, state: GeneratorState): number {
    const key = this.pairKey(pair[0], pair[1]);
    const cached = state.pairStrengthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const firstStrength = this.getPlayerStrengthById(pair[0], state);
    const secondStrength = this.getPlayerStrengthById(pair[1], state);
    const stronger = Math.max(firstStrength, secondStrength);
    const weaker = Math.min(firstStrength, secondStrength);
    const value = this.roundNumber(stronger * 0.55 + weaker * 0.45);
    state.pairStrengthCache.set(key, value);
    return value;
  }

  private getPlayerStrengthById(playerId: string, state: GeneratorState): number {
    const player = state.playersById.get(playerId);
    if (!player) {
      throw new BadRequestException(`Unknown player ${playerId}`);
    }
    return this.getPlayerStrength(player, state.playerStrengthCache);
  }

  private getPlayerStrength(player: AmericanoPlayer, cache: Map<string, number>): number {
    const cached = cache.get(player.id);
    if (cached !== undefined) {
      return cached;
    }

    const verifiedFactor = this.clampOptional(player.verifiedFactor, 0.1, 1) ?? 1;
    const regularityFactor = this.clampOptional(player.regularityFactor, 0.5, 1) ?? 1;
    const engagementFactor = this.clampOptional(player.engagementFactor, 0.9, 1) ?? 1;
    const gamesPlayed = Math.max(0, this.normalizePositiveInteger(player.gamesPlayed) ?? 0);
    const confidenceMultiplier =
      0.7 + verifiedFactor * 0.15 + regularityFactor * 0.1 + engagementFactor * 0.05;
    const stabilityBoost = 1 + Math.min(gamesPlayed, 40) * 0.0015;
    const strength = this.roundNumber(player.rating * confidenceMultiplier * stabilityBoost);

    cache.set(player.id, strength);
    return strength;
  }

  private commitRoundToState(
    matches: AmericanoMatch[],
    byes: string[],
    state: GeneratorState,
    roundIndex: number
  ): void {
    const activePlayerIds = new Set<string>();
    const newLastOpponents = new Map<string, string[]>();
    const newLastPartners = new Map<string, string>();

    matches.forEach((match) => {
      const allPlayers = [...match.team1, ...match.team2];
      allPlayers.forEach((playerId) => activePlayerIds.add(playerId));

      this.incrementMatrix(state.partnerCount, match.team1[0], match.team1[1]);
      this.incrementMatrix(state.partnerCount, match.team2[0], match.team2[1]);
      this.setNestedValue(state.lastPartnerRound, match.team1[0], match.team1[1], roundIndex);
      this.setNestedValue(state.lastPartnerRound, match.team2[0], match.team2[1], roundIndex);

      newLastPartners.set(match.team1[0], match.team1[1]);
      newLastPartners.set(match.team1[1], match.team1[0]);
      newLastPartners.set(match.team2[0], match.team2[1]);
      newLastPartners.set(match.team2[1], match.team2[0]);

      match.team1.forEach((team1PlayerId) => {
        match.team2.forEach((team2PlayerId) => {
          this.incrementMatrix(state.opponentCount, team1PlayerId, team2PlayerId);
          this.setNestedValue(state.lastOpponentRound, team1PlayerId, team2PlayerId, roundIndex);
          const team1Opponents = newLastOpponents.get(team1PlayerId) ?? [];
          const team2Opponents = newLastOpponents.get(team2PlayerId) ?? [];
          newLastOpponents.set(team1PlayerId, [...team1Opponents, team2PlayerId]);
          newLastOpponents.set(team2PlayerId, [...team2Opponents, team1PlayerId]);
        });
      });
    });

    byes.forEach((playerId) => {
      state.byeCount.set(playerId, (state.byeCount.get(playerId) ?? 0) + 1);
      state.lastByeRound.set(playerId, roundIndex);
      state.lastPartner.set(playerId, null);
      state.lastOpponents.set(playerId, []);
    });

    activePlayerIds.forEach((playerId) => {
      state.lastByeRound.set(playerId, state.lastByeRound.get(playerId) ?? null);
      state.lastPartner.set(playerId, newLastPartners.get(playerId) ?? null);
      state.lastOpponents.set(playerId, newLastOpponents.get(playerId) ?? []);
    });
  }

  private buildDiagnostics(
    players: AmericanoPlayer[],
    rounds: AmericanoRound[]
  ): AmericanoScheduleDiagnostics {
    const partnerCounts = new Map<string, number>();
    const opponentCounts = new Map<string, number>();
    const byesDistribution: Record<string, number> = {};
    const partnerCoverageByPlayer: Record<string, { uniquePartners: number; missingPartners: number }> =
      {};
    const balanceScores = rounds.flatMap((round) => round.matches.map((match) => match.quality.balanceScore));
    const playerIds = players.map((player) => player.id);
    const uniquePartnerSets = new Map<string, Set<string>>();
    const uniqueOpponentSets = new Map<string, Set<string>>();
    const consecutiveByes = new Set<string>();
    const previousRoundByes = new Set<string>();

    playerIds.forEach((playerId) => {
      uniquePartnerSets.set(playerId, new Set());
      uniqueOpponentSets.set(playerId, new Set());
      byesDistribution[playerId] = 0;
    });

    rounds.forEach((round) => {
      const currentByes = new Set(round.byes);
      round.byes.forEach((playerId) => {
        byesDistribution[playerId] = (byesDistribution[playerId] ?? 0) + 1;
        if (previousRoundByes.has(playerId)) {
          consecutiveByes.add(playerId);
        }
      });
      previousRoundByes.clear();
      currentByes.forEach((playerId) => previousRoundByes.add(playerId));

      round.matches.forEach((match) => {
        const pairKeys = [this.pairKey(match.team1[0], match.team1[1]), this.pairKey(match.team2[0], match.team2[1])];
        pairKeys.forEach((pairKey) => {
          partnerCounts.set(pairKey, (partnerCounts.get(pairKey) ?? 0) + 1);
        });

        uniquePartnerSets.get(match.team1[0])?.add(match.team1[1]);
        uniquePartnerSets.get(match.team1[1])?.add(match.team1[0]);
        uniquePartnerSets.get(match.team2[0])?.add(match.team2[1]);
        uniquePartnerSets.get(match.team2[1])?.add(match.team2[0]);

        match.team1.forEach((playerId) => {
          match.team2.forEach((opponentId) => {
            const opponentKey = this.pairKey(playerId, opponentId);
            opponentCounts.set(opponentKey, (opponentCounts.get(opponentKey) ?? 0) + 1);
            uniqueOpponentSets.get(playerId)?.add(opponentId);
            uniqueOpponentSets.get(opponentId)?.add(playerId);
          });
        });
      });
    });

    playerIds.forEach((playerId) => {
      const uniquePartners = uniquePartnerSets.get(playerId)?.size ?? 0;
      partnerCoverageByPlayer[playerId] = {
        uniquePartners,
        missingPartners: Math.max(0, playerIds.length - 1 - uniquePartners)
      };
    });

    const theoreticalPairs = (playerIds.length * (playerIds.length - 1)) / 2;
    const byeCounts = Object.values(byesDistribution);
    const sortedBalance = [...balanceScores].sort((left, right) => left - right);
    const medianBalance =
      sortedBalance.length === 0
        ? 0
        : sortedBalance.length % 2 === 1
          ? sortedBalance[Math.floor(sortedBalance.length / 2)]
          : (sortedBalance[sortedBalance.length / 2 - 1] + sortedBalance[sortedBalance.length / 2]) / 2;
    const byeMean =
      byeCounts.length === 0 ? 0 : byeCounts.reduce((sum, value) => sum + value, 0) / byeCounts.length;
    const byeVariance =
      byeCounts.length === 0
        ? 0
        : byeCounts.reduce((sum, value) => sum + (value - byeMean) ** 2, 0) / byeCounts.length;

    return {
      totalPlayers: players.length,
      totalRounds: rounds.length,
      partnerCoveragePercent: this.roundNumber(
        theoreticalPairs === 0 ? 0 : (partnerCounts.size / theoreticalPairs) * 100
      ),
      opponentCoveragePercent: this.roundNumber(
        theoreticalPairs === 0 ? 0 : (opponentCounts.size / theoreticalPairs) * 100
      ),
      byesDistribution,
      repeatedPartnerPairs: [...partnerCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([pairKey]) => this.pairKeyToTuple(pairKey)),
      repeatedOpponentPairs: [...opponentCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([pairKey]) => this.pairKeyToTuple(pairKey)),
      partnerCoverageByPlayer,
      balance: {
        averagePenalty: this.roundNumber(
          balanceScores.length === 0
            ? 0
            : balanceScores.reduce((sum, value) => sum + value, 0) / balanceScores.length
        ),
        medianPenalty: this.roundNumber(medianBalance),
        worstPenalty: this.roundNumber(balanceScores.length === 0 ? 0 : Math.max(...balanceScores))
      },
      byeStats: {
        min: byeCounts.length === 0 ? 0 : Math.min(...byeCounts),
        max: byeCounts.length === 0 ? 0 : Math.max(...byeCounts),
        standardDeviation: this.roundNumber(Math.sqrt(byeVariance)),
        consecutiveByes: [...consecutiveByes].sort()
      }
    };
  }

  private pairKey(playerAId: string, playerBId: string): string {
    return [playerAId, playerBId].sort().join('|');
  }

  private matchSignature(match: AmericanoMatch): string {
    return [this.pairKey(match.team1[0], match.team1[1]), this.pairKey(match.team2[0], match.team2[1])]
      .sort()
      .join(':');
  }

  private isStateEmpty(state: GeneratorState): boolean {
    const matrices = [state.partnerCount, state.opponentCount];
    for (const matrix of matrices) {
      for (const row of matrix.values()) {
        for (const value of row.values()) {
          if (value > 0) {
            return false;
          }
        }
      }
    }
    for (const value of state.byeCount.values()) {
      if (value > 0) {
        return false;
      }
    }
    return true;
  }

  private pairKeyToTuple(pairKey: string): [string, string] {
    const [left, right] = pairKey.split('|');
    return [left ?? '', right ?? ''];
  }

  private normalizePair(pair: AmericanoPair): AmericanoPair {
    return [...pair].sort((left, right) => left.localeCompare(right)) as AmericanoPair;
  }

  private listSingleMatchPairings(playerIds: string[]): Array<[AmericanoPair, AmericanoPair]> {
    if (playerIds.length !== 4) {
      throw new BadRequestException('Single-match optimization expects exactly 4 active players');
    }
    const [a, b, c, d] = [...playerIds].sort((left, right) => left.localeCompare(right));
    return [
      [this.normalizePair([a, b]), this.normalizePair([c, d])],
      [this.normalizePair([a, c]), this.normalizePair([b, d])],
      [this.normalizePair([a, d]), this.normalizePair([b, c])]
    ];
  }

  private incrementMatrix(
    matrix: Map<string, Map<string, number>>,
    playerAId: string,
    playerBId: string
  ): void {
    this.setNestedValue(matrix, playerAId, playerBId, this.getMatrixValue(matrix, playerAId, playerBId) + 1);
  }

  private getMatrixValue(
    matrix: Map<string, Map<string, number>>,
    playerAId: string,
    playerBId: string
  ): number {
    return this.getNestedValue(matrix, playerAId, playerBId) ?? 0;
  }

  private getNestedValue(
    matrix: Map<string, Map<string, number>>,
    playerAId: string,
    playerBId: string
  ): number | undefined {
    return matrix.get(playerAId)?.get(playerBId);
  }

  private setNestedValue(
    matrix: Map<string, Map<string, number>>,
    playerAId: string,
    playerBId: string,
    value: number
  ): void {
    if (!matrix.has(playerAId)) {
      matrix.set(playerAId, new Map());
    }
    if (!matrix.has(playerBId)) {
      matrix.set(playerBId, new Map());
    }
    matrix.get(playerAId)?.set(playerBId, value);
    matrix.get(playerBId)?.set(playerAId, value);
  }

  private commitByesOnly(byes: string[], state: GeneratorState, roundIndex: number): void {
    byes.forEach((playerId) => {
      state.byeCount.set(playerId, (state.byeCount.get(playerId) ?? 0) + 1);
      state.lastByeRound.set(playerId, roundIndex);
    });
  }

  private cloneState(state: GeneratorState): GeneratorState {
    const cloneNestedMatrix = (
      matrix: Map<string, Map<string, number>>
    ): Map<string, Map<string, number>> => {
      const next = new Map<string, Map<string, number>>();
      matrix.forEach((inner, key) => {
        next.set(key, new Map(inner));
      });
      return next;
    };

    return {
      playersById: state.playersById,
      partnerCount: cloneNestedMatrix(state.partnerCount),
      opponentCount: cloneNestedMatrix(state.opponentCount),
      byeCount: new Map(state.byeCount),
      lastPartner: new Map(state.lastPartner),
      lastOpponents: new Map(
        [...state.lastOpponents.entries()].map(([playerId, opponents]) => [playerId, [...opponents]])
      ),
      lastByeRound: new Map(state.lastByeRound),
      lastPartnerRound: cloneNestedMatrix(state.lastPartnerRound),
      lastOpponentRound: cloneNestedMatrix(state.lastOpponentRound),
      playerStrengthCache: state.playerStrengthCache,
      pairStrengthCache: new Map(state.pairStrengthCache),
      ratingScale: state.ratingScale
    };
  }

  private pickCombinations<T>(items: T[], size: number): T[][] {
    if (size === 0) {
      return [[]];
    }
    const results: T[][] = [];

    const walk = (startIndex: number, current: T[]): void => {
      if (current.length === size) {
        results.push([...current]);
        return;
      }
      for (let index = startIndex; index <= items.length - (size - current.length); index += 1) {
        current.push(items[index]);
        walk(index + 1, current);
        current.pop();
      }
    };

    walk(0, []);
    return results;
  }

  private samePairing(left: AmericanoPair[], right: AmericanoPair[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    const leftSignature = [...left].map((pair) => this.pairKey(pair[0], pair[1])).sort().join(',');
    const rightSignature = [...right].map((pair) => this.pairKey(pair[0], pair[1])).sort().join(',');
    return leftSignature === rightSignature;
  }

  private seedFromRound(playerIds: string[], roundIndex: number, attempt: number): number {
    const source = `${[...playerIds].sort().join(',')}#${roundIndex}#${attempt}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private createRng(seed: number): () => number {
    let current = seed >>> 0;
    return () => {
      current += 0x6d2b79f5;
      let value = current;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  private clampOptional(value: number | undefined, min: number, max: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return Math.min(max, Math.max(min, value));
  }

  private normalizePositiveInteger(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return Math.max(0, Math.floor(value));
  }

  private roundNumber(value: number): number {
    return Math.round(value * 10000) / 10000;
  }
}
