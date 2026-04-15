import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, Db, MongoClient } from 'mongodb';
import { DEFAULT_DIALOGS_MONGODB_DB } from '../common/constants/dialogs-mongo.constants';
import { UpdateCabinetHomeAdvertisingDto } from './dto/update-cabinet-home-advertising.dto';
import {
  AdvertisingAssetRecord,
  CabinetHomeAdvertisingAdRecord,
  CabinetHomeAdvertisingAdminSnapshot,
  CabinetHomeAdvertisingPublicSnapshot,
  CabinetHomeAdvertisingSettingsRecord
} from './advertising.types';

type ParsedDataUrl = {
  mimeType: string;
  body: string;
  size: number;
};

@Injectable()
export class AdvertisingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdvertisingService.name);
  private readonly mongoUri = String(process.env.MONGODB_URI ?? '').trim();
  private readonly dbName =
    String(
      process.env.ADVERTISING_MONGODB_DB ??
        process.env.MONGODB_DB ??
        DEFAULT_DIALOGS_MONGODB_DB
    ).trim() || DEFAULT_DIALOGS_MONGODB_DB;
  private readonly settingsCollectionName =
    String(process.env.ADVERTISING_SETTINGS_COLLECTION ?? '').trim()
    || 'advertising_settings';
  private readonly assetsCollectionName =
    String(process.env.ADVERTISING_ASSETS_COLLECTION ?? '').trim()
    || 'advertising_assets';
  private readonly cabinetHomeKey = 'cabinet_home';
  private readonly maxImageSizeBytes = 2 * 1024 * 1024;
  private client?: MongoClient;
  private db?: Db;
  private cabinetHomeSettings: CabinetHomeAdvertisingSettingsRecord =
    this.createEmptyCabinetHomeSettings();
  private cabinetHomeLoaded = false;
  private readonly assetCache = new Map<string, AdvertisingAssetRecord>();

  async onModuleInit(): Promise<void> {
    if (!this.mongoUri) {
      this.logger.log('MONGODB_URI is empty. Advertising settings use in-memory mode.');
      this.cabinetHomeLoaded = true;
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
      await this.hydrateCabinetHomeSettings();
      this.logger.log(
        `Advertising settings persistence enabled. db=${this.dbName}, settings=${this.settingsCollectionName}, assets=${this.assetsCollectionName}`
      );
    } catch (error) {
      this.logger.error(`MongoDB connect failed for advertising settings: ${String(error)}`);
      this.db = undefined;
      this.cabinetHomeLoaded = true;
      await this.safeCloseClient();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.safeCloseClient();
  }

  async getCabinetHomeAdminSnapshot(baseUrl: string): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    const settings = await this.ensureCabinetHomeSettingsLoaded();
    return this.toAdminSnapshot(settings, baseUrl);
  }

  async getCabinetHomePublicSnapshot(
    baseUrl: string
  ): Promise<CabinetHomeAdvertisingPublicSnapshot> {
    const settings = await this.ensureCabinetHomeSettingsLoaded();
    return this.toPublicSnapshot(settings, baseUrl);
  }

  async updateCabinetHomeSettings(
    input: UpdateCabinetHomeAdvertisingDto,
    updatedBy: string | undefined,
    baseUrl: string
  ): Promise<CabinetHomeAdvertisingAdminSnapshot> {
    const current = await this.ensureCabinetHomeSettingsLoaded();
    const currentAdsById = new Map(current.ads.map((ad) => [ad.id, ad]));
    const now = new Date().toISOString();
    const nextAds: CabinetHomeAdvertisingAdRecord[] = [];

    for (const [index, rawAd] of input.ads.entries()) {
      const existingId = this.normalizeOptional(rawAd.id);
      const existing = existingId ? currentAdsById.get(existingId) : undefined;
      const resolvedId = existing?.id ?? existingId ?? randomUUID();
      const href = this.normalizeHref(rawAd.href);
      const title = this.normalizeOptional(rawAd.title) ?? existing?.title;
      const isActive =
        typeof rawAd.isActive === 'boolean' ? rawAd.isActive : existing?.isActive ?? true;

      let imageAssetId =
        this.normalizeOptional(rawAd.imageAssetId) ?? existing?.imageAssetId;
      const imageDataUrl = this.normalizeOptional(rawAd.imageDataUrl);
      if (imageDataUrl) {
        const asset = this.createAssetRecord(
          imageDataUrl,
          now,
          title || resolvedId
        );
        await this.persistAsset(asset);
        imageAssetId = asset.id;
      }

      if (!imageAssetId) {
        throw new BadRequestException(
          `Advertisement image is required for item #${index + 1}`
        );
      }

      nextAds.push({
        id: resolvedId,
        title,
        href,
        imageAssetId,
        isActive,
        position: index,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    }

    const nextSettings: CabinetHomeAdvertisingSettingsRecord = {
      key: this.cabinetHomeKey,
      rotationEnabled: input.rotationEnabled === true,
      ads: nextAds,
      updatedAt: now,
      updatedBy: this.normalizeOptional(updatedBy) ?? current.updatedBy
    };

    this.cabinetHomeSettings = nextSettings;
    this.cabinetHomeLoaded = true;
    await this.persistCabinetHomeSettings(nextSettings);
    return this.toAdminSnapshot(nextSettings, baseUrl);
  }

  async getAsset(assetId: string): Promise<AdvertisingAssetRecord | null> {
    const normalizedAssetId = this.normalizeOptional(assetId);
    if (!normalizedAssetId) {
      return null;
    }

    const cached = this.assetCache.get(normalizedAssetId);
    if (cached) {
      return cached;
    }

    if (!this.db) {
      return null;
    }

    const record = await this.assets().findOne(
      { id: normalizedAssetId },
      { projection: { _id: 0 } }
    );
    if (!record) {
      return null;
    }

    const normalized = record as AdvertisingAssetRecord;
    this.assetCache.set(normalized.id, normalized);
    return normalized;
  }

  private async hydrateCabinetHomeSettings(): Promise<void> {
    if (!this.db) {
      this.cabinetHomeLoaded = true;
      return;
    }

    const record = await this.settings().findOne(
      { key: this.cabinetHomeKey },
      { projection: { _id: 0 } }
    );
    this.cabinetHomeSettings = this.normalizeSettingsRecord(
      (record as CabinetHomeAdvertisingSettingsRecord | null) ?? null
    );
    this.cabinetHomeLoaded = true;
  }

  private async ensureCabinetHomeSettingsLoaded(): Promise<CabinetHomeAdvertisingSettingsRecord> {
    if (!this.cabinetHomeLoaded) {
      await this.hydrateCabinetHomeSettings();
    }
    return this.cabinetHomeSettings;
  }

  private toAdminSnapshot(
    settings: CabinetHomeAdvertisingSettingsRecord,
    baseUrl: string
  ): CabinetHomeAdvertisingAdminSnapshot {
    return {
      placement: 'cabinet_home',
      rotationEnabled: settings.rotationEnabled === true,
      ads: settings.ads
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((ad) => ({
          id: ad.id,
          title: ad.title,
          href: ad.href,
          imageAssetId: ad.imageAssetId,
          imageUrl: this.buildAssetUrl(ad.imageAssetId, baseUrl),
          isActive: ad.isActive === true,
          position: ad.position,
          createdAt: ad.createdAt,
          updatedAt: ad.updatedAt
        })),
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy
    };
  }

  private toPublicSnapshot(
    settings: CabinetHomeAdvertisingSettingsRecord,
    baseUrl: string
  ): CabinetHomeAdvertisingPublicSnapshot {
    return {
      placement: 'cabinet_home',
      rotationEnabled: settings.rotationEnabled === true,
      ads: settings.ads
        .slice()
        .sort((left, right) => left.position - right.position)
        .filter((ad) => ad.isActive === true && Boolean(ad.imageAssetId) && Boolean(ad.href))
        .map((ad) => ({
          id: ad.id,
          title: ad.title,
          href: ad.href,
          imageUrl: this.buildAssetUrl(ad.imageAssetId, baseUrl)
        })),
      updatedAt: settings.updatedAt
    };
  }

  private normalizeSettingsRecord(
    record: CabinetHomeAdvertisingSettingsRecord | null
  ): CabinetHomeAdvertisingSettingsRecord {
    if (!record) {
      return this.createEmptyCabinetHomeSettings();
    }

    return {
      key: this.cabinetHomeKey,
      rotationEnabled: record.rotationEnabled === true,
      ads: Array.isArray(record.ads)
        ? record.ads
            .map((ad, index) => ({
              id: this.normalizeOptional(ad.id) ?? randomUUID(),
              title: this.normalizeOptional(ad.title),
              href: this.normalizeOptional(ad.href) ?? '',
              imageAssetId: this.normalizeOptional(ad.imageAssetId) ?? '',
              isActive: ad.isActive === true,
              position:
                Number.isFinite(Number(ad.position)) && Number(ad.position) >= 0
                  ? Math.floor(Number(ad.position))
                  : index,
              createdAt: this.normalizeOptional(ad.createdAt) ?? record.updatedAt ?? new Date().toISOString(),
              updatedAt: this.normalizeOptional(ad.updatedAt) ?? record.updatedAt ?? new Date().toISOString()
            }))
            .filter((ad) => Boolean(ad.href) && Boolean(ad.imageAssetId))
            .sort((left, right) => left.position - right.position)
        : [],
      updatedAt: this.normalizeOptional(record.updatedAt),
      updatedBy: this.normalizeOptional(record.updatedBy)
    };
  }

  private createEmptyCabinetHomeSettings(): CabinetHomeAdvertisingSettingsRecord {
    return {
      key: this.cabinetHomeKey,
      rotationEnabled: false,
      ads: []
    };
  }

  private createAssetRecord(
    imageDataUrl: string,
    now: string,
    originalName: string
  ): AdvertisingAssetRecord {
    const parsed = this.parseDataUrl(imageDataUrl);
    return {
      id: randomUUID(),
      kind: 'cabinet_home_ad',
      mimeType: parsed.mimeType,
      body: parsed.body,
      size: parsed.size,
      createdAt: now,
      updatedAt: now,
      originalName: this.normalizeOptional(originalName)
    };
  }

  private parseDataUrl(value: string): ParsedDataUrl {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
    if (!match) {
      throw new BadRequestException('Advertisement image must be a valid base64 data URL');
    }

    const mimeType = String(match[1] ?? '').trim().toLowerCase();
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mimeType)) {
      throw new BadRequestException('Advertisement image must be webp, png or jpeg');
    }

    const body = String(match[2] ?? '').trim();
    if (!body) {
      throw new BadRequestException('Advertisement image payload is empty');
    }

    const size = Buffer.from(body, 'base64').length;
    if (!size) {
      throw new BadRequestException('Advertisement image payload is empty');
    }
    if (size > this.maxImageSizeBytes) {
      throw new BadRequestException(
        `Advertisement image is too large. Maximum ${this.maxImageSizeBytes} bytes`
      );
    }

    return { mimeType, body, size };
  }

  private normalizeHref(value: string | undefined): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      throw new BadRequestException('Advertisement link is required');
    }
    if (/^javascript:/i.test(normalized)) {
      throw new BadRequestException('Advertisement link uses unsupported protocol');
    }
    if (/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(normalized)) {
      return normalized;
    }
    throw new BadRequestException(
      'Advertisement link must be absolute http(s), mailto, tel or relative path'
    );
  }

  private buildAssetUrl(assetId: string, baseUrl: string): string {
    const normalizedBaseUrl = String(baseUrl ?? '').trim().replace(/\/+$/g, '');
    const path = `/api/advertising/assets/${encodeURIComponent(assetId)}`;
    if (!normalizedBaseUrl) {
      return path;
    }
    return new URL(path, `${normalizedBaseUrl}/`).toString();
  }

  private normalizeOptional(value: string | undefined | null): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : undefined;
  }

  private async persistCabinetHomeSettings(
    settings: CabinetHomeAdvertisingSettingsRecord
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.settings().updateOne(
      { key: this.cabinetHomeKey },
      { $set: settings },
      { upsert: true }
    );
  }

  private async persistAsset(asset: AdvertisingAssetRecord): Promise<void> {
    this.assetCache.set(asset.id, asset);
    if (!this.db) {
      return;
    }

    await this.assets().updateOne({ id: asset.id }, { $set: asset }, { upsert: true });
  }

  private settings(): Collection<CabinetHomeAdvertisingSettingsRecord> {
    return this.requireDb().collection<CabinetHomeAdvertisingSettingsRecord>(
      this.settingsCollectionName
    );
  }

  private assets(): Collection<AdvertisingAssetRecord> {
    return this.requireDb().collection<AdvertisingAssetRecord>(this.assetsCollectionName);
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('MongoDB is not initialized');
    }
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.settings().createIndex({ key: 1 }, { unique: true }),
      this.assets().createIndex({ id: 1 }, { unique: true }),
      this.assets().createIndex({ kind: 1, updatedAt: -1 })
    ]);
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
