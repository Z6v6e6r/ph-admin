import { IsDefined, IsIn, IsInt, IsObject, Max, Min } from 'class-validator';
import { SubscriptionAction } from '../subscriptions.types';

const GAME_ACTIONS: SubscriptionAction[] = ['CREATE_GAME', 'JOIN_GAME'];

export class SubscriptionUsageResolvedQuoteDto {
  @IsIn(GAME_ACTIONS)
  action!: 'CREATE_GAME' | 'JOIN_GAME';

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
