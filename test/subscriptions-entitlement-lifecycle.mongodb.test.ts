import * as assert from 'node:assert/strict';
import { runEntitlementReadbackTests } from './subscriptions-entitlement-readback.test';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Db, MongoClient, MongoServerError } from 'mongodb';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { createOwnerEvidence, createOwnerReleaseEvidence } from '../src/subscriptions/owner-evidence.verifier';
import { aggregateFixture, quoteFixture, NOW, CLIENT_HASH } from './helpers/subscription-entitlement-fixtures';

// This harness owns only a unique synthetic DB on the explicitly supplied CI replica set.
// No ambient application URI, database name, provider or optional-skip fallback is accepted.
const TEST_URI_KEY = 'SUBSCRIPTIONS_ENTITLEMENT_MONGODB_TEST_URI';
const DB_PATTERN = /^phab_entitlement_ci_[1-9][0-9]*_[a-f0-9]{32}$/;
const SECRET = 'physical-entitlement-fixture-key-'.repeat(2);
const INSTANCE = 'subscription:annual-1';
const COLLECTIONS = ['subscription_entitlement_aggregates', 'subscription_operations',
  'subscription_usage_ledger', 'subscription_outbox'] as const;

function requireTestUri(): string {
  const uri = process.env[TEST_URI_KEY];
  if (!uri) throw new Error(`${TEST_URI_KEY}_REQUIRED_NO_SKIP`);
  // Pin every client to this loopback host; replica-set discovery must never follow an advertised remote member.
  const target = /^mongodb:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/\?replicaSet=rs0(?:&directConnection=true)?$/.exec(uri);
  if (!target || Number(target[1]) > 65535) {
    throw new Error(`${TEST_URI_KEY}_UNSAFE_TARGET`);
  }
  return `mongodb://127.0.0.1:${target[1]}/?replicaSet=rs0&directConnection=true`;
}

class FixedClockService extends SubscriptionEntitlementLifecycleService {
  protected override now(): Date { return new Date(this.clock); }
  clock = NOW;
}

function configureFixture(uri: string, dbName: string): () => void {
  assert.match(dbName, DB_PATTERN);
  const settings: Record<string, string> = {
    SUBSCRIPTIONS_MONGODB_URI: uri,
    SUBSCRIPTIONS_MONGODB_DB: dbName,
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true',
    SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT: 'true',
    SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: SECRET,
    SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS: '60',
    SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false',
    SUBSCRIPTIONS_TEST_RUNTIME_ENABLED: 'false',
    SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED: 'false',
    SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED: 'false',
    NODE_ENV: 'test'
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function initializeFixtureIndexes(uri: string, dbName: string): void {
  assert.match(dbName, DB_PATTERN);
  assert.equal(uri, requireTestUri());
  const target = new URL(uri);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    scheme: target.protocol.slice(0, -1), hosts: target.host,
    database: dbName, connectionSuffix: `${target.pathname}${target.search}`
  })).digest('hex');
  // Runtime indexes are deliberately verify-only in repository.connect(). Use the existing
  // guarded installer, with its duplicate preflight, only for this already-owned empty fixture DB.
  const setup = spawnSync(process.execPath, ['scripts/managed-subscriptions-indexes.mjs', '--apply'], {
    cwd: process.cwd(),
    env: { ...process.env, SUBSCRIPTIONS_MONGODB_URI: uri, SUBSCRIPTIONS_MONGODB_DB: dbName,
      SUBSCRIPTIONS_INDEX_APPLY: 'CONFIRM', SUBSCRIPTIONS_INDEX_EXPECTED_DB: dbName,
      SUBSCRIPTIONS_INDEX_TARGET_SHA256: fingerprint },
    encoding: 'utf8', timeout: 60_000
  });
  assert.equal(setup.error, undefined, setup.error?.message);
  assert.equal(setup.status, 0, `fixture index setup failed: ${setup.stderr || setup.stdout}`);
  assert.match(setup.stdout, /managed subscription indexes: apply OK/);
}

function firstWaveBarrier(size: number): () => Promise<void> {
  let remaining = size;
  let release!: () => void;
  let refuse!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { release = resolve; refuse = reject; });
  let timeout: NodeJS.Timeout | undefined;
  return async () => {
    if (remaining === 0) return;
    timeout ??= setTimeout(() => refuse(new Error('Concurrent first-wave barrier did not fill')), 10_000);
    remaining -= 1;
    if (remaining === 0) { clearTimeout(timeout); release(); }
    await gate;
  };
}

