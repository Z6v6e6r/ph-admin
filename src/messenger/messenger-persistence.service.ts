import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import {
  AiReplySuggestion,
  ChatMessage,
  ChatThread,
  DialogAiInsight,
  MessengerAccessRule,
  MessengerConnectorConfig,
  MessengerStationConfig,
  StaffResponseMetric,
  ThreadAiConfig
} from './messenger.types';

interface PersistedMetrics {
  threadId: string;
  metrics: StaffResponseMetric[];
}

interface PersistedAiConfig {
  threadId: string;
  config: ThreadAiConfig;
}

interface PersistedAiInsight {
  threadId: string;
  insight: DialogAiInsight;
}

export interface MessengerPersistedState {
  threads: ChatThread[];
  messages: ChatMessage[];
  stations: MessengerStationConfig[];
  connectors: MessengerConnectorConfig[];
  accessRules: MessengerAccessRule[];
  metrics: PersistedMetrics[];
  aiConfigs: PersistedAiConfig[];
  aiInsights: PersistedAiInsight[];
  aiSuggestions: AiReplySuggestion[];
}

@Injectable()
export class MessengerPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessengerPersistenceService.name);
  private client?: MongoClient;
  private db?: Db;

  async onModuleInit(): Promise<void> {
    const uri = String(process.env.MONGODB_URI ?? '').trim();
    if (!uri) {
      this.logger.log('MONGODB_URI is empty. Messenger persistence disabled (in-memory mode).');
      return;
    }

    const dbName = String(process.env.MONGODB_DB ?? 'default_db').trim() || 'default_db';
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20
    });

    try {
      await this.client.connect();
      this.db = this.client.db(dbName);
      await this.ensureIndexes();
      this.logger.log(`MongoDB persistence enabled. db=${dbName}`);
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

  async loadState(): Promise<MessengerPersistedState> {
    if (!this.db) {
      return {
        threads: [],
        messages: [],
        stations: [],
        connectors: [],
        accessRules: [],
        metrics: [],
        aiConfigs: [],
        aiInsights: [],
        aiSuggestions: []
      };
    }

    const [
      threads,
      messages,
      stations,
      connectors,
      accessRules,
      metrics,
      aiConfigs,
      aiInsights,
      aiSuggestions
    ] = await Promise.all([
      this.threads().find({}, { projection: { _id: 0 } }).toArray(),
      this.messages().find({}, { projection: { _id: 0 } }).toArray(),
      this.stations().find({}, { projection: { _id: 0 } }).toArray(),
      this.connectors().find({}, { projection: { _id: 0 } }).toArray(),
      this.accessRules().find({}, { projection: { _id: 0 } }).toArray(),
      this.metrics().find({}, { projection: { _id: 0 } }).toArray(),
      this.aiConfigs().find({}, { projection: { _id: 0 } }).toArray(),
      this.aiInsights().find({}, { projection: { _id: 0 } }).toArray(),
      this.aiSuggestions().find({}, { projection: { _id: 0 } }).toArray()
    ]);

    return {
      threads: threads as ChatThread[],
      messages: messages as ChatMessage[],
      stations: stations as MessengerStationConfig[],
      connectors: connectors as MessengerConnectorConfig[],
      accessRules: accessRules as MessengerAccessRule[],
      metrics: metrics as PersistedMetrics[],
      aiConfigs: aiConfigs as PersistedAiConfig[],
      aiInsights: aiInsights as PersistedAiInsight[],
      aiSuggestions: aiSuggestions as AiReplySuggestion[]
    };
  }

  persistThread(thread: ChatThread): void {
    this.fireAndForget(
      async () => {
        await this.threads().updateOne({ id: thread.id }, { $set: thread }, { upsert: true });
      },
      'persistThread'
    );
  }

  persistMessage(message: ChatMessage): void {
    this.fireAndForget(
      async () => {
        await this.messages().updateOne({ id: message.id }, { $set: message }, { upsert: true });
      },
      'persistMessage'
    );
  }

  persistStation(station: MessengerStationConfig): void {
    this.fireAndForget(
      async () => {
        await this.stations().updateOne(
          { stationId: station.stationId },
          { $set: station },
          { upsert: true }
        );
      },
      'persistStation'
    );
  }

  persistConnector(connector: MessengerConnectorConfig): void {
    this.fireAndForget(
      async () => {
        await this.connectors().updateOne({ id: connector.id }, { $set: connector }, { upsert: true });
      },
      'persistConnector'
    );
  }

  persistAccessRule(rule: MessengerAccessRule): void {
    this.fireAndForget(
      async () => {
        await this.accessRules().updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
      },
      'persistAccessRule'
    );
  }

  persistResponseMetrics(threadId: string, metrics: StaffResponseMetric[]): void {
    this.fireAndForget(
      async () => {
        await this.metrics().updateOne(
          { threadId },
          { $set: { threadId, metrics } },
          { upsert: true }
        );
      },
      'persistResponseMetrics'
    );
  }

  persistAiConfig(threadId: string, config: ThreadAiConfig): void {
    this.fireAndForget(
      async () => {
        await this.aiConfigs().updateOne(
          { threadId },
          { $set: { threadId, config } },
          { upsert: true }
        );
      },
      'persistAiConfig'
    );
  }

  persistAiInsight(threadId: string, insight: DialogAiInsight): void {
    this.fireAndForget(
      async () => {
        await this.aiInsights().updateOne(
          { threadId },
          { $set: { threadId, insight } },
          { upsert: true }
        );
      },
      'persistAiInsight'
    );
  }

  persistAiSuggestion(suggestion: AiReplySuggestion): void {
    this.fireAndForget(
      async () => {
        await this.aiSuggestions().updateOne(
          { id: suggestion.id },
          { $set: suggestion },
          { upsert: true }
        );
      },
      'persistAiSuggestion'
    );
  }

  private threads(): Collection<ChatThread> {
    return this.requireDb().collection<ChatThread>('messenger_threads');
  }

  private messages(): Collection<ChatMessage> {
    return this.requireDb().collection<ChatMessage>('messenger_messages');
  }

  private stations(): Collection<MessengerStationConfig> {
    return this.requireDb().collection<MessengerStationConfig>('messenger_station_configs');
  }

  private connectors(): Collection<MessengerConnectorConfig> {
    return this.requireDb().collection<MessengerConnectorConfig>('messenger_connector_configs');
  }

  private accessRules(): Collection<MessengerAccessRule> {
    return this.requireDb().collection<MessengerAccessRule>('messenger_access_rules');
  }

  private metrics(): Collection<PersistedMetrics> {
    return this.requireDb().collection<PersistedMetrics>('messenger_response_metrics');
  }

  private aiConfigs(): Collection<PersistedAiConfig> {
    return this.requireDb().collection<PersistedAiConfig>('messenger_ai_configs');
  }

  private aiInsights(): Collection<PersistedAiInsight> {
    return this.requireDb().collection<PersistedAiInsight>('messenger_ai_insights');
  }

  private aiSuggestions(): Collection<AiReplySuggestion> {
    return this.requireDb().collection<AiReplySuggestion>('messenger_ai_suggestions');
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB is not initialized');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.threads().createIndex({ id: 1 }, { unique: true }),
      this.threads().createIndex({ connector: 1, stationId: 1, updatedAt: -1 }),
      this.messages().createIndex({ id: 1 }, { unique: true }),
      this.messages().createIndex({ threadId: 1, createdAt: 1 }),
      this.stations().createIndex({ stationId: 1 }, { unique: true }),
      this.connectors().createIndex({ id: 1 }, { unique: true }),
      this.accessRules().createIndex({ id: 1 }, { unique: true }),
      this.metrics().createIndex({ threadId: 1 }, { unique: true }),
      this.aiConfigs().createIndex({ threadId: 1 }, { unique: true }),
      this.aiInsights().createIndex({ threadId: 1 }, { unique: true }),
      this.aiSuggestions().createIndex({ id: 1 }, { unique: true }),
      this.aiSuggestions().createIndex({ threadId: 1, createdAt: -1 })
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
