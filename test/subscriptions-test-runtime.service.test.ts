import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import {
  SubscriptionsController,
  SubscriptionTestController
} from '../src/subscriptions/subscriptions.controller';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { SubscriptionsTestRuntimeService } from '../src/subscriptions/subscriptions-test-runtime.service';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionTestEvent,
  StoredSubscriptionTestInventory,
  StoredSubscriptionTestOffer,
  StoredSubscriptionTestPurchase,
  StoredSubscriptionTestReservation,
  StoredSubscriptionType,
  SubscriptionCapabilities,
  SubscriptionTestPurchaseStatus
} from '../src/subscriptions/subscriptions.types';

class InMemoryRuntimeRepository {
  readonly types: StoredSubscriptionType[] = [];
  readonly policies: StoredSubscriptionPolicyVersion[] = [];
  readonly programs: StoredReleaseProgram[] = [];
  readonly offers: StoredSubscriptionTestOffer[] = [];
  readonly inventories: StoredSubscriptionTestInventory[] = [];
  readonly purchases: StoredSubscriptionTestPurchase[] = [];
  readonly reservations: StoredSubscriptionTestReservation[] = [];
  readonly events: StoredSubscriptionTestEvent[] = [];
  failNextReservationInsert = false;
  failNextPhaseActivation = false;

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isDuplicateKey(error: unknown): boolean { return (error as Error)?.message === 'DUPLICATE_KEY'; }
  async subscriptionTypeById(id: string) { return this.clone(this.types.find((row) => row.subscriptionTypeId === id) ?? null); }
  async listPolicyVersions(typeId: string) {
    return this.policies
      .filter((row) => row.subscriptionTypeId === typeId)
      .sort((left, right) => right.version - left.version)
      .map((row) => this.clone(row));
  }
  async policyVersionByNumber(typeId: string, version: number) {
    return this.clone(this.policies.find((row) => row.subscriptionTypeId === typeId && row.version === version) ?? null);
  }
  async releaseProgramById(id: string) { return this.clone(this.programs.find((row) => row.releaseProgramId === id) ?? null); }
  async testOfferByIdempotency(actorId: string, key: string) {
    return this.clone(this.offers.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null);
  }
  async testOfferById(id: string) { return this.clone(this.offers.find((row) => row.offerId === id) ?? null); }
  async testOfferByProgramPolicy(releaseProgramId: string, policyVersion: number) {
    return this.clone(this.offers.find((row) => (
      row.releaseProgramId === releaseProgramId && row.policyVersion === policyVersion
    )) ?? null);
  }
  async testOfferByReleaseProgramId(releaseProgramId: string) {
    return this.clone([...this.offers].reverse().find((row) => (
      row.releaseProgramId === releaseProgramId && row.state === 'TEST_ACTIVE'
    )) ?? null);
  }
  async testOfferByTokenHash(hash: string) { return this.clone(this.offers.find((row) => row.accessTokenHash === hash) ?? null); }
  async insertTestOffer(row: StoredSubscriptionTestOffer): Promise<void> {
    if (this.offers.some((item) => item.offerId === row.offerId || item.accessTokenHash === row.accessTokenHash || (
      item.idempotency.actorId === row.idempotency.actorId && item.idempotency.key === row.idempotency.key
    ))) throw new Error('DUPLICATE_KEY');
    this.offers.push(this.clone(row));
  }
  async testInventoryByOfferId(offerId: string) {
    return this.clone(this.inventories.find((row) => row.offerId === offerId) ?? null);
  }
  async insertTestInventory(row: StoredSubscriptionTestInventory): Promise<void> {
    if (this.inventories.some((item) => item.offerId === row.offerId)) throw new Error('DUPLICATE_KEY');
    this.inventories.push(this.clone(row));
  }
  async reserveTestInventory(input: {
    offerId: string;
    phaseId: string;
    phaseOrder: number;
    purchaseMarkerKey: string;
    clientClaimKey: string;
    purchaseLimitPerClient: number;
    now: string;
  }) {
    const inventory = this.inventories.find((row) => row.offerId === input.offerId);
    const phase = inventory?.phases.find((row) => row.phaseId === input.phaseId);
    if (!inventory || inventory.currentPhaseOrder !== input.phaseOrder || !phase || phase.order !== input.phaseOrder) return null;
    if (inventory.purchaseMarkers[input.purchaseMarkerKey]) return null;
    if ((inventory.clientClaimCounts[input.clientClaimKey] ?? 0) >= input.purchaseLimitPerClient) return null;
    if (phase.available <= 0) return null;
    phase.available -= 1;
    phase.reserved += 1;
    inventory.clientClaimCounts[input.clientClaimKey] = (inventory.clientClaimCounts[input.clientClaimKey] ?? 0) + 1;
    inventory.purchaseMarkers[input.purchaseMarkerKey] = {
      phaseId: input.phaseId,
      clientClaimKey: input.clientClaimKey,
      state: 'RESERVED',
      updatedAt: input.now
    };
    inventory.revision += 1;
    inventory.updatedAt = input.now;
    return this.clone(inventory);
  }
  async finalizeTestInventory(input: {
    offerId: string;
    phaseId: string;
    purchaseMarkerKey: string;
    clientClaimKey: string;
    outcome: 'PAID' | 'FAILED' | 'EXPIRED';
    now: string;
  }) {
    const inventory = this.inventories.find((row) => row.offerId === input.offerId);
    const phase = inventory?.phases.find((row) => row.phaseId === input.phaseId);
    const marker = inventory?.purchaseMarkers[input.purchaseMarkerKey];
    if (!inventory || !phase || !marker || marker.state !== 'RESERVED' || phase.reserved <= 0) return null;
    phase.reserved -= 1;
    if (input.outcome === 'PAID') {
      phase.sold += 1;
    } else {
      phase.available += 1;
      inventory.clientClaimCounts[input.clientClaimKey] = Math.max(
        0,
        (inventory.clientClaimCounts[input.clientClaimKey] ?? 0) - 1
      );
    }
    marker.state = input.outcome;
    marker.updatedAt = input.now;
    inventory.revision += 1;
    inventory.updatedAt = input.now;
    return this.clone(inventory);
  }
  async activateNextTestPhase(input: {
    offerId: string;
    expectedRevision: number;
    currentPhaseOrder: number;
    nextPhaseOrder: number;
    nextPhaseId: string;
    nextTotalQuantity: number;
    now: string;
  }) {
    if (this.failNextPhaseActivation) {
      this.failNextPhaseActivation = false;
      throw new Error('FAULT_BEFORE_PHASE_ROLLOVER');
    }
    const inventory = this.inventories.find((row) => row.offerId === input.offerId);
    const current = inventory?.phases.find((row) => row.order === input.currentPhaseOrder);
    const next = inventory?.phases.find((row) => row.phaseId === input.nextPhaseId);
    if (
      !inventory || inventory.revision !== input.expectedRevision ||
      inventory.currentPhaseOrder !== input.currentPhaseOrder ||
      !current || current.available !== 0 || current.reserved !== 0 ||
      !next || next.order !== input.nextPhaseOrder || next.activation !== 'PREVIOUS_SOLD_OUT' ||
      next.available !== 0 || next.reserved !== 0 || next.sold !== 0
    ) return null;
    next.available = input.nextTotalQuantity;
    inventory.currentPhaseOrder = input.nextPhaseOrder;
    inventory.revision += 1;
    inventory.updatedAt = input.now;
    return this.clone(inventory);
  }
  async testPurchaseByIdempotency(offerId: string, keyHash: string) {
    return this.clone(this.purchases.find((row) => row.offerId === offerId && row.idempotency.keyHash === keyHash) ?? null);
  }
  async testPurchaseById(id: string) { return this.clone(this.purchases.find((row) => row.purchaseId === id) ?? null); }
  async insertTestPurchase(row: StoredSubscriptionTestPurchase): Promise<void> {
    if (this.purchases.some((item) => item.purchaseId === row.purchaseId || (
      item.offerId === row.offerId && item.idempotency.keyHash === row.idempotency.keyHash
    ))) throw new Error('DUPLICATE_KEY');
    this.purchases.push(this.clone(row));
  }
  async updateCreatingTestPurchaseSnapshot(input: {
    purchaseId: string;
    phaseId: string;
    phaseOrder: number;
    priceSnapshot: { amountMinor: number; currency: 'RUB' };
    expiresAt: string;
    updatedAt: string;
  }) {
    const row = this.purchases.find((item) => item.purchaseId === input.purchaseId && item.status === 'CREATING');
    if (!row) return null;
    Object.assign(row, input);
    return this.clone(row);
  }
  async transitionTestPurchase(input: {
    purchaseId: string;
    from: SubscriptionTestPurchaseStatus;
    to: SubscriptionTestPurchaseStatus;
    updatedAt: string;
  }) {
    const row = this.purchases.find((item) => item.purchaseId === input.purchaseId && item.status === input.from);
    if (!row) return null;
    row.status = input.to;
    row.updatedAt = input.updatedAt;
    return this.clone(row);
  }
  async claimTestPurchaseConfirmation(input: {
    purchaseId: string;
    keyHash: string;
    requestHash: string;
    correlationId: string;
    outcome: 'PAID' | 'FAILED' | 'PENDING';
    updatedAt: string;
  }) {
    const row = this.purchases.find((item) => item.purchaseId === input.purchaseId);
    if (!row || row.confirmationCommands[input.keyHash]) return null;
    row.confirmationCommands[input.keyHash] = {
      requestHash: input.requestHash,
      correlationId: input.correlationId,
      outcome: input.outcome
    };
    row.updatedAt = input.updatedAt;
    return this.clone(row);
  }
  async countTestPurchasesForClient(offerId: string, clientRefHash: string) {
    return this.purchases.filter((row) => row.offerId === offerId && row.clientRefHash === clientRefHash && (
      row.status === 'PAYMENT_PENDING' || row.status === 'PAID'
    )).length;
  }
  async listExpiredTestPurchases(offerId: string, now: string, limit: number) {
    return this.purchases
      .filter((row) => row.offerId === offerId && (
        row.status === 'CREATING' || row.status === 'PAYMENT_PENDING'
      ) && row.expiresAt <= now)
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) || left.purchaseId.localeCompare(right.purchaseId))
      .slice(0, limit)
      .map((row) => this.clone(row));
  }
  async listUnfinalizedTerminalTestPurchases(offerId: string, limit: number) {
    return this.purchases
      .filter((row) => row.offerId === offerId && (
        row.status === 'PAID' || row.status === 'FAILED' || row.status === 'EXPIRED'
      ) && !row.inventoryFinalizedAt)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.purchaseId.localeCompare(right.purchaseId))
      .slice(0, limit)
      .map((row) => this.clone(row));
  }
  async markTestPurchaseInventoryFinalized(input: {
    purchaseId: string;
    status: 'PAID' | 'FAILED' | 'EXPIRED';
    finalizedAt: string;
  }) {
    const row = this.purchases.find((item) => (
      item.purchaseId === input.purchaseId && item.status === input.status && !item.inventoryFinalizedAt
    ));
    if (!row) return;
    row.inventoryFinalizedAt = input.finalizedAt;
    row.updatedAt = input.finalizedAt;
  }
  async testReservationByPurchaseId(purchaseId: string) {
    return this.clone(this.reservations.find((row) => row.purchaseId === purchaseId) ?? null);
  }
  async insertTestReservation(row: StoredSubscriptionTestReservation): Promise<void> {
    if (this.failNextReservationInsert) {
      this.failNextReservationInsert = false;
      throw new Error('FAULT_AFTER_INVENTORY_RESERVE');
    }
    if (this.reservations.some((item) => item.reservationId === row.reservationId || item.purchaseId === row.purchaseId)) {
      throw new Error('DUPLICATE_KEY');
    }
    this.reservations.push(this.clone(row));
  }
  async transitionTestReservation(input: {
    purchaseId: string;
    from: StoredSubscriptionTestReservation['status'];
    to: StoredSubscriptionTestReservation['status'];
    updatedAt: string;
  }): Promise<void> {
    const row = this.reservations.find((item) => item.purchaseId === input.purchaseId && item.status === input.from);
    if (row) {
      row.status = input.to;
      row.updatedAt = input.updatedAt;
    }
  }
  async insertTestEvent(row: StoredSubscriptionTestEvent): Promise<void> {
    if (!this.events.some((item) => item.eventId === row.eventId)) this.events.push(this.clone(row));
  }

  private clone<T>(value: T): T { return structuredClone(value); }
}

