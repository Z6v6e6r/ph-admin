export enum GameStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
}

export interface GameParticipantDetails {
  name: string;
  phone?: string;
}

export interface Game {
  id: string;
  source: 'LK_PADELHUB' | 'LK_PADELHUB_MONGO';
  name: string;
  status: GameStatus;
  rawStatus?: string;
  tournamentId?: string;
  startsAt?: string;
  createdAt?: string;
  updatedAt?: string;
  organizerName?: string;
  participantNames?: string[];
  participantDetails?: GameParticipantDetails[];
  gameDate?: string;
  gameTime?: string;
  stationName?: string;
  courtName?: string;
  locationName?: string;
  teamParticipantLines?: string[];
  result?: string;
  resultLines?: string[];
  ratingDelta?: string;
  ratingDeltaLines?: string[];
  details?: Record<string, unknown>;
}

export interface GameEvent {
  id: string;
  event: string;
  timestamp?: string;
  sessionId?: string;
  source?: string;
  tenantKey?: string;
  pagePath?: string;
  pageHref?: string;
  userPhone?: string;
  userClientId?: string;
  userName?: string;
  payloadLabel?: string;
  payloadModule?: string;
  payloadSource?: string;
  payloadStatus?: string;
  payloadMessage?: string;
  payloadError?: string;
  details?: Record<string, unknown>;
}

export interface GameEventListFilters {
  event?: string;
  phone?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface GameEventListResult {
  items: GameEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type GameListSortField = 'createdAt' | 'gameDate' | 'organizer';
export type GameListSortDirection = 'asc' | 'desc';

export interface GameListFilters {
  page?: number;
  pageSize?: number;
  sortField?: GameListSortField;
  sortDirection?: GameListSortDirection;
}

export interface GameListResult {
  items: Game[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortField: GameListSortField;
  sortDirection: GameListSortDirection;
}

export interface GameAnalyticsFilters {
  from?: string;
  to?: string;
}

export interface GameAnalyticsStationRow {
  stationName: string;
  gamesCount: number;
  playersAddedCount: number;
  paymentsAmount: number;
}

export interface GameAnalyticsTotals {
  gamesCount: number;
  playersAddedCount: number;
  paymentsAmount: number;
}

export interface GameAnalyticsResult {
  from?: string;
  to?: string;
  items: GameAnalyticsStationRow[];
  totals: GameAnalyticsTotals;
}

export interface GameChatMessage {
  id: string;
  gameId: string;
  text: string;
  createdAt: string;
  senderId?: string;
  senderName?: string;
  senderRole?: string;
  senderRoleRaw?: string;
  type?: string;
}

export interface GameChatContext {
  game: Game;
  gameId: string;
  source: 'GAMES_CHAT_MONGO';
  messages: GameChatMessage[];
}
