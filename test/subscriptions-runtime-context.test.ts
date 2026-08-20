import * as assert from 'node:assert/strict';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionRuntimeContextService } from '../src/subscriptions/subscription-runtime-context.service';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping
} from '../src/subscriptions/subscriptions.types';

const HASH = 'a'.repeat(64);
const TOKEN = 'runtime-context-token-'.repeat(2);
const PEPPER = 'runtime-context-pepper-'.repeat(2);
const NOW = '2026-08-20T10:00:00.000Z';
const ENV_NAMES = [
  'SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED',
  'SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

const publicationFixture = (): StoredSubscriptionPolicyPublication => {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    policyVersion: 1,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-20T09:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: false, max: null, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: false, days: null },
    dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [{
      ruleId: 'station_rule:piter', enabled: true, priority: 1,
      selector: { kind: 'STATION_LIST', stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b'] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [
      {
        ruleId: 'benefit:create-60', enabled: true, category: 'GAME',
        actions: ['CREATE_GAME'], externalEventTypeIds: ['event_type:open-game'],
        productTypeIds: [], durationMinutes: [60],
        stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b'],
        kind: 'FREE_ENTITLEMENT', valueMinor: null, percentage: null,
        partialPrice: null, priority: 1
      },
      {
        ruleId: 'benefit:join-60-120', enabled: true, category: 'GAME',
        actions: ['JOIN_GAME'], externalEventTypeIds: ['event_type:open-game'],
        productTypeIds: [], durationMinutes: [60, 90, 120],
        stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b'],
        kind: 'FREE_ENTITLEMENT', valueMinor: null, percentage: null,
        partialPrice: null, priority: 2
      }
    ],
    lifecycle: {
      allowBookingsAfterExpiry: false,
      activationMode: 'FIRST_USE_OR_FIXED_DATE',
      activationWindowDays: 0,
      fixedActivationAt: '2026-09-30T21:00:00.000Z',
      fixedActivationTimeZone: 'Europe/Moscow',
      validityDays: 365
    },
    usage: {
      weeklyUsageLimit: null, monthlyUsageLimit: null, maxFutureBookings: null,
      minHoursBetweenUses: 0, blackoutDates: []
    }
  };
  return {
    schemaVersion: 1,
    publicationId: 'publication:piter-friendship-v1',
    subscriptionTypeId: runtimeProjection.subscriptionTypeId,
    policyVersion: 1,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection),
    mappingId: 'mapping:piter-friendship',
    dictionaryRevision: 'dictionary:2026-08-20',
    runtimeProjection,
    state: 'PUBLISHED',
    effectiveAt: runtimeProjection.effectiveAt,
    publishedAt: '2026-08-20T09:00:00.000Z',
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:piter-friendship-v1',
    approvalAuditRef: 'audit:piter-friendship-v1'
  };
};

const mappingFixture = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:piter-friendship',
  tenantId: 'iSkq6G',
  provider: 'VIVA',
  providerProductId: 'product:piter-friendship',
  providerScope: { kind: 'STATION', scopeId: '1ea77cbf-bc36-49a1-96d6-f35c216a409b' },
  subscriptionTypeId: 'subscription_type:piter-friendship-12m',
  state: 'VERIFIED',
  evidenceRef: 'evidence:mapping-readback',
  verifiedAt: '2026-08-20T09:59:50.000Z',
  verifiedBy: 'admin:subscriptions',
  revision: 2,
  createdAt: '2026-08-20T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: '2026-08-20T09:59:50.000Z',
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions', key: 'mapping-create-piter',
    requestHash: HASH, correlationId: 'corr:mapping-piter'
  }
});