const globalAdmin: RequestUser = {
  id: 'admin:test-runtime',
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

function capabilities(): SubscriptionCapabilities {
  return {
    lifecycle: {
      activationMode: 'FIRST_USE', activationWindowDays: 30, fixedActivationAt: null,
      fixedActivationTimeZone: 'Europe/Moscow', gracePeriodDays: 0, allowBookingsAfterExpiry: false,
      freeze: { enabled: false, maxDaysPerYear: 0, maxPeriodsPerYear: 0, minDaysPerPeriod: 1, extendsValidity: false },
      adminExtension: { enabled: false, maxDays: 0, reasonRequired: true }
    },
    usage: {
      weeklyUsageLimit: null, monthlyUsageLimit: null, maxFutureBookings: 3,
      minHoursBetweenUses: 0, guestPassesPerMonth: 0, earlyBookingAccessHours: 0,
      waitlistPriority: false, crossStationMode: 'HOME_ONLY', crossStationSurchargeMinor: 0,
      blackoutDates: []
    },
    cancellation: {
      freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 48 },
      lateCancellationUsageUnits: 1, noShowUsageUnits: 1, noShowBlockDays: 0,
      stationCancellationRestoresUsage: true, reschedulePolicy: 'REVALIDATE'
    },
    commerce: {
      renewalMode: 'MANUAL', renewalWindowDays: 30, priceLockEnabled: false,
      renewalDiscountPercent: 0, purchaseLimitPerClient: 1, reservationTtlMinutes: 15,
      waitlistWhenSoldOut: false, promoCodesAllowed: false, installmentsAllowed: false,
      upgradeDowngradeMode: 'DISABLED', terminationRefundMode: 'NONE', coolingOffDays: 0,
      giftable: false, transferable: false, familySeats: 1, corporateSeats: 1,
      maxConcurrentSubscriptions: 1, consumptionPriority: 'EXPIRING_FIRST'
    },
    engagement: {
      showSavings: false, showBreakEvenProgress: false, expirationReminderDays: [30, 14, 7, 1],
      referralEnabled: false, renewalBonusEnabled: false, personalizedRecommendationsEnabled: false
    },
    analytics: {
      trackRevenue: true, trackRefunds: true, trackBreakage: true, trackMargin: true,
      trackPeakLoad: true, trackChurn: true, trackCohorts: true, attributionTag: 'test-runtime'
    }
  };
}

