import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';
import { MessageAttachmentDto } from '../../common/messages/message-attachment.dto';
import {
  QuickReplyMode,
  QuickReplyTriggerType
} from '../quick-replies.types';

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return value === null || value === undefined ? undefined : String(value);
  }
  const text = value.trim();
  return text ? text : undefined;
}

function normalizeTextArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

export class UpdateQuickReplyRuleDto {
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsEnum(QuickReplyTriggerType)
  triggerType?: QuickReplyTriggerType;

  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  triggerPhrase?: string;

  @Transform(({ value }) => normalizeTextArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  triggerKeywords?: string[];

  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  timeFrom?: string;

  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  timeTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  noClientReplyMinutes?: number;

  @Transform(({ value }) => normalizeTextArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  stationIds?: string[];

  @IsOptional()
  @IsEnum(QuickReplyMode)
  mode?: QuickReplyMode;

  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  responseText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  responseAttachments?: MessageAttachmentDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
