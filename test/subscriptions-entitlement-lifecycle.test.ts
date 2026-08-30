import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ReserveSubscriptionEntitlementDto,
  ReleaseSubscriptionEntitlementDto
} from '../src/subscriptions/dto/subscription-entitlement-lifecycle.dto';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import {
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionShadowQuoteResult
} from '../src/subscriptions/subscriptions.types';

const NOW = '2026-08-31T10:00:00.000Z';
const POLICY_DIGEST = `sha256:${'a'.repeat(64)}`;
const CLIENT_HASH = 'b'.repeat(64);

class FixedClockService extends SubscriptionEntitlementLifecycleService {
  protected override now(): Date {
    return new Date(NOW);
  }
}

const aggregateFixture = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription:annual-1',
  revision: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 0,
  activeServices: [],
  dailyUsage: {},
  weeklyUsage: {},
  monthlyUsage: {},
  futureBookingCount: 0,
  futureServiceStartsAt: [],
  remainingUnits: 10,
  reconciliation: {
    state: 'CURRENT',
    asOf: NOW,
    evidenceRef: 'evidence:projection-1'
  },
  createdAt: NOW,
  updatedAt: NOW
});

const quoteFixture = (
  aggregate: StoredSubscriptionEntitlementAggregate,
  overrides: Partial<SubscriptionShadowQuoteResult> = {}
): SubscriptionShadowQuoteResult => ({
  quoteKind: 'SHADOW',
  nonBinding: true,
  requiresReservationRecheck: true,
  eligible: true,
  blockers: [],
  subscriptionInstanceId: aggregate.subscriptionInstanceId,
  policyVersion: 3,
  policyDigest: POLICY_DIGEST,
  aggregateRevision: aggregate.revision,
  evaluatedAt: NOW,
  usageUnits: 1,
  activeServices: aggregate.activeServiceCount,
  maxActiveServices: 4,
  dailyUsed: aggregate.dailyUsage['2026-09-01'] ?? 0,
  dailyLimit: 1,
  usageBucket: {
    localDate: '2026-09-01',
    localWeek: '2026-W36',
    localMonth: '2026-09'
  },
  dailyUsageApplies: true,
  dailyLimitExceeded: false,
  benefit: {
    kind: 'FREE_ENTITLEMENT',
    ruleId: 'benefit:game-free-hour',
    stationRuleId: 'station:piter',
    basePriceMinor: 150000,
    discountMinor: 150000,
    surchargeMinor: 0,
    finalPriceMinor: 0,
    partialPriceCalculation: null,
    currency: 'RUB'
  },
  decision: {
    decisionKind: 'ENTITLEMENT',
    policyVersion: 3,
    policyDigest: POLICY_DIGEST,
    action: 'CREATE_GAME',
    target: {
      targetId: 'exercise:game-1',
      stationId: 'station:piter',
      eventTypeId: 'event:open-game',
      productTypeId: null,
      durationMinutes: 60,
      startsAt: '2026-09-01T09:00:00.000Z'
    },
    usageUnits: 1,
    money: {
      basePriceMinor: 150000,
      discountMinor: 150000,
      surchargeMinor: 0,
      finalPriceMinor: 0,
      currency: 'RUB'
    }
  },
  ...overrides
});

class FakeRepository {
  aggregate = aggregateFixture();
  operations = new Map<string, StoredSubscriptionRuntimeOperation>();
  ledgers: StoredSubscriptionUsageLedgerEvent[] = [];
  outboxes: StoredSubscriptionOutboxEvent[] = [];
  reserveCalls = 0;
  transitionCalls = 0;

  async connect(): Promise<void> {}

  async runtimeOperationByIdempotency(input: {
    tenantId: string;
    actorId: string;
    kind: string;
    keyHash: string;
  }): Promise<StoredSubscriptionRuntimeOperation | null> {
    return [...this.operations.values()].find((operation) => (
      operation.tenantId === input.tenantId
      && operation.actor.actorId === input.actorId
      && operation.kind === input.kind
      && operation.idempotency.keyHash === input.keyHash
    )) ?? null;
  }

  async runtimeOperationById(operationId: string): Promise<StoredSubscriptionRuntimeOperation | null> {
    return this.operations.get(operationId) ?? null;
  }

  async runtimeEntitlementAggregateByInstance(
    subscriptionInstanceId: string
  ): Promise<StoredSubscriptionEntitlementAggregate | null> {
    return this.aggregate.subscriptionInstanceId === subscriptionInstanceId
      ? structuredClone(this.aggregate)
      : null;
  }

