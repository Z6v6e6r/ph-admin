import { Module } from '@nestjs/common';
import { VivaAdminModule } from '../integrations/viva/viva-admin.module';
import { LkIdentityModule } from '../lk-identity/lk-identity.module';
import {
  SubscriptionsController,
  SubscriptionTestController,
  SubscriptionTrustedShadowController
} from './subscriptions.controller';
import { SubscriptionsExceptionFilter } from './subscriptions-exception.filter';
import { SubscriptionProviderMappingPreviewService } from './subscription-provider-mapping-preview.service';
import { SubscriptionCanonicalTargetResolverService } from './subscription-canonical-target-resolver.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionShadowQuoteService } from './subscription-shadow-quote.service';
import { SubscriptionsTestRuntimeService } from './subscriptions-test-runtime.service';
import { SubscriptionTrustedShadowAdapterService } from './subscription-trusted-shadow-adapter.service';

@Module({
  imports: [LkIdentityModule, VivaAdminModule],
  controllers: [
    SubscriptionsController,
    SubscriptionTestController,
    SubscriptionTrustedShadowController
  ],
  providers: [
    SubscriptionsService,
    SubscriptionShadowQuoteService,
    SubscriptionCanonicalTargetResolverService,
    SubscriptionProviderMappingPreviewService,
    SubscriptionTrustedShadowAdapterService,
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter
  ]
})
export class SubscriptionsModule {}
