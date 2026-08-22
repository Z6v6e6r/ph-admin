import { createHash } from 'crypto';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';

export type ManagedAnnualSubscriptionScope = 'PITER' | 'HUB';

export const VIVA_ANNUAL_OPEN_GAME_DICTIONARY = Object.freeze({
  directionId: '4588',
  typeId: '1613',
  canonicalExternalEventTypeId: 'viva:direction:4588:type:1613'
});

export const VIVA_ANNUAL_STUDIOS_SNAPSHOT = Object.freeze([
  '0d5504f6-ea6f-44bb-a9e4-947faf0273ab',
  '0ee057dd-908c-4b33-84b9-1a977480b710',
  '14d6d441-635f-47d0-aa8c-553496294fb1',
  '1c323ef3-7e6c-42eb-a6f7-653460540a8a',
  '1cbb7201-2189-41a4-a3b4-4f543da0def6',
  '1ea77cbf-bc36-49a1-96d6-f35c216a409b',
  '233c1405-1eac-40de-8ec6-1cf7e24c9276',
  '3266d827-2662-4540-9376-daac10f3875e',
  '3656cbaa-6426-490f-a44f-915404cbdd2b',
  '3b52e87f-33bb-436b-a1e3-19a3b62b4ed2',
  '3db3fc06-00e2-445a-97eb-e354796f80a1',
  '42c6d4df-833d-480a-bdc8-986716569884',
  '4c564565-3918-40b2-8cb3-b7135c7cc992',
  '5409fdc8-3db3-4e66-a6a9-8994bd591c8f',
  '588b6151-f4f5-47d9-9449-80edf8cbc748',
  '6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1',
  '6b2d7e60-caff-4b22-89f6-6f19d7d311ab',
  '76c67f10-70ee-4296-9145-1c040e4674ca',
  '8380b5db-c12f-495b-a0d7-c7359168a777',
  '855ec72a-d619-4add-ac92-8c64dafb17c2',
  '8e31b902-1981-4b62-b803-6187b8f2a8da',
  'b09d0015-5198-4a94-b88b-2448218e479d',
  'c72eaaff-2163-47cd-87d0-b93499415acc',
  'ed0e3bd4-6edb-43a9-8fe4-8fc3e7febec8',
  'f82775cc-3dd7-4d02-98c8-e43cce470003'
] as const);

const PITER_STATION_ID = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
const FIXED_ACTIVATION_AT = '2026-09-30T21:00:00.000Z';
const POLICY_EFFECTIVE_AT = '2026-08-20T21:00:00.000Z';

const SCOPE_CONFIG = {
  PITER: {
    subscriptionTypeId: 'subscription_type:608f1030-580c-4438-b001-1f7fc2053a74',
    providerProductId: '8bf334ba-3050-4017-b40a-7eef2db1eb16',
    stationIds: [PITER_STATION_ID],
    crossStationMode: 'HOME_ONLY' as const
  },
  HUB: {
    subscriptionTypeId: 'subscription_type:1f2252e4-7599-454a-9bf4-1fdfe82b2c57',
    providerProductId: 'db7a5250-7369-4f43-8ac5-9111be24bc74',
    stationIds: [...VIVA_ANNUAL_STUDIOS_SNAPSHOT],
    crossStationMode: 'ALLOWED' as const
  }
} as const;

export interface ManagedAnnualSubscriptionV2Candidate {
  schema: 'phab-managed-annual-subscription-policy-v2-candidate';
  scope: ManagedAnnualSubscriptionScope;
  subscriptionTypeId: string;
  expectedPreviousVersion: 1;
  expectedNextVersion: 2;
  providerEvidence: {
    providerProductId: string;
    providerStudioLimited: boolean;
    providerDirectionId: string;
    providerTypeId: string;
    observedAt: '2026-08-22';
  };
  dictionaryRevision: string;
  dictionaryEvidenceRef: null;
  publicationBlockers: Array<
    | 'CANONICAL_DICTIONARY_EVIDENCE_ARTIFACT_REQUIRED'
    | 'REAL_CANONICAL_TARGET_PRODUCER_REQUIRED'
    | 'MULTI_STATION_PROVIDER_SCOPE_PUBLICATION_UNSUPPORTED'
  >;
  request: CreatePolicyVersionDto;
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const capabilities = (scope: ManagedAnnualSubscriptionScope): NonNullable<CreatePolicyVersionDto['capabilities']> => ({
  lifecycle: {
    activationMode: 'FIRST_USE_OR_FIXED_DATE',
    activationWindowDays: 0,
    fixedActivationAt: FIXED_ACTIVATION_AT,
    fixedActivationTimeZone: 'Europe/Moscow',
    gracePeriodDays: 0,
    allowBookingsAfterExpiry: false,
    freeze: {
      enabled: false,
      maxDaysPerYear: 0,
      maxPeriodsPerYear: 0,
      minDaysPerPeriod: 0,
      extendsValidity: true
    },
    adminExtension: { enabled: true, maxDays: 30, reasonRequired: true }
  },
  usage: {
    weeklyUsageLimit: null,
    monthlyUsageLimit: null,
    maxFutureBookings: null,
    minHoursBetweenUses: 0,
    guestPassesPerMonth: 0,
    earlyBookingAccessHours: 0,
    waitlistPriority: false,
    crossStationMode: SCOPE_CONFIG[scope].crossStationMode,
    crossStationSurchargeMinor: 0,
    blackoutDates: []
  },
  cancellation: {
    freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 48 },
    lateCancellationUsageUnits: 1,
    noShowUsageUnits: 1,
    noShowBlockDays: 0,
    stationCancellationRestoresUsage: true,
    reschedulePolicy: 'REVALIDATE'
  },
  commerce: {
    renewalMode: 'MANUAL',
    renewalWindowDays: 30,
    priceLockEnabled: false,
    renewalDiscountPercent: 0,
    purchaseLimitPerClient: 1,
    reservationTtlMinutes: 15,
    waitlistWhenSoldOut: true,
    promoCodesAllowed: false,
    installmentsAllowed: false,
    upgradeDowngradeMode: 'DISABLED',
    terminationRefundMode: 'MANUAL',
    coolingOffDays: 0,
    giftable: false,
    transferable: false,
    familySeats: 1,
    corporateSeats: 1,
    maxConcurrentSubscriptions: 1,
    consumptionPriority: 'EXPIRING_FIRST'
  },
  engagement: {
    showSavings: true,
    showBreakEvenProgress: true,
    expirationReminderDays: [30, 14, 7, 1],
    referralEnabled: false,
    renewalBonusEnabled: false,
    personalizedRecommendationsEnabled: false
  },
  analytics: {
    trackRevenue: true,
    trackRefunds: true,
    trackBreakage: true,
    trackMargin: true,
    trackPeakLoad: true,
    trackChurn: true,
    trackCohorts: true,
    attributionTag: null
  }
});