  async reserveRuntimeEntitlement(input: {
    expectedAggregateRevision: number;
    aggregate: StoredSubscriptionEntitlementAggregate;
    operation: StoredSubscriptionRuntimeOperation;
    ledger: StoredSubscriptionUsageLedgerEvent;
    outbox: StoredSubscriptionOutboxEvent;
  }): Promise<{
    aggregate: StoredSubscriptionEntitlementAggregate;
    operation: StoredSubscriptionRuntimeOperation;
    replayed: boolean;
  }> {
    this.reserveCalls += 1;
    const existing = await this.runtimeOperationByIdempotency({
      tenantId: input.operation.tenantId,
      actorId: input.operation.actor.actorId,
      kind: input.operation.kind,
      keyHash: input.operation.idempotency.keyHash
    });
    if (existing) {
      if (existing.idempotency.requestHash !== input.operation.idempotency.requestHash) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT');
      }
      return { aggregate: structuredClone(this.aggregate), operation: existing, replayed: true };
    }
    if (this.aggregate.revision !== input.expectedAggregateRevision) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT');
    }
    this.aggregate = structuredClone(input.aggregate);
    this.operations.set(input.operation.operationId, structuredClone(input.operation));
    this.ledgers.push(structuredClone(input.ledger));
    this.outboxes.push(structuredClone(input.outbox));
    return {
      aggregate: structuredClone(this.aggregate),
      operation: structuredClone(input.operation),
      replayed: false
    };
  }

  async transitionRuntimeEntitlement(input: {
    expectedAggregateRevision: number;
    expectedOperationRevision: number;
    expectedOperationStates: StoredSubscriptionRuntimeOperation['state'][];
    aggregate: StoredSubscriptionEntitlementAggregate;
    operation: StoredSubscriptionRuntimeOperation;
    ledger: StoredSubscriptionUsageLedgerEvent;
    outbox: StoredSubscriptionOutboxEvent;
  }): Promise<{
    aggregate: StoredSubscriptionEntitlementAggregate;
    operation: StoredSubscriptionRuntimeOperation;
  }> {
    this.transitionCalls += 1;
    const current = this.operations.get(input.operation.operationId);
    if (!current || current.revision !== input.expectedOperationRevision
      || !input.expectedOperationStates.includes(current.state)
      || this.aggregate.revision !== input.expectedAggregateRevision) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT');
    }
    this.aggregate = structuredClone(input.aggregate);
    this.operations.set(input.operation.operationId, structuredClone(input.operation));
    this.ledgers.push(structuredClone(input.ledger));
    this.outboxes.push(structuredClone(input.outbox));
    return {
      aggregate: structuredClone(this.aggregate),
      operation: structuredClone(input.operation)
    };
  }
}

const serviceFixture = () => {
  const repository = new FakeRepository();
  const identity = {
    resolutionSource: 'LK_IDENTITY' as const,
    tenantId: 'tenant:piter',
    clientRefHash: CLIENT_HASH,
    evidenceRef: 'evidence:identity-1',
    verifiedAt: NOW
  };
  const adapter = {
    resolveIdentity: async () => identity,
    resolveEntitlementIdentity: async () => identity,
    resolveRequest: async () => ({
      identity,
      subscriptionInstanceId: repository.aggregate.subscriptionInstanceId,
      action: 'CREATE_GAME' as const,
      target: {
        resolutionSource: 'SERVER' as const,
        targetId: 'exercise:game-1',
        stationId: 'station:piter',
        category: 'GAME' as const,
        externalEventTypeId: 'event:open-game',
        productTypeId: null,
        durationMinutes: 60,
        startsAt: '2026-09-01T09:00:00.000Z',
        basePriceMinor: 150000,
        currency: 'RUB' as const,
        dictionaryRevision: 'dictionary:1',
        evidenceRef: 'evidence:target-1',
        priceEvidenceRef: 'evidence:price-1',
        resolvedAt: NOW
      }
    }),
    resolveEntitlementRequest: async () => ({
      identity,
      subscriptionInstanceId: repository.aggregate.subscriptionInstanceId,
      action: 'CREATE_GAME' as const,
      target: {
        resolutionSource: 'SERVER' as const,
        targetId: 'exercise:game-1',
        stationId: 'station:piter',
        category: 'GAME' as const,
        externalEventTypeId: 'event:open-game',
        productTypeId: null,
        durationMinutes: 60,
        startsAt: '2026-09-01T09:00:00.000Z',
        basePriceMinor: 150000,
        currency: 'RUB' as const,
        dictionaryRevision: 'dictionary:1',
        evidenceRef: 'evidence:target-1',
        priceEvidenceRef: 'evidence:price-1',
        resolvedAt: NOW
      }
    })
  };
  const shadowQuote = {
    quote: async () => quoteFixture(repository.aggregate)
  };
  const service = new FixedClockService(adapter as any, shadowQuote as any, repository as any);
  return { service, repository, adapter, shadowQuote };
};

