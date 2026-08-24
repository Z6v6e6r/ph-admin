import * as assert from 'node:assert/strict';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { computeSubscriptionUsageLedgerEventHash } from '../src/subscriptions/subscription-runtime-contracts';

const NOW = '2026-08-24T10:00:00.000Z';
const HASH = 'a'.repeat(64);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const tenantId = 'tenant:one';
const subscriptionInstanceId = 'subscription_instance:one';

const input = () => {
  const operation: any = {
    schemaVersion: 1, operationId: 'operation:one', revision: 1, tenantId, subscriptionInstanceId,
    kind: 'BOOKING', state: 'RESERVED', actor: { type: 'CLIENT', actorId: HASH },
    idempotency: { keyHash: HASH, requestHash: 'c'.repeat(64) }, correlationId: 'corr:one',
    decision: { decisionKind: 'ENTITLEMENT', policyVersion: 1, policyDigest: DIGEST, action: 'CREATE_GAME',
      target: { targetId: 'exercise:one', stationId: 'station:one', eventTypeId: 'event:one', productTypeId: null, durationMinutes: 60, startsAt: '2026-08-25T10:00:00.000Z' },
      usageUnits: 1, money: { basePriceMinor: 100, discountMinor: 100, surchargeMinor: 0, finalPriceMinor: 0, currency: 'RUB' } },
    providerCorrelationId: null, providerEvidenceRefs: [], attempts: 0, nextAttemptAt: null,
    compensationState: 'NONE', lastReconciledAt: null, lastReconciliationResult: null,
    createdAt: NOW, updatedAt: NOW, terminalAt: null
  };
  const ledger: any = { schemaVersion: 1, eventId: 'ledger:one', eventHash: HASH, eventType: 'ENTITLEMENT_RESERVED', tenantId, subscriptionInstanceId, operationId: operation.operationId, correlationId: operation.correlationId, policyVersion: 1, policyDigest: DIGEST, stationId: 'station:one', eventTypeId: 'event:one', productTypeId: null, moneyDeltaMinor: 0, currency: 'RUB', usageDelta: 1, providerEvidenceRef: null, actor: { type: 'CLIENT', actorId: HASH }, occurredAt: NOW, recordedAt: NOW };
  ledger.eventHash = computeSubscriptionUsageLedgerEventHash(ledger);
  return { operation, ledger, outbox: { schemaVersion: 1, outboxEventId: 'outbox:one', ledgerEventId: ledger.eventId, subscriptionInstanceId, topic: 'SUBSCRIPTION_LEDGER_EVENT', status: 'PENDING', attempts: 0, nextAttemptAt: NOW, deliveredAt: null, lastErrorCode: null, createdAt: NOW, updatedAt: NOW } };
};

const aggregate = (revision: number, reserved: boolean): any => ({
  schemaVersion: 1, subscriptionInstanceId, revision, activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: reserved ? 1 : 0, activeServices: reserved ? [{ operationId: 'operation:one', targetId: 'exercise:one', startsAt: '2026-08-25T10:00:00.000Z', usageUnits: 1, state: 'RESERVED' }] : [],
  dailyUsage: reserved ? { '2026-08-25': 1 } : {}, weeklyUsage: reserved ? { '2026-W35': 1 } : {}, monthlyUsage: reserved ? { '2026-08': 1 } : {},
  futureBookingCount: reserved ? 1 : 0, futureServiceStartsAt: reserved ? ['2026-08-25T10:00:00.000Z'] : [], remainingUnits: reserved ? 9 : 10,
  reconciliation: { state: 'CURRENT', asOf: NOW, evidenceRef: 'evidence:current' }, createdAt: NOW, updatedAt: NOW
});

