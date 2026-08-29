import { UnprocessableEntityException } from '@nestjs/common';
import { computeSubscriptionRuntimeProjectionDigest } from './subscription-runtime-contracts';
import { compileSubscriptionRuntimeProjection } from './subscription-runtime-projection';
import { evaluateSubscriptionShadowQuote } from './subscription-shadow-quote';
import {
  BenefitCategory,
  BenefitKind,
  BenefitRule,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionTestOffer,
  SubscriptionAction,
  SubscriptionPolicyVersion,
  SubscriptionUsageTestQuoteResult,
  SubscriptionUsageTestScenarioView,
  SubscriptionUsageTestTargetView
} from './subscriptions.types';

interface TargetSpec {
  targetId: string;
  title: string;
  description: string;
  action: SubscriptionAction;
  category: BenefitCategory;
  durationMinutes: 60 | 90 | 120;
  basePriceMinor: number;
  kind: BenefitKind;
  percentage: number | null;
  partialPrice: { numerator: number; denominator: number } | null;
  startHour: number;
}

const TARGET_SPECS: TargetSpec[] = [
  {
    targetId: 'annual-create-60', title: 'Создать игру на 60 минут',
    description: 'Первая игровая услуга дня: один час бесплатно.',
    action: 'CREATE_GAME', category: 'GAME', durationMinutes: 60, basePriceMinor: 600_000,
    kind: 'FREE_ENTITLEMENT', percentage: null, partialPrice: null, startHour: 9
  },
  {
    targetId: 'annual-create-90', title: 'Создать игру на 90 минут',
    description: 'Первая игровая услуга дня: оплачиваются 30 минут сверх часа со скидкой 30%.',
    action: 'CREATE_GAME', category: 'GAME', durationMinutes: 90, basePriceMinor: 900_000,
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT', percentage: 30,
    partialPrice: { numerator: 1, denominator: 3 }, startHour: 11
  },
  {
    targetId: 'annual-create-120', title: 'Создать игру на 120 минут',
    description: 'Первая игровая услуга дня: оплачиваются 60 минут сверх часа со скидкой 30%.',
    action: 'CREATE_GAME', category: 'GAME', durationMinutes: 120, basePriceMinor: 1_200_000,
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT', percentage: 30,
    partialPrice: { numerator: 1, denominator: 2 }, startHour: 13
  },
  {
    targetId: 'annual-join-60', title: 'Присоединиться к игре на 60 минут',
    description: 'Первая игровая услуга дня: один час бесплатно.',
    action: 'JOIN_GAME', category: 'GAME', durationMinutes: 60, basePriceMinor: 600_000,
    kind: 'FREE_ENTITLEMENT', percentage: null, partialPrice: null, startHour: 15
  },
  {
    targetId: 'annual-join-90', title: 'Присоединиться к игре на 90 минут',
    description: 'Первая игровая услуга дня: доплата только за время сверх часа со скидкой 30%.',
    action: 'JOIN_GAME', category: 'GAME', durationMinutes: 90, basePriceMinor: 900_000,
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT', percentage: 30,
    partialPrice: { numerator: 1, denominator: 3 }, startHour: 16
  },
  {
    targetId: 'annual-join-120', title: 'Присоединиться к игре на 120 минут',
    description: 'Первая игровая услуга дня: доплата только за время сверх часа со скидкой 30%.',
    action: 'JOIN_GAME', category: 'GAME', durationMinutes: 120, basePriceMinor: 1_200_000,
    kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT', percentage: 30,
    partialPrice: { numerator: 1, denominator: 2 }, startHour: 18
  },
  {
    targetId: 'annual-group-60', title: 'Групповая тренировка',
    description: 'Участие в групповой тренировке со скидкой 50%.',
    action: 'BOOK_GROUP_TRAINING', category: 'GROUP_TRAINING', durationMinutes: 60,
    basePriceMinor: 300_000, kind: 'PERCENT_DISCOUNT', percentage: 50,
    partialPrice: null, startHour: 20
  },
  {
    targetId: 'annual-tournament-120', title: 'Участие в турнире',
    description: 'Участие в турнире со скидкой 50%.',
    action: 'BOOK_TOURNAMENT', category: 'TOURNAMENT', durationMinutes: 120,
    basePriceMinor: 500_000, kind: 'PERCENT_DISCOUNT', percentage: 50,
    partialPrice: null, startHour: 21
  }
];

interface CompiledScenario {
  view: SubscriptionUsageTestScenarioView;
  publication: StoredSubscriptionPolicyPublication;
  instance: StoredSubscriptionInstance;
}

export function buildSubscriptionUsageTestScenario(
  offer: StoredSubscriptionTestOffer,
  evaluatedAt = new Date()
): SubscriptionUsageTestScenarioView {
  return compileScenario(offer, evaluatedAt).view;
}

