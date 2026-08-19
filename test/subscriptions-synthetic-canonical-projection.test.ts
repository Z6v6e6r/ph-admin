import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertSyntheticProjectionApplyBoundary,
  buildSyntheticCanonicalTargetSnapshot,
  syntheticProjectionTargetFingerprint,
  SubscriptionSyntheticCanonicalProjectionService
} from '../src/subscriptions/subscription-synthetic-canonical-projection.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { StoredSubscriptionCanonicalTargetSnapshot } from '../src/subscriptions/subscriptions.types';

const ENV_NAMES = [
  'NODE_ENV',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED',
  'SUBSCRIPTIONS_SYNTHETIC_PROJECTION_APPLY',
  'SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256',
  'SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS',
  'SUBSCRIPTIONS_MONGODB_URI',
  'SUBSCRIPTIONS_MONGODB_DB',
  'SUBSCRIPTIONS_AUTO_CREATE_INDEXES',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

const restoreEnv = (): void => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

const enableApply = (): void => {
  process.env.NODE_ENV = 'development';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_APPLY = 'CONFIRM';
  process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS = 'station:yasenevo';
  process.env.SUBSCRIPTIONS_MONGODB_URI = 'mongodb://127.0.0.1:27029/?directConnection=true';
  process.env.SUBSCRIPTIONS_MONGODB_DB = 'phab_subscriptions_test_gate_d_synthetic_unit';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'iSkq6G';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
  process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256 =
    syntheticProjectionTargetFingerprint();
};

const fixture = (): Record<string, unknown> => ({
  schemaVersion: 1,
  sourceMode: 'SYNTHETIC_FIXTURE',
  tenantId: 'iSkq6G',
  targetId: 'synthetic:open-game-20260820-0900',
  action: 'JOIN_GAME',
  state: 'ACTIVE',
  revision: 1,
  stationId: 'station:yasenevo',
  category: 'GAME',
  externalEventTypeId: 'synthetic_event_type:open-game',
  productTypeId: null,
  durationMinutes: 60,
  startsAt: '2026-08-20T06:00:00.000Z',
  basePriceMinor: 400000,
  currency: 'RUB',
  dictionaryRevision: 'synthetic_dictionary:2026-08-19-r1',
  evidenceRef: 'synthetic_evidence:target-open-game-1',
  priceEvidenceRef: 'synthetic_price_evidence:target-open-game-1',
  observedAt: '2026-08-19T10:00:00.000Z',
  expiresAt: '2026-08-19T10:01:00.000Z'
});

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof SubscriptionRuntimeContractError && error.code === code;

class FakeRepository {
  connectCalls = 0;
  reads = 0;
  inserts = 0;
  current: StoredSubscriptionCanonicalTargetSnapshot | null = null;
  duplicateOnInsert = false;
  raced: StoredSubscriptionCanonicalTargetSnapshot | null = null;

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  async runtimeCanonicalTargetSnapshot(
    input: { revision: number }
  ): Promise<StoredSubscriptionCanonicalTargetSnapshot | null> {
    this.reads += 1;
    if (this.reads > 1 && this.raced?.revision === input.revision) return this.raced;
    return this.current?.revision === input.revision ? this.current : null;
  }

  async runtimeLatestCanonicalTargetSnapshot(): Promise<StoredSubscriptionCanonicalTargetSnapshot | null> {
    return this.current;
  }

  async insertRuntimeCanonicalTargetSnapshot(
    document: StoredSubscriptionCanonicalTargetSnapshot
  ): Promise<void> {
    this.inserts += 1;
    if (this.duplicateOnInsert) throw new Error('duplicate');
    this.current = document;
  }

  isDuplicateKey(): boolean {
    return this.duplicateOnInsert;
  }
}

class FixedClockProjectionService extends SubscriptionSyntheticCanonicalProjectionService {
  protected override now(): Date {
    return new Date('2026-08-19T10:00:30.000Z');
  }
}

async function run(): Promise<void> {
  const prepared = buildSyntheticCanonicalTargetSnapshot(fixture());
  assert.match(prepared.snapshotId, /^synthetic_target_snapshot:[a-f0-9]{64}$/);
  assert.equal(prepared.createdAt, prepared.observedAt);
  assert.deepEqual(
    prepared,
    buildSyntheticCanonicalTargetSnapshot(Object.fromEntries(Object.entries(fixture()).reverse()))
  );

  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({
      ...fixture(),
      phone: 'synthetic-disallowed-field'
    }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_INPUT_SHAPE_INVALID')
  );
  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({ ...fixture(), targetId: 'exercise:real-1' }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_TARGET_REQUIRED')
  );
  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({
      ...fixture(),
      evidenceRef: 'har:unverified-provider-read'
    }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_EVIDENCE_REQUIRED')
  );
  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({
      ...fixture(),
      expiresAt: '2026-08-19T11:00:01.000Z'
    }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_FRESHNESS_INVALID')
  );
  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({ ...fixture(), category: 'TOURNAMENT' }),
    hasCode('SUBSCRIPTION_CANONICAL_TARGET_ACTION_CATEGORY_MISMATCH')
  );
  assert.throws(
    () => buildSyntheticCanonicalTargetSnapshot({
      ...fixture(),
      action: 'PURCHASE_ADD_ON_PRODUCT',
      category: 'ADD_ON_PRODUCT'
    }),
    hasCode('SUBSCRIPTION_CANONICAL_TARGET_PRODUCT_TYPE_REQUIRED')
  );

  const disabledRepository = new FakeRepository();
  delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  await assert.rejects(
    new SubscriptionSyntheticCanonicalProjectionService(disabledRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED')
  );
  assert.equal(disabledRepository.connectCalls, 0);

  enableApply();
  process.env.NODE_ENV = 'production';
  await assert.rejects(
    new FixedClockProjectionService(disabledRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DEV_ENVIRONMENT_REQUIRED')
  );
  process.env.NODE_ENV = 'development';
  process.env.SUBSCRIPTIONS_MONGODB_DB = 'dialog';
  await assert.rejects(
    new FixedClockProjectionService(disabledRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DEV_DATABASE_REQUIRED')
  );
  process.env.SUBSCRIPTIONS_MONGODB_DB = 'phab_subscriptions_dev_ac6396e';
  assert.throws(
    () => syntheticProjectionTargetFingerprint(),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_DEV_DATABASE_REQUIRED')
  );
  process.env.SUBSCRIPTIONS_MONGODB_DB = 'phab_subscriptions_test_gate_d_synthetic_remote';
  process.env.SUBSCRIPTIONS_MONGODB_URI = 'mongodb://production.example:27017';
  assert.throws(
    () => syntheticProjectionTargetFingerprint(),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_LOOPBACK_URI_REQUIRED')
  );

  enableApply();
  process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256 = `sha256:${'0'.repeat(64)}`;
  const wrongTargetRepository = new FakeRepository();
  await assert.rejects(
    new FixedClockProjectionService(wrongTargetRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_ATTESTATION_MISMATCH')
  );
  assert.equal(wrongTargetRepository.connectCalls, 0);
  delete process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_SHA256;
  assert.throws(
    () => assertSyntheticProjectionApplyBoundary(),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TARGET_ATTESTATION_REQUIRED')
  );

  enableApply();
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any)
      .apply({ ...fixture(), revision: 2 }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REVISION_NOT_MONOTONIC')
  );
  const repository = new FakeRepository();
  const service = new FixedClockProjectionService(repository as any);
  const inserted = await service.apply(fixture());
  assert.equal(inserted.status, 'INSERTED');
  assert.equal(repository.connectCalls, 1);
  assert.equal(repository.inserts, 1);
  const replay = await service.apply(fixture());
  assert.equal(replay.status, 'REPLAY');
  assert.equal(repository.inserts, 1);

  await assert.rejects(
    service.apply({ ...fixture(), basePriceMinor: 399999 }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_IMMUTABLE_CONFLICT')
  );
  await assert.rejects(
    service.apply({ ...fixture(), revision: 3 }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REVISION_NOT_MONOTONIC')
  );
  const revokedFixture = { ...fixture(), revision: 2, state: 'REVOKED' };
  assert.equal((await service.apply(revokedFixture)).status, 'INSERTED');
  assert.equal((await service.apply(revokedFixture)).status, 'REPLAY');
  await assert.rejects(
    service.apply({ ...fixture(), revision: 3 }),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_REACTIVATION_FORBIDDEN')
  );

  enableApply();
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'other-tenant';
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_TENANT_MISMATCH')
  );
  enableApply();
  process.env.SUBSCRIPTIONS_SYNTHETIC_CANONICAL_STATION_IDS = 'station:other';
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_STATION_FORBIDDEN')
  );

  enableApply();
  const raceRepository = new FakeRepository();
  raceRepository.duplicateOnInsert = true;
  raceRepository.raced = prepared;
  const raceReplay = await new FixedClockProjectionService(raceRepository as any)
    .apply(fixture());
  assert.equal(raceReplay.status, 'REPLAY');
  assert.equal(raceRepository.inserts, 1);

  const controller = await readFile('src/subscriptions/subscriptions.controller.ts', 'utf8');
  assert.doesNotMatch(controller, /synthetic-canonical|syntheticCanonical/i);
  const moduleSource = await readFile('src/subscriptions/subscriptions.module.ts', 'utf8');
  assert.doesNotMatch(moduleSource, /SyntheticCanonicalProjection/);
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(
    packageJson.scripts['subscriptions:synthetic-projection:check'],
    /--check/
  );
  assert.match(
    packageJson.scripts['subscriptions:synthetic-projection:apply'],
    /--apply/
  );
  assert.match(
    packageJson.scripts['subscriptions:synthetic-indexes:apply'],
    /managed-subscriptions-synthetic-indexes/
  );
  const indexWrapper = await readFile(
    'scripts/managed-subscriptions-synthetic-indexes.ts',
    'utf8'
  );
  assert.match(indexWrapper, /assertSyntheticProjectionApplyBoundary\(\)/);
  assert.match(indexWrapper, /SUBSCRIPTIONS_INDEX_APPLY/);
}

run()
  .then(() => console.log('subscriptions synthetic canonical projection tests: OK'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(restoreEnv);
