import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AuthPersistenceService } from '../auth/auth-persistence.service';
import {
  getStationScopeForPermission,
  hasAdminPermission
} from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { MessengerService } from '../messenger/messenger.service';
import { generateQrLinkCode, isQrLinkCode } from './qr-link-code';
import { QrCodeImageService } from './qr-code-image.service';
import { QrLinksRepository } from './qr-links.repository';
import {
  QrAllowedHostsView,
  QrHistoryEntry,
  QrHistoryResponse,
  QrLinkAnalytics,
  QrLinkListItem,
  QrLinkListResponse,
  QrLinkStatus,
  QrLinkStatusFilter,
  QrLinkTotals,
  QrLinkView,
  QrListQuery,
  QrPeriod,
  QrPublicResolution,
  QrStationOption,
  StoredQrAllowedHostsSettings,
  StoredQrLink,
  QR_ALLOWED_HOSTS_KEY
} from './qr-links.types';
import { normalizeAllowedHosts } from './qr-allowed-hosts';
import { UpdateAllowedHostsDto } from './dto/update-allowed-hosts.dto';
import { QrTargetUrlPolicy } from './qr-target-url-policy';
import { CreateQrLinkDto } from './dto/create-qr-link.dto';
import { UpdateQrLinkDto } from './dto/update-qr-link.dto';

export const QR_LINKS_TIMEZONE = 'Europe/Moscow';
const MAX_PERIOD_DAYS = 366;
const DEFAULT_PERIOD_DAYS = 30;
const CODE_GENERATION_ATTEMPTS = 5;
const AUDIT_VALUE_LIMIT = 500;
const QR_ZAVIDOVO_STATION: QrStationOption = {
  stationId: 'Zavidovo', stationName: 'Завидово', isActive: true
};

const PREVIEW_BOT_MARKERS = [
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'slack-imgproxy',
  'telegrambot',
  'whatsapp',
  'discordbot',
  'skypeuripreview',
  'pinterestbot',
  'embedly',
  'quora link preview',
  'vkshare',
  'redditbot',
  'mastodon',
  'bluesky cardyb',
  'iframely'
];

export interface PublicRequestInfo {
  method: string;
  userAgent?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface CreateQrLinkResult {
  item: QrLinkView;
  replayed: boolean;
}

export interface QrImagePayload {
  buffer: Buffer | string;
  contentType: string;
  filename: string;
}

export const QR_TARGET_URL_POLICY = Symbol('QR_TARGET_URL_POLICY');
export const QR_CODE_GENERATOR = Symbol('QR_CODE_GENERATOR');
export const QR_CLOCK = Symbol('QR_CLOCK');

interface ResolvedPeriod extends QrPeriod {
  fromKey: string;
  toKey: string;
}

@Injectable()
export class QrLinksService {
  private readonly logger = new Logger(QrLinksService.name);
  private readonly policy: QrTargetUrlPolicy;
  private readonly statsWriteTimeoutMs: number;
  private readonly allowedHostsCacheTtlMs: number;
  private readonly codeGenerator: () => string;
  private readonly clock: () => Date;
  private statsFailureCount = 0;
  private allowedHostsCache?: { hosts: string[]; at: number };

  constructor(
    private readonly repository: QrLinksRepository,
    private readonly imageService: QrCodeImageService,
    private readonly authPersistence: AuthPersistenceService,
    private readonly messenger: MessengerService,
    @Optional() @Inject(QR_TARGET_URL_POLICY) policy?: QrTargetUrlPolicy,
    @Optional() @Inject(QR_CODE_GENERATOR) codeGenerator?: () => string,
    @Optional() @Inject(QR_CLOCK) clock?: () => Date
  ) {
    this.policy = policy ?? new QrTargetUrlPolicy();
    this.codeGenerator = codeGenerator ?? generateQrLinkCode;
    this.clock = clock ?? (() => new Date());
    this.statsWriteTimeoutMs = this.readTimeout(
      process.env.QR_LINKS_STATS_WRITE_TIMEOUT_MS,
      750
    );
    this.allowedHostsCacheTtlMs = this.readTimeout(
      process.env.QR_LINKS_ALLOWED_HOSTS_CACHE_TTL_MS,
      5000
    );
  }

