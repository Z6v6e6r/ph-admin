import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateSubscriptionTypeDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}