export function evaluateSubscriptionUsageTestScenario(
  offer: StoredSubscriptionTestOffer,
  input: { targetId: string; activeServices: number; dailyGameUsage: number },
  evaluatedAt = new Date()
): SubscriptionUsageTestQuoteResult {
  const compiled = compileScenario(offer, evaluatedAt);
  const target = compiled.view.targets.find((item) => item.targetId === input.targetId);
  if (!target) {
    throw new UnprocessableEntityException({
      code: 'SUBSCRIPTION_USAGE_TEST_TARGET_UNKNOWN',
      message: 'Сценарий тестовой услуги не найден'
    });
  }
  const localKeys = targetLocalKeys(new Date(target.target.startsAt));
  const now = evaluatedAt.toISOString();
  const aggregate: StoredSubscriptionEntitlementAggregate = {
    schemaVersion: 1,
    subscriptionInstanceId: compiled.instance.subscriptionInstanceId,
    revision: 1,
    activeServiceScope: compiled.publication.runtimeProjection.activeServicesLimit.scope,
    activeServiceCount: input.activeServices,
    activeServices: Array.from({ length: input.activeServices }, (_, index) => ({
      operationId: `test-active:${index + 1}`,
      targetId: `test-active-target:${index + 1}`,
      startsAt: target.target.startsAt,
      usageUnits: 1,
      state: 'RESERVED' as const
    })),
    dailyUsage: input.dailyGameUsage ? { [localKeys.date]: input.dailyGameUsage } : {},
    weeklyUsage: input.dailyGameUsage ? { [localKeys.week]: input.dailyGameUsage } : {},
    monthlyUsage: input.dailyGameUsage ? { [localKeys.month]: input.dailyGameUsage } : {},
    futureBookingCount: input.activeServices,
    futureServiceStartsAt: Array.from({ length: input.activeServices }, () => target.target.startsAt),
    remainingUnits: null,
    reconciliation: { state: 'CURRENT', asOf: now, evidenceRef: 'test-only:browser-state' },
    createdAt: now,
    updatedAt: now
  };
  return {
    target,
    decision: evaluateSubscriptionShadowQuote({
      evaluatedAt: now,
      publication: compiled.publication,
      instance: compiled.instance,
      aggregate,
      action: target.action,
      target: target.target
    })
  };
}

