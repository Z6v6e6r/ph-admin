import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ConfirmSubscriptionEntitlementDto,
  ReleaseSubscriptionEntitlementDto,
  ReserveSubscriptionEntitlementDto
} from './dto/subscription-entitlement-lifecycle.dto';
import {
  computeSubscriptionUsageLedgerEventHash,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionEntitlementAggregate,
  validateStoredSubscriptionRuntimeOperation
} from './subscription-runtime-contracts';
import { SubscriptionShadowQuoteService } from './subscription-shadow-quote.service';
import { SubscriptionTrustedShadowAdapterService } from './subscription-trusted-shadow-adapter.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionEntitlementReservation,
  SubscriptionRuntimeEntitlementDecisionSnapshot,
  SubscriptionShadowQuoteBlocker,
  SubscriptionShadowQuoteIdentityContext
} from './subscriptions.types';

const MAX_CAS_ATTEMPTS = 3;

export interface SubscriptionEntitlementReserveResult {
  schemaVersion: 1;
  outcome: 'RESERVED' | 'FULL_PRICE_WITHOUT_SUBSCRIPTION';
  replayed: boolean;
  operationId: string | null;
  subscriptionInstanceId: string;
  aggregateRevision: number;
  operationState: StoredSubscriptionRuntimeOperation['state'] | null;
  decision: SubscriptionRuntimeEntitlementDecisionSnapshot | null;
  blockers: SubscriptionShadowQuoteBlocker[];
}

export interface SubscriptionEntitlementTransitionResult {
  schemaVersion: 1;
  outcome: 'CONFIRMED' | 'RELEASED';
  replayed: boolean;
  operationId: string;
  subscriptionInstanceId: string;
  aggregateRevision: number;
  operationState: StoredSubscriptionRuntimeOperation['state'];
}

@Injectable()
export class SubscriptionEntitlementLifecycleService {
  constructor(
    private readonly adapter: SubscriptionTrustedShadowAdapterService,
    private readonly shadowQuote: SubscriptionShadowQuoteService,
    private readonly repository: SubscriptionsRepository
  ) {}

