import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { MessageAttachmentType } from './message-attachment.types';

export class MessageAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @IsEnum(MessageAttachmentType)
  type!: MessageAttachmentType;

  @IsString()
  @MinLength(1)
  @MaxLength(8_000_000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12_000_000)
  size?: number;
}
