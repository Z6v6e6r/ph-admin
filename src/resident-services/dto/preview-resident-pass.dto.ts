import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PreviewResidentPassDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  stationId?: string;
}
