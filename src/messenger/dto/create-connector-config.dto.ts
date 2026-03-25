import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from 'class-validator';
import { ConnectorRoute } from '../messenger.types';

export class CreateConnectorConfigDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsEnum(ConnectorRoute)
  route!: ConnectorRoute;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  stationIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
