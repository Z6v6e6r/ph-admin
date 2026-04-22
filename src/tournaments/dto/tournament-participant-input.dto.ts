import {
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength
} from 'class-validator';
import {
  TournamentGender,
  TournamentParticipantStatus,
  TournamentPaymentStatus
} from '../tournaments.types';

export class TournamentParticipantInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsPhoneNumber('RU')
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  levelLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  avatarUrl?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'MIXED'])
  gender?: TournamentGender;

  @IsOptional()
  @IsIn(['UNPAID', 'PAID'])
  paymentStatus?: TournamentPaymentStatus;

  @IsOptional()
  @IsIn(['REGISTERED', 'WAITLIST'])
  status?: TournamentParticipantStatus;

  @IsOptional()
  @IsIn(['FULL', 'LEVEL_MISMATCH', 'MANUAL'])
  waitlistReason?: 'FULL' | 'LEVEL_MISMATCH' | 'MANUAL';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
