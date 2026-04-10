export type TournamentMode =
  | 'full_americano'
  | 'short_americano'
  | 'competitive_americano'
  | 'dynamic_americano';

export type StrictnessLevel = 'high' | 'medium' | 'low';
export type FirstRoundSeedingMode = 'auto' | 'rating_quartets' | 'off';

export interface AmericanoPlayer {
  id: string;
  rating: number;
  gameRating?: number | null;
  verifiedFactor?: number;
  regularityFactor?: number;
  engagementFactor?: number;
  gamesPlayed?: number;
  lastGameAt?: string | null;
}

export interface AmericanoPenaltyWeights {
  partnerRepeat: number;
  partnerImmediateRepeat: number;
  opponentRepeat: number;
  opponentRecentRepeat: number;
  balance: number;
  unevenBye: number;
  consecutiveBye: number;
  pairInternalImbalance: number;
}

export interface AmericanoGeneratorConfig {
  mode: TournamentMode;
  rounds?: number | null;
  courts?: number | null;
  useRatings: boolean;
  firstRoundSeeding?: FirstRoundSeedingMode;
  roundExactThreshold?: number;
  balanceOutlierThreshold?: number;
  balanceOutlierWeight?: number;
  strictPartnerUniqueness: StrictnessLevel;
  strictBalance: StrictnessLevel;
  avoidRepeatOpponents: boolean;
  avoidRepeatPartners: boolean;
  distributeByesEvenly: boolean;
  historyDepth?: number;
  localSearchIterations?: number;
  pairingExactThreshold?: number;
  matchExactThreshold?: number;
  weights?: Partial<AmericanoPenaltyWeights>;
}

export type AmericanoPair = [string, string];

export interface AmericanoHistoricalMatch {
  team1: AmericanoPair;
  team2: AmericanoPair;
}

export interface AmericanoHistoricalRound {
  roundNumber?: number;
  matches: AmericanoHistoricalMatch[];
  byes?: string[];
}

export interface AmericanoMatch {
  court?: number | null;
  team1: AmericanoPair;
  team2: AmericanoPair;
  quality: {
    balanceScore: number;
    repeatedPartnersPenalty: number;
    repeatedOpponentsPenalty: number;
    totalCost: number;
  };
}

export interface AmericanoRound {
  roundNumber: number;
  matches: AmericanoMatch[];
  byes: string[];
}

export interface AmericanoPlayerCoverage {
  uniquePartners: number;
  missingPartners: number;
}

export interface AmericanoBalanceDiagnostics {
  averagePenalty: number;
  medianPenalty: number;
  worstPenalty: number;
}

export interface AmericanoByeDiagnostics {
  min: number;
  max: number;
  standardDeviation: number;
  consecutiveByes: string[];
}

export interface AmericanoScheduleDiagnostics {
  totalPlayers: number;
  totalRounds: number;
  partnerCoveragePercent: number;
  opponentCoveragePercent: number;
  byesDistribution: Record<string, number>;
  repeatedPartnerPairs: Array<[string, string]>;
  repeatedOpponentPairs: Array<[string, string]>;
  partnerCoverageByPlayer: Record<string, AmericanoPlayerCoverage>;
  balance: AmericanoBalanceDiagnostics;
  byeStats: AmericanoByeDiagnostics;
}

export interface AmericanoScheduleResult {
  rounds: AmericanoRound[];
  diagnostics: AmericanoScheduleDiagnostics;
}

export interface AmericanoGenerateScheduleInput {
  players: AmericanoPlayer[];
  config: AmericanoGeneratorConfig;
  history?: AmericanoHistoricalRound[];
}
