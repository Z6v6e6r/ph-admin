import * as assert from 'node:assert/strict';
import {
  ForbiddenException,
  ServiceUnavailableException
} from '@nestjs/common';
import { SubscriptionPolicyRegistryService } from '../src/subscriptions/subscription-policy-registry.service';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const TOKEN = 'policy-registry-integration-token-0123456789';

const ENV_NAMES = [
  'SUBSCRIPTIONS_POLICY_REGISTRY_ENABLED',
  'SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_TOKEN'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const restoreEnv = (): void => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

function projection(): Record<string, unknown> {
  return {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:alpha',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: '2026-09-01T00:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: true, max: 8, scope: 'ALL_BOOKINGS' },
    bookingWindow: { enabled: true, days: 7 },
    dailyUsageLimit: 1,
    dailyUsagePolicy: {
      actions: ['CREATE_GAME', 'JOIN_GAME'],
      limitExceeded: 'BLOCK',
      percentage: null
    },
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [
      {
        ruleId: 'home',
        enabled: true,
        priority: 1,
        selector: { kind: 'HOME_STATION', stationIds: [] },
        surcharge: { kind: 'NONE', amountMinor: 0 }
      }
    ],
    benefitRules: [
      {
        ruleId: 'join-free',
        enabled: true,
        category: 'GAME',
        actions: ['JOIN_GAME'],
        externalEventTypeIds: ['viva:direction:4588:type:1613'],
        productTypeIds: [],
        durationMinutes: [60, 90, 120],
        stationIds: ['station:1'],
        kind: 'FREE_ENTITLEMENT',
        valueMinor: null,
        percentage: null,
        partialPrice: null,
        priority: 1
      }
    ],
    lifecycle: {
      allowBookingsAfterExpiry: false,
      activationMode: 'FIRST_USE',
      activationWindowDays: 30,
      fixedActivationAt: null,
      fixedActivationTimeZone: 'Europe/Moscow',
      validityDays: 365
    },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: []
    }
  };
}

function publication(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 3,
    publicationId: 'publication:alpha:v3',
    subscriptionTypeId: 'subscription_type:alpha',
    policyVersion: 3,
    policyDigest: `sha256:${'a'.repeat(64)}`,
    mappingId: 'mapping:alpha',
    dictionaryRevision: 'dictionary:1',
    runtimeProjection: projection(),
    state: 'PUBLISHED',
    effectiveAt: '2026-09-01T00:00:00.000Z',
    publishedAt: '2026-08-31T00:00:00.000Z',
    publishedBy: 'staff:1',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:1',
    approvalAuditRef: 'approval:1',
    ...overrides
  };
}

function policyVersion(version: number, status: string, applyTo: string): Record<string, unknown> {
  return {
    modelVersion: 3,
    subscriptionTypeId: 'subscription_type:alpha',
    version,
    revision: 1,
    status,
    effectiveAt: '2026-09-01T00:00:00.000Z',
    applyTo
  };
}

function subscriptionType(
  id: string,
  code: string,
  title: string,
  currentPolicyVersion: number | null = null
): Record<string, unknown> {
  return {
    subscriptionTypeId: id,
    code,
    title,
    description: null,
    state: 'ACTIVE',
    currentPolicyVersion,
    revision: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  };
}

function fakeRepository(input: {
  types: Array<Record<string, unknown>>;
  publications?: Record<string, Record<string, unknown>[]>;
  versions?: Record<string, Record<string, unknown>[]>;
  contexts?: Record<string, Record<string, unknown>>;
  onCall?: () => void;
}): SubscriptionsRepository {
  const byType = (source: Record<string, Record<string, unknown>[]> | undefined, id: string) =>
    source?.[id] ?? [];
  return {
    connectReadOnly: async () => {
      input.onCall?.();
    },
    listSubscriptionTypes: async (afterId: string | null, limit: number) => {
      const ordered = input.types as Array<{ subscriptionTypeId: string }>;
      const filtered = afterId
        ? ordered.filter((type) => type.subscriptionTypeId > afterId)
        : ordered;
      return filtered.slice(0, limit);
    },
    listPolicyVersions: async (id: string) => byType(input.versions, id),
    runtimePolicyPublicationHistoryByType: async (id: string) => byType(input.publications, id),
    runtimePolicyRegistryContext: async (id: string) =>
      input.contexts?.[id] ?? {
        instances: { total: 0, byPolicyVersion: [] },
        lastLedgerEvent: null,
        lastDecisionOperation: null
      }
  } as unknown as SubscriptionsRepository;
}

