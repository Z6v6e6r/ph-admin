import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException
} from '@nestjs/common';
import { Collection, Db, Document, MongoClient, MongoServerError } from 'mongodb';
import { ensureMongoIndex, isMongoIndexReadinessError } from '../common/mongo-index.guard';
import { QrDailyStat, QrLinkListItem, QrListQuery, StoredQrLink } from './qr-links.types';

export const QR_LINK_REQUIRED_INDEXES = {
  links: [
    { name: 'qr_link_id_unique', key: { id: 1 }, unique: true },
    { name: 'qr_link_code_unique', key: { code: 1 }, unique: true },
    {
      name: 'qr_link_idempotency_unique',
      key: { 'idempotency.actorId': 1, 'idempotency.key': 1 },
      unique: true,
      sparse: true
    },
    { name: 'qr_link_status_created', key: { status: 1, createdAt: -1 }, unique: false },
    {
      name: 'qr_link_station_status_created',
      key: { stationId: 1, status: 1, createdAt: -1 },
      unique: false
    },
    { name: 'qr_link_updated_at', key: { updatedAt: -1 }, unique: false }
  ],
  dailyStats: [
    { name: 'qr_daily_unique', key: { qrId: 1, dateKey: 1 }, unique: true },
    { name: 'qr_daily_date', key: { dateKey: 1 }, unique: false }
  ]
} as const;

export interface QrLinkListPage {
  items: QrLinkListItem[];
  totalQr: number;
  activeQr: number;
  redirectsPeriod: number;
}

export interface QrStatsSnapshot {
  redirectsTotal: number;
  redirectsPeriod: number;
  lastRedirectAt: string | null;
  daily: Array<{ date: string; redirects: number }>;
}

interface QrStatsAggregateRow {
  total?: number;
  period?: number;
  last?: string | null;
}

