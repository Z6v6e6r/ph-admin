import { IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export class ActivateSubscriptionFirstUseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  subscriptionInstanceId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  clientSubscriptionId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  providerBookingId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedInstanceRevision!: number;
}
