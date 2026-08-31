import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError
} from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionShadowQuoteService } from '../src/subscriptions/subscription-shadow-quote.service';
import { evaluateSubscriptionShadowQuote } from '../src/subscriptions/subscription-shadow-quote';
import {
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  SubscriptionShadowQuoteRequest
} from '../src/subscriptions/subscriptions.types';

const NOW = '2026-08-16T10:00:00.000Z';
const HASH = 'a'.repeat(64);

const publicationFixture = (): StoredSubscriptionPolicyPublication => {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:friendship-12m',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-16T00:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: true, max: 3, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: true, days: 4 },
    dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [{
      ruleId: 'station_rule:home',
      enabled: true,
      priority: 10,
      selector: { kind: 'HOME_STATION', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [{
      ruleId: 'benefit_rule:create-game',
      enabled: true,
      category: 'GAME',
      actions: ['CREATE_GAME'],
      externalEventTypeIds: ['event_type:open-game'],
      productTypeIds: [],
      durationMinutes: [60, 90, 120],
      stationIds: ['station:yasenevo'],
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 10
    }],
    lifecycle: { allowBookingsAfterExpiry: false },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: []
    }
  };
  return {
    schemaVersion: 1,
    publicationId: 'publication:friendship-12m-v3',
    subscriptionTypeId: runtimeProjection.subscriptionTypeId,
    policyVersion: runtimeProjection.policyVersion,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: 'mapping:friendship-12m',
    dictionaryRevision: 'dictionary:2026-08-16',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: '2026-08-16T09:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:friendship-12m-v3',
    approvalAuditRef: 'audit:friendship-12m-v3'
  };
};

const instanceFixture = (): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  tenantId: 'iSkq6G',
  subscriptionTypeId: 'subscription_type:friendship-12m',
  policyVersion: 3,
  policyDigest: publicationFixture().policyDigest,
  mappingId: 'mapping:friendship-12m',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerClientId: 'provider_client:synthetic-1',
  clientSubscriptionId: 'client_subscription:synthetic-1',
  clientRefHash: HASH,
  homeStationId: 'station:yasenevo',
  releaseProgramId: 'release_program:friendship-2026',
  releasePhaseId: 'release_phase:first-50',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: '2026-08-16T09:00:00.000Z',
  activeFrom: '2026-08-16T00:00:00.000Z',
  activeTo: '2027-08-15T23:59:59.999Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment-readback',
    providerInstanceEvidenceRef: 'evidence:provider-instance-readback',
    lastReadBackEvidenceRef: 'evidence:provider-instance-readback'
  },
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:instance-current'
  },
  revision: 1,
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z'
});

const aggregateFixture = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  revision: 4,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 0,
  activeServices: [],
  dailyUsage: {},
  weeklyUsage: {},
  monthlyUsage: {},
  futureBookingCount: 0,
  futureServiceStartsAt: [],
  remainingUnits: 270,
  reconciliation: {
    state: 'CURRENT',
    asOf: '2026-08-16T09:59:50.000Z',
    evidenceRef: 'evidence:aggregate-current'
  },
  createdAt: '2026-08-16T09:00:00.000Z',
  updatedAt: '2026-08-16T09:59:50.000Z'
});

const mappingFixture = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:friendship-12m',
  tenantId: 'iSkq6G',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerScope: { kind: 'TENANT', scopeId: 'iSkq6G' },
  subscriptionTypeId: 'subscription_type:friendship-12m',
  state: 'VERIFIED',
  evidenceRef: 'evidence:mapping-readback',
  verifiedAt: '2026-08-16T09:59:50.000Z',
  verifiedBy: 'admin:subscriptions',
  revision: 1,
  createdAt: '2026-08-16T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: '2026-08-16T09:59:50.000Z',
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-create-friendship-12m',
    requestHash: HASH,
    correlationId: 'corr:mapping-create'
  }
});

