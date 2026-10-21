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
import { Lk2QuoteController } from './lk2-runtime/lk2-quote.controller';
import {
  Lk2QuoteEvaluationUnavailable,
  MongoLk2QuoteDecisionJournalStore,
  MongoLk2QuoteDelegationReplayStore,
  Lk2QuoteReceiverService
} from './lk2-runtime/lk2-quote-receiver.service';
import { loadLk2QuoteDelegationConfig } from './lk2-runtime/lk2-quote-delegation.verifier';

@Module({
  imports: [AuthModule, LkIdentityModule, VivaAdminModule],
  controllers: [
    SubscriptionsController,
    SubscriptionTestController,
    SubscriptionTrustedShadowController,
    Lk2QuoteController
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
    SubscriptionsTestRuntimeService,
    SubscriptionsRepository,
    SubscriptionsExceptionFilter,
    {
      provide: Lk2QuoteReceiverService,
      inject: [SubscriptionsRepository],
      useFactory: (repository: SubscriptionsRepository) => {
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
          // The real evaluator over persisted policy/usage is wired separately. Until then the
          // boundary fails closed with a typed technical-uncertainty outcome, never an allow.
          evaluator: {
            evaluate: async () => {
              throw new Lk2QuoteEvaluationUnavailable('POLICY_UNAVAILABLE');
            }
          }
        });
      }
    }
  ]
})
export class SubscriptionsModule {}
