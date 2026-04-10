import { IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AmericanoPlayerDto {
  @IsString()
  @MaxLength(80)
  id!: string;

  @IsNumber()
  rating!: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  gameRating?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  verifiedFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  regularityFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.9)
  engagementFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  gamesPlayed?: number;

  @IsOptional()
  @IsISO8601()
  lastGameAt?: string | null;
}
