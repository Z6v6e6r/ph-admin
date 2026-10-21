import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { CanonicalTargetIntakeController } from '../src/subscriptions/canonical-target-intake.controller';
import {
  CanonicalTargetIntakeError,
  CanonicalTargetIntakeService,
  parseCanonicalTargetIntakeBody,
} from '../src/subscriptions/canonical-target-intake.service';
import type {
  StoredSubscriptionCanonicalTargetSnapshot,
  SubscriptionAction,
} from '../src/subscriptions/subscriptions.types';

const TENANT = '86afbe01-0318-4dd2-bc25-303b7bf0d430';
const TOKEN = 'target-ingest-integration-token-0123456789';
const ENV = [
  'SUBSCRIPTIONS_TARGET_INGEST_ENABLED',
  'SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
] as const;
const originals = new Map(ENV.map((name) => [name, process.env[name]]));

function configure(): void {
  process.env.SUBSCRIPTIONS_TARGET_INGEST_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = TENANT;
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetId: 'exercise:synthetic-1',
    action: 'JOIN_GAME',
    revision: 7,
    state: 'ACTIVE',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 90,
    startsAt: '2026-10-25T06:00:00.000Z',
    basePriceMinor: 300_000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-10-21',
    evidenceRef: 'evidence:game-read',
    priceEvidenceRef: 'evidence:price-read',
    observedAt: '2026-10-21T08:00:00.000Z',
    expiresAt: '2026-10-21T09:00:00.000Z',
    ...overrides,
  };
}

function key(input: {
  tenantId: string;
  targetId: string;
  action: SubscriptionAction;
  revision: number;
}): string {
  return `${input.tenantId}\0${input.targetId}\0${input.action}\0${input.revision}`;
}

