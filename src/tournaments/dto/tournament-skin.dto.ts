import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class TournamentSkinDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  badgeLabel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];
}
