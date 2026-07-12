import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ChangePlayerRatingDto {
  @IsNumber({ maxDecimalPlaces: 5 })
  @Min(1)
  @Max(7)
  ratingNumeric!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  expectedLastEventId!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  idempotencyKey!: string;
}
