import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsObject,
  IsInt,
  Min,
  IsString,
  MaxLength
} from 'class-validator';
import { COMMUNITY_TYPES, CommunityType, CommunityTypeSettings } from '../community-policy';
import { CommunityJoinRule, CommunityVisibility } from '../communities.types';

export class UpdateCommunityDto {
  @IsOptional()
  @IsIn(COMMUNITY_TYPES)
  communityType?: CommunityType;

  @IsOptional()
  @IsObject()
  typeSettings?: CommunityTypeSettings;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTypeSettingsRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

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
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  focusTags?: string[];
}
