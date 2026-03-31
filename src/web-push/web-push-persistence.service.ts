import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import { StoredWebPushSubscription } from './web-push.types';

@Injectable()
export class WebPushPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebPushPersistenceService.name);
  private readonly mongoUri =
    String(
      process.env.WEB_PUSH_MONGODB_URI ??
        process.env.SUPPORT_MONGODB_URI ??
        process.env.MONGODB_URI ??
        ''
    ).trim();
  private readonly mongoDb =
    String(
      process.env.WEB_PUSH_MONGODB_DB ??
        process.env.SUPPORT_MONGODB_DB ??
        process.env.MONGODB_DB ??
        DEFAULT_DIALOGS_MONGODB_DB
    ).trim() || DEFAULT_DIALOGS_MONGODB_DB;
  private readonly collectionName =
    String(process.env.WEB_PUSH_SUBSCRIPTIONS_COLLECTION ?? '').trim() ||
    'web_push_subscriptions';
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async onModuleInit(): Promise<void> {
    if (!this.mongoUri) {
      this.logger.log(
        'No Mongo URI configured for web push persistence. Subscriptions run in-memory mode.'
      );
      return;
    }

    try {
      const client = new MongoClient(this.mongoUri, {
        maxPoolSize: 10,
        minPoolSize: 0,
        connectTimeoutMS: 10_000,
        serverSelectionTimeoutMS: 10_000,
        retryWrites: true
      });
      await client.connect();
      this.client = client;
      this.db = client.db(this.mongoDb);
      await this.ensureIndexes();
      this.logger.log(`Web push persistence enabled (${this.mongoDb}.${this.collectionName})`);
    } catch (error) {
      this.client = null;
      this.db = null;
      this.logger.error('Failed to initialize web push persistence', error as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.close();
    this.client = null;
    this.db = null;
  }

  isEnabled(): boolean {
    return this.db !== null;
  }

  async loadSubscriptions(): Promise<StoredWebPushSubscription[]> {
    if (!this.db) {
      return [];
    }

    const items = await this.collection()
      .find({}, { projection: { _id: 0 } })
      .toArray();

    return items as StoredWebPushSubscription[];
  }

  persistSubscription(subscription: StoredWebPushSubscription): void {
    this.runWrite(
      async () => {
        await this.collection().updateOne(
          {
            clientId: subscription.clientId,
            endpointHash: subscription.endpointHash
          },
          { $set: subscription },
          { upsert: true }
        );
      },
      'persistSubscription'
    );
  }

  removeSubscription(clientId: string, endpointHash: string): void {
    this.runWrite(
      async () => {
        await this.collection().deleteOne({ clientId, endpointHash });
      },
      'removeSubscription'
    );
  }

  touchSubscription(clientId: string, endpointHash: string, updatedAt: string): void {
    this.runWrite(
      async () => {
        await this.collection().updateOne(
          { clientId, endpointHash },
          { $set: { updatedAt, lastNotifiedAt: updatedAt } }
        );
      },
      'touchSubscription'
    );
  }

  private collection(): Collection<StoredWebPushSubscription> {
    if (!this.db) {
      throw new Error('Web push persistence is disabled');
    }
    return this.db.collection<StoredWebPushSubscription>(this.collectionName);
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection().createIndex({ clientId: 1, endpointHash: 1 }, { unique: true }),
      this.collection().createIndex({ updatedAt: -1 })
    ]);
  }

  private runWrite(task: () => Promise<void>, operation: string): void {
    if (!this.db) {
      return;
    }

    void task().catch((error: unknown) => {
      this.logger.error(`Failed to ${operation}`, error as Error);
    });
  }
}
