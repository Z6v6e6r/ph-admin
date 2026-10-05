import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_ADMIN_MUTATION_AUDIT_KEY } from '../src/common/observability/admin-audit.decorator';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { PublishSubscriptionPolicyDto } from '../src/subscriptions/dto/subscription-policy-publication.dto';
import {
  buildManagedAnnualSubscriptionV2Candidate,
  VIVA_ANNUAL_STUDIOS_SNAPSHOT
} from '../src/subscriptions/annual-subscription-policy-v2-candidate';
import {
  assertPolicySupportedByPublicationAdapter,
  LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_DIGEST,
  LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST,
  LK_NODE_RED_ANNUAL_BOOKING_V1
} from '../src/subscriptions/subscription-publication-enforcement-adapter';
import { SubscriptionPublicationService } from '../src/subscriptions/subscription-publication.service';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError
} from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import {
  buildSubscriptionProjectionFence,
  subscriptionProjectionFenceBindingDigest
} from '../src/subscriptions/subscription-projection-fence';
import { SubscriptionsController } from '../src/subscriptions/subscriptions.controller';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';

const HASH = 'a'.repeat(64);
const HUB_STATION_IDS = [...VIVA_ANNUAL_STUDIOS_SNAPSHOT];
const globalAdmin: RequestUser = {
  id: 'admin:global',
  login: 'global-admin',
  title: 'Global admin',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  permissionStationScopes: { 'subscriptions:publication:write': null },
  stationIds: [],
  connectorRoutes: []
};
const stationAdmin: RequestUser = {
  id: 'admin:station',
  roles: [Role.STATION_ADMIN],
  permissions: ['subscriptions:publication:write'],
  permissionStationScopes: { 'subscriptions:publication:write': ['station:piter'] },
  stationIds: ['station:piter'],
  connectorRoutes: []
};

const typeFixture = (): StoredSubscriptionType => ({
  schemaVersion: 1,
  subscriptionTypeId: 'subscription_type:piter-friendship-12m',
  code: 'friendship-12m-piter-2026',
  codeNorm: 'friendship-12m-piter-2026',
  title: 'Падел.Дружба.Питер',
  description: null,
  state: 'DRAFT',
  currentPolicyVersion: null,
  revision: 1,
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
  createdBy: 'admin:global',
  idempotency: {
    actorId: 'admin:global', key: 'create-piter-subscription', requestHash: HASH,
    correlationId: 'corr:create-piter'
  }
});

