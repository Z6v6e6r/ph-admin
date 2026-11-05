import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { HEADERS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { AdminAuditEntry } from '../src/auth/auth.types';
import { AuthService } from '../src/auth/auth.service';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../src/common/rbac/role.enum';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import { RolesGuard } from '../src/common/rbac/roles.guard';
import { MessengerService } from '../src/messenger/messenger.service';
import { CreateQrLinkDto } from '../src/qr-links/dto/create-qr-link.dto';
import { UpdateQrLinkDto } from '../src/qr-links/dto/update-qr-link.dto';
import { isQrLinkCode } from '../src/qr-links/qr-link-code';
import { QrCodeImageService } from '../src/qr-links/qr-code-image.service';
import {
  QrLinksAdminController,
  QrLinksPublicController
} from '../src/qr-links/qr-links.controller';
import {
  QrLinkListPage,
  QrLinksRepository,
  QrStatsSnapshot
} from '../src/qr-links/qr-links.repository';
import { QrLinksService, PublicRequestInfo } from '../src/qr-links/qr-links.service';
import {
  QrDailyStat,
  QrLinkListItem,
  QrListQuery,
  QrPublicResolution,
  StoredQrAllowedHostsSettings,
  StoredQrLink
} from '../src/qr-links/qr-links.types';
import { QrTargetUrlPolicy } from '../src/qr-links/qr-target-url-policy';

type IncrementMode = 'ok' | 'reject' | 'hang';

const POLICY = new QrTargetUrlPolicy({
  QR_LINKS_PUBLIC_BASE_URL: 'https://padlhub.su',
  QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,www.padlhub.su,padlhub.ru',
  QR_LINKS_ALLOWED_TARGET_PORTS: '443'
} as NodeJS.ProcessEnv);

const ADMIN: RequestUser = {
  id: 'admin:qr',
  login: 'qr_admin',
  title: 'Администратор QR',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  stationIds: [],
  connectorRoutes: []
};

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'staff:qr',
    login: 'qr_staff',
    title: 'Сотрудник QR',
    roles: [Role.MANAGER],
    permissions: ['qr:read', 'qr:manage'],
    stationIds: [],
    connectorRoutes: [],
    ...overrides
  };
}

const SCOPED_READER = makeUser({
  id: 'staff:reader',
  login: 'qr_reader',
  permissions: ['qr:read'],
  stationIds: ['Yasenevo'],
  permissionStationScopes: { 'qr:read': ['Yasenevo'] }
});

const SCOPED_MANAGER = makeUser({
  id: 'staff:manager',
  login: 'qr_manager',
  permissions: ['qr:read', 'qr:manage'],
  stationIds: ['Yasenevo'],
  permissionStationScopes: { 'qr:read': ['Yasenevo'], 'qr:manage': ['Yasenevo'] }
});

class FakeDuplicateKeyError extends Error {
  readonly code = 11000;

  constructor(readonly keyPattern: Record<string, 1>) {
    super('E11000 duplicate key error');
    this.name = 'FakeDuplicateKeyError';
  }
}

class InMemoryQrLinksRepository {
  readonly links: StoredQrLink[] = [];
  readonly dailyStats = new Map<string, QrDailyStat>();
  incrementMode: IncrementMode = 'ok';
  unavailable = false;

  isDuplicateKey(error: unknown): boolean {
    return error instanceof FakeDuplicateKeyError && error.code === 11000;
  }

  duplicateKeyFields(error: unknown): string[] {
    return error instanceof FakeDuplicateKeyError ? Object.keys(error.keyPattern) : [];
  }

  requireAvailable(): void {
    if (this.unavailable) {
      throw new ServiceUnavailableException({
        code: 'QR_LINKS_PERSISTENCE_UNAVAILABLE',
        message: 'QR links persistence is unavailable'
      });
    }
  }

  async findById(id: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    const found = this.links.find((link) => link.id === id);
    return found ? structuredClone(found) : null;
  }

  async findByCode(code: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    const found = this.links.find((link) => link.code === code);
    return found ? structuredClone(found) : null;
  }

  async findByIdempotency(actorId: string, key: string): Promise<StoredQrLink | null> {
    this.requireAvailable();
    const found = this.links.find(
      (link) => link.idempotency?.actorId === actorId && link.idempotency?.key === key
    );
    return found ? structuredClone(found) : null;
  }

  private allowedHostsSettings: StoredQrAllowedHostsSettings | null = null;

  async getAllowedHostsSettings(): Promise<StoredQrAllowedHostsSettings | null> {
    this.requireAvailable();
    return this.allowedHostsSettings ? structuredClone(this.allowedHostsSettings) : null;
  }

  async insertAllowedHostsSettings(
    settings: StoredQrAllowedHostsSettings
  ): Promise<void> {
    this.requireAvailable();
    if (this.allowedHostsSettings) throw new FakeDuplicateKeyError({ key: 1 });
    this.allowedHostsSettings = structuredClone(settings);
  }

  async updateAllowedHostsSettings(
    expectedVersion: number,
    hosts: string[],
    updatedAt: string,
    updatedBy: string
  ): Promise<StoredQrAllowedHostsSettings | null> {
    this.requireAvailable();
    if (!this.allowedHostsSettings || this.allowedHostsSettings.version !== expectedVersion) {
      return null;
    }
    this.allowedHostsSettings = {
      ...this.allowedHostsSettings,
      hosts: [...hosts],
      version: expectedVersion + 1,
      updatedAt,
      updatedBy
    };
    return structuredClone(this.allowedHostsSettings);
  }

  async insertLink(link: StoredQrLink): Promise<void> {
    this.requireAvailable();
    if (this.links.some((existing) => existing.code === link.code)) {
      throw new FakeDuplicateKeyError({ code: 1 });
    }
    if (link.idempotency) {
      const conflicting = this.links.some(
        (existing) =>
          existing.idempotency?.actorId === link.idempotency?.actorId
          && existing.idempotency?.key === link.idempotency?.key
      );
      if (conflicting) {
        throw new FakeDuplicateKeyError({
          'idempotency.actorId': 1,
          'idempotency.key': 1
        });
      }
    }
    this.links.push(structuredClone(link));
  }

  async updateLink(
    id: string,
    expectedVersion: number,
    set: Partial<StoredQrLink>,
    updatedAt: string
  ): Promise<StoredQrLink | null> {
    this.requireAvailable();
    const index = this.links.findIndex(
      (link) => link.id === id && link.version === expectedVersion
    );
    if (index < 0) return null;
    this.links[index] = {
      ...this.links[index],
      ...structuredClone(set),
      updatedAt,
      version: expectedVersion + 1
    };
    return structuredClone(this.links[index]);
  }

  incrementDailyRedirect(qrId: string, dateKey: string, occurredAt: string): Promise<void> {
    if (this.unavailable) {
      return Promise.reject(
        new ServiceUnavailableException({
          code: 'QR_LINKS_PERSISTENCE_UNAVAILABLE',
          message: 'QR links persistence is unavailable'
        })
      );
    }
    if (this.incrementMode === 'reject') {
      return Promise.reject(new Error('synthetic stats write failure'));
    }
    if (this.incrementMode === 'hang') {
      return new Promise<void>(() => undefined);
    }
    // Mutates synchronously so concurrent resolutions cannot lose an increment,
    // matching a single-document MongoDB $inc.
    const key = qrId + '|' + dateKey;
    const current = this.dailyStats.get(key);
    if (current) {
      current.redirectsCount += 1;
      if (occurredAt > current.lastRedirectAt) current.lastRedirectAt = occurredAt;
      current.updatedAt = occurredAt;
    } else {
      this.dailyStats.set(key, {
        qrId,
        dateKey,
        redirectsCount: 1,
        lastRedirectAt: occurredAt,
        updatedAt: occurredAt
      });
    }
    return Promise.resolve();
  }