function firstTransitionBarrier(
  repositories: SubscriptionsRepository[], expectedAggregateRevision: number, expectedOperationRevision: number
): () => void {
  const gate = firstWaveBarrier(repositories.length);
  const snapshots: number[][] = [];
  const original = repositories.map((repository) => repository.transitionRuntimeEntitlement.bind(repository));
  repositories.forEach((repository, index) => {
    let first = true;
    repository.transitionRuntimeEntitlement = async (input) => {
      if (first) {
        first = false;
        snapshots.push([input.expectedAggregateRevision, input.expectedOperationRevision]);
        // Delay only scheduling: all contenders reach the actual transaction from the same snapshots.
        await gate();
      }
      return original[index](input);
    };
  });
  return () => {
    repositories.forEach((repository, index) => { repository.transitionRuntimeEntitlement = original[index]; });
    assert.deepEqual(snapshots, repositories.map(() => [expectedAggregateRevision, expectedOperationRevision]),
      'all transitions must reach the repository before the first write');
  };
}

function serviceFixture(
  repository: SubscriptionsRepository,
  barrier: () => Promise<void> = async () => undefined,
  identityOverride: { tenantId?: string; clientRefHash?: string } = {}
): FixedClockService {
  const identity = { resolutionSource: 'LK_IDENTITY' as const, tenantId: 'tenant:piter',
    clientRefHash: CLIENT_HASH, evidenceRef: 'evidence:identity-1', verifiedAt: NOW, ...identityOverride };
  const request = { identity, subscriptionInstanceId: INSTANCE, action: 'CREATE_GAME' as const,
    target: { resolutionSource: 'SERVER' as const, targetId: 'exercise:game-1', stationId: 'station:piter',
      category: 'GAME' as const, externalEventTypeId: 'event:open-game', productTypeId: null,
      durationMinutes: 60, startsAt: '2026-09-01T09:00:00.000Z', basePriceMinor: 150000,
      currency: 'RUB' as const, dictionaryRevision: 'dictionary:1', evidenceRef: 'evidence:target-1',
      priceEvidenceRef: 'evidence:price-1', resolvedAt: NOW } };
  const adapter = { resolveEntitlementIdentity: async () => identity,
    resolveEntitlementRequest: async () => request };
  // Only policy/identity are synthetic; all usage snapshots and business writes use actual Mongo.
  const quote = { quote: async () => {
    const aggregate = await repository.runtimeEntitlementAggregateByInstance(INSTANCE);
    assert.ok(aggregate);
    await barrier();
    const eligible = aggregate.remainingUnits === 1 && aggregate.activeServiceCount === 0;
    return quoteFixture(aggregate, { eligible, maxActiveServices: 1,
      blockers: eligible ? [] : [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED', message: 'fixture limit',
        details: { activeServices: aggregate.activeServiceCount, maxActiveServices: 1 } }] });
  } };
  return new FixedClockService(adapter as never, quote as never, repository);
}

const dto = { subscriptionInstanceId: INSTANCE, action: 'CREATE_GAME' as const,
  target: { targetId: 'exercise:game-1' } };
const confirmProof = (operationId: string, providerBookingId: string) =>
  createOwnerEvidence({ operationId, providerBookingId, issuedAt: NOW }, SECRET);
const releaseDto = (operationId: string, providerBookingId: string) =>
  ({ operationId, providerBookingId, reason: 'BOOKING_CANCELLED' as const });
const releaseProof = (operationId: string, providerBookingId: string) =>
  createOwnerReleaseEvidence({ ...releaseDto(operationId, providerBookingId), issuedAt: NOW }, SECRET);

async function snapshot(db: Db): Promise<unknown[]> {
  return Promise.all(COLLECTIONS.map((name) => db.collection(name)
    .find({}, { projection: { _id: 0 } }).sort({ _id: 1 }).toArray()));
}

async function assertOneLedgerChain(db: Db, operationId: string, expected: string[]): Promise<void> {
  const ledger = await db.collection('subscription_usage_ledger').find({ operationId }).toArray();
  assert.deepEqual(ledger.map((event) => event.eventType).sort(), [...expected].sort());
  const outbox = await db.collection('subscription_outbox')
    .find({ ledgerEventId: { $in: ledger.map((event) => event.eventId) } }).toArray();
  assert.equal(outbox.length, expected.length);
  assert.equal(new Set(outbox.map((event) => event.ledgerEventId)).size, expected.length);
}

