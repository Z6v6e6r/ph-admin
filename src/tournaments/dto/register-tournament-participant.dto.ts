import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { TournamentGender } from '../tournaments.types';

class RegisterTournamentParticipantSubscriptionDto {
  @IsString()
  @MaxLength(120)
  id!: string;

  @IsString()
  @MaxLength(180)
  label!: string;

  @IsOptional()
  remainingUses?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compatibleTournamentTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compatibleAccessLevels?: string[];
}

export class RegisterTournamentParticipantDto {
  @IsString()
  @MaxLength(180)
  name!: string;

  @IsPhoneNumber('RU')
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  levelLabel?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'MIXED'])
  gender?: TournamentGender;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  selectedSubscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  selectedPurchaseOptionId?: string;

  @IsOptional()
  @IsBoolean()
  purchaseConfirmed?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterTournamentParticipantSubscriptionDto)
  subscriptions?: RegisterTournamentParticipantSubscriptionDto[];
}
