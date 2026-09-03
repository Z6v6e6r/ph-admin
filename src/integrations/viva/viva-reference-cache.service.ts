import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Collection, Db, Document, MongoClient } from 'mongodb';
import {
  ensureMongoIndex,
  isMongoIndexReadinessError,
  isProductionRuntime
} from '../../common/mongo-index.guard';

export type VivaReferenceCacheType =
  | 'studios'
  | 'trainers'
  | 'exerciseTypes'
  | 'rooms'
  | 'profile';

export interface VivaReferenceCacheOptions<T> {
  widgetId: string;
  type: VivaReferenceCacheType;
  ttlMs?: number;
  load: () => Promise<T>;
}

export interface VivaReferenceCacheDiagnostics {
  enabled: boolean;
  mongoEnabled: boolean;
  inFlightCount: number;
  entries: Array<{
    key: string;
    type: VivaReferenceCacheType;
    widgetId: string;
    updatedAt: string;
    expiresAt: string;
    stale: boolean;
    lastError?: string;
  }>;
}

interface VivaReferenceCacheEntry<T = unknown> {
  key: string;
  widgetId: string;
  type: VivaReferenceCacheType;
  value: T;
  updatedAt: number;
  expiresAt: number;
  lastError?: string;
}

type VivaReferenceCacheDocument = Document & {
  key: string;
  widgetId: string;
  type: VivaReferenceCacheType;
  value: unknown;
  updatedAt: string;
  expiresAt: string;
  lastError?: string;
};

