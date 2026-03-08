export enum TournamentStatus {
  PLANNED = 'PLANNED',
  REGISTRATION = 'REGISTRATION',
  RUNNING = 'RUNNING',
  FINISHED = 'FINISHED',
  CANCELED = 'CANCELED',
  UNKNOWN = 'UNKNOWN'
}

export interface Tournament {
  id: string;
  source: 'LK_PADELHUB';
  name: string;
  status: TournamentStatus;
  rawStatus?: string;
  gameId?: string;
  startsAt?: string;
  endsAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
