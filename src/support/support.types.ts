import { Role } from '../common/rbac/role.enum';

export const SUPPORT_UNASSIGNED_STATION_ID = 'UNASSIGNED';
export const SUPPORT_UNASSIGNED_STATION_NAME = 'Без станции';

export enum SupportConnectorRoute {
  TG_BOT = 'TG_BOT',
  MAX_BOT = 'MAX_BOT',
  LK_WEB_MESSENGER = 'LK_WEB_MESSENGER',
  EMAIL = 'EMAIL',
  PHONE_CALL = 'PHONE_CALL',
  BITRIX = 'BITRIX'
}

export enum SupportClientAuthStatus {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED'
}

export enum SupportDialogStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED'
}

export enum SupportMessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  SYSTEM = 'SYSTEM'
}

export enum SupportMessageKind {
  TEXT = 'TEXT',
  MEDIA = 'MEDIA',
  CONTACT = 'CONTACT',
  STATION_SELECTION = 'STATION_SELECTION',
  COMMAND = 'COMMAND',
  EMAIL = 'EMAIL',
  CALL = 'CALL',
  SYSTEM = 'SYSTEM'
}

export enum SupportTopic {
  BOOKING = 'BOOKING',
  PAYMENT = 'PAYMENT',
  TRAINING = 'TRAINING',
  TOURNAMENT = 'TOURNAMENT',
  GAME = 'GAME',
  COMPLAINT = 'COMPLAINT',
  FEEDBACK = 'FEEDBACK',
  TECHNICAL = 'TECHNICAL',
  CALLBACK = 'CALLBACK',
  GENERAL = 'GENERAL'
}

export enum SupportSentiment {
  POSITIVE = 'POSITIVE',
  NEUTRAL = 'NEUTRAL',
  NEGATIVE = 'NEGATIVE',
  DISTRESSED = 'DISTRESSED'
}

export enum SupportPriority {
  CRITICAL = 'CRITICAL',
  IMPORTANT = 'IMPORTANT',
  MEDIUM = 'MEDIUM',
  RECOMMENDATION = 'RECOMMENDATION'
}

export enum SupportOutboxStatus {
  PENDING = 'PENDING',
  LEASED = 'LEASED',
  SENT = 'SENT',
  FAILED = 'FAILED'
}

export type SupportSenderRole = Role | 'SYSTEM';

export interface SupportAiInsight {
  topic: SupportTopic;
  sentiment: SupportSentiment;
  priority: SupportPriority;
  summary: string;
  confidence: number;
  tags: string[];
}

export interface SupportClientIdentity {
  connector: SupportConnectorRoute;
  externalUserId?: string;
  externalChatId?: string;
  externalThreadId?: string;
  username?: string;
  displayName?: string;
  linkedAt: string;
  lastSeenAt: string;
}