function fixture(firstQuantity = 2): InMemoryRuntimeRepository {
  const now = '2026-08-14T00:00:00.000Z';
  const idempotency = {
    actorId: globalAdmin.id,
    key: 'fixture-idempotency-key',
    requestHash: 'fixture-request-hash',
    correlationId: 'fixture-correlation'
  };
  const repository = new InMemoryRuntimeRepository();
  repository.types.push({
    schemaVersion: 1,
    subscriptionTypeId: 'subscription_type:test',
    code: 'friendship-12m-test',
    codeNorm: 'friendship-12m-test',
    title: 'Дружба 12 месяцев — test',
    description: null,
    state: 'DRAFT',
    currentPolicyVersion: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: globalAdmin.id,
    idempotency
  });
  repository.policies.push({
    schemaVersion: 2,
    modelVersion: 2,
    subscriptionTypeId: 'subscription_type:test',
    version: 1,
    revision: 1,
    status: 'DRAFT',
    effectiveAt: now,
    applyTo: 'ACTIVE_AND_NEW',
    validityDays: 365,
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    maxActiveServices: 3,
    bookingWindowDays: 4,
    dailyUsageLimit: 1,
    activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    benefitRules: [],
    providerBinding: {
      provider: 'VIVA',
      externalId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      referenceKind: 'PRODUCT_CANDIDATE',
      evidenceState: 'UNVERIFIED'
    },
    capabilities: capabilities(),
    createdAt: now,
    createdBy: globalAdmin.id,
    idempotency
  });
  repository.programs.push({
    schemaVersion: 1,
    releaseProgramId: 'release_program:test',
    subscriptionTypeId: 'subscription_type:test',
    stationId: 'yas',
    timezone: 'Europe/Moscow',
    state: 'DRAFT',
    revision: 1,
    phases: [
      {
        releasePhaseId: 'release_phase:1', order: 1, mode: 'BULK', totalQuantity: firstQuantity,
        dailyDropQuantity: null, dailyDropLocalTime: null,
        price: { amountMinor: 1_980_000, currency: 'RUB' }, activation: 'MANUAL',
        scheduledAt: null, providerProductRef: null
      },
      {
        releasePhaseId: 'release_phase:2', order: 2, mode: 'BULK', totalQuantity: 1,
        dailyDropQuantity: null, dailyDropLocalTime: null,
        price: { amountMinor: 2_380_000, currency: 'RUB' }, activation: 'PREVIOUS_SOLD_OUT',
        scheduledAt: null, providerProductRef: null
      }
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: globalAdmin.id,
    idempotency
  });
  return repository;
}

function command(suffix: string) {
  return {
    idempotencyKey: `runtime-test-${suffix.padEnd(16, 'x')}`,
    correlationId: `runtime-${suffix.padEnd(8, 'x')}`
  };
}

async function expectException<T extends Error>(action: () => Promise<unknown>, type: new (...args: never[]) => T): Promise<T> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof type, `expected ${type.name}, got ${(error as Error)?.constructor?.name}`);
    return error as T;
  }
  assert.fail(`Expected ${type.name}`);
}

