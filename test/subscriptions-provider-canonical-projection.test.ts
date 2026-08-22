import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildProviderCanonicalTargetSnapshot,
  providerProjectionInputFingerprint,
  SubscriptionProviderCanonicalProjectionService
} from '../src/subscriptions/subscription-provider-canonical-projection.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { StoredSubscriptionCanonicalTargetSnapshot } from '../src/subscriptions/subscriptions.types';

const ENV_NAMES = [
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_ENABLED',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_APPLY',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT_SHA256',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_APPROVAL_REF',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_STATION_IDS',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_AUTO_CREATE_INDEXES',
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

const digest = (kind: string, digit: string): string => `${kind}:sha256:${digit.repeat(64)}`;
const fixture = (): Record<string, unknown> => ({
  schemaVersion: 1,
  sourceMode: 'REVIEWED_PROVIDER_EVIDENCE',
  evidenceStatus: 'APPROVED',
  approvalRef: digest('provider_approval', 'a'),
  tenantId: 'iSkq6G',
  targetId: 'viva:exercise:exercise-1',
  action: 'JOIN_GAME',
  state: 'ACTIVE',
  revision: 1,
  stationId: 'station:piter',
  category: 'GAME',
  externalEventTypeId: 'viva:direction:4588:type:1613',
  productTypeId: null,
  durationMinutes: 60,
  startsAt: '2026-08-22T09:00:00.000Z',
  basePriceMinor: 400000,
  currency: 'RUB',
  priceUnit: 'RUB_MINOR',
  priceRounding: 'EXACT_INTEGER',
  dictionaryRevision: digest('provider_dictionary', 'b'),
  evidenceRef: digest('provider_evidence', 'c'),
  priceEvidenceRef: digest('provider_price_evidence', 'd'),
  observedAt: '2026-08-22T08:59:30.000Z',
  expiresAt: '2026-08-22T09:00:30.000Z'
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
    snapshot: StoredSubscriptionCanonicalTargetSnapshot
  ): Promise<void> {
    this.inserts += 1;
    if (this.duplicateOnInsert) throw new Error('duplicate');
    this.current = snapshot;
  }

  isDuplicateKey(): boolean {
    return this.duplicateOnInsert;
  }
}

class FixedClockProjectionService extends SubscriptionProviderCanonicalProjectionService {
  protected override now(): Date {
    return new Date('2026-08-22T09:00:00.000Z');
  }
}

const enableApply = (input: unknown): void => {
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_APPLY = 'CONFIRM';
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT_SHA256 =
    providerProjectionInputFingerprint(input);
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_APPROVAL_REF = digest('provider_approval', 'a');
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_STATION_IDS = 'station:piter';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'iSkq6G';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
};

async function run(): Promise<void> {
  const prepared = buildProviderCanonicalTargetSnapshot(fixture());
  assert.match(prepared.snapshotId, /^provider_target_snapshot:[a-f0-9]{64}$/);
  assert.equal(prepared.createdAt, prepared.observedAt);
  assert.deepEqual(
    prepared,
    buildProviderCanonicalTargetSnapshot(Object.fromEntries(Object.entries(fixture()).reverse()))
  );
  assert.equal(
    providerProjectionInputFingerprint(fixture()),
    providerProjectionInputFingerprint(Object.fromEntries(Object.entries(fixture()).reverse()))
  );

  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({ ...fixture(), evidenceStatus: 'SANITIZED' }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_EVIDENCE_NOT_APPROVED')
  );
  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({
      ...fixture(),
      evidenceRef: digest('synthetic_evidence', 'c')
    }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_TARGET_EVIDENCE_REQUIRED')
  );
  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({ ...fixture(), priceUnit: 'UNVERIFIED' }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_PRICE_UNIT_UNVERIFIED')
  );
  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({ ...fixture(), phone: 'forbidden' }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_SHAPE_INVALID')
  );
  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({
      ...fixture(),
      action: 'BOOK_TOURNAMENT'
    }),
    hasCode('SUBSCRIPTION_CANONICAL_TARGET_ACTION_CATEGORY_MISMATCH')
  );
  assert.throws(
    () => buildProviderCanonicalTargetSnapshot({
      ...fixture(),
      productTypeId: 'viva:product:add-on-1'
    }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_NON_ADD_ON_PRODUCT_TYPE_FORBIDDEN')
  );

  const disabledRepository = new FakeRepository();
  delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  await assert.rejects(
    new FixedClockProjectionService(disabledRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_RUNTIME_CONTRACTS_DISABLED')
  );
  assert.equal(disabledRepository.connectCalls, 0);

  enableApply(fixture());
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT_SHA256 =
    `sha256:${'0'.repeat(64)}`;
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_ATTESTATION_MISMATCH')
  );
  enableApply(fixture());
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_APPROVAL_REF = digest('provider_approval', 'f');
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_APPROVAL_ATTESTATION_MISMATCH')
  );
  enableApply(fixture());
  process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_STATION_IDS = 'station:other';
  const forbiddenStationRepository = new FakeRepository();
  await assert.rejects(
    new FixedClockProjectionService(forbiddenStationRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_STATION_FORBIDDEN')
  );
  assert.equal(forbiddenStationRepository.connectCalls, 0);

  enableApply(fixture());
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'true';
  const autoIndexRepository = new FakeRepository();
  await assert.rejects(
    new FixedClockProjectionService(autoIndexRepository as any).apply(fixture()),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_AUTO_INDEX_FALSE_REQUIRED')
  );
  assert.equal(autoIndexRepository.connectCalls, 0);

  const stale = {
    ...fixture(),
    observedAt: '2026-08-22T08:57:00.000Z',
    expiresAt: '2026-08-22T09:00:30.000Z'
  };
  enableApply(stale);
  const staleRepository = new FakeRepository();
  await assert.rejects(
    new FixedClockProjectionService(staleRepository as any).apply(stale),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_NOT_CURRENT')
  );
  assert.equal(staleRepository.connectCalls, 0);

  enableApply(fixture());
  const revokeWithoutTarget = { ...fixture(), state: 'REVOKED' };
  enableApply(revokeWithoutTarget);
  await assert.rejects(
    new FixedClockProjectionService(new FakeRepository() as any).apply(revokeWithoutTarget),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_REVOKE_TARGET_REQUIRED')
  );

  enableApply(fixture());
  const repository = new FakeRepository();
  const service = new FixedClockProjectionService(repository as any);
  assert.equal((await service.apply(fixture())).status, 'INSERTED');
  assert.equal((await service.apply(fixture())).status, 'REPLAY');
  assert.equal(repository.inserts, 1);
  await assert.rejects(
    service.apply({ ...fixture(), basePriceMinor: 399999 }),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_INPUT_ATTESTATION_MISMATCH')
  );

  const revision2 = { ...fixture(), revision: 2 };
  enableApply(revision2);
  assert.equal((await service.apply(revision2)).status, 'INSERTED');
  const revision4 = { ...fixture(), revision: 4 };
  enableApply(revision4);
  await assert.rejects(
    service.apply(revision4),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_REVISION_NOT_MONOTONIC')
  );
  const revoked = { ...fixture(), revision: 3, state: 'REVOKED' };
  enableApply(revoked);
  assert.equal((await service.apply(revoked)).status, 'INSERTED');
  const reactivated = { ...fixture(), revision: 4 };
  enableApply(reactivated);
  await assert.rejects(
    service.apply(reactivated),
    hasCode('SUBSCRIPTIONS_PROVIDER_PROJECTION_REACTIVATION_FORBIDDEN')
  );

  enableApply(fixture());
  const raceRepository = new FakeRepository();
  raceRepository.duplicateOnInsert = true;
  raceRepository.raced = prepared;
  assert.equal(
    (await new FixedClockProjectionService(raceRepository as any).apply(fixture())).status,
    'REPLAY'
  );

  const controller = await readFile('src/subscriptions/subscriptions.controller.ts', 'utf8');
  assert.doesNotMatch(controller, /provider-canonical-projection|providerCanonicalProjection/i);
  const moduleSource = await readFile('src/subscriptions/subscriptions.module.ts', 'utf8');
  assert.doesNotMatch(moduleSource, /ProviderCanonicalProjection/);
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(packageJson.scripts['subscriptions:provider-projection:check'], /--check/);
  assert.equal(packageJson.scripts['subscriptions:provider-projection:apply'], undefined);
  const envExample = await readFile('deploy/.env.app.example', 'utf8');
  assert.match(envExample, /^SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_ENABLED=false$/m);
}

run()
  .then(() => console.log('subscriptions provider canonical projection tests: OK'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(restoreEnv);