  async create(
    dto: CreateQrLinkDto,
    command: { idempotencyKey?: string },
    user?: RequestUser
  ): Promise<CreateQrLinkResult> {
    const actorId = this.requireActor(user);
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    this.assertCodeIsImmutable(dto as unknown as Record<string, unknown>);
    const targetUrl = (await this.targetPolicy()).validate(dto.targetUrl);
    const name = this.requireName(dto.name);
    const station = this.resolveStationForWrite(user, dto.stationId ?? null);
    const placement = this.optionalString(dto.placement);
    const description = this.optionalString(dto.description);
    const status: QrLinkStatus = dto.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
    const intentHash = createHash('sha256')
      .update(JSON.stringify({
        name,
        stationId: station.stationId,
        placement: placement ?? null,
        description: description ?? null,
        targetUrl,
        status
      }))
      .digest('hex');

    const replay = await this.repository.findByIdempotency(actorId, idempotencyKey);
    if (replay) {
      if (replay.idempotency?.intentHash !== intentHash) {
        throw new ConflictException({
          code: 'QR_LINK_IDEMPOTENCY_CONFLICT',
          message: 'Idempotency-Key уже использован для другого QR-кода.'
        });
      }
      return { item: this.toView(replay), replayed: true };
    }

    const now = this.clock().toISOString();
    for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = this.codeGenerator();
      const link: StoredQrLink = {
        id: randomUUID(),
        code,
        name,
        stationId: station.stationId,
        stationName: station.stationName,
        placement: placement ?? null,
        description: description ?? null,
        targetUrl,
        status,
        version: 1,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        idempotency: { actorId, key: idempotencyKey, intentHash }
      };
      try {
        await this.repository.insertLink(link);
        await this.appendAudit({
          action: 'CREATE QR_LINK',
          user,
          targetId: link.id,
          targetLabel: link.name,
          metadata: {
            code: link.code,
            name: link.name,
            stationId: link.stationId ?? null,
            targetUrl: link.targetUrl,
            status: link.status
          }
        });
        return { item: this.toView(link), replayed: false };
      } catch (error) {
        if (!this.repository.isDuplicateKey(error)) throw error;
        const fields = this.repository.duplicateKeyFields(error);
        if (fields.includes('code')) continue;
        const concurrent = await this.repository.findByIdempotency(actorId, idempotencyKey);
        if (concurrent?.idempotency?.intentHash === intentHash) {
          return { item: this.toView(concurrent), replayed: true };
        }
        if (concurrent) {
          throw new ConflictException({
            code: 'QR_LINK_IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key уже использован для другого QR-кода.'
          });
        }
        const retried = await this.repository.findByIdempotency(actorId, idempotencyKey);
        if (retried?.idempotency?.intentHash === intentHash) {
          return { item: this.toView(retried), replayed: true };
        }
        throw new ConflictException({
          code: 'QR_LINK_CREATE_CONFLICT',
          message: 'Не удалось сохранить QR-код из-за параллельного запроса. Повторите попытку.'
        });
      }
    }
    throw new ConflictException({
      code: 'QR_LINK_CODE_GENERATION_FAILED',
      message: 'Не удалось сгенерировать уникальный код. Повторите создание.'
    });
  }