export const buildManagedAnnualSubscriptionV2Candidate = (
  scope: ManagedAnnualSubscriptionScope
): ManagedAnnualSubscriptionV2Candidate => {
  const config = SCOPE_CONFIG[scope];
  const benefitStationIds = [...config.stationIds].sort();
  const dictionary = {
    provider: 'VIVA',
    stationIds: benefitStationIds,
    directionId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.directionId,
    typeId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.typeId,
    canonicalExternalEventTypeId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.canonicalExternalEventTypeId
  };
  const dictionaryHash = sha256(dictionary);
  const publicationBlockers: ManagedAnnualSubscriptionV2Candidate['publicationBlockers'] = [
    'CANONICAL_DICTIONARY_EVIDENCE_ARTIFACT_REQUIRED',
    'REAL_CANONICAL_TARGET_PRODUCER_REQUIRED',
    ...(scope === 'HUB' ? ['MULTI_STATION_PROVIDER_SCOPE_PUBLICATION_UNSUPPORTED' as const] : [])
  ];
  const stationAccessRules: CreatePolicyVersionDto['stationAccessRules'] = [{
    ruleId: `annual-v2:${scope.toLowerCase()}:station-access`,
    enabled: true,
    priority: 100,
    selector: { kind: 'STATION_LIST', stationIds: benefitStationIds },
    surcharge: { kind: 'NONE', amountMinor: 0 }
  }];

  const request: CreatePolicyVersionDto = {
    effectiveAt: POLICY_EFFECTIVE_AT,
    applyTo: 'NEW_ONLY',
    validityDays: 365,
    createGame: { enabled: true, durationsMinutes: [60] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    maxActiveServices: 0,
    bookingWindowDays: 1,
    activeServicesLimit: { enabled: false, max: null, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: false, days: null },
    dailyUsageLimit: 1,
    activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules,
    benefitRules: [{
      ruleId: 'annual-v2:create-game-free',
      enabled: true,
      category: 'GAME',
      actions: ['CREATE_GAME'],
      externalEventTypeIds: [VIVA_ANNUAL_OPEN_GAME_DICTIONARY.canonicalExternalEventTypeId],
      productTypeIds: [],
      durationMinutes: [60],
      stationIds: benefitStationIds,
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 200
    }, {
      ruleId: 'annual-v2:join-game-free',
      enabled: true,
      category: 'GAME',
      actions: ['JOIN_GAME'],
      externalEventTypeIds: [VIVA_ANNUAL_OPEN_GAME_DICTIONARY.canonicalExternalEventTypeId],
      productTypeIds: [],
      durationMinutes: [60, 90, 120],
      stationIds: benefitStationIds,
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 100
    }],
    providerBinding: {
      provider: 'VIVA',
      externalId: config.providerProductId,
      referenceKind: 'PRODUCT_CANDIDATE'
    },
    capabilities: capabilities(scope)
  };

  return {
    schema: 'phab-managed-annual-subscription-policy-v2-candidate',
    scope,
    subscriptionTypeId: config.subscriptionTypeId,
    expectedPreviousVersion: 1,
    expectedNextVersion: 2,
    providerEvidence: {
      providerProductId: config.providerProductId,
      providerStudioLimited: scope === 'PITER',
      providerDirectionId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.directionId,
      providerTypeId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.typeId,
      observedAt: '2026-08-22'
    },
    dictionaryRevision: `annual-v2-${dictionaryHash}`,
    dictionaryEvidenceRef: null,
    publicationBlockers,
    request
  };
};
