import { IsInt, Min } from 'class-validator';

export class ActivateSubscriptionTestOfferDto {
  @IsInt()
  @Min(1)
  policyVersion!: number;
}
