import type { SubscriptionCanonicalTargetResolverService } from '../subscription-canonical-target-resolver.service';
import type { SubscriptionShadowQuoteService } from '../subscription-shadow-quote.service';
import { computeSubscriptionClientRefHash } from '../subscription-trusted-shadow-adapter.service';
import type { SubscriptionsRepository } from '../subscriptions.repository';
import type {
  SubscriptionShadowQuoteResult,
  SubscriptionShadowQuoteResolvedTarget,
  StoredSubscriptionInstance
} from '../subscriptions.types';
import {
  Lk2QuoteEvaluationUnavailable,
  type Lk2QuoteEvaluation,
  type Lk2QuoteEvaluator
} from './lk2-quote-receiver.service';

/**
 * Benefit blockers that deny only the subscription benefit; the service itself remains available
 * at the ordinary price. Every other blocker is treated as a technical uncertainty until the
 * product mapping explicitly classifies it, so a configuration gap can never silently become a
 * paid allow or a participation ban.
 */
const BENEFIT_DENIAL_BLOCKERS = new Set([
  'ACTIVE_SERVICES_LIMIT_REACHED',
  'DAILY_USAGE_LIMIT_REACHED',
  'WEEKLY_USAGE_LIMIT_REACHED',
  'MONTHLY_USAGE_LIMIT_REACHED',
  'FUTURE_BOOKINGS_LIMIT_REACHED',
  'ENTITLEMENT_UNITS_INSUFFICIENT',
  'STATION_NOT_ALLOWED',
  'EVENT_NOT_INCLUDED',
  'DURATION_NOT_ALLOWED',
  'BOOKING_WINDOW_EXCEEDED',
  'SUBSCRIPTION_BLACKOUT_DATE',
  'SUBSCRIPTION_CREATE_DISABLED',
  'SUBSCRIPTION_JOIN_DISABLED',
  'TARGET_AFTER_SUBSCRIPTION_EXPIRY',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_FROZEN',
  'SUBSCRIPTION_NOT_ACTIVE',
  'SUBSCRIPTION_TYPE_MISMATCH'
]);

const PARTICIPATION_BLOCKERS = new Set(['TARGET_ALREADY_STARTED']);

const BLOCKER_CODE_MAP: Record<string, string> = {
  DAILY_USAGE_LIMIT_REACHED: 'DAILY_LIMIT_REACHED',
  WEEKLY_USAGE_LIMIT_REACHED: 'WEEKLY_LIMIT_REACHED',
  MONTHLY_USAGE_LIMIT_REACHED: 'MONTHLY_LIMIT_REACHED',
  ENTITLEMENT_UNITS_INSUFFICIENT: 'UNITS_EXHAUSTED',
  SUBSCRIPTION_BLACKOUT_DATE: 'BLACKOUT_DATE',
  SUBSCRIPTION_CREATE_DISABLED: 'POLICY_ACTION_DISABLED',
  SUBSCRIPTION_JOIN_DISABLED: 'POLICY_ACTION_DISABLED',
  SUBSCRIPTION_NOT_ACTIVE: 'SUBSCRIPTION_INACTIVE',
  SUBSCRIPTION_TYPE_MISMATCH: 'SUBSCRIPTION_TYPE_MISMATCH',
  TARGET_AFTER_SUBSCRIPTION_EXPIRY: 'EVENT_NOT_INCLUDED',
  TARGET_ALREADY_STARTED: 'SERVICE_UNAVAILABLE'
};

function contractBlocker(code: string): string {
  return BLOCKER_CODE_MAP[code] ?? code;
}

function technicalReason(code: string): string {
  if (code.startsWith('TARGET_')) return 'TARGET_NOT_SERVER_RESOLVED';
  if (code.startsWith('BASE_PRICE') || code.startsWith('PRICE_') || code.startsWith('CURRENCY_')) {
    return 'PRICE_UNAVAILABLE';
  }
  if (code.startsWith('POLICY_')) return 'POLICY_UNAVAILABLE';
  if (code.startsWith('PROVIDER_MAPPING') || code.startsWith('DICTIONARY_')) {
    return 'POLICY_MAPPING_UNVERIFIED';
  }
  if (code.startsWith('ENTITLEMENT_AGGREGATE') || code.startsWith('USAGE_')) {
    return 'USAGE_SNAPSHOT_STALE';
  }
  if (code.startsWith('SUBSCRIPTION_INSTANCE')) return 'SUBSCRIPTION_INSTANCE_STALE';
  return 'POLICY_UNAVAILABLE';
}

