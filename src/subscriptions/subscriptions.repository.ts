import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  Collection,
  ClientSession,
  Db,
  Filter,
  MongoClient,
  MongoServerError,
  TransactionOptions
} from 'mongodb';
import type { SubscriptionInstanceProjectionPlan } from './subscription-provider-instance-projector.service';
import {
  assertSubscriptionLegacyBindingPromotionPlanExact,
  rebuildSubscriptionLegacyBindingPromotionPlan
} from './subscription-legacy-binding-promotion.service';
import type {
  StoredSubscriptionRuntimeBindingPromotion,
  SubscriptionLegacyBindingPromotionIdentity,
  SubscriptionLegacyBindingPromotionPlan,
  SubscriptionLegacyBindingPromotionSnapshot
} from './subscription-legacy-binding-promotion.service';
import {
  StoredReleaseProgram,
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionTestEvent,
  StoredSubscriptionTestInventory,
  StoredSubscriptionTestOffer,
  StoredSubscriptionTestPurchase,
  StoredSubscriptionTestReservation,
  StoredSubscriptionType,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionTestPurchaseStatus
} from './subscriptions.types';
import {
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
} from './subscription-runtime-contracts';
import {
  buildSubscriptionProjectionFence,
  subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId
} from './subscription-projection-fence';

const SUBSCRIPTION_FENCED_TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority', j: true },
  readPreference: 'primary'
};

export const SUBSCRIPTION_REQUIRED_INDEXES = {
  types: [
    { name: 'subscription_type_id_unique', key: { subscriptionTypeId: 1 }, unique: true },
    { name: 'subscription_type_code_norm_unique', key: { codeNorm: 1 }, unique: true },
    { name: 'subscription_type_idempotency_unique', key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true },
    { name: 'subscription_type_list', key: { state: 1, updatedAt: -1, subscriptionTypeId: 1 }, unique: false }
  ],
  policies: [
    { name: 'subscription_policy_version_unique', key: { subscriptionTypeId: 1, version: 1 }, unique: true },
    { name: 'subscription_policy_idempotency_unique', key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true },
    { name: 'subscription_policy_list', key: { subscriptionTypeId: 1, status: 1, version: -1 }, unique: false }
  ],
  programs: [
    { name: 'subscription_release_program_id_unique', key: { releaseProgramId: 1 }, unique: true },
    { name: 'subscription_release_idempotency_unique', key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true },
    { name: 'subscription_release_station_list', key: { stationId: 1, state: 1, updatedAt: -1, releaseProgramId: 1 }, unique: false },
    { name: 'subscription_release_type_station_state', key: { subscriptionTypeId: 1, stationId: 1, state: 1 }, unique: false }
  ]
} as const;

export const SUBSCRIPTION_TEST_REQUIRED_INDEXES = {
  offers: [
    { name: 'subscription_test_offer_id_unique', key: { offerId: 1 }, unique: true },
    { name: 'subscription_test_offer_token_unique', key: { accessTokenHash: 1 }, unique: true },
    { name: 'subscription_test_offer_idempotency_unique', key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true },
    { name: 'subscription_test_offer_program_policy_unique', key: { releaseProgramId: 1, policyVersion: 1 }, unique: true },
    { name: 'subscription_test_offer_station_list', key: { stationId: 1, state: 1, updatedAt: -1 }, unique: false }
  ],
  inventories: [
    { name: 'subscription_test_inventory_offer_unique', key: { offerId: 1 }, unique: true }
  ],
  reservations: [
    { name: 'subscription_test_reservation_id_unique', key: { reservationId: 1 }, unique: true },
    { name: 'subscription_test_reservation_purchase_unique', key: { purchaseId: 1 }, unique: true },
    { name: 'subscription_test_reservation_expiry', key: { offerId: 1, status: 1, expiresAt: 1 }, unique: false }
  ],
  purchases: [
    { name: 'subscription_test_purchase_id_unique', key: { purchaseId: 1 }, unique: true },
    { name: 'subscription_test_purchase_idempotency_unique', key: { offerId: 1, 'idempotency.keyHash': 1 }, unique: true },
    { name: 'subscription_test_purchase_client_status', key: { offerId: 1, clientRefHash: 1, status: 1 }, unique: false },
    { name: 'subscription_test_purchase_expiry', key: { offerId: 1, status: 1, expiresAt: 1 }, unique: false },
    { name: 'subscription_test_purchase_reconciliation', key: { offerId: 1, inventoryFinalizedAt: 1, updatedAt: 1, purchaseId: 1, status: 1 }, unique: false }
  ],
  events: [
    { name: 'subscription_test_event_id_unique', key: { eventId: 1 }, unique: true },
    { name: 'subscription_test_event_offer_time', key: { offerId: 1, occurredAt: 1 }, unique: false },
    { name: 'subscription_test_event_purchase_time', key: { purchaseId: 1, occurredAt: 1 }, unique: false }
  ]
} as const;

export const SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES = {
  canonicalTargets: [
    {
      name: 'subscription_canonical_target_snapshot_id_unique',
      key: { snapshotId: 1 },
      unique: true
    },
    {
      name: 'subscription_canonical_target_identity_revision_unique',
      key: { tenantId: 1, targetId: 1, action: 1, revision: 1 },
      unique: true
    },
    {
      name: 'subscription_canonical_target_active_lookup',
      key: { tenantId: 1, targetId: 1, action: 1, state: 1, revision: -1 },
      unique: false
    }
  ],
  mappings: [
    { name: 'subscription_mapping_id_unique', key: { mappingId: 1 }, unique: true },
    {
      name: 'subscription_mapping_provider_scope_unique',
      key: {
        tenantId: 1,
        provider: 1,
        providerProductId: 1,
        'providerScope.kind': 1,
        'providerScope.scopeId': 1
      },
      unique: true
    },
    {
      name: 'subscription_mapping_idempotency_unique',
      key: { tenantId: 1, 'idempotency.actorId': 1, 'idempotency.key': 1 },
      unique: true
    },
    {
      name: 'subscription_mapping_type_state',
      key: { subscriptionTypeId: 1, state: 1, updatedAt: -1 },
      unique: false
    }
  ],
  publications: [
    { name: 'subscription_publication_id_unique', key: { publicationId: 1 }, unique: true },
    {
      name: 'subscription_publication_policy_version_unique',
      key: { subscriptionTypeId: 1, policyVersion: 1 },
      unique: true
    },
    {
      name: 'subscription_publication_runtime_lookup',
      key: { subscriptionTypeId: 1, state: 1, effectiveAt: -1 },
      unique: false
    },
    {
      name: 'subscription_publication_digest',
      key: { policyDigest: 1, publicationId: 1 },
      unique: false
    },
    {
      name: 'subscription_publication_idempotency_unique',
      key: { 'idempotency.actorId': 1, 'idempotency.key': 1 },
      unique: true,
      sparse: true
    }
  ],
  projectionFences: [
    {
      name: 'subscription_projection_fence_id_unique',
      key: { fenceId: 1 },
      unique: true
    },
    {
      name: 'subscription_projection_fence_type_unique',
      key: { subscriptionTypeId: 1 },
      unique: true
    }
  ],
  instances: [
    {
      name: 'subscription_instance_id_unique',
      key: { subscriptionInstanceId: 1 },
      unique: true
    },
    {
      name: 'subscription_instance_provider_identity_unique',
      key: { tenantId: 1, providerClientId: 1, clientSubscriptionId: 1 },
      unique: true
    },
    {
      name: 'subscription_instance_type_state_expiry',
      key: { subscriptionTypeId: 1, state: 1, activeTo: 1, subscriptionInstanceId: 1 },
      unique: false
    },
    {
      name: 'subscription_instance_station_state',
      key: { homeStationId: 1, state: 1, updatedAt: -1 },
      unique: false
    },
    {
      name: 'subscription_instance_client_state',
      key: { clientRefHash: 1, state: 1, updatedAt: -1 },
      unique: false
    },
    {
      name: 'subscription_instance_pending_activation_cursor',
      key: { state: 1, subscriptionInstanceId: 1 },
      unique: false
    }
  ],
  aggregates: [
    {
      name: 'subscription_entitlement_aggregate_instance_unique',
      key: { subscriptionInstanceId: 1 },
      unique: true
    },
    {
      name: 'subscription_entitlement_aggregate_reconciliation',
      key: { 'reconciliation.state': 1, updatedAt: 1, subscriptionInstanceId: 1 },
      unique: false
    }
  ],
  operations: [
    { name: 'subscription_operation_id_unique', key: { operationId: 1 }, unique: true },
    {
      name: 'subscription_operation_idempotency_unique',
      key: {
        tenantId: 1,
        'actor.actorId': 1,
        kind: 1,
        'idempotency.keyHash': 1
      },
      unique: true
    },
    {
      name: 'subscription_operation_instance_time',
      key: { subscriptionInstanceId: 1, createdAt: -1, operationId: 1 },
      unique: false
    },
    {
      name: 'subscription_operation_reconciliation',
      key: { state: 1, nextAttemptAt: 1, updatedAt: 1, operationId: 1 },
      unique: false
    }
  ],
  ledger: [
    { name: 'subscription_usage_event_id_unique', key: { eventId: 1 }, unique: true },
    {
      name: 'subscription_usage_instance_time',
      key: { subscriptionInstanceId: 1, occurredAt: 1, eventId: 1 },
      unique: false
    },
    {
      name: 'subscription_usage_correlation_time',
      key: { correlationId: 1, occurredAt: 1, eventId: 1 },
      unique: false
    },
    {
      name: 'subscription_usage_type_time',
      key: { eventType: 1, occurredAt: 1, eventId: 1 },
      unique: false
    }
  ],
  outbox: [
    { name: 'subscription_outbox_event_id_unique', key: { outboxEventId: 1 }, unique: true },
    { name: 'subscription_outbox_ledger_event_unique', key: { ledgerEventId: 1 }, unique: true },
    {
      name: 'subscription_outbox_delivery',
      key: { status: 1, nextAttemptAt: 1, createdAt: 1, outboxEventId: 1 },
      unique: false
    }
  ],
  instanceProjectorCheckpoints: [
    {
      name: 'subscription_instance_projector_checkpoint_id_unique',
      key: { checkpointId: 1 },
      unique: true
    },
    {
      name: 'subscription_instance_projector_checkpoint_provider_scope_unique',
      key: {
        tenantId: 1,
        provider: 1,
        providerProductId: 1,
        'providerScope.kind': 1,
        'providerScope.scopeId': 1
      },
      unique: true
    }
  ],
  bindingPromotions: [
    {
      name: 'subscription_runtime_binding_promotion_id_unique',
      key: { promotionId: 1 },
      unique: true
    },
    {
      name: 'subscription_runtime_binding_promotion_source_identity_unique',
      key: {
        tenantId: 1,
        subscriptionTypeId: 1,
        providerProductId: 1,
        'providerScope.kind': 1,
        'providerScope.scopeId': 1,
        publicationId: 1,
        mappingId: 1,
        releaseProgramId: 1,
        releasePhaseId: 1
      },
      unique: true
    },
    {
      name: 'subscription_runtime_binding_promotion_type_product_lookup',
      key: { subscriptionTypeId: 1, providerProductId: 1 },
      unique: false
    }
  ]
} as const;

