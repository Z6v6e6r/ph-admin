export const COMMUNITY_RATING_CALCULATION_VERSION = "community-rating-v1.3.0";

// Visits are community-scoped explicitly. A visit without communityId is counted
// only for the station community mapped here, never for every community membership.
export const COMMUNITY_RATING_VISIT_SCOPE_BY_COMMUNITY_ID: Readonly<Record<string, readonly string[]>> = {
  "community_1775049528064_хаб-нагатинская": ["6b2d7e60-caff-4b22-89f6-6f19d7d311ab"],
  "community_1775049565359_хаб-нагатинская-премиум": ["42c6d4df-833d-480a-bdc8-986716569884"],
  "community_1775048637790_хаб-селигерская": ["3656cbaa-6426-490f-a44f-915404cbdd2b"],
  "community_1775049468308_хаб-сколково": ["0d5504f6-ea6f-44bb-a9e4-947faf0273ab"],
  "community_1775049417739_хаб-терехово": ["6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1"],
  "community_1775049502538_хаб-ясенево": ["588b6151-f4f5-47d9-9449-80edf8cbc748"],
};

export const COMMUNITY_RATING_TABS = ["overall", "dynamics", "games", "tournaments"] as const;
export const COMMUNITY_RATING_LEGACY_TABS = ["level"] as const;
export const COMMUNITY_RATING_PERIODS = ["all", "30d", "month"] as const;
export const DEFAULT_COMMUNITY_RATING_PERIOD = "30d";

export type CommunityRatingTab = (typeof COMMUNITY_RATING_TABS)[number];
export type CommunityRatingLegacyTab = (typeof COMMUNITY_RATING_LEGACY_TABS)[number];
export type CommunityRatingTabInput = CommunityRatingTab | CommunityRatingLegacyTab;
export type CommunityRatingPeriod = (typeof COMMUNITY_RATING_PERIODS)[number];

export const COMMUNITY_RATING_GAMES_RAW_WEIGHTS = {
  matchWin: 10,
  setWin: 3,
  gameWin: 0.5,
  gameDiff: 1,
  levelDelta: 100,
} as const;

export const COMMUNITY_RATING_TOURNAMENT_RAW_WEIGHTS = {
  matchWin: 8,
  pointScored: 0.5,
  pointDiff: 1,
} as const;

export const COMMUNITY_RATING_PLACE_BONUS_BY_PLACE = {
  1: 30,
  2: 20,
  3: 10,
} as const;

export const COMMUNITY_RATING_GAMES_RELIABILITY_FACTORS = [
  { minGames: 0, maxGames: 0, factor: 0 },
  { minGames: 1, maxGames: 2, factor: 0.6 },
  { minGames: 3, maxGames: 5, factor: 0.8 },
  { minGames: 6, maxGames: null, factor: 1 },
] as const;

export const COMMUNITY_RATING_TOURNAMENT_RELIABILITY_FACTORS = [
  { minTournaments: 0, maxTournaments: 0, factor: 0 },
  { minTournaments: 1, maxTournaments: 1, factor: 0.8 },
  { minTournaments: 2, maxTournaments: null, factor: 1 },
] as const;

export const COMMUNITY_RATING_ACTIVITY_WEIGHTS = {
  game: 4,
  tournament: 12,
  visit: 2,
  max: 100,
} as const;

export const COMMUNITY_RATING_OVERALL_WEIGHTS = {
  games: 0.2,
  tournaments: 0.6,
  activity: 0.2,
} as const;

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeCommunityRatingTab(value: unknown): CommunityRatingTab {
  const normalized = normalize(value);
  if (normalized === "games" || normalized === "tournaments" || normalized === "overall") {
    return normalized;
  }
  if (normalized === "dynamics" || normalized === "dynamic" || normalized === "level") {
    return "dynamics";
  }
  return "overall";
}

export function toCommunityRatingTransportTab(tab: CommunityRatingTab): CommunityRatingLegacyTab | Exclude<CommunityRatingTab, "dynamics"> {
  // Backend flows still accept the historical "level" tab; keep this bridge until migration is complete.
  return tab === "dynamics" ? "level" : tab;
}

export function normalizeCommunityRatingPeriod(value: unknown): CommunityRatingPeriod {
  const normalized = normalize(value);
  if (normalized === "month") return "month";
  if (
    normalized === "30d"
    || normalized === "30days"
    || normalized === "7d"
    || normalized === "7days"
    || normalized === "week"
    || normalized === "90d"
    || normalized === "90days"
    || normalized === "quarter"
  ) return "30d";
  if (normalized === "all" || normalized === "alltime" || normalized === "year") return "all";
  return DEFAULT_COMMUNITY_RATING_PERIOD;
}

// Moscow has used UTC+3 without seasonal changes since 2014.
export function getCommunityRatingMonthStartTs(nowTs: number): number {
  const moscowDate = new Date(nowTs + 3 * 60 * 60 * 1000);
  return Date.UTC(moscowDate.getUTCFullYear(), moscowDate.getUTCMonth(), 1) - 3 * 60 * 60 * 1000;
}

export function isCommunityRatingSnapshotForPeriod(
  requestedPeriod: CommunityRatingPeriod,
  snapshotPeriod: CommunityRatingPeriod,
  updatedAt: string | null,
  nowTs: number,
): boolean {
  if (requestedPeriod !== snapshotPeriod) return false;
  if (requestedPeriod !== "month") return true;
  const updatedAtTs = Date.parse(updatedAt || "");
  return updatedAtTs >= getCommunityRatingMonthStartTs(nowTs) && updatedAtTs <= nowTs;
}