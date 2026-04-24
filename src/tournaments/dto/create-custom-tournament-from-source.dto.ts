import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { TournamentGender, TournamentStatus } from '../tournaments.types';
import { TournamentMechanicsDto } from './tournament-mechanics.dto';
import { TournamentParticipantInputDto } from './tournament-participant-input.dto';
import { TournamentSkinDto } from './tournament-skin.dto';

export class CreateCustomTournamentFromSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  name?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tournamentType?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  accessLevels?: string[];

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'MIXED'])
  gender?: TournamentGender;

  @IsOptional()
  @IsInt()
  @Min(2)
  maxPlayers?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsPhoneNumber('RU', { each: true })
  allowedManagerPhones?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  publicationCommunityIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  studioName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  trainerName?: string;

  @IsOptional()
  @IsIn([
    TournamentStatus.PLANNED,
    TournamentStatus.REGISTRATION,
    TournamentStatus.RUNNING,
    TournamentStatus.FINISHED,
    TournamentStatus.CANCELED,
    TournamentStatus.UNKNOWN
  ])
  status?: TournamentStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => TournamentParticipantInputDto)
  participants?: TournamentParticipantInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => TournamentParticipantInputDto)
  waitlist?: TournamentParticipantInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentSkinDto)
  skin?: TournamentSkinDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentMechanicsDto)
  mechanics?: TournamentMechanicsDto;
}
