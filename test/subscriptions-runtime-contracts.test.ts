import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  ADMIN_PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS
} from '../src/common/rbac/permissions';
import { Role } from '../src/common/rbac/role.enum';
import {
  computeSubscriptionRuntimeProjectionDigest,
  computeSubscriptionUsageLedgerEventHash,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionCanonicalTargetSnapshot,
  validateStoredSubscriptionEntitlementAggregate,
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionInstanceProjectorCheckpoint,
  validateStoredSubscriptionOutboxEvent,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProjectionFence,
  validateStoredSubscriptionProviderMapping,
  validateStoredSubscriptionRuntimeOperation,
  validateStoredSubscriptionUsageLedgerEvent
} from '../src/subscriptions/subscription-runtime-contracts';
import {
  SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES,
  SubscriptionsRepository
} from '../src/subscriptions/subscriptions.repository';
import {
  deriveSubscriptionProviderScope,
  subscriptionProviderScopeMatchesProjection
} from '../src/subscriptions/subscription-provider-scope';
import { buildSubscriptionProjectionFence } from '../src/subscriptions/subscription-projection-fence';
import {
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent
} from '../src/subscriptions/subscriptions.types';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const DIGEST: `sha256:${string}` = `sha256:${HASH}`;
const NOW = '2026-08-15T19:00:00.000Z';

const canonicalTargetFixture = (): StoredSubscriptionCanonicalTargetSnapshot => ({
  schemaVersion: 1,
  snapshotId: 'target_snapshot:exercise-synthetic-1:r1',
  tenantId: 'iSkq6G',
  targetId: 'exercise:synthetic-1',
  action: 'JOIN_GAME',
  state: 'ACTIVE',
  revision: 1,
  stationId: 'station:yasenevo',
  category: 'GAME',
  externalEventTypeId: 'event_type:open-game',
  productTypeId: null,
  durationMinutes: 60,
  startsAt: '2026-08-16T06:00:00.000Z',
  basePriceMinor: 400000,
  currency: 'RUB',
  dictionaryRevision: 'dictionary:2026-08-15',
  evidenceRef: 'evidence:canonical-target-read',
  priceEvidenceRef: 'evidence:canonical-price-read',
  sourceKind: 'CANONICAL_TARGET_PROJECTION',
  observedAt: '2026-08-15T18:59:50.000Z',
  expiresAt: '2026-08-15T19:00:50.000Z',
  createdAt: NOW
});

const mappingFixture = (): StoredSubscriptionProviderMapping => ({
  schemaVersion: 1,
  mappingId: 'mapping:friendship-12m',
  tenantId: 'iSkq6G',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerScope: { kind: 'TENANT', scopeId: 'iSkq6G' },
  subscriptionTypeId: 'subscription_type:friendship-12m',
  state: 'VERIFIED',
  evidenceRef: 'evidence:golden-har-product-lookup',
  verifiedAt: NOW,
  verifiedBy: 'admin:subscriptions',
  revision: 1,
  createdAt: NOW,
  createdBy: 'admin:subscriptions',
  updatedAt: NOW,
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-create-friendship-12m',
    requestHash: HASH,
    correlationId: 'corr:mapping-create'
  }
});

const publicationFixture = (): StoredSubscriptionPolicyPublication => {
  const document: StoredSubscriptionPolicyPublication = {
    schemaVersion: 1,
    publicationId: 'publication:friendship-12m-v3',
    subscriptionTypeId: 'subscription_type:friendship-12m',
    policyVersion: 3,
    policyDigest: DIGEST,
    mappingId: 'mapping:friendship-12m',
    dictionaryRevision: 'dictionary:2026-08-15',
    runtimeProjection: {
    runtimeSchemaVersion: 1,
    subscriptionTypeId: 'subscription_type:friendship-12m',
    policyVersion: 3,
    status: 'PUBLISHED',
    effectiveAt: '2026-08-16T00:00:00.000Z',
    timeZone: 'Europe/Moscow',
    createGame: { enabled: true, durationsMinutes: [60, 90, 120] },
    joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
    activeServicesLimit: { enabled: true, max: 3, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: true, days: 4 },
    dailyUsageLimit: 1,
    dailyUsagePolicy: {
      actions: ['CREATE_GAME', 'JOIN_GAME'],
      limitExceeded: 'PERCENT_DISCOUNT',
      percentage: 30
    },
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [{
      ruleId: 'station_rule:home',
      enabled: true,
      priority: 1,
      selector: { kind: 'HOME_STATION', stationIds: [] },
      surcharge: { kind: 'NONE', amountMinor: 0 }
    }],
    benefitRules: [{
      ruleId: 'benefit_rule:join-game',
      enabled: true,
      category: 'GAME',
      actions: ['JOIN_GAME'],
      externalEventTypeIds: ['event_type:open-game'],
      productTypeIds: [],
      durationMinutes: [60, 90, 120],
      stationIds: ['station:yasenevo'],
      kind: 'FREE_ENTITLEMENT',
      valueMinor: null,
      percentage: null,
      partialPrice: null,
      priority: 1
    }],
    lifecycle: { allowBookingsAfterExpiry: false },
    usage: {
      weeklyUsageLimit: null,
      monthlyUsageLimit: null,
      maxFutureBookings: null,
      minHoursBetweenUses: 0,
      blackoutDates: []
    }
    },
    state: 'PUBLISHED',
    effectiveAt: '2026-08-16T00:00:00.000Z',
    publishedAt: NOW,
    publishedBy: 'admin:subscriptions',
    supersededAt: null,
    supersededBy: null,
    impactPreviewRef: 'impact:friendship-12m-v3',
    approvalAuditRef: 'audit:friendship-12m-v3'
  };
  document.policyDigest = computeSubscriptionRuntimeProjectionDigest(document.runtimeProjection);
  return document;
};

