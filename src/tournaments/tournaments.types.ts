import {
  AmericanoGeneratorConfig,
  AmericanoHistoricalRound
} from './americano-schedule.types';

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
export type TournamentWaitlistReason = 'FULL' | 'LEVEL_MISMATCH' | 'MANUAL';
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
  avatarUrl?: string | null;
  gender?: TournamentGender;
  paymentStatus?: TournamentPaymentStatus;
  status?: TournamentParticipantStatus;
  waitlistReason?: TournamentWaitlistReason;
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
  priceLabel?: string;
  badgeLabel?: string;
  tags?: string[];
}

export interface TournamentActor {
  id?: string;
  login?: string;
  name?: string;
}

export interface TournamentMechanics {
  enabled: boolean;
  config: AmericanoGeneratorConfig;
  history?: AmericanoHistoricalRound[];
  notes?: string;
  raw?: Record<string, unknown>;
}

export interface TournamentChangeLogField {
  field: string;
  label: string;
  before?: string;
  after?: string;
}

export interface TournamentChangeLogEntry {
  id: string;
  action: 'CREATE' | 'UPDATE';
  scope: 'TOURNAMENT' | 'MECHANICS';
  summary: string;
  actor?: TournamentActor;
  at: string;
  changes: TournamentChangeLogField[];
}

export interface TournamentResultsSummary {
  totalGames: number;
  gamesWithResult: number;
  uniquePlayers: number;
  lastGameAt?: string;
}

export interface TournamentResultGameEntry {
  gameId: string;
  title: string;
  startsAt?: string;
  stationName?: string;
  courtName?: string;
  locationName?: string;
  participants: string[];
  result?: string;
  resultLines: string[];
  ratingDelta?: string;
  ratingDeltaLines: string[];
}

export interface TournamentResultMatchTeam {
  name: string;
  players: string[];
}

export interface TournamentResultMatchEntry {
  gameId: string;
  title: string;
  startsAt?: string;
  stationName?: string;
  courtName?: string;
  locationName?: string;
  teams: TournamentResultMatchTeam[];
  resultLines: string[];
  ratingDeltaLines: string[];
}

export interface TournamentResultStandingEntry {
  player: string;
  playedGames: number;
  wins: number;
  losses: number;
  totalDelta: number;
}

export interface TournamentResultsView {
  tournamentId: string;
  resolvedTournamentId: string;
  summary: TournamentResultsSummary;
  games: TournamentResultGameEntry[];
  matches: TournamentResultMatchEntry[];
  standings: TournamentResultStandingEntry[];
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
  courtName?: string;
  locationName?: string;
  trainerId?: string;
  trainerName?: string;
  trainerAvatarUrl?: string | null;
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
  publicationCommunityIds?: string[];
  skin?: TournamentSkin;
  mechanics?: TournamentMechanics;
  changeLog?: TournamentChangeLogEntry[];
  createdBy?: TournamentActor;
  updatedBy?: TournamentActor;
}

export interface TournamentAcceptedSubscriptionRule {
  id: string;
  label: string;
  description?: string;
  writeOffLabel?: string;
  compatibleTournamentTypes?: string[];
  compatibleAccessLevels?: string[];
}

export interface TournamentPurchaseOption {
  id: string;
  label: string;
  priceLabel: string;
  description?: string;
  productType?: 'SUBSCRIPTION' | 'ONE_TIME' | 'SERVICE';
}

export interface TournamentBookingConfig {
  enabled: boolean;
  required: boolean;
  acceptedSubscriptions: TournamentAcceptedSubscriptionRule[];
  purchaseOptions: TournamentPurchaseOption[];
  purchaseFlowUrl?: string;
  vivaWidgetId?: string;
  vivaExerciseId?: string;
  vivaStudioId?: string;
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
  publicationCommunityIds?: string[];
  skin: TournamentSkin;
  mechanics: TournamentMechanics;
  changeLog: TournamentChangeLogEntry[];
}

