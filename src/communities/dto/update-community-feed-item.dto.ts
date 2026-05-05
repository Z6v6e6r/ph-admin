import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunityFeedItemKind } from '../communities.types';

class UpdateCommunityFeedParticipantDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  avatar?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  levelLabel?: string;
}

export class UpdateCommunityFeedItemDto {
  @IsOptional()
  @IsIn(['NEWS', 'GAME', 'TOURNAMENT', 'EVENT', 'AD'])
  kind?: CommunityFeedItemKind;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  previewLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string;

  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  stationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  courtName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  levelLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  likesCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  commentsCount?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  placement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => UpdateCommunityFeedParticipantDto)
  participants?: UpdateCommunityFeedParticipantDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
