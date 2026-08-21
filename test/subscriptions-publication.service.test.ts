import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SKIP_ADMIN_MUTATION_AUDIT_KEY } from '../src/common/observability/admin-audit.decorator';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { PublishSubscriptionPolicyDto } from '../src/subscriptions/dto/subscription-policy-publication.dto';
import { SubscriptionPublicationService } from '../src/subscriptions/subscription-publication.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { SubscriptionsController } from '../src/subscriptions/subscriptions.controller';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';

const HASH = 'a'.repeat(64);
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
      selector: { kind: 'ALL_STATIONS', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
  benefitRules: [{
    ruleId: 'benefit-rule:create-game',
    enabled: true,
    category: 'GAME',
    actions: ['CREATE_GAME'],
    externalEventTypeIds: ['event-type:padel-game'],
    productTypeIds: [],
    durationMinutes: [60],
    stationIds: scope === 'PITER'
      ? ['1ea77cbf-bc36-49a1-96d6-f35c216a409b']
      : ['station:hub-canonical'],
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
    externalEventTypeIds: ['event-type:padel-game'],
    productTypeIds: [],
    durationMinutes: [60, 90, 120],
    stationIds: scope === 'PITER'
      ? ['1ea77cbf-bc36-49a1-96d6-f35c216a409b']
      : ['station:hub-canonical'],
    kind: 'FREE_ENTITLEMENT',
    valueMinor: null,
    percentage: null,
    partialPrice: null,
    priority: 10
  }],
  providerBinding: {
    provider: 'VIVA',
    externalId: scope === 'PITER' ? 'product:piter-friendship' : 'product:hub-friendship',
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

class FakeRepository {
  type = typeFixture();
  policy = policyFixture();
  mapping: StoredSubscriptionProviderMapping | null = null;
  publication: StoredSubscriptionPolicyPublication | null = null;
  publishCalls = 0;
  commitThenDuplicate = false;

  async connect(): Promise<void> {}
  async connectReadOnly(): Promise<void> {}
  isDuplicateKey(error: unknown): boolean { return (error as Error)?.message === 'DUPLICATE_KEY'; }
  async subscriptionTypeById(id: string) {
    return this.type.subscriptionTypeId === id ? structuredClone(this.type) : null;
  }
  async policyVersionByNumber(typeId: string, version: number) {
    return this.policy.subscriptionTypeId === typeId && this.policy.version === version
      ? structuredClone(this.policy)
      : null;
  }
  async runtimePolicyPublicationByVersion(typeId: string, version: number) {
    return this.publication?.subscriptionTypeId === typeId && this.publication.policyVersion === version
      ? structuredClone(this.publication)
      : null;
  }
  async runtimeProviderMappingByProviderIdentity(input: {
    tenantId: string; providerProductId: string; providerScopeKind: string; providerScopeId: string;
  }) {
    if (!this.mapping) return null;
    return this.mapping.tenantId === input.tenantId
      && this.mapping.providerProductId === input.providerProductId
      && this.mapping.providerScope.kind === input.providerScopeKind
      && this.mapping.providerScope.scopeId === input.providerScopeId
      ? structuredClone(this.mapping)
      : null;
  }
  async runtimeProviderMappingByIdempotency(input: { tenantId: string; actorId: string; key: string }) {
    if (!this.mapping) return null;
    return this.mapping.tenantId === input.tenantId
      && this.mapping.idempotency.actorId === input.actorId
      && this.mapping.idempotency.key === input.key
      ? structuredClone(this.mapping)
      : null;
  }
  async publishRuntimePolicy(input: {
    mapping: StoredSubscriptionProviderMapping;
    publication: StoredSubscriptionPolicyPublication;
    expectedTypeRevision: number;
    expectedPolicyRevision: number;
  }) {
    this.publishCalls += 1;
    assert.equal(input.expectedTypeRevision, this.type.revision);
    assert.equal(input.expectedPolicyRevision, this.policy.revision);
    this.mapping = structuredClone(input.mapping);
    this.publication = structuredClone(input.publication);
    this.type.state = 'ACTIVE';
    this.type.currentPolicyVersion = this.policy.version;
    this.type.revision += 1;
    this.policy.status = 'PUBLISHED';
    this.policy.revision += 1;
    if (this.commitThenDuplicate) throw new Error('DUPLICATE_KEY');
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
      observedAt: '2026-08-21T12:00:00.000Z',
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
  const session = { marker: 'publication-session' };
  repository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>) => {
        const before = {
          type: structuredClone(type), policy: structuredClone(policy),
          mappings: structuredClone(mappings), publications: structuredClone(publications)
        };
        try {
          await callback();
        } catch (error) {
          type = before.type;
          policy = before.policy;
          mappings = before.mappings;
          publications = before.publications;
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

  await repository.publishRuntimePolicy({
    mapping: structuredClone(mapping),
    publication: structuredClone(publication),
    expectedTypeRevision: 1,
    expectedPolicyRevision: 1
  });
  assert.equal(mappings.length, 1);
  assert.equal(publications.length, 1);
  assert.equal(type.state, 'ACTIVE');
  assert.equal(policy.status, 'PUBLISHED');

  type = typeFixture();
  policy = policyFixture();
  mappings = [];
  publications = [];
  await assert.rejects(
    repository.publishRuntimePolicy({
      mapping: structuredClone(mapping),
      publication: structuredClone(publication),
      expectedTypeRevision: 2,
      expectedPolicyRevision: 1
    }),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT'
  );
  assert.equal(mappings.length, 0);
  assert.equal(publications.length, 0);
  assert.equal(type.state, 'DRAFT');
  assert.equal(policy.status, 'DRAFT');
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
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:iSkq6G';
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID = 'client:synthetic-preview';

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
  assert.match(preview.policyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(preview.impactPreviewRef, /^impact:subscription-publication:[a-f0-9]{64}$/);
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
  assert.equal(context.repository.type.state, 'ACTIVE');
  assert.equal(context.repository.policy.status, 'PUBLISHED');
  assert.equal(context.repository.publishCalls, 1);
  assert.equal(context.audit.entries.length, 1);
  assert.equal(context.audit.entries[0].action, 'SUBSCRIPTION_POLICY_PUBLICATION_APPROVED');
  const metadata = context.audit.entries[0].metadata as Record<string, unknown>;
  assert.equal(metadata.impactPreviewRef, preview.impactPreviewRef);
  assert.equal(metadata.dictionaryEvidenceRef, previewDto().dictionaryEvidenceRef);
  assert.notEqual(metadata.idempotencyKeyHash, headers().idempotencyKey);
  assert.ok(context.repository.mapping);
  assert.ok(context.repository.publication);
  await verifyRepositoryTransaction(
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
  assert.deepEqual(hubPreview.providerScope, { kind: 'TENANT', scopeId: 'tenant:iSkq6G' });

  const incompletePolicy = createService();
  incompletePolicy.repository.policy.benefitRules = [];
  const incompleteError = await expectException(
    () => incompletePolicy.service.preview(
      incompletePolicy.repository.type.subscriptionTypeId, '1', previewDto(), globalAdmin
    ),
    UnprocessableEntityException
  ) as UnprocessableEntityException;
  assert.equal(
    (incompleteError.getResponse() as { code?: string }).code,
    'SUBSCRIPTION_PUBLICATION_ENABLED_BENEFIT_REQUIRED'
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