function enableRegistry(): void {
  process.env.SUBSCRIPTIONS_POLICY_REGISTRY_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_TOKEN = TOKEN;
}

async function expectRejected(
  promise: Promise<unknown>,
  type: new (...args: never[]) => Error,
  expectedCode: string
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof type);
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const code =
      response && typeof response === 'object'
        ? (response as { code?: string }).code
        : undefined;
    assert.equal(code, expectedCode);
    return true;
  });
}

async function testRegistryReadsPersistedFacts(): Promise<void> {
  enableRegistry();
  const repository = fakeRepository({
    types: [subscriptionType('subscription_type:alpha', 'alpha', 'Alpha', 3)],
    versions: {
      'subscription_type:alpha': [
        policyVersion(3, 'PUBLISHED', 'ACTIVE_AND_NEW'),
        policyVersion(2, 'SUPERSEDED', 'NEW_ONLY'),
        policyVersion(4, 'DRAFT', 'NEW_ONLY')
      ]
    },
    publications: {
      'subscription_type:alpha': [
        publication(),
        publication({
          publicationId: 'publication:alpha:v2',
          policyVersion: 2,
          state: 'SUPERSEDED',
          effectiveAt: '2026-06-01T00:00:00.000Z',
          publishedAt: '2026-05-31T00:00:00.000Z',
          supersededAt: '2026-08-31T00:00:00.000Z'
        })
      ]
    },
    contexts: {
      'subscription_type:alpha': {
        instances: {
          total: 3,
          byPolicyVersion: [
            { policyVersion: 2, count: 1 },
            { policyVersion: 3, count: 2 }
          ]
        },
        lastLedgerEvent: {
          recordedAt: '2026-10-01T10:00:00.000Z',
          eventType: 'ENTITLEMENT_RESERVED',
          policyVersion: 3,
          policyDigest: `sha256:${'b'.repeat(64)}`,
          usageDelta: 1,
          moneyDeltaMinor: 0
        },
        lastDecisionOperation: {
          updatedAt: '2026-10-01T09:00:00.000Z',
          state: 'RESERVED',
          decision: {
            decisionKind: 'ENTITLEMENT',
            policyVersion: 3,
            policyDigest: `sha256:${'a'.repeat(64)}`,
            action: 'JOIN_GAME',
            usageUnits: 1
          }
        }
      }
    }
  });
  const result = await new SubscriptionPolicyRegistryService(repository).read(TOKEN);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.subscriptionTypeId, 'subscription_type:alpha');
  assert.deepEqual(item.surfaces, ['CREATE_GAME', 'JOIN_GAME']);
  assert.ok(item.rules);
  assert.equal(item.publication?.policyVersion, 3);
  assert.equal(item.publication?.applyTo, 'ACTIVE_AND_NEW');
  assert.equal(item.publication?.runtimeCompatibility, null);
  assert.deepEqual(item.instances, {
    total: 3,
    byPolicyVersion: [
      { policyVersion: 2, count: 1 },
      { policyVersion: 3, count: 2 }
    ]
  });
  assert.deepEqual(
    item.versions.map((version) => [version.policyVersion, version.status, version.publicationState]),
    [
      [3, 'PUBLISHED', 'PUBLISHED'],
      [2, 'SUPERSEDED', 'SUPERSEDED'],
      [4, 'DRAFT', null]
    ]
  );
  // The ledger event is newer than the operation snapshot.
  assert.equal(item.lastDecision?.source, 'LEDGER');
  assert.equal(item.lastDecision?.eventType, 'ENTITLEMENT_RESERVED');
  assert.equal(item.lastDecision?.usageDelta, 1);
  assert.deepEqual(result.totals, {
    subscriptionTypes: 1,
    publishedPolicies: 1,
    draftPolicies: 1,
    instances: 3
  });
}

