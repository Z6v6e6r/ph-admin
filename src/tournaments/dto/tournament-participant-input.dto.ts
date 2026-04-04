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
  @IsIn(['MALE', 'FEMALE', 'MIXED'])
  gender?: TournamentGender;

  @IsOptional()
  @IsIn(['UNPAID', 'PAID'])
  paymentStatus?: TournamentPaymentStatus;

  @IsOptional()
  @IsIn(['REGISTERED', 'WAITLIST'])
  status?: TournamentParticipantStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