const requestFixture = (): SubscriptionShadowQuoteRequest => ({
  identity: {
    resolutionSource: 'LK_IDENTITY',
    tenantId: 'iSkq6G',
    clientRefHash: HASH,
    evidenceRef: 'evidence:lk-session',
    verifiedAt: '2026-08-16T09:59:50.000Z'
  },
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  action: 'CREATE_GAME',
  target: {
    resolutionSource: 'SERVER',
    targetId: 'exercise:synthetic-1',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: '2026-08-18T06:00:00.000Z',
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-08-16',
    evidenceRef: 'evidence:exercise-read',
    priceEvidenceRef: 'evidence:price-read',
    resolvedAt: '2026-08-16T09:59:50.000Z'
  }
});

const annualPublicationFixture = (): StoredSubscriptionPolicyPublication => {
  const publication = publicationFixture();
  publication.runtimeProjection.activeServicesLimit.max = 4;
  publication.runtimeProjection.dailyUsagePolicy = {
    actions: ['CREATE_GAME', 'JOIN_GAME'],
    limitExceeded: 'PERCENT_DISCOUNT',
    percentage: 30
  };
  const common = {
    enabled: true,
    category: 'GAME' as const,
    actions: ['CREATE_GAME', 'JOIN_GAME'] as const,
    externalEventTypeIds: ['event_type:open-game'],
    productTypeIds: [] as string[],
    stationIds: ['station:yasenevo'],
    valueMinor: null,
    priority: 10
  };
  publication.runtimeProjection.benefitRules = [{
    ...common,
    ruleId: 'benefit_rule:annual-game-60',
    actions: [...common.actions],
    durationMinutes: [60],
    kind: 'FREE_ENTITLEMENT',
    percentage: null,
    partialPrice: null
  }, {
    ...common,
    ruleId: 'benefit_rule:annual-game-90',
    actions: [...common.actions],
    durationMinutes: [90],
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT',
    percentage: 30,
    partialPrice: { numerator: 1, denominator: 3 }
  }, {
    ...common,
    ruleId: 'benefit_rule:annual-game-120',
    actions: [...common.actions],
    durationMinutes: [120],
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT',
    percentage: 30,
    partialPrice: { numerator: 1, denominator: 2 }
  }, {
    ...common,
    ruleId: 'benefit_rule:annual-group-training',
    category: 'GROUP_TRAINING',
    actions: ['BOOK_GROUP_TRAINING'],
    externalEventTypeIds: ['event_type:group-training'],
    durationMinutes: [60, 90, 120],
    kind: 'PERCENT_DISCOUNT',
    percentage: 50,
    partialPrice: null
  }, {
    ...common,
    ruleId: 'benefit_rule:annual-tournament',
    category: 'TOURNAMENT',
    actions: ['BOOK_TOURNAMENT'],
    externalEventTypeIds: ['event_type:tournament'],
    durationMinutes: [60, 90, 120],
    kind: 'PERCENT_DISCOUNT',
    percentage: 50,
    partialPrice: null
  }];
  publication.policyDigest = computeSubscriptionRuntimeProjectionDigest(publication.runtimeProjection);
  return publication;
};

const evaluate = (
  publication = publicationFixture(),
  instance = instanceFixture(),
  aggregate = aggregateFixture(),
  request = requestFixture()
) => evaluateSubscriptionShadowQuote({
  evaluatedAt: NOW,
  publication,
  instance,
  aggregate,
  action: request.action,
  target: request.target
});

const hasBlocker = (result: ReturnType<typeof evaluate>, code: string): boolean => (
  result.blockers.some((item) => item.code === code)
);

class FixedClockShadowQuoteService extends SubscriptionShadowQuoteService {
  protected override now(): Date {
    return new Date(NOW);
  }
}

