import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from 'class-validator';

export class CreateAdminUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  login!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  maxPublicUrl?: string;

  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stationIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  connectorRoutes?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
