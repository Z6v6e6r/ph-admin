import { MessageAttachment } from '../common/messages/message-attachment.types';
import { Role } from '../common/rbac/role.enum';
import { VivaClientCabinetStatus } from '../integrations/viva/viva-admin.service';
import { QuickReplyRule } from '../quick-replies/quick-replies.types';

export enum ConnectorRoute {
  TG_BOT = 'TG_BOT',
  MAX_BOT = 'MAX_BOT',
  MAX_ACADEMY_BOT = 'MAX_ACADEMY_BOT',
  LK_WEB_MESSENGER = 'LK_WEB_MESSENGER',
  LK_ACADEMY_WEB_MESSENGER = 'LK_ACADEMY_WEB_MESSENGER',
  PROMO_WEB_MESSENGER = 'PROMO_WEB_MESSENGER'
}

export enum MessageOrigin {
  HUMAN = 'HUMAN',
  AI = 'AI'
}

export enum ThreadStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED'
}

export interface DialogSettings {
  vivaStatus?: VivaClientCabinetStatus;
  vivaClientId?: string;
  vivaCabinetUrl?: string;
}

export interface ChatThread {
  id: string;
  connector: ConnectorRoute;
  stationId: string;
  stationName?: string;
  clientId: string;
  subject?: string;
  assignedSupportId?: string;
  status: ThreadStatus;
  lastMessageAt?: string;
  lastRankingMessageAt?: string;
  lastStaffReadAt?: string;
  lastClientReadAt?: string;
  settings?: DialogSettings;
  vivaStatus?: VivaClientCabinetStatus;
  vivaClientId?: string;
  vivaCabinetUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderRole: Role;
  senderRoleRaw?: string;
  senderName?: string;
  origin: MessageOrigin;
  direction?: string;
  text: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface StaffResponseMetric {
  threadId: string;
  connector: ConnectorRoute;
  stationId: string;
  clientMessageId: string;
  respondedByUserId: string;
  startedAt: string;
  respondedAt: string;
  responseTimeMs: number;
}

export interface ConnectorSummary {
  connector: ConnectorRoute;
  stationsCount: number;
  dialogsCount: number;
  unreadMessagesCount: number;
}

export interface MessengerStationConfig {
  stationId: string;
  stationName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessengerConnectorConfig {
  id: string;
  name: string;
  route: ConnectorRoute;
  stationIds: string[];
  config: Record<string, string | number | boolean | string[]>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessengerAccessRule {
  id: string;
  role: Role;
  stationIds: string[];
  connectorRoutes: ConnectorRoute[];
  canRead: boolean;
  canWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessengerSettingsSnapshot {
  stations: MessengerStationConfig[];
  connectors: MessengerConnectorConfig[];
  accessRules: MessengerAccessRule[];
  quickReplies: QuickReplyRule[];
}

export interface StationSummary {
  connector: ConnectorRoute;
  stationId: string;
  stationName?: string;
  dialogsCount: number;
  unreadDialogsCount: number;
  unreadMessagesCount: number;
  lastMessageAt?: string;
}

export interface StationDialogSummary {
  threadId: string;
  connector: ConnectorRoute;
  stationId: string;
  stationName?: string;
  accessStationIds?: string[];
  writeStationIds?: string[];
  readOnlyStationIds?: string[];
  isActiveForUser?: boolean;
  isReadOnlyForUser?: boolean;
  isResolved?: boolean;
  resolvedAt?: string;
  resolvedByUserId?: string;
  currentStationId?: string;
  currentStationName?: string;
  clientId: string;
  clientDisplayName?: string;
  settings?: DialogSettings;
  vivaStatus?: VivaClientCabinetStatus;
  vivaClientId?: string;
  vivaCabinetUrl?: string;
  primaryPhone?: string;
  phones?: string[];
  subject?: string;
  status: ThreadStatus;
  lastMessageAt?: string;
  lastRankingMessageAt?: string;
  unreadMessagesCount: number;
  hasUnreadMessages?: boolean;
  hasNewMessages?: boolean;
  pendingClientMessagesCount: number;
  lastMessageText?: string;
  lastMessageSenderRole?: Role;
  lastMessageSenderRoleRaw?: string;
  averageStaffResponseTimeMs?: number;
  lastStaffResponseTimeMs?: number;
  aiTopic?: AiDialogTopic;
  aiUrgency?: AiUrgency;
  aiQualityScore?: number;
}

export enum AiAssistMode {
  DISABLED = 'DISABLED',
  SUGGEST = 'SUGGEST',
  AUTO_REPLY = 'AUTO_REPLY'
}

export enum AiDialogTopic {
  BOOKING = 'BOOKING',
  PAYMENT = 'PAYMENT',
  SCHEDULE = 'SCHEDULE',
  TECHNICAL = 'TECHNICAL',
  COMPLAINT = 'COMPLAINT',
  GENERAL = 'GENERAL'
}

export enum AiSentiment {
  POSITIVE = 'POSITIVE',
  NEUTRAL = 'NEUTRAL',
  NEGATIVE = 'NEGATIVE'
}

export enum AiUrgency {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export interface ThreadAiConfig {
  mode: AiAssistMode;
  updatedAt: string;
  updatedBy: string;
}

export interface DialogAiInsight {
  threadId: string;
  topic: AiDialogTopic;
  sentiment: AiSentiment;
  urgency: AiUrgency;
  qualityScore: number;
  confidence: number;
  shortSummary: string;
  updatedAt: string;
}

export enum AiSuggestionStatus {
  PENDING_STAFF = 'PENDING_STAFF',
  SENT_TO_CLIENT = 'SENT_TO_CLIENT'
}

export interface AiReplySuggestion {
  id: string;
  threadId: string;
  basedOnClientMessageId: string;
  text: string;
  status: AiSuggestionStatus;
  createdAt: string;
  sentAt?: string;
}