  async listLinks(query: QrListQuery): Promise<QrLinkListPage> {
    this.requireAvailable();
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const status = query.status;
    const filtered = this.links.filter((link) => {
      if (status && status !== 'ALL') {
        if (link.status !== status) return false;
      } else if (!status && link.status !== 'ACTIVE' && link.status !== 'PAUSED') {
        return false;
      }
      if (query.stationId) {
        if (query.stationScope !== null && !query.stationScope.includes(query.stationId)) {
          return false;
        }
        if ((link.stationId ?? null) !== query.stationId) return false;
      } else if (query.stationScope !== null) {
        if (!link.stationId || !query.stationScope.includes(link.stationId)) return false;
      }
      const search = String(query.q ?? '').trim().toLowerCase();
      if (search) {
        const haystack = [link.name, link.code, link.placement ?? '']
          .map((value) => String(value).toLowerCase());
        if (!haystack.some((value) => value.includes(search))) return false;
      }
      return true;
    });
    const fromKey = String(query.from ?? '');
    const toKey = String(query.to ?? '');
    const withStats: QrLinkListItem[] = filtered.map((link) => {
      const rows = [...this.dailyStats.values()].filter((row) => row.qrId === link.id);
      const redirectsTotal = rows.reduce((sum, row) => sum + row.redirectsCount, 0);
      const redirectsPeriod = rows
        .filter((row) => row.dateKey >= fromKey && row.dateKey <= toKey)
        .reduce((sum, row) => sum + row.redirectsCount, 0);
      const lastRedirectAt = rows.length === 0
        ? null
        : rows.reduce(
          (latest, row) => (row.lastRedirectAt > latest ? row.lastRedirectAt : latest),
          ''
        );
      return {
        ...(structuredClone(link) as unknown as QrLinkListItem),
        redirectsTotal,
        redirectsPeriod,
        lastRedirectAt
      };
    });
    const field = query.sort ?? 'createdAt';
    const direction = query.direction === 'asc' ? 1 : -1;
    const valueOf = (item: QrLinkListItem): string | number | null => {
      if (field === 'name') return item.name;
      if (field === 'redirectsPeriod') return item.redirectsPeriod;
      if (field === 'redirectsTotal') return item.redirectsTotal;
      if (field === 'lastRedirectAt') return item.lastRedirectAt;
      return item.createdAt;
    };
    const sorted = [...withStats].sort((left, right) => {
      const a = valueOf(left);
      const b = valueOf(right);
      let comparison = 0;
      if (a === b) comparison = 0;
      else if (a === null) comparison = -1;
      else if (b === null) comparison = 1;
      else comparison = a < b ? -1 : 1;
      if (comparison !== 0) return comparison * direction;
      return left.id < right.id ? -1 : 1;
    });
    return {
      items: sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
      totalQr: withStats.length,
      activeQr: withStats.filter((item) => item.status === 'ACTIVE').length,
      redirectsPeriod: withStats.reduce((sum, item) => sum + item.redirectsPeriod, 0)
    };
  }

  async getStats(qrId: string, fromKey: string, toKey: string): Promise<QrStatsSnapshot> {
    this.requireAvailable();
    const rows = [...this.dailyStats.values()].filter((row) => row.qrId === qrId);
    const redirectsTotal = rows.reduce((sum, row) => sum + row.redirectsCount, 0);
    const redirectsPeriod = rows
      .filter((row) => row.dateKey >= fromKey && row.dateKey <= toKey)
      .reduce((sum, row) => sum + row.redirectsCount, 0);
    const lastRedirectAt = rows.length === 0
      ? null
      : rows.reduce(
        (latest, row) => (row.lastRedirectAt > latest ? row.lastRedirectAt : latest),
        ''
      );
    return {
      redirectsTotal,
      redirectsPeriod,
      lastRedirectAt,
      daily: rows
        .filter((row) => row.dateKey >= fromKey && row.dateKey <= toKey)
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
        .map((row) => ({ date: row.dateKey, redirects: row.redirectsCount }))
    };
  }

  dailyCount(qrId: string, dateKey: string): number {
    const row = this.dailyStats.get(qrId + '|' + dateKey);
    return row ? row.redirectsCount : 0;
  }

  dailyDateKeys(): string[] {
    return [...this.dailyStats.values()].map((row) => row.dateKey).sort();
  }

  totalRedirects(qrId?: string): number {
    return [...this.dailyStats.values()]
      .filter((row) => qrId === undefined || row.qrId === qrId)
      .reduce((sum, row) => sum + row.redirectsCount, 0);
  }

  lastRedirectAt(qrId?: string): string | null {
    const rows = [...this.dailyStats.values()]
      .filter((row) => qrId === undefined || row.qrId === qrId);
    if (rows.length === 0) return null;
    return rows.reduce(
      (latest, row) => (row.lastRedirectAt > latest ? row.lastRedirectAt : latest),
      ''
    );
  }
}

class FakeAuthPersistence {
  enabled = true;
  readonly entries: AdminAuditEntry[] = [];

  isEnabled(): boolean {
    return this.enabled;
  }

  async appendAudit(entry: AdminAuditEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async listAudit(filters: {
    actorId?: string;
    targetId?: string;
    limit?: number;
  }): Promise<AdminAuditEntry[]> {
    let rows = [...this.entries];
    if (filters.actorId) rows = rows.filter((entry) => entry.actor?.id === filters.actorId);
    if (filters.targetId) rows = rows.filter((entry) => entry.targetId === filters.targetId);
    const limit = Math.min(Math.max(Math.floor(filters.limit ?? 100), 1), 500);
    const ordered = rows
      .reverse()
      .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
    return ordered.slice(0, limit);
  }
}

class FakeMessenger {
  readonly stations = [
    { stationId: 'Yasenevo', stationName: 'Ясенево', isActive: true },
    { stationId: 'Piter', stationName: 'Питер', isActive: true }
  ];

  listStationConfigs(_user: RequestUser): Array<{
    stationId: string;
    stationName: string;
    isActive: boolean;
  }> {
    return this.stations.map((station) => ({ ...station }));
  }
}

function mutableClock(iso: string): { now: () => Date; set: (next: string) => void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    set: (next: string): void => {
      current = new Date(next);
    }
  };
}

interface Harness {
  repository: InMemoryQrLinksRepository;
  auth: FakeAuthPersistence;
  messenger: FakeMessenger;
  clock: ReturnType<typeof mutableClock>;
  service: QrLinksService;
}

function createHarness(options: {
  clockIso?: string;
  codes?: string[];
  codeGenerator?: () => string;
  statsTimeoutMs?: number;
  authEnabled?: boolean;
} = {}): Harness {
  const repository = new InMemoryQrLinksRepository();
  const auth = new FakeAuthPersistence();
  auth.enabled = options.authEnabled ?? true;
  const messenger = new FakeMessenger();
  const clock = mutableClock(options.clockIso ?? '2026-01-01T00:30:00+03:00');
  let sequence = 0;
  const generator = options.codeGenerator ?? (() => {
    if (options.codes && sequence < options.codes.length) return options.codes[sequence++];
    sequence += 1;
    return 'qr' + String(sequence).padStart(8, '0');
  });
  const previousTimeout = process.env.QR_LINKS_STATS_WRITE_TIMEOUT_MS;
  if (options.statsTimeoutMs !== undefined) {
    process.env.QR_LINKS_STATS_WRITE_TIMEOUT_MS = String(options.statsTimeoutMs);
  }
  let service: QrLinksService;
  try {
    service = new QrLinksService(
      repository as unknown as QrLinksRepository,
      new QrCodeImageService(),
      auth as unknown as AuthPersistenceService,
      messenger as unknown as MessengerService,
      POLICY,
      generator,
      clock.now
    );
  } finally {
    if (previousTimeout === undefined) delete process.env.QR_LINKS_STATS_WRITE_TIMEOUT_MS;
    else process.env.QR_LINKS_STATS_WRITE_TIMEOUT_MS = previousTimeout;
  }
  return { repository, auth, messenger, clock, service };
}

function createDto(overrides: Partial<CreateQrLinkDto> = {}): CreateQrLinkDto {
  return {
    name: 'QR на сезон',
    targetUrl: 'https://padlhub.ru/annual',
    status: 'ACTIVE',
    ...overrides
  };
}

function updateDto(overrides: Partial<UpdateQrLinkDto> = {}): UpdateQrLinkDto {
  return { expectedVersion: 1, ...overrides };
}

