import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
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
