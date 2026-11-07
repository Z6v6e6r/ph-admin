import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import {
  RESIDENT_SERVICE_KINDS,
  RESIDENT_SERVICE_LIMIT_PERIODS,
  RESIDENT_SERVICES_MAX_LIMIT_QUANTITY,
  ResidentServiceKind,
  ResidentServiceLimitPeriod
} from '../resident-services.types';

export class CreateResidentBenefitRuleDto {
  @IsString()
  @MaxLength(200)
  subscriptionTypeId!: string;

  @IsIn([...RESIDENT_SERVICE_KINDS])
  serviceKind!: ResidentServiceKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  stationIds?: string[];

  @IsIn([...RESIDENT_SERVICE_LIMIT_PERIODS])
  limitPeriod!: ResidentServiceLimitPeriod;

  @IsInt()
  @Min(1)
  @Max(RESIDENT_SERVICES_MAX_LIMIT_QUANTITY)
  limitQuantity!: number;

  @IsBoolean()
  returnable!: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
