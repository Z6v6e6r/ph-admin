import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import {
  SupportClientProfile,
  SupportDialog,
  SupportMessage,
  SupportOutboxCommand,
  SupportResponseMetric
} from './support.types';

export interface SupportPersistedState {
  clients: SupportClientProfile[];
  dialogs: SupportDialog[];
  messages: SupportMessage[];
  responseMetrics: SupportResponseMetric[];
  outbox: SupportOutboxCommand[];
}

export interface SupportPersistenceCollectionCounts {
  clients: number;
  dialogs: number;
  messages: number;
  responseMetrics: number;
  outbox: number;
}

export interface SupportPersistenceRuntimeDiagnostics {
  enabled: boolean;
  resolvedDbName: string;
  activeDbName?: string;
  collections: {
    clients: string;
    dialogs: string;
    messages: string;
    responseMetrics: string;
    outbox: string;
  };
  env: {
    supportMongoUriConfigured: boolean;
    mongoUriConfigured: boolean;
    supportMongoDb?: string;
    mongoDb?: string;
  };
  counts?: SupportPersistenceCollectionCounts;
  countError?: string;
}

@Injectable()
export class SupportPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportPersistenceService.name);
  private client?: MongoClient;
  private db?: Db;
  private readonly supportMongoUri = this.readEnv('SUPPORT_MONGODB_URI');
  private readonly fallbackMongoUri = this.readEnv('MONGODB_URI');
  private readonly resolvedMongoUri = this.supportMongoUri ?? this.fallbackMongoUri;
  private readonly supportMongoDb = this.readEnv('SUPPORT_MONGODB_DB');
  private readonly fallbackMongoDb = this.readEnv('MONGODB_DB');
  private readonly resolvedDbName =
    this.supportMongoDb ??
    this.fallbackMongoDb ??
    DEFAULT_DIALOGS_MONGODB_DB;
  private readonly clientsCollectionName =
    this.readEnv('SUPPORT_CLIENTS_COLLECTION') ?? 'support_clients';
  private readonly dialogsCollectionName =
    this.readEnv('SUPPORT_DIALOGS_COLLECTION') ?? 'support_dialogs';
  private readonly messagesCollectionName =
    this.readEnv('SUPPORT_MESSAGES_COLLECTION') ?? 'support_messages';
  private readonly responseMetricsCollectionName =
    this.readEnv('SUPPORT_RESPONSE_METRICS_COLLECTION') ?? 'support_response_metrics';
  private readonly outboxCollectionName =
    this.readEnv('SUPPORT_OUTBOX_COLLECTION') ?? 'support_outbox';

  async onModuleInit(): Promise<void> {
    const uri = this.resolvedMongoUri;
    if (!uri) {
      this.logger.log(
        'SUPPORT_MONGODB_URI/MONGODB_URI is empty. Support persistence disabled (in-memory mode).'
      );
      return;
    }

    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20
    });

    try {
      await this.client.connect();
      this.db = this.client.db(this.resolvedDbName);
      await this.ensureIndexes();
      this.logger.log(`MongoDB support persistence enabled. db=${this.resolvedDbName}`);
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

  async getRuntimeDiagnostics(): Promise<SupportPersistenceRuntimeDiagnostics> {
    const result: SupportPersistenceRuntimeDiagnostics = {
      enabled: this.isEnabled(),
      resolvedDbName: this.resolvedDbName,
      activeDbName: this.db?.databaseName,
      collections: {
        clients: this.clientsCollectionName,
        dialogs: this.dialogsCollectionName,
        messages: this.messagesCollectionName,
        responseMetrics: this.responseMetricsCollectionName,
        outbox: this.outboxCollectionName
      },
      env: {
        supportMongoUriConfigured: Boolean(this.supportMongoUri),
        mongoUriConfigured: Boolean(this.fallbackMongoUri),
        supportMongoDb: this.supportMongoDb,
        mongoDb: this.fallbackMongoDb
      }
    };
    if (!this.db) {
      return result;
    }

    try {
      const [clients, dialogs, messages, responseMetrics, outbox] = await Promise.all([
        this.clients().countDocuments({}),
        this.dialogs().countDocuments({}),
        this.messages().countDocuments({}),
        this.responseMetrics().countDocuments({}),
        this.outbox().countDocuments({})
      ]);
      result.counts = {
        clients,
        dialogs,
        messages,
        responseMetrics,
        outbox
      };
    } catch (error) {
      result.countError = String(error);
    }

    return result;
  }

  async loadState(): Promise<SupportPersistedState> {
    if (!this.db) {
      return {
        clients: [],
        dialogs: [],
        messages: [],
        responseMetrics: [],
        outbox: []
      };
    }

    const [clients, dialogs, messages, responseMetrics, outbox] = await Promise.all([
      this.clients().find({}, { projection: { _id: 0 } }).toArray(),
      this.dialogs().find({}, { projection: { _id: 0 } }).toArray(),
      this.messages().find({}, { projection: { _id: 0 } }).toArray(),
      this.responseMetrics().find({}, { projection: { _id: 0 } }).toArray(),
      this.outbox().find({}, { projection: { _id: 0 } }).toArray()
    ]);

    return {
      clients: clients as SupportClientProfile[],
      dialogs: dialogs as SupportDialog[],
      messages: messages as SupportMessage[],
      responseMetrics: responseMetrics as SupportResponseMetric[],
      outbox: outbox as SupportOutboxCommand[]
    };
  }

  persistClient(client: SupportClientProfile): void {
    this.fireAndForget(
      async () => {
        await this.clients().updateOne({ id: client.id }, { $set: client }, { upsert: true });
      },
      'persistClient'
    );
  }

  deleteClient(id: string): void {
    this.fireAndForget(
      async () => {
        await this.clients().deleteOne({ id });
      },
      'deleteClient'
    );
  }

  persistDialog(dialog: SupportDialog): void {
    this.fireAndForget(
      async () => {
        await this.dialogs().updateOne({ id: dialog.id }, { $set: dialog }, { upsert: true });
      },
      'persistDialog'
    );
  }

  deleteDialog(id: string): void {
    this.fireAndForget(
      async () => {
        await this.dialogs().deleteOne({ id });
      },
      'deleteDialog'
    );
  }

  persistMessage(message: SupportMessage): void {
    this.fireAndForget(
      async () => {
        await this.messages().updateOne({ id: message.id }, { $set: message }, { upsert: true });
      },
      'persistMessage'
    );
  }

  persistResponseMetric(metric: SupportResponseMetric): void {
    this.fireAndForget(
      async () => {
        await this.responseMetrics().updateOne({ id: metric.id }, { $set: metric }, { upsert: true });
      },
      'persistResponseMetric'
    );
  }

  persistOutboxCommand(command: SupportOutboxCommand): void {
    this.fireAndForget(
      async () => {
        await this.outbox().updateOne({ id: command.id }, { $set: command }, { upsert: true });
      },
      'persistOutboxCommand'
    );
  }

  private clients(): Collection<SupportClientProfile> {
    return this.requireDb().collection<SupportClientProfile>(this.clientsCollectionName);
  }

  private dialogs(): Collection<SupportDialog> {
    return this.requireDb().collection<SupportDialog>(this.dialogsCollectionName);
  }

  private messages(): Collection<SupportMessage> {
    return this.requireDb().collection<SupportMessage>(this.messagesCollectionName);
  }

  private responseMetrics(): Collection<SupportResponseMetric> {
    return this.requireDb().collection<SupportResponseMetric>(
      this.responseMetricsCollectionName
    );
  }

  private outbox(): Collection<SupportOutboxCommand> {
    return this.requireDb().collection<SupportOutboxCommand>(this.outboxCollectionName);
  }

  private readEnv(name: string): string | undefined {
    const value = String(process.env[name] ?? '').trim();
    return value || undefined;
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB is not initialized');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.clients().createIndex({ id: 1 }, { unique: true }),
      this.clients().createIndex({ phones: 1 }),
      this.clients().createIndex({ emails: 1 }),
      this.clients().createIndex({ 'identities.connector': 1, 'identities.externalUserId': 1 }),
      this.clients().createIndex({ 'identities.connector': 1, 'identities.externalChatId': 1 }),
      this.dialogs().createIndex({ id: 1 }, { unique: true }),
      this.dialogs().createIndex({ stationId: 1, updatedAt: -1 }),
      this.dialogs().createIndex({ accessStationIds: 1, updatedAt: -1 }),
      this.dialogs().createIndex({ clientId: 1, status: 1 }),
      this.messages().createIndex({ id: 1 }, { unique: true }),
      this.messages().createIndex({ dialogId: 1, createdAt: 1 }),
      this.messages().createIndex({ clientId: 1, createdAt: 1 }),
      this.responseMetrics().createIndex({ id: 1 }, { unique: true }),
      this.responseMetrics().createIndex({ dialogId: 1, startedAt: -1 }),
      this.outbox().createIndex({ id: 1 }, { unique: true }),
      this.outbox().createIndex({ connector: 1, status: 1, createdAt: 1 })
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
