import { StoredSubscriptionEntitlementAggregate, SubscriptionShadowQuoteResult } from '../../src/subscriptions/subscriptions.types';

export const NOW = '2026-08-31T10:00:00.000Z';
export const POLICY_DIGEST = `sha256:${'a'.repeat(64)}`;
export const CLIENT_HASH = 'b'.repeat(64);

export const aggregateFixture = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription:annual-1',
  revision: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 0,
  activeServices: [],
  dailyUsage: {},
  weeklyUsage: {},
  monthlyUsage: {},
  futureBookingCount: 0,
  futureServiceStartsAt: [],
  remainingUnits: 10,
  reconciliation: {
    state: 'CURRENT',
    asOf: NOW,
    evidenceRef: 'evidence:projection-1'
  },
  createdAt: NOW,
  updatedAt: NOW
});

export const quoteFixture = (
  aggregate: StoredSubscriptionEntitlementAggregate,
  overrides: Partial<SubscriptionShadowQuoteResult> = {}
): SubscriptionShadowQuoteResult => ({
  quoteKind: 'SHADOW',
  nonBinding: true,
  requiresReservationRecheck: true,
  eligible: true,
  blockers: [],
  subscriptionInstanceId: aggregate.subscriptionInstanceId,
  policyVersion: 3,
  policyDigest: POLICY_DIGEST,
  aggregateRevision: aggregate.revision,
  evaluatedAt: NOW,
  usageUnits: 1,
  activeServices: aggregate.activeServiceCount,
  maxActiveServices: 4,
  dailyUsed: aggregate.dailyUsage['2026-09-01'] ?? 0,
  dailyLimit: 1,
  usageBucket: {
    localDate: '2026-09-01',
    localWeek: '2026-W36',
    localMonth: '2026-09'
  },
  dailyUsageApplies: true,
  dailyLimitExceeded: false,
  benefit: {
    kind: 'FREE_ENTITLEMENT',
    ruleId: 'benefit:game-free-hour',
    stationRuleId: 'station:piter',
    basePriceMinor: 150000,
    discountMinor: 150000,
    surchargeMinor: 0,
    finalPriceMinor: 0,
    partialPriceCalculation: null,
    currency: 'RUB'
  },
  decision: {
    decisionKind: 'ENTITLEMENT',
    policyVersion: 3,
    policyDigest: POLICY_DIGEST,
    action: 'CREATE_GAME',
    target: {
      targetId: 'exercise:game-1',
      stationId: 'station:piter',
      eventTypeId: 'event:open-game',
      productTypeId: null,
      durationMinutes: 60,
      startsAt: '2026-09-01T09:00:00.000Z'
    },
    usageUnits: 1,
    money: {
      basePriceMinor: 150000,
      discountMinor: 150000,
      surchargeMinor: 0,
      finalPriceMinor: 0,
      currency: 'RUB'
    }
  },
  ...overrides
});
