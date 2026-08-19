import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
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

export class SubscriptionShadowQuoteTargetReferenceDto {
  @IsString()
  @Matches(ID_PATTERN)
  targetId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  snapshotRevision!: number;
}

export class SubscriptionShadowQuoteAdapterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(ID_PATTERN)
  subscriptionInstanceId!: string;

  @IsIn(ACTIONS)
  action!: SubscriptionAction;

  @ValidateNested()
  @IsDefined()
  @Type(() => SubscriptionShadowQuoteTargetReferenceDto)
  target!: SubscriptionShadowQuoteTargetReferenceDto;
}
