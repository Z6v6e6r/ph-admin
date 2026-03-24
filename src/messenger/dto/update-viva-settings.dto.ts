import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateVivaSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tokenUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  staticToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  password?: string;
}