const policyFixture = (scope: 'PITER' | 'HUB' = 'PITER'): StoredSubscriptionPolicyVersion => ({
  schemaVersion: 3,
  modelVersion: 3,
  subscriptionTypeId: scope === 'PITER'
    ? 'subscription_type:piter-friendship-12m'
    : 'subscription_type:hub-friendship-12m',
  version: 1,
  revision: 1,
  status: 'DRAFT',
  effectiveAt: '2026-08-20T21:00:00.000Z',
  applyTo: 'NEW_ONLY',
  validityDays: 365,
  createGame: { enabled: true, durationsMinutes: [60] },
  joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
  maxActiveServices: 0,
  bookingWindowDays: 0,
  activeServicesLimit: { enabled: false, max: null, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
  bookingWindow: { enabled: false, days: null },
  dailyUsageLimit: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
  stationAccessRules: scope === 'PITER'
    ? [{
      ruleId: 'station-rule:piter', enabled: true, priority: 1,
      selector: { kind: 'STATION_LIST', stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b'] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }]
    : [{
      ruleId: 'station-rule:hub', enabled: true, priority: 1,
      selector: { kind: 'STATION_LIST', stationIds: [...HUB_STATION_IDS].reverse() },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
  benefitRules: [{
    ruleId: 'benefit-rule:create-game',
    enabled: true,
    category: 'GAME',
    actions: ['CREATE_GAME'],
    externalEventTypeIds: ['viva:direction:4588:type:1613'],
    productTypeIds: [],
    durationMinutes: [60],
    stationIds: scope === 'PITER'
      ? ['1ea77cbf-bc36-49a1-96d6-f35c216a409b']
      : HUB_STATION_IDS,
    kind: 'FREE_ENTITLEMENT',
    valueMinor: null,
    percentage: null,
    partialPrice: null,
    priority: 20
  }, {
    ruleId: 'benefit-rule:join-game',
    enabled: true,
    category: 'GAME',
    actions: ['JOIN_GAME'],
    externalEventTypeIds: ['viva:direction:4588:type:1613'],
    productTypeIds: [],
    durationMinutes: [60, 90, 120],
    stationIds: scope === 'PITER'
      ? ['1ea77cbf-bc36-49a1-96d6-f35c216a409b']
      : HUB_STATION_IDS,
    kind: 'FREE_ENTITLEMENT',
    valueMinor: null,
    percentage: null,
    partialPrice: null,
    priority: 10
  }],
  providerBinding: {
    provider: 'VIVA',
    externalId: scope === 'PITER'
      ? '8bf334ba-3050-4017-b40a-7eef2db1eb16'
      : 'db7a5250-7369-4f43-8ac5-9111be24bc74',
    referenceKind: 'PRODUCT_CANDIDATE',
    evidenceState: 'UNVERIFIED'
  },
  capabilities: {
    lifecycle: {
      activationMode: 'FIRST_USE_OR_FIXED_DATE', activationWindowDays: 0,
      fixedActivationAt: '2026-09-30T21:00:00.000Z',
      fixedActivationTimeZone: 'Europe/Moscow', gracePeriodDays: 0,
      allowBookingsAfterExpiry: false,
      freeze: {
        enabled: false, maxDaysPerYear: 0, maxPeriodsPerYear: 0,
        minDaysPerPeriod: 0, extendsValidity: true
      },
      adminExtension: { enabled: true, maxDays: 30, reasonRequired: true }
    },
    usage: {
      weeklyUsageLimit: null, monthlyUsageLimit: null, maxFutureBookings: null,
      minHoursBetweenUses: 0, guestPassesPerMonth: 0, earlyBookingAccessHours: 0,
      waitlistPriority: false, crossStationMode: 'ALLOWED',
      crossStationSurchargeMinor: 0, blackoutDates: []
    },
    cancellation: {
      freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 48 },
      lateCancellationUsageUnits: 1, noShowUsageUnits: 1, noShowBlockDays: 0,
      stationCancellationRestoresUsage: true, reschedulePolicy: 'REVALIDATE'
    },
    commerce: {
      renewalMode: 'MANUAL', renewalWindowDays: 30, priceLockEnabled: false,
      renewalDiscountPercent: 0, purchaseLimitPerClient: 1, reservationTtlMinutes: 15,
      waitlistWhenSoldOut: true, promoCodesAllowed: false, installmentsAllowed: false,
      upgradeDowngradeMode: 'DISABLED', terminationRefundMode: 'MANUAL', coolingOffDays: 0,
      giftable: false, transferable: false, familySeats: 1, corporateSeats: 1,
      maxConcurrentSubscriptions: 1, consumptionPriority: 'EXPIRING_FIRST'
    },
    engagement: {
      showSavings: true, showBreakEvenProgress: true,
      expirationReminderDays: [30, 14, 7, 1], referralEnabled: false,
      renewalBonusEnabled: false, personalizedRecommendationsEnabled: false
    },
    analytics: {
      trackRevenue: true, trackRefunds: true, trackBreakage: true, trackMargin: true,
      trackPeakLoad: true, trackChurn: true, trackCohorts: true, attributionTag: null
    }
  },
  createdAt: '2026-08-20T12:05:00.000Z',
  createdBy: 'admin:global',
  idempotency: {
    actorId: 'admin:global', key: 'create-piter-policy-v1', requestHash: HASH,
    correlationId: 'corr:create-policy'
  }
});

const candidatePolicyFixture = (scope: 'PITER' | 'HUB'): StoredSubscriptionPolicyVersion => {
  const candidate = buildManagedAnnualSubscriptionV2Candidate(scope);
  return {
    schemaVersion: 3,
    modelVersion: 3,
    subscriptionTypeId: candidate.subscriptionTypeId,
    version: candidate.expectedNextVersion,
    revision: 1,
    status: 'DRAFT',
    ...candidate.request,
    providerBinding: {
      ...candidate.request.providerBinding!,
      evidenceState: 'UNVERIFIED'
    },
    createdAt: '2026-08-22T00:00:00.000Z',
    createdBy: 'admin:global',
    idempotency: {
      actorId: 'admin:global', key: `candidate-${scope.toLowerCase()}-policy`, requestHash: HASH,
      correlationId: `corr:candidate-${scope.toLowerCase()}`
    }
  } as StoredSubscriptionPolicyVersion;
};

class FakeRepository {
  type = typeFixture();
  policies: StoredSubscriptionPolicyVersion[] = [policyFixture()];
  mappings: StoredSubscriptionProviderMapping[] = [];
  publications: StoredSubscriptionPolicyPublication[] = [];
  instanceCounts = new Map<number, number>();
  publishCalls = 0;
  commitThenDuplicate = false;
  commitThenPreconditionConflict = false;

  get policy(): StoredSubscriptionPolicyVersion {
    return this.policies.reduce((latest, row) => row.version > latest.version ? row : latest);
  }
  set policy(value: StoredSubscriptionPolicyVersion) { this.policies = [value]; }
  get mapping(): StoredSubscriptionProviderMapping | null { return this.mappings.at(-1) ?? null; }
  set mapping(value: StoredSubscriptionProviderMapping | null) {
    this.mappings = value ? [value] : [];
  }
  get publication(): StoredSubscriptionPolicyPublication | null {
    return this.publications.at(-1) ?? null;
  }
  set publication(value: StoredSubscriptionPolicyPublication | null) {
    this.publications = value ? [value] : [];
  }

  async connect(): Promise<void> {}
  async connectReadOnly(): Promise<void> {}
  isDuplicateKey(error: unknown): boolean { return (error as Error)?.message === 'DUPLICATE_KEY'; }
  async subscriptionTypeById(id: string) {
    return this.type.subscriptionTypeId === id ? structuredClone(this.type) : null;
  }
  async policyVersionByNumber(typeId: string, version: number) {
    const row = this.policies.find((item) => (
      item.subscriptionTypeId === typeId && item.version === version
    ));
    return row ? structuredClone(row) : null;
  }
  async runtimePolicyPublicationByVersion(typeId: string, version: number) {
    const row = this.publications.find((item) => (
      item.subscriptionTypeId === typeId && item.policyVersion === version
    ));
    return row ? structuredClone(row) : null;
  }
  async runtimePolicyPublicationByIdempotency(input: { actorId: string; key: string }) {
    const row = this.publications.find((item) => (
      item.idempotency?.actorId === input.actorId && item.idempotency.key === input.key
    ));
    return row ? structuredClone(row) : null;
  }
  async runtimeProviderMappingById(mappingId: string) {
    const row = this.mappings.find((item) => item.mappingId === mappingId);
    return row ? structuredClone(row) : null;
  }
  async countRuntimeInstancesByPolicy(_typeId: string, version: number) {
    return this.instanceCounts.get(version) ?? 0;
  }
  async runtimeProviderMappingByProviderIdentity(input: {
    tenantId: string; providerProductId: string; providerScopeKind: string; providerScopeId: string;
  }) {
    const row = this.mappings.find((item) => item.tenantId === input.tenantId
      && item.providerProductId === input.providerProductId
      && item.providerScope.kind === input.providerScopeKind
      && item.providerScope.scopeId === input.providerScopeId);
    return row ? structuredClone(row) : null;
  }
  async runtimeProviderMappingByIdempotency(input: { tenantId: string; actorId: string; key: string }) {
    const row = this.mappings.find((item) => item.tenantId === input.tenantId
      && item.idempotency.actorId === input.actorId
      && item.idempotency.key === input.key);
    return row ? structuredClone(row) : null;
  }
  async publishRuntimePolicy(input: {
    mapping: StoredSubscriptionProviderMapping;
    insertMapping: boolean;
    expectedMappingRevision: number | null;
    publication: StoredSubscriptionPolicyPublication;
    expectedTypeRevision: number;
    expectedPolicyRevision: number;
    previousPublicationId: string | null;
    previousPolicyVersion: number | null;
    expectedPreviousPolicyRevision: number | null;
  }) {
    this.publishCalls += 1;
    assert.equal(input.expectedTypeRevision, this.type.revision);
    assert.equal(input.expectedPolicyRevision, this.policy.revision);
    if (input.insertMapping) {
      assert.equal(input.expectedMappingRevision, null);
      this.mappings.push(structuredClone(input.mapping));
    } else {
      const mappingIndex = this.mappings.findIndex((item) => (
        item.mappingId === input.mapping.mappingId
      ));
      assert.ok(mappingIndex >= 0);
      assert.equal(this.mappings[mappingIndex].revision, input.expectedMappingRevision);
      this.mappings[mappingIndex] = structuredClone(input.mapping);
    }
    if (input.previousPublicationId) {
      const previousPublication = this.publications.find((item) => (
        item.publicationId === input.previousPublicationId
      ));
      const previousPolicy = this.policies.find((item) => (
        item.version === input.publication.policyVersion - 1
      ));
      assert.ok(previousPublication);
      assert.ok(previousPolicy);
      assert.equal(previousPolicy.revision, input.expectedPreviousPolicyRevision);
      previousPublication.state = 'SUPERSEDED';
      previousPublication.supersededAt = input.publication.publishedAt;
      previousPublication.supersededBy = input.publication.publicationId;
      previousPolicy.status = 'SUPERSEDED';
      previousPolicy.revision += 1;
    }
    this.publications.push(structuredClone(input.publication));
    this.type.state = 'ACTIVE';
    this.type.currentPolicyVersion = this.policy.version;
    this.type.revision += 1;
    this.policy.status = 'PUBLISHED';
    this.policy.revision += 1;
    if (this.commitThenDuplicate) throw new Error('DUPLICATE_KEY');
    if (this.commitThenPreconditionConflict) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_CAS_CONFLICT');
    }
  }
}

class FakeViva {
  calls = 0;
  async inspectSubscriptionProduct(input: { productId: string }) {
    this.calls += 1;
    return {
      provider: 'VIVA' as const,
      providerProductId: input.productId,
      name: 'Annual friendship',
      type: 'BY_VISITS',
      providerReportedCost: 5680000,
      costUnit: 'UNVERIFIED' as const,
      observedAt: `2026-08-21T12:00:${String(this.calls).padStart(2, '0')}.000Z`,
      evidenceRef: `evidence:viva-product:${'b'.repeat(64)}`
    };
  }
}

class FakeAudit {
  enabled = true;
  entries: Array<Record<string, unknown>> = [];
  isEnabled(): boolean { return this.enabled; }
  async appendAudit(entry: Record<string, unknown>): Promise<void> {
    this.entries.push(structuredClone(entry));
  }
}

const previewDto = () => ({
  providerStudioId: 'studio:piter',
  dictionaryRevision: 'dictionary:2026-08-21-r1',
  dictionaryEvidenceRef: `evidence:canonical-dictionary:${'c'.repeat(64)}`
});
const headers = (suffix = 'one') => ({
  idempotencyKey: `publish-subscription-${suffix.padEnd(16, 'x')}`,
  correlationId: `corr:publication-${suffix}`
});

const createService = (repository = new FakeRepository()) => {
  const viva = new FakeViva();
  const audit = new FakeAudit();
  const service = new SubscriptionPublicationService(
    repository as unknown as SubscriptionsRepository,
    viva as never,
    audit as never
  );
  return { service, repository, viva, audit };
};

async function verifyRepositoryTransaction(
  mapping: StoredSubscriptionProviderMapping,
  publication: StoredSubscriptionPolicyPublication
): Promise<void> {
  const repository = Object.create(SubscriptionsRepository.prototype) as any;
  let type = typeFixture();
  let policy = policyFixture();
  let mappings: StoredSubscriptionProviderMapping[] = [];
  let publications: StoredSubscriptionPolicyPublication[] = [];
  let fences: StoredSubscriptionProjectionFence[] = [];
  const session = { marker: 'publication-session' };
  repository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>) => {
        const before = {
          type: structuredClone(type), policy: structuredClone(policy),
          mappings: structuredClone(mappings), publications: structuredClone(publications),
          fences: structuredClone(fences)
        };
        try {
          await callback();
        } catch (error) {
          type = before.type;
          policy = before.policy;
          mappings = before.mappings;
          publications = before.publications;
          fences = before.fences;
          throw error;
        }
      },
      endSession: async () => undefined,
      ...session
    })
  };
  repository.types = () => ({
    findOne: async (_filter: unknown, options: { session?: unknown }) => {
      assert.ok(options.session);
      return structuredClone(type);
    },
    updateOne: async (filter: any, update: any, options: { session?: unknown }) => {
      assert.ok(options.session);
      if (filter.revision !== type.revision || type.state !== 'DRAFT') return { modifiedCount: 0 };
      type.state = update.$set.state;
      type.currentPolicyVersion = update.$set.currentPolicyVersion;
      type.updatedAt = update.$set.updatedAt;
      type.revision += update.$inc.revision;
      return { modifiedCount: 1 };
    }
  });
  repository.policies = () => ({
    findOne: async (_filter: unknown, options: { session?: unknown }) => {
      assert.ok(options.session);
      return structuredClone(policy);
    },
    updateOne: async (filter: any, update: any, options: { session?: unknown }) => {
      assert.ok(options.session);
      if (filter.revision !== policy.revision || policy.status !== 'DRAFT') return { modifiedCount: 0 };
      policy.status = update.$set.status;
      policy.revision += update.$inc.revision;
      return { modifiedCount: 1 };
    }
  });
  repository.runtimeMappings = () => ({
    insertOne: async (row: StoredSubscriptionProviderMapping, options: { session?: unknown }) => {
      assert.ok(options.session);
      mappings.push(structuredClone(row));
    }
  });
  repository.runtimePublications = () => ({
    insertOne: async (row: StoredSubscriptionPolicyPublication, options: { session?: unknown }) => {
      assert.ok(options.session);
      publications.push(structuredClone(row));
    }
  });
  repository.runtimeProjectionFences = () => ({
    findOne: async () => fences[0] ? structuredClone(fences[0]) : null,
    insertOne: async (row: StoredSubscriptionProjectionFence, options: { session?: unknown }) => {
      assert.ok(options.session);
      fences.push(structuredClone(row));
    }
  });

  await repository.publishRuntimePolicy({
    mapping: structuredClone(mapping),
    insertMapping: true,
    expectedMappingRevision: null,
    publication: structuredClone(publication),
    expectedTypeRevision: 1,
    expectedPolicyRevision: 1,
    previousPublicationId: null,
    previousPolicyVersion: null,
    expectedPreviousPolicyRevision: null
  });
  assert.equal(mappings.length, 1);
  assert.equal(publications.length, 1);
  assert.equal(type.state, 'ACTIVE');
  assert.equal(policy.status, 'PUBLISHED');
  assert.equal(fences.length, 1);
  assert.equal(fences[0].binding.publicationId, publication.publicationId);

  type = typeFixture();
  policy = policyFixture();
  mappings = [];
  publications = [];
  fences = [];
  await assert.rejects(
    repository.publishRuntimePolicy({
      mapping: structuredClone(mapping),
      insertMapping: true,
      expectedMappingRevision: null,
      publication: structuredClone(publication),
      expectedTypeRevision: 2,
      expectedPolicyRevision: 1,
      previousPublicationId: null,
      previousPolicyVersion: null,
      expectedPreviousPolicyRevision: null
    }),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT'
  );
  assert.equal(mappings.length, 0);
  assert.equal(publications.length, 0);
  assert.equal(type.state, 'DRAFT');
  assert.equal(policy.status, 'DRAFT');
}

