import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { MessengerService } from '../src/messenger/messenger.service';
import { CreateQrLinkDto } from '../src/qr-links/dto/create-qr-link.dto';
import { QrCodeImageService } from '../src/qr-links/qr-code-image.service';
import { QrLinksPublicController } from '../src/qr-links/qr-links.controller';
import { QrLinksRepository } from '../src/qr-links/qr-links.repository';
import { QrLinksService } from '../src/qr-links/qr-links.service';
import { StoredQrLink } from '../src/qr-links/qr-links.types';
import { QrTargetUrlPolicy } from '../src/qr-links/qr-target-url-policy';

const PUBLIC_URL = 'https://padlhub.su';
const POLICY = new QrTargetUrlPolicy({
  QR_LINKS_PUBLIC_BASE_URL: PUBLIC_URL,
  QR_LINKS_ALLOWED_TARGET_HOSTS: 'padlhub.su,www.padlhub.su,padlhub.ru',
  QR_LINKS_ALLOWED_TARGET_PORTS: '443'
} as NodeJS.ProcessEnv);

const ADMIN: RequestUser = {
  id: 'admin:qr-public',
  login: 'qr_public_admin',
  title: 'Администратор QR',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  stationIds: [],
  connectorRoutes: []
};

class FakeDuplicateKeyError extends Error {
  readonly code = 11000;
  readonly keyPattern: Record<string, 1>;

  constructor(keyPattern: Record<string, 1>) {
    super('E11000 duplicate key error');
    this.name = 'FakeDuplicateKeyError';
    this.keyPattern = keyPattern;
  }
}

class InMemoryQrLinksRepository {
  readonly links: StoredQrLink[] = [];
  readonly redirects = new Map<string, number>();
  unavailable = false;
  incrementMode: 'ok' | 'reject' = 'ok';

  isDuplicateKey(error: unknown): boolean {
    return error instanceof FakeDuplicateKeyError && error.code === 11000;
  }

  duplicateKeyFields(error: unknown): string[] {
    return error instanceof FakeDuplicateKeyError ? Object.keys(error.keyPattern) : [];
  }

