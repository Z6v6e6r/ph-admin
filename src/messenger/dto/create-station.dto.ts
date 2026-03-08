import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  stationId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  stationName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