export interface SupportClientProfile {
  id: string;
  displayName?: string;
  authStatus: SupportClientAuthStatus;
  unverifiedTextAttempts?: number;
  primaryPhone?: string;
  phones: string[];
  emails: string[];
  identities: SupportClientIdentity[];
  currentStationId?: string;
  currentStationName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportDialog {
  id: string;
  clientId: string;
  stationId: string;
  stationName: string;
  accessStationIds: string[];
  writeStationIds: string[];
  readOnlyStationIds: string[];
  status: SupportDialogStatus;
  authStatus: SupportClientAuthStatus;
  currentPhone?: string;
  phones: string[];
  emails: string[];
  connectors: SupportConnectorRoute[];
  lastInboundConnector?: SupportConnectorRoute;
  lastReplyConnector?: SupportConnectorRoute;
  subject?: string;
  unreadCount: number;
  hasUnreadMessages: boolean;
  hasNewMessages: boolean;
  waitingForStaffSince?: string;
  pendingClientMessageIds: string[];
  responseTimeTotalMs: number;
  responseCount: number;
  averageFirstResponseMs?: number;
  lastFirstResponseMs?: number;
  lastMessageAt?: string;
  lastRankingMessageAt?: string;
  lastMessageText?: string;
  lastMessageSenderRole?: SupportSenderRole;
  lastClientMessageAt?: string;
  lastStaffMessageAt?: string;
  ai?: SupportAiInsight;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  dialogId: string;
  clientId: string;
  connector: SupportConnectorRoute;
  direction: SupportMessageDirection;
  kind: SupportMessageKind;
  text?: string;
  createdAt: string;
  senderId: string;
  senderRole: SupportSenderRole;
  senderName?: string;
  externalUserId?: string;
  externalChatId?: string;
  externalMessageId?: string;
  phone?: string;
  email?: string;
  stationId?: string;
  stationName?: string;
  ai?: SupportAiInsight;
  meta?: Record<string, unknown>;
}

export interface SupportResponseMetric {
  id: string;
  dialogId: string;
  clientId: string;
  stationId: string;
  connector?: SupportConnectorRoute;
  startedAt: string;
  respondedAt: string;
  respondedByUserId: string;
  responseTimeMs: number;
}

export interface SupportDialogSummary {
  dialogId: string;
  connector: SupportConnectorRoute;
  stationId: string;
  stationName: string;
  accessStationIds: string[];
  writeStationIds: string[];
  readOnlyStationIds: string[];
  isActiveForUser: boolean;
  isReadOnlyForUser: boolean;
  currentStationId?: string;
  currentStationName?: string;
  clientId: string;
  clientDisplayName?: string;
  authStatus: SupportClientAuthStatus;
  primaryPhone?: string;
  phones: string[];
  emails: string[];
  subject?: string;
  status: SupportDialogStatus;
  unreadCount: number;
  hasUnreadMessages: boolean;
  hasNewMessages: boolean;
  waitingForStaffSince?: string;
  pendingClientMessagesCount: number;
  averageFirstResponseMs?: number;
  lastFirstResponseMs?: number;
  lastMessageAt?: string;
  lastRankingMessageAt?: string;
  lastMessageText?: string;
  lastMessageSenderRole?: SupportSenderRole;
  lastInboundConnector?: SupportConnectorRoute;
  ai?: SupportAiInsight;
}

export interface SupportConnectorSummary {
  connector: SupportConnectorRoute;
  stationsCount: number;
  dialogsCount: number;
  unreadMessagesCount: number;
  unverifiedDialogsCount: number;
}

export interface SupportStationSummary {
  connector: SupportConnectorRoute;
  stationId: string;
  stationName: string;
  dialogsCount: number;
  unreadDialogsCount: number;
  unreadMessagesCount: number;
  unverifiedDialogsCount: number;
  lastMessageAt?: string;
}

export interface SupportStationAnalytics {
  stationId: string;
  stationName: string;
  inboundMessagesCount: number;
  dialogsCount: number;
  averageFirstResponseMs?: number;
}

export interface SupportTopicAnalytics {
  topic: SupportTopic;
  messagesCount: number;
}

export interface SupportPriorityAnalytics {
  priority: SupportPriority;
  messagesCount: number;
}

export interface SupportConnectorAnalytics {
  connector: SupportConnectorRoute;
  messagesCount: number;
}

export interface SupportDialogReactionAnalytics {
  dialogId: string;
  stationId: string;
  stationName: string;
  clientId: string;
  primaryPhone?: string;
  averageFirstResponseMs?: number;
  lastFirstResponseMs?: number;
  responseCount: number;
}

export interface SupportDailyAnalytics {
  date: string;
  inboundMessagesCount: number;
  outboundMessagesCount: number;
  callsCount: number;
  emailsCount: number;
  unverifiedDialogsCount: number;
  averageFirstResponseMs?: number;
  byStation: SupportStationAnalytics[];
  byTopic: SupportTopicAnalytics[];
  byPriority: SupportPriorityAnalytics[];
  byConnector: SupportConnectorAnalytics[];
  byDialog: SupportDialogReactionAnalytics[];
}

export interface SupportOutboxCommand {
  id: string;
  dialogId: string;
  clientId: string;
  connector: SupportConnectorRoute;
  text: string;
  format?: 'markdown' | 'html';
  createdAt: string;
  status: SupportOutboxStatus;
  targetExternalUserId?: string;
  targetExternalChatId?: string;
  targetEmail?: string;
  targetPhone?: string;
  stationId?: string;
  stationName?: string;
  leasedUntil?: string;
  attempts: number;
  lastError?: string;
  meta?: Record<string, unknown>;
}

export interface SupportIngestEventResult {
  client: SupportClientProfile;
  dialog: SupportDialog;
  message?: SupportMessage;
  outbox?: SupportOutboxCommand;
  requiredAction?: 'REQUEST_CONTACT' | 'REQUEST_STATION';
  contactReminderStage?: 1 | 2;
  canReplyToClient: boolean;
}
