import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runEntitlementPreflightTests } from './subscriptions-entitlement-preflight.test';
import { runEntitlementReadbackTests } from './subscriptions-entitlement-readback.test';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ReserveSubscriptionEntitlementDto,
  ReleaseSubscriptionEntitlementDto
} from '../src/subscriptions/dto/subscription-entitlement-lifecycle.dto';
import { SubscriptionTrustedShadowController } from '../src/subscriptions/subscriptions.controller';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { SubscriptionRuntimeContractError, validateStoredSubscriptionRuntimeOperation } from '../src/subscriptions/subscription-runtime-contracts';
import { createOwnerEvidence, createOwnerReleaseEvidence } from '../src/subscriptions/owner-evidence.verifier';
import {
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent
} from '../src/subscriptions/subscriptions.types';

import { aggregateFixture, quoteFixture, NOW, POLICY_DIGEST, CLIENT_HASH } from './helpers/subscription-entitlement-fixtures';

class FixedClockService extends SubscriptionEntitlementLifecycleService {
  protected override now(): Date {
    return new Date(NOW);
  }
}

class FakeRepository {
  aggregate = aggregateFixture();
  operations = new Map<string, StoredSubscriptionRuntimeOperation>();
  ledgers: StoredSubscriptionUsageLedgerEvent[] = [];
  outboxes: StoredSubscriptionOutboxEvent[] = [];
  reserveCalls = 0;
  transitionCalls = 0;