function exceptionCode(error: { getResponse(): string | object }): string | undefined {
  const body = error.getResponse();
  return typeof body === 'object' && body !== null ? String((body as { code?: string }).code ?? '') : undefined;
}

async function activate(service: SubscriptionsTestRuntimeService) {
  return service.activateTestOffer(
    'release_program:test',
    { policyVersion: 1 },
    command('activate'),
    globalAdmin
  );
}

async function testFeatureGateAndImpactPreview(): Promise<void> {
  const repository = fixture();
  const runtime = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
  const admin = new SubscriptionsService(repository as unknown as SubscriptionsRepository);
  const originalAdmin = process.env.SUBSCRIPTIONS_ADMIN_ENABLED;
  const originalRuntime = process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED;
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  delete process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED;
  try {
    const versions = await admin.listPolicyVersions('subscription_type:test', globalAdmin);
    assert.deepEqual(versions.map((row) => row.version), [1]);
    const preview = await runtime.impactPreview(
      'subscription_type:test',
      1,
      'release_program:test',
      globalAdmin
    );
    assert.equal(preview.readOnly, true);
    assert.equal(preview.realPublication.blocked, true);
    assert.equal(preview.testActivation.allowed, true);
    const blockerCodes = preview.realPublication.blockers.map((row) => row.code);
    assert.ok(blockerCodes.includes('PROVIDER_MAPPING_UNVERIFIED'));
    assert.ok(blockerCodes.includes('NO_ENABLED_BENEFITS'));
    assert.ok(blockerCodes.includes('INITIAL_ENTITLEMENT_UNDEFINED'));
    assert.ok(blockerCodes.includes('CANONICAL_STATION_MAPPING_UNVERIFIED'));
    assert.ok(blockerCodes.includes('CANONICAL_EVENT_MAPPING_UNVERIFIED'));
    assert.equal(repository.offers.length, 0, 'impact preview must be read-only');

    const disabled = await expectException(() => activate(runtime), ServiceUnavailableException);
    assert.equal(exceptionCode(disabled), 'SUBSCRIPTIONS_TEST_RUNTIME_DISABLED');
    process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
    delete process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER;
    const missingPepper = await expectException(() => activate(runtime), ServiceUnavailableException);
    assert.equal(exceptionCode(missingPepper), 'SUBSCRIPTIONS_TEST_HASH_PEPPER_REQUIRED');
  } finally {
    restoreEnv('SUBSCRIPTIONS_ADMIN_ENABLED', originalAdmin);
    restoreEnv('SUBSCRIPTIONS_TEST_RUNTIME_ENABLED', originalRuntime);
  }
}