async function run(): Promise<void> {
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  const current = aggregate(1, false);
  const values = input();
  const repository = Object.create(SubscriptionsRepository.prototype) as any;
  const stored: any = { aggregate: current, operations: [], ledger: [], outbox: [] };
  const session: any = { withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined };
  repository.client = { startSession: () => session };
  repository.runtimeInstances = () => ({ findOne: async () => ({ schemaVersion: 1, subscriptionInstanceId, tenantId, subscriptionTypeId: 'subscription_type:one', policyVersion: 1, policyDigest: DIGEST, mappingId: 'mapping:one', provider: 'VIVA', providerProductId: 'product:one', providerClientId: 'provider_client:one', clientSubscriptionId: 'client_subscription:one', clientRefHash: HASH, homeStationId: 'station:one', releaseProgramId: 'program:one', releasePhaseId: 'phase:one', purchasePrice: { amountMinor: 100, currency: 'RUB' }, state: 'ACTIVE', purchasedAt: NOW, activeFrom: NOW, activeTo: '2027-08-24T10:00:00.000Z', frozenUntil: null, renewalPredecessorId: null, renewalSuccessorId: null, evidence: { paymentEvidenceRef: 'evidence:payment', providerInstanceEvidenceRef: 'evidence:provider', lastReadBackEvidenceRef: 'evidence:readback' }, reconciliation: { state: 'CURRENT', asOf: NOW, evidenceRef: 'evidence:current' }, revision: 1, createdAt: NOW, updatedAt: NOW }) });
  repository.runtimeAggregates = () => ({ findOne: async (query: any) => query.revision !== undefined && query.revision !== stored.aggregate.revision ? null : stored.aggregate, findOneAndReplace: async (_q: any, next: any) => { if (stored.aggregate.revision !== 1) return null; stored.aggregate = next; return next; } });
  repository.runtimeOperations = () => ({ findOne: async () => stored.operations[0] ?? null, insertOne: async (x: any) => stored.operations.push(x) });
  repository.runtimeLedger = () => ({ findOne: async () => stored.ledger[0] ?? null, insertOne: async (x: any) => stored.ledger.push(x) });
  repository.runtimeOutbox = () => ({ findOne: async () => stored.outbox[0] ?? null, insertOne: async (x: any) => stored.outbox.push(x) });
  const created = await repository.reserveRuntimeEntitlement({ tenantId, subscriptionInstanceId, expectedAggregateRevision: 1, nextAggregate: aggregate(2, true), ...values });
  assert.equal(created.replayed, false); assert.equal(stored.aggregate.revision, 2);
  const replay = await repository.reserveRuntimeEntitlement({ tenantId, subscriptionInstanceId, expectedAggregateRevision: 1, nextAggregate: aggregate(2, true), ...values });
  assert.equal(replay.replayed, true);
  const changedFingerprint = input();
  changedFingerprint.operation.idempotency.requestHash = 'd'.repeat(64);
  await assert.rejects(repository.reserveRuntimeEntitlement({ tenantId, subscriptionInstanceId, expectedAggregateRevision: 2, nextAggregate: aggregate(3, true), ...changedFingerprint }), { code: 'IDEMPOTENCY_CONFLICT' });

  const wrongActor = input();
  wrongActor.ledger.actor.actorId = 'd'.repeat(64);
  assert.throws(
    () => repository.assertEntitlementReservationLinks({
      tenantId, subscriptionInstanceId, expectedAggregateRevision: 1,
      nextAggregate: aggregate(2, true), ...wrongActor
    }),
    { code: 'SUBSCRIPTION_RESERVATION_LINK_MISMATCH' }
  );
  const wrongBucket = aggregate(2, true);
  wrongBucket.dailyUsage = { '2026-08-24': 1 };
  assert.throws(
    () => repository.assertEntitlementReservationTransition(current, wrongBucket, values.operation),
    { code: 'SUBSCRIPTION_RESERVATION_AGGREGATE_INVARIANT_INVALID' }
  );
  const staleTimestamp = aggregate(2, true);
  staleTimestamp.updatedAt = '2026-08-24T09:59:59.000Z';
  assert.throws(
    () => repository.assertEntitlementReservationTransition(current, staleTimestamp, values.operation),
    { code: 'SUBSCRIPTION_RESERVATION_AGGREGATE_INVARIANT_INVALID' }
  );
  assert.deepEqual(
    repository.subscriptionUsageBucketKeys('2026-12-31T22:30:00.000Z'),
    { daily: '2027-01-01', weekly: '2026-W53', monthly: '2027-01' }
  );
  assert.deepEqual(
    repository.subscriptionUsageBucketKeys('2027-01-03T21:00:00.000Z'),
    { daily: '2027-01-04', weekly: '2027-W01', monthly: '2027-01' }
  );
  console.log('subscriptions entitlement reservation repository tests: OK');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
