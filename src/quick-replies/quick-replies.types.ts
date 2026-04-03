import { MessageAttachment } from '../common/messages/message-attachment.types';

export const QUICK_REPLY_UNASSIGNED_STATION_ID = 'UNASSIGNED';

export enum QuickReplyTriggerType {
  EXACT_PHRASE = 'EXACT_PHRASE',
  KEYWORD = 'KEYWORD',
  KEYWORD_SET = 'KEYWORD_SET',
  MESSAGE_TIME_RANGE = 'MESSAGE_TIME_RANGE',
  CLIENT_NO_REPLY_FOR = 'CLIENT_NO_REPLY_FOR',
  FIRST_CLIENT_MESSAGE = 'FIRST_CLIENT_MESSAGE',
  HAS_ATTACHMENT = 'HAS_ATTACHMENT'
}

export enum QuickReplyMode {
  AUTO_REPLY = 'AUTO_REPLY',
  SUGGESTION = 'SUGGESTION'
}

export enum QuickReplySourceType {
  MESSENGER = 'MESSENGER',
  SUPPORT = 'SUPPORT'
}

export interface QuickReplyRule {
  id: string;
  title: string;
  triggerType: QuickReplyTriggerType;
  triggerPhrase?: string;
  triggerKeywords?: string[];
  timeFrom?: string;
  timeTo?: string;
  noClientReplyMinutes?: number;
  stationIds: string[];
  mode: QuickReplyMode;
  responseText: string;
  responseAttachments?: MessageAttachment[];
  isActive: boolean;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickReplyUsageLog {
  id: string;
  ruleId: string;
  ruleTitle: string;
  sourceType: QuickReplySourceType;
  dialogId: string;
  connector?: string;
  stationId?: string;
  clientRequestText?: string;
  systemResponseText?: string;
  usedByUserId?: string;
  mode: QuickReplyMode;
  createdAt: string;
}

export interface QuickReplyMatchContext {
  sourceType: QuickReplySourceType;
  dialogId: string;
  connector?: string;
  stationId?: string;
  messageText?: string;
  messageCreatedAt?: string;
  hasAttachment?: boolean;
  isFirstClientMessage?: boolean;
  noClientReplyMinutes?: number;
}