const instanceFixture = (): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:piter-1',
  tenantId: 'iSkq6G',
  subscriptionTypeId: 'subscription_type:piter-friendship-12m',
  policyVersion: 1,
  policyDigest: publicationFixture().policyDigest,
  mappingId: 'mapping:piter-friendship',
  provider: 'VIVA',
  providerProductId: 'product:piter-friendship',
  providerClientId: 'provider_client:piter-1',
  clientSubscriptionId: 'client_subscription:piter-1',
  clientRefHash: '',
  homeStationId: '1ea77cbf-bc36-49a1-96d6-f35c216a409b',
  releaseProgramId: 'release_program:piter-2026',
  releasePhaseId: 'release_phase:piter-1',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: '2026-08-20T09:00:00.000Z',
  activeFrom: '2026-08-20T09:00:00.000Z',
  activeTo: '2027-08-19T20:59:59.999Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment-readback',
    providerInstanceEvidenceRef: 'evidence:provider-instance-readback',
    lastReadBackEvidenceRef: 'evidence:provider-instance-readback'
  },
  reconciliation: {
    state: 'CURRENT', asOf: '2026-08-20T09:59:50.000Z',
    evidenceRef: 'evidence:instance-current'
  },
  revision: 3,
  createdAt: '2026-08-20T09:00:00.000Z',
  updatedAt: '2026-08-20T09:59:50.000Z'
});

class FixedClockRuntimeContext extends SubscriptionRuntimeContextService {
  protected override now(): Date { return new Date(NOW); }
}

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = '3600';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'iSkq6G';
  process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = PEPPER;

  const { computeSubscriptionClientRefHash } = await import(
    '../src/subscriptions/subscription-trusted-shadow-adapter.service'
  );
  const instance = instanceFixture();
  instance.clientRefHash = computeSubscriptionClientRefHash({
    pepper: PEPPER, tenantId: 'iSkq6G', providerClientId: instance.providerClientId
  });
  let storedInstance: StoredSubscriptionInstance | null = instance;
  let mapping = mappingFixture();
  let publication = publicationFixture();
  const identity = {
    verifyTrustedBearer: async () => ({
      actor: {
        tenantKey: 'iSkq6G', clientId: instance.providerClientId,
        issuer: 'issuer:prod', subject: 'subject:piter-1'
      }
    })
  } as any;
  const repository = {
    connectReadOnly: async () => undefined,
    runtimeInstanceByProviderIdentity: async () => storedInstance,
    runtimeProviderMappingById: async () => mapping,
    runtimePolicyPublicationByVersion: async () => publication
  } as any;
  const service = new FixedClockRuntimeContext(identity, repository);

  const result = await service.resolve('Bearer user', TOKEN, {
    clientSubscriptionId: instance.clientSubscriptionId
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.policy.createGame.durationsMinutes.length, 1);
  assert.equal(result.policy.joinGame.maxDurationMinutes, 120);
  assert.deepEqual(result.policy.lifecycle, {
    allowBookingsAfterExpiry: false,
    activationMode: 'FIRST_USE_OR_FIXED_DATE',
    activationWindowDays: 0,
    fixedActivationAt: '2026-09-30T21:00:00.000Z',
    fixedActivationTimeZone: 'Europe/Moscow',
    validityDays: 365
  });
  assert.equal(result.instance.subscriptionInstanceId, instance.subscriptionInstanceId);
  assert.equal(result.evidence.mappingRevision, 2);
  assert.doesNotMatch(JSON.stringify(result), /provider_client|clientRefHash|phone|paymentEvidence/);

  await assert.rejects(
    service.resolve('Bearer user', 'wrong-token', { clientSubscriptionId: instance.clientSubscriptionId }),
    (error) => error instanceof ForbiddenException
  );
  storedInstance = null;
  await assert.rejects(
    service.resolve('Bearer user', TOKEN, { clientSubscriptionId: instance.clientSubscriptionId }),
    (error) => error instanceof NotFoundException
  );
  storedInstance = instance;
  mapping = { ...mapping, state: 'DISABLED' };
  await assert.rejects(
    service.resolve('Bearer user', TOKEN, { clientSubscriptionId: instance.clientSubscriptionId }),
    (error) => error instanceof ServiceUnavailableException
  );
  mapping = mappingFixture();
  publication = { ...publication, state: 'DISABLED_FOR_NEW_OPERATIONS' };
  await assert.rejects(
    service.resolve('Bearer user', TOKEN, { clientSubscriptionId: instance.clientSubscriptionId }),
    (error) => error instanceof ServiceUnavailableException
  );

  console.log('subscriptions runtime context tests passed');
}

main().finally(() => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
