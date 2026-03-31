import { IsString, MinLength } from 'class-validator';

export class RemoveWebPushSubscriptionDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;
}