async function assertReturned(repository: SubscriptionsRepository): Promise<void> {
  const aggregate = await repository.runtimeEntitlementAggregateByInstance(INSTANCE);
  assert.ok(aggregate);
  assert.equal(aggregate.remainingUnits, 1);
  assert.equal(aggregate.activeServiceCount, 0);
  assert.equal(aggregate.futureBookingCount, 0);
  assert.deepEqual(aggregate.futureServiceStartsAt, []);
  assert.equal(aggregate.activeServices.length, 0);
  assert.equal(aggregate.dailyUsage['2026-09-01'] ?? 0, 0);
  assert.equal(aggregate.weeklyUsage['2026-W36'] ?? 0, 0);
  assert.equal(aggregate.monthlyUsage['2026-09'] ?? 0, 0);
}

async function childReplay(uri: string, dbName: string, operationId: string): Promise<void> {
  assert.match(dbName, DB_PATTERN);
  assert.match(operationId, /^booking:[a-f0-9]{48}$/);
  const restore = configureFixture(uri, dbName);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const repository = new SubscriptionsRepository();
  try {
    await client.connect();
    await repository.connect();
    const operation = await repository.runtimeOperationById(operationId);
    assert.equal(operation?.state, 'COMPENSATED', 'child only replays an already committed compensation');
    assert.ok(operation?.providerCorrelationId);
    const before = await snapshot(client.db(dbName));
    const replay = await serviceFixture(repository).release('Bearer fixture', 'fixture-integration',
      releaseDto(operationId, operation.providerCorrelationId), releaseProof(operationId, operation.providerCorrelationId));
    assert.equal(replay.replayed, true);
    assert.deepEqual(await snapshot(client.db(dbName)), before);
    await assertReturned(repository);
    console.log('ENTITLEMENT_CHILD_REPLAY_PASSED');
  } finally {
    try {
      await repository.close();
    } finally {
      try { await client.close(); } finally { restore(); }
    }
  }
}

