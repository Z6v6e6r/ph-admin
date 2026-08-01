import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stationIds?: string[];
}
