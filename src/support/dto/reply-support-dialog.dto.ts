import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { MessageAttachmentDto } from '../../common/messages/message-attachment.dto';
import { SupportConnectorRoute } from '../support.types';

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return value === null || value === undefined ? undefined : String(value);
  }
  const text = value.trim();
  return text ? text : undefined;
}

export class ReplySupportDialogDto {
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

  @IsOptional()
  @IsEnum(SupportConnectorRoute)
  connector?: SupportConnectorRoute;
}
