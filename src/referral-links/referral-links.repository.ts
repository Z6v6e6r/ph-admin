import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Collection, Db, Document, Filter, MongoClient, MongoServerError } from 'mongodb';
import {
  ensureMongoIndex,
  isMongoIndexReadinessError,
  isProductionRuntime
} from '../common/mongo-index.guard';
import {
  ReferralOpenEvent,
  ReferralSaleSnapshot,
  StoredReferralLink
} from './referral-links.types';

export const REFERRAL_LINK_REQUIRED_INDEXES = {
  links: [
    { name: 'referral_link_id_unique', key: { linkId: 1 }, unique: true },
    { name: 'referral_link_public_token_unique', key: { publicToken: 1 }, unique: true },
    { name: 'referral_link_legacy_key_unique', key: { legacyAttributionKey: 1 }, unique: true, sparse: true },
    { name: 'referral_link_idempotency_unique', key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true, sparse: true },
    { name: 'referral_link_status_period', key: { status: 1, validFrom: 1, validTo: 1 }, unique: false }
  ],
  events: [
    { name: 'referral_link_event_id_unique', key: { eventId: 1 }, unique: true },
    { name: 'referral_link_event_time', key: { linkId: 1, occurredAt: 1 }, unique: false },
    { name: 'referral_link_event_visit_kind', key: { linkId: 1, visitId: 1, kind: 1 }, unique: false },
    { name: 'referral_link_event_daily', key: { linkId: 1, dayKey: 1, kind: 1 }, unique: false }
  ],
  sales: [
    { name: 'referral_sale_link_created', key: { referralLinkId: 1, createdAt: 1 }, unique: false },
    { name: 'referral_sale_link_paid', key: { referralLinkId: 1, paidAt: 1 }, unique: false },
    { name: 'referral_sale_token_created', key: { referralToken: 1, createdAt: 1 }, unique: false },
    { name: 'referral_sale_token_paid', key: { referralToken: 1, paidAt: 1 }, unique: false },
    { name: 'referral_sale_legacy_created', key: { trainerQrCode: 1, createdAt: 1 }, unique: false },
    { name: 'referral_sale_legacy_paid', key: { trainerQrCode: 1, paidAt: 1 }, unique: false }
  ]
} as const;

