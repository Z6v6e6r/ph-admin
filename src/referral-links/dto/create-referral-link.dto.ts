import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { ReferralLinkStatus } from '../referral-links.types';

export class CreateReferralLinkDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  campaignName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  recipientName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientExternalRef?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  targetUrl!: string;

  @IsISO8601({ strict: true })
  validFrom!: string;

  @IsISO8601({ strict: true })
  validTo!: string;

  @IsOptional()
  @IsIn(['Europe/Moscow'])
  timezone?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: ReferralLinkStatus;

  @IsOptional()
  @Matches(/^TR-(?:00[1-9]|0[1-4]\d|050)$/)
  legacyAttributionKey?: string;
}
