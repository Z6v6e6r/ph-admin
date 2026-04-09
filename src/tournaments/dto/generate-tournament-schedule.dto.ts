import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from 'class-validator';
import {
  FirstRoundSeedingMode,
  StrictnessLevel,
  TournamentMode
} from '../americano-schedule.types';
import { AmericanoPlayerDto } from './americano-player.dto';

class AmericanoPenaltyWeightsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  partnerRepeat?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  partnerImmediateRepeat?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  opponentRepeat?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  opponentRecentRepeat?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  balance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unevenBye?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  consecutiveBye?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pairInternalImbalance?: number;
}

class AmericanoGeneratorConfigDto {
  @IsIn([
    'full_americano',
    'short_americano',
    'competitive_americano',
    'dynamic_americano'
  ])
  mode!: TournamentMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  rounds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  courts?: number | null;

  @IsBoolean()
  useRatings!: boolean;

  @IsOptional()
  @IsIn(['auto', 'rating_quartets', 'off'])
  firstRoundSeeding?: FirstRoundSeedingMode;

  @IsIn(['high', 'medium', 'low'])
  strictPartnerUniqueness!: StrictnessLevel;

  @IsIn(['high', 'medium', 'low'])
  strictBalance!: StrictnessLevel;

  @IsBoolean()
  avoidRepeatOpponents!: boolean;

  @IsBoolean()
  avoidRepeatPartners!: boolean;

  @IsBoolean()
  distributeByesEvenly!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  historyDepth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  localSearchIterations?: number;

  @IsOptional()
  @IsInt()
  @Min(8)
  pairingExactThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(4)
  matchExactThreshold?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AmericanoPenaltyWeightsDto)
  weights?: AmericanoPenaltyWeightsDto;
}

class AmericanoHistoricalMatchDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  team1!: [string, string];

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  team2!: [string, string];
}

class AmericanoHistoricalRoundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  roundNumber?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmericanoHistoricalMatchDto)
  matches!: AmericanoHistoricalMatchDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(48)
  @IsString({ each: true })
  byes?: string[];
}

export class GenerateTournamentScheduleDto {
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(48)
  @ValidateNested({ each: true })
  @Type(() => AmericanoPlayerDto)
  players!: AmericanoPlayerDto[];

  @ValidateNested()
  @Type(() => AmericanoGeneratorConfigDto)
  config!: AmericanoGeneratorConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmericanoHistoricalRoundDto)
  history?: AmericanoHistoricalRoundDto[];
}