  async update(
    id: string,
    dto: UpdateQrLinkDto,
    user?: RequestUser
  ): Promise<QrLinkView> {
    const actorId = this.requireActor(user);
    this.assertCodeIsImmutable(dto as unknown as Record<string, unknown>);
    if (!Number.isInteger(dto.expectedVersion) || dto.expectedVersion < 1) {
      throw new BadRequestException({
        code: 'QR_LINK_VERSION_REQUIRED',
        message: 'Не передана версия QR-кода для защиты от параллельных изменений.'
      });
    }
    const current = await this.requireLinkManageable(id, user);
    if (current.status === 'ARCHIVED') {
      throw new ConflictException({
        code: 'QR_LINK_ARCHIVED',
        message: 'Архивный QR-код нельзя изменить.'
      });
    }

    const set: Partial<StoredQrLink> = {};
    const oldValues: Record<string, string> = {};
    const newValues: Record<string, string> = {};
    const changedFields: string[] = [];

    if (dto.name !== undefined) {
      const name = this.requireName(dto.name);
      if (name !== current.name) {
        set.name = name;
        this.recordChange('name', current.name, name, oldValues, newValues, changedFields);
      }
    }

    if (dto.stationId !== undefined) {
      const station = this.resolveStationForWrite(user, dto.stationId);
      const nextStationId = station.stationId;
      if (nextStationId !== (current.stationId ?? null)) {
        set.stationId = nextStationId;
        set.stationName = station.stationName;
        this.recordChange(
          'stationId',
          current.stationId ?? '',
          nextStationId ?? '',
          oldValues,
          newValues,
          changedFields
        );
      }
    }

    this.applyOptionalField(dto, 'placement', current, set, oldValues, newValues, changedFields);
    this.applyOptionalField(dto, 'description', current, set, oldValues, newValues, changedFields);

    if (dto.targetUrl !== undefined) {
      // Always check structural safety, but re-apply the mutable allowlist only
      // when the canonical destination changes. Do not reserialize query params.
      const targetUrl = this.policy.validateStoredTarget(dto.targetUrl);
      if (targetUrl !== current.targetUrl) {
        (await this.targetPolicy()).validate(dto.targetUrl);
        set.targetUrl = targetUrl;
        this.recordChange(
          'targetUrl',
          current.targetUrl,
          targetUrl,
          oldValues,
          newValues,
          changedFields
        );
      }
    }

    let archivedAt: string | null = current.archivedAt ?? null;
    if (dto.status !== undefined && dto.status !== current.status) {
      if (dto.status === 'ARCHIVED') {
        archivedAt = this.clock().toISOString();
        set.archivedAt = archivedAt;
      }
      set.status = dto.status;
      this.recordChange(
        'status',
        current.status,
        dto.status,
        oldValues,
        newValues,
        changedFields
      );
    }

    if (changedFields.length === 0) {
      if (dto.expectedVersion !== current.version) {
        throw this.versionConflict();
      }
      return this.toView(current);
    }

    const updatedAt = this.clock().toISOString();
    const updated = await this.repository.updateLink(
      id,
      dto.expectedVersion,
      set,
      updatedAt
    );
    if (!updated) {
      throw this.versionConflict();
    }

    const isArchive = updated.status === 'ARCHIVED';
    await this.appendAudit({
      action: isArchive ? 'ARCHIVE QR_LINK' : 'UPDATE QR_LINK',
      user,
      targetId: id,
      targetLabel: updated.name,
      metadata: {
        code: updated.code,
        fields: changedFields.join(','),
        ...this.auditValueMap('old', oldValues),
        ...this.auditValueMap('new', newValues),
        expectedVersion: dto.expectedVersion,
        version: updated.version
      }
    });
    return this.toView(updated);
  }

  async list(
    query: {
      q?: string;
      stationId?: string;
      status?: string;
      from?: string;
      to?: string;
      sort?: string;
      direction?: string;
      page?: string;
      pageSize?: string;
    },
    user?: RequestUser
  ): Promise<QrLinkListResponse> {
    const period = this.resolvePeriod(query.from, query.to);
    const status = this.parseStatusFilter(query.status);
    const sort = this.parseSort(query.sort);
    const direction = query.direction === 'asc' ? 'asc' : 'desc';
    const page = this.parsePositiveInteger(query.page, 1);
    const pageSize = Math.min(100, this.parsePositiveInteger(query.pageSize, 20));
    const scope = this.readScope(user);
    const stationId = this.optionalString(query.stationId);
    const listQuery: QrListQuery = {
      q: this.optionalString(query.q),
      stationId,
      status,
      from: period.fromKey,
      to: period.toKey,
      sort,
      direction,
      page,
      pageSize,
      stationScope: scope
    };
    const result = await this.repository.listLinks(listQuery);
    return {
      items: result.items.map((item) => this.toListItem(item)),
      page,
      pageSize,
      total: result.totalQr,
      totalPages: Math.max(1, Math.ceil(result.totalQr / pageSize)),
      metrics: {
        totalQr: result.totalQr,
        activeQr: result.activeQr,
        redirectsPeriod: result.redirectsPeriod
      },
      period: { from: period.from, to: period.to, timezone: period.timezone },
      persistence: 'MONGODB'
    };
  }

  async get(id: string, user?: RequestUser): Promise<QrLinkView> {
    const link = await this.requireLinkReadable(id, user);
    return this.toView(link);
  }

  async analytics(
    id: string,
    input: { from?: string; to?: string },
    user?: RequestUser
  ): Promise<QrLinkAnalytics> {
    const link = await this.requireLinkReadable(id, user);
    const period = this.resolvePeriod(input.from, input.to);
    const stats = await this.repository.getStats(link.id, period.fromKey, period.toKey);
    const dailyMap = new Map(stats.daily.map((row) => [row.date, row.redirects]));
    const daily: Array<{ date: string; redirects: number }> = [];
    for (const dateKey of this.dateRangeKeys(period.fromKey, period.toKey)) {
      daily.push({ date: dateKey, redirects: dailyMap.get(dateKey) ?? 0 });
    }
    const totals: QrLinkTotals = {
      redirectsPeriod: stats.redirectsPeriod,
      redirectsTotal: stats.redirectsTotal,
      lastRedirectAt: stats.lastRedirectAt
    };
    return {
      link: this.toView(link),
      period: { from: period.from, to: period.to, timezone: period.timezone },
      totals,
      daily
    };
  }

