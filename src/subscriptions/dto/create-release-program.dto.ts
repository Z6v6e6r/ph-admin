import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

export class MoneyDto {
  @IsInt()
  @Min(0)
  @Max(1000000000)
  amountMinor!: number;

  @IsIn(['RUB'])
  currency!: 'RUB';
}

export class CreateReleasePhaseDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  order!: number;

  @IsIn(['BULK', 'DAILY_DROP', 'MANUAL'])
  mode!: 'BULK' | 'DAILY_DROP' | 'MANUAL';

  @IsInt()
  @Min(1)
  @Max(1000000)
  totalQuantity!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  dailyDropQuantity?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyDropLocalTime?: string | null;

  @ValidateNested()
  @Type(() => MoneyDto)
  price!: MoneyDto;

  @IsIn(['MANUAL', 'SCHEDULED', 'PREVIOUS_SOLD_OUT'])
  activation!: 'MANUAL' | 'SCHEDULED' | 'PREVIOUS_SOLD_OUT';

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  providerProductRef?: string | null;
}

export class CreateReleaseProgramDto {
  @IsString()
  @MaxLength(160)
  subscriptionTypeId!: string;

  @IsString()
  @MaxLength(160)
  stationId!: string;

  @IsString()
  @MaxLength(120)
  timezone!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReleasePhaseDto)
  phases!: CreateReleasePhaseDto[];
}
