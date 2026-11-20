import { IsIn, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PlayerRatingGrade } from '../player-ratings.types';

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

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'])
  expectedPreviousGrade?: PlayerRatingGrade;

  @ValidateIf((object: ChangePlayerRatingDto, value) => value !== undefined || object.expectedPreviousGrade !== undefined)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  expectedClientId?: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  idempotencyKey!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  stationId?: string;
}
