import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested
} from 'class-validator';
import {
  MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTIONS,
  MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS,
  MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KINDS
} from '../subscription-runtime-contracts';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export class SubscriptionRuntimeV1QuoteTargetDto {
  @IsIn(MANAGED_SUBSCRIPTION_RUNTIME_V1_TARGET_KINDS)
  kind!: string;

  @IsString()
  @Matches(ID_PATTERN)
  id!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;
}

export class SubscriptionRuntimeV1QuoteDto {
  @IsIn(MANAGED_SUBSCRIPTION_RUNTIME_V1_ACTIONS)
  action!: string;

  @ValidateNested()
  @Type(() => SubscriptionRuntimeV1QuoteTargetDto)
  target!: SubscriptionRuntimeV1QuoteTargetDto;

  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN)
  preferredSubscriptionInstanceId?: string;

  @IsIn(MANAGED_SUBSCRIPTION_RUNTIME_V1_PAYMENT_INTENTS)
  paymentIntent!: string;
}