async function run(): Promise<void> {
  const uri = requireTestUri(); // Fail before creating a client when missing or unsafe.
  if (process.argv[2] === 'replay') {
    await childReplay(uri, process.argv[3], process.argv[4]);
    return;
  }
  await runEntitlementReadbackTests();
  const dbName = `phab_entitlement_ci_${process.pid}_${randomUUID().replace(/-/g, '')}`;
  const restore = configureFixture(uri, dbName);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const repositories: SubscriptionsRepository[] = [];
  let owned = false;
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 });
    assert.equal(hello.setName, 'rs0');
    assert.equal(hello.isWritablePrimary, true);
    const db = client.db(dbName);
    assert.deepEqual(await db.listCollections({}, { nameOnly: true }).toArray(), [], 'fixture database must be unused');
    owned = true;
    initializeFixtureIndexes(uri, dbName);
    // Each repository constructs its own independent MongoClient/session pool.
    for (let index = 0; index < 4; index += 1) {
      const repository = new SubscriptionsRepository();
      repositories.push(repository);
      await repository.connect();
    }
    await repositories[0].insertRuntimeEntitlementAggregate({ ...aggregateFixture(), remainingUnits: 1 });
    const barrier = firstWaveBarrier(repositories.length);
    const reserveGate = firstWaveBarrier(repositories.length);
    const firstRevisions: number[] = [];
    for (const repository of repositories) {
      const reserve = repository.reserveRuntimeEntitlement.bind(repository);
      let first = true;
      repository.reserveRuntimeEntitlement = async (input) => {
        if (first) {
          first = false;
          firstRevisions.push(input.expectedAggregateRevision);
          // Scheduling only: retain the exact real repository input/result and transaction.
          await reserveGate();
        }
        return reserve(input);
      };
    }
    const services = repositories.map((repository) => serviceFixture(repository, barrier));
    const claims = await Promise.allSettled(services.map((service, index) =>
      service.reserve('Bearer fixture', 'fixture-integration', dto, { idempotencyKey: `mongo-seat-${index}` })));
    const winners = claims.flatMap((claim, index) => claim.status === 'fulfilled' ? [{ result: claim.value, index }] : []);
    assert.deepEqual(firstRevisions, [1, 1, 1, 1], 'all contenders must race from the same stored revision');
    assert.equal(winners.length, 1, 'one physical transaction may reserve the last unit');
    for (const claim of claims) if (claim.status === 'rejected') assert.ok(claim.reason instanceof ConflictException);
    const { result: reserved, index: winner } = winners[0];
    assert.ok(reserved.operationId);
    const operationId = reserved.operationId;
    const bookingId = 'booking:physical-1';
    const held = await repositories[0].runtimeEntitlementAggregateByInstance(INSTANCE);
    assert.equal(held?.remainingUnits, 0);
    assert.equal(held?.activeServiceCount, 1);
    assert.equal(await db.collection('subscription_operations').countDocuments(), 1);
    await assertOneLedgerChain(db, operationId, ['ENTITLEMENT_RESERVED']);
    const sameKey = await services[(winner + 1) % services.length].reserve('Bearer fixture', 'fixture-integration', dto,
      { idempotencyKey: `mongo-seat-${winner}` });
    assert.equal(sameKey.operationId, operationId);
    assert.equal(sameKey.replayed, true);

    const beforeDenied = await snapshot(db);
    const cancel = releaseDto(operationId, bookingId);
    for (const proof of [undefined, releaseProof(operationId, 'booking:other'),
      createOwnerReleaseEvidence({ ...cancel, issuedAt: '2026-08-31T09:58:00.000Z' }, SECRET)]) {
      await assert.rejects(services[0].release('Bearer fixture', 'fixture-integration', cancel, proof),
        (error: unknown) => error instanceof ForbiddenException);
      assert.deepEqual(await snapshot(db), beforeDenied);
    }
    for (const identity of [{ tenantId: 'tenant:other' }, { clientRefHash: 'c'.repeat(64) }]) {
      await assert.rejects(serviceFixture(repositories[0], undefined, identity)
        .release('Bearer fixture', 'fixture-integration', cancel, releaseProof(operationId, bookingId)),
      (error: unknown) => error instanceof ForbiddenException);
      assert.deepEqual(await snapshot(db), beforeDenied);
    }
    await assert.rejects(services[0].confirm('Bearer fixture', 'fixture-integration', { operationId, providerBookingId: bookingId }),
      (error: unknown) => error instanceof ForbiddenException);
    assert.deepEqual(await snapshot(db), beforeDenied);

    const assertConfirmRace = firstTransitionBarrier(repositories, 2, 1);
    const confirmations = await Promise.all(services.map((service) => service.confirm('Bearer fixture', 'fixture-integration',
      { operationId, providerBookingId: bookingId }, confirmProof(operationId, bookingId))));
    assertConfirmRace();
    assert.equal(confirmations.filter((result) => !result.replayed).length, 1);
    await assertOneLedgerChain(db, operationId, ['ENTITLEMENT_RESERVED', 'BOOKING_CONFIRMED']);
    const assertReleaseRace = firstTransitionBarrier(repositories, 3, 2);
    const releases = await Promise.all(services.map((service) => service.release('Bearer fixture', 'fixture-integration',
      cancel, releaseProof(operationId, bookingId))));
    assertReleaseRace();
    assert.equal(releases.filter((result) => !result.replayed).length, 1);
    await assertReturned(repositories[0]);
    await assertOneLedgerChain(db, operationId, ['ENTITLEMENT_RESERVED', 'BOOKING_CONFIRMED', 'ENTITLEMENT_RELEASED']);
    console.log('PASS physical concurrent last-unit reserve, same-key replay, proof/ownership refusal and single confirm/release');

    const next = await services[0].reserve('Bearer fixture', 'fixture-integration', dto, { idempotencyKey: 'mongo-rollback-response-loss' });
    assert.ok(next.operationId);
    const nextId = next.operationId;
    const nextBooking = 'booking:physical-2';
    await services[0].confirm('Bearer fixture', 'fixture-integration', { operationId: nextId, providerBookingId: nextBooking },
      confirmProof(nextId, nextBooking));
    const releaseEventId = `event:entitlement-released:${nextId.slice('booking:'.length)}`;
    // Force the final transactional insert to fail after operation, aggregate and ledger writes.
    // A real unique outbox index triggers this; no driver mock or privileged server failpoint.
    const collision = await db.collection('subscription_outbox').insertOne({
      outboxEventId: `outbox:${releaseEventId}`, ledgerEventId: releaseEventId, fixtureFault: true
    });
    const beforeRollback = await snapshot(db);
    await assert.rejects(services[0].release('Bearer fixture', 'fixture-integration', releaseDto(nextId, nextBooking),
      releaseProof(nextId, nextBooking)), (error: unknown) => error instanceof MongoServerError && error.code === 11000);
    assert.deepEqual(await snapshot(db), beforeRollback, 'all earlier transactional writes must roll back');
    assert.equal((await repositories[1].runtimeOperationById(nextId))?.state, 'CONFIRMED');
    assert.equal((await repositories[1].runtimeEntitlementAggregateByInstance(INSTANCE))?.remainingUnits, 0);
    await assertOneLedgerChain(db, nextId, ['ENTITLEMENT_RESERVED', 'BOOKING_CONFIRMED']);
    assert.equal((await db.collection('subscription_outbox').deleteOne({ _id: collision.insertedId, fixtureFault: true })).deletedCount, 1);
    console.log('PASS physical rollback of operation/aggregate/ledger when final outbox insert fails');

    const transition = repositories[0].transitionRuntimeEntitlement.bind(repositories[0]);
    repositories[0].transitionRuntimeEntitlement = async (input) => {
      await transition(input);
      throw new Error('synthetic response lost after physical commit');
    };
    await assert.rejects(services[0].release('Bearer fixture', 'fixture-integration', releaseDto(nextId, nextBooking),
      releaseProof(nextId, nextBooking)), /synthetic response lost after physical commit/);
    repositories[0].transitionRuntimeEntitlement = transition;
    await assertReturned(repositories[1]);
    await assertOneLedgerChain(db, nextId, ['ENTITLEMENT_RESERVED', 'BOOKING_CONFIRMED', 'ENTITLEMENT_RELEASED']);
    const afterLostResponse = await snapshot(db);
    const child = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), __filename, 'replay', dbName, nextId],
      { env: { ...process.env, [TEST_URI_KEY]: uri }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, `child replay failed: ${child.stderr}`);
    assert.match(child.stdout, /ENTITLEMENT_CHILD_REPLAY_PASSED/);
    assert.deepEqual(await snapshot(db), afterLostResponse, 'process retry must not duplicate committed compensation');
    console.log('PASS physical commit/response-loss recovery in a separate Node process');
    const rejected = await services[0].reserve('Bearer fixture', 'fixture-integration', dto,
      { idempotencyKey: 'mongo-readback-expired-proof' });
    assert.ok(rejected.operationId);
    const rejection = { operationId: rejected.operationId, reason: 'PROVIDER_REJECTED' as const };
    const rejectionProof = createOwnerReleaseEvidence({ ...rejection, providerBookingId: null, issuedAt: NOW }, SECRET);
    repositories[0].transitionRuntimeEntitlement = async (input) => {
      await transition(input);
      throw new Error('synthetic provider-rejection response lost after physical commit');
    };
    await assert.rejects(services[0].release('Bearer fixture', 'fixture-integration', rejection, rejectionProof),
      /synthetic provider-rejection response lost after physical commit/);
    repositories[0].transitionRuntimeEntitlement = transition;
    services[0].clock = '2026-08-31T10:02:00.000Z';
    const beforeReadback = await snapshot(db);
    await assert.rejects(services[0].release('Bearer fixture', 'fixture-integration', rejection, rejectionProof), ForbiddenException);
    const readback = await services[0].readback('Bearer fixture', 'fixture-integration', {
      operationId: rejected.operationId, subscriptionInstanceId: INSTANCE
    });
    assert.deepEqual(readback, { schemaVersion: 1, operationId: rejected.operationId, subscriptionInstanceId: INSTANCE,
      operationState: 'FAILED', compensationState: 'APPLIED', releaseReason: 'PROVIDER_REJECTED', providerBookingId: null });
    assert.deepEqual(await snapshot(db), beforeReadback, 'expired-proof readback must not write any business collection');
    await assertReturned(repositories[1]);
    await assertOneLedgerChain(db, rejected.operationId, ['ENTITLEMENT_RESERVED', 'ENTITLEMENT_RELEASED']);
    console.log('PASS physical provider-rejection commit/lost response then read-only recovery beyond proof TTL');
    console.log('Canonical entitlement Mongo tests: PASS; policy/identity synthetic; provider writes=0; skipped=0');
  } finally {
    try {
      try {
        await Promise.all(repositories.map((repository) => repository.close()));
      } finally {
        if (owned) {
          assert.match(dbName, DB_PATTERN);
          await client.db(dbName).dropDatabase();
        }
      }
    } finally {
      try { await client.close(); } finally { restore(); }
    }
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Entitlement Mongo test failed');
  process.exitCode = 1;
});