async function run(): Promise<void> {
  const happy = evaluate();
  assert.equal(happy.eligible, true);
  assert.equal(happy.nonBinding, true);
  assert.equal(happy.requiresReservationRecheck, true);
  assert.equal(happy.benefit?.finalPriceMinor, 0);
  assert.equal(happy.decision?.usageUnits, 1);
  assert.deepEqual(happy.usageBucket, {
    localDate: '2026-08-18',
    localWeek: '2026-W34',
    localMonth: '2026-08'
  });
  assert.equal(happy.dailyUsageApplies, true);
  assert.equal(happy.dailyLimitExceeded, false);

  const activeLimit = evaluate(
    publicationFixture(),
    instanceFixture(),
    { ...aggregateFixture(), activeServiceCount: 3, activeServices: [
      { operationId: 'operation:1', targetId: 'exercise:1', startsAt: '2026-08-17T06:00:00.000Z', usageUnits: 1, state: 'RESERVED' },
      { operationId: 'operation:2', targetId: 'exercise:2', startsAt: '2026-08-18T06:00:00.000Z', usageUnits: 1, state: 'CONFIRMED' },
      { operationId: 'operation:3', targetId: 'exercise:3', startsAt: '2026-08-19T06:00:00.000Z', usageUnits: 1, state: 'RESERVED' }
    ] }
  );
  assert.ok(hasBlocker(activeLimit, 'ACTIVE_SERVICES_LIMIT_REACHED'));

  const outsideWindowRequest = requestFixture();
  outsideWindowRequest.target.startsAt = '2026-08-20T06:00:00.000Z';
  assert.ok(hasBlocker(evaluate(publicationFixture(), instanceFixture(), aggregateFixture(), outsideWindowRequest), 'BOOKING_WINDOW_EXCEEDED'));
  const noWindowPublication = publicationFixture();
  noWindowPublication.runtimeProjection.bookingWindow = { enabled: false, days: null };
  assert.equal(evaluate(
    noWindowPublication,
    instanceFixture(),
    aggregateFixture(),
    outsideWindowRequest
  ).eligible, true);

  const disabledPublication = publicationFixture();
  disabledPublication.runtimeProjection.createGame.enabled = false;
  assert.ok(hasBlocker(evaluate(disabledPublication), 'SUBSCRIPTION_CREATE_DISABLED'));

  const partialPublication = publicationFixture();
  partialPublication.runtimeProjection.benefitRules[0] = {
    ...partialPublication.runtimeProjection.benefitRules[0],
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT',
    percentage: 20,
    partialPrice: { numerator: 1, denominator: 4 }
  };
  partialPublication.runtimeProjection.stationAccessRules[0].surcharge = {
    kind: 'FIXED', amountMinor: 1000
  };
  const partialRequest = requestFixture();
  partialRequest.target.durationMinutes = 90;
  partialRequest.target.basePriceMinor = 100003;
  const partial = evaluate(partialPublication, instanceFixture(), aggregateFixture(), partialRequest);
  assert.equal(partial.eligible, true);
  assert.deepEqual(partial.benefit?.partialPriceCalculation, {
    numerator: 1,
    denominator: 4,
    chargeBeforeDiscountMinor: 25000,
    percentageDiscountMinor: 5000
  });
  assert.equal(partial.benefit?.discountMinor, 80003);
  assert.equal(partial.benefit?.finalPriceMinor, 21000);
  assert.equal(
    (partial.decision?.money.basePriceMinor ?? 0)
      - (partial.decision?.money.discountMinor ?? 0)
      + (partial.decision?.money.surchargeMinor ?? 0),
    partial.decision?.money.finalPriceMinor
  );

  const annual60Request = requestFixture();
  annual60Request.target.basePriceMinor = 15000;
  const annual60 = evaluate(
    annualPublicationFixture(),
    instanceFixture(),
    aggregateFixture(),
    annual60Request
  );
  assert.equal(annual60.eligible, true);
  assert.equal(annual60.benefit?.kind, 'FREE_ENTITLEMENT');
  assert.equal(annual60.benefit?.finalPriceMinor, 0);

  const annual90Request = requestFixture();
  annual90Request.target.durationMinutes = 90;
  annual90Request.target.basePriceMinor = 22500;
  const annual90 = evaluate(
    annualPublicationFixture(),
    instanceFixture(),
    aggregateFixture(),
    annual90Request
  );
  assert.equal(annual90.eligible, true);
  assert.equal(annual90.benefit?.finalPriceMinor, 5250);

  const annual120Request = requestFixture();
  annual120Request.target.durationMinutes = 120;
  annual120Request.target.basePriceMinor = 30000;
  const annual120 = evaluate(
    annualPublicationFixture(),
    instanceFixture(),
    aggregateFixture(),
    annual120Request
  );
  assert.equal(annual120.eligible, true);
  assert.equal(annual120.benefit?.finalPriceMinor, 10500);

  const annualExcessRequest = requestFixture();
  annualExcessRequest.action = 'JOIN_GAME';
  annualExcessRequest.target.durationMinutes = 120;
  annualExcessRequest.target.basePriceMinor = 30000;
  const annualExcess = evaluate(
    annualPublicationFixture(),
    instanceFixture(),
    { ...aggregateFixture(), dailyUsage: { '2026-08-18': 1 } },
    annualExcessRequest
  );
  assert.equal(annualExcess.eligible, true);
  assert.equal(annualExcess.benefit?.kind, 'PERCENT_DISCOUNT');
  assert.equal(annualExcess.benefit?.ruleId, 'daily-usage-limit-exceeded');
  assert.equal(annualExcess.benefit?.finalPriceMinor, 21000);
  assert.equal(annualExcess.dailyUsageApplies, true);
  assert.equal(annualExcess.dailyLimitExceeded, true);

  for (const [action, category, eventTypeId] of [
    ['BOOK_GROUP_TRAINING', 'GROUP_TRAINING', 'event_type:group-training'],
    ['BOOK_TOURNAMENT', 'TOURNAMENT', 'event_type:tournament']
  ] as const) {
    const eventRequest = requestFixture();
    eventRequest.action = action;
    eventRequest.target.category = category;
    eventRequest.target.externalEventTypeId = eventTypeId;
    eventRequest.target.durationMinutes = 120;
    eventRequest.target.basePriceMinor = 120000;
    const eventQuote = evaluate(
      annualPublicationFixture(),
      instanceFixture(),
      { ...aggregateFixture(), dailyUsage: { '2026-08-18': 1 } },
      eventRequest
    );
    assert.equal(eventQuote.eligible, true, action);
    assert.equal(eventQuote.benefit?.kind, 'PERCENT_DISCOUNT', action);
    assert.equal(eventQuote.benefit?.finalPriceMinor, 60000, action);
  }

  const annualActiveLimit = evaluate(
    annualPublicationFixture(),
    instanceFixture(),
    { ...aggregateFixture(), activeServiceCount: 4 },
    annual60Request
  );
  assert.ok(hasBlocker(annualActiveLimit, 'ACTIVE_SERVICES_LIMIT_REACHED'));

  const gameDiscountDisabled = publicationFixture();
  gameDiscountDisabled.runtimeProjection.benefitRules[0].enabled = false;
  gameDiscountDisabled.runtimeProjection.benefitRules.push({
    ...gameDiscountDisabled.runtimeProjection.benefitRules[0],
    ruleId: 'benefit_rule:group-training',
    enabled: true,
    category: 'GROUP_TRAINING',
    actions: ['BOOK_GROUP_TRAINING'],
    externalEventTypeIds: ['event_type:group-training']
  });
  const withoutDiscount = evaluate(gameDiscountDisabled);
  assert.equal(withoutDiscount.eligible, true);
  assert.equal(withoutDiscount.benefit?.kind, 'NONE');
  assert.equal(withoutDiscount.benefit?.finalPriceMinor, 400000);

  const allBookingsPublication = publicationFixture();
  allBookingsPublication.runtimeProjection.activeServicesLimit.scope = 'ALL_BOOKINGS';
  const allBookingsAggregate = { ...aggregateFixture(), activeServiceScope: 'ALL_BOOKINGS' as const };
  assert.ok(hasBlocker(
    evaluate(allBookingsPublication, instanceFixture(), allBookingsAggregate),
    'AUTHORITATIVE_ALL_BOOKINGS_COUNT_UNAVAILABLE'
  ));
  const intervalPublication = publicationFixture();
  intervalPublication.runtimeProjection.usage.minHoursBetweenUses = 12;
  assert.ok(hasBlocker(evaluate(intervalPublication), 'LAST_USAGE_EVIDENCE_UNAVAILABLE'));

  const usagePublication = publicationFixture();
  usagePublication.runtimeProjection.usage.weeklyUsageLimit = 1;
  usagePublication.runtimeProjection.usage.monthlyUsageLimit = 1;
  usagePublication.runtimeProjection.usage.maxFutureBookings = 1;
  const exhausted = evaluate(usagePublication, instanceFixture(), {
    ...aggregateFixture(),
    dailyUsage: { '2026-08-18': 1 },
    weeklyUsage: { '2026-W34': 1 },
    monthlyUsage: { '2026-08': 1 },
    futureBookingCount: 1,
    futureServiceStartsAt: ['2026-08-19T06:00:00.000Z'],
    remainingUnits: 0
  });
  for (const code of [
    'DAILY_USAGE_LIMIT_REACHED',
    'WEEKLY_USAGE_LIMIT_REACHED',
    'MONTHLY_USAGE_LIMIT_REACHED',
    'FUTURE_BOOKINGS_LIMIT_REACHED',
    'ENTITLEMENT_UNITS_INSUFFICIENT'
  ]) assert.ok(hasBlocker(exhausted, code), code);

  const wrongStationRequest = requestFixture();
  wrongStationRequest.target.stationId = 'station:other';
  assert.ok(hasBlocker(
    evaluate(publicationFixture(), instanceFixture(), aggregateFixture(), wrongStationRequest),
    'STATION_NOT_ALLOWED'
  ));

  const groupRequest = requestFixture();
  groupRequest.action = 'BOOK_GROUP_TRAINING';
  groupRequest.target.category = 'GROUP_TRAINING';
  groupRequest.target.externalEventTypeId = 'event_type:group-training';
  assert.ok(hasBlocker(
    evaluate(publicationFixture(), instanceFixture(), aggregateFixture(), groupRequest),
    'EVENT_NOT_INCLUDED'
  ));

  const invalidFixedPublication = publicationFixture();
  invalidFixedPublication.runtimeProjection.benefitRules[0] = {
    ...invalidFixedPublication.runtimeProjection.benefitRules[0],
    kind: 'FIXED_PRICE',
    valueMinor: 500000
  };
  assert.ok(hasBlocker(evaluate(invalidFixedPublication), 'BENEFIT_VALUE_INVALID'));

  const originalRuntimeFlag = process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  const originalQuoteFlag = process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED;
  const originalStaleness = process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS;
  try {
    let readCalls = 0;
    let readOnlyConnectCalls = 0;
    let writeCalls = 0;
    const documents = {
      instance: instanceFixture(),
      mapping: mappingFixture(),
      publication: publicationFixture(),
      aggregate: aggregateFixture()
    };
    const repository = {
      connectReadOnly: async () => { readOnlyConnectCalls += 1; },
      runtimeInstanceByTenantAndId: async () => { readCalls += 1; return documents.instance; },
      runtimeProviderMappingById: async () => { readCalls += 1; return documents.mapping; },
      runtimePolicyPublicationByVersion: async () => { readCalls += 1; return documents.publication; },
      runtimeEntitlementAggregateByInstance: async () => { readCalls += 1; return documents.aggregate; },
      insertRuntimeOperation: async () => { writeCalls += 1; throw new Error('write forbidden'); },
      appendRuntimeLedgerEventWithOutbox: async () => { writeCalls += 1; throw new Error('write forbidden'); }
    } as any;
    const service = new FixedClockShadowQuoteService(repository);

    delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
    delete process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED;
    await assert.rejects(service.quote(requestFixture()), (error: unknown) => (
      error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_RUNTIME_CONTRACTS_DISABLED'
    ));
    assert.equal(readCalls, 0);
    assert.equal(readOnlyConnectCalls, 0);

    process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
    const serviceHappy = await service.quote(requestFixture());
    assert.equal(serviceHappy.eligible, true);
    assert.equal(readOnlyConnectCalls, 1);
    assert.equal(readCalls, 4);
    assert.equal(writeCalls, 0);
    const serialized = JSON.stringify(serviceHappy);
    assert.doesNotMatch(serialized, /providerClientId|clientSubscriptionId|clientRefHash|evidenceRef/i);

    const disabledGamePublication = publicationFixture();
    disabledGamePublication.runtimeProjection.benefitRules[0].enabled = false;
    disabledGamePublication.runtimeProjection.benefitRules.push({
      ...disabledGamePublication.runtimeProjection.benefitRules[0],
      ruleId: 'benefit_rule:group-training',
      enabled: true,
      category: 'GROUP_TRAINING',
      actions: ['BOOK_GROUP_TRAINING'],
      externalEventTypeIds: ['event_type:group-training']
    });
    disabledGamePublication.policyDigest = computeSubscriptionRuntimeProjectionDigest(
      disabledGamePublication.runtimeProjection
    );
    documents.publication = disabledGamePublication;
    documents.instance = {
      ...instanceFixture(),
      policyDigest: disabledGamePublication.policyDigest
    };
    const disabledGameQuote = await service.quote(requestFixture());
    assert.equal(disabledGameQuote.eligible, true);
    assert.equal(disabledGameQuote.benefit?.kind, 'NONE');
    assert.equal(disabledGameQuote.benefit?.finalPriceMinor, 400000);

    documents.publication = publicationFixture();
    documents.instance = { ...instanceFixture(), clientRefHash: 'b'.repeat(64) };
    const ownership = await service.quote(requestFixture());
    assert.deepEqual(ownership.blockers.map((item) => item.code), ['SUBSCRIPTION_OWNERSHIP_NOT_CONFIRMED']);

    documents.instance = instanceFixture();
    documents.publication = publicationFixture();
    documents.publication.dictionaryRevision = 'dictionary:other';
    const dictionary = await service.quote(requestFixture());
    assert.ok(dictionary.blockers.some((item) => item.code === 'DICTIONARY_REVISION_MISMATCH'));

    documents.publication = publicationFixture();
    documents.aggregate = aggregateFixture();
    documents.aggregate.reconciliation.asOf = '2026-08-16T09:00:00.000Z';
    const stale = await service.quote(requestFixture());
    assert.ok(stale.blockers.some((item) => item.code === 'ENTITLEMENT_AGGREGATE_STALE'));

    documents.aggregate = aggregateFixture();
    documents.publication = publicationFixture();
    documents.publication.state = 'SUPERSEDED';
    documents.publication.supersededAt = '2026-08-16T09:30:00.000Z';
    documents.publication.supersededBy = 'admin:subscriptions';
    assert.equal((await service.quote(requestFixture())).eligible, true);
    documents.publication.state = 'DISABLED_FOR_NEW_OPERATIONS';
    documents.publication.supersededAt = null;
    documents.publication.supersededBy = null;
    assert.ok((await service.quote(requestFixture())).blockers.some(
      (item) => item.code === 'POLICY_DISABLED_FOR_NEW_OPERATIONS'
    ));
    assert.equal(writeCalls, 0);

    const missingPriceRequest = requestFixture();
    missingPriceRequest.target.basePriceMinor = null;
    missingPriceRequest.target.priceEvidenceRef = null;
    assert.ok((await service.quote(missingPriceRequest)).blockers.some(
      (item) => item.code === 'BASE_PRICE_UNRESOLVED'
    ));
  } finally {
    if (originalRuntimeFlag === undefined) delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
    else process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = originalRuntimeFlag;
    if (originalQuoteFlag === undefined) delete process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED;
    else process.env.SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED = originalQuoteFlag;
    if (originalStaleness === undefined) delete process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS;
    else process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = originalStaleness;
  }

  const controllerSource = fs.readFileSync('src/subscriptions/subscriptions.controller.ts', 'utf8');
  const quoteServiceSource = fs.readFileSync(
    'src/subscriptions/subscription-shadow-quote.service.ts',
    'utf8'
  );
  const adapterSource = fs.readFileSync(
    'src/subscriptions/subscription-trusted-shadow-adapter.service.ts',
    'utf8'
  );
  assert.match(controllerSource, /@Controller\('internal\/subscriptions'\)/);
  assert.match(controllerSource, /@Headers\('x-subscriptions-integration-token'\)/);
  assert.doesNotMatch(controllerSource, /@Controller\('v1\/subscriptions\/shadow/i);
  assert.doesNotMatch(quoteServiceSource, /insertRuntime|appendRuntime|fetch\s*\(|vivacrm/i);
  assert.doesNotMatch(adapterSource, /insertRuntime|appendRuntime|fetch\s*\(|vivacrm/i);

  console.log('subscriptions shadow quote tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
