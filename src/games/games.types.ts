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
