import { VIVA_ANNUAL_STUDIOS_SNAPSHOT } from './annual-subscription-policy-v2-candidate';
import { SubscriptionPolicyVersion } from './subscriptions.types';

export const LK_NODE_RED_ANNUAL_BOOKING_V1 = 'LK_NODE_RED_ANNUAL_BOOKING_V1' as const;

type PublicationEnforcementAdapterVersion = typeof LK_NODE_RED_ANNUAL_BOOKING_V1;

const PITER_PRODUCT_ID = '8bf334ba-3050-4017-b40a-7eef2db1eb16';
const HUB_PRODUCT_ID = 'db7a5250-7369-4f43-8ac5-9111be24bc74';
const PITER_STATION_ID = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
const FIXED_ACTIVATION_AT = '2026-09-30T21:00:00.000Z';
const VIVA_ANNUAL_OPEN_GAME_EVENT_TYPE_ID = 'viva:direction:4588:type:1613';

export class SubscriptionPublicationAdapterError extends Error {
  constructor(
    readonly adapterVersion: string | null,
    readonly blockerKeys: string[]
  ) {
    super('Subscription policy is not supported by the configured enforcement adapter');
  }
}

/**
 * This is deliberately a publication-time allowlist, not a general policy
 * evaluator. Lifecycle cancellation and commerce fields are modeled by CUP but
 * are separate release gates; they do not participate in LK booking admission.
 */
export function requirePublicationEnforcementAdapter(): PublicationEnforcementAdapterVersion {
  const configured = String(process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION ?? '').trim();
  if (configured === LK_NODE_RED_ANNUAL_BOOKING_V1) return configured;
  throw new SubscriptionPublicationAdapterError(
    configured || null,
    configured ? ['ADAPTER_VERSION_UNKNOWN'] : ['ADAPTER_VERSION_REQUIRED']
  );
}

export function assertPolicySupportedByPublicationAdapter(
  adapterVersion: PublicationEnforcementAdapterVersion,
  policy: SubscriptionPolicyVersion
): void {
  const blockers = adapterVersion === LK_NODE_RED_ANNUAL_BOOKING_V1
    ? lkNodeRedAnnualBookingV1Blockers(policy)
    : ['ADAPTER_VERSION_UNKNOWN'];
  if (blockers.length > 0) {
    throw new SubscriptionPublicationAdapterError(adapterVersion, blockers);
  }
}

function lkNodeRedAnnualBookingV1Blockers(policy: SubscriptionPolicyVersion): string[] {
  const blockers: string[] = [];
  const productId = policy.providerBinding?.externalId;
  const expectedStations = productId === PITER_PRODUCT_ID
    ? [PITER_STATION_ID]
    : productId === HUB_PRODUCT_ID
      ? [...VIVA_ANNUAL_STUDIOS_SNAPSHOT]
      : null;
  if (!expectedStations) blockers.push('PROVIDER_PRODUCT_UNSUPPORTED');

  if (!policy.createGame.enabled || !sameNumbers(policy.createGame.durationsMinutes, [60])) {
    blockers.push('CREATE_GAME_DURATION_UNSUPPORTED');
  }
  if (!policy.joinGame.enabled
    || policy.joinGame.minDurationMinutes !== 60
    || policy.joinGame.maxDurationMinutes !== 120) {
    blockers.push('JOIN_GAME_DURATION_UNSUPPORTED');
  }
  if (policy.maxActiveServices !== 0
    || policy.activeServicesLimit?.enabled !== false
    || policy.activeServicesLimit.max !== null) {
    blockers.push('ACTIVE_SERVICES_UNSUPPORTED');
  }
  if (policy.bookingWindow?.enabled !== false || policy.bookingWindow.days !== null) {
    blockers.push('BOOKING_WINDOW_UNSUPPORTED');
  }
  if (policy.dailyUsageLimit !== 1) blockers.push('DAILY_USAGE_LIMIT_UNSUPPORTED');
  if (policy.usageUnitsByDuration['60'] !== 1
    || policy.usageUnitsByDuration['90'] !== 1
    || policy.usageUnitsByDuration['120'] !== 1) {
    blockers.push('USAGE_UNITS_UNSUPPORTED');
  }
  const usage = policy.capabilities.usage;
  if (usage.weeklyUsageLimit !== null
    || usage.monthlyUsageLimit !== null
    || usage.maxFutureBookings !== null
    || usage.minHoursBetweenUses !== 0) {
    blockers.push('USAGE_COUNTER_UNSUPPORTED');
  }

  const lifecycle = policy.capabilities.lifecycle;
  if (policy.validityDays !== 365
    || lifecycle.activationMode !== 'FIRST_USE_OR_FIXED_DATE'
    || lifecycle.activationWindowDays !== 0
    || lifecycle.fixedActivationAt !== FIXED_ACTIVATION_AT
    || lifecycle.fixedActivationTimeZone !== 'Europe/Moscow'
    || lifecycle.allowBookingsAfterExpiry !== false) {
    blockers.push('LIFECYCLE_UNSUPPORTED');
  }

  if (!expectedStations || !exactStationRules(policy, expectedStations)) {
    blockers.push('STATION_SCOPE_UNSUPPORTED');
  }
  if (!compatibleBenefits(policy, expectedStations ?? [])) {
    blockers.push('BENEFIT_UNSUPPORTED');
  }
  return blockers;
}

function exactStationRules(policy: SubscriptionPolicyVersion, expectedStationIds: string[]): boolean {
  if (policy.stationAccessRules?.length !== 1) return false;
  const [rule] = policy.stationAccessRules;
  return rule.enabled
    && rule.selector.kind === 'STATION_LIST'
    && sameStrings(rule.selector.stationIds, expectedStationIds)
    && rule.surcharge.kind === 'NONE'
    && rule.surcharge.amountMinor === 0;
}

function compatibleBenefits(policy: SubscriptionPolicyVersion, expectedStationIds: string[]): boolean {
  const enabled = policy.benefitRules.filter((rule) => rule.enabled);
  const actions = new Set<string>();
  for (const rule of enabled) {
    if (rule.category !== 'GAME'
      || rule.kind !== 'FREE_ENTITLEMENT'
      || !sameStrings(rule.stationIds, expectedStationIds)
      || !sameStrings(rule.externalEventTypeIds, [VIVA_ANNUAL_OPEN_GAME_EVENT_TYPE_ID])
      || rule.productTypeIds.length !== 0
      || rule.actions.length !== 1
      || !['CREATE_GAME', 'JOIN_GAME'].includes(rule.actions[0])) return false;
    const action = rule.actions[0];
    if (!sameNumbers(rule.durationMinutes, action === 'CREATE_GAME' ? [60] : [60, 90, 120])) return false;
    actions.add(action);
  }
  return actions.size === 2 && actions.has('CREATE_GAME') && actions.has('JOIN_GAME');
}

function sameNumbers(actual: readonly number[], expected: readonly number[]): boolean {
  return actual.length === expected.length
    && [...actual].sort((left, right) => left - right).every((value, index) => value === expected[index]);
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}