async function testRegistryFallsBackToOperationAndLatestPublication(): Promise<void> {
  enableRegistry();
  const repository = fakeRepository({
    types: [subscriptionType('subscription_type:beta', 'beta', 'Beta')],
    versions: {
      'subscription_type:beta': [policyVersion(7, 'PUBLISHED', 'NEW_ONLY')]
    },
    publications: {
      'subscription_type:beta': [
        publication({
          publicationId: 'publication:beta:v7',
          subscriptionTypeId: 'subscription_type:beta',
          policyVersion: 7,
          effectiveAt: '2026-10-01T00:00:00.000Z',
          publishedAt: '2026-09-30T00:00:00.000Z',
          runtimeCompatibility: {
            adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
            contractVersion: 1,
            capabilityDigest: `sha256:${'c'.repeat(64)}`
          }
        })
      ]
    },
    contexts: {
      'subscription_type:beta': {
        instances: { total: 1, byPolicyVersion: [{ policyVersion: 7, count: 1 }] },
        lastLedgerEvent: null,
        lastDecisionOperation: {
          updatedAt: '2026-10-02T00:00:00.000Z',
          state: 'CONFIRMED',
          decision: {
            decisionKind: 'ENTITLEMENT',
            policyVersion: 7,
            policyDigest: `sha256:${'d'.repeat(64)}`,
            action: 'CREATE_GAME',
            usageUnits: 1
          }
        }
      }
    }
  });
  const item = (await new SubscriptionPolicyRegistryService(repository).read(TOKEN)).items[0]!;
  assert.equal(item.publication?.runtimeCompatibility?.adapterId, 'LK_REGIONAL_BOOKING_GATEWAY');
  assert.equal(item.lastDecision?.source, 'OPERATION');
  assert.equal(item.lastDecision?.operationState, 'CONFIRMED');
  assert.equal(item.lastDecision?.action, 'CREATE_GAME');
}

async function testRegistryWithoutPublication(): Promise<void> {
  enableRegistry();
  const repository = fakeRepository({
    types: [subscriptionType('subscription_type:gamma', 'gamma', 'Gamma')],
    versions: { 'subscription_type:gamma': [policyVersion(1, 'DRAFT', 'NEW_ONLY')] }
  });
  const result = await new SubscriptionPolicyRegistryService(repository).read(TOKEN);
  const item = result.items[0]!;
  assert.equal(item.publication, null);
  assert.equal(item.rules, null);
  assert.deepEqual(item.surfaces, []);
  assert.equal(item.lastDecision, null);
  assert.equal(result.totals.draftPolicies, 1);
}

async function testRegistryPagination(): Promise<void> {
  enableRegistry();
  const types = Array.from({ length: 101 }, (_, index) =>
    subscriptionType(
      `subscription_type:${String(index).padStart(4, '0')}`,
      `type-${index}`,
      `Type ${index}`
    )
  );
  const repository = fakeRepository({ types });
  const result = await new SubscriptionPolicyRegistryService(repository).read(TOKEN);
  assert.equal(result.items.length, 101);
  assert.equal(result.totals.subscriptionTypes, 101);
}

async function testRegistryGates(): Promise<void> {
  delete process.env.SUBSCRIPTIONS_POLICY_REGISTRY_ENABLED;
  delete process.env.SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_TOKEN;
  let calls = 0;
  const repository = fakeRepository({ types: [], onCall: () => (calls += 1) });
  const service = new SubscriptionPolicyRegistryService(repository);

  await expectRejected(
    service.read(TOKEN),
    ServiceUnavailableException,
    'SUBSCRIPTIONS_POLICY_REGISTRY_DISABLED'
  );

  process.env.SUBSCRIPTIONS_POLICY_REGISTRY_ENABLED = 'true';
  await expectRejected(
    service.read(TOKEN),
    ServiceUnavailableException,
    'SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_NOT_CONFIGURED'
  );

  process.env.SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_TOKEN = TOKEN;
  await expectRejected(
    service.read('wrong-integration-token-0123456789'),
    ForbiddenException,
    'SUBSCRIPTIONS_POLICY_REGISTRY_INTEGRATION_FORBIDDEN'
  );
  assert.equal(calls, 0, 'Rejected requests must not touch the repository');
}

async function run(): Promise<void> {
  try {
    await testRegistryReadsPersistedFacts();
    await testRegistryFallsBackToOperationAndLatestPublication();
    await testRegistryWithoutPublication();
    await testRegistryPagination();
    await testRegistryGates();
    console.log('subscriptions policy registry tests: OK');
  } finally {
    restoreEnv();
  }
}

run().catch((error) => {
  restoreEnv();
  console.error(error);
  process.exit(1);
});