async function testActivationTokenReservationAndFakeOutcomes(): Promise<void> {
  const repository = fixture(3);
  const service = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER = 'runtime-test-pepper-32-bytes-minimum-value';

  const activated = await activate(service);
  assert.equal(activated.testOnly, true);
  assert.equal(activated.providerMode, 'FAKE');
  assert.equal(activated.currentPhase?.available, 3);
  assert.ok(activated.accessToken && activated.accessToken.length >= 32);
  assert.match(activated.storefrontPath ?? '', /^\/api\/ui\/subscription-test#offerId=.*&token=/);
  assert.notEqual(repository.offers[0].accessTokenHash, activated.accessToken);
  assert.equal(JSON.stringify(repository.offers).includes(activated.accessToken as string), false);
  assert.match(repository.offers[0].accessTokenHash, /^[a-f0-9]{64}$/);

  const replay = await activate(service);
  assert.equal(replay.offerId, activated.offerId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.accessToken, null, 'secret token must be returned only once');
  assert.equal(repository.offers.length, 1);
  assert.equal(repository.inventories.length, 1);

  const token = activated.accessToken as string;
  await expectException(
    () => service.offerByCredentials(activated.offerId, 'invalid-token'),
    NotFoundException
  );
  const rawClientRef = await expectException(
    () => service.reserve(
      activated.offerId,
      token,
      { clientRef: '+79104303190' },
      command('reserve-real-phone')
    ),
    BadRequestException
  );
  assert.equal(exceptionCode(rawClientRef), 'SYNTHETIC_CLIENT_REF_REQUIRED');
  const clientRef = 'synthetic:+79104303190';
  const reserveCommand = command('reserve-paid');
  const reserved = await service.reserve(activated.offerId, token, { clientRef }, reserveCommand);
  assert.equal(reserved.status, 'PAYMENT_PENDING');
  assert.equal(reserved.priceSnapshot.amountMinor, 1_980_000);
  let offer = await service.offerByCredentials(activated.offerId, token);
  assert.deepEqual(
    [offer.currentPhase?.available, offer.currentPhase?.reserved, offer.currentPhase?.sold],
    [2, 1, 0]
  );
  assert.equal(JSON.stringify(repository).includes(clientRef), false, 'raw clientRef must never be stored');
  assert.match(repository.purchases[0].clientRefHash, /^[a-f0-9]{64}$/);
  assert.equal(
    repository.purchases[0].clientRefHash,
    createHmac('sha256', process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER as string)
      .update(`client-ref\u0000${clientRef}`, 'utf8')
      .digest('hex')
  );

  const reserveReplay = await service.reserve(activated.offerId, token, { clientRef }, reserveCommand);
  assert.equal(reserveReplay.purchaseId, reserved.purchaseId);
  assert.equal(repository.purchases.length, 1);
  const reserveConflict = await expectException(
    () => service.reserve(activated.offerId, token, { clientRef: 'synthetic:different-user' }, reserveCommand),
    ConflictException
  );
  assert.equal(exceptionCode(reserveConflict), 'IDEMPOTENCY_CONFLICT');

  const paidCommand = command('confirm-paid');
  await expectException(
    () => service.getPurchase(reserved.purchaseId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    NotFoundException
  );
  const paid = await service.fakeConfirm(
    reserved.purchaseId,
    token,
    { outcome: 'PAID' },
    paidCommand
  );
  assert.equal(paid.status, 'PAID');
  assert.deepEqual(
    [paid.inventory?.currentPhase?.available, paid.inventory?.currentPhase?.reserved, paid.inventory?.currentPhase?.sold],
    [2, 0, 1]
  );
  const paidReplay = await service.fakeConfirm(
    reserved.purchaseId,
    token,
    { outcome: 'PAID' },
    paidCommand
  );
  assert.equal(paidReplay.status, 'PAID');
  assert.equal(paidReplay.inventory?.currentPhase?.sold, 1, 'duplicate PAID must not double count');
  const confirmationConflict = await expectException(
    () => service.fakeConfirm(
      reserved.purchaseId,
      token,
      { outcome: 'FAILED' },
      paidCommand
    ),
    ConflictException
  );
  assert.equal(exceptionCode(confirmationConflict), 'IDEMPOTENCY_CONFLICT');

  const failedReserve = await service.reserve(
    activated.offerId,
    token,
    { clientRef: 'synthetic:failed-user' },
    command('reserve-failed')
  );
  offer = await service.offerByCredentials(activated.offerId, token);
  assert.deepEqual(
    [offer.currentPhase?.available, offer.currentPhase?.reserved, offer.currentPhase?.sold],
    [1, 1, 1]
  );
  const failed = await service.fakeConfirm(
    failedReserve.purchaseId,
    token,
    { outcome: 'FAILED' },
    command('confirm-failed')
  );
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(
    [failed.inventory?.currentPhase?.available, failed.inventory?.currentPhase?.reserved, failed.inventory?.currentPhase?.sold],
    [2, 0, 1]
  );
}

async function testPhaseRolloverAndLastUnitConcurrency(): Promise<void> {
  const repository = fixture(1);
  const service = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER = 'runtime-test-pepper-32-bytes-minimum-value';
  const activated = await activate(service);
  const token = activated.accessToken as string;

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => service.reserve(
      activated.offerId,
      token,
      { clientRef: `synthetic:concurrent-${index}` },
      command(`race-${index}`)
    ))
  );
  const winners = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.reserve>>> => result.status === 'fulfilled');
  assert.equal(winners.length, 1, 'exactly one concurrent request may reserve the last unit');
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 19);
  let inventory = await service.adminInventory(activated.offerId, globalAdmin);
  assert.deepEqual(
    [inventory.currentPhase?.available, inventory.currentPhase?.reserved, inventory.currentPhase?.sold],
    [0, 1, 0]
  );
  assert.ok(inventory.phases.every((phase) => phase.available >= 0 && phase.reserved >= 0 && phase.sold >= 0));

  const winner = winners[0].value;
  const paid = await service.fakeConfirm(
    winner.purchaseId,
    token,
    { outcome: 'PAID' },
    command('race-confirm')
  );
  assert.equal(paid.inventory?.currentPhaseOrder, 2);
  assert.equal(paid.inventory?.currentPhase?.price.amountMinor, 2_380_000);
  assert.deepEqual(
    [paid.inventory?.currentPhase?.available, paid.inventory?.currentPhase?.reserved, paid.inventory?.currentPhase?.sold],
    [1, 0, 0]
  );
  inventory = await service.adminInventory(activated.offerId, globalAdmin);
  assert.equal(inventory.phases[0].sold, 1);
  assert.equal(inventory.phases[1].available, 1);

  const parallelConfirms = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    service.fakeConfirm(
      winner.purchaseId,
      token,
      { outcome: 'PAID' },
      command(`parallel-confirm-${index}`)
    )
  ));
  assert.ok(parallelConfirms.every((row) => row.status === 'PAID'));
  inventory = await service.adminInventory(activated.offerId, globalAdmin);
  assert.equal(inventory.phases[0].sold, 1, 'parallel confirmation must capture once');
}

