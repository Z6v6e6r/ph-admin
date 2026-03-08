export enum GameStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  UNKNOWN = 'UNKNOWN'
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
  gameDate?: string;
  gameTime?: string;
  locationName?: string;
}