async function verifyRepositorySupersessionTransaction(
  mapping: StoredSubscriptionProviderMapping,
  initialPublication: StoredSubscriptionPolicyPublication
): Promise<void> {
  const repository = Object.create(SubscriptionsRepository.prototype) as any;
  const initialType = {
    ...typeFixture(), state: 'ACTIVE' as const, currentPolicyVersion: 1, revision: 2
  };
  const oldPolicy = {
    ...policyFixture(), status: 'PUBLISHED' as const, revision: 2
  };
  const newPolicy = {
    ...policyFixture(), version: 2, status: 'DRAFT' as const, revision: 1,
    effectiveAt: new Date(Date.parse(initialPublication.effectiveAt) + 1).toISOString(),
    idempotency: {
      actorId: 'admin:global', key: 'create-v2-for-transaction', requestHash: HASH,
      correlationId: 'corr:create-v2-transaction'
    }
  };
  const newProjection = structuredClone(initialPublication.runtimeProjection);
  newProjection.policyVersion = 2;
  newProjection.effectiveAt = newPolicy.effectiveAt;
  const newPublication: StoredSubscriptionPolicyPublication = {
    ...structuredClone(initialPublication),
    schemaVersion: 3,
    publicationId: 'publication:supersession-v2',
    policyVersion: 2,
    effectiveAt: newPolicy.effectiveAt,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(newProjection),
    runtimeProjection: newProjection,
    publishedAt: new Date(Date.parse(initialPublication.publishedAt) + 1000).toISOString(),
    supersededAt: null,
    supersededBy: null,
    idempotency: {
      actorId: 'admin:global', key: 'publish-v2-for-transaction', requestHash: HASH,
      correlationId: 'corr:publish-v2-transaction'
    }
  };
  const refreshedMapping: StoredSubscriptionProviderMapping = {
    ...structuredClone(mapping),
    evidenceRef: `evidence:provider-mapping:${'e'.repeat(64)}`,
    verifiedAt: newPublication.publishedAt,
    verifiedBy: 'admin:global',
    revision: mapping.revision + 1,
    updatedAt: newPublication.publishedAt,
    updatedBy: 'admin:global'
  };
  let type = structuredClone(initialType);
  let policies = [structuredClone(oldPolicy), structuredClone(newPolicy)];
  let mappings = [structuredClone(mapping)];
  let publications = [structuredClone(initialPublication)];
  const initialFence = buildSubscriptionProjectionFence({
    mapping,
    publication: initialPublication,
    previous: null
  });
  let fences = [structuredClone(initialFence)];
  let failTypeCas = false;
  repository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>) => {
        const before = {
          type: structuredClone(type), policies: structuredClone(policies),
          mappings: structuredClone(mappings), publications: structuredClone(publications),
          fences: structuredClone(fences)
        };
        try {
          await callback();
        } catch (error) {
          type = before.type;
          policies = before.policies;
          mappings = before.mappings;
          publications = before.publications;
          fences = before.fences;
          throw error;
        }
      },
      endSession: async () => undefined
    })
  };
  repository.types = () => ({
    findOne: async () => structuredClone(type),
    updateOne: async (filter: any, update: any) => {
      if (failTypeCas
        || filter.revision !== type.revision
        || filter.state !== type.state
        || filter.currentPolicyVersion !== type.currentPolicyVersion) return { modifiedCount: 0 };
      type.state = update.$set.state;
      type.currentPolicyVersion = update.$set.currentPolicyVersion;
      type.updatedAt = update.$set.updatedAt;
      type.revision += update.$inc.revision;
      return { modifiedCount: 1 };
    }
  });
  repository.policies = () => ({
    findOne: async (filter: any) => {
      const row = policies.find((item) => item.version === filter.version);
      return row ? structuredClone(row) : null;
    },
    updateOne: async (filter: any, update: any) => {
      const row = policies.find((item) => item.version === filter.version);
      if (!row || row.status !== filter.status || row.revision !== filter.revision) {
        return { modifiedCount: 0 };
      }
      row.status = update.$set.status;
      row.revision += update.$inc.revision;
      return { modifiedCount: 1 };
    }
  });
  repository.runtimeMappings = () => ({
    findOne: async (filter: any) => {
      const row = mappings.find((item) => item.mappingId === filter.mappingId);
      return row ? structuredClone(row) : null;
    },
    insertOne: async (row: StoredSubscriptionProviderMapping) => {
      mappings.push(structuredClone(row));
    },
    updateOne: async (filter: any, update: any) => {
      const row = mappings.find((item) => item.mappingId === filter.mappingId);
      if (!row || row.state !== filter.state || row.revision !== filter.revision) {
        return { modifiedCount: 0 };
      }
      Object.assign(row, update.$set);
      row.revision += update.$inc.revision;
      return { modifiedCount: 1 };
    }
  });
  repository.runtimePublications = () => ({
    findOne: async (filter: any) => {
      const row = publications.find((item) => item.publicationId === filter.publicationId);
      return row ? structuredClone(row) : null;
    },
    insertOne: async (row: StoredSubscriptionPolicyPublication) => {
      publications.push(structuredClone(row));
    },
    updateOne: async (filter: any, update: any) => {
      const row = publications.find((item) => item.publicationId === filter.publicationId);
      if (!row || row.state !== filter.state || row.supersededAt !== null || row.supersededBy !== null) {
        return { modifiedCount: 0 };
      }
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    }
  });
  repository.runtimeProjectionFences = () => ({
    findOne: async () => fences[0] ? structuredClone(fences[0]) : null,
    insertOne: async (row: StoredSubscriptionProjectionFence) => {
      fences.push(structuredClone(row));
    },
    updateOne: async (filter: any, update: any) => {
      const row = fences[0];
      if (!row
        || row.fenceId !== filter.fenceId
        || row.bindingRevision !== filter.bindingRevision
        || row.coordinationRevision !== filter.coordinationRevision
        || row.bindingDigest !== filter.bindingDigest) return { modifiedCount: 0 };
      Object.assign(row, structuredClone(update.$set));
      return { modifiedCount: 1 };
    }
  });

  const publish = (publication = newPublication) => repository.publishRuntimePolicy({
    mapping: structuredClone(refreshedMapping),
    insertMapping: false,
    expectedMappingRevision: mapping.revision,
    publication: structuredClone(publication),
    expectedTypeRevision: 2,
    expectedPolicyRevision: 1,
    previousPublicationId: initialPublication.publicationId,
    previousPolicyVersion: 1,
    expectedPreviousPolicyRevision: 2
  });
  const overlappingPublication = structuredClone(newPublication);
  overlappingPublication.effectiveAt = initialPublication.effectiveAt;
  overlappingPublication.runtimeProjection.effectiveAt = initialPublication.effectiveAt;
  overlappingPublication.policyDigest = computeSubscriptionRuntimeProjectionDigest(
    overlappingPublication.runtimeProjection
  );
  policies[1].effectiveAt = initialPublication.effectiveAt;
  await assert.rejects(
    publish(overlappingPublication),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT'
  );
  policies[1].effectiveAt = newPolicy.effectiveAt;
  await publish();
  assert.equal(type.currentPolicyVersion, 2);
  assert.equal(policies[0].status, 'SUPERSEDED');
  assert.equal(policies[1].status, 'PUBLISHED');
  assert.equal(publications[0].state, 'SUPERSEDED');
  assert.equal(publications[0].supersededBy, newPublication.publicationId);
  assert.equal(publications[1].state, 'PUBLISHED');
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].revision, refreshedMapping.revision);
  assert.equal(mappings[0].evidenceRef, refreshedMapping.evidenceRef);
  assert.equal(fences[0].bindingRevision, 2);
  assert.equal(fences[0].binding.publicationId, newPublication.publicationId);

  type = structuredClone(initialType);
  policies = [structuredClone(oldPolicy), structuredClone(newPolicy)];
  mappings = [structuredClone(mapping)];
  publications = [structuredClone(initialPublication)];
  fences = [];
  await publish();
  assert.equal(fences.length, 1);
  assert.equal(fences[0].bindingRevision, 1);
  assert.equal(fences[0].binding.publicationId, newPublication.publicationId);

  type = structuredClone(initialType);
  policies = [structuredClone(oldPolicy), structuredClone(newPolicy)];
  mappings = [structuredClone(mapping)];
  publications = [structuredClone(initialPublication)];
  fences = [structuredClone(initialFence)];
  fences[0].binding.mappingRevision += 1;
  fences[0].bindingDigest = subscriptionProjectionFenceBindingDigest(fences[0].binding);
  await assert.rejects(
    publish,
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_FENCE_CONFLICT'
  );
  assert.deepEqual(mappings, [mapping]);
  assert.deepEqual(publications, [initialPublication]);

  type = structuredClone(initialType);
  policies = [structuredClone(oldPolicy), structuredClone(newPolicy)];
  mappings = [structuredClone(mapping)];
  publications = [structuredClone(initialPublication)];
  fences = [structuredClone(initialFence)];
  failTypeCas = true;
  await assert.rejects(
    publish,
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_CAS_CONFLICT'
  );
  assert.deepEqual(type, initialType);
  assert.deepEqual(policies, [oldPolicy, newPolicy]);
  assert.deepEqual(publications, [initialPublication]);
  assert.equal(mappings.length, 1);

  const createdMapping: StoredSubscriptionProviderMapping = {
    ...structuredClone(mapping),
    mappingId: 'mapping:supersession-v2-new-product',
    providerProductId: 'product:piter-friendship-v2',
    revision: 1,
    evidenceRef: `evidence:provider-mapping:${'f'.repeat(64)}`,
    verifiedAt: newPublication.publishedAt,
    updatedAt: newPublication.publishedAt,
    idempotency: {
      actorId: 'admin:global', key: 'publish-v2-new-mapping', requestHash: HASH,
      correlationId: 'corr:publish-v2-new-mapping'
    }
  };
  const createdMappingPublication = {
    ...structuredClone(newPublication),
    publicationId: 'publication:supersession-v2-new-mapping',
    mappingId: createdMapping.mappingId,
    idempotency: {
      actorId: 'admin:global', key: 'publish-v2-new-mapping', requestHash: HASH,
      correlationId: 'corr:publish-v2-new-mapping'
    }
  };
  type = structuredClone(initialType);
  policies = [structuredClone(oldPolicy), structuredClone(newPolicy)];
  mappings = [structuredClone(mapping)];
  publications = [structuredClone(initialPublication)];
  fences = [structuredClone(initialFence)];
  failTypeCas = true;
  await assert.rejects(
    repository.publishRuntimePolicy({
      mapping: createdMapping,
      insertMapping: true,
      expectedMappingRevision: null,
      publication: createdMappingPublication,
      expectedTypeRevision: 2,
      expectedPolicyRevision: 1,
      previousPublicationId: initialPublication.publicationId,
      previousPolicyVersion: 1,
      expectedPreviousPolicyRevision: 2
    }),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_CAS_CONFLICT'
  );
  assert.deepEqual(type, initialType);
  assert.deepEqual(policies, [oldPolicy, newPolicy]);
  assert.deepEqual(publications, [initialPublication]);
  assert.deepEqual(mappings, [mapping]);
}

