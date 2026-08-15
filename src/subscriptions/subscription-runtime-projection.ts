import { UnprocessableEntityException } from '@nestjs/common';
import {
  BenefitRule,
  SubscriptionPolicyVersion,
  SubscriptionStationAccessRule
} from './subscriptions.types';

export interface SubscriptionRuntimeProjectionV1 {
  runtimeSchemaVersion: 1;
  subscriptionTypeId: string;
  policyVersion: number;
  status: 'PUBLISHED';
  effectiveAt: string;
  timeZone: 'Europe/Moscow';
  createGame: SubscriptionPolicyVersion['createGame'];
  joinGame: SubscriptionPolicyVersion['joinGame'];
  activeServicesLimit: NonNullable<SubscriptionPolicyVersion['activeServicesLimit']>;
  bookingWindow: NonNullable<SubscriptionPolicyVersion['bookingWindow']>;
  dailyUsageLimit: number;
  usageUnitsByDuration: SubscriptionPolicyVersion['usageUnitsByDuration'];
  stationAccessRules: SubscriptionStationAccessRule[];
  benefitRules: BenefitRule[];
  lifecycle: { allowBookingsAfterExpiry: boolean };
  usage: {
    weeklyUsageLimit: number | null;
    monthlyUsageLimit: number | null;
    maxFutureBookings: number | null;
    minHoursBetweenUses: number;
    blackoutDates: string[];
  };
}

/**
 * Pure compiler for the LK evaluator contract. It deliberately has no provider,
 * database or publication side effects. DRAFT/v2 policies fail closed.
 */
export function compileSubscriptionRuntimeProjection(
  policy: SubscriptionPolicyVersion
): SubscriptionRuntimeProjectionV1 {
  if (policy.status !== 'PUBLISHED') {
    throw projectionError('POLICY_NOT_PUBLISHED', 'Runtime projection requires a PUBLISHED policy');
  }
  if (policy.modelVersion !== 3) {
    throw projectionError('POLICY_MODEL_NOT_RUNTIME_READY', 'Runtime projection requires policy modelVersion 3');
  }
  if (!policy.activeServicesLimit || !policy.bookingWindow) {
    throw projectionError('SWITCHABLE_LIMITS_REQUIRED', 'Runtime projection requires switchable limit controls');
  }
  if (!policy.stationAccessRules?.length) {
    throw projectionError('STATION_RULES_REQUIRED', 'Runtime projection requires station access rules');
  }
  return {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: policy.subscriptionTypeId,
    policyVersion: policy.version,
    status: 'PUBLISHED',
    effectiveAt: policy.effectiveAt,
    timeZone: 'Europe/Moscow',
    createGame: {
      enabled: policy.createGame.enabled,
      durationsMinutes: [...policy.createGame.durationsMinutes]
    },
    joinGame: { ...policy.joinGame },
    activeServicesLimit: { ...policy.activeServicesLimit },
    bookingWindow: { ...policy.bookingWindow },
    dailyUsageLimit: policy.dailyUsageLimit,
    usageUnitsByDuration: { ...policy.usageUnitsByDuration },
    stationAccessRules: policy.stationAccessRules.map((rule) => ({
      ...rule,
      selector: { ...rule.selector, stationIds: [...rule.selector.stationIds] } as SubscriptionStationAccessRule['selector'],
      surcharge: { ...rule.surcharge }
    })),
    benefitRules: policy.benefitRules.map((rule) => ({
      ...rule,
      actions: [...rule.actions],
      externalEventTypeIds: [...rule.externalEventTypeIds],
      productTypeIds: [...rule.productTypeIds],
      durationMinutes: [...rule.durationMinutes],
      stationIds: [...rule.stationIds],
      partialPrice: rule.partialPrice ? { ...rule.partialPrice } : null
    })),
    lifecycle: {
      allowBookingsAfterExpiry: policy.capabilities.lifecycle.allowBookingsAfterExpiry
    },
    usage: {
      weeklyUsageLimit: policy.capabilities.usage.weeklyUsageLimit,
      monthlyUsageLimit: policy.capabilities.usage.monthlyUsageLimit,
      maxFutureBookings: policy.capabilities.usage.maxFutureBookings,
      minHoursBetweenUses: policy.capabilities.usage.minHoursBetweenUses,
      blackoutDates: [...policy.capabilities.usage.blackoutDates]
    }
  };
}

function projectionError(code: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message });
}
