import { Type } from 'class-transformer';
import {
  IsIn,
  IsDefined,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested
} from 'class-validator';
import { BenefitCategory, SubscriptionAction } from '../subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const CANONICAL_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACTIONS: SubscriptionAction[] = [
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
];
const CATEGORIES: BenefitCategory[] = [
  'GAME',
  'GROUP_TRAINING',
  'TOURNAMENT',
  'ADD_ON_PRODUCT'
];

export class SubscriptionShadowQuoteResolvedTargetDto {
  @IsString()
  @Matches(ID_PATTERN)
  targetId!: string;

  @IsString()
  @Matches(ID_PATTERN)
  stationId!: string;

  @IsIn(CATEGORIES)
  category!: BenefitCategory;

  @IsString()
  @Matches(ID_PATTERN)
  externalEventTypeId!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(ID_PATTERN)
  productTypeId!: string | null;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(CANONICAL_ISO_PATTERN)
  startsAt!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  basePriceMinor!: number;

  @IsIn(['RUB'])
  currency!: 'RUB';

  @IsString()
  @Matches(ID_PATTERN)
  dictionaryRevision!: string;

  @IsString()
  @Matches(ID_PATTERN)
  evidenceRef!: string;

  @IsString()
  @Matches(ID_PATTERN)
  priceEvidenceRef!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(CANONICAL_ISO_PATTERN)
  resolvedAt!: string;
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
  @Type(() => SubscriptionShadowQuoteResolvedTargetDto)
  target!: SubscriptionShadowQuoteResolvedTargetDto;
}
