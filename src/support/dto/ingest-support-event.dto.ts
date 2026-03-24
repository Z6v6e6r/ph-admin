import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from 'class-validator';
import {
  SupportConnectorRoute,
  SupportMessageDirection,
  SupportMessageKind,
  SupportPriority,
  SupportSentiment,
  SupportTopic
} from '../support.types';

export class IngestSupportEventDto {
  @IsEnum(SupportConnectorRoute)
  connector!: SupportConnectorRoute;

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
}
