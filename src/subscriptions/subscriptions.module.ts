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
import { SubscriptionEntitlementLifecycleService } from './subscription-entitlement-lifecycle.service';
import { SubscriptionRuntimeContextService } from './subscription-runtime-context.service';
import { SubscriptionPolicyRegistryService } from './subscription-policy-registry.service';
import { SubscriptionActivationService } from './subscription-activation.service';
import { SubscriptionActivationDeadlineWorker } from './subscription-activation-deadline.worker';
import { SubscriptionPublicationService } from './subscription-publication.service';
import { SubscriptionSaleReadinessService } from './subscription-sale-readiness.service';
import { SubscriptionSaleBindingService } from './subscription-sale-binding.service';
import { CanonicalTargetIntakeController } from './canonical-target-intake.controller';
import { CanonicalTargetIntakeService } from './canonical-target-intake.service';
import { SubscriptionShadowQuoteJournalService } from './subscription-shadow-quote-journal.service';
import { Lk2QuoteController } from './lk2-runtime/lk2-quote.controller';
import {
  MongoLk2QuoteDecisionJournalStore,
  MongoLk2QuoteDelegationReplayStore,
  Lk2QuoteReceiverService
} from './lk2-runtime/lk2-quote-receiver.service';
import { loadLk2QuoteDelegationConfig } from './lk2-runtime/lk2-quote-delegation.verifier';
import { Lk2ShadowQuoteEvaluator } from './lk2-runtime/lk2-shadow-quote-evaluator';

@Module({
  imports: [AuthModule, LkIdentityModule, VivaAdminModule],
  controllers: [
    SubscriptionsController,
    SubscriptionTestController,
    SubscriptionTrustedShadowController,
    Lk2QuoteController,
    CanonicalTargetIntakeController
  ],
  providers: [
    SubscriptionsService,
    SubscriptionShadowQuoteService,
    SubscriptionCanonicalTargetResolverService,
    SubscriptionProviderMappingPreviewService,
    SubscriptionTrustedShadowAdapterService,
    SubscriptionEntitlementLifecycleService,
    SubscriptionRuntimeContextService,
    SubscriptionPolicyRegistryService,
    SubscriptionActivationService,
    SubscriptionActivationDeadlineWorker,
    SubscriptionPublicationService,
    SubscriptionSaleReadinessService,
    SubscriptionSaleBindingService,
    CanonicalTargetIntakeService,
    SubscriptionShadowQuoteJournalService,
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter,
    {
      provide: Lk2QuoteReceiverService,
      inject: [
        SubscriptionsRepository,
        SubscriptionCanonicalTargetResolverService,
        SubscriptionShadowQuoteService
      ],
      useFactory: (
        repository: SubscriptionsRepository,
        targets: SubscriptionCanonicalTargetResolverService,
        shadowQuote: SubscriptionShadowQuoteService
      ) => {
        const enabled = ['1', 'true', 'yes'].includes(
          String(process.env.SUBSCRIPTIONS_LK2_QUOTE_ENABLED ?? '').trim().toLowerCase()
        );
        if (!enabled) return new Lk2QuoteReceiverService({ enabled: false });
        let delegationConfig;
        try {
          delegationConfig = loadLk2QuoteDelegationConfig();
        } catch {
          return new Lk2QuoteReceiverService({ enabled: false });
        }
        return new Lk2QuoteReceiverService({
          enabled: true,
          integrationToken: process.env.SUBSCRIPTIONS_LK2_QUOTE_INTEGRATION_TOKEN,
          delegationConfig,
          replayStore: new MongoLk2QuoteDelegationReplayStore(repository),
          journal: new MongoLk2QuoteDecisionJournalStore(repository),
          evaluator: new Lk2ShadowQuoteEvaluator(repository, targets, shadowQuote)
        });
      }
    }
  ]
})
export class SubscriptionsModule {}