function compileScenario(offer: StoredSubscriptionTestOffer, evaluatedAt: Date): CompiledScenario {
  const policy: SubscriptionPolicyVersion = {
    ...offer.policySnapshot,
    status: 'PUBLISHED',
    benefitRules: offer.policySnapshot.benefitRules.map((rule) => ({
      ...rule,
      actions: [...rule.actions],
      externalEventTypeIds: [...rule.externalEventTypeIds],
      productTypeIds: [...rule.productTypeIds],
      durationMinutes: [...rule.durationMinutes],
      stationIds: [...rule.stationIds],
      partialPrice: rule.partialPrice ? { ...rule.partialPrice } : null
    }))
  };
  const issues = policyIssues(policy, offer);
  let runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'];
  try {
    runtimeProjection = compileSubscriptionRuntimeProjection(policy);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Runtime projection compilation failed');
    throw configurationError(issues);
  }
  const startsOn = nextMoscowDate(evaluatedAt);
  const targets = TARGET_SPECS.map((spec) => targetFromPolicy(spec, policy.benefitRules, offer, startsOn, evaluatedAt, issues));
  if (issues.length) throw configurationError(issues);
  const policyDigest = computeSubscriptionRuntimeProjectionDigest(runtimeProjection);
  const now = evaluatedAt.toISOString();
  const publication: StoredSubscriptionPolicyPublication = {
    schemaVersion: 1,
    publicationId: `test-publication:${offer.offerId}`,
    subscriptionTypeId: offer.subscriptionTypeId,
    policyVersion: offer.policyVersion,
    policyDigest,
    mappingId: `test-mapping:${offer.offerId}`,
    dictionaryRevision: `test-dictionary:${offer.policyVersion}`,
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: now,
    publishedBy: 'test-runtime',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'test-only:usage-scenario',
    approvalAuditRef: 'test-only:not-published'
  };
  const instance: StoredSubscriptionInstance = {
    schemaVersion: 1,
    subscriptionInstanceId: `test-instance:${offer.offerId}`,
    tenantId: 'test-only',
    subscriptionTypeId: offer.subscriptionTypeId,
    policyVersion: offer.policyVersion,
    policyDigest,
    mappingId: publication.mappingId,
    provider: 'VIVA',
    providerProductId: 'test-only:no-provider-call',
    providerClientId: 'test-only:synthetic-client',
    clientSubscriptionId: 'test-only:synthetic-subscription',
    clientRefHash: '0'.repeat(64),
    homeStationId: offer.stationId,
    releaseProgramId: offer.releaseProgramId,
    releasePhaseId: offer.releaseProgramSnapshot.phases[0]?.releasePhaseId ?? 'test-phase:none',
    purchasePrice: { amountMinor: 0, currency: 'RUB' },
    state: 'ACTIVE',
    purchasedAt: new Date(evaluatedAt.getTime() - 86_400_000).toISOString(),
    activeFrom: new Date(evaluatedAt.getTime() - 86_400_000).toISOString(),
    activeTo: new Date(evaluatedAt.getTime() + policy.validityDays * 86_400_000).toISOString(),
    frozenUntil: null,
    renewalPredecessorId: null,
    renewalSuccessorId: null,
    evidence: {
      paymentEvidenceRef: null,
      providerInstanceEvidenceRef: null,
      lastReadBackEvidenceRef: 'test-only:no-provider-read'
    },
    reconciliation: { state: 'CURRENT', asOf: now, evidenceRef: 'test-only:synthetic-instance' },
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
  return {
    publication,
    instance,
    view: {
      mode: 'HOSTED_DEV_SHADOW',
      testOnly: true,
      providerMode: 'FAKE_NO_VIVA',
      evaluatedAt: now,
      offer: {
        offerId: offer.offerId,
        title: offer.title,
        stationId: offer.stationId,
        timeZone: offer.timezone
      },
      policySource: {
        sourceStatus: offer.policySnapshot.status,
        runtimeStatus: 'PUBLISHED',
        sourceModelVersion: offer.policySnapshot.modelVersion,
        version: offer.policyVersion,
        digest: policyDigest
      },
      limits: {
        activeServicesEnabled: runtimeProjection.activeServicesLimit.enabled,
        maxActiveServices: runtimeProjection.activeServicesLimit.max,
        bookingWindowEnabled: runtimeProjection.bookingWindow.enabled,
        bookingWindowDays: runtimeProjection.bookingWindow.days,
        dailyUsageLimit: runtimeProjection.dailyUsageLimit,
        dailyUsageActions: [...(runtimeProjection.dailyUsagePolicy?.actions ?? [])],
        dailyLimitExceeded: runtimeProjection.dailyUsagePolicy?.limitExceeded ?? 'BLOCK',
        dailyLimitExceededPercentage: runtimeProjection.dailyUsagePolicy?.percentage ?? null
      },
      targets
    }
  };
}

function policyIssues(
  policy: SubscriptionPolicyVersion,
  offer: StoredSubscriptionTestOffer
): string[] {
  const issues: string[] = [];
  if (policy.modelVersion !== 3) issues.push('modelVersion must be 3');
  if (!policy.createGame.enabled || ![60, 90, 120].every((value) => policy.createGame.durationsMinutes.includes(value as 60 | 90 | 120))) {
    issues.push('CREATE_GAME durations 60, 90 and 120 must be enabled');
  }
  if (!policy.joinGame.enabled || policy.joinGame.minDurationMinutes > 60 || policy.joinGame.maxDurationMinutes < 120) {
    issues.push('JOIN_GAME durations 60 through 120 must be enabled');
  }
  if (!policy.activeServicesLimit?.enabled || policy.activeServicesLimit.max !== 4
    || policy.activeServicesLimit.scope !== 'SUBSCRIPTION_BENEFIT_ONLY') {
    issues.push('active services limit must be 4 for subscription benefits');
  }
  if (policy.usageUnitsByDuration['60'] !== 1
    || policy.usageUnitsByDuration['90'] !== 1
    || policy.usageUnitsByDuration['120'] !== 1) {
    issues.push('each game service duration must consume exactly one daily usage unit');
  }
  const daily = policy.dailyUsagePolicy;
  if (policy.dailyUsageLimit !== 1 || !daily || daily.limitExceeded !== 'PERCENT_DISCOUNT'
    || daily.percentage !== 30 || daily.actions.length !== 2
    || !daily.actions.includes('CREATE_GAME') || !daily.actions.includes('JOIN_GAME')) {
    issues.push('daily game limit must be 1 with 30 percent discount after the limit');
  }
  const stationRules = (policy.stationAccessRules ?? []).filter((rule) => rule.enabled && (
    rule.selector.kind === 'ALL_STATIONS'
    || rule.selector.kind === 'HOME_STATION'
    || rule.selector.stationIds.includes(offer.stationId)
  )).sort((left, right) => right.priority - left.priority);
  if (!stationRules.length
    || stationRules.filter((rule) => rule.priority === stationRules[0].priority).length !== 1) {
    issues.push('test offer station requires one unambiguous station access rule');
  } else if (stationRules[0].surcharge.kind !== 'NONE'
    || stationRules[0].surcharge.amountMinor !== 0) {
    issues.push('test offer station must not add a surcharge to agreed prices');
  }
  if (policy.bookingWindow?.enabled && (policy.bookingWindow.days ?? 0) < 2) {
    issues.push('booking window must include the next local day');
  }
  if ((policy.capabilities.usage.weeklyUsageLimit ?? 2) < 2
    || (policy.capabilities.usage.monthlyUsageLimit ?? 2) < 2) {
    issues.push('weekly and monthly limits must allow the post-daily-limit scenario');
  }
  if ((policy.capabilities.usage.maxFutureBookings ?? 4) < 4) {
    issues.push('future booking limit must allow four active services');
  }
  if (policy.capabilities.usage.minHoursBetweenUses !== 0) {
    issues.push('minimum interval between uses conflicts with the agreed daily scenarios');
  }
  return issues;
}

function targetFromPolicy(
  spec: TargetSpec,
  rules: BenefitRule[],
  offer: StoredSubscriptionTestOffer,
  startsOn: string,
  evaluatedAt: Date,
  issues: string[]
): SubscriptionUsageTestTargetView {
  const matches = rules.filter((rule) => rule.enabled
    && rule.category === spec.category
    && rule.actions.includes(spec.action)
    && rule.durationMinutes.includes(spec.durationMinutes)
    && rule.stationIds.includes(offer.stationId)
    && rule.kind === spec.kind
    && rule.percentage === spec.percentage
    && samePartialPrice(rule.partialPrice, spec.partialPrice)
    && rule.externalEventTypeIds.length > 0)
    .sort((left, right) => right.priority - left.priority);
  const highest = matches.filter((rule) => rule.priority === matches[0]?.priority);
  if (highest.length !== 1) {
    issues.push(`${spec.targetId} requires one unambiguous matching benefit rule`);
  }
  const eventTypeId = highest[0]?.externalEventTypeIds[0] ?? `missing:${spec.targetId}`;
  const runtimeMatches = rules.filter((rule) => rule.enabled
    && rule.category === spec.category
    && rule.actions.includes(spec.action)
    && rule.durationMinutes.includes(spec.durationMinutes)
    && rule.stationIds.includes(offer.stationId)
    && rule.externalEventTypeIds.includes(eventTypeId))
    .sort((left, right) => right.priority - left.priority);
  const runtimeHighest = runtimeMatches.filter((rule) => rule.priority === runtimeMatches[0]?.priority);
  if (highest.length === 1
    && (runtimeHighest.length !== 1 || runtimeHighest[0].ruleId !== highest[0].ruleId)) {
    issues.push(`${spec.targetId} benefit rule is shadowed or ambiguous at runtime`);
  }
  return {
    targetId: spec.targetId,
    title: spec.title,
    description: spec.description,
    action: spec.action,
    target: {
      resolutionSource: 'SERVER',
      targetId: spec.targetId,
      stationId: offer.stationId,
      category: spec.category,
      externalEventTypeId: eventTypeId,
      productTypeId: null,
      durationMinutes: spec.durationMinutes,
      startsAt: new Date(`${startsOn}T${String(spec.startHour).padStart(2, '0')}:00:00+03:00`).toISOString(),
      basePriceMinor: spec.basePriceMinor,
      currency: 'RUB',
      dictionaryRevision: `test-dictionary:${offer.policyVersion}`,
      evidenceRef: `test-only:server-target:${spec.targetId}`,
      priceEvidenceRef: `test-only:fixed-price:${spec.targetId}`,
      resolvedAt: evaluatedAt.toISOString()
    }
  };
}

function samePartialPrice(
  actual: BenefitRule['partialPrice'],
  expected: BenefitRule['partialPrice']
): boolean {
  if (!actual || !expected) return actual === expected;
  return actual.numerator === expected.numerator && actual.denominator === expected.denominator;
}

function nextMoscowDate(now: Date): string {
  const local = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  local.setUTCDate(local.getUTCDate() + 1);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function targetLocalKeys(startsAt: Date): { date: string; week: string; month: string } {
  const local = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
  const dateOnly = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const weekday = dateOnly.getUTCDay() || 7;
  const weekDate = new Date(dateOnly);
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - weekday);
  const weekYear = weekDate.getUTCFullYear();
  const weekOne = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((weekDate.getTime() - weekOne.getTime()) / 86_400_000) + 1) / 7);
  const month = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    date: `${month}-${String(local.getUTCDate()).padStart(2, '0')}`,
    week: `${weekYear}-W${String(week).padStart(2, '0')}`,
    month
  };
}

function configurationError(issues: string[]): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'SUBSCRIPTION_USAGE_TEST_POLICY_MISMATCH',
    message: 'Правила тестового оффера не соответствуют согласованным сценариям годовой подписки',
    details: { issues }
  });
}
