import { IsIn } from 'class-validator';

export class FakeConfirmSubscriptionTestPurchaseDto {
  @IsIn(['PAID', 'FAILED', 'PENDING'])
  outcome!: 'PAID' | 'FAILED' | 'PENDING';
}
