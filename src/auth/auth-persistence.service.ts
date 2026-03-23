import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import { AdminUserRecord } from './auth.types';

@Injectable()
export class AuthPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthPersistenceService.name);
  private client?: MongoClient;
  private db?: Db;
  private collectionName =
    String(process.env.ADMIN_AUTH_MONGODB_COLLECTION ?? '').trim() || 'admin_users';

  async onModuleInit(): Promise<void> {
    const uri = String(process.env.MONGODB_URI ?? '').trim();
    if (!uri) {
      this.logger.log('MONGODB_URI is empty. Auth persistence disabled (env/in-memory mode).');
      return;
    }

    const dbName =
      String(
        process.env.ADMIN_AUTH_MONGODB_DB ??
          process.env.MONGODB_DB ??
          DEFAULT_DIALOGS_MONGODB_DB
      ).trim() || DEFAULT_DIALOGS_MONGODB_DB;

    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });

    try {
      await this.client.connect();
      this.db = this.client.db(dbName);
      await this.ensureIndexes();
      this.logger.log(
        `MongoDB auth persistence enabled. db=${dbName}, collection=${this.collectionName}`
      );
    } catch (error) {
      this.logger.error(`MongoDB connect failed: ${String(error)}`);
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

  async loadUsers(): Promise<AdminUserRecord[]> {
    if (!this.db) {
      return [];
    }

    const users = await this.users().find({}, { projection: { _id: 0 } }).toArray();
    return users as AdminUserRecord[];
  }

  async seedUsers(users: AdminUserRecord[]): Promise<void> {
    if (!this.db || users.length === 0) {
      return;
    }

    await this.users().bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: { id: user.id },
          update: { $set: user },
          upsert: true
        }
      }))
    );
  }

  private users(): Collection<AdminUserRecord> {
    return this.requireDb().collection<AdminUserRecord>(this.collectionName);
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB auth persistence is not enabled');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.users().createIndex({ id: 1 }, { unique: true }),
      this.users().createIndex({ login: 1 }, { unique: true })
    ]);
  }

  private async safeCloseClient(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.close();
    } catch (_error) {
      // ignore
    } finally {
      this.client = undefined;
      this.db = undefined;
    }
  }
}
