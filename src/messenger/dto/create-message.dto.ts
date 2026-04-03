import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { MessageAttachmentDto } from '../../common/messages/message-attachment.dto';

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return value === null || value === undefined ? undefined : String(value);
  }
  const text = value.trim();
  return text ? text : undefined;
}

export class CreateMessageDto {
  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];

  @Transform(({ value }) => normalizeOptionalText(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  quickReplyRuleId?: string;
}
