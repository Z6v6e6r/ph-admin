import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AmericanoRatingImpactEntry,
  AmericanoRatingSimulationMatchInput,
  AmericanoRatingSimulationMatchResult,
  AmericanoRatingSimulationParams,
  AmericanoRatingSimulationPlayer,
  AmericanoRatingSimulationPlayerResult,
  AmericanoRatingSimulationResult,
  AmericanoSimulateRatingInput
} from './americano-rating.types';

const DEFAULT_PARAMS = {
  K: 0.3,
  D: 3,
  B: 0.3,
  minRating: 1,
  maxRating: 7,
  round: 5
} as const;

interface NormalizedPlayer {
  id: string;
  name: string;
  gameRating: number;
}

@Injectable()
export class AmericanoRatingSimulationService {
  simulateRating(input: AmericanoSimulateRatingInput): AmericanoRatingSimulationResult {
    const players = Array.isArray(input.players) ? input.players : [];
    if (players.length < 4) {
      throw new BadRequestException('At least 4 players are required for rating simulation');
    }

    const params = this.resolveParams(input.params);
    const normalizedPlayers = players.map((player) => this.normalizePlayer(player));
    const playersById = new Map(normalizedPlayers.map((player) => [player.id, player]));
    const currentRatings = new Map(normalizedPlayers.map((player) => [player.id, player.gameRating]));
    const initialRatings = new Map(currentRatings);
    const perPlayerRoundDeltas = new Map<
      string,
      Array<{
        roundNumber: number;
        delta: number;
        ratingAfter: number;
      }>
    >();

    const rounds = (Array.isArray(input.rounds) ? input.rounds : []).map((round) => {
      const roundPlayerResults = new Map<
        string,
        {
          playerId: string;
          playerName: string;
          before: number;
          after: number;
          delta: number;
        }
      >();

      const matches = (Array.isArray(round.matches) ? round.matches : []).map((match) => {
        const result = this.simulateMatch(match, playersById, currentRatings, params);
        result.ratingImpact.forEach((entry) => {
          if (!entry.id) {
            return;
          }

          const previous = roundPlayerResults.get(entry.id);
          if (!previous) {
            roundPlayerResults.set(entry.id, {
              playerId: entry.id,
              playerName: entry.name,
              before: entry.before,
              after: entry.after,
              delta: entry.delta
            });
            return;
          }

          previous.after = entry.after;
          previous.delta = this.roundToPrecision(previous.delta + entry.delta, params.round);
        });

        result.ratingImpact.forEach((entry) => {
          if (!entry.id) {
            return;
          }
          currentRatings.set(entry.id, entry.after);
          const existingHistory = perPlayerRoundDeltas.get(entry.id) ?? [];
          existingHistory.push({
            roundNumber: round.roundNumber,
            delta: entry.delta,
            ratingAfter: entry.after
          });
          perPlayerRoundDeltas.set(entry.id, existingHistory);
        });

        return result;
      });

      return {
        roundNumber: round.roundNumber,
        matches,
        players: Array.from(roundPlayerResults.values()).sort((left, right) =>
          left.playerName.localeCompare(right.playerName, 'ru')
        )
      };
    });

    const playerResults = normalizedPlayers
      .map<AmericanoRatingSimulationPlayerResult>((player) => {
        const initialRating = initialRatings.get(player.id) ?? player.gameRating;
        const finalRating = currentRatings.get(player.id) ?? initialRating;
        return {
          id: player.id,
          name: player.name,
          initialRating,
          finalRating,
          totalDelta: this.roundToPrecision(finalRating - initialRating, params.round),
          gradeBefore: this.mapNumericToRatingGrade(initialRating),
          gradeAfter: this.mapNumericToRatingGrade(finalRating),
          roundDeltas: perPlayerRoundDeltas.get(player.id) ?? []
        };
      })
      .sort((left, right) => right.finalRating - left.finalRating || left.name.localeCompare(right.name, 'ru'));

    const playedMatches = rounds.reduce(
      (sum, round) => sum + round.matches.filter((match) => match.played).length,
      0
    );
    const totalMatches = rounds.reduce((sum, round) => sum + round.matches.length, 0);
    const initialAverageRating = this.roundToPrecision(
      normalizedPlayers.reduce((sum, player) => sum + player.gameRating, 0) / normalizedPlayers.length,
      params.round
    );
    const finalAverageRating = this.roundToPrecision(
      playerResults.reduce((sum, player) => sum + player.finalRating, 0) / playerResults.length,
      params.round
    );
    const biggestGain = playerResults.reduce<AmericanoRatingSimulationResult['diagnostics']['biggestGain']>(
      (best, player) => {
        if (!best || player.totalDelta > best.delta) {
          return { playerId: player.id, delta: player.totalDelta };
        }
        return best;
      },
      null
    );
    const biggestLoss = playerResults.reduce<AmericanoRatingSimulationResult['diagnostics']['biggestLoss']>(
      (best, player) => {
        if (!best || player.totalDelta < best.delta) {
          return { playerId: player.id, delta: player.totalDelta };
        }
        return best;
      },
      null
    );

    return {
      params,
      rounds,
      players: playerResults,
      diagnostics: {
        playedMatches,
        totalMatches,
        initialAverageRating,
        finalAverageRating,
        biggestGain,
        biggestLoss
      }
    };
  }

