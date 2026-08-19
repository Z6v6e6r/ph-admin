import { Injectable } from '@nestjs/common';
import { Collection, Db, Filter, MongoClient, MongoServerError } from 'mongodb';
import {
  StoredReleaseProgram,
  StoredSubscriptionCanonicalTargetSnapshot,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
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
  validateStoredSubscriptionOutboxEvent,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProviderMapping,
  validateStoredSubscriptionRuntimeOperation,
  validateStoredSubscriptionUsageLedgerEvent
} from './subscription-runtime-contracts';

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
  ]
} as const;

export function subscriptionIndexMatches(
  actual: { name?: string; key?: unknown; unique?: boolean } | undefined,
  expected: { name: string; key: unknown; unique: boolean }
): boolean {
  return Boolean(actual)
    && actual?.name === expected.name
    && JSON.stringify(actual.key) === JSON.stringify(expected.key)
    && Boolean(actual.unique) === expected.unique;
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

  async insertRuntimePolicyPublication(
    document: StoredSubscriptionPolicyPublication
  ): Promise<void> {
    this.assertRuntimeContractsEnabled();
    validateStoredSubscriptionPolicyPublication(document);
    await this.runtimePublications().insertOne(document);
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

  private runtimeInstances(): Collection<StoredSubscriptionInstance> {
    return this.requireDb().collection<StoredSubscriptionInstance>('subscription_instances');
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