export function subscriptionIndexMatches(
  actual: { name?: string; key?: unknown; unique?: boolean; sparse?: boolean } | undefined,
  expected: { name: string; key: unknown; unique: boolean; sparse?: boolean }
): boolean {
  return Boolean(actual)
    && actual?.name === expected.name
    && JSON.stringify(actual.key) === JSON.stringify(expected.key)
    && Boolean(actual.unique) === expected.unique
    && Boolean(actual.sparse) === Boolean(expected.sparse);
}

@Injectable()
export class SubscriptionsRepository {
  private readonly mongoUri = String(
    process.env.SUBSCRIPTIONS_MONGODB_URI ?? process.env.MONGODB_URI ?? ''
  ).trim();
  private readonly dbName = String(process.env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  private client?: MongoClient;
  private db?: Db;
  private connectionPromise?: Promise<void>;
  private connectionPromiseMode?: 'DEFAULT' | 'VERIFY_ONLY';

  async connect(): Promise<void> {
    return this.connectWithMode('DEFAULT');
  }

  async connectReadOnly(): Promise<void> {
    return this.connectWithMode('VERIFY_ONLY');
  }

  private async connectWithMode(mode: 'DEFAULT' | 'VERIFY_ONLY'): Promise<void> {
    if (this.connectionPromise) {
      if (this.connectionPromiseMode !== mode) {
        throw new SubscriptionRuntimeContractError(
          'SUBSCRIPTIONS_CONNECTION_MODE_CONFLICT'
        );
      }
      return this.connectionPromise;
    }
    if (this.db) return;
    const pending = this.initialize(mode);
    this.connectionPromise = pending;
    this.connectionPromiseMode = mode;
    try {
      await pending;
    } finally {
      if (this.connectionPromise === pending) {
        this.connectionPromise = undefined;
        this.connectionPromiseMode = undefined;
      }
    }
  }

  private async initialize(mode: 'DEFAULT' | 'VERIFY_ONLY'): Promise<void> {
    this.assertInstanceProjectorConfiguration();
    if (!this.mongoUri) throw new Error('SUBSCRIPTIONS_MONGODB_URI or MONGODB_URI is required');
    if (!this.dbName) throw new Error('SUBSCRIPTIONS_MONGODB_DB is required');
    const client = new MongoClient(this.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });
    await client.connect();
    this.client = client;
    this.db = client.db(this.dbName);
    const rawAutoCreate = String(process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '').trim();
    const autoCreate = mode === 'DEFAULT' && (rawAutoCreate
      ? rawAutoCreate === '1' || rawAutoCreate.toLowerCase() === 'true'
      : process.env.NODE_ENV !== 'production');
    try {
      if (autoCreate) await this.ensureIndexes();
      else await this.verifyIndexes();
    } catch (error) {
      await client.close().catch(() => undefined);
      if (this.client === client) {
        this.client = undefined;
        this.db = undefined;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.connectionPromise?.catch(() => undefined);
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
    this.db = undefined;
  }

  async subscriptionTypeById(subscriptionTypeId: string): Promise<StoredSubscriptionType | null> {
    return this.types().findOne({ subscriptionTypeId }, { projection: { _id: 0 } });
  }

  async subscriptionTypeByCodeNorm(codeNorm: string): Promise<StoredSubscriptionType | null> {
    return this.types().findOne({ codeNorm }, { projection: { _id: 0 } });
  }

  async subscriptionTypeByIdempotency(
    actorId: string,
    key: string
  ): Promise<StoredSubscriptionType | null> {
    return this.types().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async insertSubscriptionType(document: StoredSubscriptionType): Promise<void> {
    await this.types().insertOne(document);
  }

  async listSubscriptionTypes(
    afterId: string | null,
    limit: number
  ): Promise<StoredSubscriptionType[]> {
    const filter: Filter<StoredSubscriptionType> = afterId
      ? { subscriptionTypeId: { $gt: afterId } }
      : {};
    return this.types()
      .find(filter, { projection: { _id: 0 } })
      .sort({ subscriptionTypeId: 1 })
      .limit(limit)
      .toArray();
  }

  async policyByIdempotency(
    actorId: string,
    key: string
  ): Promise<StoredSubscriptionPolicyVersion | null> {
    return this.policies().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async latestPolicyVersion(subscriptionTypeId: string): Promise<number> {
    const row = await this.policies().findOne(
      { subscriptionTypeId },
      { projection: { version: 1 }, sort: { version: -1 } }
    );
    return row?.version ?? 0;
  }

  async insertPolicyVersion(document: StoredSubscriptionPolicyVersion): Promise<void> {
    await this.policies().insertOne(document);
  }

  async insertSupersedingPolicyVersion(input: {
    policy: StoredSubscriptionPolicyVersion;
    expectedTypeRevision: number;
    expectedCurrentPolicyVersion: number;
  }): Promise<'INSERTED' | 'SOURCE_CONFLICT' | 'DRAFT_EXISTS'> {
    const session = this.requireClient().startSession();
    try {
      return await session.withTransaction(async () => {
        const [type, currentPolicy, pendingDraft] = await Promise.all([
          this.types().findOne(
            { subscriptionTypeId: input.policy.subscriptionTypeId },
            { projection: { _id: 0 }, session }
          ),
          this.policies().findOne(
            {
              subscriptionTypeId: input.policy.subscriptionTypeId,
              version: input.expectedCurrentPolicyVersion
            },
            { projection: { _id: 0 }, session }
          ),
          this.policies().findOne(
            {
              subscriptionTypeId: input.policy.subscriptionTypeId,
              status: 'DRAFT',
              version: { $gt: input.expectedCurrentPolicyVersion }
            },
            { projection: { _id: 0 }, session }
          )
        ]);
        if (pendingDraft) return 'DRAFT_EXISTS';
        if (!type
          || !currentPolicy
          || type.state !== 'ACTIVE'
          || type.revision !== input.expectedTypeRevision
          || type.currentPolicyVersion !== input.expectedCurrentPolicyVersion
          || currentPolicy.status !== 'PUBLISHED'
          || input.policy.status !== 'DRAFT'
          || input.policy.applyTo !== 'NEW_ONLY'
          || input.policy.version !== input.expectedCurrentPolicyVersion + 1) {
          return 'SOURCE_CONFLICT';
        }
        await this.policies().insertOne(input.policy, { session });
        return 'INSERTED';
      });
    } finally {
      await session.endSession();
    }
  }

  async releaseProgramByIdempotency(
    actorId: string,
    key: string
  ): Promise<StoredReleaseProgram | null> {
    return this.programs().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async insertReleaseProgram(document: StoredReleaseProgram): Promise<void> {
    await this.programs().insertOne(document);
  }

  async listReleasePrograms(input: {
    stationIds: string[] | null;
    stationId?: string;
    afterId: string | null;
    limit: number;
  }): Promise<StoredReleaseProgram[]> {
    const clauses: Filter<StoredReleaseProgram>[] = [];
    if (input.stationId) clauses.push({ stationId: input.stationId });
    else if (input.stationIds !== null) clauses.push({ stationId: { $in: input.stationIds } });
    if (input.afterId) clauses.push({ releaseProgramId: { $gt: input.afterId } });
    const filter = clauses.length === 0
      ? {}
      : clauses.length === 1
        ? clauses[0]
        : ({ $and: clauses } as Filter<StoredReleaseProgram>);
    return this.programs()
      .find(filter, { projection: { _id: 0 } })
      .sort({ releaseProgramId: 1 })
      .limit(input.limit)
      .toArray();
  }

  async policyVersionByNumber(
    subscriptionTypeId: string,
    version: number
  ): Promise<StoredSubscriptionPolicyVersion | null> {
    return this.policies().findOne(
      { subscriptionTypeId, version },
      { projection: { _id: 0 } }
    );
  }

  async listPolicyVersions(subscriptionTypeId: string): Promise<StoredSubscriptionPolicyVersion[]> {
    return this.policies()
      .find({ subscriptionTypeId }, { projection: { _id: 0 } })
      .sort({ version: -1 })
      .toArray();
  }

  async releaseProgramById(releaseProgramId: string): Promise<StoredReleaseProgram | null> {
    return this.programs().findOne({ releaseProgramId }, { projection: { _id: 0 } });
  }

  async listReleaseProgramsByType(
    subscriptionTypeId: string,
    stationIds: string[] | null
  ): Promise<StoredReleaseProgram[]> {
    const filter: Filter<StoredReleaseProgram> = stationIds === null
      ? { subscriptionTypeId }
      : { subscriptionTypeId, stationId: { $in: stationIds } };
    return this.programs()
      .find(filter, { projection: { _id: 0 } })
      .sort({ stationId: 1, releaseProgramId: 1 })
      .toArray();
  }

  async runtimeProviderMappingById(
    mappingId: string
  ): Promise<StoredSubscriptionProviderMapping | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeMappings().findOne({ mappingId }, { projection: { _id: 0 } });
    if (row) validateStoredSubscriptionProviderMapping(row);
    return row;
  }

  async runtimeCanonicalTargetSnapshot(input: {
    tenantId: string;
    targetId: string;
    action: StoredSubscriptionCanonicalTargetSnapshot['action'];
    revision: number;
  }): Promise<StoredSubscriptionCanonicalTargetSnapshot | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeCanonicalTargets().findOne(
      input,
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionCanonicalTargetSnapshot(row);
    return row;
  }

  async runtimeLatestCanonicalTargetSnapshot(input: {
    tenantId: string;
    targetId: string;
    action: StoredSubscriptionCanonicalTargetSnapshot['action'];
  }): Promise<StoredSubscriptionCanonicalTargetSnapshot | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeCanonicalTargets().findOne(
      input,
      { projection: { _id: 0 }, sort: { revision: -1 } }
    );
    if (row) validateStoredSubscriptionCanonicalTargetSnapshot(row);
    return row;
  }

  async insertRuntimeCanonicalTargetSnapshot(
    document: StoredSubscriptionCanonicalTargetSnapshot
  ): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionCanonicalTargetSnapshot(document);
    await this.runtimeCanonicalTargets().insertOne(document);
  }

  async runtimeProviderMappingByProviderIdentity(input: {
    tenantId: string;
    provider: 'VIVA';
    providerProductId: string;
    providerScopeKind: StoredSubscriptionProviderMapping['providerScope']['kind'];
    providerScopeId: string;
  }): Promise<StoredSubscriptionProviderMapping | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeMappings().findOne(
      {
        tenantId: input.tenantId,
        provider: input.provider,
        providerProductId: input.providerProductId,
        'providerScope.kind': input.providerScopeKind,
        'providerScope.scopeId': input.providerScopeId
      },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionProviderMapping(row);
    return row;
  }

  async runtimeInstanceProjectorCheckpointByProviderIdentity(input: {
    tenantId: string;
    provider: 'VIVA';
    providerProductId: string;
    providerScopeKind: Exclude<StoredSubscriptionInstanceProjectorCheckpoint['providerScope']['kind'], 'STUDIO'>;
    providerScopeId: string;
  }): Promise<StoredSubscriptionInstanceProjectorCheckpoint | null> {
    this.assertInstanceProjectorContractsEnabled();
    const row = await this.runtimeInstanceProjectorCheckpoints().findOne(
      {
        tenantId: input.tenantId,
        provider: input.provider,
        providerProductId: input.providerProductId,
        'providerScope.kind': input.providerScopeKind,
        'providerScope.scopeId': input.providerScopeId
      },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionInstanceProjectorCheckpoint(row);
    return row;
  }

  async preflightInitialRuntimeInstanceProjection(
    plan: SubscriptionInstanceProjectionPlan
  ): Promise<'READY_TO_INSERT' | 'EXACT_REPLAY'> {
    this.assertInstanceProjectorContractsEnabled();
    this.validateInitialProjectionPlan(plan);
    const checkpoint = await this.runtimeInstanceProjectorCheckpoints().findOne(
      this.instanceProjectorIdentity(plan.checkpoint),
      { projection: { _id: 0 } }
    );
    const rows = await this.runtimeInstances()
      .find(this.instanceProjectionProductFilter(plan.checkpoint), { projection: { _id: 0 } })
      .sort({ subscriptionInstanceId: 1 })
      .toArray();
    rows.forEach(validateStoredSubscriptionInstance);
    if (!checkpoint) {
      if (rows.length !== 0) {
        throw new SubscriptionRuntimeContractError(
          'SUBSCRIPTIONS_INSTANCE_PROJECTOR_UNCHECKPOINTED_INSTANCES_CONFLICT'
        );
      }
      return 'READY_TO_INSERT';
    }
    validateStoredSubscriptionInstanceProjectorCheckpoint(checkpoint);
    if (!isDeepStrictEqual(checkpoint, plan.checkpoint)
      || !isDeepStrictEqual(rows, plan.instances)) {
      throw new SubscriptionRuntimeContractError(
        'SUBSCRIPTIONS_INSTANCE_PROJECTOR_IMMUTABLE_CONFLICT'
      );
    }
    return 'EXACT_REPLAY';
  }

  async applyInitialRuntimeInstanceProjection(
    plan: SubscriptionInstanceProjectionPlan
  ): Promise<'INSERTED' | 'EXACT_REPLAY'> {
    this.assertInstanceProjectorContractsEnabled();
    this.validateInitialProjectionPlan(plan);
    const session = this.requireClient().startSession();
    let result: 'INSERTED' | 'EXACT_REPLAY' | null = null;
    try {
      await session.withTransaction(async () => {
        const fence = await this.runtimeProjectionFences().findOne(
          { subscriptionTypeId: plan.checkpoint.binding.subscriptionTypeId },
          { projection: { _id: 0 }, session }
        );
        const checkpoint = await this.runtimeInstanceProjectorCheckpoints().findOne(
          this.instanceProjectorIdentity(plan.checkpoint),
          { projection: { _id: 0 }, session }
        );
        const rows = await this.runtimeInstances()
          .find(this.instanceProjectionProductFilter(plan.checkpoint), {
            projection: { _id: 0 },
            session
          })
          .sort({ subscriptionInstanceId: 1 })
          .toArray();
        const expectedFenceBinding = {
          mappingId: plan.checkpoint.binding.mappingId,
          mappingRevision: plan.checkpoint.binding.mappingRevision,
          subscriptionTypeId: plan.checkpoint.binding.subscriptionTypeId,
          publicationId: plan.checkpoint.binding.publicationId,
          policyVersion: plan.checkpoint.binding.policyVersion,
          policyDigest: plan.checkpoint.binding.policyDigest,
          runtimeCompatibility: plan.checkpoint.binding.runtimeCompatibility
        };
        if (plan.checkpoint.binding.fenceId !== subscriptionProjectionFenceId(
          plan.checkpoint.binding.subscriptionTypeId
        )
          || plan.checkpoint.binding.fenceDigest !== subscriptionProjectionFenceBindingDigest(
            expectedFenceBinding
          )
          || (!fence && plan.checkpoint.binding.fenceRevision !== 1)) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CONFLICT'
          );
        }
        if (fence) {
          validateStoredSubscriptionProjectionFence(fence);
          if (fence.fenceId !== plan.checkpoint.binding.fenceId
            || fence.bindingRevision !== plan.checkpoint.binding.fenceRevision
            || fence.bindingDigest !== plan.checkpoint.binding.fenceDigest
            || fence.bindingDigest !== subscriptionProjectionFenceBindingDigest(fence.binding)
            || fence.binding.mappingId !== plan.checkpoint.binding.mappingId
            || fence.binding.mappingRevision !== plan.checkpoint.binding.mappingRevision
            || fence.binding.publicationId !== plan.checkpoint.binding.publicationId
            || fence.binding.policyVersion !== plan.checkpoint.binding.policyVersion
            || fence.binding.policyDigest !== plan.checkpoint.binding.policyDigest) {
            throw new SubscriptionRuntimeContractError(
              'SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CONFLICT'
            );
          }
        }
        rows.forEach(validateStoredSubscriptionInstance);
        if (checkpoint) {
          validateStoredSubscriptionInstanceProjectorCheckpoint(checkpoint);
          if (!isDeepStrictEqual(checkpoint, plan.checkpoint)
            || !isDeepStrictEqual(rows, plan.instances)
            || !fence
            || fence.lastProjectorReconciliationDigest
              !== plan.checkpoint.reconciliation.reconciliationDigest) {
            throw new SubscriptionRuntimeContractError(
              'SUBSCRIPTIONS_INSTANCE_PROJECTOR_IMMUTABLE_CONFLICT'
            );
          }
          result = 'EXACT_REPLAY';
          return;
        }
        if (rows.length !== 0 || (fence && fence.lastProjectorReconciliationDigest !== null)) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_INSTANCE_PROJECTOR_UNCHECKPOINTED_INSTANCES_CONFLICT'
          );
        }
        if (!fence) {
          const bootstrapFence: StoredSubscriptionProjectionFence = {
            schemaVersion: 1,
            fenceId: plan.checkpoint.binding.fenceId,
            subscriptionTypeId: plan.checkpoint.binding.subscriptionTypeId,
            bindingRevision: 1,
            bindingDigest: plan.checkpoint.binding.fenceDigest,
            binding: expectedFenceBinding,
            coordinationRevision: 1,
            lastProjectorReconciliationDigest:
              plan.checkpoint.reconciliation.reconciliationDigest,
            createdAt: plan.checkpoint.createdAt,
            updatedAt: plan.checkpoint.updatedAt
          };
          validateStoredSubscriptionProjectionFence(bootstrapFence);
          await this.runtimeProjectionFences().insertOne(bootstrapFence, { session });
        } else {
          const fenceUpdate = await this.runtimeProjectionFences().updateOne(
            {
              fenceId: fence.fenceId,
              subscriptionTypeId: fence.subscriptionTypeId,
              bindingRevision: fence.bindingRevision,
              bindingDigest: fence.bindingDigest,
              coordinationRevision: fence.coordinationRevision,
              lastProjectorReconciliationDigest: null
            },
            {
              $set: {
                lastProjectorReconciliationDigest:
                  plan.checkpoint.reconciliation.reconciliationDigest,
                updatedAt: plan.checkpoint.updatedAt
              },
              $inc: { coordinationRevision: 1 }
            },
            { session }
          );
          if (fenceUpdate.modifiedCount !== 1) {
            throw new SubscriptionRuntimeContractError(
              'SUBSCRIPTIONS_INSTANCE_PROJECTOR_FENCE_CAS_CONFLICT'
            );
          }
        }
        const instanceWriteDocuments = plan.instances.map((instance) => structuredClone(instance));
        const checkpointWriteDocument = structuredClone(plan.checkpoint);
        await this.runtimeInstances().insertMany(instanceWriteDocuments, { ordered: true, session });
        await this.runtimeInstanceProjectorCheckpoints().insertOne(checkpointWriteDocument, { session });
        result = 'INSERTED';
      }, SUBSCRIPTION_FENCED_TRANSACTION_OPTIONS);
      if (!result) {
        throw new SubscriptionRuntimeContractError(
          'SUBSCRIPTIONS_INSTANCE_PROJECTOR_TRANSACTION_EMPTY'
        );
      }
      if (result === 'INSERTED') {
        const readBack = await this.preflightInitialRuntimeInstanceProjection(plan);
        if (readBack !== 'EXACT_REPLAY') {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_INSTANCE_PROJECTOR_POSTCOMMIT_READBACK_FAILED'
          );
        }
      }
      return result;
    } finally {
      await session.endSession();
    }
  }

  async legacyBindingPromotionSnapshot(
    identity: SubscriptionLegacyBindingPromotionIdentity
  ): Promise<SubscriptionLegacyBindingPromotionSnapshot> {
    this.assertBindingPromotionContractsEnabled();
    return this.legacyBindingPromotionSnapshotWithSession(identity);
  }

  async preflightLegacyBindingPromotion(
    plan: SubscriptionLegacyBindingPromotionPlan
  ): Promise<'READY_TO_PROMOTE' | 'EXACT_REPLAY'> {
    this.assertBindingPromotionContractsEnabled();
    const snapshot = await this.legacyBindingPromotionSnapshotWithSession(plan.identity);
    const actual = rebuildSubscriptionLegacyBindingPromotionPlan(plan.manifest, snapshot);
    assertSubscriptionLegacyBindingPromotionPlanExact(plan, actual);
    return actual.status;
  }

  async applyLegacyBindingPromotion(
    plan: SubscriptionLegacyBindingPromotionPlan
  ): Promise<'PROMOTED' | 'EXACT_REPLAY'> {
    this.assertBindingPromotionContractsEnabled();
    const session = this.requireClient().startSession();
    let result: 'PROMOTED' | 'EXACT_REPLAY' | null = null;
    try {
      await session.withTransaction(async () => {
        const snapshot = await this.legacyBindingPromotionSnapshotWithSession(
          plan.identity,
          session
        );
        const actual = rebuildSubscriptionLegacyBindingPromotionPlan(plan.manifest, snapshot);
        assertSubscriptionLegacyBindingPromotionPlanExact(plan, actual);
        if (actual.status === 'EXACT_REPLAY') {
          result = 'EXACT_REPLAY';
          return;
        }
        if (!actual.source) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_SOURCE_REQUIRED'
          );
        }
        const mappingUpdate = await this.runtimeMappings().replaceOne(
          {
            mappingId: actual.source.mapping.mappingId,
            tenantId: actual.source.mapping.tenantId,
            provider: 'VIVA',
            providerProductId: actual.source.mapping.providerProductId,
            'providerScope.kind': actual.source.mapping.providerScope.kind,
            'providerScope.scopeId': actual.source.mapping.providerScope.scopeId,
            subscriptionTypeId: actual.source.mapping.subscriptionTypeId,
            state: 'VERIFIED',
            revision: actual.source.mapping.revision
          },
          actual.target.mapping,
          { session }
        );
        if (mappingUpdate.matchedCount !== 1 || mappingUpdate.modifiedCount !== 1) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_MAPPING_CAS_CONFLICT'
          );
        }
        const publicationUpdate = await this.runtimePublications().replaceOne(
          {
            publicationId: actual.source.publication.publicationId,
            subscriptionTypeId: actual.source.publication.subscriptionTypeId,
            policyVersion: actual.source.publication.policyVersion,
            mappingId: actual.source.publication.mappingId,
            schemaVersion: 2,
            state: 'PUBLISHED',
            runtimeCompatibility: { $exists: false }
          },
          actual.target.publication,
          { session }
        );
        if (publicationUpdate.matchedCount !== 1 || publicationUpdate.modifiedCount !== 1) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_PUBLICATION_CAS_CONFLICT'
          );
        }
        const programUpdate = await this.programs().replaceOne(
          {
            releaseProgramId: actual.source.releaseProgram.releaseProgramId,
            subscriptionTypeId: actual.source.releaseProgram.subscriptionTypeId,
            stationId: actual.source.releaseProgram.stationId,
            state: 'DRAFT',
            revision: actual.source.releaseProgram.revision,
            'phases.releasePhaseId': actual.identity.releasePhaseId,
            'phases.providerProductRef': null
          },
          actual.target.releaseProgram,
          { session }
        );
        if (programUpdate.matchedCount !== 1 || programUpdate.modifiedCount !== 1) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_PROGRAM_CAS_CONFLICT'
          );
        }
        const fenceInsert = await this.runtimeProjectionFences().insertOne(
          actual.target.fence,
          { session }
        );
        if (!fenceInsert.acknowledged) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_FENCE_INSERT_FAILED'
          );
        }
        const checkpointInsert = await this.runtimeBindingPromotions().insertOne(
          actual.target.promotion,
          { session }
        );
        if (!checkpointInsert.acknowledged) {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_CHECKPOINT_INSERT_FAILED'
          );
        }
        result = 'PROMOTED';
      }, SUBSCRIPTION_FENCED_TRANSACTION_OPTIONS);
      if (!result) {
        throw new SubscriptionRuntimeContractError(
          'SUBSCRIPTIONS_BINDING_PROMOTION_TRANSACTION_EMPTY'
        );
      }
      if (result === 'PROMOTED') {
        const readBack = await this.preflightLegacyBindingPromotion(plan);
        if (readBack !== 'EXACT_REPLAY') {
          throw new SubscriptionRuntimeContractError(
            'SUBSCRIPTIONS_BINDING_PROMOTION_POSTCOMMIT_READBACK_FAILED'
          );
        }
      }
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async legacyBindingPromotionSnapshotWithSession(
    identity: SubscriptionLegacyBindingPromotionIdentity,
    session?: ClientSession
  ): Promise<SubscriptionLegacyBindingPromotionSnapshot> {
    const options = session ? { projection: { _id: 0 }, session } : { projection: { _id: 0 } };
    const [type, policy, publication, mapping, releaseProgram, fence, promotion,
      instanceCount, projectorCheckpointCount] = await Promise.all([
      this.types().findOne({ subscriptionTypeId: identity.subscriptionTypeId }, options),
      this.policies().findOne(
        { subscriptionTypeId: identity.subscriptionTypeId, version: identity.policyVersion },
        options
      ),
      this.runtimePublications().findOne({ publicationId: identity.publicationId }, options),
      this.runtimeMappings().findOne({ mappingId: identity.mappingId }, options),
      this.programs().findOne({ releaseProgramId: identity.releaseProgramId }, options),
      this.runtimeProjectionFences().findOne(
        { subscriptionTypeId: identity.subscriptionTypeId },
        options
      ),
      this.runtimeBindingPromotions().findOne({
        tenantId: identity.tenantId,
        subscriptionTypeId: identity.subscriptionTypeId,
        providerProductId: identity.providerProductId,
        publicationId: identity.publicationId,
        mappingId: identity.mappingId,
        releaseProgramId: identity.releaseProgramId,
        releasePhaseId: identity.releasePhaseId
      }, options),
      this.runtimeInstances().countDocuments({
        tenantId: identity.tenantId,
        provider: 'VIVA',
        providerProductId: identity.providerProductId,
        subscriptionTypeId: identity.subscriptionTypeId
      }, session ? { session } : undefined),
      this.runtimeInstanceProjectorCheckpoints().countDocuments({
        tenantId: identity.tenantId,
        provider: 'VIVA',
        providerProductId: identity.providerProductId,
        'providerScope.kind': identity.providerScope.kind,
        'providerScope.scopeId': identity.providerScope.scopeId
      }, session ? { session } : undefined)
    ]);
    return {
      type,
      policy,
      publication,
      mapping,
      releaseProgram,
      fence,
      promotion,
      instanceCount,
      projectorCheckpointCount
    };
  }

  async runtimeProviderMappingByIdempotency(input: {
    tenantId: string;
    actorId: string;
    key: string;
  }): Promise<StoredSubscriptionProviderMapping | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeMappings().findOne(
      {
        tenantId: input.tenantId,
        'idempotency.actorId': input.actorId,
        'idempotency.key': input.key
      },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionProviderMapping(row);
    return row;
  }

  async runtimeProjectionFenceByType(
    subscriptionTypeId: string
  ): Promise<StoredSubscriptionProjectionFence | null> {
    this.assertInstanceProjectorContractsEnabled();
    const row = await this.runtimeProjectionFences().findOne(
      { subscriptionTypeId },
      { projection: { _id: 0 } }
    );
    if (row) {
      validateStoredSubscriptionProjectionFence(row);
      if (row.fenceId !== subscriptionProjectionFenceId(row.subscriptionTypeId)
        || row.bindingDigest !== subscriptionProjectionFenceBindingDigest(row.binding)) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PROJECTION_FENCE_DIGEST_MISMATCH');
      }
    }
    return row;
  }

  async insertRuntimeProviderMapping(document: StoredSubscriptionProviderMapping): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionProviderMapping(document);
    await this.runtimeMappings().insertOne(document);
  }

  async runtimePolicyPublicationByVersion(
    subscriptionTypeId: string,
    policyVersion: number
  ): Promise<StoredSubscriptionPolicyPublication | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimePublications().findOne(
      { subscriptionTypeId, policyVersion },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionPolicyPublication(row);
    return row;
  }

  async runtimePolicyPublicationByIdempotency(input: {
    actorId: string;
    key: string;
  }): Promise<StoredSubscriptionPolicyPublication | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimePublications().findOne(
      { 'idempotency.actorId': input.actorId, 'idempotency.key': input.key },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionPolicyPublication(row);
    return row;
  }

  async countRuntimeInstancesByPolicy(
    subscriptionTypeId: string,
    policyVersion: number
  ): Promise<number> {
    this.assertRuntimeContractsEnabled();
    return this.runtimeInstances().countDocuments({ subscriptionTypeId, policyVersion });
  }

  async insertRuntimePolicyPublication(
    document: StoredSubscriptionPolicyPublication
  ): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionPolicyPublication(document);
    await this.runtimePublications().insertOne(document);
  }

  async publishRuntimePolicy(input: {
    mapping: StoredSubscriptionProviderMapping;
    insertMapping: boolean;
    expectedMappingRevision: number | null;
    publication: StoredSubscriptionPolicyPublication;
    expectedTypeRevision: number;
    expectedPolicyRevision: number;
    previousPublicationId: string | null;
    previousPolicyVersion: number | null;
    expectedPreviousPolicyRevision: number | null;
  }): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionProviderMapping(input.mapping);
    validateStoredSubscriptionPolicyPublication(input.publication);
    if (input.mapping.state !== 'VERIFIED'
      || input.publication.state !== 'PUBLISHED'
      || input.publication.schemaVersion !== 3
      || !input.publication.runtimeCompatibility
      || input.mapping.mappingId !== input.publication.mappingId
      || input.mapping.subscriptionTypeId !== input.publication.subscriptionTypeId) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_LINK_MISMATCH');
    }

    const session = this.requireClient().startSession();
    try {
      await session.withTransaction(async () => {
        const previousPolicyVersion = input.previousPolicyVersion;
        const [
          type,
          policy,
          previousPolicy,
          previousPublication,
          persistedMapping,
          persistedFence
        ] = await Promise.all([
          this.types().findOne(
            { subscriptionTypeId: input.publication.subscriptionTypeId },
            { projection: { _id: 0 }, session }
          ),
          this.policies().findOne(
            {
              subscriptionTypeId: input.publication.subscriptionTypeId,
              version: input.publication.policyVersion
            },
            { projection: { _id: 0 }, session }
          ),
          previousPolicyVersion === null
            ? Promise.resolve(null)
            : this.policies().findOne(
              {
                subscriptionTypeId: input.publication.subscriptionTypeId,
                version: previousPolicyVersion
              },
              { projection: { _id: 0 }, session }
            ),
          input.previousPublicationId === null
            ? Promise.resolve(null)
            : this.runtimePublications().findOne(
              { publicationId: input.previousPublicationId },
              { projection: { _id: 0 }, session }
            ),
          input.insertMapping
            ? Promise.resolve(null)
            : this.runtimeMappings().findOne(
              { mappingId: input.mapping.mappingId },
              { projection: { _id: 0 }, session }
            ),
          this.runtimeProjectionFences().findOne(
            { subscriptionTypeId: input.publication.subscriptionTypeId },
            { projection: { _id: 0 }, session }
          )
        ]);
        if (!type || !policy) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_NOT_FOUND');
        }
        if (type.revision !== input.expectedTypeRevision
          || policy.status !== 'DRAFT'
          || policy.modelVersion !== 3
          || policy.revision !== input.expectedPolicyRevision
          || policy.effectiveAt !== input.publication.effectiveAt) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT');
        }
        const isInitial = input.previousPublicationId === null;
        const previousMapping = !isInitial && previousPublication
          ? await this.runtimeMappings().findOne(
            { mappingId: previousPublication.mappingId },
            { projection: { _id: 0 }, session }
          )
          : null;
        if (isInitial) {
          if (type.state !== 'DRAFT'
            || type.currentPolicyVersion !== null
            || input.previousPolicyVersion !== null
            || input.expectedPreviousPolicyRevision !== null
            || previousPolicy !== null
            || previousPublication !== null
            || persistedFence !== null
            || !input.insertMapping
            || input.expectedMappingRevision !== null) {
            throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT');
          }
        } else {
          if (type.state !== 'ACTIVE'
            || input.previousPolicyVersion === null
            || type.currentPolicyVersion !== previousPolicyVersion
            || policy.applyTo !== 'NEW_ONLY'
            || input.expectedPreviousPolicyRevision === null
            || !previousPolicy
            || previousPolicy.status !== 'PUBLISHED'
            || previousPolicy.revision !== input.expectedPreviousPolicyRevision
            || !previousPublication
            || previousPublication.subscriptionTypeId !== input.publication.subscriptionTypeId
            || previousPublication.policyVersion !== previousPolicyVersion
            || previousPublication.state !== 'PUBLISHED'
            || previousPublication.supersededAt !== null
            || previousPublication.supersededBy !== null
            || !previousMapping) {
            throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT');
          }
          validateStoredSubscriptionProviderMapping(previousMapping);
          if (persistedFence) {
            validateStoredSubscriptionProjectionFence(persistedFence);
            if (persistedFence.fenceId !== subscriptionProjectionFenceId(type.subscriptionTypeId)
              || persistedFence.bindingDigest !== subscriptionProjectionFenceBindingDigest(
                persistedFence.binding
              )
              || persistedFence.binding.subscriptionTypeId !== type.subscriptionTypeId
              || persistedFence.binding.publicationId !== previousPublication.publicationId
              || persistedFence.binding.policyVersion !== previousPublication.policyVersion
              || persistedFence.binding.policyDigest !== previousPublication.policyDigest
              || persistedFence.binding.mappingId !== previousPublication.mappingId
              || persistedFence.binding.mappingId !== previousMapping.mappingId
              || persistedFence.binding.mappingRevision !== previousMapping.revision
              || !previousPublication.runtimeCompatibility
              || !isDeepStrictEqual(
                persistedFence.binding.runtimeCompatibility,
                previousPublication.runtimeCompatibility
              )) {
              throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_FENCE_CONFLICT');
            }
          }
        }
        if (!input.insertMapping && (!persistedMapping
          || input.expectedMappingRevision === null
          || persistedMapping.revision !== input.expectedMappingRevision
          || input.mapping.revision !== input.expectedMappingRevision + 1
          || persistedMapping.state !== 'VERIFIED'
          || persistedMapping.mappingId !== input.mapping.mappingId
          || persistedMapping.subscriptionTypeId !== input.mapping.subscriptionTypeId
          || persistedMapping.tenantId !== input.mapping.tenantId
          || persistedMapping.providerProductId !== input.mapping.providerProductId
          || persistedMapping.providerScope.kind !== input.mapping.providerScope.kind
          || persistedMapping.providerScope.scopeId !== input.mapping.providerScope.scopeId)) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT');
        }
        if (input.insertMapping && input.expectedMappingRevision !== null) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_SOURCE_CONFLICT');
        }

        const nextFence = buildSubscriptionProjectionFence({
          mapping: input.mapping,
          publication: input.publication,
          previous: persistedFence
        });
        validateStoredSubscriptionProjectionFence(nextFence);

        let mappingUpdate = { modifiedCount: input.insertMapping ? 1 : 0 };
        if (input.insertMapping) {
          await this.runtimeMappings().insertOne(input.mapping, { session });
        } else {
          mappingUpdate = await this.runtimeMappings().updateOne(
            {
              mappingId: input.mapping.mappingId,
              state: 'VERIFIED',
              revision: input.expectedMappingRevision!
            },
            {
              $set: {
                evidenceRef: input.mapping.evidenceRef,
                verifiedAt: input.mapping.verifiedAt,
                verifiedBy: input.mapping.verifiedBy,
                updatedAt: input.mapping.updatedAt,
                updatedBy: input.mapping.updatedBy
              },
              $inc: { revision: 1 }
            },
            { session }
          );
        }
        await this.runtimePublications().insertOne(input.publication, { session });
        let previousPolicyUpdate = { modifiedCount: isInitial ? 1 : 0 };
        let previousPublicationUpdate = { modifiedCount: isInitial ? 1 : 0 };
        if (!isInitial && previousPolicy && previousPublication) {
          previousPolicyUpdate = await this.policies().updateOne(
            {
              subscriptionTypeId: previousPolicy.subscriptionTypeId,
              version: previousPolicy.version,
              status: 'PUBLISHED',
              revision: input.expectedPreviousPolicyRevision!
            },
            { $set: { status: 'SUPERSEDED' }, $inc: { revision: 1 } },
            { session }
          );
          previousPublicationUpdate = await this.runtimePublications().updateOne(
            {
              publicationId: previousPublication.publicationId,
              state: 'PUBLISHED',
              supersededAt: null,
              supersededBy: null
            },
            {
              $set: {
                state: 'SUPERSEDED',
                supersededAt: input.publication.publishedAt,
                supersededBy: input.publication.publicationId
              }
            },
            { session }
          );
        }
        const policyUpdate = await this.policies().updateOne(
          {
            subscriptionTypeId: policy.subscriptionTypeId,
            version: policy.version,
            status: 'DRAFT',
            revision: input.expectedPolicyRevision
          },
          { $set: { status: 'PUBLISHED' }, $inc: { revision: 1 } },
          { session }
        );
        const typeUpdate = await this.types().updateOne(
          {
            subscriptionTypeId: type.subscriptionTypeId,
            state: isInitial ? 'DRAFT' : 'ACTIVE',
            currentPolicyVersion: isInitial ? null : previousPolicyVersion,
            revision: input.expectedTypeRevision
          },
          {
            $set: {
              state: 'ACTIVE',
              currentPolicyVersion: policy.version,
              updatedAt: input.publication.publishedAt
            },
            $inc: { revision: 1 }
          },
          { session }
        );
        let fenceUpdate = { modifiedCount: isInitial || !persistedFence ? 1 : 0 };
        if (isInitial || !persistedFence) {
          await this.runtimeProjectionFences().insertOne(nextFence, { session });
        } else {
          fenceUpdate = await this.runtimeProjectionFences().updateOne(
            {
              fenceId: persistedFence!.fenceId,
              subscriptionTypeId: persistedFence!.subscriptionTypeId,
              bindingRevision: persistedFence!.bindingRevision,
              coordinationRevision: persistedFence!.coordinationRevision,
              bindingDigest: persistedFence!.bindingDigest
            },
            {
              $set: {
                bindingRevision: nextFence.bindingRevision,
                bindingDigest: nextFence.bindingDigest,
                binding: nextFence.binding,
                coordinationRevision: nextFence.coordinationRevision,
                lastProjectorReconciliationDigest: null,
                updatedAt: nextFence.updatedAt
              }
            },
            { session }
          );
        }
        if (policyUpdate.modifiedCount !== 1
          || typeUpdate.modifiedCount !== 1
          || mappingUpdate.modifiedCount !== 1
          || previousPolicyUpdate.modifiedCount !== 1
          || previousPublicationUpdate.modifiedCount !== 1
          || fenceUpdate.modifiedCount !== 1) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_PUBLICATION_CAS_CONFLICT');
        }
      }, SUBSCRIPTION_FENCED_TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }

  async runtimeInstanceById(
    subscriptionInstanceId: string
  ): Promise<StoredSubscriptionInstance | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeInstances().findOne(
      { subscriptionInstanceId },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionInstance(row);
    return row;
  }

  async runtimeInstanceByTenantAndId(
    tenantId: string,
    subscriptionInstanceId: string
  ): Promise<StoredSubscriptionInstance | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeInstances().findOne(
      { tenantId, subscriptionInstanceId },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionInstance(row);
    return row;
  }

  async runtimeInstanceByProviderIdentity(input: {
    tenantId: string;
    providerClientId: string;
    clientSubscriptionId: string;
  }): Promise<StoredSubscriptionInstance | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeInstances().findOne(input, { projection: { _id: 0 } });
    if (row) validateStoredSubscriptionInstance(row);
    return row;
  }

  async insertRuntimeInstance(document: StoredSubscriptionInstance): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionInstance(document);
    await this.runtimeInstances().insertOne(document);
  }

  async runtimePendingActivationInstances(
    afterId: string | null,
    limit: number
  ): Promise<StoredSubscriptionInstance[]> {
    this.assertRuntimeContractsEnabled();
    const rows = await this.runtimeInstances()
      .find({
        state: 'PENDING_ACTIVATION',
        ...(afterId ? { subscriptionInstanceId: { $gt: afterId } } : {})
      }, { projection: { _id: 0 } })
      .sort({ subscriptionInstanceId: 1 })
      .limit(limit)
      .toArray();
    rows.forEach(validateStoredSubscriptionInstance);
    return rows;
  }

  async activateRuntimeInstance(input: {
    tenantId: string;
    subscriptionInstanceId: string;
    expectedRevision: number;
    activeFrom: string;
    activeTo: string;
    updatedAt: string;
    providerEvidenceRef: string;
    reconciliation: StoredSubscriptionInstance['reconciliation'];
    operation: StoredSubscriptionRuntimeOperation;
    ledger: StoredSubscriptionUsageLedgerEvent;
    outbox: StoredSubscriptionOutboxEvent;
  }): Promise<{ instance: StoredSubscriptionInstance; activated: boolean }> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionRuntimeOperation(input.operation);
    validateStoredSubscriptionUsageLedgerEvent(input.ledger);
    validateStoredSubscriptionOutboxEvent(input.outbox);
    if (input.operation.kind !== 'ACTIVATION'
      || input.operation.state !== 'CONFIRMED'
      || input.operation.subscriptionInstanceId !== input.subscriptionInstanceId
      || input.ledger.eventType !== 'INSTANCE_ACTIVATED'
      || input.ledger.operationId !== input.operation.operationId
      || input.ledger.subscriptionInstanceId !== input.subscriptionInstanceId
      || input.outbox.ledgerEventId !== input.ledger.eventId
      || input.outbox.subscriptionInstanceId !== input.subscriptionInstanceId) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_LINK_MISMATCH');
    }

    const session = this.requireClient().startSession();
    let result: { instance: StoredSubscriptionInstance; activated: boolean } | null = null;
    try {
      await session.withTransaction(async () => {
        const current = await this.runtimeInstances().findOne(
          { tenantId: input.tenantId, subscriptionInstanceId: input.subscriptionInstanceId },
          { projection: { _id: 0 }, session }
        );
        if (!current) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_INSTANCE_NOT_FOUND');
        }
        validateStoredSubscriptionInstance(current);
        if (current.state === 'ACTIVE') {
          result = { instance: current, activated: false };
          return;
        }
        if (current.state !== 'PENDING_ACTIVATION'
          || current.revision !== input.expectedRevision
          || current.activeFrom !== null
          || current.activeTo !== null) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_CAS_CONFLICT');
        }

        const updated = await this.runtimeInstances().findOneAndUpdate(
          {
            tenantId: input.tenantId,
            subscriptionInstanceId: input.subscriptionInstanceId,
            state: 'PENDING_ACTIVATION',
            revision: input.expectedRevision,
            activeFrom: null,
            activeTo: null
          },
          {
            $set: {
              state: 'ACTIVE',
              activeFrom: input.activeFrom,
              activeTo: input.activeTo,
              frozenUntil: null,
              'evidence.lastReadBackEvidenceRef': input.providerEvidenceRef,
              reconciliation: input.reconciliation,
              updatedAt: input.updatedAt
            },
            $inc: { revision: 1 }
          },
          { projection: { _id: 0 }, returnDocument: 'after', session }
        );
        if (!updated) {
          throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_CAS_CONFLICT');
        }
        validateStoredSubscriptionInstance(updated);
        await this.runtimeOperations().insertOne(input.operation, { session });
        await this.runtimeLedger().insertOne(input.ledger, { session });
        await this.runtimeOutbox().insertOne(input.outbox, { session });
        result = { instance: updated, activated: true };
      });
      if (!result) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_TRANSACTION_EMPTY');
      }
      return result;
    } catch (error) {
      if (!this.isDuplicateKey(error)) throw error;
      const current = await this.runtimeInstances().findOne(
        { tenantId: input.tenantId, subscriptionInstanceId: input.subscriptionInstanceId },
        { projection: { _id: 0 } }
      );
      if (current?.state === 'ACTIVE') {
        validateStoredSubscriptionInstance(current);
        return { instance: current, activated: false };
      }
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_ACTIVATION_IDEMPOTENCY_CONFLICT');
    } finally {
      await session.endSession();
    }
  }

  async runtimeEntitlementAggregateByInstance(
    subscriptionInstanceId: string
  ): Promise<StoredSubscriptionEntitlementAggregate | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeAggregates().findOne(
      { subscriptionInstanceId },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionEntitlementAggregate(row);
    return row;
  }

  async insertRuntimeEntitlementAggregate(
    document: StoredSubscriptionEntitlementAggregate
  ): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionEntitlementAggregate(document);
    await this.runtimeAggregates().insertOne(document);
  }

  async runtimeOperationById(operationId: string): Promise<StoredSubscriptionRuntimeOperation | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeOperations().findOne(
      { operationId },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionRuntimeOperation(row);
    return row;
  }

  async runtimeOperationByIdempotency(input: {
    tenantId: string;
    actorId: string;
    kind: StoredSubscriptionRuntimeOperation['kind'];
    keyHash: string;
  }): Promise<StoredSubscriptionRuntimeOperation | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeOperations().findOne(
      {
        tenantId: input.tenantId,
        'actor.actorId': input.actorId,
        kind: input.kind,
        'idempotency.keyHash': input.keyHash
      },
      { projection: { _id: 0 } }
    );
    if (row) validateStoredSubscriptionRuntimeOperation(row);
    return row;
  }

  async insertRuntimeOperation(document: StoredSubscriptionRuntimeOperation): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionRuntimeOperation(document);
    await this.runtimeOperations().insertOne(document);
  }

  async runtimeLedgerEventById(
    eventId: string
  ): Promise<StoredSubscriptionUsageLedgerEvent | null> {
    this.assertRuntimeContractsEnabled();
    const row = await this.runtimeLedger().findOne({ eventId }, { projection: { _id: 0 } });
    if (row) validateStoredSubscriptionUsageLedgerEvent(row);
    return row;
  }

  async appendRuntimeLedgerEventWithOutbox(input: {
    ledger: StoredSubscriptionUsageLedgerEvent;
    outbox: StoredSubscriptionOutboxEvent;
  }): Promise<boolean> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionUsageLedgerEvent(input.ledger);
    validateStoredSubscriptionOutboxEvent(input.outbox);
    if (input.outbox.ledgerEventId !== input.ledger.eventId
      || input.outbox.subscriptionInstanceId !== input.ledger.subscriptionInstanceId) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_OUTBOX_LEDGER_LINK_MISMATCH');
    }
    const session = this.requireClient().startSession();
    let inserted = false;
    try {
      await session.withTransaction(async () => {
        inserted = false;
        const existingLedger = await this.runtimeLedger().findOne(
          { eventId: input.ledger.eventId },
          { projection: { _id: 0 }, session }
        );
        if (existingLedger) {
          if (existingLedger.eventHash !== input.ledger.eventHash) {
            throw new SubscriptionRuntimeContractError(
              'SUBSCRIPTION_LEDGER_IDEMPOTENCY_CONFLICT',
              { eventId: input.ledger.eventId }
            );
          }
        } else {
          await this.runtimeLedger().insertOne(input.ledger, { session });
          inserted = true;
        }

        const existingOutbox = await this.runtimeOutbox().findOne(
          { ledgerEventId: input.ledger.eventId },
          { projection: { _id: 0 }, session }
        );
        if (existingOutbox) {
          this.assertSameOutboxIdentity(existingOutbox, input.outbox);
        } else {
          await this.runtimeOutbox().insertOne(input.outbox, { session });
        }
      });
      return inserted;
    } catch (error) {
      if (!this.isDuplicateKey(error)) throw error;
      if (await this.runtimeAppendAlreadyCommitted(input)) return false;
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_LEDGER_IDEMPOTENCY_CONFLICT', {
        eventId: input.ledger.eventId
      });
    } finally {
      await session.endSession();
    }
  }

  async testOfferByIdempotency(
    actorId: string,
    key: string
  ): Promise<StoredSubscriptionTestOffer | null> {
    return this.testOffers().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async testOfferById(offerId: string): Promise<StoredSubscriptionTestOffer | null> {
    return this.testOffers().findOne({ offerId }, { projection: { _id: 0 } });
  }

  async testOfferByProgramPolicy(
    releaseProgramId: string,
    policyVersion: number
  ): Promise<StoredSubscriptionTestOffer | null> {
    return this.testOffers().findOne(
      { releaseProgramId, policyVersion },
      { projection: { _id: 0 } }
    );
  }

  async testOfferByReleaseProgramId(
    releaseProgramId: string
  ): Promise<StoredSubscriptionTestOffer | null> {
    return this.testOffers().findOne(
      { releaseProgramId, state: 'TEST_ACTIVE' },
      { projection: { _id: 0 }, sort: { createdAt: -1 } }
    );
  }

  async testOfferByTokenHash(accessTokenHash: string): Promise<StoredSubscriptionTestOffer | null> {
    return this.testOffers().findOne({ accessTokenHash }, { projection: { _id: 0 } });
  }

  async insertTestOffer(document: StoredSubscriptionTestOffer): Promise<void> {
    await this.testOffers().insertOne(document);
  }

  async testInventoryByOfferId(offerId: string): Promise<StoredSubscriptionTestInventory | null> {
    return this.testInventories().findOne({ offerId }, { projection: { _id: 0 } });
  }

  async insertTestInventory(document: StoredSubscriptionTestInventory): Promise<void> {
    await this.testInventories().insertOne(document);
  }

  async reserveTestInventory(input: {
    offerId: string;
    phaseId: string;
    phaseOrder: number;
    purchaseMarkerKey: string;
    clientClaimKey: string;
    purchaseLimitPerClient: number;
    now: string;
  }): Promise<StoredSubscriptionTestInventory | null> {
    const markerPath = `purchaseMarkers.${input.purchaseMarkerKey}`;
    const clientClaimPath = `clientClaimCounts.${input.clientClaimKey}`;
    return this.testInventories().findOneAndUpdate(
      {
        offerId: input.offerId,
        currentPhaseOrder: input.phaseOrder,
        [markerPath]: { $exists: false },
        $or: [
          { [clientClaimPath]: { $exists: false } },
          { [clientClaimPath]: { $lt: input.purchaseLimitPerClient } }
        ],
        phases: {
          $elemMatch: {
            phaseId: input.phaseId,
            order: input.phaseOrder,
            available: { $gt: 0 }
          }
        }
      },
      {
        $inc: {
          'phases.$[phase].available': -1,
          'phases.$[phase].reserved': 1,
          [clientClaimPath]: 1,
          revision: 1
        },
        $set: {
          [markerPath]: {
            phaseId: input.phaseId,
            clientClaimKey: input.clientClaimKey,
            state: 'RESERVED',
            updatedAt: input.now
          },
          updatedAt: input.now
        }
      },
      {
        arrayFilters: [{ 'phase.phaseId': input.phaseId }],
        returnDocument: 'after',
        projection: { _id: 0 }
      }
    );
  }

  async finalizeTestInventory(input: {
    offerId: string;
    phaseId: string;
    purchaseMarkerKey: string;
    clientClaimKey: string;
    outcome: 'PAID' | 'FAILED' | 'EXPIRED';
    now: string;
  }): Promise<StoredSubscriptionTestInventory | null> {
    const markerStatePath = `purchaseMarkers.${input.purchaseMarkerKey}.state`;
    const markerUpdatedAtPath = `purchaseMarkers.${input.purchaseMarkerKey}.updatedAt`;
    const increments: Record<string, number> = {
      'phases.$[phase].reserved': -1,
      revision: 1
    };
    increments[input.outcome === 'PAID'
      ? 'phases.$[phase].sold'
      : 'phases.$[phase].available'] = 1;
    if (input.outcome !== 'PAID') increments[`clientClaimCounts.${input.clientClaimKey}`] = -1;
    return this.testInventories().findOneAndUpdate(
      {
        offerId: input.offerId,
        [markerStatePath]: 'RESERVED',
        phases: { $elemMatch: { phaseId: input.phaseId, reserved: { $gt: 0 } } }
      },
      {
        $inc: increments,
        $set: {
          [markerStatePath]: input.outcome,
          [markerUpdatedAtPath]: input.now,
          updatedAt: input.now
        }
      },
      {
        arrayFilters: [{ 'phase.phaseId': input.phaseId }],
        returnDocument: 'after',
        projection: { _id: 0 }
      }
    );
  }

  async activateNextTestPhase(input: {
    offerId: string;
    expectedRevision: number;
    currentPhaseOrder: number;
    nextPhaseOrder: number;
    nextPhaseId: string;
    nextTotalQuantity: number;
    now: string;
  }): Promise<StoredSubscriptionTestInventory | null> {
    return this.testInventories().findOneAndUpdate(
      {
        offerId: input.offerId,
        revision: input.expectedRevision,
        currentPhaseOrder: input.currentPhaseOrder,
        phases: {
          $all: [
            { $elemMatch: { order: input.currentPhaseOrder, available: 0, reserved: 0 } },
            {
              $elemMatch: {
                phaseId: input.nextPhaseId,
                order: input.nextPhaseOrder,
                activation: 'PREVIOUS_SOLD_OUT',
                available: 0,
                reserved: 0,
                sold: 0
              }
            }
          ]
        }
      },
      {
        $set: {
          currentPhaseOrder: input.nextPhaseOrder,
          'phases.$[next].available': input.nextTotalQuantity,
          updatedAt: input.now
        },
        $inc: { revision: 1 }
      },
      {
        arrayFilters: [{ 'next.phaseId': input.nextPhaseId }],
        returnDocument: 'after',
        projection: { _id: 0 }
      }
    );
  }

  async testPurchaseByIdempotency(
    offerId: string,
    keyHash: string
  ): Promise<StoredSubscriptionTestPurchase | null> {
    return this.testPurchases().findOne(
      { offerId, 'idempotency.keyHash': keyHash },
      { projection: { _id: 0 } }
    );
  }

  async testPurchaseById(purchaseId: string): Promise<StoredSubscriptionTestPurchase | null> {
    return this.testPurchases().findOne({ purchaseId }, { projection: { _id: 0 } });
  }

  async insertTestPurchase(document: StoredSubscriptionTestPurchase): Promise<void> {
    await this.testPurchases().insertOne(document);
  }

  async updateCreatingTestPurchaseSnapshot(input: {
    purchaseId: string;
    phaseId: string;
    phaseOrder: number;
    priceSnapshot: { amountMinor: number; currency: 'RUB' };
    expiresAt: string;
    updatedAt: string;
  }): Promise<StoredSubscriptionTestPurchase | null> {
    return this.testPurchases().findOneAndUpdate(
      { purchaseId: input.purchaseId, status: 'CREATING' },
      {
        $set: {
          phaseId: input.phaseId,
          phaseOrder: input.phaseOrder,
          priceSnapshot: input.priceSnapshot,
          expiresAt: input.expiresAt,
          updatedAt: input.updatedAt
        }
      },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  async transitionTestPurchase(input: {
    purchaseId: string;
    from: SubscriptionTestPurchaseStatus;
    to: SubscriptionTestPurchaseStatus;
    updatedAt: string;
  }): Promise<StoredSubscriptionTestPurchase | null> {
    return this.testPurchases().findOneAndUpdate(
      { purchaseId: input.purchaseId, status: input.from },
      { $set: { status: input.to, updatedAt: input.updatedAt } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  async claimTestPurchaseConfirmation(input: {
    purchaseId: string;
    keyHash: string;
    requestHash: string;
    correlationId: string;
    outcome: 'PAID' | 'FAILED' | 'PENDING';
    updatedAt: string;
  }): Promise<StoredSubscriptionTestPurchase | null> {
    const commandPath = `confirmationCommands.${input.keyHash}`;
    return this.testPurchases().findOneAndUpdate(
      { purchaseId: input.purchaseId, [commandPath]: { $exists: false } },
      {
        $set: {
          [commandPath]: {
            requestHash: input.requestHash,
            correlationId: input.correlationId,
            outcome: input.outcome
          },
          updatedAt: input.updatedAt
        }
      },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  async countTestPurchasesForClient(
    offerId: string,
    clientRefHash: string
  ): Promise<number> {
    return this.testPurchases().countDocuments({
      offerId,
      clientRefHash,
      status: { $in: ['PAYMENT_PENDING', 'PAID'] }
    });
  }

  async listExpiredTestPurchases(offerId: string, now: string, limit: number): Promise<StoredSubscriptionTestPurchase[]> {
    return this.testPurchases()
      .find(
        { offerId, status: { $in: ['CREATING', 'PAYMENT_PENDING'] }, expiresAt: { $lte: now } },
        { projection: { _id: 0 } }
      )
      .sort({ expiresAt: 1, purchaseId: 1 })
      .limit(limit)
      .toArray();
  }

  async listUnfinalizedTerminalTestPurchases(
    offerId: string,
    limit: number
  ): Promise<StoredSubscriptionTestPurchase[]> {
    return this.testPurchases()
      .find(
        {
          offerId,
          status: { $in: ['PAID', 'FAILED', 'EXPIRED'] },
          inventoryFinalizedAt: null
        },
        { projection: { _id: 0 } }
      )
      .sort({ updatedAt: 1, purchaseId: 1 })
      .limit(limit)
      .toArray();
  }

  async markTestPurchaseInventoryFinalized(input: {
    purchaseId: string;
    status: 'PAID' | 'FAILED' | 'EXPIRED';
    finalizedAt: string;
  }): Promise<void> {
    await this.testPurchases().updateOne(
      {
        purchaseId: input.purchaseId,
        status: input.status,
        inventoryFinalizedAt: null
      },
      { $set: { inventoryFinalizedAt: input.finalizedAt, updatedAt: input.finalizedAt } }
    );
  }

  async testReservationByPurchaseId(
    purchaseId: string
  ): Promise<StoredSubscriptionTestReservation | null> {
    return this.testReservations().findOne({ purchaseId }, { projection: { _id: 0 } });
  }

  async insertTestReservation(document: StoredSubscriptionTestReservation): Promise<void> {
    await this.testReservations().insertOne(document);
  }

  async transitionTestReservation(input: {
    purchaseId: string;
    from: StoredSubscriptionTestReservation['status'];
    to: StoredSubscriptionTestReservation['status'];
    updatedAt: string;
  }): Promise<void> {
    await this.testReservations().updateOne(
      { purchaseId: input.purchaseId, status: input.from },
      { $set: { status: input.to, updatedAt: input.updatedAt } }
    );
  }

  async insertTestEvent(document: StoredSubscriptionTestEvent): Promise<void> {
    await this.testEvents().updateOne(
      { eventId: document.eventId },
      { $setOnInsert: document },
      { upsert: true }
    );
  }

  isDuplicateKey(error: unknown): boolean {
    return error instanceof MongoServerError && error.code === 11000;
  }

  private validateInitialProjectionPlan(plan: SubscriptionInstanceProjectionPlan): void {
    validateStoredSubscriptionInstanceProjectorCheckpoint(plan.checkpoint);
    plan.instances.forEach(validateStoredSubscriptionInstance);
    if (plan.instances.length < 1
      || plan.checkpoint.state !== 'CURRENT'
      || plan.checkpoint.coverage.kind !== 'CONSISTENT_FULL_SNAPSHOT'
      || plan.checkpoint.reconciliation.mode !== 'INITIAL_FULL'
      || plan.checkpoint.reconciliation.insertedCount !== plan.instances.length
      || plan.checkpoint.reconciliation.replayedCount !== 0
      || plan.instances.some((instance) =>
        instance.tenantId !== plan.checkpoint.tenantId
        || instance.provider !== plan.checkpoint.provider
        || instance.providerProductId !== plan.checkpoint.providerProductId
        || instance.mappingId !== plan.checkpoint.binding.mappingId
        || instance.subscriptionTypeId !== plan.checkpoint.binding.subscriptionTypeId
        || instance.policyVersion !== plan.checkpoint.binding.policyVersion
        || instance.policyDigest !== plan.checkpoint.binding.policyDigest
        || instance.releaseProgramId !== plan.checkpoint.binding.releaseProgramId
        || instance.releasePhaseId !== plan.checkpoint.binding.releasePhaseId)) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_INVALID');
    }
  }

  private instanceProjectorIdentity(
    checkpoint: StoredSubscriptionInstanceProjectorCheckpoint
  ): Record<string, unknown> {
    return {
      tenantId: checkpoint.tenantId,
      provider: checkpoint.provider,
      providerProductId: checkpoint.providerProductId,
      'providerScope.kind': checkpoint.providerScope.kind,
      'providerScope.scopeId': checkpoint.providerScope.scopeId
    };
  }

  private instanceProjectionProductFilter(
    checkpoint: StoredSubscriptionInstanceProjectorCheckpoint
  ): Filter<StoredSubscriptionInstance> {
    return {
      tenantId: checkpoint.tenantId,
      provider: checkpoint.provider,
      providerProductId: checkpoint.providerProductId,
      subscriptionTypeId: checkpoint.binding.subscriptionTypeId
    };
  }

  private types(): Collection<StoredSubscriptionType> {
    return this.requireDb().collection<StoredSubscriptionType>('subscription_types');
  }

  private policies(): Collection<StoredSubscriptionPolicyVersion> {
    return this.requireDb().collection<StoredSubscriptionPolicyVersion>('subscription_policy_versions');
  }

  private programs(): Collection<StoredReleaseProgram> {
    return this.requireDb().collection<StoredReleaseProgram>('subscription_release_programs');
  }

  private runtimeMappings(): Collection<StoredSubscriptionProviderMapping> {
    return this.requireDb().collection<StoredSubscriptionProviderMapping>('subscription_provider_mappings');
  }

  private runtimeCanonicalTargets(): Collection<StoredSubscriptionCanonicalTargetSnapshot> {
    return this.requireDb().collection<StoredSubscriptionCanonicalTargetSnapshot>(
      'subscription_canonical_target_snapshots'
    );
  }

  private runtimePublications(): Collection<StoredSubscriptionPolicyPublication> {
    return this.requireDb().collection<StoredSubscriptionPolicyPublication>('subscription_policy_publications');
  }

  private runtimeProjectionFences(): Collection<StoredSubscriptionProjectionFence> {
    return this.requireDb().collection<StoredSubscriptionProjectionFence>(
      'subscription_projection_fences'
    );
  }

  private runtimeInstances(): Collection<StoredSubscriptionInstance> {
    return this.requireDb().collection<StoredSubscriptionInstance>('subscription_instances');
  }

  private runtimeInstanceProjectorCheckpoints(): Collection<StoredSubscriptionInstanceProjectorCheckpoint> {
    return this.requireDb().collection<StoredSubscriptionInstanceProjectorCheckpoint>(
      'subscription_instance_projector_checkpoints'
    );
  }

  private runtimeBindingPromotions(): Collection<StoredSubscriptionRuntimeBindingPromotion> {
    return this.requireDb().collection<StoredSubscriptionRuntimeBindingPromotion>(
      'subscription_runtime_binding_promotions'
    );
  }

  private runtimeAggregates(): Collection<StoredSubscriptionEntitlementAggregate> {
    return this.requireDb().collection<StoredSubscriptionEntitlementAggregate>('subscription_entitlement_aggregates');
  }

  private runtimeOperations(): Collection<StoredSubscriptionRuntimeOperation> {
    return this.requireDb().collection<StoredSubscriptionRuntimeOperation>('subscription_operations');
  }

  private runtimeLedger(): Collection<StoredSubscriptionUsageLedgerEvent> {
    return this.requireDb().collection<StoredSubscriptionUsageLedgerEvent>('subscription_usage_ledger');
  }

  private runtimeOutbox(): Collection<StoredSubscriptionOutboxEvent> {
    return this.requireDb().collection<StoredSubscriptionOutboxEvent>('subscription_outbox');
  }

  private testOffers(): Collection<StoredSubscriptionTestOffer> {
    return this.requireDb().collection<StoredSubscriptionTestOffer>('subscription_test_offers');
  }

  private testInventories(): Collection<StoredSubscriptionTestInventory> {
    return this.requireDb().collection<StoredSubscriptionTestInventory>('subscription_test_inventories');
  }

  private testReservations(): Collection<StoredSubscriptionTestReservation> {
    return this.requireDb().collection<StoredSubscriptionTestReservation>('subscription_test_reservations');
  }

  private testPurchases(): Collection<StoredSubscriptionTestPurchase> {
    return this.requireDb().collection<StoredSubscriptionTestPurchase>('subscription_test_purchases');
  }

  private testEvents(): Collection<StoredSubscriptionTestEvent> {
    return this.requireDb().collection<StoredSubscriptionTestEvent>('subscription_test_events');
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('Subscriptions MongoDB is not connected');
    return this.db;
  }

  private requireClient(): MongoClient {
    if (!this.client) throw new Error('Subscriptions MongoDB is not connected');
    return this.client;
  }

  private assertSameOutboxIdentity(
    existing: StoredSubscriptionOutboxEvent,
    expected: StoredSubscriptionOutboxEvent
  ): void {
    if (existing.outboxEventId !== expected.outboxEventId
      || existing.ledgerEventId !== expected.ledgerEventId
      || existing.subscriptionInstanceId !== expected.subscriptionInstanceId
      || existing.topic !== expected.topic) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_OUTBOX_IDEMPOTENCY_CONFLICT', {
        ledgerEventId: expected.ledgerEventId
      });
    }
  }

  private async runtimeAppendAlreadyCommitted(input: {
    ledger: StoredSubscriptionUsageLedgerEvent;
    outbox: StoredSubscriptionOutboxEvent;
  }): Promise<boolean> {
    const [ledger, outbox] = await Promise.all([
      this.runtimeLedger().findOne({ eventId: input.ledger.eventId }, { projection: { _id: 0 } }),
      this.runtimeOutbox().findOne(
        { ledgerEventId: input.ledger.eventId },
        { projection: { _id: 0 } }
      )
    ]);
    if (!ledger || ledger.eventHash !== input.ledger.eventHash || !outbox) return false;
    this.assertSameOutboxIdentity(outbox, input.outbox);
    return true;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.types().createIndex(
        { subscriptionTypeId: 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.types[0].name }
      ),
      this.types().createIndex(
        { codeNorm: 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.types[1].name }
      ),
      this.types().createIndex(
        { 'idempotency.actorId': 1, 'idempotency.key': 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.types[2].name }
      ),
      this.types().createIndex(
        { state: 1, updatedAt: -1, subscriptionTypeId: 1 },
        { name: SUBSCRIPTION_REQUIRED_INDEXES.types[3].name }
      ),
      this.policies().createIndex(
        { subscriptionTypeId: 1, version: 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.policies[0].name }
      ),
      this.policies().createIndex(
        { 'idempotency.actorId': 1, 'idempotency.key': 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.policies[1].name }
      ),
      this.policies().createIndex(
        { subscriptionTypeId: 1, status: 1, version: -1 },
        { name: SUBSCRIPTION_REQUIRED_INDEXES.policies[2].name }
      ),
      this.programs().createIndex(
        { releaseProgramId: 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.programs[0].name }
      ),
      this.programs().createIndex(
        { 'idempotency.actorId': 1, 'idempotency.key': 1 },
        { unique: true, name: SUBSCRIPTION_REQUIRED_INDEXES.programs[1].name }
      ),
      this.programs().createIndex(
        { stationId: 1, state: 1, updatedAt: -1, releaseProgramId: 1 },
        { name: SUBSCRIPTION_REQUIRED_INDEXES.programs[2].name }
      ),
      this.programs().createIndex(
        { subscriptionTypeId: 1, stationId: 1, state: 1 },
        { name: SUBSCRIPTION_REQUIRED_INDEXES.programs[3].name }
      )
    ]);
    // Runtime indexes are intentionally verify-only in application startup.
    // Creation is permitted only through the guarded index script with duplicate preflight.
    if (this.runtimeContractsEnabled()) await this.verifyRuntimeIndexes();
    if (this.testRuntimeEnabled()) await this.ensureTestIndexes();
  }

  private async verifyIndexes(): Promise<void> {
    const checks = await Promise.all([
      this.types().listIndexes().toArray(),
      this.policies().listIndexes().toArray(),
      this.programs().listIndexes().toArray()
    ]);
    const missing = [SUBSCRIPTION_REQUIRED_INDEXES.types, SUBSCRIPTION_REQUIRED_INDEXES.policies, SUBSCRIPTION_REQUIRED_INDEXES.programs]
      .flatMap((required, index) => required
        .filter((expected) => {
          const actual = checks[index].find((item) => item.name === expected.name);
          return !subscriptionIndexMatches(actual, expected);
        })
        .map((expected) => expected.name));
    if (missing.length) {
      throw new Error(`SUBSCRIPTIONS_INDEXES_NOT_READY:${missing.join(',')}`);
    }
    if (this.runtimeContractsEnabled()) await this.verifyRuntimeIndexes();
    if (this.testRuntimeEnabled()) await this.verifyTestIndexes();
  }

  private runtimeContractsEnabled(): boolean {
    const value = String(process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private assertRuntimeContractsEnabled(): void {
    if (!this.runtimeContractsEnabled()) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_RUNTIME_CONTRACTS_DISABLED');
    }
  }

  private instanceProjectorContractsEnabled(): boolean {
    const value = String(process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private assertInstanceProjectorContractsEnabled(): void {
    this.assertInstanceProjectorConfiguration();
    if (!this.runtimeContractsEnabled()) this.assertRuntimeContractsEnabled();
    if (!this.instanceProjectorContractsEnabled()) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_DISABLED');
    }
  }

  private assertInstanceProjectorConfiguration(): void {
    if (this.instanceProjectorContractsEnabled() && !this.runtimeContractsEnabled()) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_CONFIG_INVALID');
    }
    if (this.bindingPromotionContractsEnabled() && !this.runtimeContractsEnabled()) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_CONFIG_INVALID');
    }
  }

  private bindingPromotionContractsEnabled(): boolean {
    const value = String(process.env.SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private assertBindingPromotionContractsEnabled(): void {
    this.assertInstanceProjectorConfiguration();
    if (!this.runtimeContractsEnabled()) this.assertRuntimeContractsEnabled();
    if (!this.bindingPromotionContractsEnabled()) {
      throw new SubscriptionRuntimeContractError(
        'SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_DISABLED'
      );
    }
  }

  private testRuntimeEnabled(): boolean {
    const value = String(process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private async verifyRuntimeIndexes(): Promise<void> {
    const groups = [
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.canonicalTargets,
        actual: await this.runtimeCanonicalTargets().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.mappings,
        actual: await this.runtimeMappings().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.publications,
        actual: await this.runtimePublications().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.projectionFences,
        actual: await this.runtimeProjectionFences().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.instances,
        actual: await this.runtimeInstances().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.aggregates,
        actual: await this.runtimeAggregates().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.operations,
        actual: await this.runtimeOperations().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.ledger,
        actual: await this.runtimeLedger().listIndexes().toArray()
      },
      {
        required: SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.outbox,
        actual: await this.runtimeOutbox().listIndexes().toArray()
      }
    ];
    const missing = groups.flatMap(({ required, actual }) => required
      .filter((expected) => !subscriptionIndexMatches(
        actual.find((item) => item.name === expected.name),
        expected
      ))
      .map((expected) => expected.name));
    if (missing.length) {
      throw new Error(`SUBSCRIPTIONS_RUNTIME_INDEXES_NOT_READY:${missing.join(',')}`);
    }
    if (this.instanceProjectorContractsEnabled()) await this.verifyInstanceProjectorIndexes();
    if (this.bindingPromotionContractsEnabled()) await this.verifyBindingPromotionIndexes();
  }

  private async verifyBindingPromotionIndexes(): Promise<void> {
    try {
      const actual = await this.runtimeBindingPromotions().listIndexes().toArray();
      const missing = SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.bindingPromotions
        .filter((expected) => !subscriptionIndexMatches(
          actual.find((item) => item.name === expected.name),
          expected
        ))
        .map((expected) => expected.name);
      if (missing.length) {
        throw new Error(`SUBSCRIPTIONS_BINDING_PROMOTION_INDEXES_NOT_READY:${missing.join(',')}`);
      }
    } catch (error) {
      if (error instanceof Error
        && error.message.startsWith('SUBSCRIPTIONS_BINDING_PROMOTION_INDEXES_NOT_READY:')) {
        throw error;
      }
      throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INDEXES_NOT_READY');
    }
  }

  private async verifyInstanceProjectorIndexes(): Promise<void> {
    try {
      const actual = await this.runtimeInstanceProjectorCheckpoints().listIndexes().toArray();
      const missing = SUBSCRIPTION_RUNTIME_REQUIRED_INDEXES.instanceProjectorCheckpoints
        .filter((expected) => !subscriptionIndexMatches(
          actual.find((item) => item.name === expected.name),
          expected
        ))
        .map((expected) => expected.name);
      if (missing.length) {
        throw new Error(`SUBSCRIPTIONS_INSTANCE_PROJECTOR_INDEXES_NOT_READY:${missing.join(',')}`);
      }
    } catch (error) {
      if (error instanceof Error
        && error.message.startsWith('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INDEXES_NOT_READY:')) {
        throw error;
      }
      throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INDEXES_NOT_READY');
    }
  }

  private async ensureTestIndexes(): Promise<void> {
    await Promise.all([
      ...SUBSCRIPTION_TEST_REQUIRED_INDEXES.offers.map((index) =>
        this.testOffers().createIndex(index.key, { unique: index.unique, name: index.name })
      ),
      ...SUBSCRIPTION_TEST_REQUIRED_INDEXES.inventories.map((index) =>
        this.testInventories().createIndex(index.key, { unique: index.unique, name: index.name })
      ),
      ...SUBSCRIPTION_TEST_REQUIRED_INDEXES.reservations.map((index) =>
        this.testReservations().createIndex(index.key, { unique: index.unique, name: index.name })
      ),
      ...SUBSCRIPTION_TEST_REQUIRED_INDEXES.purchases.map((index) =>
        this.testPurchases().createIndex(index.key, { unique: index.unique, name: index.name })
      ),
      ...SUBSCRIPTION_TEST_REQUIRED_INDEXES.events.map((index) =>
        this.testEvents().createIndex(index.key, { unique: index.unique, name: index.name })
      )
    ]);
  }

  private async verifyTestIndexes(): Promise<void> {
    const groups = [
      { required: SUBSCRIPTION_TEST_REQUIRED_INDEXES.offers, actual: await this.testOffers().listIndexes().toArray() },
      { required: SUBSCRIPTION_TEST_REQUIRED_INDEXES.inventories, actual: await this.testInventories().listIndexes().toArray() },
      { required: SUBSCRIPTION_TEST_REQUIRED_INDEXES.reservations, actual: await this.testReservations().listIndexes().toArray() },
      { required: SUBSCRIPTION_TEST_REQUIRED_INDEXES.purchases, actual: await this.testPurchases().listIndexes().toArray() },
      { required: SUBSCRIPTION_TEST_REQUIRED_INDEXES.events, actual: await this.testEvents().listIndexes().toArray() }
    ];
    const missing = groups.flatMap(({ required, actual }) => required
      .filter((expected) => !subscriptionIndexMatches(
        actual.find((item) => item.name === expected.name),
        expected
      ))
      .map((expected) => expected.name));
    if (missing.length) {
      throw new Error(`SUBSCRIPTIONS_TEST_INDEXES_NOT_READY:${missing.join(',')}`);
    }
  }
}
