export enum GameStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
}

export interface GameParticipantDetails {
  id?: string;
  name: string;
  phone?: string;
  rating?: string | number;
  status?: string;
  role?: string;
  photo?: string;
}

export type GamePlayerRemovalRefundPolicy = 'RETURN_VISIT' | 'NO_RETURN';
export type GamePlayerRemovalStatus = 'PENDING' | 'DONE' | 'FAILED';

/**
 * The durable leave operation is owned by LK. CUP deliberately does not
 * maintain a local operation or roster projection for it.
 */
export interface GamePlayerRemovalRequest {
  operationId: string;
  gameId: string;
  playerId: string;
  refundPolicy: GamePlayerRemovalRefundPolicy;
  status: GamePlayerRemovalStatus;
  message?: string;
  retryAfterMs?: number;
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
  organizerPhone?: string;
  organizerId?: string;
  organizerRating?: string | number;
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
  maxPlayers?: number;
  waitlistEnabled?: boolean;
  archived?: boolean;
  isPrivate?: boolean;
  ratingGame?: boolean;
  minRating?: string | number;
  maxRating?: string | number;
  payMode?: string;
  inviteUrl?: string;
  communityPublicationEnabled?: boolean;
  communityPublished?: boolean;
  chatAvailable?: boolean;
  paymentPaid?: boolean;
  paymentAmount?: number;
  paymentMethod?: string;
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
export type GameListLifecycle = 'active' | 'cancelled' | 'all';
export type GameListQuickFilter = 'today' | 'upcoming' | 'past' | 'noResult' | 'cancelled';
export type GameListPublication = 'public' | 'link' | 'community' | 'hidden' | 'unpublished';

export interface GameListFilters {
  phone?: string;
  query?: string;
  date?: string;
  station?: string;
  status?: string;
  publication?: GameListPublication;
  quickFilter?: GameListQuickFilter;
  lifecycle?: GameListLifecycle;
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