const reserveDto = () => ({
  subscriptionInstanceId: 'subscription:annual-1',
  action: 'CREATE_GAME' as const,
  target: { targetId: 'exercise:game-1' }
});

async function testReserveConfirmRelease(): Promise<void> {
  const { service, repository } = serviceFixture();
  process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
  const reserved = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-request-1',
    correlationId: 'corr:booking-1'
  });
  assert.equal(reserved.outcome, 'RESERVED');
  assert.equal(reserved.replayed, false);
  assert.equal(reserved.aggregateRevision, 2);
  assert.ok(reserved.operationId);
  assert.equal(repository.aggregate.activeServiceCount, 1);
  assert.equal(repository.aggregate.dailyUsage['2026-09-01'], 1);
  assert.equal(repository.aggregate.weeklyUsage['2026-W36'], 1);
  assert.equal(repository.aggregate.monthlyUsage['2026-09'], 1);
  assert.equal(repository.aggregate.remainingUnits, 9);
  assert.equal(repository.ledgers[0].eventType, 'ENTITLEMENT_RESERVED');
  assert.equal(repository.ledgers[0].usageDelta, 1);

  const replayed = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-request-1',
    correlationId: 'corr:booking-retry'
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.aggregateRevision, 2);
  assert.equal(repository.reserveCalls, 1);

  const confirmed = await service.confirm('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    providerBookingId: 'booking:viva-1'
  });
  assert.equal(confirmed.outcome, 'CONFIRMED');
  assert.equal(confirmed.aggregateRevision, 3);
  assert.equal(repository.aggregate.activeServices[0].state, 'CONFIRMED');
  assert.equal(repository.ledgers[1].eventType, 'BOOKING_CONFIRMED');
  assert.equal(repository.ledgers[1].providerEvidenceRef, 'viva:booking:booking:viva-1');

  const confirmReplay = await service.confirm('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    providerBookingId: 'booking:viva-1'
  });
  assert.equal(confirmReplay.replayed, true);
  assert.equal(confirmReplay.aggregateRevision, 3);
  await assert.rejects(service.confirm('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    providerBookingId: 'booking:viva-other'
  }), (error) => error instanceof ConflictException);

  const released = await service.release('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    reason: 'BOOKING_CANCELLED',
    providerBookingId: 'booking:viva-1'
  });
  assert.equal(released.outcome, 'RELEASED');
  assert.equal(released.operationState, 'COMPENSATED');
  assert.equal(released.aggregateRevision, 4);
  assert.equal(repository.aggregate.activeServiceCount, 0);
  assert.deepEqual(repository.aggregate.dailyUsage, {});
  assert.deepEqual(repository.aggregate.weeklyUsage, {});
  assert.deepEqual(repository.aggregate.monthlyUsage, {});
  assert.equal(repository.aggregate.remainingUnits, 10);
  assert.equal(repository.ledgers[2].eventType, 'ENTITLEMENT_RELEASED');
  assert.equal(repository.ledgers[2].usageDelta, -1);

  const releaseReplay = await service.release('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    reason: 'BOOKING_CANCELLED',
    providerBookingId: 'booking:viva-1'
  });
  assert.equal(releaseReplay.replayed, true);
  assert.equal(releaseReplay.aggregateRevision, 4);
}

async function testDailyOverageAndProviderRejection(): Promise<void> {
  const { service, repository, shadowQuote } = serviceFixture();
  process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
  repository.aggregate.dailyUsage['2026-09-01'] = 1;
  shadowQuote.quote = async () => quoteFixture(repository.aggregate, {
    dailyUsed: 1,
    dailyLimitExceeded: true,
    benefit: {
      kind: 'PERCENT_DISCOUNT',
      ruleId: 'daily-usage-limit-exceeded',
      stationRuleId: 'station:piter',
      basePriceMinor: 75000,
      discountMinor: 22500,
      surchargeMinor: 0,
      finalPriceMinor: 52500,
      partialPriceCalculation: null,
      currency: 'RUB'
    },
    decision: {
      ...quoteFixture(repository.aggregate).decision!,
      money: {
        basePriceMinor: 75000,
        discountMinor: 22500,
        surchargeMinor: 0,
        finalPriceMinor: 52500,
        currency: 'RUB'
      }
    }
  });
  const reserved = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-overage-1'
  });
  assert.equal(reserved.decision?.money.finalPriceMinor, 52500);
  assert.equal(repository.aggregate.dailyUsage['2026-09-01'], 1);
  assert.equal(repository.aggregate.weeklyUsage['2026-W36'], 1);

  const released = await service.release('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    reason: 'PROVIDER_REJECTED'
  });
  assert.equal(released.operationState, 'FAILED');
  assert.equal(repository.aggregate.dailyUsage['2026-09-01'], 1);
  assert.deepEqual(repository.aggregate.weeklyUsage, {});
  assert.equal(repository.operations.get(reserved.operationId!)?.providerEvidenceRefs.length, 0);
}

