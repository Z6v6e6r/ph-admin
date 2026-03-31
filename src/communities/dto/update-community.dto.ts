import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength
} from 'class-validator';
import { CommunityJoinRule, CommunityVisibility } from '../communities.types';

export class UpdateCommunityDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  visibility?: CommunityVisibility;

  @IsOptional()
  @IsIn(['INSTANT', 'MODERATED', 'INVITE_ONLY'])
  joinRule?: CommunityJoinRule;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  minimumLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  rules?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  logo?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  focusTags?: string[];
}