@Injectable()
export class ReferralLinksRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralLinksRepository.name);
  private readonly enabled = this.readBoolean(process.env.REFERRAL_LINKS_ENABLED, false);
  private readonly mongoUri = String(
    process.env.REFERRAL_LINKS_MONGODB_URI
      ?? process.env.SUBSCRIPTIONS_MONGODB_URI
      ?? process.env.MONGODB_URI
      ?? ''
  ).trim();
  private readonly dbName = String(
    process.env.REFERRAL_LINKS_MONGODB_DB
      ?? process.env.SUBSCRIPTIONS_MONGODB_DB
      ?? process.env.MONGODB_DB
      ?? ''
  ).trim();
  private readonly linksCollectionName = String(
    process.env.REFERRAL_LINKS_COLLECTION ?? 'subscription_referral_links'
  ).trim();
  private readonly eventsCollectionName = String(
    process.env.REFERRAL_LINK_EVENTS_COLLECTION ?? 'subscription_referral_link_events'
  ).trim();
  private readonly salesCollectionName = String(
    process.env.REFERRAL_LINK_SALES_COLLECTION ?? 'lk_tournament_subscription_sales'
  ).trim();
  private readonly legacyEventsCollectionName = String(
    process.env.REFERRAL_LINK_LEGACY_EVENTS_COLLECTION ?? 'events'
  ).trim();
  private client?: MongoClient;
  private db?: Db;
  private unavailableReason = this.enabled ? 'MongoDB connection is not initialized' : 'Feature is disabled';

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Referral links are disabled by REFERRAL_LINKS_ENABLED.');
      return;
    }
    if (!this.mongoUri || !this.dbName) {
      this.unavailableReason = 'REFERRAL_LINKS_MONGODB_URI and REFERRAL_LINKS_MONGODB_DB are required';
      this.logger.error(this.unavailableReason);
      return;
    }
    const client = new MongoClient(this.mongoUri, {
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 10
    });
    try {
      await client.connect();
      this.client = client;
      this.db = client.db(this.dbName);
      const autoCreate = this.readBoolean(
        process.env.REFERRAL_LINKS_AUTO_CREATE_INDEXES,
        !isProductionRuntime()
      );
      if (autoCreate) await this.ensureIndexes();
      else await this.verifyIndexes();
      this.unavailableReason = '';
      this.logger.log(`Referral links persistence enabled. db=${this.dbName}`);
    } catch (error) {
      this.unavailableReason = 'Referral links persistence initialization failed';
      this.logger.error(`Referral links persistence unavailable: ${String(error)}`);
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

  isAvailable(): boolean {
    return Boolean(this.db);
  }

  requireAvailable(): void {
    if (!this.db) {
      throw new ServiceUnavailableException({
        code: 'REFERRAL_LINKS_PERSISTENCE_UNAVAILABLE',
        message: this.unavailableReason || 'Referral links persistence is unavailable'
      });
    }
  }

  isDuplicateKey(error: unknown): boolean {
    return error instanceof MongoServerError && error.code === 11000;
  }

  async listLinks(): Promise<StoredReferralLink[]> {
    this.requireAvailable();
    return this.links().find({}, { projection: { _id: 0 } }).sort({ createdAt: -1, linkId: 1 }).limit(500).toArray();
  }

  async findLinkById(linkId: string): Promise<StoredReferralLink | null> {
    this.requireAvailable();
    return this.links().findOne({ linkId }, { projection: { _id: 0 } });
  }

  async findLinkByToken(publicToken: string): Promise<StoredReferralLink | null> {
    this.requireAvailable();
    return this.links().findOne({ publicToken }, { projection: { _id: 0 } });
  }

  async findLinkByIdempotency(actorId: string, key: string): Promise<StoredReferralLink | null> {
    this.requireAvailable();
    return this.links().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async insertLink(link: StoredReferralLink): Promise<void> {
    this.requireAvailable();
    await this.links().insertOne(link);
  }

  async updateLink(
    linkId: string,
    expectedRevision: number,
    set: Partial<StoredReferralLink>,
    unset: Array<'recipientExternalRef' | 'legacyAttributionKey'> = []
  ): Promise<StoredReferralLink | null> {
    this.requireAvailable();
    return this.links().findOneAndUpdate(
      { linkId, revision: expectedRevision },
      {
        $set: set,
        $inc: { revision: 1 },
        ...(unset.length > 0 ? { $unset: Object.fromEntries(unset.map((field) => [field, ''])) } : {})
      },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  async recordOpen(event: ReferralOpenEvent): Promise<boolean> {
    this.requireAvailable();
    try {
      await this.events().insertOne(event);
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw error;
    }
  }

  async listOpenEvents(link: StoredReferralLink, from: string, to: string): Promise<ReferralOpenEvent[]> {
    this.requireAvailable();
    const current = await this.events()
      .find(
        { linkId: link.linkId, occurredAt: { $gte: from, $lte: to } },
        { projection: { _id: 0 } }
      )
      .sort({ occurredAt: 1 })
      .limit(100_000)
      .toArray() as ReferralOpenEvent[];
    if (!link.legacyAttributionKey) return current;
    const legacyRows = await this.legacyEvents()
      .find(
        {
          event: 'subscription_page_opened',
          'payload.storefront': 'ab_leto',
          'payload.trainerQrCode': link.legacyAttributionKey,
          timestamp: { $gte: from, $lte: to }
        },
        { projection: { _id: 0, timestamp: 1, sessionId: 1 } }
      )
      .sort({ timestamp: 1 })
      .limit(100_000)
      .toArray();
    return current.concat(legacyRows.map((row) => ({
      eventId: `legacy:${link.linkId}:${String(row.sessionId ?? '')}:${String(row.timestamp ?? '')}`,
      linkId: link.linkId,
      publicToken: link.publicToken,
      visitId: String(row.sessionId ?? '').trim() || `legacy-anonymous:${String(row.timestamp ?? '')}`,
      kind: 'OPEN' as const,
      occurredAt: this.toIso(row.timestamp),
      receivedAt: this.toIso(row.timestamp),
      dayKey: ''
    })));
  }

  async listSales(link: StoredReferralLink, from: string, to: string): Promise<ReferralSaleSnapshot[]> {
    this.requireAvailable();
    const attribution: Filter<Record<string, unknown>>[] = [
      { referralLinkId: link.linkId },
      { referralToken: link.publicToken }
    ];
    if (link.legacyAttributionKey) attribution.push({ trainerQrCode: link.legacyAttributionKey });
    const timeFilter = {
      $or: [
        { createdAt: { $gte: from, $lte: to } },
        { paidAt: { $gte: from, $lte: to } }
      ]
    };
    const rows = await this.sales()
      .find(
        { $and: [{ $or: attribution }, timeFilter] },
        {
          projection: {
            _id: 0,
            paymentRef: 1,
            transactionId: 1,
            referralVisitId: 1,
            trainerQrCode: 1,
            clientPhone: 1,
            clientId: 1,
            clientName: 1,
            productId: 1,
            productName: 1,
            planKey: 1,
            campaignKey: 1,
            amountMinor: 1,
            toPayMinor: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            paidAt: 1
          }
        }
      )
      .sort({ createdAt: 1 })
      .limit(100_000)
      .toArray();
    return rows.map((row) => ({
      paymentRef: String(row.paymentRef ?? '').trim(),
      transactionId: this.optionalString(row.transactionId),
      visitId: this.optionalString(row.referralVisitId),
      trainerQrCode: this.optionalString(row.trainerQrCode),
      clientPhone: this.optionalString(row.clientPhone),
      clientId: this.optionalString(row.clientId),
      clientName: this.optionalString(row.clientName),
      productId: this.optionalString(row.productId),
      productName: this.optionalString(row.productName),
      planKey: this.optionalString(row.planKey),
      campaignKey: this.optionalString(row.campaignKey),
      amountMinor: this.optionalNumber(row.amountMinor),
      toPayMinor: this.optionalNumber(row.toPayMinor),
      status: String(row.status ?? '').trim().toUpperCase() || 'UNKNOWN',
      createdAt: this.optionalIso(row.createdAt),
      updatedAt: this.optionalIso(row.updatedAt),
      paidAt: this.optionalIso(row.paidAt)
    })).filter((row) => Boolean(row.paymentRef));
  }

  private async ensureIndexes(): Promise<void> {
    for (const index of REFERRAL_LINK_REQUIRED_INDEXES.links) {
      await ensureMongoIndex(this.links(), index.key, {
        name: index.name,
        unique: index.unique,
        ...(Object.prototype.hasOwnProperty.call(index, 'sparse') ? { sparse: true } : {})
      });
    }
    for (const index of REFERRAL_LINK_REQUIRED_INDEXES.events) {
      await ensureMongoIndex(this.events(), index.key, { name: index.name, unique: index.unique });
    }
    for (const index of REFERRAL_LINK_REQUIRED_INDEXES.sales) {
      await ensureMongoIndex(this.sales(), index.key, { name: index.name, unique: index.unique });
    }
  }

  private async verifyIndexes(): Promise<void> {
    await this.verifyCollectionIndexes(this.links(), REFERRAL_LINK_REQUIRED_INDEXES.links);
    await this.verifyCollectionIndexes(this.events(), REFERRAL_LINK_REQUIRED_INDEXES.events);
    await this.verifyCollectionIndexes(this.sales(), REFERRAL_LINK_REQUIRED_INDEXES.sales);
  }

  private async verifyCollectionIndexes<TSchema extends Document>(
    collection: Collection<TSchema>,
    expected: readonly { name: string; key: object; unique: boolean; sparse?: boolean }[]
  ): Promise<void> {
    let existing: Document[];
    try {
      existing = await collection.indexes();
    } catch (error) {
      if (!isProductionRuntime()) throw error;
      const cause = error instanceof Error ? error.name : 'UnknownError';
      throw new Error(
        `MONGO_INDEX_READINESS_CHECK_FAILED:${collection.collectionName}:required_manifest:${cause}`
      );
    }
    for (const target of expected) {
      const actual = existing.find((item) => item.name === target.name);
      if (
        !actual
        || JSON.stringify(actual.key) !== JSON.stringify(target.key)
        || Boolean(actual.unique) !== target.unique
        || Boolean(actual.sparse) !== Boolean(target.sparse)
      ) {
        if (isProductionRuntime()) {
          throw new Error(
            `MONGO_INDEX_NOT_READY:${collection.collectionName}:${target.name}`
          );
        }
        throw new Error(`Referral links index mismatch: ${target.name}`);
      }
    }
  }

  private links(): Collection<StoredReferralLink> {
    return this.requireDb().collection<StoredReferralLink>(this.linksCollectionName);
  }

  private events(): Collection<ReferralOpenEvent> {
    return this.requireDb().collection<ReferralOpenEvent>(this.eventsCollectionName);
  }

  private sales(): Collection<Record<string, unknown>> {
    return this.requireDb().collection<Record<string, unknown>>(this.salesCollectionName);
  }

  private legacyEvents(): Collection<Record<string, unknown>> {
    return this.requireDb().collection<Record<string, unknown>>(this.legacyEventsCollectionName);
  }

  private requireDb(): Db {
    this.requireAvailable();
    return this.db as Db;
  }

  private optionalString(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  private optionalIso(value: unknown): string | undefined {
    const timestamp = Date.parse(String(value ?? ''));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  }

  private toIso(value: unknown): string {
    return this.optionalIso(value) ?? new Date(0).toISOString();
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
}
