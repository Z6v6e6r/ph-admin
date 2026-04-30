import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSplitPaymentPromoShareAmountsDto {
  @IsNumber()
  @Min(0)
  @Max(100000)
  twoTeams!: number;

  @IsNumber()
  @Min(0)
  @Max(100000)
  fourPlayers!: number;
}

export class UpdateSplitPaymentPromoCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  stationIds!: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  stationNameIncludes!: string[];

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  roomIds!: string[];

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  roomNameIncludes!: string[];

  @IsObject()
  shareAmounts!: UpdateSplitPaymentPromoShareAmountsDto;

  @IsNumber()
  @Min(0)
  @Max(100000)
  baseShareAmount!: number;

  @IsInt()
  @Min(1)
  @Max(100000000)
  vivaDirectionId!: number;

  @IsInt()
  @Min(1)
  @Max(100000000)
  vivaExerciseTypeId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateSplitPaymentPromoDto extends UpdateSplitPaymentPromoCampaignDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => UpdateSplitPaymentPromoCampaignDto)
  promos?: UpdateSplitPaymentPromoCampaignDto[];
}
