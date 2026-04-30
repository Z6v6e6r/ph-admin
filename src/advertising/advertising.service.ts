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
  UpdateSplitPaymentPromoCampaignDto,
  UpdateSplitPaymentPromoDto
} from './dto/update-split-payment-promo.dto';
import {
  AdvertisingAssetRecord,
  CabinetHomeAdvertisingAdRecord,
  CabinetHomeAdvertisingAdminSnapshot,
  CabinetHomeAdvertisingPublicSnapshot,
  CabinetHomeAdvertisingSettingsRecord,
  SplitPaymentPromoCampaignRecord,
  SplitPaymentPromoAdminSnapshot,
  SplitPaymentPromoMatchContext,
  SplitPaymentPromoPublicSnapshot,
  SplitPaymentPromoSettingsRecord
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
  private readonly splitPaymentPromoKey = 'split_payment_promo';
  private readonly maxImageSizeBytes = 2 * 1024 * 1024;
  private client?: MongoClient;
  private db?: Db;
  private cabinetHomeSettings: CabinetHomeAdvertisingSettingsRecord =
    this.createEmptyCabinetHomeSettings();
  private cabinetHomeLoaded = false;
  private splitPaymentPromoSettings: SplitPaymentPromoSettingsRecord =
    this.createDefaultSplitPaymentPromoSettings();
  private splitPaymentPromoLoaded = false;
  private readonly assetCache = new Map<string, AdvertisingAssetRecord>();

  async onModuleInit(): Promise<void> {
    if (!this.mongoUri) {
      this.logger.log('MONGODB_URI is empty. Advertising settings use in-memory mode.');
      this.cabinetHomeLoaded = true;
      this.splitPaymentPromoLoaded = true;
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
      await this.hydrateSplitPaymentPromoSettings();
      this.logger.log(
        `Advertising settings persistence enabled. db=${this.dbName}, settings=${this.settingsCollectionName}, assets=${this.assetsCollectionName}`
      );
    } catch (error) {
      this.logger.error(`MongoDB connect failed for advertising settings: ${String(error)}`);
      this.db = undefined;
      this.cabinetHomeLoaded = true;
      this.splitPaymentPromoLoaded = true;
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

  async getSplitPaymentPromoAdminSnapshot(): Promise<SplitPaymentPromoAdminSnapshot> {
    const settings = await this.ensureSplitPaymentPromoSettingsLoaded();
    return this.toSplitPaymentPromoAdminSnapshot(settings);
  }

  async getSplitPaymentPromoPublicSnapshot(
    forDate?: string,
    context?: SplitPaymentPromoMatchContext
  ): Promise<SplitPaymentPromoPublicSnapshot> {
    const settings = await this.ensureSplitPaymentPromoSettingsLoaded();
    return this.toSplitPaymentPromoPublicSnapshot(settings, forDate, context);
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

  async updateSplitPaymentPromoSettings(
    input: UpdateSplitPaymentPromoDto,
    updatedBy: string | undefined
  ): Promise<SplitPaymentPromoAdminSnapshot> {
    const current = await this.ensureSplitPaymentPromoSettingsLoaded();
    const now = new Date().toISOString();
    const inputPromos = Array.isArray(input.promos) && input.promos.length > 0
      ? input.promos.slice(0, 2)
      : [input];
    const currentPromos = this.resolveSplitPaymentPromoCampaigns(current);
    const promos = inputPromos.map((promo, index) =>
      this.normalizeSplitPaymentPromoCampaignInput(
        promo,
        currentPromos[index] ?? currentPromos[0],
        index
      )
    );

    for (const promo of promos) {
      if (promo.stationIds.length === 0 && promo.stationNameIncludes.length === 0) {
        if (promo.enabled === true) {
          throw new BadRequestException(
            `Station restriction is required for ${promo.title.toLowerCase()}`
          );
        }
      }
    }

    const primaryPromo = promos[0] ?? currentPromos[0];
    const nextSettings: SplitPaymentPromoSettingsRecord = {
      key: this.splitPaymentPromoKey,
      ...this.toSplitPaymentPromoLegacyFields(primaryPromo),
      promos,
      updatedAt: now,
      updatedBy: this.normalizeOptional(updatedBy) ?? current.updatedBy
    };

    this.splitPaymentPromoSettings = nextSettings;
    this.splitPaymentPromoLoaded = true;
    await this.persistSplitPaymentPromoSettings(nextSettings);
    return this.toSplitPaymentPromoAdminSnapshot(nextSettings);
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

  private async hydrateSplitPaymentPromoSettings(): Promise<void> {
    if (!this.db) {
      this.splitPaymentPromoLoaded = true;
      return;
    }

    const record = await this.settings().findOne(
      { key: this.splitPaymentPromoKey },
      { projection: { _id: 0 } }
    );
    this.splitPaymentPromoSettings = this.normalizeSplitPaymentPromoSettingsRecord(
      (record as SplitPaymentPromoSettingsRecord | null) ?? null
    );
    this.splitPaymentPromoLoaded = true;
  }

  private async ensureCabinetHomeSettingsLoaded(): Promise<CabinetHomeAdvertisingSettingsRecord> {
    if (!this.cabinetHomeLoaded) {
      await this.hydrateCabinetHomeSettings();
    }
    return this.cabinetHomeSettings;
  }

  private async ensureSplitPaymentPromoSettingsLoaded(): Promise<SplitPaymentPromoSettingsRecord> {
    if (!this.splitPaymentPromoLoaded) {
      await this.hydrateSplitPaymentPromoSettings();
    }
    return this.splitPaymentPromoSettings;
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

  private toSplitPaymentPromoAdminSnapshot(
    settings: SplitPaymentPromoSettingsRecord
  ): SplitPaymentPromoAdminSnapshot {
    const promos = this.resolveSplitPaymentPromoCampaigns(settings);
    const primaryPromo = promos[0];
    return {
      ...this.toSplitPaymentPromoLegacyFields(primaryPromo),
      promos,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy
    };
  }

  private toSplitPaymentPromoPublicSnapshot(
    settings: SplitPaymentPromoSettingsRecord,
    forDate?: string,
    context?: SplitPaymentPromoMatchContext
  ): SplitPaymentPromoPublicSnapshot {
    const promos = this.resolveSplitPaymentPromoCampaigns(settings).map((promo) => ({
      ...promo,
      enabled: this.isSplitPaymentPromoActive(promo, forDate)
    }));
    const primaryPromo = this.selectSplitPaymentPromoCampaign(promos, context) ?? promos[0];
    return {
      ...this.toSplitPaymentPromoLegacyFields(primaryPromo),
      promos,
      updatedAt: settings.updatedAt
    };
  }

  private isSplitPaymentPromoActive(
    settings: SplitPaymentPromoCampaignRecord | SplitPaymentPromoSettingsRecord,
    forDate?: string
  ): boolean {
    if (settings.enabled !== true) {
      return false;
    }
    if (!settings.expiresAt) {
      return true;
    }
    const expiresAtMs = new Date(settings.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) {
      return true;
    }
    const referenceMs = this.resolveReferenceTimeMs(forDate);
    return referenceMs <= expiresAtMs;
  }

  private selectSplitPaymentPromoCampaign(
    promos: SplitPaymentPromoCampaignRecord[],
    context?: SplitPaymentPromoMatchContext
  ): SplitPaymentPromoCampaignRecord | undefined {
    const normalizedContext = {
      stationId: this.normalizeMatchValue(context?.stationId),
      stationName: this.normalizeMatchValue(context?.stationName),
      roomId: this.normalizeMatchValue(context?.roomId),
      roomName: this.normalizeMatchValue(context?.roomName)
    };
    const hasContext = Object.values(normalizedContext).some(Boolean);
    if (!hasContext) {
      return undefined;
    }

    return promos.find((promo) =>
      promo.enabled === true
      && this.matchesSplitPaymentPromoStation(promo, normalizedContext)
      && this.matchesSplitPaymentPromoRoom(promo, normalizedContext)
    );
  }

  private matchesSplitPaymentPromoStation(
    promo: SplitPaymentPromoCampaignRecord,
    context: { stationId?: string; stationName?: string }
  ): boolean {
    const stationIds = this.normalizeMatchList(promo.stationIds);
    const stationNameIncludes = this.normalizeMatchList(promo.stationNameIncludes);
    if (stationIds.length === 0 && stationNameIncludes.length === 0) {
      return true;
    }

    if (context.stationId && stationIds.includes(context.stationId)) {
      return true;
    }
    if (context.stationName) {
      return stationNameIncludes.some((candidate) => context.stationName?.includes(candidate));
    }
    return false;
  }

  private matchesSplitPaymentPromoRoom(
    promo: SplitPaymentPromoCampaignRecord,
    context: { roomId?: string; roomName?: string }
  ): boolean {
    const roomIds = this.normalizeMatchList(promo.roomIds);
    const roomNameIncludes = this.normalizeMatchList(promo.roomNameIncludes);
    if (roomIds.length === 0 && roomNameIncludes.length === 0) {
      return true;
    }

    if (context.roomId && roomIds.includes(context.roomId)) {
      return true;
    }
    if (context.roomName) {
      return roomNameIncludes.some((candidate) => context.roomName?.includes(candidate));
    }
    return false;
  }

  private resolveReferenceTimeMs(forDate?: string): number {
    const normalized = String(forDate ?? '').trim();
    if (!normalized) {
      return Date.now();
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return Date.now();
    }
    return parsed.getTime();
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

  private createDefaultSplitPaymentPromoSettings(): SplitPaymentPromoSettingsRecord {
    const primaryPromo = this.createDefaultSplitPaymentPromoCampaign(0);
    const secondaryPromo = this.createDefaultSplitPaymentPromoCampaign(1);
    return {
      key: this.splitPaymentPromoKey,
      ...this.toSplitPaymentPromoLegacyFields(primaryPromo),
      promos: [primaryPromo, secondaryPromo]
    };
  }

  private createDefaultSplitPaymentPromoCampaign(index: number): SplitPaymentPromoCampaignRecord {
    if (index === 1) {
      return {
        id: 'promo-2',
        title: 'Акция 2',
        enabled: false,
        expiresAt: undefined,
        stationIds: [],
        stationNameIncludes: [],
        roomIds: [],
        roomNameIncludes: [],
        shareAmounts: {
          twoTeams: 0,
          fourPlayers: 0
        },
        baseShareAmount: 2000,
        vivaDirectionId: 4485,
        vivaExerciseTypeId: 1208
      };
    }

    return {
      id: 'promo-1',
      title: 'Акция 1',
      enabled: true,
      expiresAt: undefined,
      stationIds: ['6a7a9edc-6869-40ad-a5a1-8a1cdfb746a1'],
      stationNameIncludes: ['терехово', 'terekhovo'],
      roomIds: [],
      roomNameIncludes: ['new'],
      shareAmounts: {
        twoTeams: 500,
        fourPlayers: 250
      },
      baseShareAmount: 2000,
      vivaDirectionId: 4485,
      vivaExerciseTypeId: 1208
    };
  }

  private normalizeSplitPaymentPromoSettingsRecord(
    record: SplitPaymentPromoSettingsRecord | null
  ): SplitPaymentPromoSettingsRecord {
    const defaults = this.createDefaultSplitPaymentPromoSettings();
    if (!record) {
      return defaults;
    }

    const promos = Array.isArray(record.promos) && record.promos.length > 0
      ? record.promos.slice(0, 2).map((promo, index) =>
          this.normalizeSplitPaymentPromoCampaignRecord(
            promo,
            defaults.promos[index] ?? defaults.promos[0],
            index
          )
        )
      : [
          this.normalizeSplitPaymentPromoCampaignRecord(
            {
              id: 'promo-1',
              title: 'Акция 1',
              enabled: record.enabled,
              expiresAt: record.expiresAt,
              stationIds: record.stationIds,
              stationNameIncludes: record.stationNameIncludes,
              roomIds: record.roomIds,
              roomNameIncludes: record.roomNameIncludes,
              shareAmounts: record.shareAmounts,
              baseShareAmount: record.baseShareAmount,
              vivaDirectionId: record.vivaDirectionId,
              vivaExerciseTypeId: record.vivaExerciseTypeId
            },
            defaults.promos[0],
            0
          ),
          defaults.promos[1]
        ];
    while (promos.length < 2) {
      promos.push(defaults.promos[promos.length] ?? defaults.promos[0]);
    }
    const primaryPromo = promos[0] ?? defaults.promos[0];

    return {
      key: this.splitPaymentPromoKey,
      ...this.toSplitPaymentPromoLegacyFields(primaryPromo),
      promos,
      updatedAt: this.normalizeOptional(record.updatedAt),
      updatedBy: this.normalizeOptional(record.updatedBy)
    };
  }

  private normalizeSplitPaymentPromoCampaignRecord(
    record: Partial<SplitPaymentPromoCampaignRecord>,
    fallback: SplitPaymentPromoCampaignRecord,
    index: number
  ): SplitPaymentPromoCampaignRecord {
    const shareAmounts = record.shareAmounts ?? fallback.shareAmounts;
    return {
      id: this.normalizeOptional(record.id) ?? fallback.id ?? `promo-${index + 1}`,
      title: this.normalizeOptional(record.title) ?? fallback.title ?? `Акция ${index + 1}`,
      enabled: record.enabled === true || (record.enabled === undefined && fallback.enabled === true),
      expiresAt: this.normalizeOptionalDateTime(record.expiresAt),
      stationIds: this.normalizeStringList(record.stationIds, fallback.stationIds),
      stationNameIncludes: this.normalizeStringList(
        record.stationNameIncludes,
        fallback.stationNameIncludes
      ),
      roomIds: this.normalizeStringList(record.roomIds, fallback.roomIds),
      roomNameIncludes: this.normalizeStringList(
        record.roomNameIncludes,
        fallback.roomNameIncludes
      ),
      shareAmounts: {
        twoTeams: this.normalizeMoney(shareAmounts.twoTeams, fallback.shareAmounts.twoTeams),
        fourPlayers: this.normalizeMoney(
          shareAmounts.fourPlayers,
          fallback.shareAmounts.fourPlayers
        )
      },
      baseShareAmount: this.normalizeMoney(record.baseShareAmount, fallback.baseShareAmount),
      vivaDirectionId: this.normalizePositiveInteger(
        record.vivaDirectionId,
        fallback.vivaDirectionId
      ),
      vivaExerciseTypeId: this.normalizePositiveInteger(
        record.vivaExerciseTypeId,
        fallback.vivaExerciseTypeId
      )
    };
  }

  private normalizeSplitPaymentPromoCampaignInput(
    input: UpdateSplitPaymentPromoCampaignDto,
    fallback: SplitPaymentPromoCampaignRecord,
    index: number
  ): SplitPaymentPromoCampaignRecord {
    return {
      id: this.normalizeOptional(input.id) ?? fallback.id ?? `promo-${index + 1}`,
      title: this.normalizeOptional(input.title) ?? fallback.title ?? `Акция ${index + 1}`,
      enabled: input.enabled === true,
      expiresAt: this.normalizeOptionalDateTime(input.expiresAt),
      stationIds: this.normalizeStringList(input.stationIds),
      stationNameIncludes: this.normalizeStringList(input.stationNameIncludes),
      roomIds: this.normalizeStringList(input.roomIds),
      roomNameIncludes: this.normalizeStringList(input.roomNameIncludes),
      shareAmounts: {
        twoTeams: this.normalizeMoney(input.shareAmounts?.twoTeams, fallback.shareAmounts.twoTeams),
        fourPlayers: this.normalizeMoney(
          input.shareAmounts?.fourPlayers,
          fallback.shareAmounts.fourPlayers
        )
      },
      baseShareAmount: this.normalizeMoney(input.baseShareAmount, fallback.baseShareAmount),
      vivaDirectionId: this.normalizePositiveInteger(input.vivaDirectionId, fallback.vivaDirectionId),
      vivaExerciseTypeId: this.normalizePositiveInteger(
        input.vivaExerciseTypeId,
        fallback.vivaExerciseTypeId
      )
    };
  }

  private resolveSplitPaymentPromoCampaigns(
    settings: SplitPaymentPromoSettingsRecord
  ): SplitPaymentPromoCampaignRecord[] {
    if (Array.isArray(settings.promos) && settings.promos.length > 0) {
      const defaults = this.createDefaultSplitPaymentPromoSettings();
      const promos = settings.promos.slice(0, 2);
      while (promos.length < 2) {
        promos.push(defaults.promos[promos.length] ?? defaults.promos[0]);
      }
      return promos;
    }
    const defaults = this.createDefaultSplitPaymentPromoSettings();
    return [
      this.normalizeSplitPaymentPromoCampaignRecord(
        {
          id: 'promo-1',
          title: 'Акция 1',
          enabled: settings.enabled,
          expiresAt: settings.expiresAt,
          stationIds: settings.stationIds,
          stationNameIncludes: settings.stationNameIncludes,
          roomIds: settings.roomIds,
          roomNameIncludes: settings.roomNameIncludes,
          shareAmounts: settings.shareAmounts,
          baseShareAmount: settings.baseShareAmount,
          vivaDirectionId: settings.vivaDirectionId,
          vivaExerciseTypeId: settings.vivaExerciseTypeId
        },
        defaults.promos[0],
        0
      ),
      defaults.promos[1]
    ];
  }

  private toSplitPaymentPromoLegacyFields(
    promo: SplitPaymentPromoCampaignRecord
  ): Omit<SplitPaymentPromoCampaignRecord, 'id' | 'title'> {
    return {
      enabled: promo.enabled === true,
      expiresAt: promo.expiresAt,
      stationIds: promo.stationIds,
      stationNameIncludes: promo.stationNameIncludes,
      roomIds: promo.roomIds,
      roomNameIncludes: promo.roomNameIncludes,
      shareAmounts: promo.shareAmounts,
      baseShareAmount: promo.baseShareAmount,
      vivaDirectionId: promo.vivaDirectionId,
      vivaExerciseTypeId: promo.vivaExerciseTypeId
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

  private normalizeMatchValue(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized ? normalized : undefined;
  }

  private normalizeMatchList(value: unknown): string[] {
    return this.normalizeStringList(value).map((item) => item.toLowerCase());
  }

  private normalizeStringList(value: unknown, fallback: string[] = []): string[] {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const normalized = Array.from(
      new Set(
        rawItems
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0)
      )
    );
    return normalized.length > 0 ? normalized : fallback.slice();
  }

  private normalizeMoney(value: unknown, fallback: number): number {
    const parsed = Number(String(value ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.round(parsed);
  }

  private normalizeOptionalDateTime(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return undefined;
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private async persistCabinetHomeSettings(
    settings: CabinetHomeAdvertisingSettingsRecord
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.settings().updateOne(
      { key: this.cabinetHomeKey },
      { $set: settings as unknown as Record<string, unknown> },
      { upsert: true }
    );
  }

  private async persistSplitPaymentPromoSettings(
    settings: SplitPaymentPromoSettingsRecord
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.settings().updateOne(
      { key: this.splitPaymentPromoKey },
      { $set: settings as unknown as Record<string, unknown> },
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

  private settings(): Collection<Record<string, unknown>> {
    return this.requireDb().collection<Record<string, unknown>>(this.settingsCollectionName);
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