function publicRequest(options: {
  method?: string;
  userAgent?: string;
  headers?: Record<string, string | string[] | undefined>;
} = {}): PublicRequestInfo {
  const userAgent = options.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  return {
    method: options.method ?? 'GET',
    userAgent,
    headers: { 'user-agent': userAgent, ...(options.headers ?? {}) }
  };
}

async function expectServiceError(
  operation: Promise<unknown> | (() => Promise<unknown>),
  exception: abstract new (...args: any[]) => Error,
  code: string
): Promise<Error> {
  let failure: unknown;
  try {
    await (typeof operation === 'function' ? operation() : operation);
  } catch (error) {
    failure = error;
  }
  assert.ok(
    failure instanceof exception,
    'expected ' + exception.name + ', got ' + String(failure)
  );
  const response = (failure as unknown as { getResponse?: () => unknown }).getResponse?.() as
    | { code?: string }
    | undefined;
  assert.equal(response?.code, code, 'error response code');
  return failure as Error;
}

function expectMetadata(value: unknown, expected: unknown, label: string): void {
  assert.deepEqual(value, expected, label);
}

function adminHandler(name: string): (...args: any[]) => unknown {
  const handler = (QrLinksAdminController.prototype as unknown as Record<string, unknown>)[name];
  assert.equal(typeof handler, 'function', 'admin endpoint ' + name + ' must exist');
  return handler as (...args: any[]) => unknown;
}

function createGuard(
  handler: (...args: any[]) => unknown,
  resolved: { source: 'token' | 'anonymous'; user?: RequestUser }
): { guard: RolesGuard; context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers: {} };
  const authService = {
    resolveUserFromRequest: async () => resolved,
    shouldRequireStaffToken: () => false,
    hasStaffRole: () => Boolean(resolved.user)
  } as unknown as AuthService;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => QrLinksAdminController
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(new Reflector(), authService), context, request };
}

class FakeApiResponse {
  readonly headers: Record<string, string> = {};
  statusCode?: number;
  body?: unknown;

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  send(body: unknown): this {
    this.body = body;
    return this;
  }
}

