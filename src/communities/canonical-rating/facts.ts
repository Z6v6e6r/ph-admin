export type CommunityRatingFactEventType = "game" | "tournament" | "visit";

export interface CommunityRatingGameFactMetrics {
  gamesPlayed: 1;
  gamesWon: 0 | 1;
  gamesLost: 0 | 1;
  setsWon: number;
  setsLost: number;
  gamesWonCount: number;
  gamesLostCount: number;
  gamesDiff: number;
  levelDelta: number;
}

export interface CommunityRatingTournamentFactMetrics {
  tournamentsPlayed: 1;
  participantsCount: number;
  place: number;
  placeScore: number;
  placeBonus: number;
  tournamentMatchesWon: number;
  tournamentPointsScored: number;
  tournamentPointsAgainst: number;
  tournamentPointsDiff: number;
  tournamentRawScore: number;
}

export interface CommunityRatingVisitFactMetrics {
  visitsAttended: 1;
}

interface CommunityRatingFactBase {
  id: string;
  communityId: string;
  sourcePostId: string | null;
  eventId: string;
  playerKey: string;
  playerId: string | null;
  playerPhone: string | null;
  playerName: string;
  playerAvatarUrl: string | null;
  currentLevel: number | null;
  ratingDelta: number;
  ratingEventIds: string[];
  lastRatingDelta: number | null;
  lastRatingChangedAt: string | null;
  lastRatingChangedAtTs: number | null;
  lastRatingEventId: string | null;
  occurredAt: string;
  occurredAtTs: number;
  calculationVersion: string;
  collectedAt: string;
}

export type CommunityRatingFact =
  | (CommunityRatingFactBase & {
    eventType: "game";
    metrics: CommunityRatingGameFactMetrics;
  })
  | (CommunityRatingFactBase & {
    eventType: "tournament";
    // Calendar-month awards use the scheduled event date, not the later closing date.
    eventStartedAtTs?: number;
    metrics: CommunityRatingTournamentFactMetrics;
  })
  | (CommunityRatingFactBase & {
    eventType: "visit";
    metrics: CommunityRatingVisitFactMetrics;
  });

export interface CommunityRatingMemberSeed {
  playerKey: string;
  playerId: string | null;
  playerPhone: string | null;
  playerName: string;
  playerAvatarUrl: string | null;
  currentLevel: number | null;
}
