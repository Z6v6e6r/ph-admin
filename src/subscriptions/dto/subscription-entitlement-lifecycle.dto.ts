import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  Length,
  NotContains,
  Min,
  Max,
  ValidateIf,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';
import { SubscriptionAction } from '../subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const ACTIONS: SubscriptionAction[] = [
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
];

export class ReserveSubscriptionEntitlementTargetDto {
  @IsString()
  @Matches(ID_PATTERN)
  targetId!: string;
}

export class ReserveSubscriptionEntitlementSnapshotExpectationDto {
  @NotContains('\n')
  @NotContains('\r')
  @IsString()
  @Matches(ID_PATTERN)
  snapshotId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  revision!: number;

  @IsString()
  @Matches(ID_PATTERN)
  @NotContains('\n')
  @NotContains('\r')
  evidenceRef!: string;
}

export class ReserveSubscriptionEntitlementExpectationsDto {
  @IsIn([1])
  schemaVersion!: 1;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  policyVersion!: number;

  @IsString()
  @Length(71, 71)
  @Matches(/^sha256:[a-f0-9]{64}$/)
  policyDigest!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReserveSubscriptionEntitlementSnapshotExpectationDto)
  targetSnapshot!: ReserveSubscriptionEntitlementSnapshotExpectationDto;
}

export class ReserveSubscriptionEntitlementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  subscriptionInstanceId!: string;

  @IsIn(ACTIONS)
  action!: SubscriptionAction;

  @ValidateNested()
  @IsDefined()
  @Type(() => ReserveSubscriptionEntitlementTargetDto)
  target!: ReserveSubscriptionEntitlementTargetDto;

  // Omission preserves the legacy contract; explicit null is invalid.
  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReserveSubscriptionEntitlementExpectationsDto)
  expectations?: ReserveSubscriptionEntitlementExpectationsDto;
}

export class ConfirmSubscriptionEntitlementDto {
  @IsString()
  @Matches(ID_PATTERN)
  operationId!: string;

  @IsString()
  @Matches(ID_PATTERN)
  providerBookingId!: string;
}

export class ReleaseSubscriptionEntitlementDto {
  @IsString()
  @Matches(ID_PATTERN)
  operationId!: string;

  @IsIn(['PROVIDER_REJECTED', 'BOOKING_CANCELLED'])
  reason!: 'PROVIDER_REJECTED' | 'BOOKING_CANCELLED';

  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN)
  providerBookingId?: string;
}

export class ReadbackSubscriptionEntitlementDto {
  @IsString()
  @Matches(ID_PATTERN)
  operationId!: string;

  @IsString()
  @Matches(ID_PATTERN)
  subscriptionInstanceId!: string;
}
