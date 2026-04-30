import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../../common/constants/dialogs-mongo.constants';

export type VivaClientCabinetStatus = 'FOUND' | 'NOT_FOUND' | 'DISABLED';

export interface VivaClientCabinetLookup {
  phone: string;
  status: VivaClientCabinetStatus;
  vivaClientId?: string;
  vivaCabinetUrl?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface VivaAdminSettingsSnapshot {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  username?: string;
  hasStaticToken: boolean;
  hasPassword: boolean;
  source: 'mongo' | 'env' | 'defaults';
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateVivaAdminSettingsInput {
  baseUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  username?: string;
  staticToken?: string;
  password?: string;
  updatedBy?: string;
}

interface VivaClientsSearchResponse {
  content?: Array<Record<string, unknown>>;
}

interface VivaTokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

interface VivaLookupCacheEntry {
  expiresAt: number;
  value: VivaClientCabinetLookup;
}

interface VivaAccessTokenCacheEntry {
  value: string;
  expiresAt: number;
}

interface VivaAdminSettingsRecord {
  key: string;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  username?: string;
  staticToken?: string;
  password?: string;
  updatedAt?: string;
  updatedBy?: string;
}

@Injectable()
export class VivaAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VivaAdminService.name);
  private readonly mongoUri = String(process.env.MONGODB_URI ?? '').trim();
  private readonly dbName =
    String(
      process.env.VIVA_ADMIN_MONGODB_DB ??
        process.env.MONGODB_DB ??
        DEFAULT_DIALOGS_MONGODB_DB
    ).trim() || DEFAULT_DIALOGS_MONGODB_DB;
  private readonly collectionName =
    String(process.env.VIVA_ADMIN_MONGODB_COLLECTION ?? '').trim() || 'integration_settings';
  private readonly configKey = 'viva_admin';
  private readonly envBaseUrlRaw = String(process.env.VIVA_ADMIN_API_BASE_URL ?? '').trim();
  private readonly envStaticToken = String(process.env.VIVA_ADMIN_API_TOKEN ?? '').trim();
  private readonly envTokenUrlRaw = String(process.env.VIVA_ADMIN_TOKEN_URL ?? '').trim();
  private readonly envClientId =
    String(process.env.VIVA_ADMIN_CLIENT_ID ?? '').trim() || 'React-auth-dev';
  private readonly envUsername = String(process.env.VIVA_ADMIN_USERNAME ?? '').trim();
  private readonly envPassword = String(process.env.VIVA_ADMIN_PASSWORD ?? '').trim();
  private readonly cacheTtlMs = this.readPositiveNumberEnv(
    'VIVA_ADMIN_CACHE_TTL_MS',
    10 * 60 * 1000
  );
  private readonly requestTimeoutMs = this.readPositiveNumberEnv(
    'VIVA_ADMIN_TIMEOUT_MS',
    5000
  );
  private readonly cache = new Map<string, VivaLookupCacheEntry>();
  private readonly inflight = new Map<string, Promise<VivaClientCabinetLookup>>();
  private client?: MongoClient;
  private db?: Db;
  private settingsCache: VivaAdminSettingsRecord | null = null;
  private settingsLoaded = false;
  private tokenCache: VivaAccessTokenCacheEntry | null = null;
  private tokenInflight: Promise<string | null> | null = null;
  private missingConfigLogged = false;

  async onModuleInit(): Promise<void> {
    if (!this.mongoUri) {
      this.logger.log('MONGODB_URI is empty. Viva settings persistence disabled; env mode only.');
      return;
    }

    this.client = new MongoClient(this.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });

    try {
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      await this.ensureIndexes();
      this.logger.log(
        `Viva settings persistence enabled. db=${this.dbName}, collection=${this.collectionName}`
      );
    } catch (error) {
      this.logger.error(`MongoDB connect failed for Viva settings: ${String(error)}`);
      this.db = undefined;
      await this.safeCloseClient();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.safeCloseClient();
  }

  async lookupClientCabinetByPhone(phone?: string): Promise<VivaClientCabinetLookup | null> {
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }

    const cached = this.cache.get(normalizedPhone);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = this.inflight.get(normalizedPhone);
    if (pending) {
      return pending;
    }

    const request = this.fetchClientCabinetByPhone(normalizedPhone)
      .catch((error) => {
        this.logger.warn(
          `Failed to resolve Viva client cabinet url for ${normalizedPhone}: ${String(error)}`
        );
        return { phone: normalizedPhone, status: 'NOT_FOUND' as const };
      })
      .then((result) => {
        this.cache.set(normalizedPhone, {
          expiresAt: Date.now() + this.cacheTtlMs,
          value: result
        });
        return result;
      })
      .finally(() => {
        this.inflight.delete(normalizedPhone);
      });

