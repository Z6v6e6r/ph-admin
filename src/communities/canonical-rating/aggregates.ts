import {
  buildRatingBadges,
  calculateActivityScore,
  calculateGamesScore,
  calculateOverallScore,
  calculateTournamentScore,
  normalizeScore,
  sortRatingItems,
  type CommunityRatingItem,
} from "./calculations";
import {
  COMMUNITY_RATING_CALCULATION_VERSION,
  COMMUNITY_RATING_PERIODS,
  getCommunityRatingMonthStartTs,
  normalizeCommunityRatingPeriod,
  normalizeCommunityRatingTab,
  type CommunityRatingPeriod,
  type CommunityRatingTab,
  type CommunityRatingTabInput,
} from "./contract";
import type { CommunityRatingFact, CommunityRatingMemberSeed } from "./facts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BuildCommunityRatingAggregatesParams {
  communityId: string;
  facts: CommunityRatingFact[];
  members?: CommunityRatingMemberSeed[] | null;
  period?: CommunityRatingPeriod | string | null;
  nowTs?: number;
  updatedAt?: string | null;
  calculationVersion?: string | null;
}

export interface BuildCommunityRatingSnapshotParams extends BuildCommunityRatingAggregatesParams {
  tab?: CommunityRatingTabInput | string | null;
}

export interface BuildCommunityRatingSnapshotsParams extends BuildCommunityRatingAggregatesParams {
  tabs?: Array<CommunityRatingTabInput | string> | null;
  periods?: Array<CommunityRatingPeriod | string> | null;
}

export interface CommunityRatingAggregate extends CommunityRatingItem {
  playerKey: string;
  playerPhone: string | null;
  period: CommunityRatingPeriod;
  calculationVersion: string;
  updatedAt: string;
  updatedAtTs: number;
}

export interface CommunityRatingSnapshotRow extends CommunityRatingAggregate {
  rank: number;
}

export interface CommunityRatingSnapshot {
  id: string;
  communityId: string;
  tab: CommunityRatingTab;
  period: CommunityRatingPeriod;
  calculationVersion: string;
  updatedAt: string;
  updatedAtTs: number;
  dataThrough: string | null;
  dataThroughTs: number | null;
  sourceVersion: string;
  rows: CommunityRatingSnapshotRow[];
  items: CommunityRatingSnapshotRow[];
}

interface AggregateState {
  communityId: string;
  playerKey: string;
  playerId: string | null;
  playerPhone: string | null;
  playerName: string;
  avatarUrl: string | null;
  currentLevel: number;
  identityTs: number;
  levelDelta: number;
  lastRatingDelta: number | null;
  lastRatingChangedAtTs: number;
  lastRatingEventKey: string | null;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  gamesWonCount: number;
  gamesDiff: number;
  tournamentsPlayed: number;
  tournamentMatchesWon: number;
  tournamentPointsScored: number;
  tournamentPointsDiff: number;
  tournamentRawScore: number;
  bestPlace: number | null;
  placesSum: number;
  visitsAttended: number;
  lastActivityTs: number;
}