async function expectException(action: () => Promise<unknown>, type: Function): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof (type as new (...args: never[]) => Error));
    return error;
  }
  assert.fail(`Expected ${type.name}`);
}

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PUBLICATION_PREVIEW_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION = 'LK_NODE_RED_ANNUAL_BOOKING_V1';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:iSkq6G';
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID = 'client:synthetic-preview';

  assert.doesNotThrow(() => assertPolicySupportedByPublicationAdapter(
    LK_NODE_RED_ANNUAL_BOOKING_V1,
    candidatePolicyFixture('PITER')
  ));
  assert.doesNotThrow(() => assertPolicySupportedByPublicationAdapter(
    LK_NODE_RED_ANNUAL_BOOKING_V1,
    candidatePolicyFixture('HUB')
  ));

  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.previewPublication),
    ['subscriptions:publication:write']
  );
  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.publishPolicy),
    ['subscriptions:publication:write']
  );
  assert.equal(
    Reflect.getMetadata(
      SKIP_ADMIN_MUTATION_AUDIT_KEY,
      SubscriptionsController.prototype.previewPublication
    ),
    true
  );
  assert.equal(
    Reflect.getMetadata(
      SKIP_ADMIN_MUTATION_AUDIT_KEY,
      SubscriptionsController.prototype.publishPolicy
    ),
    undefined
  );
  const invalidDto = plainToInstance(PublishSubscriptionPolicyDto, {
    ...previewDto(),
    dictionaryEvidenceRef: 'raw-provider-payload',
    expectedPolicyDigest: HASH,
    expectedImpactPreviewRef: `impact:subscription-publication:${HASH}`,
    approvalReason: 'too short'
  });
  assert.ok((await validate(invalidDto)).length >= 3);

  const context = createService();
  const preview = await context.service.preview(
    context.repository.type.subscriptionTypeId,
    '1',
    previewDto(),
    globalAdmin
  );
  assert.equal(preview.readOnly, true);
  assert.equal(preview.blocked, false);
  assert.deepEqual(preview.providerScope, {
    kind: 'STATION', scopeId: '1ea77cbf-bc36-49a1-96d6-f35c216a409b'
  });

  const expectAdapterBlocked = async (
    mutate: (policy: StoredSubscriptionPolicyVersion) => void,
    blocker: string
  ): Promise<void> => {
    const blocked = createService();
    mutate(blocked.repository.policy);
    const error = await expectException(
      () => blocked.service.preview(
        blocked.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
      ),
      ServiceUnavailableException
    ) as ServiceUnavailableException;
    const response = error.getResponse() as { code?: string; blockers?: string[] };
    assert.equal(response.code, 'SUBSCRIPTIONS_PUBLICATION_ADAPTER_UNSUPPORTED');
    assert.ok(response.blockers?.includes(blocker));
    assert.equal(blocked.viva.calls, 0);
    assert.equal(blocked.repository.publishCalls, 0);
  };

  await expectAdapterBlocked((policy) => {
    policy.capabilities.usage.weeklyUsageLimit = 2;
  }, 'USAGE_COUNTER_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.capabilities.usage.blackoutDates = ['2026-09-01'];
  }, 'BLACKOUT_DATES_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.activeServicesLimit = { enabled: true, max: 1, scope: 'SUBSCRIPTION_BENEFIT_ONLY' };
  }, 'ACTIVE_SERVICES_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.stationAccessRules![0].selector = {
      kind: 'STATION_LIST',
      stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b', '0d5504f6-ea6f-44bb-a9e4-947faf0273ab']
    };
  }, 'STATION_SCOPE_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.capabilities.lifecycle.activationMode = 'FIXED_DATE';
  }, 'LIFECYCLE_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.benefitRules.push({
      ...structuredClone(policy.benefitRules[0]),
      ruleId: 'benefit-rule:group-training',
      category: 'GROUP_TRAINING',
      actions: ['BOOK_GROUP_TRAINING']
    });
  }, 'BENEFIT_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.benefitRules.push({
      ...structuredClone(policy.benefitRules[0]),
      ruleId: 'benefit-rule:create-duplicate'
    });
  }, 'BENEFIT_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.benefitRules[0].externalEventTypeIds = ['viva:direction:other:type:other'];
  }, 'BENEFIT_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.benefitRules[0].productTypeIds = ['product-type:other'];
  }, 'BENEFIT_UNSUPPORTED');
  await expectAdapterBlocked((policy) => {
    policy.providerBinding!.externalId = '00000000-0000-4000-8000-000000000000';
  }, 'PROVIDER_PRODUCT_UNSUPPORTED');

  const missingAdapter = createService();
  delete process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION;
  const missingAdapterError = await expectException(
    () => missingAdapter.service.preview(
      missingAdapter.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
    ),
    ServiceUnavailableException
  ) as ServiceUnavailableException;
  assert.deepEqual(missingAdapterError.getResponse(), {
    code: 'SUBSCRIPTIONS_PUBLICATION_ADAPTER_UNSUPPORTED',
    message: 'Subscription policy is not supported by the configured booking enforcement adapter',
    adapterVersion: null,
    blockers: ['ADAPTER_VERSION_REQUIRED']
  });
  assert.equal(missingAdapter.viva.calls, 0);
  const missingAdapterCommand = await expectException(
    () => missingAdapter.service.publish(
      missingAdapter.repository.type.subscriptionTypeId,
      '1',
      {
        ...previewDto(),
        expectedPolicyDigest: `sha256:${HASH}`,
        expectedImpactPreviewRef: `impact:subscription-publication:${HASH}`,
        approvalReason: 'Missing adapter must block publication before any write'
      },
      headers('adapter-missing'),
      globalAdmin
    ),
    ServiceUnavailableException
  ) as ServiceUnavailableException;
  assert.equal(
    (missingAdapterCommand.getResponse() as { code?: string }).code,
    'SUBSCRIPTIONS_PUBLICATION_ADAPTER_UNSUPPORTED'
  );
  assert.equal(missingAdapter.repository.publishCalls, 0);
  const unauthorizedWithoutAdapter = createService();
  const unauthorizedError = await expectException(
    () => unauthorizedWithoutAdapter.service.preview(
      unauthorizedWithoutAdapter.repository.type.subscriptionTypeId, '1', previewDto()
    ),
    UnauthorizedException
  );
  assert.equal(unauthorizedWithoutAdapter.viva.calls, 0);
  process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION = 'UNKNOWN_ADAPTER';
  const unknownAdapter = createService();
  const unknownAdapterError = await expectException(
    () => unknownAdapter.service.preview(
      unknownAdapter.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
    ),
    ServiceUnavailableException
  ) as ServiceUnavailableException;
  const unknownResponse = unknownAdapterError.getResponse() as { code?: string; blockers?: string[] };
  assert.equal(unknownResponse.code, 'SUBSCRIPTIONS_PUBLICATION_ADAPTER_UNSUPPORTED');
  assert.deepEqual(unknownResponse.blockers, ['ADAPTER_VERSION_UNKNOWN']);
  assert.equal(unknownAdapter.viva.calls, 0);
  process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION = 'LK_NODE_RED_ANNUAL_BOOKING_V1';
  assert.match(preview.policyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(preview.runtimeCompatibility, {
    adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
    contractVersion: 1,
    capabilityDigest: LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_DIGEST
  });
  assert.equal(
    LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_DIGEST,
    'sha256:f1e00751ba2ef19b1945964f2ee90d2d88dbf11121fdb75dfe573b6b12f31791'
  );
  assert.equal(Object.isFrozen(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST), true);
  assert.equal(Object.isFrozen(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST.usage), true);
  assert.equal(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST.runtimeSchemaVersion, 1);
  assert.deepEqual(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST.usage.blackoutDates, []);
  assert.equal(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST.benefit.enabledRuleCount, 2);
  assert.equal(LK_REGIONAL_BOOKING_GATEWAY_CAPABILITY_MANIFEST.benefit.exactlyOnePerAction, true);
  assert.match(preview.impactPreviewRef, /^impact:subscription-publication:[a-f0-9]{64}$/);
  assert.equal(preview.publicationMode, 'INITIAL');
  assert.equal(preview.providerMappingMode, 'CREATE');
  assert.equal(preview.supersedes, null);
  assert.deepEqual(preview.instanceImpact, {
    applyTo: 'NEW_ONLY', existingInstanceCount: 0, migrationRequired: false
  });
  assert.equal(context.repository.mapping, null);
  assert.equal(context.repository.publication, null);

  const published = await context.service.publish(
    context.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: preview.policyDigest,
      expectedImpactPreviewRef: preview.impactPreviewRef,
      approvalReason: 'Approved exact Piter annual policy and provider mapping'
    },
    headers(),
    globalAdmin
  );
  assert.equal(published.replayed, false);
  assert.equal(published.item.mapping.state, 'VERIFIED');
  assert.equal('idempotency' in published.item.mapping, false);
  assert.equal(published.item.publication.state, 'PUBLISHED');
  assert.equal(published.item.publication.mappingId, published.item.mapping.mappingId);
  assert.equal(published.item.publication.policyDigest, preview.policyDigest);
  assert.equal(published.item.publication.schemaVersion, 3);
  assert.deepEqual(published.item.publication.runtimeCompatibility, preview.runtimeCompatibility);
  assert.equal(published.item.publication.idempotency?.key, headers().idempotencyKey);
  assert.equal(context.repository.type.state, 'ACTIVE');
  assert.equal(context.repository.policy.status, 'PUBLISHED');
  assert.equal(context.repository.publishCalls, 1);
  assert.equal(context.audit.entries.length, 1);
  assert.equal(context.audit.entries[0].action, 'SUBSCRIPTION_POLICY_PUBLICATION_APPROVED');
  const metadata = context.audit.entries[0].metadata as Record<string, unknown>;
  assert.equal(metadata.impactPreviewRef, preview.impactPreviewRef);
  assert.equal(metadata.runtimeAdapterId, 'LK_REGIONAL_BOOKING_GATEWAY');
  assert.equal(metadata.runtimeContractVersion, 1);
  assert.equal(metadata.runtimeCapabilityDigest, preview.runtimeCompatibility.capabilityDigest);
  assert.equal(metadata.dictionaryEvidenceRef, previewDto().dictionaryEvidenceRef);
  assert.notEqual(metadata.idempotencyKeyHash, headers().idempotencyKey);
  assert.ok(context.repository.mapping);
  assert.ok(context.repository.publication);
  await verifyRepositoryTransaction(
    context.repository.mapping,
    context.repository.publication
  );
  await verifyRepositorySupersessionTransaction(
    context.repository.mapping,
    context.repository.publication
  );

  const vivaCallsBeforeReplay = context.viva.calls;
  const replay = await context.service.publish(
    context.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: preview.policyDigest,
      expectedImpactPreviewRef: preview.impactPreviewRef,
      approvalReason: 'Approved exact Piter annual policy and provider mapping'
    },
    headers(),
    globalAdmin
  );
  assert.equal(replay.replayed, true);
  assert.equal(context.viva.calls, vivaCallsBeforeReplay);
  assert.equal(context.audit.entries.length, 1);
  process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION = 'UNKNOWN_ADAPTER';
  const replayWithoutCurrentAdapter = await context.service.publish(
    context.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: preview.policyDigest,
      expectedImpactPreviewRef: preview.impactPreviewRef,
      approvalReason: 'Approved exact Piter annual policy and provider mapping'
    },
    headers(),
    globalAdmin
  );
  assert.equal(replayWithoutCurrentAdapter.replayed, true);
  assert.equal(context.viva.calls, vivaCallsBeforeReplay);
  assert.equal(context.audit.entries.length, 1);
  const storedPublication = context.repository.publications[0];
  assert.ok(storedPublication);
  storedPublication.schemaVersion = 2;
  delete storedPublication.runtimeCompatibility;
  const legacyReplay = await context.service.publish(
    context.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: preview.policyDigest,
      expectedImpactPreviewRef: preview.impactPreviewRef,
      approvalReason: 'Approved exact Piter annual policy and provider mapping'
    },
    headers(),
    globalAdmin
  );
  assert.equal(legacyReplay.replayed, true);
  assert.equal(legacyReplay.item.publication.schemaVersion, 2);
  assert.equal(context.viva.calls, vivaCallsBeforeReplay);
  process.env.SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION = 'LK_NODE_RED_ANNUAL_BOOKING_V1';
  await expectException(
    () => context.service.publish(
      context.repository.type.subscriptionTypeId,
      '1',
      {
        ...previewDto(),
        expectedPolicyDigest: preview.policyDigest,
        expectedImpactPreviewRef: preview.impactPreviewRef,
        approvalReason: 'Different approval payload for the same idempotency key'
      },
      headers(),
      globalAdmin
    ),
    ConflictException
  );

  const supersession = createService();
  const supersessionV1Preview = await supersession.service.preview(
    supersession.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  await supersession.service.publish(
    supersession.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: supersessionV1Preview.policyDigest,
      expectedImpactPreviewRef: supersessionV1Preview.impactPreviewRef,
      approvalReason: 'Publish initial version before controlled supersession'
    },
    headers('supersession-v1'),
    globalAdmin
  );
  supersession.repository.mappings[0].verifiedAt = '2026-08-20T12:00:00.000Z';
  supersession.repository.mappings[0].updatedAt = '2026-08-20T12:00:00.000Z';
  const staleMappingEvidenceRef = supersession.repository.mappings[0].evidenceRef;
  const staleMappingRevision = supersession.repository.mappings[0].revision;
  const v2Draft: StoredSubscriptionPolicyVersion = {
    ...structuredClone(supersession.repository.policy),
    version: 2,
    revision: 1,
    status: 'DRAFT',
    createdAt: '2026-08-22T12:00:00.000Z',
    idempotency: {
      actorId: 'admin:global',
      key: 'create-piter-policy-v2',
      requestHash: 'd'.repeat(64),
      correlationId: 'corr:create-policy-v2'
    }
  };
  supersession.repository.policies.push(v2Draft);
  supersession.repository.instanceCounts.set(1, 7);
  await expectException(
    () => supersession.service.preview(
      supersession.repository.type.subscriptionTypeId, '2', previewDto(), globalAdmin
    ),
    UnprocessableEntityException
  );
  supersession.repository.policies[1].effectiveAt = '2026-08-20T20:59:59.999Z';
  await expectException(
    () => supersession.service.preview(
      supersession.repository.type.subscriptionTypeId, '2', previewDto(), globalAdmin
    ),
    UnprocessableEntityException
  );
  supersession.repository.policies[1].effectiveAt = '2026-08-20T21:00:00.001Z';
  const v2Preview = await supersession.service.preview(
    supersession.repository.type.subscriptionTypeId, '2', previewDto(), globalAdmin
  );
  assert.equal(v2Preview.publicationMode, 'SUPERSESSION');
  assert.equal(v2Preview.providerMappingMode, 'REUSE');
  assert.equal(v2Preview.supersedes?.policyVersion, 1);
  assert.deepEqual(v2Preview.instanceImpact, {
    applyTo: 'NEW_ONLY', existingInstanceCount: 7, migrationRequired: false
  });
  supersession.repository.instanceCounts.set(1, 8);
  await expectException(
    () => supersession.service.publish(
      supersession.repository.type.subscriptionTypeId,
      '2',
      {
        ...previewDto(),
        expectedPolicyDigest: v2Preview.policyDigest,
        expectedImpactPreviewRef: v2Preview.impactPreviewRef,
        approvalReason: 'Stale instance impact count must require a fresh preview'
      },
      headers('supersession-stale-count'),
      globalAdmin
    ),
    ConflictException
  );
  assert.equal(supersession.repository.publications.length, 1);
  assert.equal(supersession.audit.entries.length, 1);
  supersession.repository.instanceCounts.set(1, 7);
  const mappingIdBefore = supersession.repository.mapping?.mappingId;
  const v2Published = await supersession.service.publish(
    supersession.repository.type.subscriptionTypeId,
    '2',
    {
      ...previewDto(),
      expectedPolicyDigest: v2Preview.policyDigest,
      expectedImpactPreviewRef: v2Preview.impactPreviewRef,
      approvalReason: 'Publish NEW_ONLY supersession without migrating existing instances'
    },
    headers('supersession-v2'),
    globalAdmin
  );
  assert.equal(v2Published.item.mapping.mappingId, mappingIdBefore);
  assert.equal(supersession.repository.mappings.length, 1);
  assert.equal(v2Published.item.mapping.revision, staleMappingRevision + 1);
  assert.notEqual(v2Published.item.mapping.evidenceRef, staleMappingEvidenceRef);
  assert.notEqual(v2Published.item.mapping.verifiedAt, '2026-08-20T12:00:00.000Z');
  assert.equal(supersession.repository.publications.length, 2);
  assert.equal(supersession.repository.publications[0].state, 'SUPERSEDED');
  assert.equal(
    supersession.repository.publications[0].supersededBy,
    supersession.repository.publications[1].publicationId
  );
  assert.equal(supersession.repository.policies[0].status, 'SUPERSEDED');
  assert.equal(supersession.repository.policies[1].status, 'PUBLISHED');
  assert.equal(supersession.repository.type.currentPolicyVersion, 2);
  assert.equal(supersession.repository.instanceCounts.get(1), 7);
  const v2VivaCalls = supersession.viva.calls;
  const v2Replay = await supersession.service.publish(
    supersession.repository.type.subscriptionTypeId,
    '2',
    {
      ...previewDto(),
      expectedPolicyDigest: v2Preview.policyDigest,
      expectedImpactPreviewRef: v2Preview.impactPreviewRef,
      approvalReason: 'Publish NEW_ONLY supersession without migrating existing instances'
    },
    headers('supersession-v2'),
    globalAdmin
  );
  assert.equal(v2Replay.replayed, true);
  assert.equal(supersession.viva.calls, v2VivaCalls);

  const concurrentReuse = createService();
  const concurrentV1Preview = await concurrentReuse.service.preview(
    concurrentReuse.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  await concurrentReuse.service.publish(
    concurrentReuse.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: concurrentV1Preview.policyDigest,
      expectedImpactPreviewRef: concurrentV1Preview.impactPreviewRef,
      approvalReason: 'Publish initial version before reuse concurrency replay test'
    },
    headers('concurrent-reuse-v1'),
    globalAdmin
  );
  concurrentReuse.repository.policies.push({
    ...structuredClone(concurrentReuse.repository.policy),
    version: 2,
    revision: 1,
    status: 'DRAFT',
    effectiveAt: '2026-08-20T21:00:00.001Z',
    idempotency: {
      actorId: 'admin:global', key: 'create-concurrent-reuse-v2', requestHash: HASH,
      correlationId: 'corr:create-concurrent-reuse-v2'
    }
  });
  const concurrentV2Preview = await concurrentReuse.service.preview(
    concurrentReuse.repository.type.subscriptionTypeId, '2', previewDto(), globalAdmin
  );
  concurrentReuse.repository.commitThenPreconditionConflict = true;
  const concurrentReplay = await concurrentReuse.service.publish(
    concurrentReuse.repository.type.subscriptionTypeId,
    '2',
    {
      ...previewDto(),
      expectedPolicyDigest: concurrentV2Preview.policyDigest,
      expectedImpactPreviewRef: concurrentV2Preview.impactPreviewRef,
      approvalReason: 'Concurrent reuse CAS conflict must replay the committed command'
    },
    headers('concurrent-reuse-v2'),
    globalAdmin
  );
  assert.equal(concurrentReplay.replayed, true);
  assert.equal(concurrentReuse.repository.publications.length, 2);
  assert.equal(concurrentReuse.repository.type.currentPolicyVersion, 2);

  const newMappingSupersession = createService();
  const newMappingV1Preview = await newMappingSupersession.service.preview(
    newMappingSupersession.repository.type.subscriptionTypeId,
    '1',
    previewDto(),
    globalAdmin
  );
  await newMappingSupersession.service.publish(
    newMappingSupersession.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: newMappingV1Preview.policyDigest,
      expectedImpactPreviewRef: newMappingV1Preview.impactPreviewRef,
      approvalReason: 'Publish initial version before a new provider mapping supersession'
    },
    headers('new-mapping-v1'),
    globalAdmin
  );
  const originalMapping = structuredClone(newMappingSupersession.repository.mappings[0]);
  newMappingSupersession.repository.policies.push({
    ...policyFixture('HUB'),
    subscriptionTypeId: newMappingSupersession.repository.type.subscriptionTypeId,
    version: 2,
    revision: 1,
    status: 'DRAFT',
    effectiveAt: '2026-08-20T21:00:00.001Z',
    idempotency: {
      actorId: 'admin:global', key: 'create-new-mapping-policy-v2', requestHash: HASH,
      correlationId: 'corr:create-new-mapping-v2'
    }
  });
  newMappingSupersession.repository.instanceCounts.set(1, 3);
  const newMappingV2Preview = await newMappingSupersession.service.preview(
    newMappingSupersession.repository.type.subscriptionTypeId,
    '2',
    previewDto(),
    globalAdmin
  );
  assert.equal(newMappingV2Preview.publicationMode, 'SUPERSESSION');
  assert.equal(newMappingV2Preview.providerMappingMode, 'CREATE');
  const newMappingV2 = await newMappingSupersession.service.publish(
    newMappingSupersession.repository.type.subscriptionTypeId,
    '2',
    {
      ...previewDto(),
      expectedPolicyDigest: newMappingV2Preview.policyDigest,
      expectedImpactPreviewRef: newMappingV2Preview.impactPreviewRef,
      approvalReason: 'Publish supersession with a separately verified new provider product'
    },
    headers('new-mapping-v2'),
    globalAdmin
  );
  assert.equal(newMappingSupersession.repository.mappings.length, 2);
  assert.deepEqual(newMappingSupersession.repository.mappings[0], originalMapping);
  assert.notEqual(newMappingV2.item.mapping.mappingId, originalMapping.mappingId);
  assert.equal(newMappingV2.item.mapping.providerProductId, 'db7a5250-7369-4f43-8ac5-9111be24bc74');
  assert.equal(newMappingV2.item.publication.mappingId, newMappingV2.item.mapping.mappingId);
  assert.equal(newMappingSupersession.repository.publications[0].mappingId, originalMapping.mappingId);
  assert.equal(newMappingSupersession.repository.instanceCounts.get(1), 3);

  const migrationBlocked = createService();
  const migrationV1Preview = await migrationBlocked.service.preview(
    migrationBlocked.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  await migrationBlocked.service.publish(
    migrationBlocked.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: migrationV1Preview.policyDigest,
      expectedImpactPreviewRef: migrationV1Preview.impactPreviewRef,
      approvalReason: 'Publish initial version before migration rejection test'
    },
    headers('migration-v1'),
    globalAdmin
  );
  migrationBlocked.repository.policies.push({
    ...structuredClone(migrationBlocked.repository.policy),
    version: 2,
    revision: 1,
    status: 'DRAFT',
    effectiveAt: '2026-08-20T21:00:00.001Z',
    applyTo: 'ACTIVE_AND_NEW',
    idempotency: {
      actorId: 'admin:global', key: 'create-migration-v2', requestHash: HASH,
      correlationId: 'corr:migration-v2'
    }
  });
  const migrationError = await expectException(
    () => migrationBlocked.service.preview(
      migrationBlocked.repository.type.subscriptionTypeId, '2', previewDto(), globalAdmin
    ),
    UnprocessableEntityException
  ) as UnprocessableEntityException;
  assert.equal(
    (migrationError.getResponse() as { code?: string }).code,
    'SUBSCRIPTIONS_ACTIVE_INSTANCE_MIGRATION_UNSUPPORTED'
  );

  const hub = createService();
  hub.repository.type = {
    ...typeFixture(),
    subscriptionTypeId: 'subscription_type:hub-friendship-12m',
    code: 'friendship-12m-hub-2026',
    codeNorm: 'friendship-12m-hub-2026'
  };
  hub.repository.policy = policyFixture('HUB');
  const hubPreview = await hub.service.preview(
    hub.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  const expectedHubSetDigest = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, stationIds: HUB_STATION_IDS }))
    .digest('hex');
  assert.deepEqual(hubPreview.providerScope, {
    kind: 'STATION_SET', scopeId: `station-set:${expectedHubSetDigest}`
  });

  const reorderedHub = createService();
  reorderedHub.repository.type = structuredClone(hub.repository.type);
  reorderedHub.repository.policy = policyFixture('HUB');
  reorderedHub.repository.policy.stationAccessRules![0].selector = {
    kind: 'STATION_LIST', stationIds: [...HUB_STATION_IDS]
  };
  const reorderedHubPreview = await reorderedHub.service.preview(
    reorderedHub.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  assert.deepEqual(reorderedHubPreview.providerScope, hubPreview.providerScope);

  const mixedScope = createService();
  mixedScope.repository.policy.stationAccessRules!.push({
    ruleId: 'station-rule:unsupported-home', enabled: true, priority: 2,
    selector: { kind: 'HOME_STATION', stationIds: [] },
    surcharge: { kind: 'NONE', amountMinor: 0 }
  });
  const mixedScopeError = await expectException(
    () => mixedScope.service.preview(
      mixedScope.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
    ),
    UnprocessableEntityException
  ) as UnprocessableEntityException;
  assert.equal(
    (mixedScopeError.getResponse() as { code?: string }).code,
    'SUBSCRIPTIONS_PUBLICATION_STATION_SCOPE_UNSUPPORTED'
  );

  const incompletePolicy = createService();
  incompletePolicy.repository.policy.benefitRules = [];
  const incompleteError = await expectException(
    () => incompletePolicy.service.preview(
      incompletePolicy.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
    ),
    ServiceUnavailableException
  ) as ServiceUnavailableException;
  assert.equal(
    (incompleteError.getResponse() as { code?: string }).code,
    'SUBSCRIPTIONS_PUBLICATION_ADAPTER_UNSUPPORTED'
  );
  assert.equal(incompletePolicy.viva.calls, 0);
  assert.equal(incompletePolicy.repository.publishCalls, 0);

  const stale = createService();
  const stalePreview = await stale.service.preview(
    stale.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  await expectException(
    () => stale.service.publish(
      stale.repository.type.subscriptionTypeId,
      '1',
      {
        ...previewDto(),
        expectedPolicyDigest: `sha256:${'d'.repeat(64)}`,
        expectedImpactPreviewRef: stalePreview.impactPreviewRef,
        approvalReason: 'Stale digest must not publish any runtime state'
      },
      headers('stale'),
      globalAdmin
    ),
    ConflictException
  );
  assert.equal(stale.repository.publishCalls, 0);
  assert.equal(stale.audit.entries.length, 0);

  const noAudit = createService();
  noAudit.audit.enabled = false;
  const noAuditPreview = await noAudit.service.preview(
    noAudit.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  await expectException(
    () => noAudit.service.publish(
      noAudit.repository.type.subscriptionTypeId,
      '1',
      {
        ...previewDto(),
        expectedPolicyDigest: noAuditPreview.policyDigest,
        expectedImpactPreviewRef: noAuditPreview.impactPreviewRef,
        approvalReason: 'Publication must fail before mutation without durable audit'
      },
      headers('audit-off'),
      globalAdmin
    ),
    ServiceUnavailableException
  );
  assert.equal(noAudit.repository.publishCalls, 0);

  await expectException(
    () => createService().service.preview(
      typeFixture().subscriptionTypeId, '1', previewDto(), stationAdmin
    ),
    ForbiddenException
  );

  const raced = createService();
  raced.repository.commitThenDuplicate = true;
  const racedPreview = await raced.service.preview(
    raced.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
  );
  const racedResult = await raced.service.publish(
    raced.repository.type.subscriptionTypeId,
    '1',
    {
      ...previewDto(),
      expectedPolicyDigest: racedPreview.policyDigest,
      expectedImpactPreviewRef: racedPreview.impactPreviewRef,
      approvalReason: 'Concurrent replay must return the committed publication'
    },
    headers('race'),
    globalAdmin
  );
  assert.equal(racedResult.replayed, true);
  assert.equal(raced.repository.publishCalls, 1);

  const disabled = createService();
  process.env.SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED = 'false';
  await expectException(
    () => disabled.service.publish(
      disabled.repository.type.subscriptionTypeId,
      '1',
      {
        ...previewDto(),
        expectedPolicyDigest: `sha256:${HASH}`,
        expectedImpactPreviewRef: `impact:subscription-publication:${HASH}`,
        approvalReason: 'Disabled publication command must fail closed'
      },
      headers('disabled'),
      globalAdmin
    ),
    ServiceUnavailableException
  );

  console.log('subscriptions publication service tests: OK');
}

void main();