  async connect(): Promise<void> {}
  async connectReadOnly(): Promise<void> {}

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
        resolvedAt: NOW,
        snapshotId: 'snapshot:target-1',
        snapshotRevision: 1
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
        resolvedAt: NOW,
        snapshotId: 'snapshot:target-1',
        snapshotRevision: 1
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

const expectedReserveDto = () => ({
  ...reserveDto(),
  expectations: { schemaVersion: 1 as const, policyVersion: 3, policyDigest: POLICY_DIGEST,
    targetSnapshot: { snapshotId: 'snapshot:target-1', revision: 1, evidenceRef: 'evidence:target-1' } }
});

async function testReserveExpectations(): Promise<void> {
  process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
  const code = (wanted: string) => (error: any) => error.getResponse?.().code === wanted;
  const mismatch = code('SUBSCRIPTION_ENTITLEMENT_EXPECTATION_MISMATCH');
  const fresh = serviceFixture();
  const original = expectedReserveDto();
  const result = await fresh.service.reserve('Bearer token', 'integration-token', original, { idempotencyKey: 'expected-request-1' });
  assert.equal(result.replayed, false);
  assert.equal(fresh.repository.reserveCalls, 1);
  // Later policy publication / target supersession cannot alter an already accepted decision.
  fresh.adapter.resolveEntitlementRequest = async () => { throw new Error('must not resolve current target during replay'); };
  fresh.shadowQuote.quote = async () => { throw new Error('must not re-quote during replay'); };
  assert.equal((await fresh.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'expected-request-1' })).replayed, true);
  for (const change of [
    { ...original, subscriptionInstanceId: 'subscription:other' },
    { ...original, action: 'JOIN_GAME' as const },
    { ...original, target: { targetId: 'exercise:other' } },
    ...['policyVersion', 'policyDigest', 'snapshotId', 'revision', 'evidenceRef'].map((field) => {
      const changed = structuredClone(original);
      if (field === 'policyVersion') changed.expectations.policyVersion += 1;
      else if (field === 'policyDigest') changed.expectations.policyDigest = `sha256:${'c'.repeat(64)}`;
      else if (field === 'revision') changed.expectations.targetSnapshot.revision += 1;
      else (changed.expectations.targetSnapshot as any)[field] += ':changed';
      return changed;
    })
  ]) await assert.rejects(fresh.service.reserve('Bearer token', 'integration-token', change,
    { idempotencyKey: 'expected-request-1' }), code('SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT'));
  assert.equal(fresh.repository.reserveCalls, 1);

  const corruptBindings = [
    (operation: any) => { operation.actor.type = 'ADMIN'; },
    (operation: any) => { operation.actor.type = 'SYSTEM'; },
    (operation: any) => { operation.subscriptionInstanceId = 'subscription:foreign'; },
    (operation: any) => { operation.decision.policyVersion = 4; },
    (operation: any) => { operation.decision.policyDigest = `sha256:${'d'.repeat(64)}`; },
    (operation: any) => { operation.decision.action = 'JOIN_GAME'; },
    (operation: any) => { operation.decision.target.targetId = 'exercise:foreign'; }
  ];
  for (const corrupt of corruptBindings) {
    const fixture = serviceFixture();
    const accepted = await fixture.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'corrupt-bound-replay' });
    corrupt(fixture.repository.operations.get(accepted.operationId!)!);
    validateStoredSubscriptionRuntimeOperation(fixture.repository.operations.get(accepted.operationId!)!);
    const before = JSON.stringify(fixture.repository.aggregate);
    fixture.repository.runtimeEntitlementAggregateByInstance = async () => { throw new Error('invalid replay must not read aggregate'); };
    fixture.adapter.resolveEntitlementRequest = async () => { throw new Error('invalid replay must not resolve target'); };
    fixture.shadowQuote.quote = async () => { throw new Error('invalid replay must not quote'); };
    await assert.rejects(fixture.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'corrupt-bound-replay' }), mismatch);
    assert.equal(fixture.repository.reserveCalls, 1);
    assert.equal(JSON.stringify(fixture.repository.aggregate), before);
    assert.equal(fixture.repository.ledgers.length, 1);
    assert.equal(fixture.repository.outboxes.length, 1);
  }
  // The transaction may discover a competing stored row after all preflight reads missed.
  const transactionReplay = serviceFixture();
  transactionReplay.repository.reserveRuntimeEntitlement = async (input) => ({
    aggregate: input.aggregate,
    operation: { ...input.operation, actor: { ...input.operation.actor, type: 'ADMIN' } },
    replayed: true
  });
  await assert.rejects(transactionReplay.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'transaction-bound-replay' }), mismatch);
  assert.equal(transactionReplay.repository.operations.size, 0);
  transactionReplay.repository.reserveRuntimeEntitlement = async (input) => ({
    aggregate: input.aggregate,
    operation: { ...input.operation, state: 'FAILED', terminalAt: NOW },
    replayed: true
  });
  await assert.rejects(transactionReplay.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'transaction-terminal-replay' }), code('SUBSCRIPTION_ENTITLEMENT_STATE_CONFLICT'));

  for (const field of ['policyVersion', 'policyDigest', 'snapshotId', 'snapshotRevision', 'evidenceRef']) {
    const fixture = serviceFixture();
    const before = JSON.stringify(fixture.repository.aggregate);
    if (field.startsWith('policy')) {
      // Effective instance-pinned policy changed after a prior quote, before reserve.
      fixture.shadowQuote.quote = async () => quoteFixture(fixture.repository.aggregate, {
        policyVersion: field === 'policyVersion' ? 4 : 3,
        policyDigest: field === 'policyDigest' ? `sha256:${'c'.repeat(64)}` : POLICY_DIGEST
      });
    } else {
      const resolve = fixture.adapter.resolveEntitlementRequest;
      fixture.adapter.resolveEntitlementRequest = async () => {
        const request = await resolve();
        (request.target as any)[field] = field === 'snapshotRevision' ? 2 : 'evidence:changed';
        return request;
      };
    }
    await assert.rejects(fixture.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'mismatched-request' }), mismatch);
    assert.equal(fixture.repository.reserveCalls, 0);
    assert.equal(fixture.repository.operations.size + fixture.repository.ledgers.length + fixture.repository.outboxes.length, 0);
    assert.equal(JSON.stringify(fixture.repository.aggregate), before);
  }
  const fallback = serviceFixture();
  fallback.shadowQuote.quote = async () => quoteFixture(fallback.repository.aggregate, {
    eligible: false, policyVersion: 4, decision: null,
    blockers: [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED', message: 'limit', details: {} }],
    activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION'
  });
  await assert.rejects(fallback.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'fallback-mismatch' }), mismatch);
  assert.equal(fallback.repository.reserveCalls, 0);

  for (const race of ['target', 'policy']) {
    const fixture = serviceFixture();
    let resolves = 0;
    const resolve = fixture.adapter.resolveEntitlementRequest;
    fixture.adapter.resolveEntitlementRequest = async () => {
      const request = await resolve();
      resolves += 1;
      if (resolves > 1 && race === 'target') request.target.snapshotRevision = 2;
      return request;
    };
    fixture.shadowQuote.quote = async () => quoteFixture(fixture.repository.aggregate,
      resolves > 1 && race === 'policy' ? { policyVersion: 4 } : {});
    fixture.repository.reserveRuntimeEntitlement = async () => {
      fixture.repository.reserveCalls += 1;
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT');
    };
    await assert.rejects(fixture.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'cas-race-request' }), mismatch);
    assert.equal(resolves, 2);
    assert.equal(fixture.repository.reserveCalls, 1);
    assert.equal(fixture.repository.operations.size, 0);
  }

  const invalids: any[] = [null, [], {}, { ...original.expectations, schemaVersion: 2 },
    { ...original.expectations, policyVersion: 0 }, { ...original.expectations, policyVersion: '3' },
    { ...original.expectations, policyVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...original.expectations, policyDigest: 'untrusted' },
    { ...original.expectations, policyDigest: POLICY_DIGEST + '\n' },
    { ...original.expectations, targetSnapshot: { ...original.expectations.targetSnapshot, snapshotId: 'snapshot:1\n' } },
    { ...original.expectations, bypass: true }, { ...original.expectations, targetSnapshot: [] },
    { ...original.expectations, targetSnapshot: { ...original.expectations.targetSnapshot, revision: 0 } },
    { ...original.expectations, targetSnapshot: { ...original.expectations.targetSnapshot, owner: 'client' } }];
  for (const expectations of invalids) {
    const fixture = serviceFixture();
    const dto = { ...reserveDto(), expectations };
    assert.ok((await validate(plainToInstance(ReserveSubscriptionEntitlementDto, dto),
      { whitelist: true, forbidNonWhitelisted: true })).length > 0);
    await assert.rejects(fixture.service.reserve('Bearer token', 'integration-token', dto,
      { idempotencyKey: 'invalid-request' }), code('SUBSCRIPTION_ENTITLEMENT_EXPECTATIONS_INVALID'));
    assert.equal(fixture.repository.reserveCalls, 0);
  }
  for (const malformed of [
    { ...original, target: [] },
    { ...original, actorId: 'client:forged' },
    { ...original, target: { ...original.target, revision: 1 } }
  ]) {
    const fixture = serviceFixture();
    await assert.rejects(fixture.service.reserve('Bearer token', 'integration-token', malformed as any,
      { idempotencyKey: 'invalid-outer-request' }), code('SUBSCRIPTION_ENTITLEMENT_EXPECTATIONS_INVALID'));
    assert.equal(fixture.repository.reserveCalls, 0);
  }
  for (const identityChange of [{ tenantId: 'tenant:other' }, { clientRefHash: 'd'.repeat(64) }]) {
    const scoped = serviceFixture();
    await scoped.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'scoped-expected-request' });
    const verified = await scoped.adapter.resolveEntitlementIdentity();
    scoped.adapter.resolveEntitlementIdentity = async () => ({ ...verified, ...identityChange });
    // A scoped lookup must not return the first actor's stored operation.
    scoped.adapter.resolveEntitlementRequest = async () => { throw new Error('foreign lookup did not replay'); };
    await assert.rejects(scoped.service.reserve('Bearer token', 'integration-token', original,
      { idempotencyKey: 'scoped-expected-request' }), /foreign lookup did not replay/);
    assert.equal(scoped.repository.reserveCalls, 1);
  }
  const legacy = serviceFixture();
  const legacyResult = await legacy.service.reserve('Bearer token', 'integration-token', reserveDto(), { idempotencyKey: 'legacy-fingerprint' });
  const legacyHash = createHash('sha256').update(JSON.stringify({ subscriptionInstanceId: 'subscription:annual-1',
    action: 'CREATE_GAME', targetId: 'exercise:game-1', targetSnapshotEvidenceRef: 'evidence:target-1' })).digest('hex');
  assert.equal(legacy.repository.operations.get(legacyResult.operationId!)!.idempotency.requestHash, legacyHash);
  await assert.rejects(legacy.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'legacy-fingerprint' }), code('SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT'));
  const expectedThenLegacy = serviceFixture();
  await expectedThenLegacy.service.reserve('Bearer token', 'integration-token', original,
    { idempotencyKey: 'no-silent-downgrade' });
  await assert.rejects(expectedThenLegacy.service.reserve('Bearer token', 'integration-token', reserveDto(),
    { idempotencyKey: 'no-silent-downgrade' }), code('SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT'));
}

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
    activeServicesLimitExceeded: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
    decision: null,
    benefit: null
  });
  const fallback = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-full-price-1'
  });
  assert.equal(fallback.outcome, 'FULL_PRICE_WITHOUT_SUBSCRIPTION');
  assert.equal(fallback.operationId, null);
  assert.equal(repository.reserveCalls, 0);

  // Without an explicit product rule the same blocker fails closed instead of granting a
  // full-price fallback.
  shadowQuote.quote = async () => quoteFixture(repository.aggregate, {
    eligible: false,
    blockers: [{
      code: 'ACTIVE_SERVICES_LIMIT_REACHED',
      message: 'limit',
      details: { activeServices: 4, maxActiveServices: 4 }
    }],
    activeServicesLimitExceeded: 'BLOCK',
    decision: null,
    benefit: null
  });
  await assert.rejects(service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'booking-blocked-no-rule-1'
  }), (error) => error instanceof ConflictException);

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