async function scenarioCreateAndIdempotency(): Promise<void> {
  const harness = createHarness();
  const created = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0001' }, ADMIN);
  assert.equal(created.replayed, false);
  const link = created.item;
  assert.match(link.code, /^[a-z0-9]{6,32}$/, 'generated code must be URL-safe lowercase');
  assert.equal(isQrLinkCode(link.code), true);
  assert.equal(link.shortUrl, 'https://padlhub.su/q/' + link.code);
  assert.match(link.shortUrl, /^https:\/\/padlhub\.su\/q\/[a-z0-9]{10}$/);
  assert.equal(link.status, 'ACTIVE');
  assert.equal(link.version, 1);
  assert.equal(link.stationId, null);
  assert.equal(link.stationName, null);
  assert.equal(link.placement, null);
  assert.equal(link.description, null);
  assert.equal(link.archivedAt, null);
  assert.equal(link.createdBy, ADMIN.id);
  assert.equal(link.updatedBy, ADMIN.id);
  assert.equal(link.createdAt, '2025-12-31T21:30:00.000Z');
  assert.equal(link.updatedAt, '2025-12-31T21:30:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(link, 'idempotency'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(link, '_id'), false);
  assert.equal(harness.repository.links.length, 1);
  const stored = harness.repository.links[0];
  assert.equal(stored.code, link.code);
  assert.equal(stored.targetUrl, 'https://padlhub.ru/annual');
  assert.equal(stored.idempotency?.key, 'qr-idem-0001');
  assert.equal(stored.idempotency?.actorId, ADMIN.id);
  assert.match(String(stored.idempotency?.intentHash), /^[0-9a-f]{64}$/);

  // Same Idempotency-Key + same intent replays the existing permanent link.
  const replay = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0001' }, ADMIN);
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.id, link.id);
  assert.equal(replay.item.code, link.code);
  assert.equal(harness.repository.links.length, 1);

  // Same Idempotency-Key with a different intent is a conflict, not a silent overwrite.
  await expectServiceError(
    harness.service.create(
      createDto({ name: 'Другой QR' }),
      { idempotencyKey: 'qr-idem-0001' },
      ADMIN
    ),
    ConflictException,
    'QR_LINK_IDEMPOTENCY_CONFLICT'
  );

  await expectServiceError(
    harness.service.create(createDto(), { idempotencyKey: 'short' }, ADMIN),
    BadRequestException,
    'QR_LINK_IDEMPOTENCY_KEY_REQUIRED'
  );
  await expectServiceError(
    harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0002' }, undefined),
    ForbiddenException,
    'QR_LINK_ACTOR_REQUIRED'
  );
  await expectServiceError(
    harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0002' }, makeUser({ id: 'anonymous' })),
    ForbiddenException,
    'QR_LINK_ACTOR_REQUIRED'
  );

  // The permanent code/id/shortUrl are never accepted from the request body.
  await expectServiceError(
    harness.service.create(
      { ...createDto(), code: 'hijacked1' } as CreateQrLinkDto,
      { idempotencyKey: 'qr-idem-0002' },
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_CODE_IMMUTABLE'
  );
  await expectServiceError(
    harness.service.create(
      { ...createDto(), shortUrl: 'https://padlhub.su/q/hijacked1' } as CreateQrLinkDto,
      { idempotencyKey: 'qr-idem-0002' },
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_CODE_IMMUTABLE'
  );
  await expectServiceError(
    harness.service.create(
      createDto({ targetUrl: 'http://padlhub.ru/annual' }),
      { idempotencyKey: 'qr-idem-0002' },
      ADMIN
    ),
    BadRequestException,
    'QR_TARGET_URL_HTTPS_REQUIRED'
  );

  // Station assignment is resolved from the messenger directory for unrestricted staff.
  const paus = await harness.service.create(
    createDto({
      name: 'QR Ясенево',
      stationId: 'Yasenevo',
      placement: 'Ресепшн',
      description: 'Стойка администратора',
      status: 'PAUSED'
    }),
    { idempotencyKey: 'qr-idem-0003' },
    ADMIN
  );
  assert.equal(paus.item.status, 'PAUSED');
  assert.equal(paus.item.stationId, 'Yasenevo');
  assert.equal(paus.item.stationName, 'Ясенево');
  assert.equal(paus.item.placement, 'Ресепшн');
  assert.equal(paus.item.description, 'Стойка администратора');
  await expectServiceError(
    harness.service.create(
      createDto({ stationId: 'Nowhere' }),
      { idempotencyKey: 'qr-idem-0004' },
      ADMIN
    ),
    BadRequestException,
    'QR_STATION_NOT_FOUND'
  );

  // Creation is audited with the actor and stored values.
  const createAudits = harness.auth.entries.filter((entry) => entry.action === 'CREATE QR_LINK');
  assert.equal(createAudits.length, 2);
  const firstAudit = createAudits[0];
  assert.equal(firstAudit.targetType, 'RESOURCE');
  assert.equal(firstAudit.targetId, link.id);
  assert.equal(firstAudit.targetLabel, 'QR на сезон');
  assert.equal(firstAudit.actor?.id, ADMIN.id);
  assert.equal(firstAudit.actor?.login, 'qr_admin');
  assert.equal(firstAudit.actor?.title, 'Администратор QR');
  assert.equal(firstAudit.at, '2025-12-31T21:30:00.000Z');
  assert.equal(firstAudit.metadata?.code, link.code);
  assert.equal(firstAudit.metadata?.targetUrl, 'https://padlhub.ru/annual');
  assert.equal(firstAudit.metadata?.status, 'ACTIVE');
  assert.equal(firstAudit.metadata?.stationId, null);

  console.log('scenario 1: permanent code + shortUrl + idempotency passed');
}

async function scenarioPatchKeepsPermanentIdentity(): Promise<void> {
  const harness = createHarness();
  const clock = harness.clock;
  const created = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0101' }, ADMIN);
  const link = created.item;

  const first = await harness.service.resolvePublic(link.code, publicRequest());
  assert.equal(first.kind, 'redirect');
  assert.equal(first.kind === 'redirect' ? first.location : '', 'https://padlhub.ru/annual');
  assert.equal(first.kind === 'redirect' ? first.statsRecorded : false, true);
  assert.equal(harness.repository.totalRedirects(link.id), 1);

  clock.set('2026-01-02T10:00:00+03:00');
  const patched = await harness.service.update(
    link.id,
    updateDto({ expectedVersion: 1, targetUrl: 'https://padlhub.ru/new-year?from=qr' }),
    ADMIN
  );
  assert.equal(patched.id, link.id);
  assert.equal(patched.code, link.code, 'PATCH must keep the permanent code');
  assert.equal(patched.shortUrl, link.shortUrl, 'PATCH must keep the permanent shortUrl');
  assert.equal(patched.targetUrl, 'https://padlhub.ru/new-year?from=qr');
  assert.equal(patched.version, 2);
  assert.equal(patched.createdAt, link.createdAt);
  assert.equal(patched.createdBy, link.createdBy);
  assert.equal(patched.updatedAt, '2026-01-02T07:00:00.000Z');
  assert.equal(patched.archivedAt, null);
  assert.equal(harness.repository.totalRedirects(link.id), 1, 'PATCH must not reset counters');

  const second = await harness.service.resolvePublic(link.code, publicRequest());
  assert.equal(second.kind, 'redirect');
  assert.equal(second.kind === 'redirect' ? second.location : '', 'https://padlhub.ru/new-year?from=qr');
  assert.equal(harness.repository.totalRedirects(link.id), 2);

  // Non-destination fields are editable too and never touch the short identity.
  const renamed = await harness.service.update(
    link.id,
    updateDto({
      expectedVersion: 2,
      name: 'QR Новый год',
      placement: 'Бар',
      description: 'Стойка бара'
    }),
    ADMIN
  );
  assert.equal(renamed.code, link.code);
  assert.equal(renamed.shortUrl, link.shortUrl);
  assert.equal(renamed.name, 'QR Новый год');
  assert.equal(renamed.placement, 'Бар');
  assert.equal(renamed.description, 'Стойка бара');
  assert.equal(renamed.version, 3);

  // A no-op PATCH returns the current version instead of bumping it.
  const noop = await harness.service.update(
    link.id,
    updateDto({ expectedVersion: 3, targetUrl: 'https://padlhub.ru/new-year?from=qr' }),
    ADMIN
  );
  assert.equal(noop.version, 3);
  assert.equal(harness.repository.links[0].version, 3);

  // Request bodies can never override identity fields.
  await expectServiceError(
    harness.service.update(
      link.id,
      { expectedVersion: 3, code: 'hijacked2' } as unknown as UpdateQrLinkDto,
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_CODE_IMMUTABLE'
  );
  await expectServiceError(
    harness.service.update(
      link.id,
      { expectedVersion: 3, shortUrl: 'https://padlhub.su/q/hijacked2' } as unknown as UpdateQrLinkDto,
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_CODE_IMMUTABLE'
  );
  await expectServiceError(
    harness.service.update(
      link.id,
      updateDto({ expectedVersion: 0, name: 'Новое имя' }),
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_VERSION_REQUIRED'
  );
  await expectServiceError(
    harness.service.update(
      link.id,
      updateDto({ expectedVersion: 1.5, name: 'Новое имя' }),
      ADMIN
    ),
    BadRequestException,
    'QR_LINK_VERSION_REQUIRED'
  );
  await expectServiceError(
    harness.service.update(
      link.id,
      updateDto({ expectedVersion: 3, targetUrl: 'http://padlhub.ru/annual' }),
      ADMIN
    ),
    BadRequestException,
    'QR_TARGET_URL_HTTPS_REQUIRED'
  );

  // Archived links are frozen.
  const archived = await harness.service.update(
    link.id,
    updateDto({ expectedVersion: 3, status: 'ARCHIVED' }),
    ADMIN
  );
  assert.equal(archived.status, 'ARCHIVED');
  assert.equal(archived.archivedAt, '2026-01-02T07:00:00.000Z');
  assert.equal(archived.version, 4);
  await expectServiceError(
    harness.service.update(link.id, updateDto({ expectedVersion: 4, name: 'После архива' }), ADMIN),
    ConflictException,
    'QR_LINK_ARCHIVED'
  );

  console.log('scenario 5+6: PATCH keeps code/shortUrl/counters and changes the destination passed');
}

async function scenarioVersionConflict(): Promise<void> {
  const harness = createHarness();
  const created = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0201' }, ADMIN);
  const v2 = await harness.service.update(
    created.item.id,
    updateDto({ expectedVersion: 1, targetUrl: 'https://padlhub.ru/season-2' }),
    ADMIN
  );
  assert.equal(v2.version, 2);

  const failure = await expectServiceError(
    harness.service.update(
      created.item.id,
      updateDto({ expectedVersion: 1, targetUrl: 'https://padlhub.ru/stale' }),
      ADMIN
    ),
    ConflictException,
    'QR_LINK_VERSION_CONFLICT'
  );
  assert.equal((failure as ConflictException).getStatus(), 409);
  assert.match(String(failure.message), /изменён другим сотрудником/);
  assert.equal(harness.repository.links[0].targetUrl, 'https://padlhub.ru/season-2');
  assert.equal(harness.repository.links[0].version, 2);

  console.log('scenario 18: stale expectedVersion -> 409 QR_LINK_VERSION_CONFLICT passed');
}

async function scenarioMoscowDayBoundary(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-01T00:30:00+03:00' });
  const created = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0301' }, ADMIN);
  const linkId = created.item.id;

  // 2026-01-01T00:30:00+03:00 is 2025-12-31T21:30:00Z -> Moscow calendar day 2026-01-01.
  const first = await harness.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(first.kind, 'redirect');
  assert.equal(harness.repository.dailyDateKeys().includes('2025-12-31'), false);
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-01'), 1);

  // 23:59:59.999 Moscow still belongs to 2026-01-01.
  harness.clock.set('2026-01-01T20:59:59.999Z');
  await harness.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-01'), 2);
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-02'), 0);

  // 2026-01-01T22:30:00Z is 2026-01-02T01:30 Moscow -> calendar day 2026-01-02.
  harness.clock.set('2026-01-01T22:30:00.000Z');
  const third = await harness.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(third.kind, 'redirect');
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-02'), 1);
  assert.equal(harness.repository.lastRedirectAt(linkId), '2026-01-01T22:30:00.000Z');

  // Exactly midnight Moscow starts the next day.
  harness.clock.set('2026-01-01T21:00:00.000Z');
  await harness.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-02'), 2);
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-01'), 2);

  harness.clock.set('2026-01-02T10:00:00+03:00');
  const analytics = await harness.service.analytics(
    linkId,
    { from: '2026-01-01', to: '2026-01-03' },
    ADMIN
  );
  assert.deepEqual(analytics.daily, [
    { date: '2026-01-01', redirects: 2 },
    { date: '2026-01-02', redirects: 2 },
    { date: '2026-01-03', redirects: 0 }
  ]);
  assert.deepEqual(analytics.totals, {
    redirectsPeriod: 4,
    redirectsTotal: 4,
    // $max keeps the latest observed instant, even when a later test request carries an earlier clock.
    lastRedirectAt: '2026-01-01T22:30:00.000Z'
  });
  assert.equal(analytics.period.timezone, 'Europe/Moscow');
  assert.equal(analytics.period.from, '2025-12-31T21:00:00.000Z');
  assert.equal(analytics.period.to, '2026-01-03T20:59:59.999Z');
  assert.equal(analytics.link.code, created.item.code);

  const onlySecond = await harness.service.analytics(
    linkId,
    { from: '2026-01-02', to: '2026-01-02' },
    ADMIN
  );
  assert.equal(onlySecond.totals.redirectsPeriod, 2);
  assert.equal(onlySecond.totals.redirectsTotal, 4);
  assert.deepEqual(onlySecond.daily, [{ date: '2026-01-02', redirects: 2 }]);
  assert.equal(onlySecond.period.from, '2026-01-01T21:00:00.000Z');
  assert.equal(onlySecond.period.to, '2026-01-02T20:59:59.999Z');

  // Default period is the last 30 Moscow calendar days ending today.
  const defaultPeriod = await harness.service.analytics(linkId, {}, ADMIN);
  assert.equal(defaultPeriod.period.from, '2025-12-03T21:00:00.000Z');
  assert.equal(defaultPeriod.period.to, '2026-01-02T20:59:59.999Z');
  assert.equal(defaultPeriod.daily.length, 30);
  assert.equal(defaultPeriod.daily[0].date, '2025-12-04');
  assert.equal(defaultPeriod.daily[defaultPeriod.daily.length - 1].date, '2026-01-02');

  await expectServiceError(
    harness.service.analytics(linkId, { from: '2026/01/01' }, ADMIN),
    BadRequestException,
    'QR_LINK_PERIOD_INVALID'
  );
  await expectServiceError(
    harness.service.analytics(linkId, { from: '2026-01-05', to: '2026-01-01' }, ADMIN),
    BadRequestException,
    'QR_LINK_PERIOD_INVALID'
  );
  await expectServiceError(
    harness.service.analytics(linkId, { from: '2024-01-01', to: '2026-01-01' }, ADMIN),
    BadRequestException,
    'QR_LINK_PERIOD_TOO_LONG'
  );

  console.log('scenario 12: Europe/Moscow day boundary, period filtering and daily fill passed');
}

async function scenarioConcurrentAccounting(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-02T10:00:00+03:00' });
  const created = await harness.service.create(createDto(), { idempotencyKey: 'qr-idem-0401' }, ADMIN);
  const linkId = created.item.id;

  const results = await Promise.all(
    Array.from({ length: 100 }, () => harness.service.resolvePublic(created.item.code, publicRequest()))
  );
  assert.equal(results.length, 100);
  for (const result of results) {
    assert.equal(result.kind, 'redirect');
    assert.equal(result.kind === 'redirect' ? result.statsRecorded : false, true);
  }
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-02'), 100);
  assert.equal(harness.repository.totalRedirects(linkId), 100);
  assert.equal(harness.service.statsFailureTotal(), 0);

  // Non-accounted requests must not create lost/partial increments either.
  const nonAccounted: QrPublicResolution[] = [];
  for (let index = 0; index < 5; index += 1) {
    nonAccounted.push(await harness.service.resolvePublic(created.item.code, publicRequest({ method: 'HEAD' })));
  }
  for (const ua of [
    'TelegramBot (like TwitterBot)',
    'facebookexternalhit/1.1',
    'Slackbot-LinkExpanding 1.0',
    'WhatsApp/2.23',
    'Discordbot/2.0',
    'Twitterbot/1.0',
    'LinkedInBot/1.0'
  ]) {
    nonAccounted.push(
      await harness.service.resolvePublic(created.item.code, publicRequest({ userAgent: ua }))
    );
  }
  for (const headers of [
    { 'sec-purpose': 'prefetch' },
    { purpose: 'prerender' },
    { 'x-purpose': 'Prefetch' },
    { 'x-moz': 'prefetch' },
    { 'x-prefetch': '1' },
    { 'x-prefetch': 'true' }
  ]) {
    nonAccounted.push(
      await harness.service.resolvePublic(created.item.code, publicRequest({ headers }))
    );
  }
  for (const result of nonAccounted) {
    assert.equal(result.kind, 'redirect');
    assert.equal(result.kind === 'redirect' ? result.statsRecorded : true, false);
  }
  assert.equal(harness.repository.dailyCount(linkId, '2026-01-02'), 100);
  assert.equal(harness.repository.totalRedirects(linkId), 100);

  console.log('scenario 11: 100 concurrent GET resolutions -> exactly 100 increments passed');
}

async function scenarioReadEndpointsDoNotIncrement(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-02T10:00:00+03:00' });
  const created = await harness.service.create(
    createDto({ stationId: 'Yasenevo' }),
    { idempotencyKey: 'qr-idem-0501' },
    ADMIN
  );
  const linkId = created.item.id;
  await harness.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(harness.repository.totalRedirects(linkId), 1);

  const controller = new QrLinksAdminController(harness.service);
  const listed = await controller.list(ADMIN);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].redirectsTotal, 1);
  assert.equal(listed.items[0].redirectsPeriod, 1);
  const single = await controller.get(linkId, ADMIN);
  assert.equal(single.code, created.item.code);
  const stats = await controller.analytics(linkId, ADMIN);
  assert.equal(stats.totals.redirectsTotal, 1);
  const history = await controller.history(linkId, ADMIN);
  assert.equal(history.persistence, 'MONGODB');
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].action, 'CREATE QR_LINK');

  const imageResponse = new FakeApiResponse();
  await controller.image(linkId, ADMIN, 'png', imageResponse as unknown as Response);
  assert.equal(imageResponse.headers['Content-Type'], 'image/png');
  assert.equal(imageResponse.headers['Content-Disposition'], 'attachment; filename="qr-' + created.item.code + '.png"');
  assert.equal(imageResponse.headers['Cache-Control'], 'no-store');
  assert.equal(imageResponse.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.ok(Buffer.isBuffer(imageResponse.body));
  assert.deepEqual(
    (imageResponse.body as Buffer).subarray(0, 4),
    Buffer.from([0x89, 0x50, 0x4e, 0x47])
  );

  const svg = await harness.service.image(linkId, 'svg', ADMIN);
  assert.equal(svg.contentType, 'image/svg+xml; charset=utf-8');
  assert.equal(svg.filename, 'qr-' + created.item.code + '.svg');
  assert.equal(typeof svg.buffer, 'string');
  assert.match(String(svg.buffer), /<svg /);

  const svgResponse = new FakeApiResponse();
  await controller.image(linkId, ADMIN, undefined, svgResponse as unknown as Response);
  assert.equal(svgResponse.headers['Content-Type'], 'image/png');

  await expectServiceError(
    harness.service.image(linkId, 'jpg', ADMIN),
    BadRequestException,
    'QR_LINK_IMAGE_FORMAT_INVALID'
  );

  assert.equal(harness.repository.totalRedirects(linkId), 1, 'admin reads must never count as redirects');

  console.log('scenario 9: list/get/stats/history/image reads do not increment passed');
}

async function scenarioPublicStates(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-02T10:00:00+03:00' });
  const active = await harness.service.create(
    createDto({ name: 'Активный QR' }),
    { idempotencyKey: 'qr-idem-0601' },
    ADMIN
  );
  const paused = await harness.service.create(
    createDto({ name: 'Пауза QR', status: 'PAUSED' }),
    { idempotencyKey: 'qr-idem-0602' },
    ADMIN
  );
  const archived = await harness.service.create(
    createDto({ name: 'Архив QR' }),
    { idempotencyKey: 'qr-idem-0603' },
    ADMIN
  );
  await harness.service.update(
    archived.item.id,
    updateDto({ expectedVersion: 1, status: 'ARCHIVED' }),
    ADMIN
  );
  assert.equal(harness.repository.totalRedirects(), 0);

  assert.equal((await harness.service.resolvePublic(paused.item.code, publicRequest())).kind, 'paused');
  assert.equal((await harness.service.resolvePublic(archived.item.code, publicRequest())).kind, 'archived');
  assert.equal((await harness.service.resolvePublic('nosuchcode', publicRequest())).kind, 'not_found');
  assert.equal((await harness.service.resolvePublic('BAD CODE!', publicRequest())).kind, 'not_found');
  assert.equal((await harness.service.resolvePublic('UPPERCASE1', publicRequest())).kind, 'not_found');
  assert.equal(harness.repository.totalRedirects(), 0, 'non-active/unknown codes must not count');

  const pausedView = await harness.service.get(paused.item.id, ADMIN);
  assert.equal(pausedView.status, 'PAUSED');
  const archivedView = await harness.service.get(archived.item.id, ADMIN);
  assert.equal(archivedView.status, 'ARCHIVED');
  assert.equal(archivedView.archivedAt, '2026-01-02T07:00:00.000Z');

  // A stored destination that no longer passes the policy fails closed.
  const tampered = harness.repository.links.find((link) => link.id === active.item.id);
  assert.ok(tampered);
  tampered.targetUrl = 'http://padlhub.ru/legacy';
  await expectServiceError(
    harness.service.resolvePublic(active.item.code, publicRequest()),
    ServiceUnavailableException,
    'QR_LINK_TARGET_UNAVAILABLE'
  );
  assert.equal(harness.repository.totalRedirects(), 0);

  // Persistence outages fail closed for the public resolver too.
  harness.repository.unavailable = true;
  await expectServiceError(
    harness.service.resolvePublic(active.item.code, publicRequest()),
    ServiceUnavailableException,
    'QR_LINKS_PERSISTENCE_UNAVAILABLE'
  );

  console.log('scenario 10: paused/archived/unknown never increment; invalid target fails closed');
}

async function scenarioStatsFailureStillRedirects(): Promise<void> {
  const rejecting = createHarness({ clockIso: '2026-01-02T10:00:00+03:00', statsTimeoutMs: 50 });
  const created = await rejecting.service.create(createDto(), { idempotencyKey: 'qr-idem-0701' }, ADMIN);
  rejecting.repository.incrementMode = 'reject';
  const failed = await rejecting.service.resolvePublic(created.item.code, publicRequest());
  assert.equal(failed.kind, 'redirect');
  assert.equal(failed.kind === 'redirect' ? failed.location : '', 'https://padlhub.ru/annual');
  assert.equal(failed.kind === 'redirect' ? failed.statsRecorded : true, false);
  assert.equal(rejecting.repository.totalRedirects(), 0);
  assert.equal(rejecting.service.statsFailureTotal(), 1);

  const hanging = createHarness({ clockIso: '2026-01-02T10:00:00+03:00', statsTimeoutMs: 50 });
  const hangingCreated = await hanging.service.create(
    createDto(),
    { idempotencyKey: 'qr-idem-0702' },
    ADMIN
  );
  hanging.repository.incrementMode = 'hang';
  // The service timeout timer is unref'd on purpose; keep this test process alive while awaiting it.
  const keepAlive = setTimeout(() => undefined, 5_000);
  const startedAt = Date.now();
  let timedOut: QrPublicResolution = { kind: 'not_found' };
  try {
    timedOut = await hanging.service.resolvePublic(hangingCreated.item.code, publicRequest());
  } finally {
    clearTimeout(keepAlive);
  }
  const elapsed = Date.now() - startedAt;
  assert.equal(timedOut.kind, 'redirect');
  assert.equal(timedOut.kind === 'redirect' ? timedOut.location : '', 'https://padlhub.ru/annual');
  assert.equal(timedOut.kind === 'redirect' ? timedOut.statsRecorded : true, false);
  assert.equal(hanging.repository.totalRedirects(), 0);
  assert.equal(hanging.service.statsFailureTotal(), 1);
  assert.ok(elapsed >= 40, 'stats timeout must wait for the configured budget, elapsed=' + elapsed);
  assert.ok(elapsed < 2000, 'stats timeout must not stall the redirect, elapsed=' + elapsed);

  console.log('scenario 17: stats write failure/timeout still returns a redirect with statsRecorded=false');
}

async function scenarioAdminControllerMetadata(): Promise<void> {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, QrLinksAdminController), STAFF_ROLES);
  assert.equal(Reflect.getMetadata(PERMISSIONS_KEY, QrLinksAdminController), undefined);
  assert.equal(Reflect.getMetadata(PATH_METADATA, QrLinksAdminController), 'v1/admin/qr-links');
  assert.equal(Reflect.getMetadata(ROLES_KEY, QrLinksPublicController), undefined);
  assert.equal(Reflect.getMetadata(PERMISSIONS_KEY, QrLinksPublicController), undefined);
  assert.equal(Reflect.getMetadata(PATH_METADATA, QrLinksPublicController), 'q');
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, QrLinksPublicController.prototype.open),
    ':code'
  );

  const expected: Array<[string, string]> = [
    ['list', 'qr:read'],
    ['stations', 'qr:read'],
    ['create', 'qr:manage'],
    ['get', 'qr:read'],
    ['update', 'qr:manage'],
    ['analytics', 'qr:read'],
    ['history', 'qr:read'],
    ['image', 'qr:read']
  ];
  for (const [handler, permission] of expected) {
    assert.deepEqual(
      Reflect.getMetadata(PERMISSIONS_KEY, adminHandler(handler)),
      [permission],
      handler + ' must require ' + permission
    );
    if (handler !== 'image') {
      assert.deepEqual(
        Reflect.getMetadata(HEADERS_METADATA, adminHandler(handler)),
        [{ name: 'Cache-Control', value: 'private, no-store' }],
        handler + ' must be non-cacheable'
      );
    }
  }

  // Deny by default: anonymous callers and callers missing the endpoint permission are rejected.
  const anonymousList = createGuard(adminHandler('list'), { source: 'anonymous' });
  assert.equal(await anonymousList.guard.canActivate(anonymousList.context), false);
  const anonymousUpdate = createGuard(adminHandler('update'), { source: 'anonymous' });
  assert.equal(await anonymousUpdate.guard.canActivate(anonymousUpdate.context), false);
  assert.equal(anonymousUpdate.request.user, undefined);

  const readOnly = createGuard(adminHandler('list'), {
    source: 'token',
    user: makeUser({ permissions: ['qr:read'] })
  });
  assert.equal(await readOnly.guard.canActivate(readOnly.context), true);
  assert.equal((readOnly.request.user as RequestUser | undefined)?.id, 'staff:qr');
  assert.equal(readOnly.request.authSource, 'token');

  for (const handler of ['create', 'update']) {
    const denied = createGuard(adminHandler(handler), {
      source: 'token',
      user: makeUser({ permissions: ['qr:read'] })
    });
    assert.equal(
      await denied.guard.canActivate(denied.context),
      false,
      'qr:read must not authorize ' + handler
    );
  }
  for (const handler of ['list', 'stations', 'get', 'analytics', 'history', 'image']) {
    const denied = createGuard(adminHandler(handler), {
      source: 'token',
      user: makeUser({ permissions: ['qr:manage'] })
    });
    assert.equal(
      await denied.guard.canActivate(denied.context),
      false,
      'qr:manage alone must not authorize ' + handler
    );
  }
  const manager = createGuard(adminHandler('update'), {
    source: 'token',
    user: makeUser({ permissions: ['qr:read', 'qr:manage'] })
  });
  assert.equal(await manager.guard.canActivate(manager.context), true);
  const superAdmin = createGuard(adminHandler('create'), {
    source: 'token',
    user: makeUser({ roles: [Role.SUPER_ADMIN], permissions: ['*'] })
  });
  assert.equal(await superAdmin.guard.canActivate(superAdmin.context), true);

  // The admin controller exposes no query parameter on the public redirect handler.
  const publicArgs = Object.values(
    Reflect.getMetadata(ROUTE_ARGS_METADATA, QrLinksPublicController, 'open') ?? {}
  ) as Array<{ index: number; data?: string }>;
  assert.equal(publicArgs.length, 3);
  assert.deepEqual(
    publicArgs.map((arg) => (arg.data === undefined ? '<injected>' : arg.data)).sort(),
    ['<injected>', '<injected>', 'code']
  );

  console.log('scenario 13: roles/permissions metadata and RolesGuard deny-by-default passed');
}

