import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Collection, Db, Document, MongoClient } from 'mongodb';
import { Tournament } from '../../tournaments/tournaments.types';
import { VivaTournamentsService } from './viva-tournaments.service';

export interface VivaTournamentSnapshotListOptions {
  date?: string;
  from?: string;
  to?: string;
}

export interface VivaTournamentSnapshot {
  key: string;
  generatedAt: string;
  lastSuccessfulAt: string;
  windowFrom: string;
  windowTo: string;
  tournaments: Tournament[];
  tournamentsCount: number;
  refreshReason: string;
}

export interface VivaTournamentSnapshotDiagnostics {
  enabled: boolean;
  refreshEnabled: boolean;
  readModelEnabled: boolean;
  mongoEnabled: boolean;
  inProgress: boolean;
  activeMode: boolean;
  activeRefreshIntervalMs: number;
  idleRefreshIntervalMs: number;
  activeWindowMs: number;
  hydrateRetryMs: number;
  windowPastDays: number;
  windowLookaheadDays: number;
  lastPublicReadAt?: string;
  lastHydrateFailureAt?: string;
  lastStartedAt?: string;
  lastSuccessfulAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  nextRefreshAt?: string;
  snapshot?: {
    generatedAt: string;
    windowFrom: string;
    windowTo: string;
    tournamentsCount: number;
  };
}

export interface VivaTournamentSnapshotFreshness {
  refreshEnabled: boolean;
  readModelEnabled: boolean;
  refreshInProgress: boolean;
  stale: boolean;
  snapshotAvailable: boolean;
  snapshotAgeMs?: number;
  lastSuccessfulAt?: string;
}

export interface VivaTournamentSnapshotRefreshResult {
  enabled: boolean;
  refreshed: boolean;
  reason: 'disabled' | 'fresh' | 'refreshed' | 'refresh_failed';
  snapshotAvailable: boolean;
  snapshotAgeMs?: number;
  lastSuccessfulAt?: string;
}

type VivaTournamentSnapshotDocument = Document & VivaTournamentSnapshot;

