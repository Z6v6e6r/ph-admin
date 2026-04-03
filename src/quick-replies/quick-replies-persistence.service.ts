import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import {
  QuickReplyRule,
  QuickReplyUsageLog
} from './quick-replies.types';

export interface QuickRepliesPersistedState {
  rules: QuickReplyRule[];
  usageLogs: QuickReplyUsageLog[];
}

@Injectable()
export class QuickRepliesPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuickRepliesPersistenceService.name);
  private client?: MongoClient;
  private db?: Db;

  async onModuleInit(): Promise<void> {
    const uri = String(process.env.MONGODB_URI ?? '').trim();
    if (!uri) {
      this.logger.log('MONGODB_URI is empty. Quick replies persistence disabled (in-memory mode).');
      return;
    }

    const dbName =
      String(process.env.MONGODB_DB ?? DEFAULT_DIALOGS_MONGODB_DB).trim() ||
      DEFAULT_DIALOGS_MONGODB_DB;
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20
    });

    try {
      await this.client.connect();
      this.db = this.client.db(dbName);
      await this.ensureIndexes();
      this.logger.log(`MongoDB quick replies persistence enabled. db=${dbName}`);
    } catch (error) {
      this.logger.error(`MongoDB quick replies connect failed: ${String(error)}`);
      this.db = undefined;
      await this.safeCloseClient();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.safeCloseClient();
  }

  isEnabled(): boolean {
    return Boolean(this.db);
  }

  async loadState(): Promise<QuickRepliesPersistedState> {
    if (!this.db) {
      return {
        rules: [],
        usageLogs: []
      };
    }

    const [rules, usageLogs] = await Promise.all([
      this.rules().find({}, { projection: { _id: 0 } }).toArray(),
      this.usageLogs().find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()
    ]);

    return {
      rules: rules as QuickReplyRule[],
      usageLogs: usageLogs as QuickReplyUsageLog[]
    };
  }

  persistRule(rule: QuickReplyRule): void {
    this.fireAndForget(
      async () => {
        await this.rules().updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
      },
      'persistRule'
    );
  }

  persistUsageLog(usageLog: QuickReplyUsageLog): void {
    this.fireAndForget(
      async () => {
        await this.usageLogs().updateOne(
          { id: usageLog.id },
          { $set: usageLog },
          { upsert: true }
        );
      },
      'persistUsageLog'
    );
  }

  private rules(): Collection<QuickReplyRule> {
    return this.requireDb().collection<QuickReplyRule>('messenger_quick_reply_rules');
  }

  private usageLogs(): Collection<QuickReplyUsageLog> {
    return this.requireDb().collection<QuickReplyUsageLog>('messenger_quick_reply_usage_logs');
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB is not initialized');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.rules().createIndex({ id: 1 }, { unique: true }),
      this.rules().createIndex({ isActive: 1, triggerType: 1, mode: 1, updatedAt: -1 }),
      this.usageLogs().createIndex({ id: 1 }, { unique: true }),
      this.usageLogs().createIndex({ ruleId: 1, createdAt: -1 })
    ]);
  }

  private fireAndForget(task: () => Promise<void>, context: string): void {
    if (!this.db) {
      return;
    }

    task().catch((error) => {
      this.logger.error(`${context} failed: ${String(error)}`);
    });
  }

  private async safeCloseClient(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } catch (_error) {
      // ignore close errors
    }

    this.client = undefined;
    this.db = undefined;
  }
}
