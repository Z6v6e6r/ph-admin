import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export class SubscriptionProviderMappingPreviewDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(PROVIDER_ID_PATTERN)
  canonicalStationId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(PROVIDER_ID_PATTERN)
  providerStudioId!: string;
}
