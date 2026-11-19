import { IsNumber, IsString, Max, MaxLength, Min, MinLength, Matches, ValidateIf } from 'class-validator';
export class AssignPlayerRatingDto {
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/) clientId!: string;
  @IsNumber({ maxDecimalPlaces: 5 }) @Min(1) @Max(7) ratingNumeric!: number;
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @IsString() @MinLength(12) @MaxLength(200) idempotencyKey!: string;
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) stationId?: string;
}
