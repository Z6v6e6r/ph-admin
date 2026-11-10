import { createHash } from 'node:crypto';
import type { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import type { SubscriptionRuntimeProjectionSnapshot } from './subscriptions.types';

export const RESIDENCY_PRODUCT_ID = '4037a3a3-e551-4f9a-a9db-1410e46b8635';
export const LK_NODE_RED_RESIDENCY_BOOKING_V1 = 'LK_NODE_RED_RESIDENCY_BOOKING_V1' as const;
// Keep this manifest identical to the Node-RED consumer. Dictionary selectors are
// pinned separately by the publication's policyDigest and dictionaryRevision.
export const RESIDENCY_BOOKING_CAPABILITY_MANIFEST = Object.freeze({
  adapterId: 'LK1_RESIDENCY_BOOKING', contractVersion: 1,
  providerProductId: RESIDENCY_PRODUCT_ID, validityDays: 30,
  stationAccess: 'ALL_STATIONS', usageUnits: 0,
  actions: ['CREATE_GAME', 'JOIN_GAME', 'BOOK_GROUP_TRAINING'],
  durationsMinutes: [60, 90, 120], gameDiscountPercent: 30,
  groupTrainingDiscountPercent: 50, activationMode: 'PURCHASE'
});
export const RESIDENCY_BOOKING_COMPATIBILITY = Object.freeze({
  adapterId: RESIDENCY_BOOKING_CAPABILITY_MANIFEST.adapterId,
  contractVersion: 1,
  capabilityDigest: `sha256:${createHash('sha256').update(JSON.stringify(RESIDENCY_BOOKING_CAPABILITY_MANIFEST)).digest('hex')}`
});

const equal = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Exact monetary profile. An annual/free-visit policy cannot attest as residency. */
export function residencyBookingPolicyBlockers(p: SubscriptionRuntimeProjectionSnapshot): string[] {
  const errors: string[] = [];
  if (!p.createGame.enabled || !equal(p.createGame.durationsMinutes, [60, 90, 120])
    || !p.joinGame.enabled || p.joinGame.minDurationMinutes !== 60 || p.joinGame.maxDurationMinutes !== 120) errors.push('ACTIONS_UNSUPPORTED');
  if (p.lifecycle.validityDays !== 30 || p.lifecycle.activationMode !== 'PURCHASE'
    || p.lifecycle.activationWindowDays !== 0 || p.lifecycle.fixedActivationAt !== null
    || p.lifecycle.allowBookingsAfterExpiry !== false) errors.push('LIFECYCLE_UNSUPPORTED');
  if (p.activeServicesLimit.enabled || p.activeServicesLimit.max !== null
    || p.bookingWindow.enabled || p.bookingWindow.days !== null
    || p.dailyUsageLimit !== 0 || Object.values(p.usageUnitsByDuration).some(v => v !== 0)
    || (p.dailyUsagePolicy && p.dailyUsagePolicy.limitExceeded !== 'BLOCK')
    || p.usage.weeklyUsageLimit !== null || p.usage.monthlyUsageLimit !== null
    || p.usage.maxFutureBookings !== null || p.usage.minHoursBetweenUses !== 0
    || p.usage.blackoutDates.length !== 0) errors.push('USAGE_UNSUPPORTED');
  const access = p.stationAccessRules;
  if (access.length !== 1 || !access[0].enabled || access[0].selector.kind !== 'ALL_STATIONS'
    || access[0].selector.stationIds.length !== 0 || access[0].surcharge.kind !== 'NONE'
    || access[0].surcharge.amountMinor !== 0) errors.push('STATION_SCOPE_UNSUPPORTED');
  const rules = p.benefitRules.filter(r => r.enabled);
  const game = rules.find(r => r.category === 'GAME');
  const training = rules.find(r => r.category === 'GROUP_TRAINING');
  if (rules.length !== 2 || !game || !training
    || !equal(game.actions, ['CREATE_GAME', 'JOIN_GAME']) || !equal(training.actions, ['BOOK_GROUP_TRAINING'])
    || game.allStations !== true || training.allStations !== true || game.stationIds.length !== 0 || training.stationIds.length !== 0
    || rules.some(r => r.kind !== 'PERCENT_DISCOUNT' || r.valueMinor !== null || r.partialPrice !== null
      || r.productTypeIds.length !== 0 || !equal(r.durationMinutes, [60, 90, 120]) || r.externalEventTypeIds.length === 0)
    || game.percentage !== 30 || training.percentage !== 50) errors.push('BENEFIT_UNSUPPORTED');
  return errors;
}

/** Check-only DTO factory: never creates a type, mapping, publication or instance. */
export function buildResidencyPolicyCandidate(input: {
  effectiveAt: string; gameEventTypeIds: string[]; groupTrainingEventTypeIds: string[];
}): CreatePolicyVersionDto {
  const ids = (values: string[]) => {
    if (!values.length || values.some(v => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/.test(v))) throw new Error('CANONICAL_DICTIONARY_REQUIRED');
    return [...new Set(values)].sort();
  };
  const rule = (category: 'GAME' | 'GROUP_TRAINING', percentage: number, events: string[]) => ({
    ruleId: `residency:${category.toLowerCase()}`, enabled: true, category,
    actions: category === 'GAME' ? ['CREATE_GAME', 'JOIN_GAME'] as Array<'CREATE_GAME' | 'JOIN_GAME'> : ['BOOK_GROUP_TRAINING'] as Array<'BOOK_GROUP_TRAINING'>,
    externalEventTypeIds: ids(events), productTypeIds: [], durationMinutes: [60, 90, 120] as Array<60 | 90 | 120>,
    stationIds: [], allStations: true, kind: 'PERCENT_DISCOUNT' as const, percentage,
    valueMinor: null, partialPrice: null, priority: 100
  });
  return {
    effectiveAt: input.effectiveAt, applyTo: 'NEW_ONLY', validityDays: 30,
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    maxActiveServices: 0, bookingWindowDays: 1, dailyUsageLimit: 0,
    activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
    activeServicesLimit: {enabled:false,max:null,scope:'SUBSCRIPTION_BENEFIT_ONLY'},
    bookingWindow: {enabled:false,days:null}, usageUnitsByDuration: {'60':0,'90':0,'120':0},
    stationAccessRules: [{ruleId:'residency:all-stations',enabled:true,priority:100,
      selector:{kind:'ALL_STATIONS',stationIds:[]},surcharge:{kind:'NONE',amountMinor:0}}],
    benefitRules: [rule('GAME',30,input.gameEventTypeIds),rule('GROUP_TRAINING',50,input.groupTrainingEventTypeIds)],
    providerBinding: {provider:'VIVA',externalId:RESIDENCY_PRODUCT_ID,referenceKind:'PRODUCT_CANDIDATE'},
    capabilities: {
      lifecycle: {activationMode:'PURCHASE',activationWindowDays:0,fixedActivationAt:null,fixedActivationTimeZone:'Europe/Moscow',gracePeriodDays:0,allowBookingsAfterExpiry:false,
        freeze:{enabled:false,maxDaysPerYear:0,maxPeriodsPerYear:0,minDaysPerPeriod:0,extendsValidity:false},adminExtension:{enabled:false,maxDays:0,reasonRequired:true}},
      usage:{weeklyUsageLimit:null,monthlyUsageLimit:null,maxFutureBookings:null,minHoursBetweenUses:0,guestPassesPerMonth:0,earlyBookingAccessHours:0,waitlistPriority:false,crossStationMode:'ALLOWED',crossStationSurchargeMinor:0,blackoutDates:[]},
      cancellation:{freeCancellationHours:{GAME:24,GROUP_TRAINING:24,TOURNAMENT:48},lateCancellationUsageUnits:0,noShowUsageUnits:0,noShowBlockDays:0,stationCancellationRestoresUsage:false,reschedulePolicy:'REVALIDATE'},
      commerce:{renewalMode:'DISABLED',renewalWindowDays:0,priceLockEnabled:false,renewalDiscountPercent:0,purchaseLimitPerClient:1,reservationTtlMinutes:15,waitlistWhenSoldOut:false,promoCodesAllowed:false,installmentsAllowed:false,upgradeDowngradeMode:'DISABLED',terminationRefundMode:'NONE',coolingOffDays:0,giftable:false,transferable:false,familySeats:1,corporateSeats:1,maxConcurrentSubscriptions:1,consumptionPriority:'EXPIRING_FIRST'},
      engagement:{showSavings:true,showBreakEvenProgress:false,expirationReminderDays:[],referralEnabled:false,renewalBonusEnabled:false,personalizedRecommendationsEnabled:false},
      analytics:{trackRevenue:true,trackRefunds:true,trackBreakage:false,trackMargin:true,trackPeakLoad:true,trackChurn:true,trackCohorts:true,attributionTag:null}
    }
  };
}