function shortPrice(
  result: SubscriptionShadowQuoteResult,
  target: SubscriptionShadowQuoteResolvedTarget
): Lk2QuoteEvaluation['price'] {
  const revision = target.snapshotRevision ?? 1;
  if (result.benefit && result.benefit.finalPriceMinor !== null) {
    return {
      priceRevision: revision,
      basePriceMinor: result.benefit.basePriceMinor ?? 0,
      discountMinor: result.benefit.discountMinor,
      surchargeMinor: result.benefit.surchargeMinor,
      finalPriceMinor: result.benefit.finalPriceMinor,
      currency: 'RUB'
    };
  }
  if (target.basePriceMinor !== null) {
    return {
      priceRevision: revision,
      basePriceMinor: target.basePriceMinor,
      discountMinor: 0,
      surchargeMinor: 0,
      finalPriceMinor: target.basePriceMinor,
      currency: 'RUB'
    };
  }
  return null;
}

/** Denial outcomes must quote the price without the subscription benefit, never its final price. */
function fullPrice(target: SubscriptionShadowQuoteResolvedTarget): Lk2QuoteEvaluation['price'] {
  if (target.basePriceMinor === null) return null;
  return {
    priceRevision: target.snapshotRevision ?? 1,
    basePriceMinor: target.basePriceMinor,
    discountMinor: 0,
    surchargeMinor: 0,
    finalPriceMinor: target.basePriceMinor,
    currency: 'RUB'
  };
}

function limits(result: SubscriptionShadowQuoteResult): Lk2QuoteEvaluation['limits'] {
  return {
    activeServices: result.activeServices,
    activeServicesLimit: result.maxActiveServices,
    dailyUsed: result.dailyUsed,
    dailyLimit: result.dailyLimit,
    weeklyUsed: result.weeklyUsed ?? null,
    weeklyLimit: result.weeklyLimit ?? null,
    monthlyUsed: result.monthlyUsed ?? null,
    monthlyLimit: result.monthlyLimit ?? null,
    remainingUnits: null
  };
}

function selectionOutcome(
  outcome: 'FULL_PRICE_ONLY' | 'SUBSCRIPTION_SELECTION_REQUIRED',
  code: string
): Lk2QuoteEvaluation {
  return {
    outcome,
    serviceAllowed: true,
    subscriptionBenefitAllowed: false,
    selectedSubscription: null,
    benefit: null,
    price: null,
    limits: {
      activeServices: null,
      activeServicesLimit: null,
      dailyUsed: null,
      dailyLimit: null,
      weeklyUsed: null,
      weeklyLimit: null,
      monthlyUsed: null,
      monthlyLimit: null,
      remainingUnits: null
    },
    blockers: [{ code }],
    warnings: [],
    alternatives:
      outcome === 'FULL_PRICE_ONLY'
        ? [{ paymentIntent: 'PAY_FULL_PRICE', requiresExplicitUserConfirmation: true }]
        : []
  };
}

/**
 * Real evaluator: resolves the actor-owned instance from the verified delegation claims, resolves
 * the server-side canonical target and runs the existing CUP shadow quote. It never trusts actor,
 * provider, price or policy values supplied by the caller and never turns an unclassified blocker
 * into an allow.
 */
