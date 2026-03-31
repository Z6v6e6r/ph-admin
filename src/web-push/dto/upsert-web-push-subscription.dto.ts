import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertWebPushSubscriptionDto {
  @IsObject()
  subscription!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  threadId?: string;
}