  async reserve(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: ReserveSubscriptionEntitlementDto,
    headers: { idempotencyKey?: string; correlationId?: string }
  ): Promise<SubscriptionEntitlementReserveResult> {
    this.assertEnabled();
    const idempotencyKey = this.requireIdempotencyKey(headers.idempotencyKey);
    const request = await this.adapter.resolveEntitlementRequest(
      authorizationHeader,
      integrationToken,
      dto
    );
    await this.repository.connect();
    const keyHash = this.sha256(idempotencyKey);
    const requestHash = this.sha256(JSON.stringify({
      subscriptionInstanceId: request.subscriptionInstanceId,
      action: request.action,
      targetId: request.target.targetId,
      targetSnapshotEvidenceRef: request.target.evidenceRef
    }));
    const operationId = `booking:${this.sha256([
      request.identity.tenantId,
      request.identity.clientRefHash,
      keyHash
    ].join('|')).slice(0, 48)}`;

    const existing = await this.repository.runtimeOperationByIdempotency({
      tenantId: request.identity.tenantId,
      actorId: request.identity.clientRefHash,
      kind: 'BOOKING',
      keyHash
    });
    if (existing) {
      return this.reserveReplay(existing, requestHash);
    }

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const quote = await this.shadowQuote.quote(request);
      const blockerCodes = quote.blockers.map((item) => item.code);
      if (!quote.eligible) {
        if (blockerCodes.length === 1 && blockerCodes[0] === 'ACTIVE_SERVICES_LIMIT_REACHED'
          && quote.aggregateRevision !== null) {
          return {
            schemaVersion: 1,
            outcome: 'FULL_PRICE_WITHOUT_SUBSCRIPTION',
            replayed: false,
            operationId: null,
            subscriptionInstanceId: quote.subscriptionInstanceId,
            aggregateRevision: quote.aggregateRevision,
            operationState: null,
            decision: null,
            blockers: quote.blockers
          };
        }
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_BLOCKED',
          message: 'Subscription benefit is not available for this booking',
          blockers: quote.blockers
        });
      }
      if (!quote.decision || !quote.benefit || quote.aggregateRevision === null
        || !quote.usageBucket || quote.dailyUsageApplies === null
        || quote.dailyUsageApplies === undefined || quote.dailyLimitExceeded === null
        || quote.dailyLimitExceeded === undefined || quote.usageUnits === null) {
        throw new ServiceUnavailableException({
          code: 'SUBSCRIPTION_ENTITLEMENT_QUOTE_INCOMPLETE',
          message: 'Binding entitlement quote is incomplete'
        });
      }
      const aggregate = await this.repository.runtimeEntitlementAggregateByInstance(
        request.subscriptionInstanceId
      );
      if (!aggregate || aggregate.revision !== quote.aggregateRevision) continue;
      const recordedAt = this.now().toISOString();
      const eventId = `event:entitlement-reserved:${operationId.slice('booking:'.length)}`;
      const reservation = this.reservation(operationId, quote, aggregate);
      const nextAggregate = this.reserveAggregate(aggregate, reservation, eventId, recordedAt);
      const operation: StoredSubscriptionRuntimeOperation = {
        schemaVersion: 1,
        operationId,
        revision: 1,
        tenantId: request.identity.tenantId,
        subscriptionInstanceId: request.subscriptionInstanceId,
        kind: 'BOOKING',
        state: 'RESERVED',
        actor: { type: 'CLIENT', actorId: request.identity.clientRefHash },
        idempotency: { keyHash, requestHash },
        correlationId: this.correlationId(headers.correlationId),
        decision: quote.decision,
        providerCorrelationId: null,
        providerEvidenceRefs: [],
        attempts: 0,
        nextAttemptAt: null,
        compensationState: 'NONE',
        lastReconciledAt: recordedAt,
        lastReconciliationResult: 'ENTITLEMENT_RESERVED',
        createdAt: recordedAt,
        updatedAt: recordedAt,
        terminalAt: null
      };
      const ledger = this.ledger(operation, eventId, 'ENTITLEMENT_RESERVED', quote.usageUnits, null);
      const outbox = this.outbox(operation, ledger, recordedAt);
      try {
        const persisted = await this.repository.reserveRuntimeEntitlement({
          expectedAggregateRevision: aggregate.revision,
          aggregate: nextAggregate,
          operation,
          ledger,
          outbox
        });
        return {
          schemaVersion: 1,
          outcome: 'RESERVED',
          replayed: persisted.replayed,
          operationId: persisted.operation.operationId,
          subscriptionInstanceId: request.subscriptionInstanceId,
          aggregateRevision: persisted.aggregate.revision,
          operationState: persisted.operation.state,
          decision: persisted.operation.decision?.decisionKind === 'ENTITLEMENT'
            ? persisted.operation.decision
            : null,
          blockers: []
        };
      } catch (error) {
        if (!(error instanceof SubscriptionRuntimeContractError)
          || error.code !== 'SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT') throw error;
      }
    }
    throw new ConflictException({
      code: 'SUBSCRIPTION_ENTITLEMENT_REVISION_CONFLICT',
      message: 'Subscription usage changed concurrently; retry with the same idempotency key'
    });
  }

  async confirm(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: ConfirmSubscriptionEntitlementDto
  ): Promise<SubscriptionEntitlementTransitionResult> {
    this.assertEnabled();
    const identity = await this.adapter.resolveEntitlementIdentity(
      authorizationHeader,
      integrationToken
    );
    await this.repository.connect();
    const evidenceRef = `viva:booking:${dto.providerBookingId}`;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const operation = await this.ownedOperation(identity, dto.operationId);
      if (operation.state === 'CONFIRMED') {
        if (operation.providerCorrelationId !== dto.providerBookingId
          || !operation.providerEvidenceRefs.includes(evidenceRef)) {
          throw new ConflictException({
            code: 'SUBSCRIPTION_ENTITLEMENT_CONFIRMATION_CONFLICT',
            message: 'Entitlement was confirmed with different provider evidence'
          });
        }
        return this.transitionResult(
          'CONFIRMED',
          true,
          operation,
          await this.requireAggregate(operation)
        );
      }
      if (operation.state !== 'RESERVED') {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_STATE_CONFLICT',
          message: 'Entitlement is not reserved'
        });
      }
      const aggregate = await this.requireAggregate(operation);
      const reservationIndex = aggregate.activeServices.findIndex(
        (item) => item.operationId === operation.operationId
      );
      if (reservationIndex < 0 || aggregate.activeServices[reservationIndex].state !== 'RESERVED') {
        throw new ServiceUnavailableException({
          code: 'SUBSCRIPTION_ENTITLEMENT_RESERVATION_MISSING',
          message: 'Reserved entitlement is absent from aggregate'
        });
      }
      const recordedAt = this.now().toISOString();
      const nextAggregate = structuredClone(aggregate);
      nextAggregate.revision += 1;
      nextAggregate.activeServices[reservationIndex].state = 'CONFIRMED';
      nextAggregate.reconciliation = {
        state: 'CURRENT',
        asOf: recordedAt,
        evidenceRef
      };
      nextAggregate.updatedAt = recordedAt;
      const nextOperation: StoredSubscriptionRuntimeOperation = {
        ...operation,
        revision: operation.revision + 1,
        state: 'CONFIRMED',
        providerCorrelationId: dto.providerBookingId,
        providerEvidenceRefs: [evidenceRef],
        attempts: operation.attempts + 1,
        lastReconciledAt: recordedAt,
        lastReconciliationResult: 'BOOKING_CONFIRMED',
        updatedAt: recordedAt,
        terminalAt: recordedAt
      };
      const eventId = `event:booking-confirmed:${operation.operationId.slice('booking:'.length)}`;
      const ledger = this.ledger(nextOperation, eventId, 'BOOKING_CONFIRMED', 0, evidenceRef);
      const outbox = this.outbox(nextOperation, ledger, recordedAt);
      try {
        const persisted = await this.repository.transitionRuntimeEntitlement({
          expectedAggregateRevision: aggregate.revision,
          expectedOperationRevision: operation.revision,
          expectedOperationStates: ['RESERVED'],
          aggregate: nextAggregate,
          operation: nextOperation,
          ledger,
          outbox
        });
        return this.transitionResult('CONFIRMED', false, persisted.operation, persisted.aggregate);
      } catch (error) {
        if (!(error instanceof SubscriptionRuntimeContractError)
          || error.code !== 'SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT') throw error;
      }
    }
    throw this.revisionConflict();
  }

  async release(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: ReleaseSubscriptionEntitlementDto
  ): Promise<SubscriptionEntitlementTransitionResult> {
    this.assertEnabled();
    const identity = await this.adapter.resolveEntitlementIdentity(
      authorizationHeader,
      integrationToken
    );
    await this.repository.connect();
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const operation = await this.ownedOperation(identity, dto.operationId);
      if (['FAILED', 'COMPENSATED'].includes(operation.state)) {
        return this.transitionResult(
          'RELEASED',
          true,
          operation,
          await this.requireAggregate(operation)
        );
      }
      if (!['RESERVED', 'CONFIRMED'].includes(operation.state)) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_STATE_CONFLICT',
          message: 'Entitlement cannot be released from its current state'
        });
      }
      if (operation.state === 'CONFIRMED' && dto.reason !== 'BOOKING_CANCELLED') {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_EVIDENCE_REQUIRED',
          message: 'Confirmed booking requires cancellation evidence'
        });
      }
      if (dto.reason === 'BOOKING_CANCELLED' && !dto.providerBookingId) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_EVIDENCE_REQUIRED',
          message: 'Provider booking id is required for cancellation release'
        });
      }
      if (operation.providerCorrelationId && dto.providerBookingId
        && operation.providerCorrelationId !== dto.providerBookingId) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_EVIDENCE_MISMATCH',
          message: 'Cancellation evidence does not match confirmed booking'
        });
      }
      const aggregate = await this.requireAggregate(operation);
      const reservationIndex = aggregate.activeServices.findIndex(
        (item) => item.operationId === operation.operationId
      );
      const reservation = aggregate.activeServices[reservationIndex];
      if (!reservation || !reservation.usageBuckets) {
        throw new ServiceUnavailableException({
          code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_RECONCILIATION_REQUIRED',
          message: 'Entitlement reservation cannot be reversed automatically'
        });
      }
      const recordedAt = this.now().toISOString();
      const evidenceRef = dto.providerBookingId ? `viva:booking:${dto.providerBookingId}` : null;
      const eventId = `event:entitlement-released:${operation.operationId.slice('booking:'.length)}`;
      const nextAggregate = this.releaseAggregate(
        aggregate,
        reservationIndex,
        reservation,
        eventId,
        recordedAt
      );
      const terminalState: StoredSubscriptionRuntimeOperation['state'] = evidenceRef
        ? 'COMPENSATED'
        : 'FAILED';
      const nextOperation: StoredSubscriptionRuntimeOperation = {
        ...operation,
        revision: operation.revision + 1,
        state: terminalState,
        providerCorrelationId: dto.providerBookingId ?? operation.providerCorrelationId,
        providerEvidenceRefs: evidenceRef
          ? [...new Set([...operation.providerEvidenceRefs, evidenceRef])]
          : operation.providerEvidenceRefs,
        compensationState: 'APPLIED',
        lastReconciledAt: recordedAt,
        lastReconciliationResult: dto.reason,
        updatedAt: recordedAt,
        terminalAt: recordedAt
      };
      const ledger = this.ledger(
        nextOperation,
        eventId,
        'ENTITLEMENT_RELEASED',
        -reservation.usageUnits,
        evidenceRef
      );
      const outbox = this.outbox(nextOperation, ledger, recordedAt);
      try {
        const persisted = await this.repository.transitionRuntimeEntitlement({
          expectedAggregateRevision: aggregate.revision,
          expectedOperationRevision: operation.revision,
          expectedOperationStates: ['RESERVED', 'CONFIRMED'],
          aggregate: nextAggregate,
          operation: nextOperation,
          ledger,
          outbox
        });
        return this.transitionResult('RELEASED', false, persisted.operation, persisted.aggregate);
      } catch (error) {
        if (!(error instanceof SubscriptionRuntimeContractError)
          || error.code !== 'SUBSCRIPTION_ENTITLEMENT_CAS_CONFLICT') throw error;
      }
    }
    throw this.revisionConflict();
  }

  protected now(): Date {
    return new Date();
  }

  private reservation(
    operationId: string,
    quote: Awaited<ReturnType<SubscriptionShadowQuoteService['quote']>>,
    aggregate: StoredSubscriptionEntitlementAggregate
  ): SubscriptionEntitlementReservation {
    const usageUnits = quote.usageUnits!;
    const dailyUsageDelta = quote.dailyUsageApplies && !quote.dailyLimitExceeded
      ? usageUnits
      : 0;
    return {
      operationId,
      targetId: quote.decision!.target.targetId,
      startsAt: quote.decision!.target.startsAt,
      usageUnits,
      state: 'RESERVED',
      usageBuckets: {
        localDate: quote.usageBucket!.localDate,
        localWeek: quote.usageBucket!.localWeek,
        localMonth: quote.usageBucket!.localMonth,
        dailyUsageDelta,
        weeklyUsageDelta: usageUnits,
        monthlyUsageDelta: usageUnits,
        remainingUnitsDelta: aggregate.remainingUnits === null ? 0 : usageUnits,
        futureBookingDelta: 1
      }
    };
  }

  private reserveAggregate(
    current: StoredSubscriptionEntitlementAggregate,
    reservation: SubscriptionEntitlementReservation,
    evidenceRef: string,
    recordedAt: string
  ): StoredSubscriptionEntitlementAggregate {
    const buckets = reservation.usageBuckets!;
    const next = structuredClone(current);
    next.revision += 1;
    next.activeServices.push(reservation);
    next.activeServiceCount = next.activeServices.length;
    next.dailyUsage[buckets.localDate] = (next.dailyUsage[buckets.localDate] ?? 0)
      + buckets.dailyUsageDelta;
    next.weeklyUsage[buckets.localWeek] = (next.weeklyUsage[buckets.localWeek] ?? 0)
      + buckets.weeklyUsageDelta;
    next.monthlyUsage[buckets.localMonth] = (next.monthlyUsage[buckets.localMonth] ?? 0)
      + buckets.monthlyUsageDelta;
    next.futureServiceStartsAt.push(reservation.startsAt);
    next.futureBookingCount = next.futureServiceStartsAt.length;
    if (next.remainingUnits !== null) {
      next.remainingUnits -= buckets.remainingUnitsDelta;
    }
    next.reconciliation = { state: 'CURRENT', asOf: recordedAt, evidenceRef };
    next.updatedAt = recordedAt;
    validateStoredSubscriptionEntitlementAggregate(next);
    return next;
  }

  private releaseAggregate(
    current: StoredSubscriptionEntitlementAggregate,
    reservationIndex: number,
    reservation: SubscriptionEntitlementReservation,
    evidenceRef: string,
    recordedAt: string
  ): StoredSubscriptionEntitlementAggregate {
    const buckets = reservation.usageBuckets!;
    const next = structuredClone(current);
    next.revision += 1;
    next.activeServices.splice(reservationIndex, 1);
    next.activeServiceCount = next.activeServices.length;
    this.decrementBucket(next.dailyUsage, buckets.localDate, buckets.dailyUsageDelta);
    this.decrementBucket(next.weeklyUsage, buckets.localWeek, buckets.weeklyUsageDelta);
    this.decrementBucket(next.monthlyUsage, buckets.localMonth, buckets.monthlyUsageDelta);
    const startsAtIndex = next.futureServiceStartsAt.indexOf(reservation.startsAt);
    if (startsAtIndex < 0) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_RECONCILIATION_REQUIRED',
        message: 'Future booking counter cannot be reversed automatically'
      });
    }
    next.futureServiceStartsAt.splice(startsAtIndex, buckets.futureBookingDelta);
    next.futureBookingCount = next.futureServiceStartsAt.length;
    if (next.remainingUnits !== null) next.remainingUnits += buckets.remainingUnitsDelta;
    next.reconciliation = { state: 'CURRENT', asOf: recordedAt, evidenceRef };
    next.updatedAt = recordedAt;
    validateStoredSubscriptionEntitlementAggregate(next);
    return next;
  }

  private decrementBucket(bucket: Record<string, number>, key: string, delta: number): void {
    const current = bucket[key] ?? 0;
    if (current < delta) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_ENTITLEMENT_RELEASE_RECONCILIATION_REQUIRED',
        message: 'Usage counter cannot be reversed automatically'
      });
    }
    const next = current - delta;
    if (next === 0) delete bucket[key];
    else bucket[key] = next;
  }

  private async ownedOperation(
    identity: SubscriptionShadowQuoteIdentityContext,
    operationId: string
  ): Promise<StoredSubscriptionRuntimeOperation> {
    const operation = await this.repository.runtimeOperationById(operationId);
    if (!operation) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_ENTITLEMENT_OPERATION_NOT_FOUND',
        message: 'Entitlement operation was not found'
      });
    }
    validateStoredSubscriptionRuntimeOperation(operation);
    if (operation.tenantId !== identity.tenantId
      || operation.actor.type !== 'CLIENT'
      || operation.actor.actorId !== identity.clientRefHash) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_ENTITLEMENT_OPERATION_FORBIDDEN',
        message: 'Entitlement operation does not belong to current client'
      });
    }
    return operation;
  }

  private async requireAggregate(
    operation: StoredSubscriptionRuntimeOperation
  ): Promise<StoredSubscriptionEntitlementAggregate> {
    const aggregate = await this.repository.runtimeEntitlementAggregateByInstance(
      operation.subscriptionInstanceId!
    );
    if (!aggregate) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_ENTITLEMENT_AGGREGATE_NOT_FOUND',
        message: 'Entitlement aggregate was not found'
      });
    }
    validateStoredSubscriptionEntitlementAggregate(aggregate);
    return aggregate;
  }

  private async reserveReplay(
    operation: StoredSubscriptionRuntimeOperation,
    requestHash: string
  ): Promise<SubscriptionEntitlementReserveResult> {
    if (operation.idempotency.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key was already used for another request'
      });
    }
    if (!['RESERVED', 'CONFIRMED'].includes(operation.state)
      || operation.decision?.decisionKind !== 'ENTITLEMENT') {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ENTITLEMENT_STATE_CONFLICT',
        message: 'Idempotent entitlement operation is no longer active'
      });
    }
    return {
      schemaVersion: 1,
      outcome: 'RESERVED',
      replayed: true,
      operationId: operation.operationId,
      subscriptionInstanceId: operation.subscriptionInstanceId!,
      aggregateRevision: (await this.requireAggregate(operation)).revision,
      operationState: operation.state,
      decision: operation.decision,
      blockers: []
    };
  }

  private ledger(
    operation: StoredSubscriptionRuntimeOperation,
    eventId: string,
    eventType: StoredSubscriptionUsageLedgerEvent['eventType'],
    usageDelta: number,
    providerEvidenceRef: string | null
  ): StoredSubscriptionUsageLedgerEvent {
    const decision = operation.decision as SubscriptionRuntimeEntitlementDecisionSnapshot;
    const recordedAt = operation.updatedAt;
    const withoutHash: Omit<StoredSubscriptionUsageLedgerEvent, 'eventHash'> = {
      schemaVersion: 1,
      eventId,
      eventType,
      tenantId: operation.tenantId,
      subscriptionInstanceId: operation.subscriptionInstanceId,
      operationId: operation.operationId,
      correlationId: operation.correlationId,
      policyVersion: decision.policyVersion,
      policyDigest: decision.policyDigest,
      stationId: decision.target.stationId,
      eventTypeId: decision.target.eventTypeId,
      productTypeId: decision.target.productTypeId,
      moneyDeltaMinor: 0,
      currency: 'RUB',
      usageDelta,
      providerEvidenceRef,
      actor: operation.actor,
      occurredAt: recordedAt,
      recordedAt
    };
    return { ...withoutHash, eventHash: computeSubscriptionUsageLedgerEventHash(withoutHash) };
  }

  private outbox(
    operation: StoredSubscriptionRuntimeOperation,
    ledger: StoredSubscriptionUsageLedgerEvent,
    recordedAt: string
  ): StoredSubscriptionOutboxEvent {
    return {
      schemaVersion: 1,
      outboxEventId: `outbox:${ledger.eventId}`,
      ledgerEventId: ledger.eventId,
      subscriptionInstanceId: operation.subscriptionInstanceId,
      topic: 'SUBSCRIPTION_LEDGER_EVENT',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: recordedAt,
      deliveredAt: null,
      lastErrorCode: null,
      createdAt: recordedAt,
      updatedAt: recordedAt
    };
  }

  private transitionResult(
    outcome: 'CONFIRMED' | 'RELEASED',
    replayed: boolean,
    operation: StoredSubscriptionRuntimeOperation,
    aggregate?: StoredSubscriptionEntitlementAggregate
  ): SubscriptionEntitlementTransitionResult {
    return {
      schemaVersion: 1,
      outcome,
      replayed,
      operationId: operation.operationId,
      subscriptionInstanceId: operation.subscriptionInstanceId!,
      aggregateRevision: aggregate?.revision ?? -1,
      operationState: operation.state
    };
  }

  private assertEnabled(): void {
    if (!['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED ?? '')
        .trim()
        .toLowerCase()
    )) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_ENTITLEMENT_RESERVATION_DISABLED',
        message: 'Subscription entitlement reservation is disabled'
      });
    }
  }

  private requireIdempotencyKey(value?: string): string {
    const key = String(value ?? '');
    if (key !== key.trim() || /\s/.test(key) || key.length < 8 || key.length > 200) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_KEY_INVALID',
        message: 'A stable idempotency key is required'
      });
    }
    return key;
  }

  private correlationId(value?: string): string {
    const correlationId = String(value ?? '').trim();
    return correlationId.length >= 8 && correlationId.length <= 128 && !/\s/.test(correlationId)
      ? correlationId
      : `corr:${randomUUID()}`;
  }

  private revisionConflict(): ConflictException {
    return new ConflictException({
      code: 'SUBSCRIPTION_ENTITLEMENT_REVISION_CONFLICT',
      message: 'Subscription entitlement changed concurrently; retry the operation'
    });
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
