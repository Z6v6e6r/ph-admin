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
  RESIDENT_SERVICE_LIMIT_PERIODS,
  RESIDENT_SERVICES_MAX_LIMIT_QUANTITY,
  ResidentServiceLimitPeriod
} from '../resident-services.types';

export class UpdateResidentBenefitRuleDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  stationIds?: string[];

  @IsOptional()
  @IsIn([...RESIDENT_SERVICE_LIMIT_PERIODS])
  limitPeriod?: ResidentServiceLimitPeriod;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RESIDENT_SERVICES_MAX_LIMIT_QUANTITY)
  limitQuantity?: number;

  @IsOptional()
  @IsBoolean()
  returnable?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
