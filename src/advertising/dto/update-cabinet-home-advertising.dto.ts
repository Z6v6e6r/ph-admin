import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested
} from 'class-validator';

export class UpdateCabinetHomeAdvertisingAdDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsString()
  @MaxLength(4000)
  href!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imageAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  imageDataUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCabinetHomeAdvertisingDto {
  @IsBoolean()
  rotationEnabled!: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UpdateCabinetHomeAdvertisingAdDto)
  ads!: UpdateCabinetHomeAdvertisingAdDto[];
}
