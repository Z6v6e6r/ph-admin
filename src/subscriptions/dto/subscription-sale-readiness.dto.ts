import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  registerDecorator,
  ValidationArguments
} from 'class-validator';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const STATION_SET_ID = /^station-set:[a-f0-9]{64}$/;

function IsSubscriptionProviderScopeId(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isSubscriptionProviderScopeId',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const request = args.object as SubscriptionSaleReadinessDto;
          return typeof value === 'string'
            && (request.providerScopeKind === 'STATION_SET'
              ? STATION_SET_ID.test(value)
              : ID.test(value));
        }
      }
    });
  };
}

export class SubscriptionSaleReadinessDto {
  @IsIn(['VIVA']) provider!: 'VIVA';
  @IsString() @Matches(ID) providerProductId!: string;
  @IsIn(['TENANT', 'STATION', 'STATION_SET']) providerScopeKind!: 'TENANT' | 'STATION' | 'STATION_SET';
  @IsString() @IsSubscriptionProviderScopeId() providerScopeId!: string;
  @IsString() @Matches(ID) requiredAdapterId!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) requiredContractVersion!: number;
  @IsString() @Matches(/^sha256:[a-f0-9]{64}$/) requiredCapabilityDigest!: string;
}
