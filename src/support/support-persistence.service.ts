import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, Document, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import {
  SupportClientProfile,
  SupportConnectorRoute,
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

export interface SupportPersistenceBackendDiagnostics {
  key: string;
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
  counts?: SupportPersistenceCollectionCounts;
  countError?: string;
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
    supportWebMongoUriConfigured: boolean;
    supportWebMongoDb?: string;
    supportMaxMongoUriConfigured: boolean;
    supportMaxMongoDb?: string;
  };
  counts?: SupportPersistenceCollectionCounts;
  countError?: string;
  routing: {
    webBackendKey: string;
    maxBackendKey: string;
  };
  backends: SupportPersistenceBackendDiagnostics[];
}

type SupportPersistenceBackendKey = 'primary' | 'web' | 'max';
type SupportPersistenceCollectionKey =
  | 'clients'
  | 'dialogs'
  | 'messages'
  | 'responseMetrics'
  | 'outbox';

interface SupportPersistenceBackendConfig {
  key: SupportPersistenceBackendKey;
  uri?: string;
  dbName: string;
  collections: {
    clients: string;
    dialogs: string;
    messages: string;
    responseMetrics: string;
    outbox: string;
  };
}

interface SupportPersistenceBackendState {
  config: SupportPersistenceBackendConfig;
  client?: MongoClient;
  db?: Db;
}

interface TimestampedEntity<T> {
  entity: T;
  timestamp: number;
}