export class Lk2ShadowQuoteEvaluator implements Lk2QuoteEvaluator {
  public constructor(
    private readonly repository: Pick<
      SubscriptionsRepository,
      'runtimeInstancesByProviderMappingAndClient'
    >,
    private readonly targets: Pick<SubscriptionCanonicalTargetResolverService, 'resolveLatest'>,
    private readonly shadowQuote: Pick<SubscriptionShadowQuoteService, 'quote'>,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async evaluate(input: {
    readonly delegation: Parameters<Lk2QuoteEvaluator['evaluate']>[0]['delegation'];
    readonly request: Parameters<Lk2QuoteEvaluator['evaluate']>[0]['request'];
    readonly correlationId: string;
  }): Promise<Lk2QuoteEvaluation> {
    let instances: StoredSubscriptionInstance[];
    try {
      instances = await this.repository.runtimeInstancesByProviderMappingAndClient({
        tenantId: input.delegation.tenantId,
        mappingId: input.delegation.providerMappingId,
        providerClientId: input.delegation.providerClientId
      });
    } catch {
      throw new Lk2QuoteEvaluationUnavailable('POLICY_UNAVAILABLE');
    }
    const preferred = input.request.preferredSubscriptionInstanceId;
    let instance: StoredSubscriptionInstance | undefined;
    if (preferred !== undefined) {
      instance = instances.find((item) => item.subscriptionInstanceId === preferred);
      if (!instance) {
        return selectionOutcome('SUBSCRIPTION_SELECTION_REQUIRED', 'SUBSCRIPTION_NOT_OWNED_BY_ACTOR');
      }
    } else if (instances.length === 0) {
      return selectionOutcome('FULL_PRICE_ONLY', 'SUBSCRIPTION_NOT_FOUND');
    } else if (instances.length > 1) {
      return selectionOutcome('SUBSCRIPTION_SELECTION_REQUIRED', 'SUBSCRIPTION_SELECTION_REQUIRED');
    } else {
      instance = instances[0];
    }
    if (!instance) throw new Lk2QuoteEvaluationUnavailable('POLICY_UNAVAILABLE');

    const pepper = String(process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER ?? '');
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new Lk2QuoteEvaluationUnavailable('POLICY_UNAVAILABLE');
    }
    // The identity resolution source remains the server-verified LK2 delegation; the request
    // cannot supply it.
    let target: SubscriptionShadowQuoteResolvedTarget;
    try {
      target = await this.targets.resolveLatest({
        tenantId: input.delegation.tenantId,
        targetId: input.request.target.id,
        action: input.request.action
      });
    } catch (error) {
      const code = (error as { getResponse?: () => unknown }).getResponse?.();
      const domainCode =
        code && typeof code === 'object' ? (code as { code?: unknown }).code : undefined;
      if (typeof domainCode === 'string' && domainCode.includes('NOT_FOUND')) {
        throw new Lk2QuoteEvaluationUnavailable('TARGET_NOT_FOUND');
      }
      throw new Lk2QuoteEvaluationUnavailable('TARGET_STALE');
    }
    if (!target.snapshotRevision) {
      throw new Lk2QuoteEvaluationUnavailable('TARGET_STALE');
    }
    const now = this.now();
    let result: SubscriptionShadowQuoteResult;
    try {
      result = await this.shadowQuote.quote({
        identity: {
          resolutionSource: 'LK_IDENTITY',
          tenantId: input.delegation.tenantId,
          clientRefHash: computeSubscriptionClientRefHash({
            pepper,
            tenantId: input.delegation.tenantId,
            providerClientId: input.delegation.providerClientId
          }),
          evidenceRef: `lk2-delegation:${input.delegation.jti}`,
          verifiedAt: now.toISOString()
        },
        subscriptionInstanceId: instance.subscriptionInstanceId,
        action: input.request.action,
        target
      });
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      const domainCode =
        response && typeof response === 'object'
          ? (response as { code?: unknown }).code
          : (error as { code?: unknown }).code;
      throw new Lk2QuoteEvaluationUnavailable(
        typeof domainCode === 'string' ? technicalReason(domainCode) : 'POLICY_UNAVAILABLE'
      );
    }

    const blockers = result.blockers.map((blocker) => blocker.code);
    const technical = blockers.filter(
      (code) => !BENEFIT_DENIAL_BLOCKERS.has(code) && !PARTICIPATION_BLOCKERS.has(code)
    );
    if (technical.length > 0) {
      throw new Lk2QuoteEvaluationUnavailable(
        technicalReason(technical[0] as string)
      );
    }
    const selectedSubscription =
      result.policyVersion !== null && result.policyDigest !== null
        ? {
            subscriptionInstanceId: instance.subscriptionInstanceId,
            policyVersion: result.policyVersion,
            policyDigest: result.policyDigest
          }
        : null;
    const mappedBlockers = result.blockers.map((blocker) => ({
      code: contractBlocker(blocker.code)
    }));
    if (blockers.some((code) => PARTICIPATION_BLOCKERS.has(code))) {
      return {
        outcome: 'SERVICE_BLOCKED',
        serviceAllowed: false,
        subscriptionBenefitAllowed: false,
        selectedSubscription,
        benefit: null,
        price: null,
        limits: limits(result),
        blockers: mappedBlockers,
        warnings: [],
        alternatives: []
      };
    }
    if (result.eligible && result.benefit && result.benefit.kind !== 'NONE') {
      return {
        outcome: 'ENTITLEMENT_APPLIED',
        serviceAllowed: true,
        subscriptionBenefitAllowed: true,
        selectedSubscription,
        benefit: {
          kind: result.benefit.kind,
          ruleId: result.benefit.ruleId,
          usageUnits: result.usageUnits ?? 0
        },
        price: shortPrice(result, target),
        limits: limits(result),
        blockers: mappedBlockers,
        warnings: [],
        alternatives: []
      };
    }
    return {
      outcome: 'FULL_PRICE_ONLY',
      serviceAllowed: true,
      subscriptionBenefitAllowed: false,
      selectedSubscription,
      benefit: null,
      price: fullPrice(target),
      limits: limits(result),
      blockers: mappedBlockers,
      warnings: [],
      alternatives: [{ paymentIntent: 'PAY_FULL_PRICE', requiresExplicitUserConfirmation: true }]
    };
  }
}
