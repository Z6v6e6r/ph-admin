import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IMPACT_REF_PATTERN = /^impact:subscription-publication:[a-f0-9]{64}$/;
const DICTIONARY_EVIDENCE_PATTERN = /^evidence:canonical-dictionary:[a-f0-9]{64}$/;

export class SubscriptionPolicyPublicationPreviewDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(PROVIDER_ID_PATTERN)
  providerStudioId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(PROVIDER_ID_PATTERN)
  dictionaryRevision!: string;

  @IsString()
  @Matches(DICTIONARY_EVIDENCE_PATTERN)
  dictionaryEvidenceRef!: string;
}

export class PublishSubscriptionPolicyDto extends SubscriptionPolicyPublicationPreviewDto {
  @IsString()
  @Matches(DIGEST_PATTERN)
  expectedPolicyDigest!: string;

  @IsString()
  @Matches(IMPACT_REF_PATTERN)
  expectedImpactPreviewRef!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  approvalReason!: string;
}
