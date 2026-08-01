import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import { AdminAuditEntry, AdminRoleDefinition, AdminUserRecord } from './auth.types';

@Injectable()
export class AuthPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthPersistenceService.name);
  private client?: MongoClient;
  private db?: Db;
  private collectionName =
    String(process.env.ADMIN_AUTH_MONGODB_COLLECTION ?? '').trim() || 'admin_users';
  private rolesCollectionName =
    String(process.env.ADMIN_AUTH_ROLES_MONGODB_COLLECTION ?? '').trim() || 'admin_roles';
  private auditCollectionName =
    String(process.env.ADMIN_AUTH_AUDIT_MONGODB_COLLECTION ?? '').trim() || 'admin_audit_log';

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

  async findUserById(id: string): Promise<AdminUserRecord | null> {
    if (!this.db) {
      return null;
    }
    return this.users().findOne({ id }, { projection: { _id: 0 } });
  }

  async upsertUser(user: AdminUserRecord): Promise<void> {
    await this.users().updateOne({ id: user.id }, { $set: user }, { upsert: true });
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.users().deleteOne({ id });
    return result.deletedCount === 1;
  }

  async loadRoles(): Promise<AdminRoleDefinition[]> {
    if (!this.db) {
      return [];
    }
    return this.roles().find({}, { projection: { _id: 0 } }).toArray();
  }

  async seedRoles(roles: AdminRoleDefinition[]): Promise<void> {
    if (!this.db || roles.length === 0) {
      return;
    }
    await this.roles().bulkWrite(
      roles.map((role) => ({
        updateOne: {
          filter: { id: role.id },
          update: { $setOnInsert: role },
          upsert: true
        }
      }))
    );
  }

  async upsertRole(role: AdminRoleDefinition): Promise<void> {
    await this.roles().updateOne({ id: role.id }, { $set: role }, { upsert: true });
  }

  async deleteRole(id: string): Promise<boolean> {
    const result = await this.roles().deleteOne({ id });
    return result.deletedCount === 1;
  }

  async appendAudit(entry: AdminAuditEntry): Promise<void> {
    if (!this.db) {
      return;
    }
    await this.audit().insertOne(entry);
  }

  async listAudit(filters: {
    actorId?: string;
    targetId?: string;
    limit?: number;
  }): Promise<AdminAuditEntry[]> {
    if (!this.db) {
      return [];
    }
    const query: Record<string, unknown> = {};
    if (filters.actorId) {
      query['actor.id'] = filters.actorId;
    }
    if (filters.targetId) {
      query.targetId = filters.targetId;
    }
    const limit = Math.min(Math.max(Math.floor(filters.limit ?? 100), 1), 500);
    return this.audit()
      .find(query, { projection: { _id: 0 } })
      .sort({ at: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  private users(): Collection<AdminUserRecord> {
    return this.requireDb().collection<AdminUserRecord>(this.collectionName);
  }

  private roles(): Collection<AdminRoleDefinition> {
    return this.requireDb().collection<AdminRoleDefinition>(this.rolesCollectionName);
  }

  private audit(): Collection<AdminAuditEntry> {
    return this.requireDb().collection<AdminAuditEntry>(this.auditCollectionName);
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
      this.users().createIndex({ login: 1 }, { unique: true }),
      this.roles().createIndex({ id: 1 }, { unique: true }),
      this.audit().createIndex({ at: -1 }),
      this.audit().createIndex({ 'actor.id': 1, at: -1 }),
      this.audit().createIndex({ targetId: 1, at: -1 })
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
