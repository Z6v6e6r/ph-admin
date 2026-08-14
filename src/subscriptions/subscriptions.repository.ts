import { Injectable } from '@nestjs/common';
import { Collection, Db, Filter, MongoClient, MongoServerError } from 'mongodb';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionTestEvent,
  StoredSubscriptionTestInventory,
  StoredSubscriptionTestOffer,
  StoredSubscriptionTestPurchase,
  StoredSubscriptionTestReservation,
  StoredSubscriptionType,
  SubscriptionTestPurchaseStatus
} from './subscriptions.types';

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

  async connect(): Promise<void> {
    if (this.connectionPromise) return this.connectionPromise;
    if (this.db) return;
    const pending = this.initialize();
    this.connectionPromise = pending;
    try {
      await pending;
    } finally {
      if (this.connectionPromise === pending) this.connectionPromise = undefined;
    }
  }

  private async initialize(): Promise<void> {
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
    const autoCreate = rawAutoCreate
      ? rawAutoCreate === '1' || rawAutoCreate.toLowerCase() === 'true'
      : process.env.NODE_ENV !== 'production';
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
    if (this.testRuntimeEnabled()) await this.verifyTestIndexes();
  }

  private testRuntimeEnabled(): boolean {
    const value = String(process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
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