@Injectable()
export class QrLinksRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QrLinksRepository.name);
  private readonly enabled = this.readBoolean(process.env.QR_LINKS_ENABLED, false);
  private readonly mongoUri = String(
    process.env.QR_LINKS_MONGODB_URI ?? process.env.MONGODB_URI ?? ''
  ).trim();
  private readonly dbName = String(
    process.env.QR_LINKS_MONGODB_DB ?? process.env.MONGODB_DB ?? ''
  ).trim();
  private readonly linksCollectionName = String(
    process.env.QR_LINKS_COLLECTION ?? 'cup_qr_links'
  ).trim();
  private readonly dailyStatsCollectionName = String(
    process.env.QR_LINKS_DAILY_STATS_COLLECTION ?? 'cup_qr_daily_stats'
  ).trim();
  private client?: MongoClient;
  private db?: Db;
  private unavailableReason = this.enabled
    ? 'MongoDB connection is not initialized'
    : 'Feature is disabled';

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('QR links are disabled by QR_LINKS_ENABLED.');
      return;
    }
    if (!this.mongoUri || !this.dbName) {
      this.unavailableReason = 'QR_LINKS_MONGODB_URI and QR_LINKS_MONGODB_DB are required';
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
      await this.ensureIndexes();
      this.unavailableReason = '';
      this.logger.log(`QR links persistence enabled. db=${this.dbName}`);
    } catch (error) {
      this.unavailableReason = 'QR links persistence initialization failed';
      this.logger.error(`QR links persistence unavailable: ${String(error)}`);
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

  isFeatureEnabled(): boolean {
    return this.enabled;
  }

  isAvailable(): boolean {
    return Boolean(this.db);
  }

  requireAvailable(): void {
    if (!this.db) {
      throw new ServiceUnavailableException({
        code: 'QR_LINKS_PERSISTENCE_UNAVAILABLE',
        message: this.unavailableReason || 'QR links persistence is unavailable'
      });
    }
  }

  isDuplicateKey(error: unknown): boolean {
    return error instanceof MongoServerError && error.code === 11000;
  }

  duplicateKeyFields(error: unknown): string[] {
    if (!(error instanceof MongoServerError)) return [];
    const keyPattern = (error as MongoServerError & { keyPattern?: Record<string, unknown> })
      .keyPattern;
    return keyPattern ? Object.keys(keyPattern) : [];
  }

  async findById(id: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    return this.links().findOne({ id }, { projection: { _id: 0 } });
  }

  async findByCode(code: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    return this.links().findOne({ code }, { projection: { _id: 0 } });
  }

  async findByIdempotency(actorId: string, key: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    return this.links().findOne(
      { 'idempotency.actorId': actorId, 'idempotency.key': key },
      { projection: { _id: 0 } }
    );
  }

  async insertLink(link: StoredQrLink): Promise<void> {
    this.requireAvailable();
    await this.links().insertOne(link);
  }

  async updateLink(
    id: string,
    expectedVersion: number,
    set: Partial<StoredQrLink>,
    updatedAt: string
  ): Promise<StoredQrLink | null> {
    this.requireAvailable();
    return this.links().findOneAndUpdate(
      { id, version: expectedVersion },
      { $set: { ...set, updatedAt }, $inc: { version: 1 } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
  }

  /**
   * Atomic daily aggregate increment. Concurrent requests never lose increments:
   * a single document per (qrId, dateKey) is updated with $inc/$max.
   */
  async incrementDailyRedirect(qrId: string, dateKey: string, occurredAt: string): Promise<void> {
    this.requireAvailable();
    const update = {
      $inc: { redirectsCount: 1 },
      $max: { lastRedirectAt: occurredAt },
      $set: { updatedAt: occurredAt }
    };
    try {
      await this.dailyStats().updateOne({ qrId, dateKey }, update, { upsert: true });
    } catch (error) {
      // Two concurrent upserts for the same (qrId, dateKey) can race on the unique
      // index. The losing request retries as a plain update and still increments.
      if (!this.isDuplicateKey(error)) throw error;
      await this.dailyStats().updateOne({ qrId, dateKey }, update);
    }
  }

  async listLinks(query: QrListQuery): Promise<QrLinkListPage> {
    this.requireAvailable();
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const filter = this.buildLinkFilter(query);
    if (!filter) {
      return { items: [], totalQr: 0, activeQr: 0, redirectsPeriod: 0 };
    }
    const { fromKey, toKey } = this.periodKeys(query);
    const direction = query.direction === 'asc' ? 1 : -1;
    const sort = this.sortStage(query.sort ?? 'createdAt', direction);
    const result = await this.links()
      .aggregate<{
        items: QrLinkListItem[];
        metrics: Array<{ totalQr: number; activeQr: number; redirectsPeriod: number }>;
      }>([
        { $match: filter },
        {
          $lookup: {
            from: this.dailyStatsCollectionName,
            let: { qrId: '$id', fromKey, toKey },
            pipeline: [
              { $match: { $expr: { $eq: ['$qrId', '$$qrId'] } } },
              {
                $group: {
                  _id: null,
                  total: { $sum: '$redirectsCount' },
                  last: { $max: '$lastRedirectAt' },
                  period: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ['$dateKey', '$$fromKey'] },
                            { $lte: ['$dateKey', '$$toKey'] }
                          ]
                        },
                        '$redirectsCount',
                        0
                      ]
                    }
                  }
                }
              }
            ],
            as: 'stats'
          }
        },
        {
          $addFields: {
            redirectsTotal: { $ifNull: [{ $arrayElemAt: ['$stats.total', 0] }, 0] },
            redirectsPeriod: { $ifNull: [{ $arrayElemAt: ['$stats.period', 0] }, 0] },
            lastRedirectAt: { $ifNull: [{ $arrayElemAt: ['$stats.last', 0] }, null] }
          }
        },
        { $project: { _id: 0, idempotency: 0, stats: 0 } },
        {
          $facet: {
            items: [{ $sort: sort }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
            metrics: [
              {
                $group: {
                  _id: null,
                  totalQr: { $sum: 1 },
                  activeQr: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
                  redirectsPeriod: { $sum: '$redirectsPeriod' }
                }
              }
            ]
          }
        }
      ])
      .next();
    const metrics = result?.metrics?.[0];
    return {
      items: (result?.items ?? []) as unknown as QrLinkListItem[],
      totalQr: Number(metrics?.totalQr ?? 0),
      activeQr: Number(metrics?.activeQr ?? 0),
      redirectsPeriod: Number(metrics?.redirectsPeriod ?? 0)
    };
  }

  async getStats(qrId: string, fromKey: string, toKey: string): Promise<QrStatsSnapshot> {
    this.requireAvailable();
    const aggregate = await this.dailyStats()
      .aggregate<QrStatsAggregateRow>([
        { $match: { qrId } },
        {
          $group: {
            _id: null,
            total: { $sum: '$redirectsCount' },
            last: { $max: '$lastRedirectAt' },
            period: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$dateKey', fromKey] },
                      { $lte: ['$dateKey', toKey] }
                    ]
                  },
                  '$redirectsCount',
                  0
                ]
              }
            }
          }
        }
      ])
      .next();
    const dailyRows = await this.dailyStats()
      .find(
        { qrId, dateKey: { $gte: fromKey, $lte: toKey } },
        { projection: { _id: 0, qrId: 0 } }
      )
      .sort({ dateKey: 1 })
      .toArray();
    return {
      redirectsTotal: Number(aggregate?.total ?? 0),
      redirectsPeriod: Number(aggregate?.period ?? 0),
      lastRedirectAt: aggregate?.last ?? null,
      daily: (dailyRows as QrDailyStat[]).map((row) => ({
        date: row.dateKey,
        redirects: Number(row.redirectsCount)
      }))
    };
  }

  private buildLinkFilter(query: QrListQuery): Document | null {
    const filter: Document = {};
    if (query.status && query.status !== 'ALL') {
      filter.status = query.status;
    } else if (!query.status) {
      filter.status = { $in: ['ACTIVE', 'PAUSED'] };
    }
    if (query.stationId) {
      if (query.stationScope !== null && !query.stationScope.includes(query.stationId)) {
        return null;
      }
      filter.stationId = query.stationId;
    } else if (query.stationScope !== null) {
      filter.stationId = { $in: query.stationScope };
    }
    const search = String(query.q ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [{ name: regex }, { code: regex }, { placement: regex }];
    }
    return filter;
  }

  private periodKeys(query: QrListQuery): { fromKey: string; toKey: string } {
    return {
      fromKey: String(query.from ?? ''),
      toKey: String(query.to ?? '')
    };
  }

  private sortStage(field: string, direction: 1 | -1): Document {
    const allowed = new Set([
      'createdAt',
      'name',
      'redirectsPeriod',
      'redirectsTotal',
      'lastRedirectAt'
    ]);
    const selected = allowed.has(field) ? field : 'createdAt';
    return { [selected]: direction, id: 1 };
  }

  private async ensureIndexes(): Promise<void> {
    for (const index of QR_LINK_REQUIRED_INDEXES.links) {
      await ensureMongoIndex(this.links(), index.key, {
        name: index.name,
        unique: index.unique,
        ...(Object.prototype.hasOwnProperty.call(index, 'sparse') ? { sparse: true } : {})
      });
    }
    for (const index of QR_LINK_REQUIRED_INDEXES.dailyStats) {
      await ensureMongoIndex(this.dailyStats(), index.key, {
        name: index.name,
        unique: index.unique
      });
    }
  }

  private links(): Collection<StoredQrLink> {
    return this.requireDb().collection<StoredQrLink>(this.linksCollectionName);
  }

  private dailyStats(): Collection<QrDailyStat> {
    return this.requireDb().collection<QrDailyStat>(this.dailyStatsCollectionName);
  }

  private requireDb(): Db {
    this.requireAvailable();
    return this.db as Db;
  }

  private readBoolean(value: unknown, fallback: boolean): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
}