  private simulateMatch(
    match: AmericanoRatingSimulationMatchInput,
    playersById: Map<string, NormalizedPlayer>,
    currentRatings: Map<string, number>,
    params: Required<AmericanoRatingSimulationParams>
  ): AmericanoRatingSimulationMatchResult {
    const participants = [...match.team1, ...match.team2];
    if (new Set(participants).size !== 4) {
      throw new BadRequestException('Each rating simulation match must contain 4 unique players');
    }

    const teamAPlayers = match.team1.map((playerId) => this.requirePlayer(playerId, playersById));
    const teamBPlayers = match.team2.map((playerId) => this.requirePlayer(playerId, playersById));
    const sets = (Array.isArray(match.sets) ? match.sets : [])
      .map((set) => ({
        team1: this.toFiniteNumber(set?.team1),
        team2: this.toFiniteNumber(set?.team2)
      }))
      .filter(
        (set): set is { team1: number; team2: number } =>
          set.team1 !== null && set.team2 !== null && set.team1 >= 0 && set.team2 >= 0
      );

    if (sets.length === 0) {
      return {
        court: match.court ?? null,
        team1: match.team1,
        team2: match.team2,
        sets: [],
        played: false,
        totalTeam1: 0,
        totalTeam2: 0,
        actualTeam1: null,
        actualTeam2: null,
        ratingImpact: []
      };
    }

    const currentA = teamAPlayers.map((player) => currentRatings.get(player.id) ?? player.gameRating);
    const currentB = teamBPlayers.map((player) => currentRatings.get(player.id) ?? player.gameRating);
    const totalTeam1 = sets.reduce((sum, set) => sum + set.team1, 0);
    const totalTeam2 = sets.reduce((sum, set) => sum + set.team2, 0);
    const actualTeam1 = 1 / (1 + Math.exp(-params.B * (totalTeam1 - totalTeam2)));
    const actualTeam2 = 1 / (1 + Math.exp(-params.B * (totalTeam2 - totalTeam1)));
    const powerA = this.teamRatingPower(currentA);
    const powerB = this.teamRatingPower(currentB);

    const applyDeltas = (
      players: NormalizedPlayer[],
      ratings: number[],
      opponentPower: number,
      actual: number,
      team: 'A' | 'B'
    ): AmericanoRatingImpactEntry[] =>
      players.map((player, index) => {
        const before = Number(ratings[index]);
        const expected = 1 / (1 + Math.pow(10, (opponentPower - before) / params.D));
        const delta = this.roundToPrecision(params.K * (actual - expected), params.round);
        const after = this.roundToPrecision(
          this.clampNumber(before + delta, params.minRating, params.maxRating),
          params.round
        );

        return {
          id: player.id,
          name: player.name,
          team,
          before,
          expected: this.roundToPrecision(expected, params.round),
          actual: this.roundToPrecision(actual, params.round),
          delta,
          after,
          gradeAfter: this.mapNumericToRatingGrade(after)
        };
      });

    return {
      court: match.court ?? null,
      team1: match.team1,
      team2: match.team2,
      sets,
      played: true,
      totalTeam1,
      totalTeam2,
      actualTeam1: this.roundToPrecision(actualTeam1, params.round),
      actualTeam2: this.roundToPrecision(actualTeam2, params.round),
      ratingImpact: [
        ...applyDeltas(teamAPlayers, currentA, powerB, actualTeam1, 'A'),
        ...applyDeltas(teamBPlayers, currentB, powerA, actualTeam2, 'B')
      ]
    };
  }