export interface TournamentPublicView {
  id: string;
  slug: string;
  publicUrl: string;
  joinUrl: string;
  name: string;
  tournamentType: string;
  gender: TournamentGender;
  accessLevels: string[];
  startsAt?: string;
  endsAt?: string;
  studioName?: string;
  courtName?: string;
  locationName?: string;
  trainerName?: string;
  trainerAvatarUrl?: string | null;
  participantsCount: number;
  paidParticipantsCount: number;
  waitlistCount: number;
  maxPlayers: number;
  participants?: Array<
    Pick<TournamentParticipant, 'id' | 'name' | 'levelLabel' | 'avatarUrl' | 'gender' | 'paymentStatus' | 'status'>
  >;
  waitlist?: Array<
    Pick<TournamentParticipant, 'id' | 'name' | 'levelLabel' | 'avatarUrl' | 'gender' | 'paymentStatus' | 'status'>
  >;
  registrationOpen: boolean;
  allowedManagerPhonesCount: number;
  skin: TournamentSkin;
  booking: TournamentBookingConfig;
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
    | 'courtName'
    | 'locationName'
    | 'trainerName'
    | 'exerciseTypeId'
  >;
}

export interface TournamentPublicDirectoryResponse {
  generatedAt: string;
  count: number;
  items: TournamentPublicView[];
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
    | 'ALREADY_WAITLISTED'
    | 'PURCHASE_REQUIRED'
    | 'PURCHASE_STARTED';
  message: string;
  tournamentId?: string;
  tournamentSlug?: string;
  participant?: TournamentParticipant;
  payment?: TournamentJoinPaymentState;
}

export interface TournamentMechanicsAccessResponse {
  ok: boolean;
  code: 'OK' | 'PHONE_REQUIRED' | 'ACCESS_DENIED';
  message: string;
  tournamentSlug?: string;
}

export interface TournamentClientSubscription {
  id: string;
  label: string;
  remainingUses?: number;
  description?: string;
  validUntil?: string;
  compatibleTournamentTypes?: string[];
  compatibleAccessLevels?: string[];
  productType?: 'SUBSCRIPTION' | 'ONE_TIME' | 'SERVICE';
}

export interface TournamentPublicClientProfile {
  id: string;
  authorized: boolean;
  authSource: 'cookie' | 'headers' | 'anonymous';
  name?: string;
  phone?: string;
  phoneVerified?: boolean;
  levelLabel?: string;
  onboardingCompleted: boolean;
  subscriptions: TournamentClientSubscription[];
}

export type TournamentJoinFlowCode =
  | 'AUTH_REQUIRED'
  | 'PHONE_VERIFICATION_REQUIRED'
  | 'PROFILE_REQUIRED'
  | 'ONBOARDING_REQUIRED'
  | 'READY_TO_JOIN'
  | 'SUBSCRIPTION_AVAILABLE'
  | 'PURCHASE_REQUIRED'
  | 'LEVEL_NOT_ALLOWED'
  | 'REGISTERED'
  | 'WAITLISTED'
  | 'ALREADY_REGISTERED'
  | 'ALREADY_WAITLISTED';

export interface TournamentJoinPaymentState {
  required: boolean;
  code: 'NOT_REQUIRED' | 'SUBSCRIPTION_AVAILABLE' | 'PURCHASE_REQUIRED';
  message: string;
  availableSubscriptions: TournamentClientSubscription[];
  selectedSubscription?: TournamentClientSubscription;
  purchaseOptions: TournamentPurchaseOption[];
  purchaseFlowUrl?: string;
  checkoutUrl?: string;
  transactionId?: string;
}

export interface TournamentJoinFlowResponse {
  ok: boolean;
  code: TournamentJoinFlowCode;
  message: string;
  tournament: TournamentPublicView;
  client: TournamentPublicClientProfile;
  access: TournamentAccessCheckResponse;
  missingFields: Array<'phone' | 'levelLabel'>;
  waitlistAllowed: boolean;
  payment: TournamentJoinPaymentState;
  authRequired?: boolean;
  authUrl?: string;
  authCheckUrl?: string;
  authPollMs?: number;
  cabinetUrl?: string;
  vivaAuthorizationHeader?: string;
}
