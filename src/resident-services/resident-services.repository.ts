import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  ClientSession,
  Collection,
  Db,
  Document,
  MongoClient,
  MongoServerError,
  TransactionOptions
} from 'mongodb';
import {
  ensureMongoIndex,
  isMongoIndexReadinessError,
  isProductionRuntime
} from '../common/mongo-index.guard';
import {
  ResidentBenefitRuleWrite,
  ResidentJournalPage,
  ResidentJournalQuery,
  ResidentServiceConsumptionResult
} from './resident-services.repository.types';
import {
  RESIDENT_SERVICES_ERROR_CODES,
  StoredResidentBenefitRule,
  StoredResidentIssuance,
  StoredResidentJournalEvent,
  StoredResidentPass,
  StoredResidentReturn,
  StoredResidentServiceUsage
} from './resident-services.types';
import type {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProviderMapping,
  StoredSubscriptionType
} from '../subscriptions/subscriptions.types';

export const RESIDENT_PASS_RETENTION_SECONDS = 86400;

export const RESIDENT_SERVICES_TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary'
};

export const RESIDENT_SERVICES_REQUIRED_INDEXES = {
  passes: [
    { name: 'resident_pass_id_unique', key: { passId: 1 }, unique: true },
    { name: 'resident_pass_token_unique', key: { tokenHash: 1 }, unique: true },
    {
      name: 'resident_pass_instance_state',
      key: { tenantId: 1, subscriptionInstanceId: 1, state: 1, expiresAt: 1 },
      unique: false
    },
    {
      name: 'resident_pass_expires_ttl',
      key: { expiresAtDate: 1 },
      unique: false,
      expireAfterSeconds: RESIDENT_PASS_RETENTION_SECONDS
    }
  ],
  benefitRules: [
    { name: 'resident_benefit_rule_id_unique', key: { ruleId: 1 }, unique: true },
    {
      name: 'resident_benefit_rule_scope_unique',
      key: { tenantId: 1, subscriptionTypeId: 1, serviceKind: 1, stationScopeKey: 1 },
      unique: true
    },
    {
      name: 'resident_benefit_rule_idempotency_unique',
      key: { tenantId: 1, 'idempotency.actorId': 1, 'idempotency.keyHash': 1 },
      unique: true,
      partialFilterExpression: { 'idempotency.keyHash': { $exists: true } }
    },
    {
      name: 'resident_benefit_rule_type',
      key: { tenantId: 1, subscriptionTypeId: 1, serviceKind: 1, enabled: 1, updatedAt: -1 },
      unique: false
    }
  ],
  usage: [
    {
      name: 'resident_service_usage_unique',
      key: {
        tenantId: 1,
        clientRefHash: 1,
        serviceKind: 1,
        limitPeriod: 1,
        periodKey: 1
      },
      unique: true
    },
    {
      name: 'resident_service_usage_client',
      key: { tenantId: 1, clientRefHash: 1, updatedAt: -1 },
      unique: false
    }
  ],
  issuances: [
    { name: 'resident_issuance_id_unique', key: { issuanceId: 1 }, unique: true },
    {
      name: 'resident_issuance_idempotency_unique',
      key: { tenantId: 1, 'idempotency.keyHash': 1 },
      unique: true
    },
    {
      name: 'resident_issuance_station',
      key: { tenantId: 1, stationId: 1, issuedAt: -1, issuanceId: 1 },
      unique: false
    },
    {
      name: 'resident_issuance_client',
      key: { tenantId: 1, clientRefHash: 1, issuedAt: -1 },
      unique: false
    }
  ],
  returns: [
    { name: 'resident_return_id_unique', key: { returnId: 1 }, unique: true },
    {
      name: 'resident_return_idempotency_unique',
      key: { tenantId: 1, 'idempotency.keyHash': 1 },
      unique: true
    },
    {
      name: 'resident_return_issuance',
      key: { tenantId: 1, issuanceId: 1, returnedAt: -1 },
      unique: false
    }
  ],
  journal: [
    { name: 'resident_journal_event_unique', key: { eventId: 1 }, unique: true },
    {
      name: 'resident_journal_tenant_time',
      key: { tenantId: 1, occurredAt: -1, eventId: -1 },
      unique: false
    },
    {
      name: 'resident_journal_station_time',
      key: { tenantId: 1, stationId: 1, occurredAt: -1, eventId: -1 },
      unique: false
    },
    {
      name: 'resident_journal_issuance',
      key: { tenantId: 1, issuanceId: 1, occurredAt: -1 },
      unique: false
    }
  ]
} as const;