async function testCreatingReservationCrashRecovery(): Promise<void> {
  const repository = fixture(1);
  const service = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER = 'runtime-test-pepper-32-bytes-minimum-value';
  const activated = await activate(service);
  const token = activated.accessToken as string;
  repository.failNextReservationInsert = true;
  await expectException(
    () => service.reserve(
      activated.offerId,
      token,
      { clientRef: 'synthetic:crash-after-reserve' },
      command('crash-after-reserve')
    ),
    ServiceUnavailableException
  );
  assert.equal(repository.purchases[0].status, 'CREATING');
  assert.deepEqual(
    [repository.inventories[0].phases[0].available, repository.inventories[0].phases[0].reserved],
    [0, 1]
  );
  repository.purchases[0].expiresAt = '2000-01-01T00:00:00.000Z';
  const recovered = await service.offerByCredentials(activated.offerId, token);
  assert.deepEqual(
    [recovered.currentPhase?.available, recovered.currentPhase?.reserved, recovered.currentPhase?.sold],
    [1, 0, 0]
  );
  assert.equal(repository.purchases[0].status, 'EXPIRED');
  assert.equal(repository.reservations.length, 0);
  assert.ok(Object.values(repository.inventories[0].clientClaimCounts).every((value) => value >= 0));
}

