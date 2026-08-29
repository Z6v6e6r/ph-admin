import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SubscriptionUsageTestQuoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  targetId!: string;

  @IsInt()
  @Min(0)
  @Max(4)
  activeServices!: number;

  @IsInt()
  @Min(0)
  @Max(4)
  dailyGameUsage!: number;
}
