import * as assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import { StoredSubscriptionCanonicalTargetSnapshot } from '../src/subscriptions/subscriptions.types';

const ENV_NAMES = [
  'SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED',
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

const snapshotFixture = (): StoredSubscriptionCanonicalTargetSnapshot => ({
  schemaVersion: 1,
  snapshotId: 'target_snapshot:exercise-synthetic-1:r7',
  tenantId: 'iSkq6G',
  targetId: 'exercise:synthetic-1',
  action: 'JOIN_GAME',
  state: 'ACTIVE',
  revision: 7,
  stationId: 'station:yasenevo',
  category: 'GAME',
  externalEventTypeId: 'event_type:open-game',
  productTypeId: null,
  durationMinutes: 60,
  startsAt: '2026-08-20T06:00:00.000Z',
  basePriceMinor: 400000,
  currency: 'RUB',
  dictionaryRevision: 'dictionary:2026-08-19',
  evidenceRef: 'evidence:canonical-target-read',
  priceEvidenceRef: 'evidence:canonical-price-read',
  sourceKind: 'CANONICAL_TARGET_PROJECTION',
  observedAt: '2026-08-19T09:59:50.000Z',
  expiresAt: '2026-08-19T10:00:50.000Z',
  createdAt: '2026-08-19T09:59:51.000Z'
});

class FixedClockResolver extends SubscriptionCanonicalTargetResolverService {
  protected override now(): Date {
    return new Date('2026-08-19T10:00:00.000Z');
  }
}

const hasDomainCode = (code: string) => (error: unknown): boolean => {
  if (!(error instanceof ServiceUnavailableException)) return false;
  const response = error.getResponse();
  return Boolean(response && typeof response === 'object'
    && (response as Record<string, unknown>).code === code);
};

async function run(): Promise<void> {
  let connectCalls = 0;
  let reads = 0;
  let current: StoredSubscriptionCanonicalTargetSnapshot | null = snapshotFixture();
  let latest: StoredSubscriptionCanonicalTargetSnapshot | null = snapshotFixture();
  const repository = {
    connectReadOnly: async () => { connectCalls += 1; },
    runtimeCanonicalTargetSnapshot: async (input: unknown) => {
      reads += 1;
      assert.deepEqual(input, {
        tenantId: 'iSkq6G',
        targetId: 'exercise:synthetic-1',
        action: 'JOIN_GAME',
        revision: 7
      });
      return current;
    },
    runtimeLatestCanonicalTargetSnapshot: async () => latest
  } as any;
  const resolver = new FixedClockResolver(repository);
  const reference = {
    tenantId: 'iSkq6G',
    targetId: 'exercise:synthetic-1',
    action: 'JOIN_GAME' as const,
    snapshotRevision: 7
  };

  delete process.env.SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED;
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_DISABLED')
  );
  assert.equal(connectCalls, 0);
  assert.equal(reads, 0);

  process.env.SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '60';
  const resolved = await resolver.resolve(reference);
  assert.equal(connectCalls, 1);
  assert.equal(reads, 1);
  assert.deepEqual(resolved, {
    resolutionSource: 'SERVER',
    targetId: 'exercise:synthetic-1',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: '2026-08-20T06:00:00.000Z',
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-08-19',
    evidenceRef: 'evidence:canonical-target-read',
    priceEvidenceRef: 'evidence:canonical-price-read',
    resolvedAt: '2026-08-19T09:59:50.000Z'
  });

  latest = { ...snapshotFixture(), revision: 8 };
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_SUPERSEDED')
  );
  latest = { ...snapshotFixture(), revision: 8, state: 'REVOKED' };
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_REVOKED')
  );
  latest = snapshotFixture();

  current = null;
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_NOT_FOUND')
  );
  current = { ...snapshotFixture(), state: 'REVOKED' };
  latest = current;
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_REVOKED')
  );
  current = {
    ...snapshotFixture(),
    observedAt: '2026-08-19T09:58:59.000Z',
    createdAt: '2026-08-19T09:59:00.000Z'
  };
  latest = current;
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_STALE')
  );
  current = { ...snapshotFixture(), expiresAt: '2026-08-19T10:00:00.000Z' };
  latest = current;
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_EXPIRED')
  );
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS = '10';
  await assert.rejects(
    resolver.resolve(reference),
    hasDomainCode('SUBSCRIPTIONS_CANONICAL_TARGET_STALENESS_CONFIG_INVALID')
  );
}

run()
  .then(() => console.log('subscriptions canonical target resolver tests: OK'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(restoreEnv);