async function testTerminalPurchaseCrashRecovery(): Promise<void> {
  const repository = fixture(1);
  const service = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER = 'runtime-test-pepper-32-bytes-minimum-value';
  const activated = await activate(service);
  const token = activated.accessToken as string;
  const reserved = await service.reserve(
    activated.offerId,
    token,
    { clientRef: 'synthetic:crash-after-status-cas' },
    command('crash-after-status-cas')
  );
  await repository.transitionTestPurchase({
    purchaseId: reserved.purchaseId,
    from: 'PAYMENT_PENDING',
    to: 'PAID',
    updatedAt: new Date().toISOString()
  });
  assert.deepEqual(
    [repository.inventories[0].phases[0].available, repository.inventories[0].phases[0].reserved, repository.inventories[0].phases[0].sold],
    [0, 1, 0]
  );
  repository.failNextPhaseActivation = true;
  await expectException(
    () => service.adminInventory(activated.offerId, globalAdmin),
    ServiceUnavailableException
  );
  assert.deepEqual(
    [repository.inventories[0].phases[0].available, repository.inventories[0].phases[0].reserved, repository.inventories[0].phases[0].sold],
    [0, 0, 1]
  );
  assert.equal(repository.inventories[0].currentPhaseOrder, 1);
  assert.equal(repository.purchases[0].inventoryFinalizedAt, null);
  const recovered = await service.adminInventory(activated.offerId, globalAdmin);
  assert.deepEqual(
    [recovered.phases[0].available, recovered.phases[0].reserved, recovered.phases[0].sold],
    [0, 0, 1]
  );
  assert.equal(recovered.currentPhaseOrder, 2);
  assert.equal(recovered.phases[1].available, 1);
  assert.ok(repository.purchases[0].inventoryFinalizedAt);
  const replay = await service.adminInventory(activated.offerId, globalAdmin);
  assert.deepEqual(
    [replay.phases[0].available, replay.phases[0].reserved, replay.phases[0].sold],
    [0, 0, 1]
  );
}

