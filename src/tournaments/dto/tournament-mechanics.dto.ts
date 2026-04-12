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
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import {
  FirstRoundSeedingMode,
  StrictnessLevel,
  TournamentMode
} from '../americano-schedule.types';

export class TournamentMechanicsWeightsDto {
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

export class TournamentMechanicsConfigDto {
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

  @IsOptional()
  @IsInt()
  @Min(0)
  roundExactThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  balanceOutlierThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  balanceOutlierWeight?: number;

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
  @Type(() => TournamentMechanicsWeightsDto)
  weights?: TournamentMechanicsWeightsDto;
}

export class TournamentMechanicsHistoricalMatchDto {
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

export class TournamentMechanicsHistoricalRoundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  roundNumber?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TournamentMechanicsHistoricalMatchDto)
  matches!: TournamentMechanicsHistoricalMatchDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(48)
  @IsString({ each: true })
  byes?: string[];
}

export class TournamentMechanicsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentMechanicsConfigDto)
  config?: TournamentMechanicsConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TournamentMechanicsHistoricalRoundDto)
  history?: TournamentMechanicsHistoricalRoundDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}