const instanceFixture = (): StoredSubscriptionInstance => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  tenantId: 'iSkq6G',
  subscriptionTypeId: 'subscription_type:friendship-12m',
  policyVersion: 3,
  policyDigest: publicationFixture().policyDigest,
  mappingId: 'mapping:friendship-12m',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerClientId: 'provider_client:synthetic-1',
  clientSubscriptionId: 'client_subscription:synthetic-1',
  clientRefHash: HASH,
  homeStationId: 'station:yasenevo',
  releaseProgramId: 'release_program:friendship-2026',
  releasePhaseId: 'release_phase:first-50',
  purchasePrice: { amountMinor: 1980000, currency: 'RUB' },
  state: 'ACTIVE',
  purchasedAt: NOW,
  activeFrom: '2026-08-16T00:00:00.000Z',
  activeTo: '2027-08-15T23:59:59.999Z',
  frozenUntil: null,
  renewalPredecessorId: null,
  renewalSuccessorId: null,
  evidence: {
    paymentEvidenceRef: 'evidence:payment-readback',
    providerInstanceEvidenceRef: 'evidence:provider-instance-readback',
    lastReadBackEvidenceRef: 'evidence:provider-instance-readback'
  },
  reconciliation: { state: 'CURRENT', asOf: NOW, evidenceRef: 'evidence:instance-current' },
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW
});

const projectorCheckpointFixture = (): StoredSubscriptionInstanceProjectorCheckpoint => ({
  schemaVersion: 2,
  checkpointId: 'checkpoint:friendship-12m',
  tenantId: 'iSkq6G',
  provider: 'VIVA',
  providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
  providerScope: { kind: 'STATION', scopeId: 'station:yasenevo' },
  approvalRef: `provider_approval:sha256:${HASH}`,
  binding: {
    fenceId: 'subscription_projection_fence:friendship-12m',
    fenceRevision: 1,
    fenceDigest: DIGEST,
    mappingId: 'mapping:friendship-12m',
    mappingRevision: 1,
    subscriptionTypeId: 'subscription_type:friendship-12m',
    publicationId: 'publication:friendship-12m-v3',
    policyVersion: 3,
    policyDigest: DIGEST,
    releaseProgramId: 'release_program:friendship-12m',
    releaseProgramRevision: 1,
    releasePhaseId: 'release_phase:friendship-12m',
    runtimeCompatibility: {
      adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
      contractVersion: 1,
      capabilityDigest: DIGEST
    }
  },
  producer: {
    producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR',
    contractVersion: 2,
    producerCapabilityDigest: DIGEST,
    sourceContractDigest: DIGEST,
    authorityDigest: DIGEST
  },
  state: 'CURRENT',
  coverage: {
    kind: 'CONSISTENT_FULL_SNAPSHOT',
    snapshotId: 'snapshot:friendship-12m-20260815',
    snapshotDigest: DIGEST,
    coverageThrough: NOW,
    sourceItemCount: 4
  },
  reconciliation: {
    runId: 'run:friendship-12m-20260815',
    mode: 'INITIAL_FULL',
    startedAt: '2026-08-15T18:58:00.000Z',
    completedAt: NOW,
    sourceItemCount: 4,
    insertedCount: 2,
    updatedCount: 1,
    replayedCount: 1,
    terminalCount: 0,
    failureCount: 0,
    sourceEvidenceRef: `provider_snapshot_evidence:${DIGEST}`,
    resultEvidenceRef: `projection_result:${DIGEST}`,
    reconciliationDigest: DIGEST
  },
  failure: null,
  lease: null,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW
});

const projectionFenceFixture = (): StoredSubscriptionProjectionFence => ({
  schemaVersion: 1,
  fenceId: 'subscription_projection_fence:friendship-12m',
  subscriptionTypeId: 'subscription_type:friendship-12m',
  bindingRevision: 1,
  bindingDigest: DIGEST,
  binding: {
    mappingId: 'mapping:friendship-12m',
    mappingRevision: 1,
    subscriptionTypeId: 'subscription_type:friendship-12m',
    publicationId: 'publication:friendship-12m-v3',
    policyVersion: 3,
    policyDigest: DIGEST,
    runtimeCompatibility: {
      adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
      contractVersion: 1,
      capabilityDigest: DIGEST
    }
  },
  coordinationRevision: 1,
  lastProjectorReconciliationDigest: null,
  createdAt: NOW,
  updatedAt: NOW
});

const aggregateFixture = (): StoredSubscriptionEntitlementAggregate => ({
  schemaVersion: 1,
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  revision: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
  activeServiceCount: 1,
  activeServices: [{
    operationId: 'operation:booking-1',
    targetId: 'exercise:synthetic-1',
    startsAt: '2026-08-22T06:30:00.000Z',
    usageUnits: 1,
    state: 'RESERVED'
  }],
  dailyUsage: { '2026-08-22': 1 },
  weeklyUsage: { '2026-W34': 1 },
  monthlyUsage: { '2026-08': 1 },
  futureBookingCount: 1,
  futureServiceStartsAt: ['2026-08-22T06:30:00.000Z'],
  remainingUnits: 269,
  reconciliation: { state: 'CURRENT', asOf: NOW, evidenceRef: 'evidence:usage-current' },
  createdAt: NOW,
  updatedAt: NOW
});

const operationFixture = (): StoredSubscriptionRuntimeOperation => ({
  schemaVersion: 1,
  operationId: 'operation:booking-1',
  revision: 1,
  tenantId: 'iSkq6G',
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  kind: 'BOOKING',
  state: 'RESERVED',
  actor: { type: 'CLIENT', actorId: HASH },
  idempotency: { keyHash: HASH, requestHash: OTHER_HASH },
  correlationId: 'corr:booking-1',
  decision: {
    decisionKind: 'ENTITLEMENT',
    policyVersion: 3,
    policyDigest: publicationFixture().policyDigest,
    action: 'CREATE_GAME',
    target: {
      targetId: 'exercise:synthetic-1',
      stationId: 'station:yasenevo',
      eventTypeId: 'event_type:open-game',
      productTypeId: null,
      durationMinutes: 60,
      startsAt: '2026-08-22T06:30:00.000Z'
    },
    usageUnits: 1,
    money: {
      basePriceMinor: 400000,
      discountMinor: 400000,
      surchargeMinor: 0,
      finalPriceMinor: 0,
      currency: 'RUB'
    }
  },
  providerCorrelationId: null,
  providerEvidenceRefs: [],
  attempts: 0,
  nextAttemptAt: null,
  compensationState: 'NONE',
  lastReconciledAt: null,
  lastReconciliationResult: null,
  createdAt: NOW,
  updatedAt: NOW,
  terminalAt: null
});

