import {
  BenefitCategory,
  BenefitRule,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  SubscriptionAction,
  SubscriptionRuntimeEntitlementDecisionSnapshot,
  SubscriptionShadowQuoteAppliedBenefit,
  SubscriptionShadowQuoteBlocker,
  SubscriptionShadowQuoteResolvedTarget,
  SubscriptionShadowQuoteResult,
  SubscriptionStationAccessRule
} from './subscriptions.types';

export interface SubscriptionShadowQuoteEvaluationInput {
  evaluatedAt: string;
  publication: StoredSubscriptionPolicyPublication;
  instance: StoredSubscriptionInstance;
  aggregate: StoredSubscriptionEntitlementAggregate;
  action: SubscriptionAction;
  target: SubscriptionShadowQuoteResolvedTarget;
}

type BlockerDetails = Record<string, string | number | boolean | null>;

const ACTION_CATEGORY: Record<SubscriptionAction, BenefitCategory> = {
  CREATE_GAME: 'GAME',
  JOIN_GAME: 'GAME',
  BOOK_GROUP_TRAINING: 'GROUP_TRAINING',
  BOOK_TOURNAMENT: 'TOURNAMENT',
  PURCHASE_ADD_ON_PRODUCT: 'ADD_ON_PRODUCT'
};

const nonNegativeInteger = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
);

const instant = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
};

const localDate = (
  value: Date,
  timeZone: string
): { date: string; month: string; week: string; dayNumber: number } | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(value);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!fields.year || !fields.month || !fields.day) return null;
    const year = Number(fields.year);
    const month = Number(fields.month);
    const day = Number(fields.day);
    const utc = new Date(Date.UTC(year, month - 1, day));
    const dayNumber = utc.getTime() / 86_400_000;
    const weekDate = new Date(utc);
    const weekday = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - weekday);
    const weekYear = weekDate.getUTCFullYear();
    const weekOne = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((weekDate.getTime() - weekOne.getTime()) / 86_400_000) + 1) / 7);
    return {
      date: `${fields.year}-${fields.month}-${fields.day}`,
      month: `${fields.year}-${fields.month}`,
      week: `${weekYear}-W${String(week).padStart(2, '0')}`,
      dayNumber
    };
  } catch {
    return null;
  }
};

const floorRatio = (amount: number, numerator: number, denominator: number): number | null => {
  if (!Number.isSafeInteger(amount)
    || !Number.isSafeInteger(numerator)
    || !Number.isSafeInteger(denominator)
    || amount < 0
    || numerator < 0
    || denominator <= 0) {
    return null;
  }
  const product = BigInt(amount) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const floored = product / divisor;
  return floored <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(floored) : null;
};