async function testStrictOwnerEvidence(): Promise<void> {
  const { service } = serviceFixture();
  process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
  const reserved = await service.reserve('Bearer token', 'integration-token', reserveDto(), {
    idempotencyKey: 'strict-booking-1',
    correlationId: 'corr:strict-1'
  });
  assert.equal(reserved.outcome, 'RESERVED');
  const operationId = reserved.operationId!;

  process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT = 'true';
  delete process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET;
  await assert.rejects(
    service.confirm('Bearer token', 'integration-token', {
      operationId,
      providerBookingId: 'booking:viva-strict'
    }, 'v1.any.any'),
    (error) => error instanceof ServiceUnavailableException
  );

  process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET = 's'.repeat(40);
  process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS = '60';
  await assert.rejects(
    service.confirm('Bearer token', 'integration-token', {
      operationId,
      providerBookingId: 'booking:viva-strict'
    }),
    (error) =>
      error instanceof ForbiddenException &&
      (error.getResponse() as { code?: string }).code ===
        'SUBSCRIPTION_ENTITLEMENT_OWNER_EVIDENCE_REQUIRED'
  );
  const evidence = createOwnerEvidence(
    {
      operationId,
      providerBookingId: 'booking:viva-strict',
      issuedAt: NOW
    },
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET
  );
  const confirmed = await service.confirm(
    'Bearer token',
    'integration-token',
    { operationId, providerBookingId: 'booking:viva-strict' },
    evidence
  );
  assert.equal(confirmed.outcome, 'CONFIRMED');

  await assert.rejects(
    service.release('Bearer token', 'integration-token', {
      operationId,
      reason: 'BOOKING_CANCELLED',
      providerBookingId: 'booking:viva-strict'
    }),
    (error) => error instanceof ForbiddenException &&
      (error.getResponse() as { code?: string }).code ===
        'SUBSCRIPTION_ENTITLEMENT_OWNER_EVIDENCE_REQUIRED'
  );

  delete process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT;
  delete process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET;
  delete process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS;
}

