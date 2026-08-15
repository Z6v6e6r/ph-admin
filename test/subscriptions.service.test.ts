import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { SubscriptionsController } from '../src/subscriptions/subscriptions.controller';
import { CreatePolicyVersionDto } from '../src/subscriptions/dto/create-policy-version.dto';
import {
  SUBSCRIPTION_REQUIRED_INDEXES,
  subscriptionIndexMatches,
  SubscriptionsRepository
} from '../src/subscriptions/subscriptions.repository';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';

class InMemorySubscriptionsRepository {
  readonly types: StoredSubscriptionType[] = [];
  readonly policies: StoredSubscriptionPolicyVersion[] = [];
  readonly programs: StoredReleaseProgram[] = [];

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isDuplicateKey(error: unknown): boolean { return (error as Error)?.message === 'DUPLICATE_KEY'; }
  async subscriptionTypeById(id: string) { return this.types.find((row) => row.subscriptionTypeId === id) ?? null; }
  async subscriptionTypeByCodeNorm(code: string) { return this.types.find((row) => row.codeNorm === code) ?? null; }
  async subscriptionTypeByIdempotency(actorId: string, key: string) {
    return this.types.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async insertSubscriptionType(row: StoredSubscriptionType) {
    if (await this.subscriptionTypeByCodeNorm(row.codeNorm) || await this.subscriptionTypeByIdempotency(row.idempotency.actorId, row.idempotency.key)) throw new Error('DUPLICATE_KEY');
    this.types.push(structuredClone(row));
  }
  async listSubscriptionTypes(afterId: string | null, limit: number) {
    return this.types.filter((row) => !afterId || row.subscriptionTypeId > afterId).sort((a, b) => a.subscriptionTypeId.localeCompare(b.subscriptionTypeId)).slice(0, limit);
  }
  async policyByIdempotency(actorId: string, key: string) {
    return this.policies.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async latestPolicyVersion(typeId: string) {
    return Math.max(0, ...this.policies.filter((row) => row.subscriptionTypeId === typeId).map((row) => row.version));
  }
  async insertPolicyVersion(row: StoredSubscriptionPolicyVersion) {
    if (await this.policyByIdempotency(row.idempotency.actorId, row.idempotency.key) || this.policies.some((item) => item.subscriptionTypeId === row.subscriptionTypeId && item.version === row.version)) throw new Error('DUPLICATE_KEY');
    (row as StoredSubscriptionPolicyVersion & { _id?: string })._id = 'mongo-generated-id';
    this.policies.push(structuredClone(row));
  }
  async releaseProgramByIdempotency(actorId: string, key: string) {
    return this.programs.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async insertReleaseProgram(row: StoredReleaseProgram) {
    if (await this.releaseProgramByIdempotency(row.idempotency.actorId, row.idempotency.key)) throw new Error('DUPLICATE_KEY');
    this.programs.push(structuredClone(row));
  }
  async listReleasePrograms(input: { stationIds: string[] | null; stationId?: string; afterId: string | null; limit: number }) {
    return this.programs
      .filter((row) => !input.stationId || row.stationId === input.stationId)
      .filter((row) => input.stationId || input.stationIds === null || input.stationIds.includes(row.stationId))
      .filter((row) => !input.afterId || row.releaseProgramId > input.afterId)
      .sort((a, b) => a.releaseProgramId.localeCompare(b.releaseProgramId))
      .slice(0, input.limit);
  }
}

const globalAdmin: RequestUser = {
  id: 'admin:global',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  permissionStationScopes: {
    'subscriptions:read': null,
    'subscriptions:catalog:write': null,
    'subscriptions:release:write': null
  },
  stationIds: [],
  connectorRoutes: []
};

const stationAdmin: RequestUser = {
  id: 'admin:station-a',
  roles: [Role.STATION_ADMIN],
  permissions: ['subscriptions:read', 'subscriptions:release:write'],
  permissionStationScopes: {
    'subscriptions:read': ['station-a'],
    'subscriptions:release:write': ['station-a'],
    'subscriptions:catalog:write': ['station-a']
  },
  stationIds: ['station-a'],
  connectorRoutes: []
};

const command = (suffix: string) => ({
  idempotencyKey: `subscription-test-${suffix.padEnd(16, 'x')}`,
  correlationId: `corr-${suffix.padEnd(8, 'x')}`
});

const policyDraft = () => ({
  effectiveAt: '2026-08-12T00:00:00.000Z',
  applyTo: 'ACTIVE_AND_NEW' as const,
  validityDays: 365,
  createGame: { enabled: true, durationsMinutes: [60, 90, 120] as Array<60 | 90 | 120> },
  joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
  maxActiveServices: 3,
  bookingWindowDays: 4,
  dailyUsageLimit: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY' as const,
  usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
  benefitRules: []
});

const providerBindingDraft = () => ({
  provider: 'VIVA' as const,
  externalId: ' viva-annual-product-2026 ',
  referenceKind: 'PRODUCT_CANDIDATE' as const
});

const capabilitiesDraft = () => ({
  lifecycle: {
    activationMode: 'FIRST_USE' as const,
    activationWindowDays: 30,
    fixedActivationAt: null,
    fixedActivationTimeZone: 'Europe/Moscow' as const,
    gracePeriodDays: 3,
    allowBookingsAfterExpiry: false,
    freeze: {
      enabled: true,
      maxDaysPerYear: 30,
      maxPeriodsPerYear: 2,
      minDaysPerPeriod: 7,
      extendsValidity: true
    },
    adminExtension: { enabled: true, maxDays: 30, reasonRequired: true }
  },
  usage: {
    weeklyUsageLimit: 7,
    monthlyUsageLimit: 24,
    maxFutureBookings: 3,
    minHoursBetweenUses: 6,
    guestPassesPerMonth: 2,
    earlyBookingAccessHours: 24,
    waitlistPriority: true,
    crossStationMode: 'ALLOWED_WITH_SURCHARGE' as const,
    crossStationSurchargeMinor: 50000,
    blackoutDates: ['2027-01-01', '2026-12-31']
  },
  cancellation: {
    freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 48 },
    lateCancellationUsageUnits: 1,
    noShowUsageUnits: 1,
    noShowBlockDays: 7,
    stationCancellationRestoresUsage: true,
    reschedulePolicy: 'REVALIDATE' as const
  },
  commerce: {
    renewalMode: 'MANUAL' as const,
    renewalWindowDays: 30,
    priceLockEnabled: true,
    renewalDiscountPercent: 10,
    purchaseLimitPerClient: 1,
    reservationTtlMinutes: 15,
    waitlistWhenSoldOut: true,
    promoCodesAllowed: true,
    installmentsAllowed: false,
    upgradeDowngradeMode: 'PRORATED' as const,
    terminationRefundMode: 'PRORATED' as const,
    coolingOffDays: 14,
    giftable: true,
    transferable: false,
    familySeats: 4,
    corporateSeats: 1,
    maxConcurrentSubscriptions: 1,
    consumptionPriority: 'EXPIRING_FIRST' as const
  },
  engagement: {
    showSavings: true,
    showBreakEvenProgress: true,
    expirationReminderDays: [1, 30, 7, 14],
    referralEnabled: true,
    renewalBonusEnabled: true,
    personalizedRecommendationsEnabled: true
  },
  analytics: {
    trackRevenue: true,
    trackRefunds: true,
    trackBreakage: true,
    trackMargin: true,
    trackPeakLoad: true,
    trackChurn: true,
    trackCohorts: true,
    attributionTag: ' annual-launch-2026 '
  }
});

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
  const repository = new InMemorySubscriptionsRepository();
  const service = new SubscriptionsService(repository as unknown as SubscriptionsRepository);

  const typeResult = await service.createType(
    { code: 'annual-boiler', title: 'Годовая — котельники', description: 'Управляемый черновик' },
    command('type-a'),
    globalAdmin
  );
  assert.equal(typeResult.item.state, 'DRAFT');
  assert.equal(typeResult.item.currentPolicyVersion, null);
  assert.equal(repository.types.length, 1);

  const replay = await service.createType(
    { code: 'annual-boiler', title: 'Годовая — котельники', description: 'Управляемый черновик' },
    command('type-a'),
    globalAdmin
  );
  assert.equal(replay.item.subscriptionTypeId, typeResult.item.subscriptionTypeId);
  assert.equal(replay.replayed, true);
  assert.equal(repository.types.length, 1);

  await expectException(
    () => service.createType(
      { code: 'annual-boiler-2', title: 'Другой payload' },
      command('type-a'),
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createType(
      { code: 'annual-boiler', title: 'Дубликат кода' },
      command('type-b'),
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createType(
      { code: 'station-owned', title: 'Недопустимый station catalog' },
      command('type-c'),
      stationAdmin
    ),
    ForbiddenException
  );

  const policyOne = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    command('policy-a'),
    globalAdmin
  );
  const policyTwo = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    {
      ...policyDraft(),
      bookingWindowDays: 5,
      providerBinding: providerBindingDraft(),
      capabilities: capabilitiesDraft()
    },
    command('policy-b'),
    globalAdmin
  );
  assert.deepEqual([policyOne.item.version, policyTwo.item.version], [1, 2]);
  assert.equal(policyOne.item.maxActiveServices, 3);
  assert.equal(policyOne.item.dailyUsageLimit, 1);
  assert.equal(policyOne.item.modelVersion, 3);
  assert.deepEqual(policyOne.item.activeServicesLimit, {
    enabled: true,
    max: 3,
    scope: 'SUBSCRIPTION_BENEFIT_ONLY'
  });
  assert.deepEqual(policyOne.item.bookingWindow, { enabled: true, days: 4 });
  assert.equal('_id' in policyOne.item, false);
  assert.equal(policyOne.item.capabilities.lifecycle.activationMode, 'PURCHASE');
  assert.equal(policyOne.item.capabilities.lifecycle.freeze.enabled, false);
  assert.equal(policyOne.item.capabilities.commerce.reservationTtlMinutes, 15);
  assert.deepEqual(policyOne.item.capabilities.engagement.expirationReminderDays, [30, 14, 7, 1]);
  assert.equal(repository.policies[0].schemaVersion, 3);
  assert.equal(policyTwo.item.capabilities.lifecycle.activationMode, 'FIRST_USE');
  assert.deepEqual(policyTwo.item.capabilities.usage.blackoutDates, ['2026-12-31', '2027-01-01']);
  assert.equal(policyTwo.item.capabilities.usage.crossStationSurchargeMinor, 50000);
  assert.equal(policyTwo.item.capabilities.commerce.familySeats, 4);
  assert.equal(policyTwo.item.capabilities.analytics.attributionTag, 'annual-launch-2026');
  assert.deepEqual(policyTwo.item.providerBinding, {
    provider: 'VIVA',
    externalId: 'viva-annual-product-2026',
    referenceKind: 'PRODUCT_CANDIDATE',
    evidenceState: 'UNVERIFIED'
  });
  assert.deepEqual(repository.policies[1].providerBinding, policyTwo.item.providerBinding);
  assert.equal('providerBinding' in policyOne.item, false);

  const previousStored = repository.policies[1] as StoredSubscriptionPolicyVersion & {
    activeServicesLimit?: unknown;
    bookingWindow?: unknown;
    stationAccessRules?: unknown;
  };
  previousStored.schemaVersion = 2;
  previousStored.modelVersion = 2;
  delete previousStored.activeServicesLimit;
  delete previousStored.bookingWindow;
  delete previousStored.stationAccessRules;
  const previousDto = {
    ...policyDraft(),
    bookingWindowDays: 5,
    providerBinding: providerBindingDraft(),
    capabilities: capabilitiesDraft()
  };
  const normalizedPreviousPolicy = (service as unknown as {
    normalizePolicy(dto: typeof previousDto): unknown;
  }).normalizePolicy(previousDto);
  previousStored.idempotency.requestHash = (service as unknown as {
    previousPolicyShape(policy: unknown): unknown;
    requestHash(operation: string, payload: unknown): string;
  }).requestHash('createSubscriptionPolicyVersion', {
    subscriptionTypeId: typeResult.item.subscriptionTypeId,
    policy: (service as unknown as { previousPolicyShape(policy: unknown): unknown })
      .previousPolicyShape(normalizedPreviousPolicy)
  });
  const previousReplay = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    previousDto,
    command('policy-b'),
    globalAdmin
  );
  assert.equal(previousReplay.replayed, true);
  assert.equal(previousReplay.item.modelVersion, 2);
  assert.deepEqual(previousReplay.item.bookingWindow, { enabled: true, days: 5 });
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...previousDto,
        activeServicesLimit: {
          enabled: false,
          max: null,
          scope: 'SUBSCRIPTION_BENEFIT_ONLY'
        }
      },
      command('policy-b'),
      globalAdmin
    ),
    ConflictException
  );

  const legacyCommand = command('policy-legacy-v1');
  const legacyCreated = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    legacyCommand,
    globalAdmin
  );
  const legacyStored = repository.policies.find(
    (row) => row.version === legacyCreated.item.version
  ) as unknown as {
    schemaVersion: 1 | 2;
    modelVersion?: number;
    capabilities?: unknown;
    idempotency: { requestHash: string };
  };
  legacyStored.schemaVersion = 1;
  delete legacyStored.modelVersion;
  delete legacyStored.capabilities;
  const normalizedLegacyPolicy = (service as unknown as {
    normalizePolicy(dto: ReturnType<typeof policyDraft>): unknown;
    legacyPolicyShape(policy: unknown): unknown;
    requestHash(operation: string, payload: unknown): string;
  }).normalizePolicy(policyDraft());
  legacyStored.idempotency.requestHash = (service as unknown as {
    legacyPolicyShape(policy: unknown): unknown;
    requestHash(operation: string, payload: unknown): string;
  }).requestHash('createSubscriptionPolicyVersion', {
    subscriptionTypeId: typeResult.item.subscriptionTypeId,
    policy: (service as unknown as { legacyPolicyShape(policy: unknown): unknown })
      .legacyPolicyShape(normalizedLegacyPolicy)
  });
  const policyCountBeforeLegacyReplay = repository.policies.length;
  const legacyReplay = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    legacyCommand,
    globalAdmin
  );
  assert.equal(legacyReplay.replayed, true);
  assert.equal(repository.policies.length, policyCountBeforeLegacyReplay);
  assert.equal(legacyReplay.item.modelVersion, 2);
  assert.equal(legacyReplay.item.capabilities.lifecycle.activationMode, 'PURCHASE');
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), providerBinding: providerBindingDraft() },
      legacyCommand,
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        activeServicesLimit: {
          enabled: true,
          max: 3,
          scope: 'SUBSCRIPTION_BENEFIT_ONLY'
        }
      },
      legacyCommand,
      globalAdmin
    ),
    ConflictException
  );

  const policyReplay = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    command('policy-a'),
    globalAdmin
  );
  assert.equal(policyReplay.item.version, 1);
  assert.equal(policyReplay.replayed, true);
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), bookingWindowDays: 3 },
      command('policy-a'),
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), providerBinding: providerBindingDraft() },
      command('policy-a'),
      globalAdmin
    ),
    ConflictException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), createGame: { enabled: false, durationsMinutes: [60] } },
      command('policy-invalid'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        activeServicesLimit: {
          enabled: false,
          max: 3,
          scope: 'SUBSCRIPTION_BENEFIT_ONLY'
        }
      },
      command('policy-disabled-active-limit-with-value'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        bookingWindow: { enabled: false, days: 4 }
      },
      command('policy-disabled-booking-window-with-value'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        stationAccessRules: [{
          ruleId: 'home-with-explicit-station',
          enabled: true,
          priority: 100,
          selector: { kind: 'HOME_STATION', stationIds: ['station-a'] },
          surcharge: { kind: 'NONE', amountMinor: 0 }
        }]
      },
      command('policy-home-with-station-list'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        stationAccessRules: [{
          ruleId: 'home-with-hidden-surcharge',
          enabled: true,
          priority: 100,
          selector: { kind: 'HOME_STATION', stationIds: [] },
          surcharge: { kind: 'NONE', amountMinor: 100 }
        }]
      },
      command('policy-none-with-surcharge'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        stationAccessRules: [
          {
            ruleId: 'home-overlap',
            enabled: true,
            priority: 100,
            selector: { kind: 'HOME_STATION', stationIds: [] },
            surcharge: { kind: 'NONE', amountMinor: 0 }
          },
          {
            ruleId: 'list-overlap',
            enabled: true,
            priority: 100,
            selector: { kind: 'STATION_LIST', stationIds: ['station-a'] },
            surcharge: { kind: 'NONE', amountMinor: 0 }
          }
        ]
      },
      command('policy-station-overlap'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  const disabledBenefitsPolicy = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    {
      ...policyDraft(),
      stationAccessRules: [{
        ruleId: 'home',
        enabled: true,
        priority: 100,
        selector: { kind: 'HOME_STATION', stationIds: [] },
        surcharge: { kind: 'NONE', amountMinor: 0 }
      }],
      benefitRules: [{
        ruleId: 'game-disabled',
        enabled: false,
        category: 'GAME',
        actions: ['JOIN_GAME'],
        externalEventTypeIds: [],
        productTypeIds: [],
        durationMinutes: [],
        stationIds: [],
        kind: 'PERCENT_DISCOUNT',
        percentage: 0,
        priority: 100
      }]
    },
    command('policy-disabled-benefit'),
    globalAdmin
  );
  assert.equal(disabledBenefitsPolicy.item.benefitRules[0].enabled, false);

  const legacyBenefitPolicy = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    {
      ...policyDraft(),
      benefitRules: [{
        ruleId: 'legacy-game-discount',
        enabled: true,
        category: 'GAME',
        externalEventTypeIds: ['open-game'],
        stationIds: ['station-a'],
        kind: 'PERCENT_DISCOUNT',
        percentage: 10,
        priority: 100
      }]
    },
    command('policy-legacy-benefit'),
    globalAdmin
  );
  assert.deepEqual(legacyBenefitPolicy.item.benefitRules[0].actions, ['JOIN_GAME']);
  assert.deepEqual(legacyBenefitPolicy.item.benefitRules[0].durationMinutes, [60, 90, 120]);

  const managedPolicy = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    {
      ...policyDraft(),
      activeServicesLimit: {
        enabled: false,
        max: null,
        scope: 'SUBSCRIPTION_BENEFIT_ONLY'
      },
      bookingWindow: { enabled: false, days: null },
      stationAccessRules: [
        {
          ruleId: 'home-free',
          enabled: true,
          priority: 300,
          selector: { kind: 'HOME_STATION', stationIds: [] },
          surcharge: { kind: 'NONE', amountMinor: 0 }
        },
        {
          ruleId: 'selected-plus-150',
          enabled: true,
          priority: 200,
          selector: { kind: 'STATION_LIST', stationIds: ['station-b', 'station-a'] },
          surcharge: { kind: 'FIXED', amountMinor: 15000 }
        }
      ],
      benefitRules: [
        {
          ruleId: 'create-60-free',
          enabled: true,
          category: 'GAME',
          actions: ['CREATE_GAME'],
          externalEventTypeIds: ['open-game'],
          productTypeIds: [],
          durationMinutes: [60],
          stationIds: ['station-a'],
          kind: 'FREE_ENTITLEMENT',
          priority: 100
        },
        {
          ruleId: 'create-90-quarter-minus-20',
          enabled: true,
          category: 'GAME',
          actions: ['CREATE_GAME'],
          externalEventTypeIds: ['open-game'],
          productTypeIds: [],
          durationMinutes: [90],
          stationIds: ['station-a'],
          kind: 'PARTIAL_PRICE_PERCENT_DISCOUNT',
          percentage: 20,
          partialPrice: { numerator: 1, denominator: 4 },
          priority: 90
        },
        {
          ruleId: 'racket-discount',
          enabled: true,
          category: 'ADD_ON_PRODUCT',
          actions: ['PURCHASE_ADD_ON_PRODUCT'],
          externalEventTypeIds: ['rental-event'],
          productTypeIds: ['racket-rental'],
          durationMinutes: [60],
          stationIds: ['station-a'],
          kind: 'PERCENT_DISCOUNT',
          percentage: 10,
          priority: 80
        }
      ]
    },
    command('policy-managed-v3'),
    globalAdmin
  );
  assert.equal(managedPolicy.item.modelVersion, 3);
  assert.deepEqual(managedPolicy.item.activeServicesLimit, {
    enabled: false,
    max: null,
    scope: 'SUBSCRIPTION_BENEFIT_ONLY'
  });
  assert.deepEqual(managedPolicy.item.bookingWindow, { enabled: false, days: null });
  assert.deepEqual(
    managedPolicy.item.stationAccessRules?.[1].selector,
    { kind: 'STATION_LIST', stationIds: ['station-a', 'station-b'] }
  );
  assert.equal(
    managedPolicy.item.benefitRules.find((rule) => rule.ruleId === 'create-90-quarter-minus-20')
      ?.partialPrice?.denominator,
    4
  );
  assert.deepEqual(
    managedPolicy.item.benefitRules.find((rule) => rule.ruleId === 'racket-discount')
      ?.productTypeIds,
    ['racket-rental']
  );
  assert.throws(
    () => compileSubscriptionRuntimeProjection(managedPolicy.item),
    UnprocessableEntityException
  );
  const runtimeProjection = compileSubscriptionRuntimeProjection({
    ...managedPolicy.item,
    status: 'PUBLISHED'
  });
  assert.equal(runtimeProjection.runtimeSchemaVersion, 1);
  assert.deepEqual(runtimeProjection.bookingWindow, { enabled: false, days: null });
  assert.equal(
    runtimeProjection.benefitRules.find((rule) => rule.ruleId === 'create-90-quarter-minus-20')
      ?.kind,
    'PARTIAL_PRICE_PERCENT_DISCOUNT'
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        activeServicesLimit: {
          enabled: true,
          max: null,
          scope: 'SUBSCRIPTION_BENEFIT_ONLY'
        }
      },
      command('policy-active-limit-required'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        capabilities: {
          ...capabilitiesDraft(),
          lifecycle: {
            ...capabilitiesDraft().lifecycle,
            activationMode: 'FIXED_DATE',
            fixedActivationAt: null
          }
        }
      },
      command('policy-fixed-date'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      {
        ...policyDraft(),
        capabilities: {
          ...capabilitiesDraft(),
          usage: {
            ...capabilitiesDraft().usage,
            crossStationSurchargeMinor: 0
          }
        }
      },
      command('policy-surcharge'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  const shortLegacyPolicy = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    { ...policyDraft(), validityDays: 7 },
    command('policy-short-legacy'),
    globalAdmin
  );
  assert.deepEqual(
    shortLegacyPolicy.item.capabilities.engagement.expirationReminderDays,
    [7, 1]
  );

  const ladder = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [19800, 23800, 36000, 48000].map((rubles, index) => ({
        order: index + 1,
        mode: 'BULK' as const,
        totalQuantity: 50,
        price: { amountMinor: rubles * 100, currency: 'RUB' as const },
        activation: index === 0 ? 'MANUAL' as const : 'PREVIOUS_SOLD_OUT' as const
      }))
    },
    command('release-ladder'),
    stationAdmin
  );
  assert.equal(ladder.item.state, 'DRAFT');
  assert.deepEqual(ladder.item.phases.map((phase) => phase.price.amountMinor), [1980000, 2380000, 3600000, 4800000]);
  assert.ok(ladder.item.phases.every((phase) => Object.values(phase.counters).every((value) => value === 0)));
  const ladderReplay = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [19800, 23800, 36000, 48000].map((rubles, index) => ({
        order: index + 1,
        mode: 'BULK' as const,
        totalQuantity: 50,
        price: { amountMinor: rubles * 100, currency: 'RUB' as const },
        activation: index === 0 ? 'MANUAL' as const : 'PREVIOUS_SOLD_OUT' as const
      }))
    },
    command('release-ladder'),
    stationAdmin
  );
  assert.equal(ladderReplay.item.releaseProgramId, ladder.item.releaseProgramId);
  assert.equal(repository.programs.length, 1);

  const daily = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [{
        order: 1,
        mode: 'DAILY_DROP',
        totalQuantity: 100,
        dailyDropQuantity: 7,
        dailyDropLocalTime: '09:00',
        price: { amountMinor: 1980000, currency: 'RUB' },
        activation: 'MANUAL'
      }]
    },
    command('release-daily'),
    stationAdmin
  );
  assert.equal(daily.item.phases[0].dailyDropQuantity, 7);

  await expectException(
    () => service.createReleaseProgram(
      {
        subscriptionTypeId: typeResult.item.subscriptionTypeId,
        stationId: 'station-b',
        timezone: 'Europe/Moscow',
        phases: [{ order: 1, mode: 'BULK', totalQuantity: 1, price: { amountMinor: 100, currency: 'RUB' }, activation: 'MANUAL' }]
      },
      command('release-forbidden'),
      stationAdmin
    ),
    ForbiddenException
  );

  const scopedPrograms = await service.listReleasePrograms(undefined, undefined, stationAdmin);
  assert.equal(scopedPrograms.items.length, 2);
  assert.ok(scopedPrograms.items.every((program) => program.stationId === 'station-a'));

  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.createType),
    ['subscriptions:catalog:write']
  );
  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.createReleaseProgram),
    ['subscriptions:release:write']
  );

  const expectedIndex = SUBSCRIPTION_REQUIRED_INDEXES.types[1];
  assert.equal(subscriptionIndexMatches({ ...expectedIndex }, expectedIndex), true);
  assert.equal(subscriptionIndexMatches({ ...expectedIndex, unique: false }, expectedIndex), false);
  assert.equal(subscriptionIndexMatches({ ...expectedIndex, key: { codeNorm: -1 } }, expectedIndex), false);
  let initializationCount = 0;
  const repositoryWithColdStart = Object.create(SubscriptionsRepository.prototype) as any;
  repositoryWithColdStart.initialize = async () => {
    initializationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    repositoryWithColdStart.db = {};
  };
  await Promise.all([
    repositoryWithColdStart.connect(),
    repositoryWithColdStart.connect(),
    repositoryWithColdStart.connect()
  ]);
  assert.equal(initializationCount, 1);

  const validV2Dto = plainToInstance(CreatePolicyVersionDto, {
    ...policyDraft(),
    providerBinding: providerBindingDraft(),
    capabilities: capabilitiesDraft()
  });
  assert.deepEqual(await validate(validV2Dto), []);
  const clientInstanceInPolicyDto = plainToInstance(CreatePolicyVersionDto, {
    ...policyDraft(),
    providerBinding: {
      ...providerBindingDraft(),
      clientSubscriptionId: 'client-instance-must-not-be-stored'
    }
  });
  const clientInstanceErrors = await validate(clientInstanceInPolicyDto, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(clientInstanceErrors.some((error) => error.property === 'providerBinding'));
  const blankProviderBindingDto = plainToInstance(CreatePolicyVersionDto, {
    ...policyDraft(),
    providerBinding: {
      provider: 'VIVA',
      externalId: '   ',
      referenceKind: 'PRODUCT_CANDIDATE'
    }
  });
  const blankProviderBindingErrors = await validate(blankProviderBindingDto);
  assert.ok(blankProviderBindingErrors.some((error) => error.property === 'providerBinding'));
  const invalidV2Dto = plainToInstance(CreatePolicyVersionDto, {
    ...policyDraft(),
    capabilities: {
      ...capabilitiesDraft(),
      usage: { ...capabilitiesDraft().usage, blackoutDates: ['2026-02-30'] },
      commerce: { ...capabilitiesDraft().commerce, reservationTtlMinutes: 0 }
    }
  });
  const invalidV2Errors = await validate(invalidV2Dto);
  assert.ok(invalidV2Errors.some((error) => error.property === 'capabilities'));

  const filter = new SubscriptionsExceptionFilter();
  const filterHeaders: Record<string, string> = {};
  let filterStatus = 0;
  let filterPayload: any = null;
  const response = {
    setHeader: (name: string, value: string) => { filterHeaders[name] = value; },
    status: (value: number) => { filterStatus = value; return response; },
    json: (value: unknown) => { filterPayload = value; return response; }
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-correlation-id': 'corr-auth-test' }, user: undefined }),
      getResponse: () => response
    })
  };
  filter.catch(new ForbiddenException('Forbidden resource'), host as never);
  assert.equal(filterStatus, 401);
  assert.equal(filterPayload.error.code, 'AUTH_REQUIRED');
  assert.equal(filterPayload.error.correlationId, 'corr-auth-test');
  assert.equal(filterPayload.error.retryable, false);
  assert.equal(filterHeaders['X-Correlation-Id'], 'corr-auth-test');
  console.log('subscriptions.service.test.ts: OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