const safeAdd = (left: number, right: number): number | null => {
  const value = left + right;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export function evaluateSubscriptionShadowQuote(
  input: SubscriptionShadowQuoteEvaluationInput
): SubscriptionShadowQuoteResult {
  const blockers: SubscriptionShadowQuoteBlocker[] = [];
  const blockerCodes = new Set<string>();
  const block = (code: string, message: string, details: BlockerDetails | null = null): void => {
    if (blockerCodes.has(code)) return;
    blockerCodes.add(code);
    blockers.push({ code, message, details });
  };

  const { publication, instance, aggregate, action, target } = input;
  const policy = publication.runtimeProjection;
  const evaluatedAt = instant(input.evaluatedAt);
  const startsAt = instant(target.startsAt);
  const activeFrom = instant(instance.activeFrom);
  const activeTo = instant(instance.activeTo);
  const durationMinutes = nonNegativeInteger(target.durationMinutes);

  if (!evaluatedAt) {
    block('SHADOW_QUOTE_TIME_INVALID', 'Время расчёта shadow quote некорректно');
  }
  if (policy.runtimeSchemaVersion !== 1 || policy.status !== 'PUBLISHED') {
    block('POLICY_SCHEMA_UNSUPPORTED', 'Runtime-проекция подписки не поддерживается');
  }
  if (policy.subscriptionTypeId !== instance.subscriptionTypeId) {
    block('SUBSCRIPTION_TYPE_MISMATCH', 'Экземпляр подписки связан с другим типом правил');
  }
  if (policy.policyVersion !== instance.policyVersion) {
    block('POLICY_VERSION_MISMATCH', 'Экземпляр подписки связан с другой версией правил');
  }
  if (instance.state === 'FROZEN') {
    block('SUBSCRIPTION_FROZEN', 'Подписка заморожена');
  } else if (instance.state !== 'ACTIVE') {
    block(
      instance.state === 'EXPIRED' ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_NOT_ACTIVE',
      'Подписка сейчас недоступна для записи',
      { state: instance.state }
    );
  }
  if (!activeFrom || !activeTo || activeFrom.getTime() > activeTo.getTime()) {
    block('SUBSCRIPTION_VALIDITY_INVALID', 'Срок действия подписки не подтверждён');
  }
  if (evaluatedAt && activeFrom && evaluatedAt.getTime() < activeFrom.getTime()) {
    block('SUBSCRIPTION_NOT_ACTIVE', 'Срок действия подписки ещё не начался');
  }
  if (evaluatedAt && activeTo && evaluatedAt.getTime() > activeTo.getTime()) {
    block('SUBSCRIPTION_EXPIRED', 'Срок действия подписки закончился');
  }
  const policyEffectiveAt = instant(policy.effectiveAt);
  if (!policyEffectiveAt) {
    block('POLICY_EFFECTIVE_AT_INVALID', 'Дата вступления правил в силу некорректна');
  } else if (evaluatedAt && policyEffectiveAt.getTime() > evaluatedAt.getTime()) {
    block('POLICY_NOT_EFFECTIVE', 'Правила подписки ещё не вступили в силу');
  }

  if (target.resolutionSource !== 'SERVER') {
    block('TARGET_NOT_SERVER_RESOLVED', 'Параметры услуги должны быть подтверждены сервером');
  }
  if (ACTION_CATEGORY[action] !== target.category) {
    block('TARGET_CATEGORY_MISMATCH', 'Категория услуги не соответствует операции');
  }
  if (!target.targetId || !target.stationId || !target.externalEventTypeId) {
    block('TARGET_IDENTITY_INVALID', 'Идентичность услуги подтверждена не полностью');
  }
  if (target.category === 'ADD_ON_PRODUCT' && !target.productTypeId) {
    block('TARGET_PRODUCT_TYPE_REQUIRED', 'Для дополнительного продукта нужен подтверждённый тип');
  }
  if (!startsAt || !durationMinutes) {
    block('TARGET_SCHEDULE_INVALID', 'Время или длительность услуги некорректны');
  } else if (evaluatedAt && startsAt.getTime() < evaluatedAt.getTime()) {
    block('TARGET_ALREADY_STARTED', 'Нельзя использовать подписку для уже начавшейся услуги');
  }
  if (startsAt && activeTo
    && startsAt.getTime() > activeTo.getTime()
    && !policy.lifecycle.allowBookingsAfterExpiry) {
    block('TARGET_AFTER_SUBSCRIPTION_EXPIRY', 'Услуга начинается после окончания подписки');
  }
  if (target.currency !== 'RUB') {
    block('CURRENCY_UNSUPPORTED', 'Shadow quote поддерживает только RUB');
  }

  if (action === 'CREATE_GAME') {
    if (!policy.createGame.enabled) {
      block('SUBSCRIPTION_CREATE_DISABLED', 'Создание игр по этой подписке отключено');
    } else if (!durationMinutes || !policy.createGame.durationsMinutes.includes(
      durationMinutes as 60 | 90 | 120
    )) {
      block('DURATION_NOT_ALLOWED', 'Такая длительность игры недоступна по подписке');
    }
  }
  if (action === 'JOIN_GAME') {
    if (!policy.joinGame.enabled) {
      block('SUBSCRIPTION_JOIN_DISABLED', 'Присоединение к играм по этой подписке отключено');
    } else if (!durationMinutes
      || durationMinutes < policy.joinGame.minDurationMinutes
      || durationMinutes > policy.joinGame.maxDurationMinutes) {
      block('DURATION_NOT_ALLOWED', 'Длительность игры вне разрешённого диапазона');
    }
  }

  const currentLocal = evaluatedAt ? localDate(evaluatedAt, policy.timeZone) : null;
  const targetLocal = startsAt ? localDate(startsAt, policy.timeZone) : null;
  if (!targetLocal) {
    block('TARGET_LOCAL_DATE_UNRESOLVED', 'Не удалось определить локальную дату услуги');
  }
  if (policy.bookingWindow.enabled) {
    const days = policy.bookingWindow.days;
    if (!currentLocal || !targetLocal || !days || days < 1) {
      block('BOOKING_WINDOW_UNRESOLVED', 'Календарное окно записи не настроено');
    } else {
      const offset = targetLocal.dayNumber - currentLocal.dayNumber;
      if (offset < 0 || offset >= days) {
        block('BOOKING_WINDOW_EXCEEDED', 'Услуга находится за пределами окна записи', {
          bookingWindowDays: days,
          currentLocalDate: currentLocal.date,
          targetLocalDate: targetLocal.date
        });
      }
    }
  }
  if (targetLocal && policy.usage.blackoutDates.includes(targetLocal.date)) {
    block('SUBSCRIPTION_BLACKOUT_DATE', 'На выбранную дату подписка не действует', {
      targetLocalDate: targetLocal.date
    });
  }

  const activeServices = nonNegativeInteger(aggregate.activeServiceCount);
  const maxActiveServices = policy.activeServicesLimit.enabled
    ? nonNegativeInteger(policy.activeServicesLimit.max)
    : null;
  if (policy.activeServicesLimit.enabled) {
    if (policy.activeServicesLimit.scope === 'ALL_BOOKINGS') {
      block(
        'AUTHORITATIVE_ALL_BOOKINGS_COUNT_UNAVAILABLE',
        'Shadow quote ещё не подключён к полному счётчику всех записей'
      );
    }
    if (aggregate.activeServiceScope !== policy.activeServicesLimit.scope) {
      block('ACTIVE_SERVICE_SCOPE_MISMATCH', 'Счётчик активных услуг собран для другого состава');
    }
    if (activeServices === null || maxActiveServices === null || maxActiveServices < 1) {
      block('ACTIVE_SERVICES_LIMIT_INVALID', 'Лимит активных услуг не настроен');
    } else if (activeServices >= maxActiveServices) {
      block('ACTIVE_SERVICES_LIMIT_REACHED', 'Достигнут лимит активных услуг', {
        activeServices,
        maxActiveServices
      });
    }
  }

  const usageUnits = durationMinutes === 60 || durationMinutes === 90 || durationMinutes === 120
    ? nonNegativeInteger(policy.usageUnitsByDuration[String(durationMinutes) as '60' | '90' | '120'])
    : null;
  if (usageUnits === null) {
    block('USAGE_UNITS_UNRESOLVED', 'Не настроено списание для длительности услуги');
  }
  const dailyUsed = targetLocal ? nonNegativeInteger(aggregate.dailyUsage[targetLocal.date] ?? 0) : null;
  const weeklyUsed = targetLocal ? nonNegativeInteger(aggregate.weeklyUsage[targetLocal.week] ?? 0) : null;
  const monthlyUsed = targetLocal ? nonNegativeInteger(aggregate.monthlyUsage[targetLocal.month] ?? 0) : null;
  const dailyLimit = nonNegativeInteger(policy.dailyUsageLimit);
  const dailyUsagePolicy = policy.dailyUsagePolicy ?? {
    actions: [
      'CREATE_GAME',
      'JOIN_GAME',
      'BOOK_GROUP_TRAINING',
      'BOOK_TOURNAMENT',
      'PURCHASE_ADD_ON_PRODUCT'
    ] as SubscriptionAction[],
    limitExceeded: 'BLOCK' as const,
    percentage: null
  };
  const dailyUsageActions = Array.isArray(dailyUsagePolicy.actions)
    ? dailyUsagePolicy.actions
    : [];
  if (dailyUsageActions.length === 0) {
    block('DAILY_USAGE_POLICY_INVALID', 'Область дневного лимита подписки не настроена');
  }
  if (!['BLOCK', 'PERCENT_DISCOUNT'].includes(dailyUsagePolicy.limitExceeded)) {
    block('DAILY_USAGE_POLICY_INVALID', 'Поведение после дневного лимита не настроено');
  } else if (dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT'
    && (!Number.isInteger(dailyUsagePolicy.percentage)
      || dailyUsagePolicy.percentage === null
      || dailyUsagePolicy.percentage < 0
      || dailyUsagePolicy.percentage > 100)) {
    block('DAILY_USAGE_DISCOUNT_INVALID', 'Скидка после дневного лимита не настроена');
  } else if (dailyUsagePolicy.limitExceeded === 'BLOCK'
    && dailyUsagePolicy.percentage !== null) {
    block('DAILY_USAGE_DISCOUNT_INVALID', 'Скидка несовместима с блокирующим дневным лимитом');
  }
  const dailyActionApplies = dailyUsageActions.includes(action);
  let dailyLimitExceeded = false;
  if (dailyActionApplies) {
    if (dailyUsed === null || dailyLimit === null) {
      block('DAILY_USAGE_LIMIT_INVALID', 'Дневной лимит подписки не настроен');
    } else if (usageUnits !== null) {
      const afterUsage = safeAdd(dailyUsed, usageUnits);
      if (afterUsage === null) block('USAGE_COUNTER_OVERFLOW', 'Счётчик использования выходит за допустимый диапазон');
      else if (afterUsage > dailyLimit) {
        dailyLimitExceeded = true;
        if (dailyUsagePolicy.limitExceeded === 'BLOCK') {
          block('DAILY_USAGE_LIMIT_REACHED', 'Дневной лимит использования исчерпан', {
            dailyUsed,
            dailyLimit,
            requestedUsageUnits: usageUnits
          });
        } else if (!Number.isInteger(dailyUsagePolicy.percentage)
          || dailyUsagePolicy.percentage === null
          || dailyUsagePolicy.percentage < 0
          || dailyUsagePolicy.percentage > 100) {
          block('DAILY_USAGE_DISCOUNT_INVALID', 'Скидка после дневного лимита не настроена');
        }
      }
    }
  }
  const weeklyLimit = policy.usage.weeklyUsageLimit;
  if (weeklyLimit !== null) {
    if (weeklyUsed === null || nonNegativeInteger(weeklyLimit) === null) {
      block('WEEKLY_USAGE_LIMIT_INVALID', 'Недельный лимит подписки не настроен');
    } else if (usageUnits !== null) {
      const afterUsage = safeAdd(weeklyUsed, usageUnits);
      if (afterUsage === null) block('USAGE_COUNTER_OVERFLOW', 'Счётчик использования выходит за допустимый диапазон');
      else if (afterUsage > weeklyLimit) {
        block('WEEKLY_USAGE_LIMIT_REACHED', 'Недельный лимит использования исчерпан');
      }
    }
  }
  const monthlyLimit = policy.usage.monthlyUsageLimit;
  if (monthlyLimit !== null) {
    if (monthlyUsed === null || nonNegativeInteger(monthlyLimit) === null) {
      block('MONTHLY_USAGE_LIMIT_INVALID', 'Месячный лимит подписки не настроен');
    } else if (usageUnits !== null) {
      const afterUsage = safeAdd(monthlyUsed, usageUnits);
      if (afterUsage === null) block('USAGE_COUNTER_OVERFLOW', 'Счётчик использования выходит за допустимый диапазон');
      else if (afterUsage > monthlyLimit) {
        block('MONTHLY_USAGE_LIMIT_REACHED', 'Месячный лимит использования исчерпан');
      }
    }
  }
  if (aggregate.remainingUnits !== null && usageUnits !== null
    && aggregate.remainingUnits < usageUnits) {
    block('ENTITLEMENT_UNITS_INSUFFICIENT', 'Недостаточно доступных посещений');
  }
  const maxFutureBookings = policy.usage.maxFutureBookings;
  if (maxFutureBookings !== null
    && aggregate.futureBookingCount >= maxFutureBookings) {
    block('FUTURE_BOOKINGS_LIMIT_REACHED', 'Достигнут лимит будущих записей');
  }
  if (policy.usage.minHoursBetweenUses > 0) {
    block(
      'LAST_USAGE_EVIDENCE_UNAVAILABLE',
      'Shadow quote ещё не подключён к истории последнего использования'
    );
  }

  const stationSelection = selectStationRule(
    policy.stationAccessRules,
    instance.homeStationId,
    target.stationId
  );
  if (stationSelection.ambiguous) {
    block('AMBIGUOUS_STATION_RULE', 'Для станции найдено несколько равноприоритетных правил');
  }
  if (!stationSelection.rule) {
    block('STATION_NOT_ALLOWED', 'Станция не включена в правила подписки');
  }
  const surchargeMinor = stationSelection.rule?.surcharge.kind === 'FIXED'
    ? stationSelection.rule.surcharge.amountMinor
    : 0;

  const benefitSelection = selectBenefitRule(policy.benefitRules, action, target);
  if (benefitSelection.ambiguous) {
    block('AMBIGUOUS_BENEFIT_RULE', 'Для услуги найдено несколько равноприоритетных льгот');
  }
  const appliedBenefitRule = dailyLimitExceeded
    && dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT'
    && dailyUsagePolicy.percentage !== null
    ? {
      ruleId: 'daily-usage-limit-exceeded',
      enabled: true,
      category: target.category,
      actions: [action],
      externalEventTypeIds: [target.externalEventTypeId],
      productTypeIds: target.productTypeId ? [target.productTypeId] : [],
      durationMinutes: [target.durationMinutes],
      stationIds: [target.stationId],
      kind: 'PERCENT_DISCOUNT' as const,
      valueMinor: null,
      percentage: dailyUsagePolicy.percentage,
      partialPrice: null,
      priority: Number.MAX_SAFE_INTEGER
    }
    : benefitSelection.rule;
  const appliedBenefit = priceBenefit(
    appliedBenefitRule,
    target.category,
    target.basePriceMinor,
    surchargeMinor,
    stationSelection.rule?.ruleId ?? null,
    block
  );

  const eligible = blockers.length === 0;
  const decision: SubscriptionRuntimeEntitlementDecisionSnapshot | null = eligible
    && usageUnits !== null
    && appliedBenefit
    ? {
      decisionKind: 'ENTITLEMENT',
      policyVersion: publication.policyVersion,
      policyDigest: publication.policyDigest,
      action,
      target: {
        targetId: target.targetId,
        stationId: target.stationId,
        eventTypeId: target.externalEventTypeId,
        productTypeId: target.productTypeId,
        durationMinutes: target.durationMinutes,
        startsAt: target.startsAt
      },
      usageUnits,
      money: {
        basePriceMinor: appliedBenefit.basePriceMinor,
        discountMinor: appliedBenefit.discountMinor,
        surchargeMinor: appliedBenefit.surchargeMinor,
        finalPriceMinor: appliedBenefit.finalPriceMinor,
        currency: 'RUB'
      }
    }
    : null;

  return {
    quoteKind: 'SHADOW',
    nonBinding: true,
    requiresReservationRecheck: true,
    eligible,
    blockers,
    subscriptionInstanceId: instance.subscriptionInstanceId,
    policyVersion: publication.policyVersion,
    policyDigest: publication.policyDigest,
    aggregateRevision: aggregate.revision,
    evaluatedAt: evaluatedAt?.toISOString() ?? new Date(0).toISOString(),
    usageUnits,
    activeServices,
    maxActiveServices,
    dailyUsed,
    dailyLimit,
    benefit: appliedBenefit,
    decision
  };
}

function selectStationRule(
  rules: SubscriptionStationAccessRule[],
  homeStationId: string,
  stationId: string
): { rule: SubscriptionStationAccessRule | null; ambiguous: boolean } {
  const matches = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.selector.kind === 'HOME_STATION') return homeStationId === stationId;
    if (rule.selector.kind === 'ALL_STATIONS') return true;
    return rule.selector.stationIds.includes(stationId);
  }).sort((left, right) => right.priority - left.priority);
  if (!matches.length) return { rule: null, ambiguous: false };
  const priority = matches[0].priority;
  const highest = matches.filter((rule) => rule.priority === priority);
  return { rule: highest.length === 1 ? highest[0] : null, ambiguous: highest.length > 1 };
}

