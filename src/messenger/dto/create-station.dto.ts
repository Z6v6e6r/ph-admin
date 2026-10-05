import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsUUID()
  tournamentBroadcastBoxId?: string | null;
}
