import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

export class CreateGamePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn([60, 90, 120], { each: true })
  durationsMinutes!: Array<60 | 90 | 120>;
}

export class JoinGamePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(60)
  @Max(120)
  minDurationMinutes!: number;

  @IsInt()
  @Min(60)
  @Max(120)
  maxDurationMinutes!: number;
}

export class UsageUnitsByDurationDto {
  @IsInt()
  @Min(0)
  '60'!: number;

  @IsInt()
  @Min(0)
  '90'!: number;

  @IsInt()
  @Min(0)
  '120'!: number;
}

export class BenefitRuleDto {
  @IsString()
  @MaxLength(120)
  ruleId!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsIn(['GAME', 'GROUP_TRAINING', 'TOURNAMENT'])
  category!: 'GAME' | 'GROUP_TRAINING' | 'TOURNAMENT';

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  externalEventTypeIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  stationIds!: string[];

  @IsIn([
    'FREE_ENTITLEMENT',
    'FIXED_PRICE',
    'PERCENT_DISCOUNT',
    'FIXED_DISCOUNT',
    'DISABLED'
  ])
  kind!:
    | 'FREE_ENTITLEMENT'
    | 'FIXED_PRICE'
    | 'PERCENT_DISCOUNT'
    | 'FIXED_DISCOUNT'
    | 'DISABLED';

  @IsOptional()
  @IsInt()
  @Min(0)
  valueMinor?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number | null;

  @IsInt()
  priority!: number;
}

export class CreatePolicyVersionDto {
  @IsISO8601()
  effectiveAt!: string;

  @IsIn(['NEW_ONLY', 'ACTIVE_AND_NEW'])
  applyTo!: 'NEW_ONLY' | 'ACTIVE_AND_NEW';

  @IsInt()
  @Min(1)
  @Max(3660)
  validityDays!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => CreateGamePolicyDto)
  createGame!: CreateGamePolicyDto;

  @IsObject()
  @ValidateNested()
  @Type(() => JoinGamePolicyDto)
  joinGame!: JoinGamePolicyDto;

  @IsInt()
  @Min(0)
  @Max(1000)
  maxActiveServices!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  bookingWindowDays!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  dailyUsageLimit!: number;

  @IsIn(['SUBSCRIPTION_BENEFIT_ONLY', 'ALL_BOOKINGS'])
  activeServiceScope!: 'SUBSCRIPTION_BENEFIT_ONLY' | 'ALL_BOOKINGS';

  @IsObject()
  @ValidateNested()
  @Type(() => UsageUnitsByDurationDto)
  usageUnitsByDuration!: UsageUnitsByDurationDto;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BenefitRuleDto)
  benefitRules!: BenefitRuleDto[];
}