function roundTo(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeUpdatedAt(value: string | null | undefined, nowTs: number): string {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(nowTs).toISOString();
}

export function getCommunityRatingPeriodStartTs(
  period: CommunityRatingPeriod | string | null | undefined,
  nowTs: number,
): number | null {
  const safePeriod = normalizeCommunityRatingPeriod(period);
  if (safePeriod === "all") return null;
  if (safePeriod === "month") return getCommunityRatingMonthStartTs(nowTs);
  return nowTs - (30 * DAY_MS);
}

function getFactPeriodTimestamp(fact: CommunityRatingFact, period: CommunityRatingPeriod): number {
  return period === "month" && fact.eventType === "tournament"
    ? (fact.eventStartedAtTs ?? fact.occurredAtTs)
    : fact.occurredAtTs;
}

function isFactInPeriod(fact: CommunityRatingFact, period: CommunityRatingPeriod, nowTs: number): boolean {
  const periodStartTs = getCommunityRatingPeriodStartTs(period, nowTs);
  if (periodStartTs == null) return true;
  const eventTs = getFactPeriodTimestamp(fact, period);
  return eventTs >= periodStartTs && eventTs <= nowTs && fact.occurredAtTs <= nowTs;
}

function createEmptyState(fact: CommunityRatingFact): AggregateState {
  return {
    communityId: fact.communityId,
    playerKey: fact.playerKey,
    playerId: fact.playerId,
    playerPhone: fact.playerPhone,
    playerName: fact.playerName,
    avatarUrl: fact.playerAvatarUrl,
    currentLevel: fact.currentLevel ?? 0,
    identityTs: fact.occurredAtTs,
    levelDelta: 0,
    lastRatingDelta: null,
    lastRatingChangedAtTs: 0,
    lastRatingEventKey: null,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    setsWon: 0,
    gamesWonCount: 0,
    gamesDiff: 0,
    tournamentsPlayed: 0,
    tournamentMatchesWon: 0,
    tournamentPointsScored: 0,
    tournamentPointsDiff: 0,
    tournamentRawScore: 0,
    bestPlace: null,
    placesSum: 0,
    visitsAttended: 0,
    lastActivityTs: 0,
  };
}

function createEmptyMemberState(communityId: string, member: CommunityRatingMemberSeed): AggregateState {
  return {
    communityId,
    playerKey: member.playerKey,
    playerId: member.playerId,
    playerPhone: member.playerPhone,
    playerName: member.playerName,
    avatarUrl: member.playerAvatarUrl,
    currentLevel: member.currentLevel ?? 0,
    identityTs: 0,
    levelDelta: 0,
    lastRatingDelta: null,
    lastRatingChangedAtTs: 0,
    lastRatingEventKey: null,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    setsWon: 0,
    gamesWonCount: 0,
    gamesDiff: 0,
    tournamentsPlayed: 0,
    tournamentMatchesWon: 0,
    tournamentPointsScored: 0,
    tournamentPointsDiff: 0,
    tournamentRawScore: 0,
    bestPlace: null,
    placesSum: 0,
    visitsAttended: 0,
    lastActivityTs: 0,
  };
}

function updateStateIdentity(state: AggregateState, fact: CommunityRatingFact) {
  if (fact.occurredAtTs < state.identityTs) return;
  state.identityTs = fact.occurredAtTs;
  state.playerId = fact.playerId ?? state.playerId;
  state.playerPhone = fact.playerPhone ?? state.playerPhone;
  state.playerName = fact.playerName || state.playerName;
  state.avatarUrl = fact.playerAvatarUrl ?? state.avatarUrl;
  state.currentLevel = fact.currentLevel ?? state.currentLevel;
}

function updateLastRatingChange(
  state: AggregateState,
  fact: CommunityRatingFact,
) {
  const delta = Number(fact.lastRatingDelta);
  if (!Number.isFinite(delta) || delta === 0) return;
  const explicitTs = Number(fact.lastRatingChangedAtTs);
  const parsedTs = Date.parse(String(fact.lastRatingChangedAt || ""));
  const changedAtTs = Number.isFinite(explicitTs) && explicitTs > 0
    ? explicitTs
    : (Number.isFinite(parsedTs) ? parsedTs : 0);
  if (changedAtTs <= 0) return;
  const eventKey = fact.lastRatingEventId || `${fact.eventId}:${fact.id}`;
  const isNewer = changedAtTs > state.lastRatingChangedAtTs;
  const isSameTimeButLaterKey = changedAtTs === state.lastRatingChangedAtTs
    && (state.lastRatingEventKey == null || eventKey.localeCompare(state.lastRatingEventKey) > 0);
  if (!isNewer && !isSameTimeButLaterKey) return;

  state.lastRatingDelta = roundTo(delta);
  state.lastRatingChangedAtTs = changedAtTs;
  state.lastRatingEventKey = eventKey;
}

function isRatingChangeInPeriod(
  fact: CommunityRatingFact,
  period: CommunityRatingPeriod,
  nowTs: number,
): boolean {
  const explicitTs = Number(fact.lastRatingChangedAtTs);
  const parsedTs = Date.parse(String(fact.lastRatingChangedAt || ""));
  const changedAtTs = Number.isFinite(explicitTs) && explicitTs > 0
    ? explicitTs
    : (Number.isFinite(parsedTs) ? parsedTs : 0);
  if (changedAtTs <= 0 || changedAtTs > nowTs) return false;
  const periodStartTs = getCommunityRatingPeriodStartTs(period, nowTs);
  return periodStartTs == null || changedAtTs >= periodStartTs;
}

function toRatingItem(
  state: AggregateState,
  period: CommunityRatingPeriod,
  updatedAt: string,
  updatedAtTs: number,
  calculationVersion: string,
): CommunityRatingAggregate {
  const gamesScoreParts = calculateGamesScore({
    gamesWon: state.gamesWon,
    setsWon: state.setsWon,
    gamesWonCount: state.gamesWonCount,
    gamesDiff: state.gamesDiff,
    levelDelta: state.levelDelta,
    gamesPlayed: state.gamesPlayed,
  });
  const tournamentScoreParts = calculateTournamentScore(
    state.tournamentRawScore,
    state.tournamentsPlayed,
  );
  const totalEventsPlayed = state.gamesPlayed + state.tournamentsPlayed + state.visitsAttended;
  const lastActivityAt = state.lastActivityTs > 0 ? new Date(state.lastActivityTs).toISOString() : null;
  const lastRatingChangedAt = state.lastRatingChangedAtTs > 0
    ? new Date(state.lastRatingChangedAtTs).toISOString()
    : null;

  return {
    communityId: state.communityId,
    playerKey: state.playerKey,
    playerId: state.playerId ?? state.playerPhone ?? state.playerKey,
    playerPhone: state.playerPhone,
    playerName: state.playerName,
    avatarUrl: state.avatarUrl,
    currentLevel: roundTo(state.currentLevel),
    levelDelta: roundTo(state.levelDelta),
    lastRatingDelta: state.lastRatingDelta,
    lastRatingChangedAt,
    gamesPlayed: state.gamesPlayed,
    gamesWon: state.gamesWon,
    gamesLost: state.gamesLost,
    winRate: state.gamesPlayed > 0 ? roundTo(state.gamesWon / state.gamesPlayed) : 0,
    setsWon: state.setsWon,
    gamesWonCount: state.gamesWonCount,
    gamesDiff: state.gamesDiff,
    gamesRawScore: gamesScoreParts.gamesRawScore,
    gamesReliabilityFactor: gamesScoreParts.gamesReliabilityFactor,
    gamesScore: gamesScoreParts.gamesScore,
    gamesNormalized: 0,
    tournamentsPlayed: state.tournamentsPlayed,
    tournamentMatchesWon: state.tournamentMatchesWon,
    tournamentPointsScored: state.tournamentPointsScored,
    tournamentPointsDiff: state.tournamentPointsDiff,
    bestPlace: state.bestPlace,
    averagePlace: state.tournamentsPlayed > 0 ? roundTo(state.placesSum / state.tournamentsPlayed, 2) : null,
    tournamentRawScore: tournamentScoreParts.tournamentRawScore,
    tournamentReliabilityFactor: tournamentScoreParts.tournamentReliabilityFactor,
    tournamentScore: tournamentScoreParts.tournamentScore,
    tournamentNormalized: 0,
    visitsAttended: state.visitsAttended,
    activityScore: calculateActivityScore(state.gamesPlayed, state.tournamentsPlayed, state.visitsAttended),
    overallScore: 0,
    totalEventsPlayed,
    lastActivityAt,
    badges: [],
    period,
    calculationVersion,
    updatedAt,
    updatedAtTs,
  };
}

function buildSnapshotId(input: {
  communityId: string;
  tab: CommunityRatingTab;
  period: CommunityRatingPeriod;
  calculationVersion: string;
}): string {
  return [
    input.communityId,
    input.period,
    input.tab,
    input.calculationVersion,
  ].map((part) => encodeURIComponent(part)).join(":");
}

export function buildCommunityRatingAggregates(
  params: BuildCommunityRatingAggregatesParams,
): CommunityRatingAggregate[] {
  const communityId = params.communityId.trim();
  if (!communityId) return [];

  const period = normalizeCommunityRatingPeriod(params.period);
  const nowTs = Number.isFinite(params.nowTs) ? Number(params.nowTs) : Date.now();
  const updatedAt = normalizeUpdatedAt(params.updatedAt, nowTs);
  const updatedAtTs = Date.parse(updatedAt);
  const calculationVersion = params.calculationVersion || COMMUNITY_RATING_CALCULATION_VERSION;
  const stateByPlayerKey = new Map<string, AggregateState>();

  (params.members || []).forEach((member) => {
    if (!member.playerKey || stateByPlayerKey.has(member.playerKey)) return;
    stateByPlayerKey.set(member.playerKey, createEmptyMemberState(communityId, member));
  });

  params.facts.forEach((fact) => {
    if (fact.communityId !== communityId) return;
    if (fact.calculationVersion !== calculationVersion) return;
    if (!isFactInPeriod(fact, period, nowTs)) return;

    const state = stateByPlayerKey.get(fact.playerKey) ?? createEmptyState(fact);
    stateByPlayerKey.set(fact.playerKey, state);
    updateStateIdentity(state, fact);
    state.lastActivityTs = Math.max(state.lastActivityTs, fact.occurredAtTs);

    if (fact.eventType === "game") {
      state.gamesPlayed += fact.metrics.gamesPlayed;
      state.gamesWon += fact.metrics.gamesWon;
      state.gamesLost += fact.metrics.gamesLost;
      state.setsWon += fact.metrics.setsWon;
      state.gamesWonCount += fact.metrics.gamesWonCount;
      state.gamesDiff += fact.metrics.gamesDiff;
      const ratingDelta = Number.isFinite(Number(fact.ratingDelta))
        ? Number(fact.ratingDelta)
        : fact.metrics.levelDelta;
      state.levelDelta = roundTo(state.levelDelta + ratingDelta);
      return;
    }

    if (fact.eventType === "visit") {
      state.visitsAttended += fact.metrics.visitsAttended;
      return;
    }

    if (Number.isFinite(Number(fact.ratingDelta))) {
      const ratingDelta = Number(fact.ratingDelta);
      state.levelDelta = roundTo(state.levelDelta + ratingDelta);
    }

    state.tournamentsPlayed += fact.metrics.tournamentsPlayed;
    state.tournamentMatchesWon += fact.metrics.tournamentMatchesWon;
    state.tournamentPointsScored += fact.metrics.tournamentPointsScored;
    state.tournamentPointsDiff += fact.metrics.tournamentPointsDiff;
    state.tournamentRawScore = roundTo(state.tournamentRawScore + fact.metrics.tournamentRawScore);
    state.bestPlace = state.bestPlace == null
      ? fact.metrics.place
      : Math.min(state.bestPlace, fact.metrics.place);
    state.placesSum += fact.metrics.place;
  });

  params.facts.forEach((fact) => {
    if (fact.communityId !== communityId) return;
    if (fact.calculationVersion !== calculationVersion) return;
    if (!isRatingChangeInPeriod(fact, period, nowTs)) return;
    const state = stateByPlayerKey.get(fact.playerKey);
    if (!state) return;
    updateLastRatingChange(state, fact);
  });

  const rows = Array.from(stateByPlayerKey.values())
    .map((state) => toRatingItem(state, period, updatedAt, updatedAtTs, calculationVersion));

  const maxGamesScore = rows.reduce((maxScore, row) => Math.max(maxScore, row.gamesScore), 0);
  const maxTournamentScore = rows.reduce((maxScore, row) => Math.max(maxScore, row.tournamentScore), 0);

  rows.forEach((row) => {
    row.gamesNormalized = normalizeScore(row.gamesScore, maxGamesScore);
    row.tournamentNormalized = normalizeScore(row.tournamentScore, maxTournamentScore);
    row.overallScore = calculateOverallScore(
      row.gamesNormalized,
      row.tournamentNormalized,
      row.activityScore,
    );
    row.badges = buildRatingBadges(row, { nowTs });
  });

  return rows;
}

export function buildCommunityRatingSnapshot(
  params: BuildCommunityRatingSnapshotParams,
): CommunityRatingSnapshot {
  const communityId = params.communityId.trim();
  const tab = normalizeCommunityRatingTab(params.tab);
  const period = normalizeCommunityRatingPeriod(params.period);
  const calculationVersion = params.calculationVersion || COMMUNITY_RATING_CALCULATION_VERSION;
  const nowTs = Number.isFinite(params.nowTs) ? Number(params.nowTs) : Date.now();
  const updatedAt = normalizeUpdatedAt(params.updatedAt, nowTs);
  const updatedAtTs = Date.parse(updatedAt);
  const aggregates = buildCommunityRatingAggregates({
    ...params,
    communityId,
    period,
    nowTs,
    updatedAt,
    calculationVersion,
  });
  const sortedAggregates = sortRatingItems(aggregates, tab) as CommunityRatingAggregate[];
  const rows: CommunityRatingSnapshotRow[] = sortedAggregates.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
  const dataThroughTs = params.facts.reduce<number | null>((latest, fact) => {
    if (fact.communityId !== communityId || fact.calculationVersion !== calculationVersion) return latest;
    if (!isFactInPeriod(fact, period, nowTs) || fact.occurredAtTs > nowTs) return latest;
    const eventTs = getFactPeriodTimestamp(fact, period);
    return latest == null ? eventTs : Math.max(latest, eventTs);
  }, null);

  return {
    id: buildSnapshotId({ communityId, tab, period, calculationVersion }),
    communityId,
    tab,
    period,
    calculationVersion,
    updatedAt,
    updatedAtTs,
    dataThrough: dataThroughTs == null ? null : new Date(dataThroughTs).toISOString(),
    dataThroughTs,
    sourceVersion: "rating_events+player_rating_state+attendance-v1",
    rows,
    items: rows,
  };
}

export function buildCommunityRatingSnapshots(
  params: BuildCommunityRatingSnapshotsParams,
): CommunityRatingSnapshot[] {
  const tabs = (params.tabs?.length ? params.tabs : ["overall", "dynamics", "games", "tournaments"])
    .map((tab) => normalizeCommunityRatingTab(tab));
  const periods = (params.periods?.length ? params.periods : [...COMMUNITY_RATING_PERIODS])
    .map((period) => normalizeCommunityRatingPeriod(period));
  const snapshots: CommunityRatingSnapshot[] = [];

  periods.forEach((period) => {
    tabs.forEach((tab) => {
      snapshots.push(buildCommunityRatingSnapshot({
        ...params,
        period,
        tab,
      }));
    });
  });

  return snapshots;
}