import * as assert from 'node:assert/strict';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import {
  SubscriptionActivationService
} from '../src/subscriptions/subscription-activation.service';
import {
  computeSubscriptionRuntimeProjectionDigest,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionRuntimeOperation,
  validateStoredSubscriptionUsageLedgerEvent
} from '../src/subscriptions/subscription-runtime-contracts';
import { computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping
} from '../src/subscriptions/subscriptions.types';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const TOKEN = 'activation-integration-token-'.repeat(2);
const PEPPER = 'activation-hash-pepper-'.repeat(2);
const TENANT = 'iSkq6G';
const PROVIDER_CLIENT = 'provider_client:piter-1';
const ENV_NAMES = [
  'SUBSCRIPTIONS_ACTIVATION_ENABLED',
  'SUBSCRIPTIONS_ACTIVATION_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_ACTIVATION_MAX_STALENESS_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED'
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
      ruleId: 'station_rule:piter',
      enabled: true,
      priority: 1,
      selector: {
        kind: 'STATION_LIST',
        stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b']
      },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [{
      ruleId: 'benefit:create-60',
      enabled: true,
      category: 'GAME',
      actions: ['CREATE_GAME'],
      externalEventTypeIds: ['event_type:open-game'],
      productTypeIds: [],
      durationMinutes: [60],
      stationIds: ['1ea77cbf-bc36-49a1-96d6-f35c216a409b'],
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 1
    }],
    lifecycle: {
      allowBookingsAfterExpiry: false,
      activationMode: 'FIRST_USE_OR_FIXED_DATE',
      activationWindowDays: 0,
      fixedActivationAt: '2026-09-30T21:00:00.000Z',
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

const mappingFixture = (verifiedAt: string): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:piter-friendship',
  tenantId: TENANT,
  provider: 'VIVA',
  providerProductId: 'product:piter-friendship',
  providerScope: {
    kind: 'STATION',
    scopeId: '1ea77cbf-bc36-49a1-96d6-f35c216a409b'
  },
  subscriptionTypeId: 'subscription_type:piter-friendship-12m',
  state: 'VERIFIED',
  evidenceRef: 'evidence:mapping-readback',
  verifiedAt,
  verifiedBy: 'admin:subscriptions',
  revision: 2,
  createdAt: '2026-08-20T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: verifiedAt,
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-create-piter',
    requestHash: 'a'.repeat(64),
    correlationId: 'corr:mapping-piter'
  }
});

const instanceFixture = (
  publication: StoredSubscriptionPolicyPublication,
  reconciliationAsOf: string
): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:piter-1',
  tenantId: TENANT,
  subscriptionTypeId: publication.subscriptionTypeId,
  policyVersion: publication.policyVersion,
  policyDigest: publication.policyDigest,
  mappingId: publication.mappingId,
  provider: 'VIVA',
  providerProductId: 'product:piter-friendship',
  providerClientId: PROVIDER_CLIENT,
  clientSubscriptionId: 'client_subscription:piter-1',
  clientRefHash: computeSubscriptionClientRefHash({
    pepper: PEPPER,
    tenantId: TENANT,
    providerClientId: PROVIDER_CLIENT
  }),
  homeStationId: '1ea77cbf-bc36-49a1-96d6-f35c216a409b',
  releaseProgramId: 'release_program:piter-2026',
  releasePhaseId: 'release_phase:piter-1',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'PENDING_ACTIVATION',
  purchasedAt: '2026-08-20T09:00:00.000Z',
  activeFrom: null,
  activeTo: null,
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment-readback',
    providerInstanceEvidenceRef: 'evidence:provider-instance-readback',
    lastReadBackEvidenceRef: 'evidence:provider-instance-readback'
  },
  reconciliation: {
    state: 'CURRENT',
    asOf: reconciliationAsOf,
    evidenceRef: 'evidence:provider-instance-readback'
  },
  revision: 1,
  createdAt: '2026-08-20T09:00:00.000Z',
  updatedAt: reconciliationAsOf
});