const ledgerFixture = (): StoredSubscriptionUsageLedgerEvent => {
  const document: StoredSubscriptionUsageLedgerEvent = {
    schemaVersion: 1,
    eventId: 'ledger_event:booking-confirmed-1',
    eventHash: HASH,
    eventType: 'BOOKING_CONFIRMED',
    tenantId: 'iSkq6G',
    subscriptionInstanceId: 'subscription_instance:synthetic-1',
    operationId: 'operation:booking-1',
    correlationId: 'corr:booking-1',
    policyVersion: 3,
    policyDigest: publicationFixture().policyDigest,
    stationId: 'station:yasenevo',
    eventTypeId: 'event_type:open-game',
    productTypeId: null,
    moneyDeltaMinor: 0,
    currency: 'RUB',
    usageDelta: -1,
    providerEvidenceRef: 'evidence:booking-readback',
    actor: { type: 'SYSTEM', actorId: 'system:subscription-runtime' },
    occurredAt: NOW,
    recordedAt: NOW
  };
  document.eventHash = computeSubscriptionUsageLedgerEventHash(document);
  return document;
};

const outboxFixture = (): StoredSubscriptionOutboxEvent => ({
  schemaVersion: 1,
  outboxEventId: 'outbox:booking-confirmed-1',
  ledgerEventId: 'ledger_event:booking-confirmed-1',
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  topic: 'SUBSCRIPTION_LEDGER_EVENT',
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: NOW,
  deliveredAt: null,
  lastErrorCode: null,
  createdAt: NOW,
  updatedAt: NOW
});

const preInstancePurchaseLedgerFixture = (): StoredSubscriptionUsageLedgerEvent => {
  const document: StoredSubscriptionUsageLedgerEvent = {
    ...ledgerFixture(),
    eventId: 'ledger_event:purchase-reserved-1',
    eventType: 'PURCHASE_RESERVED',
    subscriptionInstanceId: null,
    operationId: 'operation:purchase-1',
    stationId: 'station:yasenevo',
    eventTypeId: null,
    usageDelta: 0,
    providerEvidenceRef: null
  };
  document.eventHash = computeSubscriptionUsageLedgerEventHash(document);
  return document;
};

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof SubscriptionRuntimeContractError && error.code === code;

