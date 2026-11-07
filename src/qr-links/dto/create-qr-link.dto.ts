import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength
} from 'class-validator';

export class CreateQrLinkDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  placement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  targetUrl!: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: 'ACTIVE' | 'PAUSED';
}
