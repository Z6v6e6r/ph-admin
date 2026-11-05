import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import {
  RESIDENT_SERVICE_KINDS,
  RESIDENT_SERVICES_MAX_ITEM_QUANTITY,
  ResidentServiceKind
} from '../resident-services.types';

export class ResidentServiceItemDto {
  @IsIn([...RESIDENT_SERVICE_KINDS])
  serviceKind!: ResidentServiceKind;

  @IsInt()
  @Min(1)
  @Max(RESIDENT_SERVICES_MAX_ITEM_QUANTITY)
  quantity!: number;
}

export class ConfirmResidentIssuanceDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  stationId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ResidentServiceItemDto)
  items!: ResidentServiceItemDto[];
}