@Injectable()
export class SupportPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportPersistenceService.name);

  private readonly supportMongoUri = this.readEnv('SUPPORT_MONGODB_URI');
  private readonly fallbackMongoUri = this.readEnv('MONGODB_URI');
  private readonly supportMongoDb = this.readEnv('SUPPORT_MONGODB_DB');
  private readonly fallbackMongoDb = this.readEnv('MONGODB_DB');

  private readonly supportWebMongoUri = this.readEnv('SUPPORT_WEB_MONGODB_URI');
  private readonly supportWebMongoDb = this.readEnv('SUPPORT_WEB_MONGODB_DB');

  private readonly supportMaxMongoUri = this.readEnv('SUPPORT_MAX_MONGODB_URI');
  private readonly supportMaxMongoDb = this.readEnv('SUPPORT_MAX_MONGODB_DB');

  private readonly primaryCollections = {
    clients: this.readEnv('SUPPORT_CLIENTS_COLLECTION') ?? 'support_clients',
    dialogs: this.readEnv('SUPPORT_DIALOGS_COLLECTION') ?? 'support_dialogs',
    messages: this.readEnv('SUPPORT_MESSAGES_COLLECTION') ?? 'support_messages',
    responseMetrics:
      this.readEnv('SUPPORT_RESPONSE_METRICS_COLLECTION') ?? 'support_response_metrics',
    outbox: this.readEnv('SUPPORT_OUTBOX_COLLECTION') ?? 'support_outbox'
  };

  private readonly backendConfigs = this.buildBackendConfigs();
  private readonly backendStates = new Map<SupportPersistenceBackendKey, SupportPersistenceBackendState>();

  async onModuleInit(): Promise<void> {
    for (const config of this.backendConfigs) {
      if (!config.uri) {
        this.logger.warn(
          `Support persistence backend ${config.key} has no Mongo URI and will be disabled.`
        );
        this.backendStates.set(config.key, { config });
        continue;
      }

      const state: SupportPersistenceBackendState = { config };
      this.backendStates.set(config.key, state);

      const client = new MongoClient(config.uri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 20
      });

      try {
        await client.connect();
        state.client = client;
        state.db = client.db(config.dbName);
        await this.ensureIndexes(state);
        this.logger.log(
          `MongoDB support persistence enabled. backend=${config.key} db=${config.dbName}`
        );
      } catch (error) {
        this.logger.error(
          `MongoDB connect failed for backend=${config.key}: ${String(error)}`
        );
        await this.safeCloseBackend(state);
      }
    }

    if (!this.isEnabled()) {
      this.logger.log(
        'Support persistence has no active backend. Running in-memory mode.'
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      Array.from(this.backendStates.values()).map((state) => this.safeCloseBackend(state))
    );
  }

  isEnabled(): boolean {
    return this.getActiveBackends().length > 0;
  }

  async getRuntimeDiagnostics(): Promise<SupportPersistenceRuntimeDiagnostics> {
    const backendDiagnostics = await Promise.all(
      this.backendConfigs.map((config) => this.collectBackendDiagnostics(config))
    );

    const primary = backendDiagnostics.find((backend) => backend.key === 'primary');
    const fallback = backendDiagnostics.find((backend) => backend.enabled);
    const selected = primary ?? fallback ?? backendDiagnostics[0];

    return {
      enabled: this.isEnabled(),
      resolvedDbName: selected?.resolvedDbName ?? this.resolvePrimaryDbName(),
      activeDbName: selected?.activeDbName,
      collections: selected?.collections ?? this.primaryCollections,
      env: {
        supportMongoUriConfigured: Boolean(this.supportMongoUri),
        mongoUriConfigured: Boolean(this.fallbackMongoUri),
        supportMongoDb: this.supportMongoDb,
        mongoDb: this.fallbackMongoDb,
        supportWebMongoUriConfigured: Boolean(this.supportWebMongoUri),
        supportWebMongoDb: this.supportWebMongoDb,
        supportMaxMongoUriConfigured: Boolean(this.supportMaxMongoUri),
        supportMaxMongoDb: this.supportMaxMongoDb
      },
      counts: selected?.counts,
      countError: selected?.countError,
      routing: {
        webBackendKey: this.resolveBackendKeyForConnector(SupportConnectorRoute.LK_WEB_MESSENGER),
        maxBackendKey: this.resolveBackendKeyForConnector(SupportConnectorRoute.MAX_BOT)
      },
      backends: backendDiagnostics
    };
  }

  async loadState(): Promise<SupportPersistedState> {
    const activeBackends = this.getActiveBackends();
    if (activeBackends.length === 0) {
      return {
        clients: [],
        dialogs: [],
        messages: [],
        responseMetrics: [],
        outbox: []
      };
    }

    const clientsById = new Map<string, TimestampedEntity<SupportClientProfile>>();
    const dialogsById = new Map<string, TimestampedEntity<SupportDialog>>();
    const messagesById = new Map<string, TimestampedEntity<SupportMessage>>();
    const metricsById = new Map<string, TimestampedEntity<SupportResponseMetric>>();
    const outboxById = new Map<string, TimestampedEntity<SupportOutboxCommand>>();

    for (const backend of activeBackends) {
      const backendKey = backend.config.key;

      for await (const client of this.collection<SupportClientProfile>(backend, 'clients').find(
        {},
        { projection: { _id: 0 } }
      )) {
        this.upsertByTimestamp(
          clientsById,
          client.id,
          client,
          this.resolveClientTimestamp(client)
        );
      }

      for await (const dialog of this.collection<SupportDialog>(backend, 'dialogs').find(
        {},
        { projection: { _id: 0 } }
      )) {
        if (!this.shouldIncludeDialogForBackend(dialog, backendKey)) {
          continue;
        }
        this.upsertByTimestamp(
          dialogsById,
          dialog.id,
          dialog,
          this.resolveDialogTimestamp(dialog)
        );
      }

      for await (const message of this.collection<SupportMessage>(backend, 'messages').find(
        {},
        { projection: { _id: 0 } }
      )) {
        if (!this.shouldIncludeMessageForBackend(message, backendKey)) {
          continue;
        }
        this.upsertByTimestamp(
          messagesById,
          message.id,
          message,
          this.resolveMessageTimestamp(message)
        );
      }

      for await (const metric of this.collection<SupportResponseMetric>(
        backend,
        'responseMetrics'
      ).find({}, { projection: { _id: 0 } })) {
        if (!this.shouldIncludeResponseMetricForBackend(metric, backendKey)) {
          continue;
        }
        this.upsertByTimestamp(
          metricsById,
          metric.id,
          metric,
          this.resolveResponseMetricTimestamp(metric)
        );
      }

      for await (const command of this.collection<SupportOutboxCommand>(backend, 'outbox').find(
        {},
        { projection: { _id: 0 } }
      )) {
        if (!this.shouldIncludeOutboxForBackend(command, backendKey)) {
          continue;
        }
        this.upsertByTimestamp(
          outboxById,
          command.id,
          command,
          this.resolveOutboxTimestamp(command)
        );
      }
    }

    return {
      clients: Array.from(clientsById.values()).map((item) => item.entity),
      dialogs: Array.from(dialogsById.values()).map((item) => item.entity),
      messages: Array.from(messagesById.values()).map((item) => item.entity),
      responseMetrics: Array.from(metricsById.values()).map((item) => item.entity),
      outbox: Array.from(outboxById.values()).map((item) => item.entity)
    };
  }

  persistClient(client: SupportClientProfile): void {
    this.fireAndForget(async () => {
      const activeBackends = this.getActiveBackends();
      await Promise.all(
        activeBackends.map((backend) =>
          this.collection<SupportClientProfile>(backend, 'clients').updateOne(
            { id: client.id },
            { $set: client },
            { upsert: true }
          )
        )
      );
    }, 'persistClient');
  }

  deleteClient(id: string): void {
    this.fireAndForget(async () => {
      const activeBackends = this.getActiveBackends();
      await Promise.all(
        activeBackends.map((backend) =>
          this.collection<SupportClientProfile>(backend, 'clients').deleteOne({ id })
        )
      );
    }, 'deleteClient');
  }

  persistDialog(dialog: SupportDialog): void {
    this.fireAndForget(async () => {
      const target = this.resolveTargetBackendForDialog(dialog);
      if (!target) {
        return;
      }

      await this.collection<SupportDialog>(target, 'dialogs').updateOne(
        { id: dialog.id },
        { $set: dialog },
        { upsert: true }
      );

      await this.deleteFromOtherBackends(target.config.key, 'dialogs', dialog.id);
    }, 'persistDialog');
  }

  deleteDialog(id: string): void {
    this.fireAndForget(async () => {
      const activeBackends = this.getActiveBackends();
      await Promise.all(
        activeBackends.map((backend) =>
          this.collection<SupportDialog>(backend, 'dialogs').deleteOne({ id })
        )
      );
    }, 'deleteDialog');
  }

  persistMessage(message: SupportMessage): void {
    this.fireAndForget(async () => {
      const target = this.resolveTargetBackendForConnector(message.connector);
      if (!target) {
        return;
      }

      await this.collection<SupportMessage>(target, 'messages').updateOne(
        { id: message.id },
        { $set: message },
        { upsert: true }
      );

      await this.deleteFromOtherBackends(target.config.key, 'messages', message.id);
    }, 'persistMessage');
  }

  persistResponseMetric(metric: SupportResponseMetric): void {
    this.fireAndForget(async () => {
      const target = this.resolveTargetBackendForConnector(metric.connector);
      if (!target) {
        return;
      }

      await this.collection<SupportResponseMetric>(target, 'responseMetrics').updateOne(
        { id: metric.id },
        { $set: metric },
        { upsert: true }
      );

      await this.deleteFromOtherBackends(target.config.key, 'responseMetrics', metric.id);
    }, 'persistResponseMetric');
  }

  persistOutboxCommand(command: SupportOutboxCommand): void {
    this.fireAndForget(async () => {
      const target = this.resolveTargetBackendForConnector(command.connector);
      if (!target) {
        return;
      }

      await this.collection<SupportOutboxCommand>(target, 'outbox').updateOne(
        { id: command.id },
        { $set: command },
        { upsert: true }
      );

      await this.deleteFromOtherBackends(target.config.key, 'outbox', command.id);
    }, 'persistOutboxCommand');
  }

  private buildBackendConfigs(): SupportPersistenceBackendConfig[] {
    const primaryUri = this.supportMongoUri ?? this.fallbackMongoUri;
    const primaryDbName = this.resolvePrimaryDbName();

    const primary: SupportPersistenceBackendConfig = {
      key: 'primary',
      uri: primaryUri,
      dbName: primaryDbName,
      collections: this.primaryCollections
    };

    const configs: SupportPersistenceBackendConfig[] = [primary];

    if (this.supportWebMongoDb) {
      configs.push({
        key: 'web',
        uri: this.supportWebMongoUri ?? primaryUri,
        dbName: this.supportWebMongoDb,
        collections: {
          clients:
            this.readEnv('SUPPORT_WEB_CLIENTS_COLLECTION') ?? this.primaryCollections.clients,
          dialogs:
            this.readEnv('SUPPORT_WEB_DIALOGS_COLLECTION') ?? this.primaryCollections.dialogs,
          messages:
            this.readEnv('SUPPORT_WEB_MESSAGES_COLLECTION') ?? this.primaryCollections.messages,
          responseMetrics:
            this.readEnv('SUPPORT_WEB_RESPONSE_METRICS_COLLECTION') ??
            this.primaryCollections.responseMetrics,
          outbox:
            this.readEnv('SUPPORT_WEB_OUTBOX_COLLECTION') ?? this.primaryCollections.outbox
        }
      });
    }

    if (this.supportMaxMongoDb) {
      configs.push({
        key: 'max',
        uri: this.supportMaxMongoUri ?? primaryUri,
        dbName: this.supportMaxMongoDb,
        collections: {
          clients:
            this.readEnv('SUPPORT_MAX_CLIENTS_COLLECTION') ?? this.primaryCollections.clients,
          dialogs:
            this.readEnv('SUPPORT_MAX_DIALOGS_COLLECTION') ?? this.primaryCollections.dialogs,
          messages:
            this.readEnv('SUPPORT_MAX_MESSAGES_COLLECTION') ?? this.primaryCollections.messages,
          responseMetrics:
            this.readEnv('SUPPORT_MAX_RESPONSE_METRICS_COLLECTION') ??
            this.primaryCollections.responseMetrics,
          outbox:
            this.readEnv('SUPPORT_MAX_OUTBOX_COLLECTION') ?? this.primaryCollections.outbox
        }
      });
    }

    return configs;
  }

  private resolvePrimaryDbName(): string {
    return this.supportMongoDb ?? this.fallbackMongoDb ?? DEFAULT_DIALOGS_MONGODB_DB;
  }

  private getBackendState(key: SupportPersistenceBackendKey):
    | SupportPersistenceBackendState
    | undefined {
    return this.backendStates.get(key);
  }

  private getActiveBackends(): SupportPersistenceBackendState[] {
    return Array.from(this.backendStates.values()).filter((state) => Boolean(state.db));
  }

  private hasActiveBackend(key: SupportPersistenceBackendKey): boolean {
    return Boolean(this.getBackendState(key)?.db);
  }

  private resolveTargetBackendForDialog(
    dialog: SupportDialog
  ): SupportPersistenceBackendState | undefined {
    const connector = this.extractDialogPrimaryConnector(dialog);
    return this.resolveTargetBackendForConnector(connector);
  }

  private resolveTargetBackendForConnector(
    connector?: SupportConnectorRoute
  ): SupportPersistenceBackendState | undefined {
    const preferredKey = this.resolveBackendKeyForConnector(connector);

    const preferred = this.getBackendState(preferredKey);
    if (preferred?.db) {
      return preferred;
    }

    const primary = this.getBackendState('primary');
    if (primary?.db) {
      return primary;
    }

    return this.getActiveBackends()[0];
  }

  private resolveBackendKeyForConnector(
    connector?: SupportConnectorRoute
  ): SupportPersistenceBackendKey {
    if (
      connector === SupportConnectorRoute.LK_WEB_MESSENGER &&
      this.backendConfigs.some((config) => config.key === 'web')
    ) {
      return 'web';
    }

    if (
      connector === SupportConnectorRoute.MAX_BOT &&
      this.backendConfigs.some((config) => config.key === 'max')
    ) {
      return 'max';
    }

    return 'primary';
  }

  private resolveLoadBackendKeyForConnector(
    connector?: SupportConnectorRoute
  ): SupportPersistenceBackendKey {
    const preferred = this.resolveBackendKeyForConnector(connector);
    if (this.hasActiveBackend(preferred)) {
      return preferred;
    }
    if (this.hasActiveBackend('primary')) {
      return 'primary';
    }
    return preferred;
  }

  private shouldIncludeDialogForBackend(
    dialog: SupportDialog,
    backendKey: SupportPersistenceBackendKey
  ): boolean {
    const connector = this.extractDialogPrimaryConnector(dialog);
    return this.resolveLoadBackendKeyForConnector(connector) === backendKey;
  }

  private shouldIncludeMessageForBackend(
    message: SupportMessage,
    backendKey: SupportPersistenceBackendKey
  ): boolean {
    const rawMessage = message as unknown as Record<string, unknown>;
    const resolvedConnector =
      this.normalizeConnector(message.connector) ??
      this.normalizeConnector(rawMessage['channel']);

    return (
      this.resolveLoadBackendKeyForConnector(resolvedConnector) === backendKey
    );
  }

  private shouldIncludeResponseMetricForBackend(
    metric: SupportResponseMetric,
    backendKey: SupportPersistenceBackendKey
  ): boolean {
    return (
      this.resolveLoadBackendKeyForConnector(this.normalizeConnector(metric.connector)) ===
      backendKey
    );
  }

  private shouldIncludeOutboxForBackend(
    command: SupportOutboxCommand,
    backendKey: SupportPersistenceBackendKey
  ): boolean {
    return (
      this.resolveLoadBackendKeyForConnector(this.normalizeConnector(command.connector)) ===
      backendKey
    );
  }

  private extractDialogPrimaryConnector(dialog: SupportDialog): SupportConnectorRoute | undefined {
    const rawDialog = dialog as unknown as Record<string, unknown>;
    const candidates: unknown[] = [
      dialog.lastInboundConnector,
      dialog.lastReplyConnector,
      rawDialog['lastInboundChannel'],
      rawDialog['lastOutboundChannel'],
      rawDialog['lastChannel']
    ];

    if (Array.isArray(dialog.connectors)) {
      candidates.push(...dialog.connectors);
    }

    const channels = rawDialog['channels'];
    if (Array.isArray(channels)) {
      candidates.push(...channels);
    }

    for (const candidate of candidates) {
      const normalized = this.normalizeConnector(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private normalizeConnector(rawConnector: unknown): SupportConnectorRoute | undefined {
    const normalized = String(rawConnector ?? '').trim().toUpperCase();
    if (!normalized) {
      return undefined;
    }

    if (['LK_WEB_MESSENGER', 'WEB', 'WEB_LK', 'LK_WEB', 'LK', 'WIDGET'].includes(normalized)) {
      return SupportConnectorRoute.LK_WEB_MESSENGER;
    }
    if (['TG_BOT', 'TG', 'TELEGRAM'].includes(normalized)) {
      return SupportConnectorRoute.TG_BOT;
    }
    if (['MAX_BOT', 'MAX'].includes(normalized)) {
      return SupportConnectorRoute.MAX_BOT;
    }
    if (['EMAIL', 'MAIL'].includes(normalized)) {
      return SupportConnectorRoute.EMAIL;
    }
    if (['PHONE_CALL', 'CALL', 'PHONE'].includes(normalized)) {
      return SupportConnectorRoute.PHONE_CALL;
    }
    if (['BITRIX', 'BITRIX24'].includes(normalized)) {
      return SupportConnectorRoute.BITRIX;
    }

    return undefined;
  }

  private collection<T extends Document>(
    backend: SupportPersistenceBackendState,
    key: SupportPersistenceCollectionKey
  ): Collection<T> {
    if (!backend.db) {
      throw new Error(`MongoDB backend ${backend.config.key} is not initialized`);
    }
    return backend.db.collection<T>(backend.config.collections[key]);
  }

  private async ensureIndexes(backend: SupportPersistenceBackendState): Promise<void> {
    await Promise.all([
      this.collection<SupportClientProfile>(backend, 'clients').createIndex(
        { id: 1 },
        { unique: true }
      ),
      this.collection<SupportClientProfile>(backend, 'clients').createIndex({ phones: 1 }),
      this.collection<SupportClientProfile>(backend, 'clients').createIndex({ emails: 1 }),
      this.collection<SupportClientProfile>(backend, 'clients').createIndex(
        { 'identities.connector': 1, 'identities.externalUserId': 1 }
      ),
      this.collection<SupportClientProfile>(backend, 'clients').createIndex(
        { 'identities.connector': 1, 'identities.externalChatId': 1 }
      ),
      this.collection<SupportDialog>(backend, 'dialogs').createIndex({ id: 1 }, { unique: true }),
      this.collection<SupportDialog>(backend, 'dialogs').createIndex({ stationId: 1, updatedAt: -1 }),
      this.collection<SupportDialog>(backend, 'dialogs').createIndex({ accessStationIds: 1, updatedAt: -1 }),
      this.collection<SupportDialog>(backend, 'dialogs').createIndex({ clientId: 1, status: 1 }),
      this.collection<SupportMessage>(backend, 'messages').createIndex({ id: 1 }, { unique: true }),
      this.collection<SupportMessage>(backend, 'messages').createIndex({ dialogId: 1, createdAt: 1 }),
      this.collection<SupportMessage>(backend, 'messages').createIndex({ clientId: 1, createdAt: 1 }),
      this.collection<SupportResponseMetric>(backend, 'responseMetrics').createIndex(
        { id: 1 },
        { unique: true }
      ),
      this.collection<SupportResponseMetric>(backend, 'responseMetrics').createIndex({
        dialogId: 1,
        startedAt: -1
      }),
      this.collection<SupportOutboxCommand>(backend, 'outbox').createIndex(
        { id: 1 },
        { unique: true }
      ),
      this.collection<SupportOutboxCommand>(backend, 'outbox').createIndex({
        connector: 1,
        status: 1,
        createdAt: 1
      })
    ]);
  }

  private async collectBackendDiagnostics(
    config: SupportPersistenceBackendConfig
  ): Promise<SupportPersistenceBackendDiagnostics> {
    const state = this.getBackendState(config.key);
    const diagnostics: SupportPersistenceBackendDiagnostics = {
      key: config.key,
      enabled: Boolean(state?.db),
      resolvedDbName: config.dbName,
      activeDbName: state?.db?.databaseName,
      collections: config.collections
    };

    if (!state?.db) {
      return diagnostics;
    }

    try {
      const [clients, dialogs, messages, responseMetrics, outbox] = await Promise.all([
        this.collection<SupportClientProfile>(state, 'clients').countDocuments({}),
        this.collection<SupportDialog>(state, 'dialogs').countDocuments({}),
        this.collection<SupportMessage>(state, 'messages').countDocuments({}),
        this.collection<SupportResponseMetric>(state, 'responseMetrics').countDocuments({}),
        this.collection<SupportOutboxCommand>(state, 'outbox').countDocuments({})
      ]);

      diagnostics.counts = {
        clients,
        dialogs,
        messages,
        responseMetrics,
        outbox
      };
    } catch (error) {
      diagnostics.countError = String(error);
    }

    return diagnostics;
  }

  private upsertByTimestamp<T>(
    target: Map<string, TimestampedEntity<T>>,
    id: string | undefined,
    entity: T,
    timestamp: number
  ): void {
    if (!id) {
      return;
    }

    const existing = target.get(id);
    if (!existing || timestamp >= existing.timestamp) {
      target.set(id, {
        entity,
        timestamp
      });
    }
  }

  private resolveClientTimestamp(client: SupportClientProfile): number {
    return this.parseTimestamp(client.updatedAt) || this.parseTimestamp(client.createdAt);
  }

  private resolveDialogTimestamp(dialog: SupportDialog): number {
    return (
      this.parseTimestamp(dialog.updatedAt) ||
      this.parseTimestamp(dialog.lastMessageAt) ||
      this.parseTimestamp(dialog.createdAt)
    );
  }

  private resolveMessageTimestamp(message: SupportMessage): number {
    const typed = message as unknown as Record<string, unknown>;
    return this.parseTimestamp(message.createdAt) || this.parseTimestamp(typed['createdTs']);
  }

  private resolveResponseMetricTimestamp(metric: SupportResponseMetric): number {
    return this.parseTimestamp(metric.respondedAt) || this.parseTimestamp(metric.startedAt);
  }

  private resolveOutboxTimestamp(command: SupportOutboxCommand): number {
    return this.parseTimestamp(command.createdAt);
  }

  private parseTimestamp(rawValue: unknown): number {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }

    const asString = String(rawValue ?? '').trim();
    if (!asString) {
      return 0;
    }

    const numeric = Number(asString);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    const date = new Date(asString).getTime();
    return Number.isFinite(date) ? date : 0;
  }

  private async deleteFromOtherBackends(
    keepKey: SupportPersistenceBackendKey,
    collectionKey: SupportPersistenceCollectionKey,
    id: string
  ): Promise<void> {
    const targets = this.getActiveBackends().filter(
      (backend) => backend.config.key !== keepKey
    );

    await Promise.all(
      targets.map((backend) => this.collection(backend, collectionKey).deleteOne({ id }))
    );
  }

  private readEnv(name: string): string | undefined {
    const value = String(process.env[name] ?? '').trim();
    return value || undefined;
  }

  private fireAndForget(task: () => Promise<void>, context: string): void {
    if (!this.isEnabled()) {
      return;
    }

    task().catch((error) => {
      this.logger.error(`${context} failed: ${String(error)}`);
    });
  }

  private async safeCloseBackend(state: SupportPersistenceBackendState): Promise<void> {
    if (!state.client) {
      state.db = undefined;
      return;
    }

    try {
      await state.client.close();
    } catch (_error) {
      // ignore close errors
    }

    state.client = undefined;
    state.db = undefined;
  }
}