@Injectable()
export class VivaReferenceCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VivaReferenceCacheService.name);
  private readonly enabled = this.readBooleanEnv('VIVA_REFERENCE_CACHE_ENABLED', false);
  private readonly mongoUri = this.normalizeString(
    process.env.VIVA_REFERENCE_CACHE_MONGODB_URI
      ?? process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI
      ?? process.env.TOURNAMENTS_MONGODB_URI
      ?? process.env.MONGODB_URI
  );
  private readonly mongoDbName =
    this.normalizeString(
      process.env.VIVA_REFERENCE_CACHE_MONGODB_DB
        ?? process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_DB
        ?? process.env.TOURNAMENTS_MONGODB_DB
    ) ?? 'games';
  private readonly collectionName =
    this.normalizeString(process.env.VIVA_REFERENCE_CACHE_COLLECTION)
    ?? 'viva_reference_cache';
  private readonly defaultTtlsMs: Record<VivaReferenceCacheType, number> = {
    studios: this.readPositiveNumberEnv('VIVA_REFERENCE_CACHE_STUDIOS_TTL_MS', 24 * 60 * 60 * 1000),
    trainers: this.readPositiveNumberEnv('VIVA_REFERENCE_CACHE_TRAINERS_TTL_MS', 12 * 60 * 60 * 1000),
    exerciseTypes: this.readPositiveNumberEnv('VIVA_REFERENCE_CACHE_EXERCISE_TYPES_TTL_MS', 24 * 60 * 60 * 1000),
    rooms: this.readPositiveNumberEnv('VIVA_REFERENCE_CACHE_ROOMS_TTL_MS', 24 * 60 * 60 * 1000),
    profile: this.readPositiveNumberEnv('VIVA_REFERENCE_CACHE_PROFILE_TTL_MS', 5 * 60 * 1000)
  };

  private readonly entries = new Map<string, VivaReferenceCacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private client?: MongoClient;
  private db?: Db;
  private indexesEnsured = false;

  constructor(@Optional() private readonly now: () => number = () => Date.now()) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.mongoUri || !isProductionRuntime()) return;
    try {
      await this.collection();
    } catch (error) {
      await this.onModuleDestroy();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
      this.db = undefined;
    }
  }

  async getOrLoad<T>(options: VivaReferenceCacheOptions<T>): Promise<T> {
    if (!this.enabled) {
      return options.load();
    }

    const key = this.buildKey(options.widgetId, options.type);
    const now = this.now();
    const memoryEntry = this.entries.get(key);
    if (memoryEntry && memoryEntry.expiresAt > now) {
      return memoryEntry.value as T;
    }

    const persistedEntry = await this.loadPersistedEntry<T>(key);
    if (persistedEntry) {
      this.entries.set(key, persistedEntry);
      if (persistedEntry.expiresAt > now) {
        return persistedEntry.value;
      }
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const staleEntry = (memoryEntry ?? persistedEntry) as VivaReferenceCacheEntry<T> | undefined;
    const request = options.load()
      .then(async (value) => {
        const loadedAt = this.now();
        const ttlMs = this.resolveTtlMs(options.type, options.ttlMs);
        const entry: VivaReferenceCacheEntry<T> = {
          key,
          widgetId: this.normalizeWidgetId(options.widgetId),
          type: options.type,
          value,
          updatedAt: loadedAt,
          expiresAt: loadedAt + ttlMs
        };
        this.entries.set(key, entry);
        await this.persistEntry(entry);
        return value;
      })
      .catch((error: unknown) => {
        const lastError = this.formatError(error);
        if (staleEntry) {
          const staleWithError: VivaReferenceCacheEntry<T> = {
            ...staleEntry,
            lastError
          };
          this.entries.set(key, staleWithError);
          void this.persistEntry(staleWithError).catch(() => undefined);
          this.logger.warn(
            JSON.stringify({
              type: 'viva_reference_cache_stale_returned',
              key,
              lastError
            })
          );
          return staleEntry.value;
        }
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }

  getDiagnostics(): VivaReferenceCacheDiagnostics {
    const now = this.now();
    return {
      enabled: this.enabled,
      mongoEnabled: Boolean(this.mongoUri),
      inFlightCount: this.inFlight.size,
      entries: Array.from(this.entries.values())
        .map((entry) => ({
          key: entry.key,
          type: entry.type,
          widgetId: entry.widgetId,
          updatedAt: new Date(entry.updatedAt).toISOString(),
          expiresAt: new Date(entry.expiresAt).toISOString(),
          stale: entry.expiresAt <= now,
          ...(entry.lastError ? { lastError: entry.lastError } : {})
        }))
        .sort((left, right) => left.key.localeCompare(right.key))
    };
  }

  private async loadPersistedEntry<T>(
    key: string
  ): Promise<VivaReferenceCacheEntry<T> | undefined> {
    if (!this.mongoUri) {
      return undefined;
    }
    try {
      const document = await this.collection().then((collection) => collection.findOne({ key }));
      return this.toEntry<T>(document);
    } catch (error) {
      this.logger.warn(`Failed to hydrate Viva reference cache ${key}: ${String(error)}`);
      if (isMongoIndexReadinessError(error)) throw error;
      return undefined;
    }
  }

  private async persistEntry(entry: VivaReferenceCacheEntry): Promise<void> {
    if (!this.mongoUri) {
      return;
    }
    try {
      const document: VivaReferenceCacheDocument = {
        key: entry.key,
        widgetId: entry.widgetId,
        type: entry.type,
        value: entry.value,
        updatedAt: new Date(entry.updatedAt).toISOString(),
        expiresAt: new Date(entry.expiresAt).toISOString(),
        ...(entry.lastError ? { lastError: entry.lastError } : {})
      };
      const collection = await this.collection();
      await collection.updateOne(
        { key: entry.key },
        { $set: document },
        { upsert: true }
      );
    } catch (error) {
      this.logger.warn(`Failed to persist Viva reference cache ${entry.key}: ${String(error)}`);
      if (isMongoIndexReadinessError(error)) throw error;
    }
  }

  private async collection(): Promise<Collection<VivaReferenceCacheDocument>> {
    if (!this.mongoUri) {
      throw new Error('Viva reference cache MongoDB is not configured');
    }
    if (!this.client) {
      this.client = new MongoClient(this.mongoUri, {
        serverSelectionTimeoutMS: 2000,
        maxPoolSize: 4
      });
      await this.client.connect();
      this.db = this.client.db(this.mongoDbName);
    }

    const collection = this.requireDb().collection<VivaReferenceCacheDocument>(this.collectionName);
    if (!this.indexesEnsured) {
      try {
        await ensureMongoIndex(collection, { key: 1 }, { unique: true });
        await ensureMongoIndex(collection, { type: 1, widgetId: 1 });
        await ensureMongoIndex(collection, { expiresAt: 1 });
      } catch (error) {
        if (isMongoIndexReadinessError(error)) throw error;
        this.logger.warn(`Failed to ensure Viva reference cache indexes: ${String(error)}`);
      }
      this.indexesEnsured = true;
    }
    return collection;
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('Viva reference cache MongoDB is not connected');
    }
    return this.db;
  }

  private toEntry<T>(document: VivaReferenceCacheDocument | null): VivaReferenceCacheEntry<T> | undefined {
    if (!document) {
      return undefined;
    }
    const key = this.normalizeString(document.key);
    const widgetId = this.normalizeString(document.widgetId);
    const type = this.normalizeReferenceType(document.type);
    const updatedAt = Date.parse(String(document.updatedAt ?? ''));
    const expiresAt = Date.parse(String(document.expiresAt ?? ''));
    if (
      !key
      || !widgetId
      || !type
      || !Number.isFinite(updatedAt)
      || !Number.isFinite(expiresAt)
    ) {
      return undefined;
    }
    return {
      key,
      widgetId,
      type,
      value: document.value as T,
      updatedAt,
      expiresAt,
      ...(document.lastError ? { lastError: String(document.lastError) } : {})
    };
  }

  private buildKey(widgetId: string, type: VivaReferenceCacheType): string {
    return `${this.normalizeWidgetId(widgetId)}:${type}`;
  }

  private normalizeWidgetId(widgetId: string): string {
    return this.normalizeString(widgetId) ?? 'default';
  }

  private resolveTtlMs(type: VivaReferenceCacheType, ttlMs?: number): number {
    if (Number.isFinite(ttlMs) && ttlMs !== undefined && ttlMs > 0) {
      return Math.trunc(ttlMs);
    }
    return this.defaultTtlsMs[type];
  }

  private normalizeReferenceType(value: unknown): VivaReferenceCacheType | undefined {
    const normalized = this.normalizeString(String(value ?? ''));
    if (
      normalized === 'studios'
      || normalized === 'trainers'
      || normalized === 'exerciseTypes'
      || normalized === 'rooms'
      || normalized === 'profile'
    ) {
      return normalized;
    }
    return undefined;
  }

  private normalizeString(value?: string): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.trunc(parsed);
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = this.normalizeString(process.env[name])?.toLowerCase();
    if (!raw) {
      return fallback;
    }
    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }
    return fallback;
  }
}
