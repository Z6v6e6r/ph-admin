import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  registerDecorator,
  ValidationArguments
} from 'class-validator';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const STATION_SET_ID = /^station-set:[a-f0-9]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function IsSubscriptionProviderScopeId(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isSubscriptionProviderScopeId',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const request = args.object as ConfirmSubscriptionSaleBindingDto;
          return typeof value === 'string'
            && (request.providerScopeKind === 'STATION_SET'
              ? STATION_SET_ID.test(value)
              : ID.test(value));
        }
      }
    });
  };
}

export class ConfirmSubscriptionSaleBindingDto {
  @IsIn(['VIVA']) provider!: 'VIVA';
  @IsString() @Matches(ID) providerProductId!: string;
  @IsIn(['TENANT', 'STATION', 'STATION_SET'])
  providerScopeKind!: 'TENANT' | 'STATION' | 'STATION_SET';
  @IsString() @IsSubscriptionProviderScopeId() providerScopeId!: string;

  @IsString() @Matches(ID) providerClientId!: string;
  @IsString() @Matches(ID) clientSubscriptionId!: string;
  @IsString() @Matches(ID) providerTransactionId!: string;
  @IsIn(['PAID', 'SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED', 'APPROVED'])
  providerTransactionStatus!: 'PAID' | 'SUCCESS' | 'SUCCEEDED' | 'COMPLETE' | 'COMPLETED' | 'APPROVED';
  @IsIn(['PENDING_ACTIVATION', 'ACTIVE']) providerSubscriptionState!: 'PENDING_ACTIVATION' | 'ACTIVE';
  @IsString() @Matches(ID) homeStationId!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) purchasePriceMinor!: number;
  @IsString() @Matches(ISO_INSTANT) purchasedAt!: string;
  @IsOptional() @IsString() @Matches(ISO_INSTANT) activeFrom!: string | null;
  @IsOptional() @IsString() @Matches(ISO_INSTANT) activeTo!: string | null;
  @IsString() @Matches(ISO_INSTANT) providerObservedAt!: string;

  @IsString() @Matches(ID) requiredAdapterId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) requiredContractVersion!: number;
  @IsString() @Matches(DIGEST) requiredCapabilityDigest!: string;

  @IsString() @Matches(ID) expectedMappingId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedMappingRevision!: number;
  @IsString() @Matches(ID) expectedSubscriptionTypeId!: string;
  @IsString() @Matches(ID) expectedPublicationId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedPolicyVersion!: number;
  @IsString() @Matches(DIGEST) expectedPolicyDigest!: string;
  @IsString() @Matches(ID) expectedFenceId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedFenceRevision!: number;
  @IsString() @Matches(DIGEST) expectedFenceDigest!: string;
  @IsString() @Matches(DIGEST) expectedProjectorReconciliationDigest!: string;
  @IsString() @Matches(ID) expectedReleaseProgramId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedReleaseProgramRevision!: number;
  @IsString() @Matches(ID) expectedReleasePhaseId!: string;
}