async function testReconciliationSweepBoundaries(): Promise<void> {
  for (const size of [999, 1000, 1001]) {
    const repository = fixture(1);
    const service = new SubscriptionsTestRuntimeService(repository as unknown as SubscriptionsRepository);
    process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER = 'runtime-test-pepper-32-bytes-minimum-value';
    const activated = await activate(service);
    const now = '2026-08-14T10:00:00.000Z';
    for (let index = 0; index < size; index += 1) {
      const suffix = String(index).padStart(4, '0');
      repository.purchases.push({
        schemaVersion: 1,
        purchaseId: `test_purchase:sweep-${size}-${suffix}`,
        offerId: activated.offerId,
        phaseId: repository.inventories[0].phases[0].phaseId,
        phaseOrder: 1,
        accessTokenHash: repository.offers[0].accessTokenHash,
        clientRefHash: `client-${size}-${suffix}`,
        status: 'FAILED',
        priceSnapshot: { amountMinor: 1_980_000, currency: 'RUB' },
        expiresAt: now,
        testOnly: true,
        providerMode: 'FAKE',
        createdAt: now,
        updatedAt: now,
        inventoryFinalizedAt: null,
        idempotency: {
          keyHash: `key-${size}-${suffix}`,
          requestHash: `request-${size}-${suffix}`,
          correlationId: `correlation-${size}-${suffix}`
        },
        confirmationCommands: {}
      });
    }
    if (size <= 1000) {
      await service.adminInventory(activated.offerId, globalAdmin);
      assert.equal(repository.purchases.filter((row) => !row.inventoryFinalizedAt).length, 0);
    } else {
      const limited = await expectException(
        () => service.adminInventory(activated.offerId, globalAdmin),
        ServiceUnavailableException
      );
      assert.equal(exceptionCode(limited), 'TEST_RECONCILIATION_SWEEP_LIMIT');
      assert.equal(repository.purchases.filter((row) => !row.inventoryFinalizedAt).length, 1);
    }
  }
}

function testPublicRuntimeErrorEnvelope(): void {
  const filter = new SubscriptionsExceptionFilter();
  let status = 0;
  let payload: {
    error?: {
      code?: string;
      correlationId?: string;
      retryable?: boolean;
      details?: { blockers?: Array<{ code: string; message: string; target: string }> };
    };
  } = {};
  const response = {
    setHeader: () => undefined,
    status(value: number) { status = value; return this; },
    json(value: typeof payload) { payload = value; return this; }
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-correlation-id': 'runtime-envelope-correlation' },
        user: globalAdmin
      }),
      getResponse: () => response
    })
  };
  filter.catch(
    new ConflictException({ code: 'TEST_OFFER_SOLD_OUT', message: 'Test offer sold out' }),
    host as never
  );
  assert.equal(status, 409);
  assert.equal(payload.error?.code, 'TEST_OFFER_SOLD_OUT');
  assert.equal(payload.error?.correlationId, 'runtime-envelope-correlation');
  assert.equal(payload.error?.retryable, false);
  filter.catch(
    new UnprocessableEntityException({
      code: 'TEST_ACTIVATION_BLOCKED',
      message: 'Blocked',
      details: {
        blockers: [
          { code: 'TEST_RUNTIME_BULK_ONLY', message: 'Bulk only', target: 'TEST' },
          { code: 'SECRET_SHOULD_DROP', message: 'Unsafe', target: 'INTERNAL', secret: 'drop-me' }
        ]
      }
    }),
    host as never
  );
  assert.equal(payload.error?.code, 'TEST_ACTIVATION_BLOCKED');
  assert.deepEqual(payload.error?.details?.blockers, [
    { code: 'TEST_RUNTIME_BULK_ONLY', message: 'Bulk only', target: 'TEST' }
  ]);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function main(): Promise<void> {
  const originalAdmin = process.env.SUBSCRIPTIONS_ADMIN_ENABLED;
  const originalRuntime = process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED;
  const originalPepper = process.env.SUBSCRIPTIONS_TEST_HASH_PEPPER;
  try {
    await testFeatureGateAndImpactPreview();
    await testActivationTokenReservationAndFakeOutcomes();
    await testPhaseRolloverAndLastUnitConcurrency();
    await testCreatingReservationCrashRecovery();
    await testTerminalPurchaseCrashRecovery();
    await testReconciliationSweepBoundaries();
    testPublicRuntimeErrorEnvelope();
    assert.deepEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.impactPreview),
      ['subscriptions:read']
    );
    assert.deepEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.activateTestOffer),
      ['subscriptions:release:write']
    );
    assert.deepEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.testOfferInventory),
      ['subscriptions:read']
    );
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, SubscriptionTestController), []);
    console.log('Subscription test runtime service tests passed');
  } finally {
    restoreEnv('SUBSCRIPTIONS_ADMIN_ENABLED', originalAdmin);
    restoreEnv('SUBSCRIPTIONS_TEST_RUNTIME_ENABLED', originalRuntime);
    restoreEnv('SUBSCRIPTIONS_TEST_HASH_PEPPER', originalPepper);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
