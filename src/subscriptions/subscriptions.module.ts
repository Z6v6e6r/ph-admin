import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VivaAdminModule } from '../integrations/viva/viva-admin.module';
import { LkIdentityModule } from '../lk-identity/lk-identity.module';
import {
  SubscriptionsController,
  SubscriptionRuntimeV1Controller,
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
import { SubscriptionRuntimeV1QuoteService } from './subscription-runtime-v1-quote.service';

@Module({
  imports: [AuthModule, LkIdentityModule, VivaAdminModule],
  controllers: [
    SubscriptionsController,
    SubscriptionRuntimeV1Controller,
    SubscriptionTestController,
    SubscriptionTrustedShadowController
  ],
  providers: [
    SubscriptionsService,
    SubscriptionShadowQuoteService,
    SubscriptionCanonicalTargetResolverService,
    SubscriptionProviderMappingPreviewService,
    SubscriptionTrustedShadowAdapterService,
    SubscriptionRuntimeV1QuoteService,
    SubscriptionRuntimeContextService,
    SubscriptionActivationService,
    SubscriptionActivationDeadlineWorker,
    SubscriptionPublicationService,
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter
  ]
})
export class SubscriptionsModule {}
