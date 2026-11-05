import { computeSubscriptionRuntimeProjectionDigest } from '../../src/subscriptions/subscription-runtime-contracts';
import { computeSubscriptionClientRefHash } from '../../src/subscriptions/subscription-trusted-shadow-adapter.service';
import type {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../../src/subscriptions/subscriptions.types';

export const RESIDENT_TENANT = 'iSkq6G';
export const RESIDENT_PEPPER = 'resident-services-test-pepper-'.repeat(2);
export const RESIDENT_TOKEN_PEPPER = 'resident-services-token-pepper-'.repeat(2);
export const RESIDENT_INTEGRATION_TOKEN = 'resident-services-integration-token-'.repeat(2);
export const RESIDENT_NOW = '2026-08-20T10:00:00.000Z';
export const RESIDENT_LATER = '2026-08-20T12:00:00.000Z';
export const HOME_STATION = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
export const OTHER_STATION = 'station:other-1';
export const PROVIDER_CLIENT_ID = 'provider_client:piter-1';
export const INSTANCE_ID = 'subscription_instance:piter-1';
export const CLIENT_SUBSCRIPTION_ID = 'client_subscription:piter-1';
export const TYPE_ID = 'subscription_type:piter-friendship-12m';
export const MAPPING_ID = 'mapping:piter-friendship';
export const HASH = 'a'.repeat(64);

export const residentClientRefHash = (providerClientId = PROVIDER_CLIENT_ID): string =>
  computeSubscriptionClientRefHash({
    pepper: RESIDENT_PEPPER,
    tenantId: RESIDENT_TENANT,
    providerClientId
  });

export function residentSubscriptionTypeFixture(): StoredSubscriptionType {
  return {
    schemaVersion: 1,
    subscriptionTypeId: TYPE_ID,
    code: 'PITER_FRIENDSHIP_12M',
    codeNorm: 'piter-friendship-12m',
    title: 'Резидент Питер 12 месяцев',
    description: null,
    state: 'ACTIVE',
    currentPolicyVersion: 1,
    revision: 1,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    createdBy: 'admin:subscriptions',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'subscription-type-piter',
      requestHash: HASH,
      correlationId: 'corr:subscription-type-piter'
    }
  };
}

export function residentPublicationFixture(): StoredSubscriptionPolicyPublication {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: TYPE_ID,
    policyVersion: 1,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-20T09:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: false, max: null, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: false, days: null },
    dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [{
      ruleId: 'station_rule:resident-home',
      enabled: true,
      priority: 1,
      selector: { kind: 'HOME_STATION', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [
      {
        ruleId: 'benefit:create-60',
        enabled: true,
        category: 'GAME',
        actions: ['CREATE_GAME'],
        externalEventTypeIds: ['event_type:open-game'],
        productTypeIds: [],
        durationMinutes: [60],
        stationIds: [HOME_STATION],
        kind: 'FREE_ENTITLEMENT',
        valueMinor: null,
        percentage: null,
        partialPrice: null,
        priority: 1
      }
    ],
    lifecycle: {
      allowBookingsAfterExpiry: false,
      activationMode: 'FIRST_USE_OR_FIXED_DATE',
      activationWindowDays: 0,
      fixedActivationAt: '2026-09-30T21:00:00.000Z',
      fixedActivationTimeZone: 'Europe/Moscow',
      validityDays: 365
    },
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
    publicationId: 'publication:piter-friendship-v1',
    subscriptionTypeId: TYPE_ID,
    policyVersion: 1,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: MAPPING_ID,
    dictionaryRevision: 'dictionary:2026-08-20',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: '2026-08-20T09:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:piter-friendship-v1',
    approvalAuditRef: 'audit:piter-friendship-v1'
  };
}

export function residentMappingFixture(): StoredSubscriptionProviderMapping {
  return {
    schemaVersion: 1,
    mappingId: MAPPING_ID,
    tenantId: RESIDENT_TENANT,
    provider: 'VIVA',
    providerProductId: 'product:piter-friendship',
    providerScope: { kind: 'TENANT', scopeId: RESIDENT_TENANT },
    subscriptionTypeId: TYPE_ID,
    state: 'VERIFIED',
    evidenceRef: 'evidence:mapping-readback',
    verifiedAt: '2026-08-20T09:59:50.000Z',
    verifiedBy: 'admin:subscriptions',
    revision: 2,
    createdAt: '2026-08-20T09:00:00.000Z',
    createdBy: 'admin:subscriptions',
    updatedAt: '2026-08-20T09:59:50.000Z',
    updatedBy: 'admin:subscriptions',
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'mapping-create-piter',
      requestHash: HASH,
      correlationId: 'corr:mapping-piter'
    }
  };
}

export function residentInstanceFixture(): StoredSubscriptionInstance {
  return {
    schemaVersion: 1,
    subscriptionInstanceId: INSTANCE_ID,
    tenantId: RESIDENT_TENANT,
    subscriptionTypeId: TYPE_ID,
    policyVersion: 1,
    policyDigest: residentPublicationFixture().policyDigest,
    mappingId: MAPPING_ID,
    provider: 'VIVA',
    providerProductId: 'product:piter-friendship',
    providerClientId: PROVIDER_CLIENT_ID,
    clientSubscriptionId: CLIENT_SUBSCRIPTION_ID,
    clientRefHash: residentClientRefHash(),
    homeStationId: HOME_STATION,
    releaseProgramId: 'release_program:piter-2026',
    releasePhaseId: 'release_phase:piter-1',
    purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
    state: 'ACTIVE',
    purchasedAt: '2026-08-20T09:00:00.000Z',
    activeFrom: '2026-08-20T09:00:00.000Z',
    activeTo: '2027-08-19T20:59:59.999Z',
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
      asOf: '2026-08-20T09:59:50.000Z',
      evidenceRef: 'evidence:instance-current'
    },
    revision: 3,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:59:50.000Z'
  };
}

export function configureResidentServicesEnv(): () => void {
  const settings: Record<string, string> = {
    RESIDENT_SERVICES_ENABLED: 'true',
    RESIDENT_SERVICES_INTEGRATION_TOKEN: RESIDENT_INTEGRATION_TOKEN,
    RESIDENT_SERVICES_TOKEN_PEPPER: RESIDENT_TOKEN_PEPPER,
    RESIDENT_SERVICES_TENANT_ID: RESIDENT_TENANT,
    RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS: '3600',
    RESIDENT_SERVICES_PASS_TTL_SECONDS: '120',
    SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: RESIDENT_PEPPER,
    RESIDENT_SERVICES_AUTO_CREATE_INDEXES: 'false',
    NODE_ENV: 'test'
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, settings);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function residentStaff(overrides: Partial<{
  id: string;
  permissions: string[];
  stationIds: string[];
  permissionStationScopes: Record<string, string[] | null>;
}> = {}): {
  id: string;
  roles: string[];
  permissions: string[];
  stationIds: string[];
  permissionStationScopes: Record<string, string[] | null>;
} {
  return {
    id: overrides.id ?? 'admin:resident-manager',
    roles: ['MANAGER'],
    permissions: overrides.permissions ?? [
      'resident-services:issue',
      'resident-services:return',
      'resident-services:read',
      'resident-services:configure'
    ],
    stationIds: overrides.stationIds ?? [],
    permissionStationScopes: overrides.permissionStationScopes ?? {}
  };
}