const INDEX_COLLECTIONS = {
  passes: 'passes',
  benefitRules: 'benefitRules',
  usage: 'usage',
  issuances: 'issuances',
  returns: 'returns',
  journal: 'journal'
} as const;

export function isResidentDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError
    ? error.code === 11000
    : Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 11000);
}

@Injectable()
export class ResidentServicesRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResidentServicesRepository.name);
  private readonly enabled = ['1', 'true', 'yes'].includes(
    String(process.env.RESIDENT_SERVICES_ENABLED ?? '').trim().toLowerCase()
  );
  private readonly mongoUri = String(
    process.env.RESIDENT_SERVICES_MONGODB_URI
      ?? process.env.SUBSCRIPTIONS_MONGODB_URI
      ?? process.env.MONGODB_URI
      ?? ''
  ).trim();
  private readonly dbName = String(
    process.env.RESIDENT_SERVICES_MONGODB_DB
      ?? process.env.SUBSCRIPTIONS_MONGODB_DB
      ?? process.env.MONGODB_DB
      ?? ''
  ).trim();
  private readonly passesCollectionName = String(
    process.env.RESIDENT_SERVICES_PASSES_COLLECTION ?? 'cup_resident_passes'
  ).trim();
  private readonly benefitRulesCollectionName = String(
    process.env.RESIDENT_SERVICES_BENEFIT_RULES_COLLECTION ?? 'cup_resident_benefit_rules'
  ).trim();
  private readonly usageCollectionName = String(
    process.env.RESIDENT_SERVICES_USAGE_COLLECTION ?? 'cup_resident_service_usage'
  ).trim();
  private readonly issuancesCollectionName = String(
    process.env.RESIDENT_SERVICES_ISSUANCES_COLLECTION ?? 'cup_resident_service_issuances'
  ).trim();
  private readonly returnsCollectionName = String(
    process.env.RESIDENT_SERVICES_RETURNS_COLLECTION ?? 'cup_resident_service_returns'
  ).trim();
  private readonly journalCollectionName = String(
    process.env.RESIDENT_SERVICES_JOURNAL_COLLECTION ?? 'cup_resident_service_journal'
  ).trim();
  private readonly subscriptionsTypesCollectionName = String(
    process.env.RESIDENT_SERVICES_SUBSCRIPTION_TYPES_COLLECTION ?? 'subscription_types'
  ).trim();
  private readonly subscriptionsInstancesCollectionName = String(
    process.env.RESIDENT_SERVICES_SUBSCRIPTION_INSTANCES_COLLECTION ?? 'subscription_instances'
  ).trim();
  private readonly subscriptionsPublicationsCollectionName = String(
    process.env.RESIDENT_SERVICES_SUBSCRIPTION_PUBLICATIONS_COLLECTION
      ?? 'subscription_policy_publications'
  ).trim();
  private readonly subscriptionsMappingsCollectionName = String(
    process.env.RESIDENT_SERVICES_SUBSCRIPTION_MAPPINGS_COLLECTION
      ?? 'subscription_provider_mappings'
  ).trim();
  private client?: MongoClient;
  private db?: Db;
  private unavailableReason = this.enabled
    ? 'MongoDB connection is not initialized'
    : 'Feature is disabled';

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Resident services are disabled by RESIDENT_SERVICES_ENABLED.');
      return;
    }
    if (!this.mongoUri || !this.dbName) {
      this.unavailableReason =
        'RESIDENT_SERVICES_MONGODB_URI and RESIDENT_SERVICES_MONGODB_DB are required';
      this.logger.error(this.unavailableReason);
      return;
    }
    const client = new MongoClient(this.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });
    try {
      await client.connect();
      this.client = client;
      this.db = client.db(this.dbName);
      const rawAutoCreate = String(
        process.env.RESIDENT_SERVICES_AUTO_CREATE_INDEXES ?? ''
      ).trim();
      const autoCreate = rawAutoCreate
        ? ['1', 'true', 'yes'].includes(rawAutoCreate.toLowerCase())
        : !isProductionRuntime();
      if (autoCreate) await this.ensureIndexes();
      else await this.verifyIndexes();
      this.unavailableReason = '';
      this.logger.log('Resident services persistence enabled. db=' + this.dbName);
    } catch (error) {
      this.unavailableReason = 'Resident services persistence initialization failed';
      this.logger.error('Resident services persistence unavailable: ' + String(error));
      this.db = undefined;
      await client.close().catch(() => undefined);
      this.client = undefined;
      if (isMongoIndexReadinessError(error)) throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
    this.db = undefined;
  }

  async close(): Promise<void> {
    await this.onModuleDestroy();
  }

  isFeatureEnabled(): boolean {
    return this.enabled;
  }

  isAvailable(): boolean {
    return Boolean(this.db);
  }

  requireAvailable(): void {
    if (!this.db) {
      throw new ServiceUnavailableException({
        code: RESIDENT_SERVICES_ERROR_CODES.PERSISTENCE_UNAVAILABLE,
        message: this.unavailableReason || 'Resident services persistence is unavailable'
      });
    }
  }

  async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    this.requireAvailable();
    const session = this.requireClient().startSession();
    try {
      let result: T | undefined;
      let produced = false;
      await session.withTransaction(
        async () => {
          result = await work(session);
          produced = true;
        },
        RESIDENT_SERVICES_TRANSACTION_OPTIONS
      );
      if (!produced) {
        throw new Error('RESIDENT_SERVICES_TRANSACTION_RESULT_MISSING');
      }
      return result as T;
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  async findPassByTokenHash(
    tokenHash: string,
    session?: ClientSession
  ): Promise<StoredResidentPass | null> {
    return this.passes().findOne(
      { tokenHash },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async findPassById(
    passId: string,
    session?: ClientSession
  ): Promise<StoredResidentPass | null> {
    return this.passes().findOne(
      { passId },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async insertPass(pass: StoredResidentPass, session?: ClientSession): Promise<void> {
    await this.passes().insertOne({ ...pass }, session ? { session } : {});
  }

  async consumePass(input: {
    passId: string;
    tenantId: string;
    expectedRevision: number;
    now: Date;
    consumedBy: string;
    consumedStationId: string;
    operationId: string;
    session?: ClientSession;
  }): Promise<StoredResidentPass | null> {
    const nowIso = input.now.toISOString();
    return this.passes().findOneAndUpdate(
      {
        passId: input.passId,
        tenantId: input.tenantId,
        state: 'ACTIVE',
        revision: input.expectedRevision,
        expiresAt: { $gt: nowIso }
      },
      {
        $set: {
          state: 'CONSUMED',
          consumedAt: nowIso,
          consumedBy: input.consumedBy,
          consumedStationId: input.consumedStationId,
          consumedOperationId: input.operationId,
          updatedAt: nowIso
        },
        $inc: { revision: 1 }
      },
      {
        projection: { _id: 0 },
        returnDocument: 'after',
        ...(input.session ? { session: input.session } : {})
      }
    );
  }

  async subscriptionTypeById(
    subscriptionTypeId: string,
    session?: ClientSession
  ): Promise<StoredSubscriptionType | null> {
    return this.subscriptionTypes().findOne(
      { subscriptionTypeId },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async runtimeInstanceByProviderIdentity(input: {
    tenantId: string;
    providerClientId: string;
    clientSubscriptionId: string;
    session?: ClientSession;
  }): Promise<StoredSubscriptionInstance | null> {
    return this.subscriptionInstances().findOne(
      {
        tenantId: input.tenantId,
        providerClientId: input.providerClientId,
        clientSubscriptionId: input.clientSubscriptionId
      },
      { projection: { _id: 0 }, ...(input.session ? { session: input.session } : {}) }
    );
  }

  async runtimeInstanceByTenantAndId(
    tenantId: string,
    subscriptionInstanceId: string,
    session?: ClientSession
  ): Promise<StoredSubscriptionInstance | null> {
    return this.subscriptionInstances().findOne(
      { tenantId, subscriptionInstanceId },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async providerMappingById(
    mappingId: string,
    session?: ClientSession
  ): Promise<StoredSubscriptionProviderMapping | null> {
    return this.subscriptionMappings().findOne(
      { mappingId },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async policyPublicationHistoryByType(
    subscriptionTypeId: string,
    session?: ClientSession
  ): Promise<StoredSubscriptionPolicyPublication[]> {
    return this.subscriptionPublications()
      .find(
        { subscriptionTypeId },
        { projection: { _id: 0 }, ...(session ? { session } : {}) }
      )
      .sort({ effectiveAt: 1, publicationId: 1 })
      .toArray();
  }

  async benefitRulesByType(
    tenantId: string,
    subscriptionTypeId: string,
    session?: ClientSession
  ): Promise<StoredResidentBenefitRule[]> {
    return this.benefitRules()
      .find(
        { tenantId, subscriptionTypeId },
        { projection: { _id: 0 }, ...(session ? { session } : {}) }
      )
      .sort({ serviceKind: 1, stationScopeKey: 1, ruleId: 1 })
      .toArray();
  }

  async benefitRulesByTenant(tenantId: string): Promise<StoredResidentBenefitRule[]> {
    return this.benefitRules()
      .find({ tenantId }, { projection: { _id: 0 } })
      .sort({ subscriptionTypeId: 1, serviceKind: 1, stationScopeKey: 1 })
      .toArray();
  }

  async benefitRuleById(
    tenantId: string,
    ruleId: string
  ): Promise<StoredResidentBenefitRule | null> {
    return this.benefitRules().findOne(
      { tenantId, ruleId },
      { projection: { _id: 0 } }
    );
  }

  async benefitRuleByIdempotency(
    tenantId: string,
    actorId: string,
    keyHash: string
  ): Promise<StoredResidentBenefitRule | null> {
    return this.benefitRules().findOne(
      { tenantId, 'idempotency.actorId': actorId, 'idempotency.keyHash': keyHash },
      { projection: { _id: 0 } }
    );
  }

  async insertBenefitRule(rule: StoredResidentBenefitRule): Promise<void> {
    await this.benefitRules().insertOne({ ...rule });
  }

  async updateBenefitRule(input: {
    tenantId: string;
    ruleId: string;
    expectedRevision: number;
    rule: ResidentBenefitRuleWrite;
  }): Promise<StoredResidentBenefitRule | null> {
    return this.benefitRules().findOneAndUpdate(
      { tenantId: input.tenantId, ruleId: input.ruleId, revision: input.expectedRevision },
      {
        $set: {
          stationScopeKey: input.rule.stationScopeKey,
          stationScope: input.rule.stationScope,
          limitPeriod: input.rule.limitPeriod,
          limitQuantity: input.rule.limitQuantity,
          returnable: input.rule.returnable,
          enabled: input.rule.enabled,
          updatedBy: input.rule.updatedBy,
          updatedAt: input.rule.updatedAt
        },
        $inc: { revision: 1 }
      },
      { projection: { _id: 0 }, returnDocument: 'after' }
    );
  }

  async usageFor(input: {
    tenantId: string;
    clientRefHash: string;
    serviceKind: StoredResidentServiceUsage['serviceKind'];
    limitPeriod: StoredResidentServiceUsage['limitPeriod'];
    periodKey: string;
    session?: ClientSession;
  }): Promise<StoredResidentServiceUsage | null> {
    return this.usage().findOne(
      {
        tenantId: input.tenantId,
        clientRefHash: input.clientRefHash,
        serviceKind: input.serviceKind,
        limitPeriod: input.limitPeriod,
        periodKey: input.periodKey
      },
      { projection: { _id: 0 }, ...(input.session ? { session: input.session } : {}) }
    );
  }

  async consumeUsage(input: {
    tenantId: string;
    subscriptionInstanceId: string;
    clientRefHash: string;
    serviceKind: StoredResidentServiceUsage['serviceKind'];
    limitPeriod: StoredResidentServiceUsage['limitPeriod'];
    periodKey: string;
    quantity: number;
    limitQuantity: number;
    now: Date;
    session?: ClientSession;
  }): Promise<ResidentServiceConsumptionResult | null> {
    const identity = {
      tenantId: input.tenantId,
      clientRefHash: input.clientRefHash,
      serviceKind: input.serviceKind,
      limitPeriod: input.limitPeriod,
      periodKey: input.periodKey
    };
    const nowIso = input.now.toISOString();
    const sessionOption = input.session ? { session: input.session } : {};
    const updated = await this.usage().findOneAndUpdate(
      { ...identity, used: { $lte: input.limitQuantity - input.quantity } },
      {
        $inc: { used: input.quantity, revision: 1 },
        $set: {
          updatedAt: nowIso,
          lastSubscriptionInstanceId: input.subscriptionInstanceId
        }
      },
      { projection: { _id: 0 }, returnDocument: 'after', ...sessionOption }
    );
    if (updated) {
      return {
        used: updated.used,
        remaining: Math.max(0, input.limitQuantity - updated.used)
      };
    }
    const existing = await this.usage().findOne(
      identity,
      { projection: { _id: 0 }, ...sessionOption }
    );
    if (existing) return null;
    try {
      await this.usage().insertOne({
        schemaVersion: 1,
        ...identity,
        subscriptionInstanceId: input.subscriptionInstanceId,
        lastSubscriptionInstanceId: input.subscriptionInstanceId,
        used: input.quantity,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso
      }, sessionOption);
      return {
        used: input.quantity,
        remaining: Math.max(0, input.limitQuantity - input.quantity)
      };
    } catch (error) {
      // A duplicate here means a concurrent transaction committed the same
      // counter between our snapshot and the insert. The enclosing transaction
      // is aborted, so the caller must retry the whole command; never continue
      // on the same session.
      throw error;
    }
  }

  async issuanceByIdempotency(
    tenantId: string,
    keyHash: string,
    session?: ClientSession
  ): Promise<StoredResidentIssuance | null> {
    return this.issuances().findOne(
      { tenantId, 'idempotency.keyHash': keyHash },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async issuanceById(
    tenantId: string,
    issuanceId: string,
    session?: ClientSession
  ): Promise<StoredResidentIssuance | null> {
    return this.issuances().findOne(
      { tenantId, issuanceId },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async insertIssuance(
    issuance: StoredResidentIssuance,
    session?: ClientSession
  ): Promise<void> {
    await this.issuances().insertOne({ ...issuance }, session ? { session } : {});
  }

  async updateIssuanceAfterReturn(input: {
    tenantId: string;
    issuanceId: string;
    expectedRevision: number;
    items: StoredResidentIssuance['items'];
    state: StoredResidentIssuance['state'];
    returnedAt: string;
    returnId: string;
    session?: ClientSession;
  }): Promise<StoredResidentIssuance | null> {
    return this.issuances().findOneAndUpdate(
      {
        tenantId: input.tenantId,
        issuanceId: input.issuanceId,
        revision: input.expectedRevision
      },
      {
        $set: {
          items: input.items,
          state: input.state,
          returnedAt: input.returnedAt,
          lastReturnId: input.returnId,
          updatedAt: input.returnedAt
        },
        $inc: { revision: 1 }
      },
      {
        projection: { _id: 0 },
        returnDocument: 'after',
        ...(input.session ? { session: input.session } : {})
      }
    );
  }

  async returnByIdempotency(
    tenantId: string,
    keyHash: string,
    session?: ClientSession
  ): Promise<StoredResidentReturn | null> {
    return this.returns().findOne(
      { tenantId, 'idempotency.keyHash': keyHash },
      { projection: { _id: 0 }, ...(session ? { session } : {}) }
    );
  }

  async insertReturn(
    document: StoredResidentReturn,
    session?: ClientSession
  ): Promise<void> {
    await this.returns().insertOne({ ...document }, session ? { session } : {});
  }

  async appendJournal(
    events: StoredResidentJournalEvent[],
    session?: ClientSession
  ): Promise<void> {
    if (events.length === 0) return;
    await this.journal().insertMany(
      events.map((event) => ({ ...event })),
      session ? { session, ordered: true } : { ordered: true }
    );
  }

  async listJournal(query: ResidentJournalQuery): Promise<ResidentJournalPage> {
    const filter: Document = { tenantId: query.tenantId };
    if (query.stationId) filter.stationId = query.stationId;
    else if (query.stationIds !== null) filter.stationId = { $in: query.stationIds };
    if (query.from || query.to) {
      const occurredAt: Document = {};
      if (query.from) occurredAt.$gte = query.from;
      if (query.to) occurredAt.$lte = query.to;
      filter.occurredAt = occurredAt;
    }
    if (query.cursor) {
      filter.$or = [
        { occurredAt: { $lt: query.cursor.occurredAt } },
        { occurredAt: query.cursor.occurredAt, eventId: { $lt: query.cursor.eventId } }
      ];
      if (filter.occurredAt) {
        filter.$and = [{ occurredAt: filter.occurredAt }];
        delete filter.occurredAt;
      }
    }
    const rows = await this.journal().find(
      filter,
      { projection: { _id: 0 } }
    ).sort({ occurredAt: -1, eventId: -1 }).limit(query.limit + 1).toArray();
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? { occurredAt: last.occurredAt, eventId: last.eventId }
        : null
    };
  }

  private async ensureIndexes(): Promise<void> {
    const plan = RESIDENT_SERVICES_REQUIRED_INDEXES;
    const collections = this.collectionMap();
    for (const name of Object.keys(INDEX_COLLECTIONS) as Array<keyof typeof INDEX_COLLECTIONS>) {
      for (const index of plan[name]) {
        const options: Document = { name: index.name, unique: index.unique };
        if ('sparse' in index && index.sparse) options.sparse = true;
        if ('partialFilterExpression' in index && index.partialFilterExpression) {
          options.partialFilterExpression = index.partialFilterExpression;
        }
        if ('expireAfterSeconds' in index && index.expireAfterSeconds) {
          options.expireAfterSeconds = index.expireAfterSeconds;
        }
        await ensureMongoIndex(collections[name], index.key, options);
      }
    }
  }

  private async verifyIndexes(): Promise<void> {
    const plan = RESIDENT_SERVICES_REQUIRED_INDEXES;
    const collections = this.collectionMap();
    for (const name of Object.keys(INDEX_COLLECTIONS) as Array<keyof typeof INDEX_COLLECTIONS>) {
      let existing: Document[];
      try {
        existing = await collections[name].listIndexes().toArray();
      } catch (error) {
        throw new Error(
          'MONGO_INDEX_READINESS_CHECK_FAILED:' + collections[name].collectionName + ':'
            + (error instanceof Error ? error.name : 'UnknownError')
        );
      }
      for (const expected of plan[name]) {
        const actual = existing.find((index) => index.name === expected.name);
        const options: Document = {};
        if ('sparse' in expected && expected.sparse) options.sparse = true;
        if ('partialFilterExpression' in expected && expected.partialFilterExpression) {
          options.partialFilterExpression = expected.partialFilterExpression;
        }
        if ('expireAfterSeconds' in expected && expected.expireAfterSeconds) {
          options.expireAfterSeconds = expected.expireAfterSeconds;
        }
        if (!actual
          || JSON.stringify(actual.key) !== JSON.stringify(expected.key)
          || Boolean(actual.unique) !== Boolean(expected.unique)
          || Boolean(actual.sparse) !== Boolean(options.sparse)
          || JSON.stringify(actual.partialFilterExpression ?? null)
            !== JSON.stringify(options.partialFilterExpression ?? null)
          || (actual.expireAfterSeconds ?? null) !== (options.expireAfterSeconds ?? null)) {
          throw new Error(
            'MONGO_INDEX_NOT_READY:' + collections[name].collectionName + ':' + expected.name
          );
        }
      }
    }
  }

  private collectionMap(): Record<keyof typeof INDEX_COLLECTIONS, Collection<Document>> {
    return {
      passes: this.passes() as unknown as Collection<Document>,
      benefitRules: this.benefitRules() as unknown as Collection<Document>,
      usage: this.usage() as unknown as Collection<Document>,
      issuances: this.issuances() as unknown as Collection<Document>,
      returns: this.returns() as unknown as Collection<Document>,
      journal: this.journal() as unknown as Collection<Document>
    };
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('Resident services MongoDB is not connected');
    return this.db;
  }

  private requireClient(): MongoClient {
    if (!this.client) throw new Error('Resident services MongoDB is not connected');
    return this.client;
  }

  private passes(): Collection<StoredResidentPass> {
    return this.requireDb().collection<StoredResidentPass>(this.passesCollectionName);
  }

  private benefitRules(): Collection<StoredResidentBenefitRule> {
    return this.requireDb().collection<StoredResidentBenefitRule>(
      this.benefitRulesCollectionName
    );
  }

  private usage(): Collection<StoredResidentServiceUsage> {
    return this.requireDb().collection<StoredResidentServiceUsage>(this.usageCollectionName);
  }

  private issuances(): Collection<StoredResidentIssuance> {
    return this.requireDb().collection<StoredResidentIssuance>(this.issuancesCollectionName);
  }

  private returns(): Collection<StoredResidentReturn> {
    return this.requireDb().collection<StoredResidentReturn>(this.returnsCollectionName);
  }

  private journal(): Collection<StoredResidentJournalEvent> {
    return this.requireDb().collection<StoredResidentJournalEvent>(this.journalCollectionName);
  }

  private subscriptionTypes(): Collection<StoredSubscriptionType> {
    return this.requireDb().collection<StoredSubscriptionType>(
      this.subscriptionsTypesCollectionName
    );
  }

  private subscriptionInstances(): Collection<StoredSubscriptionInstance> {
    return this.requireDb().collection<StoredSubscriptionInstance>(
      this.subscriptionsInstancesCollectionName
    );
  }

  private subscriptionPublications(): Collection<StoredSubscriptionPolicyPublication> {
    return this.requireDb().collection<StoredSubscriptionPolicyPublication>(
      this.subscriptionsPublicationsCollectionName
    );
  }

  private subscriptionMappings(): Collection<StoredSubscriptionProviderMapping> {
    return this.requireDb().collection<StoredSubscriptionProviderMapping>(
      this.subscriptionsMappingsCollectionName
    );
  }
}