  requireAvailable(): void {
    if (this.unavailable) throw new Error('QR links persistence is unavailable');
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

  async getAllowedHostsSettings(): Promise<null> {
    this.requireAvailable();
    return null;
  }

  async insertLink(link: StoredQrLink): Promise<void> {
    this.requireAvailable();
    if (this.links.some((existing) => existing.code === link.code)) {
      throw new FakeDuplicateKeyError({ code: 1 });
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

  incrementDailyRedirect(qrId: string, dateKey: string): Promise<void> {
    if (this.incrementMode === 'reject') {
      return Promise.reject(new Error('synthetic stats write failure'));
    }
    const key = qrId + '|' + dateKey;
    this.redirects.set(key, (this.redirects.get(key) ?? 0) + 1);
    return Promise.resolve();
  }

  totalRedirects(): number {
    return [...this.redirects.values()].reduce((sum, count) => sum + count, 0);
  }
}

class FakeAuthPersistence {
  isEnabled(): boolean {
    return false;
  }

  async appendAudit(): Promise<void> {
    return undefined;
  }

  async listAudit(): Promise<unknown[]> {
    return [];
  }
}

class FakeMessenger {
  listStationConfigs(): Array<{ stationId: string; stationName: string; isActive: boolean }> {
    return [];
  }
}

class FakeExpressResponse {
  readonly headers: Record<string, string> = {};
  readonly calls: string[] = [];
  statusCode?: number;
  contentType?: string;
  body?: unknown;
  redirectStatus?: number;
  redirectLocation?: string;

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    this.calls.push('status');
    return this;
  }

  type(value: string): this {
    this.contentType = value;
    this.calls.push('type');
    return this;
  }

  send(body: unknown): this {
    this.body = body;
    this.calls.push('send');
    return this;
  }

  redirect(status: number, location: string): this {
    this.redirectStatus = status;
    this.redirectLocation = location;
    this.statusCode = status;
    this.calls.push('redirect');
    return this;
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string>;
  originalUrl?: string;
}

function fakeRequest(options: RequestOptions = {}): Request {
  return {
    method: options.method ?? 'GET',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      ...(options.headers ?? {})
    },
    query: options.query ?? {},
    originalUrl: options.originalUrl ?? '/q/placeholder'
  } as unknown as Request;
}

interface Harness {
  repository: InMemoryQrLinksRepository;
  service: QrLinksService;
  controller: QrLinksPublicController;
}

function createHarness(options: { incrementMode?: 'ok' | 'reject' } = {}): Harness {
  const repository = new InMemoryQrLinksRepository();
  repository.incrementMode = options.incrementMode ?? 'ok';
  let sequence = 0;
  const service = new QrLinksService(
    repository as unknown as QrLinksRepository,
    new QrCodeImageService(),
    new FakeAuthPersistence() as unknown as AuthPersistenceService,
    new FakeMessenger() as unknown as MessengerService,
    POLICY,
    () => {
      sequence += 1;
      return 'qr' + String(sequence).padStart(8, '0');
    },
    () => new Date('2026-01-02T10:00:00+03:00')
  );
  return { repository, service, controller: new QrLinksPublicController(service) };
}

function createDto(overrides: Partial<CreateQrLinkDto> = {}): CreateQrLinkDto {
  return {
    name: 'QR на сезон',
    targetUrl: 'https://padlhub.ru/annual',
    status: 'ACTIVE',
    ...overrides
  };
}

function assertNoStoreHeaders(response: FakeExpressResponse): void {
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
}

function assertHtmlPage(
  response: FakeExpressResponse,
  status: number,
  expectedText: string
): void {
  assert.equal(response.statusCode, status);
  assert.equal(response.contentType, 'html');
  assert.equal(typeof response.body, 'string');
  const body = String(response.body);
  assert.match(body, /^<!doctype html>/);
  assert.ok(body.includes(expectedText), 'page must explain the state: ' + expectedText);
  assert.match(body, /<meta name="robots" content="noindex, nofollow"/);
  assert.equal(response.calls.includes('redirect'), false);
  assertNoStoreHeaders(response);
}

async function main(): Promise<void> {
  const harness = createHarness();
  const created = await harness.service.create(
    createDto(),
    { idempotencyKey: 'qr-public-0001' },
    ADMIN
  );
  const code = created.item.code;
  assert.match(code, /^[a-z0-9]{10}$/);
  assert.equal(created.item.shortUrl, PUBLIC_URL + '/q/' + code);

  // Scenario 3: an active permanent code redirects to the stored destination.
  const redirectResponse = new FakeExpressResponse();
  await harness.controller.open(code, fakeRequest(), redirectResponse as unknown as Response);
  assert.equal(redirectResponse.redirectStatus, 302, 'permanent short links use a temporary redirect');
  assert.equal(redirectResponse.redirectLocation, 'https://padlhub.ru/annual');
  assert.equal(redirectResponse.statusCode, 302);
  assert.equal(redirectResponse.body, undefined);
  assert.equal(harness.repository.totalRedirects(), 1);

  // Scenario 4: redirect responses are never cached or indexed.
  assertNoStoreHeaders(redirectResponse);

  // Scenario 7: hostile public query strings can never override the stored destination.
  const queryCases = [
    '?url=https://evil.example/steal',
    '?next=//evil.example',
    '?redirect=javascript:alert(1)',
    '?url=https%3A%2F%2Fevil.example%2F&next=https%3A%2F%2Fevil.example%2F',
    '?url=https://padlhub.ru/annual&next=javascript:alert(1)&redirect=//evil.example'
  ];
  for (const queryString of queryCases) {
    const response = new FakeExpressResponse();
    const query: Record<string, string> = {};
    for (const pair of queryString.slice(1).split('&')) {
      const separator = pair.indexOf('=');
      query[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(pair.slice(separator + 1));
    }
    await harness.controller.open(
      code,
      fakeRequest({ query, originalUrl: '/q/' + code + queryString }),
      response as unknown as Response
    );
    assert.equal(
      response.redirectLocation,
      'https://padlhub.ru/annual',
      'query string must not alter Location for ' + queryString
    );
  }
  assert.equal(harness.repository.totalRedirects(), 1 + queryCases.length);

  // Scenario 8: HEAD resolves the same redirect but is not counted.
  const headCountBefore = harness.repository.totalRedirects();
  const headResponse = new FakeExpressResponse();
  await harness.controller.open(code, fakeRequest({ method: 'HEAD' }), headResponse as unknown as Response);
  assert.equal(headResponse.redirectStatus, 302);
  assert.equal(headResponse.redirectLocation, 'https://padlhub.ru/annual');
  assert.equal(harness.repository.totalRedirects(), headCountBefore);
  assertNoStoreHeaders(headResponse);

  // Link-preview bots and prefetches are never counted either.
  const botResponse = new FakeExpressResponse();
  await harness.controller.open(
    code,
    fakeRequest({ headers: { 'user-agent': 'TelegramBot (like TwitterBot)' } }),
    botResponse as unknown as Response
  );
  assert.equal(botResponse.redirectStatus, 302);
  assert.equal(harness.repository.totalRedirects(), headCountBefore);
  const prefetchResponse = new FakeExpressResponse();
  await harness.controller.open(
    code,
    fakeRequest({ headers: { 'sec-purpose': 'prefetch', 'user-agent': 'Mozilla/5.0' } }),
    prefetchResponse as unknown as Response
  );
  assert.equal(prefetchResponse.redirectStatus, 302);
  assert.equal(harness.repository.totalRedirects(), headCountBefore);

  // Scenario 10: paused / archived / unknown codes render state pages and never count.
  const paused = await harness.service.create(
    createDto({ name: 'QR Пауза', status: 'PAUSED' }),
    { idempotencyKey: 'qr-public-0002' },
    ADMIN
  );
  const archived = await harness.service.create(
    createDto({ name: 'QR Архив' }),
    { idempotencyKey: 'qr-public-0003' },
    ADMIN
  );
  await harness.service.update(
    archived.item.id,
    { expectedVersion: 1, status: 'ARCHIVED' },
    ADMIN
  );
  const countBeforeStates = harness.repository.totalRedirects();

  const pausedResponse = new FakeExpressResponse();
  await harness.controller.open(
    paused.item.code,
    fakeRequest(),
    pausedResponse as unknown as Response
  );
  assertHtmlPage(pausedResponse, 200, 'QR-код временно неактивен');

  const archivedResponse = new FakeExpressResponse();
  await harness.controller.open(
    archived.item.code,
    fakeRequest(),
    archivedResponse as unknown as Response
  );
  assertHtmlPage(archivedResponse, 410, 'QR-код больше не действует');

  const unknownResponse = new FakeExpressResponse();
  await harness.controller.open('nosuchcode', fakeRequest(), unknownResponse as unknown as Response);
  assertHtmlPage(unknownResponse, 404, 'QR-код не найден');

  const invalidFormatResponse = new FakeExpressResponse();
  await harness.controller.open(
    'BAD CODE!',
    fakeRequest({ query: { url: 'https://evil.example' } }),
    invalidFormatResponse as unknown as Response
  );
  assertHtmlPage(invalidFormatResponse, 404, 'QR-код не найден');

  assert.equal(
    harness.repository.totalRedirects(),
    countBeforeStates,
    'paused/archived/unknown codes must not increment redirect counters'
  );

  // Scenario 10/17: a destination rejected by the policy fails closed with a 503 page.
  harness.repository.links[0].targetUrl = 'http://padlhub.ru/legacy';
  const rejectedTargetResponse = new FakeExpressResponse();
  await harness.controller.open(code, fakeRequest(), rejectedTargetResponse as unknown as Response);
  assertHtmlPage(rejectedTargetResponse, 503, 'QR-код временно недоступен');
  assert.equal(harness.repository.totalRedirects(), countBeforeStates);

  // Lead note (d): the public controller catches storage failures as 503, still no-store.
  harness.repository.unavailable = true;
  const unavailableResponse = new FakeExpressResponse();
  await harness.controller.open(code, fakeRequest(), unavailableResponse as unknown as Response);
  assertHtmlPage(unavailableResponse, 503, 'QR-код временно недоступен');
  harness.repository.unavailable = false;

  // Scenario 17: a failing stats write must not block the redirect.
  const rejectingHarness = createHarness({ incrementMode: 'reject' });
  const rejectingCreated = await rejectingHarness.service.create(
    createDto(),
    { idempotencyKey: 'qr-public-0004' },
    ADMIN
  );
  const failedStatsResponse = new FakeExpressResponse();
  await rejectingHarness.controller.open(
    rejectingCreated.item.code,
    fakeRequest(),
    failedStatsResponse as unknown as Response
  );
  assert.equal(failedStatsResponse.redirectStatus, 302);
  assert.equal(failedStatsResponse.redirectLocation, 'https://padlhub.ru/annual');
  assert.equal(rejectingHarness.repository.totalRedirects(), 0);
  assert.equal(rejectingHarness.service.statsFailureTotal(), 1);
  assertNoStoreHeaders(failedStatsResponse);

  console.log('QR links public redirect controller tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