@Injectable()
export class VivaTournamentSnapshotService implements OnModuleDestroy {
  private readonly logger = new Logger(VivaTournamentSnapshotService.name);
  private readonly snapshotKey = 'default';
  private readonly readModelEnabled = this.readBooleanEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', false);
  private readonly refreshEnabled = this.readBooleanEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_ENABLED',
    this.readModelEnabled
  );
  private readonly activeRefreshIntervalMs = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_ACTIVE_REFRESH_MS',
    60_000
  );
  private readonly idleRefreshIntervalMs = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_IDLE_REFRESH_MS',
    300_000
  );
  private readonly activeWindowMs = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_ACTIVE_WINDOW_MS',
    this.activeRefreshIntervalMs * 2
  );
  private readonly hydrateRetryMs = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS',
    60_000
  );
  private readonly tickMs = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_TICK_MS',
    Math.min(30_000, this.activeRefreshIntervalMs)
  );
  private readonly windowPastDays = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_PAST_DAYS',
    7
  );
  private readonly windowLookaheadDays = this.readPositiveNumberEnv(
    'VIVA_TOURNAMENT_SNAPSHOT_LOOKAHEAD_DAYS',
    45
  );
  private readonly mongoUri = this.normalizeString(
    process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI
      ?? process.env.TOURNAMENTS_MONGODB_URI
      ?? process.env.MONGODB_URI
  );
  private readonly mongoDbName =
    this.normalizeString(
      process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_DB
        ?? process.env.TOURNAMENTS_MONGODB_DB
    ) ?? 'games';
  private readonly collectionName =
    this.normalizeString(process.env.VIVA_TOURNAMENT_SNAPSHOT_COLLECTION)
    ?? 'viva_tournament_snapshots';

  private client?: MongoClient;
  private db?: Db;
  private refreshTimer?: NodeJS.Timeout;
  private snapshot?: VivaTournamentSnapshot;
  private refreshPromise?: Promise<VivaTournamentSnapshot | null>;
  private hydrateAttempted = false;
  private lastHydrateFailureAt?: number;
  private indexesEnsured = false;
  private lastPublicReadAt?: number;
  private lastStartedAt?: string;
  private lastFailureAt?: string;
  private lastError?: string;

  constructor(private readonly vivaTournamentsService: VivaTournamentsService) {
    if (this.refreshEnabled) {
      this.refreshTimer = setInterval(() => {
        this.scheduleRefreshIfDue('interval');
      }, this.tickMs);
      this.refreshTimer.unref?.();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = undefined;
      this.db = undefined;
    }
  }

  isEnabled(): boolean {
    return this.refreshEnabled;
  }

  async listTournaments(options?: VivaTournamentSnapshotListOptions): Promise<Tournament[] | null> {
    if (!this.refreshEnabled && !this.readModelEnabled) {
      return null;
    }

    this.lastPublicReadAt = Date.now();
    const snapshot = await this.getCurrentSnapshot();
    if (this.refreshEnabled) {
      this.scheduleRefreshIfDue(snapshot ? 'read' : 'cold_read');
    }
    if (!this.readModelEnabled || !snapshot || !this.coversOptions(snapshot, options)) {
      return null;
    }

    return this.filterTournaments(snapshot.tournaments, options);
  }

  async refreshNow(reason = 'manual'): Promise<VivaTournamentSnapshot | null> {
    return this.refreshSnapshotNow(reason);
  }

  async refreshOnAdminOpen(
    reason = 'admin_open',
    maxAgeMs = 5 * 60_000
  ): Promise<VivaTournamentSnapshotRefreshResult> {
    if (!this.refreshEnabled && !this.readModelEnabled) {
      return {
        enabled: false,
        refreshed: false,
        reason: 'disabled',
        snapshotAvailable: false
      };
    }

    const snapshot = await this.getCurrentSnapshot();
    const snapshotAgeMs = this.resolveSnapshotAgeMs(snapshot);
    if (snapshot && snapshotAgeMs !== undefined && snapshotAgeMs < maxAgeMs) {
      return this.buildRefreshResult('fresh', snapshot, false, snapshotAgeMs);
    }

    const refreshedSnapshot = await this.refreshSnapshotNow(reason, { force: true });
    if (!refreshedSnapshot) {
      return this.buildRefreshResult('refresh_failed', snapshot, false, snapshotAgeMs);
    }

    return this.buildRefreshResult('refreshed', refreshedSnapshot, true);
  }

  private async refreshSnapshotNow(
    reason: string,
    options?: {
      force?: boolean;
    }
  ): Promise<VivaTournamentSnapshot | null> {
    if (!this.refreshEnabled && options?.force !== true) {
      return null;
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshSnapshot(reason).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  getFreshnessMetadata(): VivaTournamentSnapshotFreshness {
    const now = Date.now();
    const snapshotAgeMs = this.resolveSnapshotAgeMs(this.snapshot, now);
    const stale =
      !this.snapshot
      || snapshotAgeMs === undefined
      || snapshotAgeMs > this.resolveRefreshIntervalMs(now);
    return {
      refreshEnabled: this.refreshEnabled,
      readModelEnabled: this.readModelEnabled,
      refreshInProgress: Boolean(this.refreshPromise),
      stale,
      snapshotAvailable: Boolean(this.snapshot),
      ...(snapshotAgeMs !== undefined ? { snapshotAgeMs } : {}),
      ...(this.snapshot?.lastSuccessfulAt ? { lastSuccessfulAt: this.snapshot.lastSuccessfulAt } : {})
    };
  }

  getDiagnostics(): VivaTournamentSnapshotDiagnostics {
    const now = Date.now();
    const intervalMs = this.resolveRefreshIntervalMs(now);
    const nextRefreshAt = this.snapshot
      ? Date.parse(this.snapshot.lastSuccessfulAt) + intervalMs
      : undefined;
    return {
      enabled: this.refreshEnabled,
      refreshEnabled: this.refreshEnabled,
      readModelEnabled: this.readModelEnabled,
      mongoEnabled: Boolean(this.mongoUri),
      inProgress: Boolean(this.refreshPromise),
      activeMode: this.isActiveMode(now),
      activeRefreshIntervalMs: this.activeRefreshIntervalMs,
      idleRefreshIntervalMs: this.idleRefreshIntervalMs,
      activeWindowMs: this.activeWindowMs,
      hydrateRetryMs: this.hydrateRetryMs,
      windowPastDays: this.windowPastDays,
      windowLookaheadDays: this.windowLookaheadDays,
      ...(this.lastPublicReadAt ? { lastPublicReadAt: new Date(this.lastPublicReadAt).toISOString() } : {}),
      ...(this.lastHydrateFailureAt ? { lastHydrateFailureAt: new Date(this.lastHydrateFailureAt).toISOString() } : {}),
      ...(this.lastStartedAt ? { lastStartedAt: this.lastStartedAt } : {}),
      ...(this.snapshot?.lastSuccessfulAt ? { lastSuccessfulAt: this.snapshot.lastSuccessfulAt } : {}),
      ...(this.lastFailureAt ? { lastFailureAt: this.lastFailureAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(nextRefreshAt ? { nextRefreshAt: new Date(nextRefreshAt).toISOString() } : {}),
      ...(this.snapshot
        ? {
            snapshot: {
              generatedAt: this.snapshot.generatedAt,
              windowFrom: this.snapshot.windowFrom,
              windowTo: this.snapshot.windowTo,
              tournamentsCount: this.snapshot.tournamentsCount
            }
          }
        : {})
    };
  }

  private async getCurrentSnapshot(): Promise<VivaTournamentSnapshot | undefined> {
    if (this.snapshot) {
      return this.snapshot;
    }

    const now = Date.now();
    if (
      this.hydrateAttempted
      && (
        !this.lastHydrateFailureAt
        || now - this.lastHydrateFailureAt < this.hydrateRetryMs
      )
    ) {
      return this.snapshot;
    }
    this.hydrateAttempted = true;
    if (!this.mongoUri) {
      return undefined;
    }

    try {
      const document = await this.collection().then((collection) =>
        collection.findOne({ key: this.snapshotKey })
      );
      const snapshot = this.toSnapshot(document);
      if (snapshot) {
        this.snapshot = snapshot;
      }
      this.lastHydrateFailureAt = undefined;
    } catch (error) {
      this.lastHydrateFailureAt = Date.now();
      this.logger.warn(`Failed to hydrate Viva tournament snapshot: ${String(error)}`);
    }
    return this.snapshot;
  }

  private scheduleRefreshIfDue(reason: string): void {
    if (!this.refreshEnabled || this.refreshPromise) {
      return;
    }
    const now = Date.now();
    const lastSuccessfulAt = this.snapshot?.lastSuccessfulAt
      ? Date.parse(this.snapshot.lastSuccessfulAt)
      : 0;
    const intervalMs = this.resolveRefreshIntervalMs(now);
    if (!this.snapshot || !Number.isFinite(lastSuccessfulAt) || now - lastSuccessfulAt >= intervalMs) {
      void this.refreshNow(reason).catch(() => undefined);
    }
  }

  private async refreshSnapshot(reason: string): Promise<VivaTournamentSnapshot | null> {
    const startedAtMs = Date.now();
    this.lastStartedAt = new Date(startedAtMs).toISOString();
    const today = this.toMoscowDateKey(new Date(startedAtMs));
    const windowFrom = this.addDays(today, -this.windowPastDays);
    const windowTo = this.addDays(today, this.windowLookaheadDays);

    try {
      const tournaments = await this.vivaTournamentsService.listTournaments({
        from: windowFrom,
        to: windowTo
      });
      if (!tournaments) {
        throw new Error('Viva tournaments source returned no data');
      }

      const generatedAt = new Date().toISOString();
      const snapshot: VivaTournamentSnapshot = {
        key: this.snapshotKey,
        generatedAt,
        lastSuccessfulAt: generatedAt,
        windowFrom,
        windowTo,
        tournaments,
        tournamentsCount: tournaments.length,
        refreshReason: reason
      };
      this.snapshot = snapshot;
      this.lastError = undefined;
      this.lastFailureAt = undefined;
      await this.persistSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      this.lastFailureAt = new Date().toISOString();
      this.lastError = this.formatError(error);
      this.logger.warn(
        JSON.stringify({
          type: 'viva_tournament_snapshot_refresh_failed',
          reason,
          windowFrom,
          windowTo,
          error: this.lastError
        })
      );
      return this.snapshot ?? null;
    }
  }

  private async persistSnapshot(snapshot: VivaTournamentSnapshot): Promise<void> {
    if (!this.mongoUri) {
      return;
    }
    try {
      const collection = await this.collection();
      await collection.updateOne(
        { key: this.snapshotKey },
        { $set: snapshot },
        { upsert: true }
      );
    } catch (error) {
      this.logger.warn(`Failed to persist Viva tournament snapshot: ${String(error)}`);
    }
  }

  private async collection(): Promise<Collection<VivaTournamentSnapshotDocument>> {
    if (!this.mongoUri) {
      throw new Error('Viva tournament snapshot MongoDB is not configured');
    }
    if (!this.client) {
      this.client = new MongoClient(this.mongoUri, {
        serverSelectionTimeoutMS: 2000,
        maxPoolSize: 4
      });
      await this.client.connect();
      this.db = this.client.db(this.mongoDbName);
    }

    const collection = this.requireDb().collection<VivaTournamentSnapshotDocument>(this.collectionName);
    if (!this.indexesEnsured) {
      try {
        await collection.createIndex({ key: 1 }, { unique: true });
        await collection.createIndex({ lastSuccessfulAt: -1 });
      } catch (error) {
        this.logger.warn(`Failed to ensure Viva tournament snapshot indexes: ${String(error)}`);
      }
      this.indexesEnsured = true;
    }
    return collection;
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('Viva tournament snapshot MongoDB is not connected');
    }
    return this.db;
  }

  private toSnapshot(document: VivaTournamentSnapshotDocument | null): VivaTournamentSnapshot | undefined {
    if (!document || !Array.isArray(document.tournaments)) {
      return undefined;
    }
    const generatedAt = this.normalizeString(document.generatedAt);
    const lastSuccessfulAt = this.normalizeString(document.lastSuccessfulAt);
    const windowFrom = this.normalizeDateKey(document.windowFrom);
    const windowTo = this.normalizeDateKey(document.windowTo);
    if (!generatedAt || !lastSuccessfulAt || !windowFrom || !windowTo) {
      return undefined;
    }

    return {
      key: this.snapshotKey,
      generatedAt,
      lastSuccessfulAt,
      windowFrom,
      windowTo,
      tournaments: document.tournaments,
      tournamentsCount: document.tournaments.length,
      refreshReason: this.normalizeString(document.refreshReason) ?? 'persisted'
    };
  }

  private coversOptions(
    snapshot: VivaTournamentSnapshot,
    options?: VivaTournamentSnapshotListOptions
  ): boolean {
    const date = this.normalizeDateKey(options?.date);
    if (date) {
      return date >= snapshot.windowFrom && date <= snapshot.windowTo;
    }

    const from = this.normalizeDateKey(options?.from);
    const to = this.normalizeDateKey(options?.to);
    if (from && from < snapshot.windowFrom) {
      return false;
    }
    if (to && to > snapshot.windowTo) {
      return false;
    }
    return true;
  }

  private filterTournaments(
    tournaments: Tournament[],
    options?: VivaTournamentSnapshotListOptions
  ): Tournament[] {
    const date = this.normalizeDateKey(options?.date);
    const from = this.normalizeDateKey(options?.from);
    const to = this.normalizeDateKey(options?.to);
    return tournaments.filter((tournament) => {
      const tournamentDate = this.normalizeDateKey(tournament.startsAt ?? tournament.createdAt);
      if (!tournamentDate) {
        return !date && !from && !to;
      }
      if (date && tournamentDate !== date) {
        return false;
      }
      if (from && tournamentDate < from) {
        return false;
      }
      if (to && tournamentDate > to) {
        return false;
      }
      return true;
    });
  }

  private buildRefreshResult(
    reason: VivaTournamentSnapshotRefreshResult['reason'],
    snapshot?: VivaTournamentSnapshot | null,
    refreshed = false,
    snapshotAgeMs = this.resolveSnapshotAgeMs(snapshot ?? undefined)
  ): VivaTournamentSnapshotRefreshResult {
    return {
      enabled: this.refreshEnabled || this.readModelEnabled,
      refreshed,
      reason,
      snapshotAvailable: Boolean(snapshot),
      ...(snapshotAgeMs !== undefined ? { snapshotAgeMs } : {}),
      ...(snapshot?.lastSuccessfulAt ? { lastSuccessfulAt: snapshot.lastSuccessfulAt } : {})
    };
  }

  private resolveSnapshotAgeMs(
    snapshot?: VivaTournamentSnapshot,
    now = Date.now()
  ): number | undefined {
    const lastSuccessfulAtMs = snapshot?.lastSuccessfulAt
      ? Date.parse(snapshot.lastSuccessfulAt)
      : undefined;
    return lastSuccessfulAtMs !== undefined && Number.isFinite(lastSuccessfulAtMs)
      ? Math.max(0, now - lastSuccessfulAtMs)
      : undefined;
  }

  private resolveRefreshIntervalMs(now: number): number {
    return this.isActiveMode(now)
      ? this.activeRefreshIntervalMs
      : this.idleRefreshIntervalMs;
  }

  private isActiveMode(now: number): boolean {
    return this.lastPublicReadAt !== undefined && now - this.lastPublicReadAt <= this.activeWindowMs;
  }

  private toMoscowDateKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  private addDays(dateKey: string, days: number): string {
    const date = this.dateFromKey(dateKey);
    date.setUTCDate(date.getUTCDate() + days);
    return this.toDateKey(date);
  }

  private dateFromKey(dateKey: string): Date {
    const [year, month, day] = dateKey.split('-').map((item) => Number(item));
    if (
      !Number.isFinite(year)
      || !Number.isFinite(month)
      || !Number.isFinite(day)
    ) {
      return new Date();
    }
    return new Date(Date.UTC(year, month - 1, day));
  }

  private toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private normalizeDateKey(value?: string): string | undefined {
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    const dateKey = normalized.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return dateKey ?? undefined;
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
