import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { ConnectorRoute } from '../messenger.types';

function toOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export class ListThreadsDto {
  @IsOptional()
  @IsEnum(ConnectorRoute)
  connector?: ConnectorRoute;

  @IsOptional()
  @IsString()
  @MinLength(1)
  stationId?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalInteger(value))
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalInteger(value))
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsDateString()
  updatedSince?: string;
}
