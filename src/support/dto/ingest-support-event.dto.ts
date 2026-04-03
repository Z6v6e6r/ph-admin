import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { MessageAttachmentDto } from '../../common/messages/message-attachment.dto';
import {
  SupportConnectorRoute,
  SupportMessageDirection,
  SupportMessageKind,
  SupportPriority,
  SupportSentiment,
  SupportTopic
} from '../support.types';

export class IngestSupportEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  connector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  authorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalChatId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  recipientExternalUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  recipientExternalChatId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientUsername?: string;

  @IsOptional()
  @IsBoolean()
  senderIsBot?: boolean;

  @IsOptional()
  @IsBoolean()
  deliverToClient?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  primaryPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  stationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];

  @IsOptional()
  @IsEnum(SupportMessageDirection)
  direction?: SupportMessageDirection;

  @IsOptional()
  @IsEnum(SupportMessageKind)
  kind?: SupportMessageKind;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timestamp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  selectedStationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  selectedStationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  senderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  channelUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  chatId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  externalThreadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  authStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  workflowState?: string;

  @IsOptional()
  @IsObject()
  ai?: {
    topic?: SupportTopic;
    sentiment?: SupportSentiment;
    priority?: SupportPriority;
    summary?: string;
    confidence?: number;
    tags?: string[];
  };

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
