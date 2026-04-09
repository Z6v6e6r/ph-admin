export enum TournamentStatus {
  PLANNED = 'PLANNED',
  REGISTRATION = 'REGISTRATION',
  RUNNING = 'RUNNING',
  FINISHED = 'FINISHED',
  CANCELED = 'CANCELED',
  UNKNOWN = 'UNKNOWN'
}

export type TournamentSource = 'LK_PADELHUB' | 'VIVA' | 'CUSTOM';
export type TournamentGender = 'MALE' | 'FEMALE' | 'MIXED';
export type TournamentPaymentStatus = 'UNPAID' | 'PAID';
export type TournamentParticipantStatus = 'REGISTERED' | 'WAITLIST';
export type TournamentAccessCheckCode =
  | 'OK'
  | 'ONBOARDING_REQUIRED'
  | 'LEVEL_NOT_ALLOWED'
  | 'PHONE_REQUIRED'
  | 'TOURNAMENT_NOT_FOUND';

export interface TournamentParticipant {
  id?: string;
  name: string;
  phone?: string;
  levelLabel?: string;
  gender?: TournamentGender;
  paymentStatus?: TournamentPaymentStatus;
  status?: TournamentParticipantStatus;
  registeredAt?: string;
  paidAt?: string;
  notes?: string;
}

export interface TournamentSkin {
  title?: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string | null;
  ctaLabel?: string;
  badgeLabel?: string;
  tags?: string[];
}

export interface Tournament {
  id: string;
  source: TournamentSource;
  name: string;
  status: TournamentStatus;
  rawStatus?: string;
  gameId?: string;
  studioId?: string;
  studioName?: string;
  trainerId?: string;
  trainerName?: string;
  exerciseTypeId?: string;
  startsAt?: string;
  endsAt?: string;
  createdAt?: string;
  updatedAt?: string;
  details?: Record<string, unknown>;
  linkedCustomTournamentId?: string;
  sourceTournamentId?: string;
  slug?: string;
  publicUrl?: string;
  tournamentType?: string;
  accessLevels?: string[];
  gender?: TournamentGender;
  maxPlayers?: number;
  participants?: TournamentParticipant[];
  participantsCount?: number;
  paidParticipantsCount?: number;
  waitlist?: TournamentParticipant[];
  waitlistCount?: number;
  allowedManagerPhones?: string[];
  skin?: TournamentSkin;
}

export interface CustomTournament extends Tournament {
  source: 'CUSTOM';
  slug: string;
  publicUrl: string;
  tournamentType: string;
  accessLevels: string[];
  gender: TournamentGender;
  maxPlayers: number;
  participants: TournamentParticipant[];
  waitlist: TournamentParticipant[];
  allowedManagerPhones: string[];
  skin: TournamentSkin;
}

export interface TournamentPublicView {
  id: string;
  slug: string;
  publicUrl: string;
  name: string;
  tournamentType: string;
  gender: TournamentGender;
  accessLevels: string[];
  startsAt?: string;
  endsAt?: string;
  studioName?: string;
  trainerName?: string;
  participantsCount: number;
  paidParticipantsCount: number;
  waitlistCount: number;
  maxPlayers: number;
  allowedManagerPhonesCount: number;
  skin: TournamentSkin;
  sourceTournamentId?: string;
  sourceTournament?: Pick<
    Tournament,
    | 'id'
    | 'source'
    | 'name'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'studioName'
    | 'trainerName'
    | 'exerciseTypeId'
  >;
}

export interface TournamentAccessCheckResponse {
  ok: boolean;
  code: TournamentAccessCheckCode;
  message: string;
  tournamentSlug?: string;
  accessLevels: string[];
  levelLabel?: string;
}

export interface TournamentRegistrationResponse {
  ok: boolean;
  code:
    | TournamentAccessCheckCode
    | 'REGISTERED'
    | 'WAITLISTED'
    | 'ALREADY_REGISTERED'
    | 'ALREADY_WAITLISTED';
  message: string;
  tournamentId?: string;
  tournamentSlug?: string;
  participant?: TournamentParticipant;
}

export interface TournamentMechanicsAccessResponse {
  ok: boolean;
  code: 'OK' | 'PHONE_REQUIRED' | 'ACCESS_DENIED';
  message: string;
  tournamentSlug?: string;
}