  async history(id: string, user?: RequestUser): Promise<QrHistoryResponse> {
    await this.requireLinkReadable(id, user);
    if (!this.authPersistence.isEnabled()) {
      return { items: [], persistence: 'DISABLED' };
    }
    const entries = await this.authPersistence.listAudit({ targetId: id, limit: 100 });
    const items: QrHistoryEntry[] = entries
      .filter((entry) => entry.action.includes('QR_LINK'))
      .map((entry) => ({
        id: entry.id,
        at: entry.at,
        action: entry.action,
        ...(entry.actor?.login ? { actorLogin: entry.actor.login } : {}),
        ...(entry.actor?.title ? { actorTitle: entry.actor.title } : {}),
        ...(entry.targetLabel ? { targetLabel: entry.targetLabel } : {}),
        ...(entry.metadata ? { metadata: entry.metadata } : {})
      }));
    return { items, persistence: 'MONGODB' };
  }

  async image(
    id: string,
    format: string | undefined,
    user?: RequestUser
  ): Promise<QrImagePayload> {
    const link = await this.requireLinkReadable(id, user);
    const normalized = String(format ?? 'png').trim().toLowerCase();
    if (normalized !== 'png' && normalized !== 'svg') {
      throw new BadRequestException({
        code: 'QR_LINK_IMAGE_FORMAT_INVALID',
        message: 'Поддерживаются форматы png и svg.'
      });
    }
    const shortUrl = this.policy.shortUrl(link.code);
    if (normalized === 'png') {
      const buffer = await this.imageService.renderPng(shortUrl);
      return {
        buffer,
        contentType: 'image/png',
        filename: `qr-${link.code}.png`
      };
    }
    const svg = await this.imageService.renderSvg(shortUrl);
    return {
      buffer: svg,
      contentType: 'image/svg+xml; charset=utf-8',
      filename: `qr-${link.code}.svg`
    };
  }

  async stationOptions(user?: RequestUser): Promise<{ items: QrStationOption[] }> {
    const scope = this.readScope(user);
    const directory: QrStationOption[] = this.messenger.listStationConfigs(user as RequestUser);
    if (!directory.some((station) => station.stationId === QR_ZAVIDOVO_STATION.stationId)) {
      directory.push({ ...QR_ZAVIDOVO_STATION });
    }
    const byId = new Map<string, QrStationOption>();
    for (const station of directory) {
      const stationId = String(station.stationId ?? '').trim();
      if (!stationId) continue;
      if (scope !== null && !scope.includes(stationId)) continue;
      byId.set(stationId, {
        stationId,
        stationName: String(station.stationName ?? stationId),
        isActive: Boolean(station.isActive)
      });
    }
    if (scope !== null) {
      for (const stationId of scope) {
        if (!byId.has(stationId)) {
          byId.set(stationId, { stationId, stationName: stationId, isActive: true });
        }
      }
    }
    return {
      items: [...byId.values()].sort((left, right) =>
        left.stationName.localeCompare(right.stationName, 'ru')
      )
    };
  }

  async allowedHosts(): Promise<QrAllowedHostsView> {
    const settings = await this.repository.getAllowedHostsSettings();
    return this.toAllowedHostsView(settings);
  }

