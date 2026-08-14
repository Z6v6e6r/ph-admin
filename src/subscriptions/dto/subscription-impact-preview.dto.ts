import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubscriptionImpactPreviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  releaseProgramId!: string;
}