async function testFullPriceFallbackAndGuards(): Promise<void> {
  const { service, repository, shadowQuote, adapter } = serviceFixture();
  delete process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED;
  await assert.rejects(service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-disabled-1'
  }), (error) => error instanceof ServiceUnavailableException);
  assert.equal(repository.reserveCalls, 0);

  process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
  shadowQuote.quote = async () => quoteFixture(repository.aggregate, {
    eligible: false,
    blockers: [{
      code: 'ACTIVE_SERVICES_LIMIT_REACHED',
      message: 'limit',
      details: { activeServices: 4, maxActiveServices: 4 }
    }],
    decision: null,
    benefit: null
  });
  const fallback = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-full-price-1'
  });
  assert.equal(fallback.outcome, 'FULL_PRICE_WITHOUT_SUBSCRIPTION');
  assert.equal(fallback.operationId, null);
  assert.equal(repository.reserveCalls, 0);

  shadowQuote.quote = async () => quoteFixture(repository.aggregate, {
    eligible: false,
    blockers: [
      { code: 'ACTIVE_SERVICES_LIMIT_REACHED', message: 'limit', details: null },
      { code: 'POLICY_DISABLED_FOR_NEW_OPERATIONS', message: 'disabled', details: null }
    ],
    decision: null,
    benefit: null
  });
  await assert.rejects(service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-blocked-1'
  }), (error) => error instanceof ConflictException);

  const normalQuote = async () => quoteFixture(repository.aggregate);
  shadowQuote.quote = normalQuote;
  const reserved = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-owned-1'
  });
  const originalIdentity = adapter.resolveEntitlementIdentity;
  adapter.resolveEntitlementIdentity = async () => ({
    ...(await originalIdentity()),
    clientRefHash: 'c'.repeat(64)
  });
  await assert.rejects(service.confirm('Bearer token', 'integration-token', {
    operationId: reserved.operationId!,
    providerBookingId: 'booking:viva-2'
  }), (error) => error instanceof ForbiddenException);
}

async function testMutationDtoTrustBoundary(): Promise<void> {
  const valid = plainToInstance(ReserveSubscriptionEntitlementDto, reserveDto());
  assert.equal((await validate(valid, {
    whitelist: true,
    forbidNonWhitelisted: true
  })).length, 0);
  const browserPrice = plainToInstance(ReserveSubscriptionEntitlementDto, {
    ...reserveDto(),
    target: {
      targetId: 'exercise:game-1',
      basePriceMinor: 1,
      snapshotRevision: 999
    }
  });
  const browserPriceErrors = await validate(browserPrice, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(browserPriceErrors.some((error) => error.property === 'target'));

  const unsafeRelease = plainToInstance(ReleaseSubscriptionEntitlementDto, {
    operationId: 'booking:operation-1',
    reason: 'BOOKING_CANCELLED'
  });
  assert.equal((await validate(unsafeRelease, {
    whitelist: true,
    forbidNonWhitelisted: true
  })).length, 0);
  // Cross-field evidence is enforced by the service after ownership/state read-back.
  const invalidReason = plainToInstance(ReleaseSubscriptionEntitlementDto, {
    operationId: 'booking:operation-1',
    reason: 'FORCE_RELEASE'
  });
  assert.ok((await validate(invalidReason, {
    whitelist: true,
    forbidNonWhitelisted: true
  })).some((error) => error.property === 'reason'));
}

async function run(): Promise<void> {
  const originalFlag = process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED;
  try {
    await testReserveConfirmRelease();
    await testDailyOverageAndProviderRejection();
    await testFullPriceFallbackAndGuards();
    await testMutationDtoTrustBoundary();
  } finally {
    if (originalFlag === undefined) delete process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED;
    else process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = originalFlag;
  }
  console.log('subscriptions entitlement lifecycle tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
