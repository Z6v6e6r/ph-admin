import { IsDefined, IsIn, IsInt, IsObject, Max, Min } from 'class-validator';
import { SubscriptionAction } from '../subscriptions.types';

const RESOLVED_QUOTE_ACTIONS: SubscriptionAction[] = [
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT'
];

export class SubscriptionUsageResolvedQuoteDto {
  @IsIn(RESOLVED_QUOTE_ACTIONS)
  action!: 'CREATE_GAME' | 'JOIN_GAME' | 'BOOK_GROUP_TRAINING' | 'BOOK_TOURNAMENT';

  @IsDefined()
  @IsObject()
  target!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @Max(4)
  activeServices!: number;

  @IsInt()
  @Min(0)
  @Max(4)
  dailyGameUsage!: number;
}