class FixedClockActivationService extends SubscriptionActivationService {
  current = new Date('2026-08-21T10:00:00.000Z');
  protected override now(): Date {
    return new Date(this.current);
  }
}

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_ACTIVATION_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_ACTIVATION_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_ACTIVATION_MAX_STALENESS_SECONDS = '3600';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = TENANT;
  process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = PEPPER;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';

  const publication = publicationFixture();
  let mapping = mappingFixture('2026-08-21T09:59:50.000Z');
  let stored = instanceFixture(publication, '2026-08-21T09:59:50.000Z');
  let persistedInput: any = null;
  const identity = {
    verifyTrustedBearer: async () => ({
      actor: { tenantKey: TENANT, clientId: PROVIDER_CLIENT }
    })
  } as any;
  const repository = {
    connect: async () => undefined,
    runtimeInstanceByProviderIdentity: async () => stored,
    runtimeInstanceByTenantAndId: async () => stored,
    runtimePolicyPublicationByVersion: async () => publication,
    runtimeProviderMappingById: async () => mapping,
    activateRuntimeInstance: async (input: any) => {
      persistedInput = input;
      if (stored.state === 'ACTIVE') return { instance: stored, activated: false };
      if (stored.revision !== input.expectedRevision) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_CAS_CONFLICT');
      }
      validateStoredSubscriptionRuntimeOperation(input.operation);
      validateStoredSubscriptionUsageLedgerEvent(input.ledger);
      stored = {
        ...stored,
        state: 'ACTIVE',
        activeFrom: input.activeFrom,
        activeTo: input.activeTo,
        evidence: {
          ...stored.evidence,
          lastReadBackEvidenceRef: input.providerEvidenceRef
        },
        reconciliation: input.reconciliation,
        revision: stored.revision + 1,
        updatedAt: input.updatedAt
      };
      return { instance: stored, activated: true };
    }
  } as any;
  const service = new FixedClockActivationService(identity, repository);
  const dto = {
    subscriptionInstanceId: stored.subscriptionInstanceId,
    clientSubscriptionId: stored.clientSubscriptionId,
    providerBookingId: 'booking:piter-first-use',
    expectedInstanceRevision: 1
  };

  const activated = await service.activateFirstUse('Bearer user', TOKEN, dto, {
    correlationId: 'corr:first-use'
  });
  assert.deepEqual(activated, {
    schemaVersion: 1,
    outcome: 'ACTIVATED',
    subscriptionInstanceId: 'subscription_instance:piter-1',
    state: 'ACTIVE',
    activeFrom: '2026-08-21T10:00:00.000Z',
    activeTo: '2027-08-21T09:59:59.999Z',
    revision: 2
  });
  assert.equal(persistedInput.operation.kind, 'ACTIVATION');
  assert.equal(persistedInput.ledger.eventType, 'INSTANCE_ACTIVATED');
  assert.equal(persistedInput.ledger.providerEvidenceRef, 'viva:booking:booking:piter-first-use');
  assert.equal(persistedInput.outbox.ledgerEventId, persistedInput.ledger.eventId);
  assert.equal(persistedInput.reconciliation.evidenceRef, 'viva:booking:booking:piter-first-use');
  assert.doesNotMatch(JSON.stringify(activated), /provider_client|clientRefHash|paymentEvidence/);

  let transactionInstance = instanceFixture(publication, '2026-08-21T09:59:50.000Z');
  const inserted: string[] = [];
  let transactionCount = 0;
  let sessionEnded = 0;
  const session = { marker: 'activation-session' } as any;
  session.withTransaction = async (callback: () => Promise<void>) => {
    transactionCount += 1;
    await callback();
  };
  session.endSession = async () => { sessionEnded += 1; };
  const transactionalRepository = Object.create(SubscriptionsRepository.prototype) as any;
  transactionalRepository.client = { startSession: () => session };
  transactionalRepository.runtimeInstances = () => ({
    findOne: async () => transactionInstance,
    findOneAndUpdate: async (_filter: unknown, update: any, options: any) => {
      assert.equal(options.session, session);
      transactionInstance = {
        ...transactionInstance,
        ...update.$set,
        revision: transactionInstance.revision + update.$inc.revision
      };
      return transactionInstance;
    }
  });
  transactionalRepository.runtimeOperations = () => ({
    insertOne: async (_document: unknown, options: any) => {
      assert.equal(options.session, session);
      inserted.push('operation');
    }
  });
  transactionalRepository.runtimeLedger = () => ({
    insertOne: async (_document: unknown, options: any) => {
      assert.equal(options.session, session);
      inserted.push('ledger');
    }
  });
  transactionalRepository.runtimeOutbox = () => ({
    insertOne: async (_document: unknown, options: any) => {
      assert.equal(options.session, session);
      inserted.push('outbox');
    }
  });
  const transactionResult = await transactionalRepository.activateRuntimeInstance(persistedInput);
  assert.equal(transactionResult.activated, true);
  assert.equal(transactionResult.instance.state, 'ACTIVE');
  assert.equal(transactionResult.instance.revision, 2);
  assert.deepEqual(inserted, ['operation', 'ledger', 'outbox']);
  assert.equal(transactionCount, 1);
  assert.equal(sessionEnded, 1);

  transactionInstance = instanceFixture(publication, '2026-08-21T09:59:50.000Z');
  inserted.length = 0;
  transactionalRepository.runtimeInstances = () => ({
    findOne: async () => transactionInstance,
    findOneAndUpdate: async () => null
  });
  await assert.rejects(
    transactionalRepository.activateRuntimeInstance(persistedInput),
    (error) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_ACTIVATION_CAS_CONFLICT'
  );
  assert.deepEqual(inserted, []);

  const replayed = await service.activateFirstUse('Bearer user', TOKEN, dto, {
    correlationId: 'corr:first-use-replay'
  });
  assert.equal(replayed.outcome, 'ALREADY_ACTIVE');
  assert.equal(replayed.revision, 2);

  await assert.rejects(
    service.activateFirstUse('Bearer user', 'wrong-token', dto, {}),
    (error) => error instanceof ForbiddenException
  );

  service.current = new Date('2026-10-01T00:00:05.000Z');
  mapping = mappingFixture('2026-10-01T00:00:01.000Z');
  stored = instanceFixture(publication, '2026-10-01T00:00:01.000Z');
  stored.evidence.providerInstanceEvidenceRef = 'evidence:deadline-provider-readback';
  const fixed = await service.activateFixedDeadline(stored.subscriptionInstanceId);
  assert.equal(fixed?.outcome, 'ACTIVATED');
  assert.equal(fixed?.activeFrom, '2026-09-30T21:00:00.000Z');
  assert.equal(fixed?.activeTo, '2027-09-30T20:59:59.999Z');
  assert.equal(persistedInput.operation.actor.type, 'SYSTEM');
  assert.equal(persistedInput.ledger.providerEvidenceRef, 'evidence:deadline-provider-readback');

  stored = instanceFixture(publication, '2026-09-30T20:59:59.000Z');
  await assert.rejects(
    service.activateFixedDeadline(stored.subscriptionInstanceId),
    (error) => error instanceof ServiceUnavailableException
  );

  console.log('subscriptions activation service tests passed');
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