  async updateAllowedHosts(
    dto: UpdateAllowedHostsDto,
    user?: RequestUser
  ): Promise<QrAllowedHostsView> {
    const actorId = this.requireActor(user);
    const scopes = user?.permissionStationScopes;
    const unknownScope = scopes !== undefined
      && ['qr:manage', 'settings:write'].some((permission) =>
        !Object.prototype.hasOwnProperty.call(scopes, permission)
        || scopes[permission] === undefined);
    if (unknownScope || getStationScopeForPermission(user, 'qr:manage') !== null
      || getStationScopeForPermission(user, 'settings:write') !== null) {
      throw new ForbiddenException({
        code: 'QR_ALLOWED_HOSTS_GLOBAL_SCOPE_REQUIRED',
        message: 'Настройка доменов доступна только сотруднику с доступом ко всем станциям.'
      });
    }
    if (!hasAdminPermission(user?.permissions, 'settings:write')) {
      throw new ForbiddenException({
        code: 'QR_ALLOWED_HOSTS_SETTINGS_PERMISSION_REQUIRED',
        message: 'Для настройки доменов нужно право изменения настроек.'
      });
    }
    if (!hasAdminPermission(user?.permissions, 'qr:manage')) {
      throw new ForbiddenException({
        code: 'QR_ALLOWED_HOSTS_QR_PERMISSION_REQUIRED',
        message: 'Для настройки доменов нужно право управления QR-кодами.'
      });
    }
    const defaults = this.policy.config.allowedHosts;
    const hosts = normalizeAllowedHosts(dto.hosts, defaults);
    const current = await this.repository.getAllowedHostsSettings();
    const now = this.clock().toISOString();
    let saved: StoredQrAllowedHostsSettings | null = null;
    if (!current) {
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== 0) {
        throw this.allowedHostsVersionConflict();
      }
      const created: StoredQrAllowedHostsSettings = {
        key: QR_ALLOWED_HOSTS_KEY,
        hosts,
        version: 1,
        updatedAt: now,
        updatedBy: actorId
      };
      try {
        await this.repository.insertAllowedHostsSettings(created);
        saved = created;
      } catch (error) {
        if (!this.repository.isDuplicateKey(error)) throw error;
        throw this.allowedHostsVersionConflict();
      }
    } else {
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) {
        throw this.allowedHostsVersionConflict();
      }
      saved = await this.repository.updateAllowedHostsSettings(
        current.version,
        hosts,
        now,
        actorId
      );
      if (!saved) throw this.allowedHostsVersionConflict();
    }
    this.allowedHostsCache = { hosts: saved.hosts, at: Date.now() };
    await this.appendAudit({
      action: 'UPDATE QR_LINKS_ALLOWED_HOSTS',
      user,
      targetId: 'qr-links-allowed-hosts',
      targetLabel: 'Разрешённые домены QR',
      metadata: {
        old_hosts: (current?.hosts ?? []).join(','),
        new_hosts: saved.hosts.join(','),
        version: saved.version
      }
    });
    return this.toAllowedHostsView(saved);
  }

  async resolvePublic(
    code: string,
    request: PublicRequestInfo
  ): Promise<QrPublicResolution> {
    if (!isQrLinkCode(code)) {
      return { kind: 'not_found' };
    }
    const link = await this.repository.findByCode(code);
    if (!link) {
      return { kind: 'not_found' };
    }
    if (link.status === 'ARCHIVED') {
      return { kind: 'archived' };
    }
    if (link.status !== 'ACTIVE') {
      return { kind: 'paused' };
    }
    let location: string;
    try {
      location = this.policy.validateStoredTarget(link.targetUrl);
    } catch (error) {
      this.logger.error(
        `QR_REDIRECT_TARGET_REJECTED code=${link.code} reason=${this.describeError(error)}`
      );
      throw new ServiceUnavailableException({
        code: 'QR_LINK_TARGET_UNAVAILABLE',
        message: 'QR links target is not available'
      });
    }
    const now = this.clock();
    const occurredAt = now.toISOString();
    const dateKey = this.dayKey(occurredAt, QR_LINKS_TIMEZONE);
    let statsRecorded = false;
    if (this.shouldCountRedirect(request)) {
      const result = await this.recordRedirectWithTimeout(link.id, dateKey, occurredAt);
      statsRecorded = result.recorded;
    }
    return { kind: 'redirect', location, qrId: link.id, statsRecorded };
  }

  statsFailureTotal(): number {
    return this.statsFailureCount;
  }

  shortUrlFor(link: StoredQrLink): string {
    return this.policy.shortUrl(link.code);
  }

  private shouldCountRedirect(request: PublicRequestInfo): boolean {
    if (request.method !== 'GET') return false;
    const headers = request.headers ?? {};
    if (this.isPrefetchRequest(headers)) return false;
    const userAgent = String(request.userAgent ?? headers['user-agent'] ?? '').toLowerCase();
    return !PREVIEW_BOT_MARKERS.some((marker) => userAgent.includes(marker));
  }

  private isPrefetchRequest(headers: Record<string, string | string[] | undefined>): boolean {
    const read = (name: string): string => {
      const value = headers[name];
      return String(Array.isArray(value) ? value.join(',') : value ?? '').toLowerCase();
    };
    const purpose = `${read('sec-purpose')} ${read('purpose')} ${read('x-purpose')}`;
    if (purpose.includes('prefetch') || purpose.includes('prerender')) return true;
    if (read('x-moz') === 'prefetch') return true;
    if (read('x-prefetch') === '1' || read('x-prefetch') === 'true') return true;
    return false;
  }

  private async recordRedirectWithTimeout(
    qrId: string,
    dateKey: string,
    occurredAt: string
  ): Promise<{ recorded: boolean; errorCode?: string }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.statsWriteTimeoutMs);
      timer.unref?.();
    });
    const write = this.repository
      .incrementDailyRedirect(qrId, dateKey, occurredAt)
      .then(() => 'ok' as const)
      .catch(() => 'error' as const);
    try {
      const outcome = await Promise.race([write, timeout]);
      if (outcome === 'timeout') {
        this.statsFailureCount += 1;
        this.logger.warn(
          `QR_REDIRECT_STATS_WRITE_TIMEOUT qrId=${qrId} dateKey=${dateKey} timeoutMs=${this.statsWriteTimeoutMs}`
        );
        return { recorded: false, errorCode: 'QR_REDIRECT_STATS_WRITE_TIMEOUT' };
      }
      if (outcome === 'error') {
        this.statsFailureCount += 1;
        this.logger.error(
          `QR_REDIRECT_STATS_WRITE_FAILED qrId=${qrId} dateKey=${dateKey}`
        );
        return { recorded: false, errorCode: 'QR_REDIRECT_STATS_WRITE_FAILED' };
      }
      return { recorded: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async targetPolicy(): Promise<QrTargetUrlPolicy> {
    const extra = await this.extraAllowedHosts();
    if (extra.length === 0) return this.policy;
    return new QrTargetUrlPolicy(process.env, extra);
  }

  private async extraAllowedHosts(): Promise<string[]> {
    const now = Date.now();
    if (
      this.allowedHostsCache
      && now - this.allowedHostsCache.at < this.allowedHostsCacheTtlMs
    ) {
      return this.allowedHostsCache.hosts;
    }
    try {
      const settings = await this.repository.getAllowedHostsSettings();
      const hosts = settings?.hosts ?? [];
      this.allowedHostsCache = { hosts, at: now };
      return hosts;
    } catch (error) {
      this.logger.warn(
        `QR_ALLOWED_HOSTS_READ_FAILED error=${this.describeError(error)}`
      );
      return this.allowedHostsCache?.hosts ?? [];
    }
  }

  private toAllowedHostsView(
    settings: StoredQrAllowedHostsSettings | null
  ): QrAllowedHostsView {
    return {
      defaults: this.policy.config.allowedHosts,
      extra: settings?.hosts ?? [],
      version: settings?.version ?? 0,
      updatedAt: settings?.updatedAt ?? null,
      updatedBy: settings?.updatedBy ?? null
    };
  }

  private allowedHostsVersionConflict(): ConflictException {
    return new ConflictException({
      code: 'QR_ALLOWED_HOSTS_VERSION_CONFLICT',
      message: 'Настройка доменов изменена другим сотрудником. Обновите данные.'
    });
  }

  private resolveStationForWrite(
    user: RequestUser | undefined,
    rawStationId: string | null | undefined
  ): { stationId: string | null; stationName: string | null } {
    const scope = getStationScopeForPermission(user, 'qr:manage');
    const stationId = this.optionalString(rawStationId ?? undefined) ?? null;
    if (!stationId) {
      if (scope !== null) {
        throw new ForbiddenException({
          code: 'QR_STATION_REQUIRED',
          message: 'Выберите станцию, доступную вашей роли.'
        });
      }
      return { stationId: null, stationName: null };
    }
    const directory = this.messenger.listStationConfigs(user as RequestUser);
    const entry = directory.find((station) => station.stationId === stationId)
      ?? (stationId === QR_ZAVIDOVO_STATION.stationId ? QR_ZAVIDOVO_STATION : undefined);
    if (scope !== null) {
      if (!scope.includes(stationId)) {
        throw new ForbiddenException({
          code: 'QR_STATION_OUT_OF_SCOPE',
          message: 'Станция недоступна вашей роли.'
        });
      }
      return { stationId, stationName: entry?.stationName ?? stationId };
    }
    if (!entry && directory.length > 0) {
      throw new BadRequestException({
        code: 'QR_STATION_NOT_FOUND',
        message: 'Станция не найдена в справочнике.'
      });
    }
    return { stationId, stationName: entry?.stationName ?? stationId };
  }

  private readScope(user?: RequestUser): string[] | null {
    return getStationScopeForPermission(user, 'qr:read');
  }

  private manageScope(user?: RequestUser): string[] | null {
    return getStationScopeForPermission(user, 'qr:manage');
  }

  private async requireLinkReadable(
    id: string,
    user?: RequestUser
  ): Promise<StoredQrLink> {
    const link = await this.repository.findById(id);
    if (!link) throw this.notFound();
    const scope = this.readScope(user);
    if (scope !== null && (!link.stationId || !scope.includes(link.stationId))) {
      throw this.notFound();
    }
    return link;
  }

  private async requireLinkManageable(
    id: string,
    user?: RequestUser
  ): Promise<StoredQrLink> {
    const link = await this.repository.findById(id);
    if (!link) throw this.notFound();
    const scope = this.manageScope(user);
    if (scope !== null && (!link.stationId || !scope.includes(link.stationId))) {
      throw this.notFound();
    }
    return link;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'QR_LINK_NOT_FOUND',
      message: 'QR-код не найден.'
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'QR_LINK_VERSION_CONFLICT',
      message: 'QR-код изменён другим сотрудником. Обновите данные и повторите.'
    });
  }

  private toView(link: StoredQrLink): QrLinkView {
    const { idempotency: _idempotency, _id: _mongoId, ...rest } =
      link as StoredQrLink & { _id?: unknown };
    return {
      id: rest.id,
      code: rest.code,
      name: rest.name,
      stationId: rest.stationId ?? null,
      stationName: rest.stationName ?? null,
      placement: rest.placement ?? null,
      description: rest.description ?? null,
      targetUrl: rest.targetUrl,
      status: rest.status,
      shortUrl: this.policy.shortUrl(rest.code),
      version: rest.version,
      createdBy: rest.createdBy,
      updatedBy: rest.updatedBy,
      createdAt: rest.createdAt,
      updatedAt: rest.updatedAt,
      archivedAt: rest.archivedAt ?? null
    };
  }

  private toListItem(raw: unknown): QrLinkListItem {
    const item = raw as StoredQrLink & {
      redirectsPeriod?: number;
      redirectsTotal?: number;
      lastRedirectAt?: string | null;
    };
    return {
      ...this.toView(item),
      redirectsPeriod: Number(item.redirectsPeriod ?? 0),
      redirectsTotal: Number(item.redirectsTotal ?? 0),
      lastRedirectAt: item.lastRedirectAt ?? null
    };
  }

  private applyOptionalField(
    dto: UpdateQrLinkDto,
    field: 'placement' | 'description',
    current: StoredQrLink,
    set: Partial<StoredQrLink>,
    oldValues: Record<string, string>,
    newValues: Record<string, string>,
    changedFields: string[]
  ): void {
    if (dto[field] === undefined) return;
    const next = this.optionalString(dto[field] ?? undefined) ?? null;
    const previous = current[field] ?? null;
    if (next !== previous) {
      set[field] = next;
      this.recordChange(field, previous ?? '', next ?? '', oldValues, newValues, changedFields);
    }
  }

  private recordChange(
    field: string,
    oldValue: string,
    newValue: string,
    oldValues: Record<string, string>,
    newValues: Record<string, string>,
    changedFields: string[]
  ): void {
    changedFields.push(field);
    oldValues[field] = oldValue;
    newValues[field] = newValue;
  }

  private auditValueMap(
    prefix: 'old' | 'new',
    values: Record<string, string>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [field, value] of Object.entries(values)) {
      result[`${prefix}_${field}`] = value.slice(0, AUDIT_VALUE_LIMIT);
    }
    return result;
  }

  private async appendAudit(input: {
    action: string;
    user?: RequestUser;
    targetId: string;
    targetLabel?: string;
    metadata: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    if (!this.authPersistence.isEnabled()) return;
    try {
      await this.authPersistence.appendAudit({
        id: `audit-${randomUUID()}`,
        at: this.clock().toISOString(),
        action: input.action,
        actor: input.user
          ? { id: input.user.id, login: input.user.login, title: input.user.title }
          : undefined,
        targetType: 'RESOURCE',
        targetId: input.targetId,
        targetLabel: input.targetLabel,
        metadata: input.metadata
      });
    } catch (error) {
      this.logger.warn(
        `QR_LINK_AUDIT_WRITE_FAILED action=${input.action} targetId=${input.targetId} error=${this.describeError(error)}`
      );
    }
  }

  private resolvePeriod(fromInput?: string, toInput?: string): ResolvedPeriod {
    const now = this.clock();
    const todayKey = this.dayKey(now.toISOString(), QR_LINKS_TIMEZONE);
    const toKey = toInput ? this.requireDateInput(toInput, 'окончания') : todayKey;
    const fromKey = fromInput
      ? this.requireDateInput(fromInput, 'начала')
      : this.addDays(todayKey, -(DEFAULT_PERIOD_DAYS - 1));
    const fromTimestamp = Date.parse(`${fromKey}T00:00:00.000+03:00`);
    const toTimestamp = Date.parse(`${toKey}T23:59:59.999+03:00`);
    if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
      throw new BadRequestException({
        code: 'QR_LINK_PERIOD_INVALID',
        message: 'Некорректный период статистики.'
      });
    }
    if (fromTimestamp > toTimestamp) {
      throw new BadRequestException({
        code: 'QR_LINK_PERIOD_INVALID',
        message: 'Дата начала должна быть раньше даты окончания.'
      });
    }
    if (toTimestamp - fromTimestamp > MAX_PERIOD_DAYS * 86_400_000) {
      throw new BadRequestException({
        code: 'QR_LINK_PERIOD_TOO_LONG',
        message: 'Период статистики не может превышать 366 дней.'
      });
    }
    return {
      from: new Date(fromTimestamp).toISOString(),
      to: new Date(toTimestamp).toISOString(),
      timezone: QR_LINKS_TIMEZONE,
      fromKey,
      toKey
    };
  }

  private requireDateInput(value: string, label: string): string {
    const date = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))) {
      throw new BadRequestException({
        code: 'QR_LINK_PERIOD_INVALID',
        message: `Дата ${label} периода должна быть в формате YYYY-MM-DD.`
      });
    }
    return date;
  }

  private addDays(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private dateRangeKeys(fromKey: string, toKey: string): string[] {
    const keys: string[] = [];
    let cursor = new Date(`${fromKey}T12:00:00.000Z`);
    const end = new Date(`${toKey}T12:00:00.000Z`);
    while (cursor <= end && keys.length <= MAX_PERIOD_DAYS + 1) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
  }

  private dayKey(value: string, timezone: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const get = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private parseStatusFilter(value?: string): QrLinkStatusFilter | undefined {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (!normalized) return undefined;
    if (normalized === 'ALL') return 'ALL';
    if (normalized === 'ACTIVE' || normalized === 'PAUSED' || normalized === 'ARCHIVED') {
      return normalized;
    }
    throw new BadRequestException({
      code: 'QR_LINK_STATUS_INVALID',
      message: 'Некорректный статус фильтра.'
    });
  }

  private parseSort(value?: string): QrListQuery['sort'] {
    const normalized = String(value ?? '').trim();
    if (!normalized) return 'createdAt';
    if (
      normalized === 'createdAt'
      || normalized === 'name'
      || normalized === 'redirectsPeriod'
      || normalized === 'redirectsTotal'
      || normalized === 'lastRedirectAt'
    ) {
      return normalized;
    }
    throw new BadRequestException({
      code: 'QR_LINK_SORT_INVALID',
      message: 'Некорректная сортировка.'
    });
  }

  private parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private requireActor(user?: RequestUser): string {
    const actorId = String(user?.id ?? '').trim();
    if (!actorId || actorId === 'anonymous') {
      throw new ForbiddenException({
        code: 'QR_LINK_ACTOR_REQUIRED',
        message: 'Не удалось определить сотрудника ЦУП.'
      });
    }
    return actorId;
  }

  private requireName(value: string): string {
    const name = String(value ?? '').trim();
    if (name.length < 2 || name.length > 120) {
      throw new BadRequestException({
        code: 'QR_LINK_NAME_INVALID',
        message: 'Название должно содержать от 2 до 120 символов.'
      });
    }
    return name;
  }

  private requireIdempotencyKey(value?: string): string {
    const key = String(value ?? '').trim();
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException({
        code: 'QR_LINK_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key должен содержать от 8 до 200 символов.'
      });
    }
    return key;
  }

  private assertCodeIsImmutable(body: Record<string, unknown>): void {
    for (const field of ['code', 'id', 'shortUrl']) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        throw new BadRequestException({
          code: 'QR_LINK_CODE_IMMUTABLE',
          message: 'Адрес QR постоянный: код и короткая ссылка не изменяются.'
        });
      }
    }
  }

  private optionalString(value?: string | null): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
  }

  private readTimeout(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(5_000, Math.max(50, Math.floor(parsed)));
  }
}
