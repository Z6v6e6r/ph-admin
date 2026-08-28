import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
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
import { SubscriptionRuntimeContextService } from './subscription-runtime-context.service';
import { SubscriptionActivationService } from './subscription-activation.service';
import { SubscriptionActivationDeadlineWorker } from './subscription-activation-deadline.worker';
import { SubscriptionPublicationService } from './subscription-publication.service';
import { SubscriptionSaleReadinessService } from './subscription-sale-readiness.service';

@Module({
  imports: [AuthModule, LkIdentityModule, VivaAdminModule],
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
    SubscriptionRuntimeContextService,
    SubscriptionActivationService,
    SubscriptionActivationDeadlineWorker,
    SubscriptionPublicationService,
    SubscriptionSaleReadinessService,
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter
  ]
})
export class SubscriptionsModule {}