    this.inflight.set(normalizedPhone, request);
    return request;
  }

  async listExerciseBookings(exerciseId?: string): Promise<Record<string, unknown>[]> {
    const normalizedExerciseId = this.normalizeOptional(exerciseId);
    if (!normalizedExerciseId) {
      return [];
    }

    const token = await this.resolveAccessToken();
    if (!token) {
      return [];
    }

    const resolved = await this.getResolvedSettings();
    const encodedExerciseId = encodeURIComponent(normalizedExerciseId);
    const paths = [
      `/api/v1/exercises/${encodedExerciseId}/bookings?page=0&size=200`,
      `/api/v1/exercises/${encodedExerciseId}/bookings`,
      `/api/v1/group-exercises/${encodedExerciseId}/bookings?page=0&size=200`,
      `/api/v1/group-exercises/${encodedExerciseId}/bookings`,
      `/api/v1/bookings?exerciseId=${encodedExerciseId}&page=0&size=200`,
      `/api/v1/bookings?exercise_id=${encodedExerciseId}&page=0&size=200`
    ];

    const results = await Promise.allSettled(
      paths.map((path) => this.fetchAdminJson(path, token, resolved.config.baseUrl))
    );
    const bookings = results.flatMap((result) =>
      result.status === 'fulfilled' ? this.unwrapRecords(result.value) : []
    );
    const seen = new Set<string>();
    return bookings.filter((booking) => {
      const key = this.buildRecordKey(booking);
      if (!key) {
        return true;
      }
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async getSettings(): Promise<VivaAdminSettingsSnapshot> {
    const resolved = await this.getResolvedSettings();
    return this.toSettingsSnapshot(resolved.config, resolved.source);
  }

  async updateSettings(input: UpdateVivaAdminSettingsInput): Promise<VivaAdminSettingsSnapshot> {
    if (!this.db) {
      throw new InternalServerErrorException(
        'MongoDB is not configured for Viva settings persistence'
      );
    }

    const resolved = await this.getResolvedSettings();
    const nextConfig: VivaAdminSettingsRecord = {
      key: this.configKey,
      baseUrl: this.normalizeBaseUrl(input.baseUrl) || resolved.config.baseUrl,
      tokenUrl: this.normalizeTokenUrl(input.tokenUrl) || resolved.config.tokenUrl,
      clientId: this.normalizeString(input.clientId) || resolved.config.clientId,
      username: this.normalizeOptional(input.username) || resolved.config.username,
      staticToken: resolved.config.staticToken,
      password: resolved.config.password,
      updatedAt: new Date().toISOString(),
      updatedBy: this.normalizeOptional(input.updatedBy) || resolved.config.updatedBy
    };

    const nextStaticToken = this.normalizeOptional(input.staticToken);
    if (typeof input.staticToken === 'string' && nextStaticToken) {
      nextConfig.staticToken = nextStaticToken;
    }

    const nextPassword = this.normalizeOptional(input.password);
    if (typeof input.password === 'string' && nextPassword) {
      nextConfig.password = nextPassword;
    }

    await this.settings().updateOne(
      { key: this.configKey },
      { $set: nextConfig },
      { upsert: true }
    );

    this.settingsCache = nextConfig;
    this.settingsLoaded = true;
    this.tokenCache = null;
    this.tokenInflight = null;
    this.cache.clear();
    this.missingConfigLogged = false;

    return this.toSettingsSnapshot(nextConfig, 'mongo');
  }

  private async fetchClientCabinetByPhone(phone: string): Promise<VivaClientCabinetLookup> {
    const token = await this.resolveAccessToken();
    if (!token) {
      return { phone, status: 'DISABLED' };
    }

    const resolved = await this.getResolvedSettings();
    const url = new URL('/api/v1/clients', `${resolved.config.baseUrl}/`);
    url.searchParams.set('phone', phone);
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '1');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      signal: this.buildAbortSignal()
    });

    if (!response.ok) {
      this.logger.warn(
        `Viva CRM lookup failed for ${phone}: ${response.status} ${response.statusText}`
      );
      return { phone, status: 'NOT_FOUND' };
    }

    const payload = (await response.json().catch(() => null)) as VivaClientsSearchResponse | null;
    const client = this.extractClientRecord(payload);
    const vivaClientId = client ? this.extractClientId(client) : undefined;
    if (!vivaClientId) {
      return { phone, status: 'NOT_FOUND' };
    }

    return {
      phone,
      status: 'FOUND',
      vivaClientId,
      vivaCabinetUrl: `https://cabinet.vivacrm.ru/clients/${encodeURIComponent(vivaClientId)}`,
      displayName: client ? this.extractClientName(client) : undefined,
      avatarUrl: client ? this.extractClientAvatarUrl(client) ?? null : null
    };
  }

  private async fetchAdminJson(
    path: string,
    token: string,
    baseUrl: string
  ): Promise<unknown> {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const response = await fetch(new URL(`/${cleanPath}`, `${baseUrl}/`).toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      signal: this.buildAbortSignal()
    });

    if (!response.ok) {
      throw new Error(`Viva CRM request ${path} failed with status ${response.status}`);
    }

    return response.json().catch(() => null);
  }

  private async resolveAccessToken(): Promise<string | null> {
    const resolved = await this.getResolvedSettings();
    if (resolved.config.staticToken) {
      return resolved.config.staticToken;
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 30_000) {
      return this.tokenCache.value;
    }

    if (this.tokenInflight) {
      return this.tokenInflight;
    }

    if (!this.hasDynamicTokenConfig(resolved.config)) {
      if (!this.missingConfigLogged) {
        this.missingConfigLogged = true;
        this.logger.log(
          'Viva CRM token config is empty. Set static token or password grant credentials in env/settings.'
        );
      }
      return null;
    }

    this.tokenInflight = this.fetchAccessToken(resolved.config)
      .catch((error) => {
        this.logger.warn(`Failed to fetch Viva CRM access token: ${String(error)}`);
        return null;
      })
      .finally(() => {
        this.tokenInflight = null;
      });

    return this.tokenInflight;
  }

  private async fetchAccessToken(config: VivaAdminSettingsRecord): Promise<string | null> {
    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', config.clientId);
    body.set('username', config.username || '');
    body.set('password', config.password || '');

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: body.toString(),
      signal: this.buildAbortSignal()
    });

    if (!response.ok) {
      this.logger.warn(
        `Viva CRM token request failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const payload = (await response.json().catch(() => null)) as VivaTokenResponse | null;
    const accessToken = String(payload?.access_token ?? '').trim();
    if (!accessToken) {
      this.logger.warn('Viva CRM token response does not contain access_token');
      return null;
    }

    const expiresInSeconds = this.parseExpiresInSeconds(payload?.expires_in);
    this.tokenCache = {
      value: accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000
    };
    return accessToken;
  }

  private async getResolvedSettings(): Promise<{
    config: VivaAdminSettingsRecord;
    source: 'mongo' | 'env' | 'defaults';
  }> {
    const envConfig = this.buildEnvConfig();
    const storedConfig = await this.loadStoredConfig();

    if (storedConfig) {
      return {
        config: {
          key: this.configKey,
          baseUrl: storedConfig.baseUrl || envConfig.baseUrl,
          tokenUrl: storedConfig.tokenUrl || envConfig.tokenUrl,
          clientId: storedConfig.clientId || envConfig.clientId,
          username: storedConfig.username || envConfig.username,
          staticToken: storedConfig.staticToken || envConfig.staticToken,
          password: storedConfig.password || envConfig.password,
          updatedAt: storedConfig.updatedAt,
          updatedBy: storedConfig.updatedBy
        },
        source: 'mongo'
      };
    }

    return {
      config: envConfig,
      source: this.hasEnvConfig() ? 'env' : 'defaults'
    };
  }

  private buildEnvConfig(): VivaAdminSettingsRecord {
    return {
      key: this.configKey,
      baseUrl: this.normalizeBaseUrl(this.envBaseUrlRaw) || 'https://api.vivacrm.ru',
      tokenUrl:
        this.normalizeTokenUrl(this.envTokenUrlRaw) ||
        'https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/token',
      clientId: this.normalizeString(this.envClientId) || 'React-auth-dev',
      username: this.normalizeOptional(this.envUsername),
      staticToken: this.normalizeOptional(this.envStaticToken),
      password: this.normalizeOptional(this.envPassword)
    };
  }

  private hasEnvConfig(): boolean {
    return Boolean(
      this.envBaseUrlRaw ||
        this.envStaticToken ||
        this.envTokenUrlRaw ||
        this.envClientId ||
        this.envUsername ||
        this.envPassword
    );
  }

  private async loadStoredConfig(): Promise<VivaAdminSettingsRecord | null> {
    if (!this.db) {
      return null;
    }
    if (this.settingsLoaded) {
      return this.settingsCache;
    }

    const record = await this.settings().findOne(
      { key: this.configKey },
      { projection: { _id: 0 } }
    );
    this.settingsCache = (record as VivaAdminSettingsRecord | null) ?? null;
    this.settingsLoaded = true;
    return this.settingsCache;
  }

  private toSettingsSnapshot(
    config: VivaAdminSettingsRecord,
    source: 'mongo' | 'env' | 'defaults'
  ): VivaAdminSettingsSnapshot {
    return {
      baseUrl: config.baseUrl,
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      username: config.username,
      hasStaticToken: Boolean(config.staticToken),
      hasPassword: Boolean(config.password),
      source,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy
    };
  }

  private hasDynamicTokenConfig(config: VivaAdminSettingsRecord): boolean {
    return Boolean(config.tokenUrl && config.clientId && config.username && config.password);
  }

  private extractClientRecord(
    payload: VivaClientsSearchResponse | null
  ): Record<string, unknown> | undefined {
    if (!payload || !Array.isArray(payload.content) || payload.content.length === 0) {
      return undefined;
    }

    const candidate = payload.content[0];
    if (!candidate || typeof candidate !== 'object') {
      return undefined;
    }

    return candidate;
  }

  private extractClientId(candidate: Record<string, unknown>): string | undefined {
    const id = String(candidate.id ?? '').trim();
    return id || undefined;
  }

  private extractClientName(candidate: Record<string, unknown>): string | undefined {
    const directName =
      this.pickString(candidate.name) ??
      this.pickString(candidate.title) ??
      this.pickString(candidate.fullName) ??
      this.pickString(candidate.full_name) ??
      this.pickString(candidate.displayName) ??
      this.pickString(candidate.display_name);
    if (directName) {
      return directName;
    }

    const firstName = this.pickString(candidate.firstName) ?? this.pickString(candidate.first_name);
    const lastName = this.pickString(candidate.lastName) ?? this.pickString(candidate.last_name);
    return [firstName, lastName].filter(Boolean).join(' ') || undefined;
  }

  private extractClientAvatarUrl(candidate: Record<string, unknown>): string | undefined {
    return (
      this.pickString(candidate.photo) ??
      this.pickString(candidate.avatar) ??
      this.pickString(candidate.avatarUrl) ??
      this.pickString(candidate.avatar_url) ??
      this.pickString(candidate.imageUrl) ??
      this.pickString(candidate.image_url) ??
      this.pickString(candidate.photoUrl) ??
      this.pickString(candidate.photo_url)
    );
  }

  private unwrapRecords(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(this.isRecord);
    }

    const record = this.isRecord(payload) ? payload : null;
    if (!record) {
      return [];
    }

    const keys = [
      'data',
      'result',
      'items',
      'results',
      'content',
      'records',
      'list',
      'bookings',
      'clients',
      'participants',
      'players',
      'members',
      'visitors',
      'guests',
      'registrations'
    ];

    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord);
      }
      if (this.isRecord(value)) {
        const nestedRecords = this.unwrapRecords(value);
        if (nestedRecords.length > 0) {
          return nestedRecords;
        }
      }
    }

    return [];
  }

  private buildRecordKey(record: Record<string, unknown>): string | undefined {
    const directId =
      this.pickString(record.id) ??
      this.pickString(record.uuid) ??
      this.pickString(record.bookingId) ??
      this.pickString(record.booking_id);
    if (directId) {
      return `id:${directId}`;
    }

    const client = this.isRecord(record.client) ? record.client : null;
    const clientId =
      this.pickString(record.clientId) ??
      this.pickString(record.client_id) ??
      (client
        ? this.pickString(client.id) ??
          this.pickString(client.uuid)
        : undefined);
    if (clientId) {
      return `client:${clientId}`;
    }

    const phone =
      this.normalizePhone(record.phone) ??
      this.normalizePhone(record.clientPhone) ??
      this.normalizePhone(record.client_phone) ??
      (client
        ? this.normalizePhone(client.phone) ??
          this.normalizePhone(client.phoneNumber) ??
          this.normalizePhone(client.phone_number)
        : undefined);
    return phone ? `phone:${phone}` : undefined;
  }

  private buildAbortSignal(): AbortSignal | undefined {
    const abortSignalTimeout = (AbortSignal as typeof AbortSignal & {
      timeout?: (delay: number) => AbortSignal;
    }).timeout;

    return typeof abortSignalTimeout === 'function'
      ? abortSignalTimeout(this.requestTimeoutMs)
      : undefined;
  }

  private normalizePhone(phone?: unknown): string | undefined {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) {
      return undefined;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    const normalized = this.normalizeOptional(value);
    return normalized ? normalized.replace(/\/+$/, '') : undefined;
  }

  private normalizeTokenUrl(value?: string): string | undefined {
    return this.normalizeOptional(value);
  }

  private normalizeString(value?: string): string | undefined {
    return this.normalizeOptional(value);
  }

  private normalizeOptional(value?: string): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private pickString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? '');
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.trunc(raw);
  }

  private parseExpiresInSeconds(value: number | string | undefined): number {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 5 * 60;
    }
    return Math.max(60, Math.trunc(parsed));
  }

  private settings(): Collection<VivaAdminSettingsRecord> {
    return this.requireDb().collection<VivaAdminSettingsRecord>(this.collectionName);
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB Viva settings persistence is not enabled');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await this.settings().createIndex({ key: 1 }, { unique: true });
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
