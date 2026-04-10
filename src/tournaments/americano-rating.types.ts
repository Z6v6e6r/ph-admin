import { AmericanoPair, AmericanoPlayer } from './americano-schedule.types';

export interface AmericanoRatingSimulationParams {
  K?: number;
  D?: number;
  B?: number;
  minRating?: number;
  maxRating?: number;
  round?: number;
}

export interface AmericanoRatingSimulationSetInput {
  team1?: number | null;
  team2?: number | null;
}

export interface AmericanoRatingSimulationMatchInput {
  court?: number | null;
  team1: AmericanoPair;
  team2: AmericanoPair;
  sets?: AmericanoRatingSimulationSetInput[];
}

export interface AmericanoRatingSimulationRoundInput {
  roundNumber: number;
  matches: AmericanoRatingSimulationMatchInput[];
}

export interface AmericanoRatingSimulationPlayer extends AmericanoPlayer {}

export interface AmericanoRatingImpactEntry {
  id: string | null;
  name: string;
  team: 'A' | 'B' | null;
  before: number;
  expected: number;
  actual: number;
  delta: number;
  after: number;
  gradeAfter: string | null;
}

export interface AmericanoRatingSimulationMatchResult {
  court?: number | null;
  team1: AmericanoPair;
  team2: AmericanoPair;
  sets: Array<{
    team1: number;
    team2: number;
  }>;
  played: boolean;
  totalTeam1: number;
  totalTeam2: number;
  actualTeam1: number | null;
  actualTeam2: number | null;
  ratingImpact: AmericanoRatingImpactEntry[];
}

export interface AmericanoRatingSimulationRoundPlayerResult {
  playerId: string;
  playerName: string;
  before: number;
  after: number;
  delta: number;
}

export interface AmericanoRatingSimulationRoundResult {
  roundNumber: number;
  matches: AmericanoRatingSimulationMatchResult[];
  players: AmericanoRatingSimulationRoundPlayerResult[];
}

export interface AmericanoRatingSimulationPlayerRoundDelta {
  roundNumber: number;
  delta: number;
  ratingAfter: number;
}

export interface AmericanoRatingSimulationPlayerResult {
  id: string;
  name: string;
  initialRating: number;
  finalRating: number;
  totalDelta: number;
  gradeBefore: string | null;
  gradeAfter: string | null;
  roundDeltas: AmericanoRatingSimulationPlayerRoundDelta[];
}

export interface AmericanoRatingSimulationDiagnostics {
  playedMatches: number;
  totalMatches: number;
  initialAverageRating: number;
  finalAverageRating: number;
  biggestGain: {
    playerId: string;
    delta: number;
  } | null;
  biggestLoss: {
    playerId: string;
    delta: number;
  } | null;
}

export interface AmericanoRatingSimulationResult {
  params: {
    K: number;
    D: number;
    B: number;
    minRating: number;
    maxRating: number;
    round: number;
  };
  rounds: AmericanoRatingSimulationRoundResult[];
  players: AmericanoRatingSimulationPlayerResult[];
  diagnostics: AmericanoRatingSimulationDiagnostics;
}

export interface AmericanoSimulateRatingInput {
  players: AmericanoRatingSimulationPlayer[];
  rounds: AmericanoRatingSimulationRoundInput[];
  params?: AmericanoRatingSimulationParams;
}