async function run(): Promise<void> {
  validateStoredSubscriptionCanonicalTargetSnapshot(canonicalTargetFixture());
  validateStoredSubscriptionProviderMapping(mappingFixture());
  validateStoredSubscriptionProviderMapping({
    ...mappingFixture(),
    providerScope: { kind: 'STATION_SET', scopeId: `station-set:${HASH}` }
  });
  const stationSetProjection = publicationFixture().runtimeProjection;
  stationSetProjection.stationAccessRules[0].selector = {
    kind: 'STATION_LIST', stationIds: ['station:beta', 'station:alpha']
  };
  const stationSetScope = deriveSubscriptionProviderScope(
    stationSetProjection.stationAccessRules,
    'iSkq6G'
  );
  assert.equal(stationSetScope.kind, 'STATION_SET');
  assert.match(stationSetScope.scopeId, /^station-set:[a-f0-9]{64}$/);
  stationSetProjection.stationAccessRules[0].selector = {
    kind: 'STATION_LIST', stationIds: ['station:alpha', 'station:beta']
  };
  assert.deepEqual(
    deriveSubscriptionProviderScope(stationSetProjection.stationAccessRules, 'iSkq6G'),
    stationSetScope
  );
  assert.equal(
    subscriptionProviderScopeMatchesProjection(stationSetScope, stationSetProjection, 'iSkq6G'),
    true
  );
  assert.equal(
    subscriptionProviderScopeMatchesProjection(
      { kind: 'STATION_SET', scopeId: `station-set:${OTHER_HASH}` },
      stationSetProjection,
      'iSkq6G'
    ),
    false
  );
  validateStoredSubscriptionPolicyPublication(publicationFixture());
  const invalidDailyUsagePublication = publicationFixture();
  invalidDailyUsagePublication.runtimeProjection.dailyUsagePolicy = {
    actions: ['CREATE_GAME'],
    limitExceeded: 'BLOCK',
    percentage: 30
  };
  invalidDailyUsagePublication.policyDigest = computeSubscriptionRuntimeProjectionDigest(
    invalidDailyUsagePublication.runtimeProjection
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication(invalidDailyUsagePublication),
    hasCode('SUBSCRIPTION_PUBLICATION_DAILY_USAGE_DISCOUNT_INVALID')
  );
  const versionTwoPublication: StoredSubscriptionPolicyPublication = {
    ...publicationFixture(),
    schemaVersion: 2,
    idempotency: {
      actorId: 'admin:subscriptions',
      key: 'publish-friendship-12m-v3',
      requestHash: HASH,
      correlationId: 'corr:publish-v3'
    }
  };
  validateStoredSubscriptionPolicyPublication(versionTwoPublication);
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...versionTwoPublication,
      runtimeCompatibility: {
        adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
        contractVersion: 1,
        capabilityDigest: `sha256:${HASH}`
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_RUNTIME_COMPATIBILITY_UNATTESTED')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...versionTwoPublication,
      idempotency: undefined
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_IDEMPOTENCY_REQUIRED')
  );
  const versionThreePublication: StoredSubscriptionPolicyPublication = {
    ...versionTwoPublication,
    schemaVersion: 3,
    runtimeCompatibility: {
      adapterId: 'LK_REGIONAL_BOOKING_GATEWAY',
      contractVersion: 1,
      capabilityDigest: `sha256:${HASH}`
    }
  };
  validateStoredSubscriptionPolicyPublication(versionThreePublication);
  validateStoredSubscriptionPolicyPublication({
    ...versionThreePublication,
    runtimeCompatibility: {
      adapterId: 'future-booking-gateway',
      contractVersion: 2,
      capabilityDigest: `sha256:${HASH}`
    }
  });
  for (const adapterId of ['', ' invalid adapter ']) {
    assert.throws(
      () => validateStoredSubscriptionPolicyPublication({
        ...versionThreePublication,
        runtimeCompatibility: {
          ...versionThreePublication.runtimeCompatibility!,
          adapterId
        }
      }),
      hasCode('SUBSCRIPTION_RUNTIME_ID_INVALID')
    );
  }
  for (const contractVersion of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateStoredSubscriptionPolicyPublication({
        ...versionThreePublication,
        runtimeCompatibility: {
          ...versionThreePublication.runtimeCompatibility!,
          contractVersion
        }
      }),
      hasCode('SUBSCRIPTION_RUNTIME_COUNTER_INVALID')
    );
  }
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...versionThreePublication,
      runtimeCompatibility: undefined
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_RUNTIME_COMPATIBILITY_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...versionThreePublication,
      runtimeCompatibility: {
        ...versionThreePublication.runtimeCompatibility!,
        capabilityDigest: 'sha256:not-a-digest'
      }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_DIGEST_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...versionThreePublication,
      runtimeCompatibility: {
        ...versionThreePublication.runtimeCompatibility!,
        capabilityScope: 'unbound'
      } as typeof versionThreePublication.runtimeCompatibility
    }),
    hasCode('SUBSCRIPTION_RUNTIME_SHAPE_INVALID')
  );
  const hybridPublication = publicationFixture();
  hybridPublication.runtimeProjection.lifecycle = {
    allowBookingsAfterExpiry: false,
    activationMode: 'FIRST_USE_OR_FIXED_DATE',
    activationWindowDays: 0,
    fixedActivationAt: '2026-09-30T21:00:00.000Z',
    fixedActivationTimeZone: 'Europe/Moscow',
    validityDays: 365
  };
  hybridPublication.policyDigest = computeSubscriptionRuntimeProjectionDigest(
    hybridPublication.runtimeProjection
  );
  validateStoredSubscriptionPolicyPublication(hybridPublication);
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...hybridPublication,
      runtimeProjection: {
        ...hybridPublication.runtimeProjection,
        lifecycle: {
          ...hybridPublication.runtimeProjection.lifecycle,
          fixedActivationAt: null
        }
      }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TIMESTAMP_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...hybridPublication,
      runtimeProjection: {
        ...hybridPublication.runtimeProjection,
        lifecycle: {
          ...hybridPublication.runtimeProjection.lifecycle,
          activationWindowDays: 1
        }
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_ACTIVATION_WINDOW_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...hybridPublication,
      runtimeProjection: {
        ...hybridPublication.runtimeProjection,
        lifecycle: {
          ...hybridPublication.runtimeProjection.lifecycle,
          fixedActivationAt: '2026-08-15T23:59:59.999Z'
        }
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_ACTIVATION_DATE_BEFORE_EFFECTIVE_AT')
  );
  const reorderedProjection = Object.fromEntries(
    Object.entries(publicationFixture().runtimeProjection).reverse()
  ) as StoredSubscriptionPolicyPublication['runtimeProjection'];
  assert.equal(
    computeSubscriptionRuntimeProjectionDigest(reorderedProjection),
    publicationFixture().policyDigest
  );
  validateStoredSubscriptionInstance(instanceFixture());
  validateStoredSubscriptionProjectionFence(projectionFenceFixture());
  assert.throws(
    () => validateStoredSubscriptionProjectionFence({
      ...projectionFenceFixture(),
      binding: { ...projectionFenceFixture().binding, subscriptionTypeId: 'subscription_type:other' }
    }),
    hasCode('SUBSCRIPTION_PROJECTION_FENCE_BINDING_MISMATCH')
  );
  validateStoredSubscriptionInstanceProjectorCheckpoint(projectorCheckpointFixture());
  validateStoredSubscriptionInstanceProjectorCheckpoint({
    ...projectorCheckpointFixture(),
    coverage: {
      kind: 'ORDERED_CHANGE_FEED',
      watermark: `provider_watermark:${DIGEST}`,
      watermarkDigest: DIGEST,
      coverageThrough: NOW
    }
  });
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), provider: 'OTHER' as 'VIVA'
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_CHECKPOINT_SCHEMA_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), providerScope: { kind: 'STUDIO' as 'STATION', scopeId: 'studio:1' }
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_SCOPE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), providerScope: { kind: 'STATION_SET', scopeId: 'station-set:bad' }
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_SCOPE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(),
      producer: {
        ...projectorCheckpointFixture().producer,
        producerCapabilityDigest: 'bad' as `sha256:${string}`
      }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_DIGEST_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), reconciliation: { ...projectorCheckpointFixture().reconciliation, sourceItemCount: 1 }
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_COUNT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), reconciliation: { ...projectorCheckpointFixture().reconciliation, completedAt: '2026-08-15T18:57:00.000Z' }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), failure: { code: 'SOURCE_FAILED', detectedAt: NOW, evidenceRef: `provider_failure:${DIGEST}` }
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_CURRENT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), state: 'FAILED', failure: null
    }),
    hasCode('SUBSCRIPTION_INSTANCE_PROJECTOR_FAILED_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstanceProjectorCheckpoint({
      ...projectorCheckpointFixture(), lease: {
        runId: 'run:friendship-12m-20260815', epoch: 1, ownerIdHash: DIGEST,
        acquiredAt: NOW, expiresAt: '2026-08-15T18:59:00.000Z'
      }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TIME_ORDER_INVALID')
  );
  validateStoredSubscriptionEntitlementAggregate(aggregateFixture());
  validateStoredSubscriptionRuntimeOperation(operationFixture());
  validateStoredSubscriptionRuntimeOperation({
    ...operationFixture(),
    kind: 'PURCHASE',
    subscriptionInstanceId: null,
    decision: {
      decisionKind: 'PURCHASE',
      policyVersion: 3,
      policyDigest: publicationFixture().policyDigest,
      mappingId: 'mapping:friendship-12m',
      providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      releaseProgramId: 'release_program:friendship-2026',
      releasePhaseId: 'release_phase:first-50',
      stationId: 'station:yasenevo',
      quantity: 1,
      price: { amountMinor: 1980000, currency: 'RUB' }
    }
  });
  validateStoredSubscriptionUsageLedgerEvent(ledgerFixture());
  validateStoredSubscriptionOutboxEvent(outboxFixture());
  validateStoredSubscriptionUsageLedgerEvent(preInstancePurchaseLedgerFixture());
  validateStoredSubscriptionOutboxEvent({
    ...outboxFixture(),
    outboxEventId: 'outbox:purchase-reserved-1',
    ledgerEventId: 'ledger_event:purchase-reserved-1',
    subscriptionInstanceId: null
  });

  assert.throws(
    () => validateStoredSubscriptionCanonicalTargetSnapshot({
      ...canonicalTargetFixture(),
      category: 'TOURNAMENT'
    }),
    hasCode('SUBSCRIPTION_CANONICAL_TARGET_ACTION_CATEGORY_MISMATCH')
  );
  assert.throws(
    () => validateStoredSubscriptionCanonicalTargetSnapshot({
      ...canonicalTargetFixture(),
      createdAt: '2026-08-15T19:01:00.000Z'
    }),
    hasCode('SUBSCRIPTION_CANONICAL_TARGET_TIME_ORDER_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionProviderMapping({
      ...mappingFixture(),
      evidenceRef: null,
      verifiedAt: null,
      verifiedBy: null
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TEXT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionProviderMapping({
      ...mappingFixture(),
      state: 'UNKNOWN' as any
    }),
    hasCode('SUBSCRIPTION_PROVIDER_MAPPING_STATE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionProviderMapping({
      ...mappingFixture(),
      providerProductId: 123 as any
    }),
    hasCode('SUBSCRIPTION_RUNTIME_ID_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionProviderMapping({
      ...mappingFixture(),
      providerScope: { kind: 'STATION_SET', scopeId: 'station-set:not-a-digest' }
    }),
    hasCode('SUBSCRIPTION_PROVIDER_SCOPE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      runtimeProjection: { ...publicationFixture().runtimeProjection, policyVersion: 4 }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_PROJECTION_MISMATCH')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      policyDigest: `sha256:${OTHER_HASH}`
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_DIGEST_MISMATCH')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      runtimeProjection: {
        ...publicationFixture().runtimeProjection,
        bookingWindow: { enabled: true, days: 15 }
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_BOOKING_WINDOW_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      policyVersion: '3' as any
    }),
    hasCode('SUBSCRIPTION_RUNTIME_COUNTER_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      runtimeProjection: {
        ...publicationFixture().runtimeProjection,
        stationAccessRules: [{
          ...publicationFixture().runtimeProjection.stationAccessRules[0],
          surcharge: { kind: 'NONE', amountMinor: 100 }
        }]
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_STATION_SURCHARGE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      runtimeProjection: {
        ...publicationFixture().runtimeProjection,
        benefitRules: [{
          ...publicationFixture().runtimeProjection.benefitRules[0],
          kind: 'PERCENT_DISCOUNT',
          percentage: 101
        }]
      }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_BENEFIT_VALUE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionPolicyPublication({
      ...publicationFixture(),
      runtimeProjection: { ...publicationFixture().runtimeProjection, benefitRules: [] }
    }),
    hasCode('SUBSCRIPTION_PUBLICATION_ENABLED_BENEFIT_REQUIRED')
  );
  assert.throws(
    () => validateStoredSubscriptionInstance({
      ...instanceFixture(),
      evidence: { ...instanceFixture().evidence, paymentEvidenceRef: null }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TEXT_INVALID')
  );
  validateStoredSubscriptionInstance({
    ...instanceFixture(),
    state: 'REFUNDED_PRE_ACTIVATION',
    activeFrom: null,
    activeTo: null,
    evidence: {
      paymentEvidenceRef: 'evidence:payment-readback',
      providerInstanceEvidenceRef: null,
      lastReadBackEvidenceRef: 'evidence:refund-readback'
    }
  });
  assert.throws(
    () => validateStoredSubscriptionInstance({
      ...instanceFixture(),
      activeFrom: '2027-08-16T00:00:00.000Z'
    }),
    hasCode('SUBSCRIPTION_INSTANCE_ACTIVE_RANGE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionInstance({
      ...instanceFixture(),
      state: 'FROZEN',
      frozenUntil: '2026-09-01T00:00:00.000Z',
      evidence: {
        paymentEvidenceRef: null,
        providerInstanceEvidenceRef: null,
        lastReadBackEvidenceRef: null
      }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TEXT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionEntitlementAggregate({
      ...aggregateFixture(),
      activeServiceCount: 2
    }),
    hasCode('SUBSCRIPTION_AGGREGATE_ACTIVE_COUNT_MISMATCH')
  );
  assert.throws(
    () => validateStoredSubscriptionEntitlementAggregate({
      ...aggregateFixture(),
      activeServiceScope: 'UNKNOWN' as any
    }),
    hasCode('SUBSCRIPTION_AGGREGATE_ACTIVE_SCOPE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionEntitlementAggregate({
      ...aggregateFixture(),
      dailyUsage: { '2026-08-22': -1 }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_COUNTER_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      idempotency: { ...operationFixture().idempotency, requestHash: 'not-a-hash' }
    }),
    hasCode('SUBSCRIPTION_RUNTIME_HASH_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      decision: {
        ...operationFixture().decision!,
        money: {
          ...(operationFixture().decision as any).money,
          finalPriceMinor: 1
        }
      } as any
    }),
    hasCode('SUBSCRIPTION_OPERATION_MONEY_INVARIANT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      state: 'UNKNOWN' as any
    }),
    hasCode('SUBSCRIPTION_OPERATION_STATE_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      state: 'CONFIRMED',
      terminalAt: NOW
    }),
    hasCode('SUBSCRIPTION_OPERATION_PROVIDER_EVIDENCE_REQUIRED')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      state: 'CONFIRMED',
      providerEvidenceRefs: ['evidence:booking-readback'],
      terminalAt: null
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TIMESTAMP_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionRuntimeOperation({
      ...operationFixture(),
      kind: 'PURCHASE'
    }),
    hasCode('SUBSCRIPTION_OPERATION_PURCHASE_DECISION_REQUIRED')
  );
  assert.throws(
    () => validateStoredSubscriptionUsageLedgerEvent({
      ...ledgerFixture(),
      providerEvidenceRef: null
    }),
    hasCode('SUBSCRIPTION_RUNTIME_TEXT_INVALID')
  );
  assert.throws(
    () => validateStoredSubscriptionUsageLedgerEvent({
      ...ledgerFixture(),
      eventType: 'UNKNOWN' as any
    }),
    hasCode('SUBSCRIPTION_LEDGER_EVENT_TYPE_INVALID')
  );
  assert.throws(
    () => {
      const document = {
        ...preInstancePurchaseLedgerFixture(),
        eventType: 'PURCHASE_PAID' as const,
        providerEvidenceRef: 'evidence:payment-readback'
      };
      document.eventHash = computeSubscriptionUsageLedgerEventHash(document);
      validateStoredSubscriptionUsageLedgerEvent(document);
    },
    hasCode('SUBSCRIPTION_LEDGER_INSTANCE_REQUIRED')
  );
  assert.throws(
    () => validateStoredSubscriptionOutboxEvent({
      ...outboxFixture(),
      status: 'DELIVERED',
      deliveredAt: null
    }),
    hasCode('SUBSCRIPTION_OUTBOX_DELIVERY_TIMESTAMP_REQUIRED')
  );
  assert.throws(
    () => validateStoredSubscriptionOutboxEvent({
      ...outboxFixture(),
      status: 'DEAD_LETTER',
      lastErrorCode: null
    }),
    hasCode('SUBSCRIPTION_OUTBOX_ERROR_CODE_REQUIRED')
  );

  const indexGroups = Object.values(SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES);
  const indexNames = indexGroups.flatMap((group) => group.map((index) => index.name));
  assert.equal(new Set(indexNames).size, indexNames.length);
  assert.ok(indexNames.length >= 20);
  const indexScript = fs.readFileSync('scripts/managed-subscriptions-indexes.mjs', 'utf8');
  const indexPlanner = fs.readFileSync('scripts/managed-subscriptions-indexes-core.mjs', 'utf8');
  const runtimeIndexBlockStart = indexScript.indexOf('...(includeRuntimeContractIndexes ? [');
  const runtimeIndexBlockEnd = indexScript.indexOf('...(includeTestRuntimeIndexes ? [');
  assert.ok(runtimeIndexBlockStart >= 0 && runtimeIndexBlockEnd > runtimeIndexBlockStart);
  const collectionByGroup: Record<string, string> = {
    canonicalTargets: 'subscription_canonical_target_snapshots',
    mappings: 'subscription_provider_mappings',
    publications: 'subscription_policy_publications',
    projectionFences: 'subscription_projection_fences',
    instances: 'subscription_instances',
    instanceProjectorCheckpoints: 'subscription_instance_projector_checkpoints',
    bindingPromotions: 'subscription_runtime_binding_promotions',
    aggregates: 'subscription_entitlement_aggregates',
    operations: 'subscription_operations',
    ledger: 'subscription_usage_ledger',
    outbox: 'subscription_outbox'
  };
  for (const [groupName, indexes] of Object.entries(SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES)) {
    for (const index of indexes) {
      const key = Object.entries(index.key)
        .map(([field, direction]) => `${field.includes('.') ? `'${field}'` : field}: ${direction}`)
        .join(', ');
      const unique = index.unique ? 'unique: true, ' : '';
      const sparse = 'sparse' in index && index.sparse ? 'sparse: true, ' : '';
      const exactSpec = `['${collectionByGroup[groupName]}', { ${key} }, { ${unique}${sparse}name: '${index.name}' }]`;
      const position = indexScript.indexOf(exactSpec);
      assert.ok(
        position >= runtimeIndexBlockStart && position < runtimeIndexBlockEnd,
        `index script drift: ${exactSpec}`
      );
    }
  }
  assert.match(indexScript, /options\.sparse \? \[\{[\s\S]*?\$or:[\s\S]*?\$exists: true/);
  const repositorySource = fs.readFileSync('src/subscriptions/subscriptions.repository.ts', 'utf8');
  assert.doesNotMatch(repositorySource, /ensureRuntimeIndexes/);
  assert.doesNotMatch(repositorySource, /insertRuntimeLedgerEvent|insertRuntimeOutboxEvent/);
  assert.match(repositorySource, /appendRuntimeLedgerEventWithOutbox/);
  assert.match(repositorySource, /session\.withTransaction/);
  assert.match(indexScript, /SUBSCRIPTIONS_INDEX_APPLY !== 'CONFIRM'/);
  assert.match(indexScript, /DUPLICATE_PRECHECK_FAILED/);
  assert.match(indexScript, /SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_CONFIG_INVALID/);
  assert.match(indexScript, /SUBSCRIPTIONS_INDEX_EXPECTED_DB/);
  assert.match(indexScript, /isWritablePrimary/);
  assert.match(indexPlanner, /SUBSCRIPTIONS_INDEX_DRIFT/);
  assert.ok(
    indexScript.indexOf('validateTargetAttestation(') < indexScript.indexOf('new MongoClient('),
    'apply target attestation must happen before any Mongo connection'
  );

  const permissionKeys = ADMIN_PERMISSION_CATALOG.map((item) => item.key);
  assert.ok(permissionKeys.includes('subscriptions:publication:write'));
  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (role === Role.SUPER_ADMIN) continue;
    assert.ok(!permissions.includes('subscriptions:publication:write'));
  }

  const originalFlag = process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  const originalProjectorFlag = process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED;
  const repository = Object.create(SubscriptionsRepository.prototype) as any;
  delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  assert.equal(repository.runtimeContractsEnabled(), false);
  await assert.rejects(
    repository.runtimeProviderMappingById('mapping:disabled'),
    hasCode('SUBSCRIPTION_RUNTIME_CONTRACTS_DISABLED')
  );
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  assert.equal(repository.runtimeContractsEnabled(), true);
  delete process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED;
  await assert.rejects(
    repository.runtimeInstanceProjectorCheckpointByProviderIdentity({
      tenantId: 'iSkq6G', provider: 'VIVA', providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      providerScopeKind: 'STATION', providerScopeId: 'station:yasenevo'
    }),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_DISABLED')
  );
  delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'true';
  await assert.rejects(
    repository.runtimeInstanceProjectorCheckpointByProviderIdentity({
      tenantId: 'iSkq6G', provider: 'VIVA', providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      providerScopeKind: 'STATION', providerScopeId: 'station:yasenevo'
    }),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_CONFIG_INVALID')
  );
  const invalidConnectionRepository = new SubscriptionsRepository();
  await assert.rejects(
    invalidConnectionRepository.connectReadOnly(),
    hasCode('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_CONFIG_INVALID')
  );
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  let checkpointReads = 0;
  repository.runtimeInstanceProjectorCheckpoints = () => ({
    findOne: async (query: unknown, options: unknown) => {
      checkpointReads += 1;
      assert.deepEqual(query, {
        tenantId: 'iSkq6G', provider: 'VIVA', providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
        'providerScope.kind': 'STATION', 'providerScope.scopeId': 'station:yasenevo'
      });
      assert.deepEqual(options, { projection: { _id: 0 } });
      return projectorCheckpointFixture();
    }
  });
  assert.equal((await repository.runtimeInstanceProjectorCheckpointByProviderIdentity({
    tenantId: 'iSkq6G', provider: 'VIVA', providerProductId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
    providerScopeKind: 'STATION', providerScopeId: 'station:yasenevo'
  }))?.checkpointId, 'checkpoint:friendship-12m');
  assert.equal(checkpointReads, 1);

  const connectionModes: string[] = [];
  const coldRepository = Object.create(SubscriptionsRepository.prototype) as any;
  coldRepository.initialize = async (mode: string) => { connectionModes.push(mode); };
  await coldRepository.connectReadOnly();
  await coldRepository.connect();
  assert.deepEqual(connectionModes, ['VERIFY_ONLY', 'DEFAULT']);

  let releaseDefaultConnection!: () => void;
  const pendingDefaultConnection = new Promise<void>((resolve) => {
    releaseDefaultConnection = resolve;
  });
  const racingRepository = Object.create(SubscriptionsRepository.prototype) as any;
  racingRepository.initialize = async (mode: string) => {
    assert.equal(mode, 'DEFAULT');
    await pendingDefaultConnection;
  };
  const defaultConnect = racingRepository.connect();
  await assert.rejects(
    racingRepository.connectReadOnly(),
    hasCode('SUBSCRIPTIONS_CONNECTION_MODE_CONFLICT')
  );
  releaseDefaultConnection();
  await defaultConnect;

  let releaseReadOnlyConnection!: () => void;
  const pendingReadOnlyConnection = new Promise<void>((resolve) => {
    releaseReadOnlyConnection = resolve;
  });
  const reverseRacingRepository = Object.create(SubscriptionsRepository.prototype) as any;
  reverseRacingRepository.initialize = async (mode: string) => {
    assert.equal(mode, 'VERIFY_ONLY');
    await pendingReadOnlyConnection;
  };
  const readOnlyConnect = reverseRacingRepository.connectReadOnly();
  await assert.rejects(
    reverseRacingRepository.connect(),
    hasCode('SUBSCRIPTIONS_CONNECTION_MODE_CONFLICT')
  );
  releaseReadOnlyConnection();
  await readOnlyConnect;

  const repositoryConnectionSource = fs.readFileSync(
    'src/subscriptions/subscriptions.repository.ts',
    'utf8'
  );
  assert.match(repositoryConnectionSource, /connectReadOnly[\s\S]*connectWithMode\('VERIFY_ONLY'\)/);
  assert.match(repositoryConnectionSource, /mode === 'DEFAULT' && \(rawAutoCreate/);

  let canonicalTargetReads = 0;
  repository.runtimeCanonicalTargets = () => ({
    findOne: async (query: unknown) => {
      canonicalTargetReads += 1;
      assert.deepEqual(query, {
        tenantId: 'iSkq6G',
        targetId: 'exercise:synthetic-1',
        action: 'JOIN_GAME',
        revision: 1
      });
      return canonicalTargetFixture();
    }
  });
  assert.equal((await repository.runtimeCanonicalTargetSnapshot({
    tenantId: 'iSkq6G',
    targetId: 'exercise:synthetic-1',
    action: 'JOIN_GAME',
    revision: 1
  }))?.snapshotId, canonicalTargetFixture().snapshotId);
  assert.equal(canonicalTargetReads, 1);

  let latestCanonicalTargetReads = 0;
  repository.runtimeCanonicalTargets = () => ({
    findOne: async (query: unknown, options: unknown) => {
      latestCanonicalTargetReads += 1;
      assert.deepEqual(query, {
        tenantId: 'iSkq6G',
        targetId: 'exercise:synthetic-1',
        action: 'JOIN_GAME'
      });
      assert.deepEqual(options, { projection: { _id: 0 }, sort: { revision: -1 } });
      return canonicalTargetFixture();
    }
  });
  assert.equal((await repository.runtimeLatestCanonicalTargetSnapshot({
    tenantId: 'iSkq6G',
    targetId: 'exercise:synthetic-1',
    action: 'JOIN_GAME'
  }))?.revision, 1);
  assert.equal(latestCanonicalTargetReads, 1);

  let insertedCanonicalTargets = 0;
  repository.runtimeCanonicalTargets = () => ({
    insertOne: async () => { insertedCanonicalTargets += 1; }
  });
  await repository.insertRuntimeCanonicalTargetSnapshot(canonicalTargetFixture());
  assert.equal(insertedCanonicalTargets, 1);
  await assert.rejects(
    repository.insertRuntimeCanonicalTargetSnapshot({
      ...canonicalTargetFixture(),
      targetId: ' '
    }),
    hasCode('SUBSCRIPTION_RUNTIME_ID_INVALID')
  );
  assert.equal(insertedCanonicalTargets, 1);

  let insertedMappings = 0;
  repository.runtimeMappings = () => ({
    insertOne: async () => { insertedMappings += 1; }
  });
  await repository.insertRuntimeProviderMapping(mappingFixture());
  assert.equal(insertedMappings, 1);
  await assert.rejects(
    repository.insertRuntimeProviderMapping({ ...mappingFixture(), providerProductId: ' ' }),
    hasCode('SUBSCRIPTION_RUNTIME_ID_INVALID')
  );
  assert.equal(insertedMappings, 1);
  repository.runtimeMappings = () => ({
    findOne: async () => ({ ...mappingFixture(), providerProductId: 123 })
  });
  await assert.rejects(
    repository.runtimeProviderMappingById('mapping:friendship-12m'),
    hasCode('SUBSCRIPTION_RUNTIME_ID_INVALID')
  );

  const persistedFence = buildSubscriptionProjectionFence({
    mapping: mappingFixture(),
    publication: versionThreePublication,
    previous: null
  });
  repository.runtimeProjectionFences = () => ({
    findOne: async () => structuredClone(persistedFence)
  });
  assert.equal(
    (await repository.runtimeProjectionFenceByType(persistedFence.subscriptionTypeId))?.fenceId,
    persistedFence.fenceId
  );
  repository.runtimeProjectionFences = () => ({
    findOne: async () => ({ ...persistedFence, bindingDigest: DIGEST })
  });
  await assert.rejects(
    repository.runtimeProjectionFenceByType(persistedFence.subscriptionTypeId),
    hasCode('SUBSCRIPTION_PROJECTION_FENCE_DIGEST_MISMATCH')
  );

  let storedLedger: StoredSubscriptionUsageLedgerEvent | null = null;
  let storedOutbox: StoredSubscriptionOutboxEvent | null = null;
  let transactions = 0;
  const ledgerRepository = Object.create(SubscriptionsRepository.prototype) as any;
  ledgerRepository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>) => {
        transactions += 1;
        await callback();
      },
      endSession: async () => undefined
    })
  };
  ledgerRepository.runtimeLedger = () => ({
    findOne: async () => storedLedger,
    insertOne: async (document: StoredSubscriptionUsageLedgerEvent) => { storedLedger = document; }
  });
  ledgerRepository.runtimeOutbox = () => ({
    findOne: async () => storedOutbox,
    insertOne: async (document: StoredSubscriptionOutboxEvent) => { storedOutbox = document; }
  });
  assert.equal(await ledgerRepository.appendRuntimeLedgerEventWithOutbox({
    ledger: ledgerFixture(),
    outbox: outboxFixture()
  }), true);
  assert.equal(await ledgerRepository.appendRuntimeLedgerEventWithOutbox({
    ledger: ledgerFixture(),
    outbox: outboxFixture()
  }), false);
  assert.equal(transactions, 2);
  let retryLedger: StoredSubscriptionUsageLedgerEvent | null = null;
  let retryOutbox: StoredSubscriptionOutboxEvent | null = null;
  const retryRepository = Object.create(SubscriptionsRepository.prototype) as any;
  retryRepository.client = {
    startSession: () => ({
      withTransaction: async (callback: () => Promise<void>) => {
        await callback();
        retryLedger = ledgerFixture();
        retryOutbox = outboxFixture();
        await callback();
      },
      endSession: async () => undefined
    })
  };
  retryRepository.runtimeLedger = () => ({
    findOne: async () => retryLedger,
    insertOne: async (document: StoredSubscriptionUsageLedgerEvent) => { retryLedger = document; }
  });
  retryRepository.runtimeOutbox = () => ({
    findOne: async () => retryOutbox,
    insertOne: async (document: StoredSubscriptionOutboxEvent) => { retryOutbox = document; }
  });
  assert.equal(await retryRepository.appendRuntimeLedgerEventWithOutbox({
    ledger: ledgerFixture(),
    outbox: outboxFixture()
  }), false);
  await assert.rejects(
    ledgerRepository.appendRuntimeLedgerEventWithOutbox({
      ledger: { ...ledgerFixture(), usageDelta: -2 },
      outbox: outboxFixture()
    }),
    hasCode('SUBSCRIPTION_LEDGER_EVENT_HASH_MISMATCH')
  );
  if (originalFlag === undefined) delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  else process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = originalFlag;
  if (originalProjectorFlag === undefined) delete process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED;
  else process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = originalProjectorFlag;

  const contractSources = [
    'src/subscriptions/subscription-runtime-contracts.ts',
    'src/subscriptions/subscriptions.types.ts'
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(contractSources, /api\.vivacrm\.ru|https?:\/\/|\bfetch\s*\(/i);
  const projectorSources = [
    'src/subscriptions/subscriptions.repository.ts',
    'src/subscriptions/subscription-sale-readiness.service.ts'
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    projectorSources,
    /insertRuntimeInstanceProjectorCheckpoint|updateRuntimeInstanceProjectorCheckpoint|@(?:Get|Post|Put|Patch|Delete)\([^)]*checkpoint/i
  );
  assert.match(projectorSources, /SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE/);

  console.log('subscriptions runtime contracts tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
