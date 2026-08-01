import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  badgeText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  footerText?: string;

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
  @IsString()
  @MaxLength(200)
  squareImageAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  squareImageDataUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  horizontalImageAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  horizontalImageDataUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCabinetHomeAdvertisingDto {
  @IsBoolean()
  rotationEnabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  repeatEveryCards?: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UpdateCabinetHomeAdvertisingAdDto)
  ads!: UpdateCabinetHomeAdvertisingAdDto[];
}