  private normalizePlayer(player: AmericanoRatingSimulationPlayer): NormalizedPlayer {
    const id = String(player?.id ?? '').trim();
    if (!id) {
      throw new BadRequestException('Each player must have a non-empty id');
    }

    return {
      id,
      name: id,
      gameRating: this.ratingFromAny(player.gameRating ?? player.rating, 2.5)
    };
  }

  private requirePlayer(playerId: string, playersById: Map<string, NormalizedPlayer>): NormalizedPlayer {
    const player = playersById.get(playerId);
    if (!player) {
      throw new BadRequestException(`Player ${playerId} is missing in rating simulation input`);
    }
    return player;
  }

  private resolveParams(
    params: AmericanoRatingSimulationParams | undefined
  ): Required<AmericanoRatingSimulationParams> {
    return {
      K: this.toFiniteNumber(params?.K) ?? DEFAULT_PARAMS.K,
      D: this.toFiniteNumber(params?.D) ?? DEFAULT_PARAMS.D,
      B: this.toFiniteNumber(params?.B) ?? DEFAULT_PARAMS.B,
      minRating: this.toFiniteNumber(params?.minRating) ?? DEFAULT_PARAMS.minRating,
      maxRating: this.toFiniteNumber(params?.maxRating) ?? DEFAULT_PARAMS.maxRating,
      round: Math.max(
        0,
        Math.floor(this.toFiniteNumber(params?.round) ?? DEFAULT_PARAMS.round)
      )
    };
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (!normalized) {
        return null;
      }
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private roundToPrecision(value: number, precision: number): number {
    const safePrecision = Number.isFinite(precision) ? Math.max(0, Math.floor(precision)) : 5;
    return Number(value.toFixed(safePrecision));
  }

  private normalizeRatingNumeric(value: unknown): number | null {
    const numeric = this.toFiniteNumber(value);
    if (numeric === null || numeric < 1 || numeric > 7) {
      return null;
    }
    return numeric;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private mapRatingGradeToNumeric(grade: unknown): number | null {
    const normalized = String(grade ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'D') return 2.0;
    if (normalized === 'D+') return 2.5;
    if (normalized === 'C') return 3.0;
    if (normalized === 'C+') return 3.5;
    if (normalized === 'B') return 4.2;
    if (normalized === 'B+') return 5.0;
    if (normalized === 'A') return 6.0;
    return null;
  }

  private mapNumericToRatingGrade(value: unknown): string | null {
    const numeric = this.toFiniteNumber(value);
    if (numeric === null) return null;
    if (numeric < 2) return 'D';
    if (numeric < 3) return 'D+';
    if (numeric < 3.5) return 'C';
    if (numeric < 4) return 'C+';
    if (numeric < 4.7) return 'B';
    if (numeric < 5.5) return 'B+';
    return 'A';
  }

  private ratingFromAny(value: unknown, fallback = 2.5): number {
    const numeric = this.normalizeRatingNumeric(value);
    if (numeric !== null) return numeric;
    const mapped = this.mapRatingGradeToNumeric(value);
    if (mapped !== null) return mapped;
    return fallback;
  }

  private teamRatingPower(ratings: number[]): number {
    const normalized = ratings.filter((value) => Number.isFinite(value));
    if (normalized.length === 0) return 2.5;
    if (normalized.length === 2) {
      const [first, second] = normalized;
      const denominator = first + second;
      if (denominator > 0) {
        return (first * first + second * second) / denominator;
      }
    }
    return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  }
}
