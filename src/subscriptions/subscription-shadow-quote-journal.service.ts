import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredLk2QuoteDecisionJournalEntry,
  SubscriptionAction,
  SubscriptionShadowQuoteResult
} from './subscriptions.types';

/**
 * Best-effort decision journal for the LK1 trusted shadow quote.
 *
 * The LK1 quote is advisory: the financial decision is still recorded on reserve/confirm. Journaling
 * it here makes the operator's "last quote decision" complete across channels, but a journal outage
 * must never fail an advisory preview for a legacy caller. The flag is off by default and the write
 * is skipped when the result does not carry its tenant.
 */
@Injectable()
export class SubscriptionShadowQuoteJournalService {
  public constructor(private readonly repository: SubscriptionsRepository) {}

  public async journalLk1Quote(input: {
    readonly result: SubscriptionShadowQuoteResult;
    readonly action: SubscriptionAction;
    readonly targetId: string;
    readonly correlationId: string | null;
  }): Promise<boolean> {
    if (!this.enabled()) return false;
    if (!input.result.tenantId) return false;
    if (!input.result.subscriptionInstanceId) return false;
    const entry: StoredLk2QuoteDecisionJournalEntry = {
      decisionId: randomUUID(),
      channel: 'LK1',
      tenantId: input.result.tenantId,
      correlationId: input.correlationId,
      action: input.action,
      targetId: input.targetId,
      subscriptionInstanceId: input.result.subscriptionInstanceId,
      outcome: input.result.eligible ? 'ENTITLEMENT_APPLIED' : 'BENEFIT_UNAVAILABLE',
      serviceAllowed: input.result.eligible,
      subscriptionBenefitAllowed: input.result.eligible,
      blockers: input.result.blockers.map((blocker) => blocker.code),
      policyVersion: input.result.policyVersion,
      policyDigest: input.result.policyDigest,
      evaluatedAt: input.result.evaluatedAt,
      recordedAt: new Date().toISOString()
    };
    try {
      await this.repository.connect();
      await this.repository.appendLk2QuoteDecision(entry);
      return true;
    } catch {
      return false;
    }
  }

  private enabled(): boolean {
    return ['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_LK1_QUOTE_JOURNAL_ENABLED ?? '').trim().toLowerCase()
    );
  }
}
