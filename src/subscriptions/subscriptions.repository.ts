import { Injectable } from '@nestjs/common';
import { Collection, Db, Filter, MongoClient, MongoServerError } from 'mongodb';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionType
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
  }
}