async function testStrictReleaseEvidenceAndRecovery(): Promise<void> {
  const envNames = ['SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT', 'SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET', 'SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS'] as const;
  const before = envNames.map((key) => process.env[key]);
  const secret = 'r'.repeat(40);
  try {
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT = 'true';
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET = secret;
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS = '60';
    process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED = 'true';
    const { service, repository } = serviceFixture();
    const reserved = await service.reserve('Bearer token', 'integration-token', reserveDto(), { idempotencyKey: 'strict-release-1' });
    const operationId = reserved.operationId!;
    const providerBookingId = 'booking:strict-release';
    const confirmProof = createOwnerEvidence({ operationId, providerBookingId, issuedAt: NOW }, secret);
    await service.confirm('Bearer token', 'integration-token', { operationId, providerBookingId }, confirmProof);
    const dto = { operationId, reason: 'BOOKING_CANCELLED' as const, providerBookingId };
    const proof = createOwnerReleaseEvidence({ ...dto, issuedAt: NOW }, secret);
    const state = () => JSON.stringify({ aggregate: repository.aggregate, operations: [...repository.operations], ledgers: repository.ledgers, outboxes: repository.outboxes });
    const unchanged = state();
    const calls = repository.transitionCalls;
    for (const candidate of [
      undefined,
      confirmProof,
      createOwnerReleaseEvidence({ ...dto, issuedAt: NOW }, 'wrong'.repeat(10)),
      createOwnerReleaseEvidence({ ...dto, operationId: 'booking:other', issuedAt: NOW }, secret),
      createOwnerReleaseEvidence({ ...dto, providerBookingId: 'booking:other', issuedAt: NOW }, secret),
      createOwnerReleaseEvidence({ ...dto, reason: 'PROVIDER_REJECTED', providerBookingId: null, issuedAt: NOW }, secret),
      createOwnerReleaseEvidence({ ...dto, issuedAt: new Date(Date.parse(NOW) - 61_000).toISOString() }, secret)
    ]) {
      await assert.rejects(service.release('Bearer token', 'integration-token', dto, candidate), (error) => error instanceof ForbiddenException);
      assert.equal(state(), unchanged);
      assert.equal(repository.transitionCalls, calls);
    }
    delete process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET;
    await assert.rejects(service.release('Bearer token', 'integration-token', dto, proof), (error) => error instanceof ServiceUnavailableException);
    assert.equal(state(), unchanged);
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET = secret;
    const operation = repository.operations.get(operationId)!;
    repository.operations.set(operationId, { ...operation, tenantId: 'tenant:other' });
    await assert.rejects(service.release('Bearer token', 'integration-token', dto, proof), (error) => error instanceof ForbiddenException);
    repository.operations.set(operationId, operation);
    repository.operations.set(operationId, { ...operation, actor: { type: 'CLIENT', actorId: 'c'.repeat(64) } });
    await assert.rejects(service.release('Bearer token', 'integration-token', dto, proof), (error) => error instanceof ForbiddenException);
    repository.operations.set(operationId, operation);
    assert.equal(state(), unchanged);
    const releases = await Promise.all([
      service.release('Bearer token', 'integration-token', dto, proof),
      service.release('Bearer token', 'integration-token', dto, proof)
    ]);
    assert.deepEqual(releases.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(repository.aggregate.remainingUnits, 10);
    assert.equal(repository.aggregate.activeServiceCount, 0);
    assert.equal(repository.ledgers.filter((entry) => entry.eventType === 'ENTITLEMENT_RELEASED').length, 1);
    assert.equal(repository.outboxes.length, 3);
    const terminal = state();
    const completedOperation = repository.operations.get(operationId)!;
    repository.operations.set(operationId, { ...completedOperation, compensationState: 'NONE' });
    const incompleteCompensation = state();
    await assert.rejects(service.release('Bearer token', 'integration-token', dto, proof),
      (error) => error instanceof ConflictException &&
        (error.getResponse() as { code?: string }).code === 'SUBSCRIPTION_ENTITLEMENT_RELEASE_EVIDENCE_MISMATCH');
    assert.equal(state(), incompleteCompensation);
    repository.operations.set(operationId, completedOperation);
    await assert.rejects(service.release('Bearer token', 'integration-token', dto), (error) => error instanceof ForbiddenException);
    for (const contradictory of [
      { ...dto, providerBookingId: 'booking:other' },
      { operationId, reason: 'PROVIDER_REJECTED' as const, providerBookingId: undefined }
    ]) {
      const signed = createOwnerReleaseEvidence({ ...contradictory, providerBookingId: contradictory.providerBookingId ?? null, issuedAt: NOW }, secret);
      await assert.rejects(service.release('Bearer token', 'integration-token', contradictory, signed), (error) => error instanceof ConflictException);
    }
    assert.equal(state(), terminal);
    // Strict-off retains unsigned compatibility but never accepts a contradictory replay.
    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT = 'false';
    assert.equal((await service.release('Bearer token', 'integration-token', dto)).replayed, true);
    await assert.rejects(service.release('Bearer token', 'integration-token', { ...dto, providerBookingId: 'booking:other' }), (error) => error instanceof ConflictException);
    assert.equal(state(), terminal);

    process.env.SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT = 'true';
    const rejected = serviceFixture();
    const held = await rejected.service.reserve('Bearer token', 'integration-token', reserveDto(), { idempotencyKey: 'strict-rejected-1' });
    const rejection = { operationId: held.operationId!, reason: 'PROVIDER_REJECTED' as const };
    const rejectionProof = createOwnerReleaseEvidence({ ...rejection, providerBookingId: null, issuedAt: NOW }, secret);
    assert.equal((await rejected.service.release('Bearer token', 'integration-token', rejection, rejectionProof)).operationState, 'FAILED');
    assert.equal((await rejected.service.release('Bearer token', 'integration-token', rejection, rejectionProof)).replayed, true);
    assert.equal(rejected.repository.aggregate.remainingUnits, 10);
    assert.equal(rejected.repository.ledgers.length, 2);
    assert.equal(rejected.repository.outboxes.length, 2);

    // Simulate the durable write succeeding before its response is lost. Retry with fresh evidence.
    const lostReply = serviceFixture();
    const lostReserve = await lostReply.service.reserve('Bearer token', 'integration-token', reserveDto(), { idempotencyKey: 'strict-lost-reply-1' });
    const lostDto = { operationId: lostReserve.operationId!, reason: 'PROVIDER_REJECTED' as const };
    const lostProof = createOwnerReleaseEvidence({ ...lostDto, providerBookingId: null, issuedAt: NOW }, secret);
    const persist = lostReply.repository.transitionRuntimeEntitlement.bind(lostReply.repository);
    lostReply.repository.transitionRuntimeEntitlement = async (input) => {
      await persist(input);
      throw new Error('synthetic response lost after commit');
    };
    await assert.rejects(lostReply.service.release('Bearer token', 'integration-token', lostDto, lostProof), /synthetic response lost after commit/);
    const persistedAfterLoss = JSON.stringify({ aggregate: lostReply.repository.aggregate, operations: [...lostReply.repository.operations], ledgers: lostReply.repository.ledgers, outboxes: lostReply.repository.outboxes });
    const freshProof = createOwnerReleaseEvidence({ ...lostDto, providerBookingId: null, issuedAt: new Date(Date.parse(NOW) + 1000).toISOString() }, secret);
    assert.notEqual(freshProof, lostProof);
    assert.equal((await lostReply.service.release('Bearer token', 'integration-token', lostDto, freshProof)).replayed, true);
    assert.equal(lostReply.repository.transitionCalls, 1);
    assert.equal(lostReply.repository.aggregate.remainingUnits, 10);
    assert.equal(lostReply.repository.ledgers.length, 2);
    assert.equal(lostReply.repository.outboxes.length, 2);
    assert.equal(JSON.stringify({ aggregate: lostReply.repository.aggregate, operations: [...lostReply.repository.operations], ledgers: lostReply.repository.ledgers, outboxes: lostReply.repository.outboxes }), persistedAfterLoss);
  } finally {
    envNames.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
}

async function testReleaseControllerHeader(): Promise<void> {
  const argumentsMetadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, SubscriptionTrustedShadowController, 'releaseEntitlement') as Record<string, { index: number; data?: string }>;
  assert.ok(Object.values(argumentsMetadata).some((argument) => argument.index === 2 && argument.data === 'x-subscription-owner-evidence'));
  const calls: unknown[][] = [];
  const entitlements = { release: async (...args: unknown[]) => { calls.push(args); return { outcome: 'RELEASED' }; } };
  const controller = new SubscriptionTrustedShadowController({} as never, entitlements as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const dto = { operationId: 'booking:controller', reason: 'PROVIDER_REJECTED' as const };
  await controller.releaseEntitlement('actor-fixture', 'integration-fixture', 'proof-fixture', dto);
  assert.deepEqual(calls, [['actor-fixture', 'integration-fixture', dto, 'proof-fixture']]);
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
    await runEntitlementReadbackTests();
    await runEntitlementPreflightTests();
    await testReserveExpectations();
    await testReserveConfirmRelease();
    await testDailyOverageAndProviderRejection();
    await testFullPriceFallbackAndGuards();
    await testStrictOwnerEvidence();
    await testStrictReleaseEvidenceAndRecovery();
    await testReleaseControllerHeader();
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