function repository() {
  const store = new Map<string, StoredSubscriptionCanonicalTargetSnapshot>();
  let inserts = 0;
  return {
    store,
    get inserts() {
      return inserts;
    },
    connect: async () => undefined,
    insertRuntimeCanonicalTargetSnapshot: async (snapshot: StoredSubscriptionCanonicalTargetSnapshot) => {
      inserts += 1;
      const rowKey = key(snapshot);
      if (store.has(rowKey)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      store.set(rowKey, snapshot);
    },
    runtimeCanonicalTargetSnapshot: async (input: {
      tenantId: string;
      targetId: string;
      action: SubscriptionAction;
      revision: number;
    }) => store.get(key(input)) ?? null,
    isDuplicateKey: (error: unknown) =>
      typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000,
  };
}

function service(repo: ReturnType<typeof repository>): CanonicalTargetIntakeService {
  return new CanonicalTargetIntakeService(repo as never);
}

async function testValidAndReplay(): Promise<void> {
  configure();
  const repo = repository();
  const intake = service(repo);
  const first = await intake.ingest(TOKEN, body(), {
    now: () => new Date('2026-10-21T08:00:00.000Z'),
  });
  assert.equal(first.targetId, 'exercise:synthetic-1');
  assert.equal(first.action, 'JOIN_GAME');
  assert.equal(first.revision, 7);
  assert.equal(first.replay, false);
  assert.match(first.snapshotId, /^canonical_target:[a-f0-9]{48}$/);
  const stored = repo.store.get(
    key({ tenantId: TENANT, targetId: 'exercise:synthetic-1', action: 'JOIN_GAME', revision: 7 }),
  );
  assert.ok(stored);
  assert.equal(stored?.basePriceMinor, 300_000);
  assert.equal(stored?.tenantId, TENANT);
  assert.equal(stored?.sourceKind, 'CANONICAL_TARGET_PROJECTION');

  const replay = await intake.ingest(TOKEN, body(), {
    now: () => new Date('2026-10-21T08:00:00.000Z'),
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.snapshotId, first.snapshotId);
  assert.equal(repo.inserts, 2);
}

async function testConflict(): Promise<void> {
  configure();
  const repo = repository();
  const intake = service(repo);
  const options = { now: () => new Date('2026-10-21T08:00:00.000Z') };
  await intake.ingest(TOKEN, body(), options);
  await assert.rejects(
    intake.ingest(TOKEN, body({ basePriceMinor: 400_000 }), options),
    (error) =>
      error instanceof CanonicalTargetIntakeError &&
      error.status === 409 &&
      error.code === 'CANONICAL_TARGET_INTAKE_CONFLICT',
  );
  const original = repo.store.get(
    key({ tenantId: TENANT, targetId: 'exercise:synthetic-1', action: 'JOIN_GAME', revision: 7 }),
  );
  assert.equal(original?.basePriceMinor, 300_000);
}

async function testInvalidBodies(): Promise<void> {
  configure();
  for (const invalid of [
    null,
    [],
    body({ targetId: 'x' }),
    body({ action: 'JOIN_WAITLIST' }),
    body({ revision: 0 }),
    body({ state: 'PENDING' }),
    body({ category: 'TOURNAMENT' }),
    body({ durationMinutes: 0 }),
    body({ durationMinutes: 1441 }),
    body({ basePriceMinor: -1 }),
    body({ currency: 'USD' }),
    body({ startsAt: 'not-an-instant' }),
    body({ observedAt: '2026-10-21T10:00:00.000Z', expiresAt: '2026-10-21T09:00:00.000Z' }),
    body({ extra: true }),
  ]) {
    assert.throws(
      () => parseCanonicalTargetIntakeBody(invalid),
      (error) =>
        error instanceof CanonicalTargetIntakeError &&
        error.status === 400 &&
        error.code === 'CANONICAL_TARGET_BODY_INVALID',
    );
  }
}

async function testGates(): Promise<void> {
  configure();
  delete process.env.SUBSCRIPTIONS_TARGET_INGEST_ENABLED;
  await assert.rejects(
    service(repository()).ingest(TOKEN, body()),
    (error) =>
      error instanceof ServiceUnavailableException &&
      (error.getResponse() as { code?: string }).code === 'SUBSCRIPTIONS_TARGET_INGEST_DISABLED',
  );
  configure();
  delete process.env.SUBSCRIPTIONS_TARGET_INGEST_INTEGRATION_TOKEN;
  await assert.rejects(
    service(repository()).ingest(TOKEN, body()),
    (error) =>
      error instanceof ServiceUnavailableException &&
      (error.getResponse() as { code?: string }).code ===
        'SUBSCRIPTIONS_TARGET_INGEST_NOT_CONFIGURED',
  );
  configure();
  await assert.rejects(
    service(repository()).ingest('wrong-integration-token-0123456789', body()),
    (error) =>
      error instanceof CanonicalTargetIntakeError &&
      error.status === 403 &&
      error.code === 'SUBSCRIPTIONS_TARGET_INGEST_FORBIDDEN',
  );
  configure();
  delete process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID;
  await assert.rejects(
    service(repository()).ingest(TOKEN, body()),
    (error) =>
      error instanceof ServiceUnavailableException &&
      (error.getResponse() as { code?: string }).code === 'SUBSCRIPTIONS_RUNTIME_TENANT_ID_INVALID',
  );
}

async function testControllerBoundary(): Promise<void> {
  const result = {
    snapshotId: 'canonical_target:abc',
    targetId: 'exercise:synthetic-1',
    action: 'JOIN_GAME' as const,
    revision: 7,
    replay: false,
  };
  const controller = new CanonicalTargetIntakeController({
    ingest: async () => result,
  } as never);
  assert.deepEqual(await controller.ingest(TOKEN, body()), result);

  const conflict = new CanonicalTargetIntakeController({
    ingest: async () => {
      throw new CanonicalTargetIntakeError(409, 'CANONICAL_TARGET_INTAKE_CONFLICT');
    },
  } as never);
  await assert.rejects(
    () => conflict.ingest(TOKEN, body()),
    (error) => {
      const http = error as { getStatus?: () => number; getResponse?: () => unknown };
      assert.equal(http.getStatus?.(), 409);
      assert.equal((http.getResponse?.() as { code?: string }).code, 'CANONICAL_TARGET_INTAKE_CONFLICT');
      return true;
    },
  );
}

async function run(): Promise<void> {
  try {
    await testValidAndReplay();
    await testConflict();
    await testInvalidBodies();
    await testGates();
    await testControllerBoundary();
    console.log('subscriptions canonical target intake tests: OK');
  } finally {
    for (const name of ENV) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
