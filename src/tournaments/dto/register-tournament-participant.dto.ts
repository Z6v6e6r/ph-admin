import { IsIn, IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';
import { TournamentGender } from '../tournaments.types';

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
}
