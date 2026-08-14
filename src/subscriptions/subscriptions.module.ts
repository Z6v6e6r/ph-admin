import { Module } from '@nestjs/common';
import { SubscriptionsController, SubscriptionTestController } from './subscriptions.controller';
import { SubscriptionsExceptionFilter } from './subscriptions-exception.filter';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsTestRuntimeService } from './subscriptions-test-runtime.service';

@Module({
  controllers: [SubscriptionsController, SubscriptionTestController],
  providers: [
    SubscriptionsService,
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter
  ]
})
export class SubscriptionsModule {}
