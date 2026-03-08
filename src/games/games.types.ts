import { ChatMessage, ChatThread } from '../messenger/messenger.types';

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
  locationName?: string;
  details?: Record<string, unknown>;
}

export interface GameChatContext {
  game: Game;
  thread: ChatThread;
  messages: ChatMessage[];
}