function selectBenefitRule(
  rules: BenefitRule[],
  action: SubscriptionAction,
  target: SubscriptionShadowQuoteResolvedTarget
): { rule: BenefitRule | null; ambiguous: boolean } {
  const matches = rules.filter((rule) => (
    rule.enabled
    && rule.category === target.category
    && rule.actions.includes(action)
    && rule.stationIds.includes(target.stationId)
    && rule.externalEventTypeIds.includes(target.externalEventTypeId)
    && rule.durationMinutes.includes(target.durationMinutes)
    && (target.category !== 'ADD_ON_PRODUCT'
      || Boolean(target.productTypeId && rule.productTypeIds.includes(target.productTypeId)))
  )).sort((left, right) => right.priority - left.priority);
  if (!matches.length) return { rule: null, ambiguous: false };
  const priority = matches[0].priority;
  const highest = matches.filter((rule) => rule.priority === priority);
  return { rule: highest.length === 1 ? highest[0] : null, ambiguous: highest.length > 1 };
}

function priceBenefit(
  rule: BenefitRule | null,
  category: BenefitCategory,
  rawBasePriceMinor: number | null,
  surchargeMinor: number,
  stationRuleId: string | null,
  block: (code: string, message: string, details?: BlockerDetails | null) => void
): SubscriptionShadowQuoteAppliedBenefit | null {
  const basePriceMinor = rawBasePriceMinor === null
    ? null
    : nonNegativeInteger(rawBasePriceMinor);
  if (rawBasePriceMinor === null) {
    block('BASE_PRICE_UNRESOLVED', 'Базовая цена услуги не подтверждена сервером');
  } else if (basePriceMinor === null) {
    block('BASE_PRICE_INVALID', 'Базовая цена услуги некорректна');
  }
  if (!Number.isSafeInteger(surchargeMinor) || surchargeMinor < 0) {
    block('STATION_SURCHARGE_INVALID', 'Доплата станции некорректна');
    return null;
  }
  if (!rule || rule.kind === 'DISABLED') {
    if (category !== 'GAME') {
      block('EVENT_NOT_INCLUDED', 'Категория, тип услуги или станция не включены в подписку');
    }
    const finalPriceMinor = basePriceMinor === null
      ? (surchargeMinor || null)
      : safeAdd(basePriceMinor, surchargeMinor);
    if (basePriceMinor !== null && finalPriceMinor === null) {
      block('PRICE_CALCULATION_OVERFLOW', 'Цена услуги выходит за допустимый диапазон');
    }
    return {
      kind: 'NONE',
      ruleId: rule?.ruleId ?? null,
      stationRuleId,
      basePriceMinor,
      discountMinor: 0,
      surchargeMinor,
      finalPriceMinor,
      partialPriceCalculation: null,
      currency: 'RUB'
    };
  }

  let finalBeforeSurcharge = basePriceMinor;
  let discountMinor = 0;
  let partialPriceCalculation: SubscriptionShadowQuoteAppliedBenefit['partialPriceCalculation'] = null;
  if (rule.kind === 'FREE_ENTITLEMENT') {
    finalBeforeSurcharge = 0;
    discountMinor = basePriceMinor ?? 0;
  } else if (rule.kind === 'FIXED_PRICE') {
    const value = nonNegativeInteger(rule.valueMinor);
    if (value === null) block('BENEFIT_VALUE_INVALID', 'Фиксированная цена льготы не настроена');
    else if (basePriceMinor !== null && value > basePriceMinor) {
      block('BENEFIT_VALUE_INVALID', 'Фиксированная цена льготы выше базовой цены');
    }
    else {
      finalBeforeSurcharge = value;
      discountMinor = basePriceMinor === null ? 0 : Math.max(0, basePriceMinor - value);
    }
  } else if (rule.kind === 'PERCENT_DISCOUNT') {
    if (basePriceMinor === null) {
      block('BASE_PRICE_UNRESOLVED', 'Для расчёта скидки нужна подтверждённая базовая цена');
    } else {
      const discount = floorRatio(basePriceMinor, rule.percentage ?? -1, 100);
      if (discount === null || rule.percentage === null || rule.percentage > 100) {
        block('BENEFIT_VALUE_INVALID', 'Процент скидки некорректен');
      } else {
        discountMinor = discount;
        finalBeforeSurcharge = Math.max(0, basePriceMinor - discount);
      }
    }
  } else if (rule.kind === 'FIXED_DISCOUNT') {
    if (basePriceMinor === null) {
      block('BASE_PRICE_UNRESOLVED', 'Для расчёта скидки нужна подтверждённая базовая цена');
    } else {
      const value = nonNegativeInteger(rule.valueMinor);
      if (value === null) block('BENEFIT_VALUE_INVALID', 'Размер скидки некорректен');
      else {
        discountMinor = Math.min(basePriceMinor, value);
        finalBeforeSurcharge = basePriceMinor - discountMinor;
      }
    }
  } else if (rule.kind === 'PARTIAL_PRICE_PERCENT_DISCOUNT') {
    if (basePriceMinor === null) {
      block('BASE_PRICE_UNRESOLVED', 'Для расчёта доли нужна подтверждённая базовая цена');
    } else {
      const numerator = nonNegativeInteger(rule.partialPrice?.numerator);
      const denominator = nonNegativeInteger(rule.partialPrice?.denominator);
      const percentage = nonNegativeInteger(rule.percentage);
      if (!numerator || !denominator || numerator > denominator
        || percentage === null || percentage > 100) {
        block('BENEFIT_VALUE_INVALID', 'Доля или процент льготы некорректны');
      } else {
        const beforeDiscount = floorRatio(basePriceMinor, numerator, denominator);
        const discount = beforeDiscount === null ? null : floorRatio(beforeDiscount, percentage, 100);
        if (beforeDiscount === null || discount === null) {
          block('PRICE_CALCULATION_OVERFLOW', 'Цена услуги выходит за допустимый диапазон');
        } else {
          finalBeforeSurcharge = beforeDiscount - discount;
          discountMinor = basePriceMinor - finalBeforeSurcharge;
          partialPriceCalculation = {
            numerator,
            denominator,
            chargeBeforeDiscountMinor: beforeDiscount,
            percentageDiscountMinor: discount
          };
        }
      }
    }
  }

  const finalPriceMinor = finalBeforeSurcharge === null
    ? null
    : safeAdd(finalBeforeSurcharge, surchargeMinor);
  if (finalBeforeSurcharge !== null && finalPriceMinor === null) {
    block('PRICE_CALCULATION_OVERFLOW', 'Цена услуги выходит за допустимый диапазон');
  }
  return {
    kind: rule.kind,
    ruleId: rule.ruleId,
    stationRuleId,
    basePriceMinor,
    discountMinor,
    surchargeMinor,
    finalPriceMinor,
    partialPriceCalculation,
    currency: 'RUB'
  };
}
