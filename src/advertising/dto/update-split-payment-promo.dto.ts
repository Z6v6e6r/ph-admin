import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';

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

export class UpdateSplitPaymentPromoDto {
  @IsBoolean()
  enabled!: boolean;

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