async function scenarioManageScopeAndStationIsolation(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-02T10:00:00+03:00' });
  const admin = ADMIN;
  const yasenevo = await harness.service.create(
    createDto({ name: 'QR Ясенево', stationId: 'Yasenevo' }),
    { idempotencyKey: 'qr-idem-0801' },
    admin
  );
  const piter = await harness.service.create(
    createDto({ name: 'QR Питер', stationId: 'Piter' }),
    { idempotencyKey: 'qr-idem-0802' },
    admin
  );
  const global = await harness.service.create(
    createDto({ name: 'Общий QR' }),
    { idempotencyKey: 'qr-idem-0803' },
    admin
  );

  // A station-scoped reader only sees its own station; global links are invisible.
  const scopedList = await harness.service.list({}, SCOPED_READER);
  assert.deepEqual(scopedList.items.map((item) => item.id), [yasenevo.item.id]);
  assert.equal(scopedList.metrics.totalQr, 1);
  assert.equal(scopedList.metrics.activeQr, 1);
  assert.equal(scopedList.totalPages, 1);
  assert.equal(scopedList.period.timezone, 'Europe/Moscow');
  assert.equal(scopedList.persistence, 'MONGODB');
  const outOfScopeFilter = await harness.service.list({ stationId: 'Piter' }, SCOPED_READER);
  assert.deepEqual(outOfScopeFilter.items, []);
  assert.equal(outOfScopeFilter.metrics.totalQr, 0);

  // Out-of-scope reads are a 404 (existence is not leaked).
  await expectServiceError(
    harness.service.get(piter.item.id, SCOPED_READER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  await expectServiceError(
    harness.service.get(global.item.id, SCOPED_READER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  await expectServiceError(
    harness.service.analytics(piter.item.id, {}, SCOPED_READER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  await expectServiceError(
    harness.service.history(piter.item.id, SCOPED_READER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  await expectServiceError(
    harness.service.image(piter.item.id, 'png', SCOPED_READER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  assert.equal((await harness.service.get(yasenevo.item.id, SCOPED_READER)).id, yasenevo.item.id);

  // Station-scoped creation must pick a station inside the manage scope.
  await expectServiceError(
    harness.service.create(
      createDto({ name: 'QR вне зоны', stationId: 'Piter' }),
      { idempotencyKey: 'qr-idem-0804' },
      SCOPED_MANAGER
    ),
    ForbiddenException,
    'QR_STATION_OUT_OF_SCOPE'
  );
  await expectServiceError(
    harness.service.create(createDto({ name: 'QR без станции' }), { idempotencyKey: 'qr-idem-0805' }, SCOPED_MANAGER),
    ForbiddenException,
    'QR_STATION_REQUIRED'
  );
  const scopedCreated = await harness.service.create(
    createDto({ name: 'QR менеджера', stationId: 'Yasenevo' }),
    { idempotencyKey: 'qr-idem-0806' },
    SCOPED_MANAGER
  );
  assert.equal(scopedCreated.item.stationId, 'Yasenevo');
  assert.equal(scopedCreated.item.stationName, 'Ясенево');

  // Moving a link outside the manage scope is rejected.
  await expectServiceError(
    harness.service.update(
      yasenevo.item.id,
      updateDto({ expectedVersion: 1, stationId: 'Piter' }),
      SCOPED_MANAGER
    ),
    ForbiddenException,
    'QR_STATION_OUT_OF_SCOPE'
  );
  // Managing a link outside the manage scope is a 404 (existence is not leaked).
  await expectServiceError(
    harness.service.update(piter.item.id, updateDto({ expectedVersion: 1, name: 'Чужой QR' }), SCOPED_MANAGER),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );
  const scopedRenamed = await harness.service.update(
    yasenevo.item.id,
    updateDto({ expectedVersion: 1, name: 'QR Ясенево обновлён' }),
    SCOPED_MANAGER
  );
  assert.equal(scopedRenamed.name, 'QR Ясенево обновлён');
  assert.equal(scopedRenamed.code, yasenevo.item.code);

  // A user without qr:manage permission is denied by the route guard (see scenario 13).
  const noManageScope = makeUser({
    id: 'staff:no-manage',
    permissions: ['qr:read'],
    stationIds: ['Piter'],
    permissionStationScopes: { 'qr:read': ['Piter'], 'qr:manage': ['Piter'] }
  });
  await expectServiceError(
    harness.service.update(yasenevo.item.id, updateDto({ expectedVersion: 2, name: 'Взлом' }), noManageScope),
    NotFoundException,
    'QR_LINK_NOT_FOUND'
  );

  // Unrestricted staff see everything, including global QR links.
  const all = await harness.service.list({}, ADMIN);
  assert.equal(all.metrics.totalQr, 4);
  assert.deepEqual(
    all.items.map((item) => item.stationId).sort(),
    [null, 'Piter', 'Yasenevo', 'Yasenevo'].sort()
  );
  const stations = await harness.service.stationOptions(SCOPED_READER);
  assert.deepEqual(stations.items.map((item) => item.stationId), ['Yasenevo']);
  assert.equal(stations.items[0].stationName, 'Ясенево');

  console.log('scenario 14+15: manage scope and station isolation passed');
}

async function scenarioAuditTrail(): Promise<void> {
  const harness = createHarness({ clockIso: '2026-01-02T10:00:00+03:00' });
  const created = await harness.service.create(
    createDto({ name: 'Сезонный QR' }),
    { idempotencyKey: 'qr-idem-0901' },
    ADMIN
  );
  const linkId = created.item.id;
  assert.equal(harness.auth.entries.length, 1);
  const createEntry = harness.auth.entries[0];
  assert.equal(createEntry.action, 'CREATE QR_LINK');
  assert.equal(createEntry.targetId, linkId);
  assert.equal(createEntry.actor?.id, ADMIN.id);
  assert.equal(createEntry.metadata?.code, created.item.code);
  assert.equal(createEntry.metadata?.targetUrl, 'https://padlhub.ru/annual');
  assert.equal(createEntry.metadata?.status, 'ACTIVE');
  assert.equal(createEntry.metadata?.stationId, null);

  harness.clock.set('2026-01-02T11:00:00+03:00');
  const updated = await harness.service.update(
    linkId,
    updateDto({
      expectedVersion: 1,
      targetUrl: 'https://padlhub.ru/new-year',
      stationId: 'Yasenevo'
    }),
    ADMIN
  );
  assert.equal(updated.version, 2);
  const updateEntry = harness.auth.entries[1];
  assert.equal(updateEntry.action, 'UPDATE QR_LINK');
  assert.equal(updateEntry.targetId, linkId);
  assert.equal(updateEntry.actor?.id, ADMIN.id);
  assert.equal(updateEntry.actor?.login, 'qr_admin');
  assert.equal(updateEntry.metadata?.fields, 'stationId,targetUrl');
  assert.equal(updateEntry.metadata?.old_targetUrl, 'https://padlhub.ru/annual');
  assert.equal(updateEntry.metadata?.new_targetUrl, 'https://padlhub.ru/new-year');
  assert.equal(updateEntry.metadata?.old_stationId, '');
  assert.equal(updateEntry.metadata?.new_stationId, 'Yasenevo');
  assert.equal(updateEntry.metadata?.expectedVersion, 1);
  assert.equal(updateEntry.metadata?.version, 2);

  harness.clock.set('2026-01-02T12:00:00+03:00');
  await harness.service.update(
    linkId,
    updateDto({ expectedVersion: 2, status: 'PAUSED' }),
    ADMIN
  );
  const pauseEntry = harness.auth.entries[2];
  assert.equal(pauseEntry.action, 'UPDATE QR_LINK');
  assert.equal(pauseEntry.metadata?.fields, 'status');
  assert.equal(pauseEntry.metadata?.old_status, 'ACTIVE');
  assert.equal(pauseEntry.metadata?.new_status, 'PAUSED');

  harness.clock.set('2026-01-02T13:00:00+03:00');
  const archived = await harness.service.update(
    linkId,
    updateDto({ expectedVersion: 3, status: 'ARCHIVED' }),
    ADMIN
  );
  assert.equal(archived.status, 'ARCHIVED');
  const archiveEntry = harness.auth.entries[3];
  assert.equal(archiveEntry.action, 'ARCHIVE QR_LINK');
  assert.equal(archiveEntry.metadata?.old_status, 'PAUSED');
  assert.equal(archiveEntry.metadata?.new_status, 'ARCHIVED');
  assert.equal(archiveEntry.metadata?.version, 4);

  const history = await harness.service.history(linkId, ADMIN);
  assert.equal(history.persistence, 'MONGODB');
  assert.deepEqual(
    history.items.map((item) => item.action),
    ['ARCHIVE QR_LINK', 'UPDATE QR_LINK', 'UPDATE QR_LINK', 'CREATE QR_LINK']
  );
  assert.equal(history.items[0].actorLogin, 'qr_admin');
  assert.equal(history.items[0].metadata?.new_status, 'ARCHIVED');
  assert.equal(history.items[1].metadata?.new_status, 'PAUSED');
  assert.equal(history.items[3].metadata?.targetUrl, 'https://padlhub.ru/annual');

  // With audit persistence disabled the service still works and history is explicitly DISABLED.
  harness.auth.enabled = false;
  const disabledHistory = await harness.service.history(linkId, ADMIN);
  assert.deepEqual(disabledHistory, { items: [], persistence: 'DISABLED' });
  const beforeDisabledCreate = harness.auth.entries.length;
  const unaudited = await harness.service.create(
    createDto({ name: 'QR без аудита' }),
    { idempotencyKey: 'qr-idem-0902' },
    ADMIN
  );
  assert.equal(unaudited.replayed, false);
  assert.equal(harness.auth.entries.length, beforeDisabledCreate);

  console.log('scenario 19: create/update/archive audit entries with old/new metadata passed');
}

async function scenarioArchivedCodeNeverReused(): Promise<void> {
  const harness = createHarness({
    clockIso: '2026-01-02T10:00:00+03:00',
    codes: ['reusecode1', 'reusecode1', 'freshcode2']
  });
  const first = await harness.service.create(
    createDto({ name: 'Первый QR' }),
    { idempotencyKey: 'qr-idem-1001' },
    ADMIN
  );
  assert.equal(first.item.code, 'reusecode1');
  await harness.service.update(
    first.item.id,
    updateDto({ expectedVersion: 1, status: 'ARCHIVED' }),
    ADMIN
  );
  assert.equal(harness.repository.links[0].status, 'ARCHIVED');
  assert.equal(harness.repository.links[0].code, 'reusecode1');

  // The generator hands out the archived code twice; unique(code) must force a retry.
  const second = await harness.service.create(
    createDto({ name: 'Второй QR' }),
    { idempotencyKey: 'qr-idem-1002' },
    ADMIN
  );
  assert.equal(second.item.code, 'freshcode2');
  assert.notEqual(second.item.code, first.item.code);
  assert.equal(isQrLinkCode(second.item.code), true);
  assert.equal(harness.repository.links.length, 2);
  assert.equal(
    harness.repository.links.filter((link) => link.code === 'reusecode1').length,
    1,
    'the archived code must stay unique to the archived link'
  );
  assert.equal(
    harness.repository.links.filter((link) => link.status === 'ARCHIVED').length,
    1
  );
  assert.equal(
    harness.repository.links.find((link) => link.code === 'freshcode2')?.status,
    'ACTIVE'
  );

  // Exhausting all generation attempts surfaces a stable conflict instead of reusing a code.
  let attempts = 0;
  const stuck = createHarness({
    clockIso: '2026-01-02T10:00:00+03:00',
    codeGenerator: () => {
      attempts += 1;
      return 'onlyonecode';
    }
  });
  const seeded = await stuck.service.create(
    createDto({ name: 'Занятый код' }),
    { idempotencyKey: 'qr-idem-1003' },
    ADMIN
  );
  assert.equal(seeded.item.code, 'onlyonecode');
  assert.equal(attempts, 1);
  await expectServiceError(
    stuck.service.create(
      createDto({ name: 'Не повезло' }),
      { idempotencyKey: 'qr-idem-1004' },
      ADMIN
    ),
    ConflictException,
    'QR_LINK_CODE_GENERATION_FAILED'
  );
  assert.equal(attempts, 6, 'create must retry the generator exactly 5 times then fail');
  assert.equal(stuck.repository.links.length, 1);

  console.log('scenario 20: archived codes are never reused; exhausted retries fail cleanly passed');
}

async function scenarioAllowedHostsSetting(): Promise<void> {
  const harness = createHarness();
  const initial = await harness.service.allowedHosts();
  assert.deepEqual(initial.extra, []);
  assert.equal(initial.defaults.includes('padlhub.ru'), true);
  assert.equal(initial.version, 0);

  await expectServiceError(
    harness.service.create(
      createDto({ targetUrl: 'https://lk.padlhub.ru/page' }),
      { idempotencyKey: 'qr-idem-hosts-0001' },
      ADMIN
    ),
    BadRequestException,
    'QR_TARGET_URL_HOST_NOT_ALLOWED'
  );

  const updated = await harness.service.updateAllowedHosts(
    { hosts: ['lk.padlhub.ru', '*.cdn.padlhub.ru', 'lk.padlhub.ru'] },
    ADMIN
  );
  assert.deepEqual(updated.extra, ['lk.padlhub.ru', '*.cdn.padlhub.ru']);
  assert.equal(updated.version, 1);
  assert.equal(updated.updatedBy, ADMIN.id);

  const created = await harness.service.create(
    createDto({ targetUrl: 'https://lk.padlhub.ru/page?utm=qr' }),
    { idempotencyKey: 'qr-idem-hosts-0002' },
    ADMIN
  );
  assert.equal(created.item.targetUrl, 'https://lk.padlhub.ru/page?utm=qr');
  const resolved = await harness.service.resolvePublic(
    created.item.code,
    publicRequest()
  );
  assert.equal(resolved.kind, 'redirect');
  if (resolved.kind === 'redirect') {
    assert.equal(resolved.location, 'https://lk.padlhub.ru/page?utm=qr');
  }

  for (const badHost of ['https://lk.padlhub.ru', 'lk.padlhub.ru/path', '10.0.0.1', 'localhost', '*']) {
    await expectServiceError(
      harness.service.updateAllowedHosts({ hosts: [badHost] }, ADMIN),
      BadRequestException,
      'QR_ALLOWED_HOST_INVALID'
    );
  }

  await expectServiceError(
    harness.service.updateAllowedHosts({ hosts: [] }, SCOPED_MANAGER),
    ForbiddenException,
    'QR_ALLOWED_HOSTS_GLOBAL_SCOPE_REQUIRED'
  );
  await expectServiceError(
    harness.service.updateAllowedHosts(
      { hosts: [] },
      makeUser({ permissions: ['qr:read', 'qr:manage'] })
    ),
    ForbiddenException,
    'QR_ALLOWED_HOSTS_SETTINGS_PERMISSION_REQUIRED'
  );
  await expectServiceError(
    harness.service.updateAllowedHosts({ hosts: [], expectedVersion: 0 }, ADMIN),
    ConflictException,
    'QR_ALLOWED_HOSTS_VERSION_CONFLICT'
  );

  const audit = harness.auth.entries.find(
    (entry) => entry.action === 'UPDATE QR_LINKS_ALLOWED_HOSTS'
  );
  assert.ok(audit);
  assert.equal(audit.actor?.id, ADMIN.id);
  assert.equal(audit.metadata?.new_hosts, 'lk.padlhub.ru,*.cdn.padlhub.ru');

  // Removing an extra host blocks new links but must not break already printed QR.
  const cleared = await harness.service.updateAllowedHosts(
    { hosts: [], expectedVersion: 1 },
    ADMIN
  );
  assert.deepEqual(cleared.extra, []);
  await expectServiceError(
    harness.service.create(
      createDto({ targetUrl: 'https://lk.padlhub.ru/new' }),
      { idempotencyKey: 'qr-idem-hosts-0003' },
      ADMIN
    ),
    BadRequestException,
    'QR_TARGET_URL_HOST_NOT_ALLOWED'
  );
  const stillWorks = await harness.service.resolvePublic(
    created.item.code,
    publicRequest()
  );
  assert.equal(stillWorks.kind, 'redirect');

  console.log('scenario 20b: configurable allowed target hosts passed');
}

async function main(): Promise<void> {
  await scenarioCreateAndIdempotency();
  await scenarioPatchKeepsPermanentIdentity();
  await scenarioVersionConflict();
  await scenarioMoscowDayBoundary();
  await scenarioConcurrentAccounting();
  await scenarioReadEndpointsDoNotIncrement();
  await scenarioPublicStates();
  await scenarioStatsFailureStillRedirects();
  await scenarioAdminControllerMetadata();
  await scenarioManageScopeAndStationIsolation();
  await scenarioAuditTrail();
  await scenarioArchivedCodeNeverReused();
  await scenarioAllowedHostsSetting();
  console.log('QR links service acceptance tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
