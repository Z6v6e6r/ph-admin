import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { AuthService } from '../src/auth/auth.service';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import {
  ResidencyCheckAssetController,
  ResidencyCheckPageController
} from '../src/residency-check/residency-check-page.controller';

const ENV_KEYS = [
  'RESIDENCY_CHECK_ENABLED',
  'RESIDENCY_CHECK_STATION_LABELS',
  'RESIDENCY_CHECK_DEMO_MODE',
  'NODE_ENV'
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

type ResolvedUser = {
  user?: RequestUser;
  source: 'token' | 'anonymous' | 'headers';
};

function createAuthService(options: {
  enabled?: boolean;
  source?: 'token' | 'anonymous' | 'headers';
  user?: RequestUser;
  staff?: boolean;
  calls?: { resolve: number };
}): AuthService {
  const enabled = options.enabled !== false;
  const calls = options.calls ?? { resolve: 0 };
  return {
    isEnabled: () => enabled,
    resolveUserFromRequest: async (): Promise<ResolvedUser> => {
      calls.resolve += 1;
      return { user: options.user, source: options.source ?? 'anonymous' };
    },
    hasStaffAccess: () => options.staff !== false
  } as unknown as AuthService;
}

function createResponseCapture(): {
  response: Response;
  getHtml: () => string;
  getStatus: () => number;
  getRedirect: () => string | null;
  getHeader: (name: string) => string | undefined;
  getSentFile: () => string | null;
} {
  let html = '';
  let status = 200;
  let redirect: string | null = null;
  let sentFile: string | null = null;
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      status = code;
      return this;
    },
    send(payload: string) {
      html = payload;
      return this;
    },
    redirect(url: string) {
      redirect = url;
      status = 302;
      return this;
    },
    sendFile(filePath: string) {
      sentFile = filePath;
      return this;
    }
  } as unknown as Response;
  return {
    response,
    getHtml: () => html,
    getStatus: () => status,
    getRedirect: () => redirect,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    getSentFile: () => sentFile
  };
}

function createRequest(originalUrl: string): Request {
  return {
    protocol: 'https',
    originalUrl,
    get: (name: string) => (name.toLowerCase() === 'host' ? 'padlhub.su' : undefined),
    headers: {}
  } as unknown as Request;
}

function staffUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'staff-1',
    login: 'staff_one',
    roles: [Role.STATION_ADMIN],
    roleIds: [Role.STATION_ADMIN],
    permissions: ['resident-services:issue', 'resident-services:read', 'resident-services:return'],
    permissionStationScopes: {},
    stationIds: ['Piter'],
    connectorRoutes: [],
    authSource: 'token',
    ...overrides
  };
}

function parseConfig(html: string): Record<string, unknown> {
  const match = /window\.__PHAB_RESIDENCY_CHECK_CONFIG__ = (\{[\s\S]*?\});/.exec(html);
  assert.ok(match && match[1], 'page must embed the residency check config object');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

const defaultPageUrl = '/api/ui/admin/residency/check?pass=pass-abc';
const enabledStaffAuth = (user: RequestUser = staffUser()) =>
  createAuthService({ enabled: true, source: 'token', user, staff: true });

async function expectShell(
  authService: AuthService,
  query: { pass?: string; token?: string; stationId?: string } = { pass: 'pass-abc' },
  originalUrl = defaultPageUrl
): Promise<{ capture: ReturnType<typeof createResponseCapture>; config: Record<string, unknown>; html: string }> {
  const controller = new ResidencyCheckPageController(authService);
  const capture = createResponseCapture();
  await controller.residencyCheckPage(createRequest(originalUrl), capture.response, query);
  const html = capture.getHtml();
  assert.equal(capture.getStatus(), 200);
  assert.equal(capture.getRedirect(), null);
  return { capture, config: parseConfig(html), html };
}

async function main(): Promise<void> {
  const assetController = new ResidencyCheckAssetController();
  const jsCapture = createResponseCapture();
  assetController.streamResidencyCheckScript(jsCapture.response);
  assert.match(jsCapture.getSentFile() ?? '', /client-sdk[\\/]phab-residency-check\.js$/);
  assert.equal(jsCapture.getHeader('content-type'), 'application/javascript; charset=utf-8');
  assert.match(jsCapture.getHeader('cache-control') ?? '', /no-store/);
  const cssCapture = createResponseCapture();
  assetController.streamResidencyCheckStyles(cssCapture.response);
  assert.match(cssCapture.getSentFile() ?? '', /client-sdk[\\/]phab-residency-check\.css$/);
  assert.equal(cssCapture.getHeader('content-type'), 'text/css; charset=utf-8');
  assert.match(cssCapture.getHeader('cache-control') ?? '', /no-store/);

  process.env.RESIDENCY_CHECK_ENABLED = 'true';

  {
    const calls = { resolve: 0 };
    const authService = createAuthService({ enabled: true, source: 'anonymous', calls });
    const controller = new ResidencyCheckPageController(authService);
    const capture = createResponseCapture();
    await controller.residencyCheckPage(
      createRequest('/api/ui/admin/residency/check?pass=pass-abc&stationId=Piter'),
      capture.response,
      { pass: 'pass-abc', stationId: 'Piter' }
    );
    assert.equal(capture.getStatus(), 302);
    assert.equal(
      capture.getRedirect(),
      '/api/ui/admin/login?next=' +
        encodeURIComponent('/api/ui/admin/residency/check?pass=pass-abc&stationId=Piter')
    );
    assert.equal(calls.resolve, 1);
    assert.equal(capture.getHeader('cache-control'), 'private, no-store');
    assert.equal(capture.getHeader('referrer-policy'), 'no-referrer');
  }

  {
    const authService = createAuthService({
      enabled: true,
      source: 'token',
      user: staffUser({ roles: [Role.MANAGER] }),
      staff: false
    });
    const controller = new ResidencyCheckPageController(authService);
    const capture = createResponseCapture();
    await controller.residencyCheckPage(createRequest(defaultPageUrl), capture.response, {
      pass: 'pass-abc'
    });
    assert.equal(capture.getStatus(), 302, 'non-staff users are redirected to the CUP login (mirrors UiController)');
    assert.ok((capture.getRedirect() ?? '').startsWith('/api/ui/admin/login?next='));
  }

  {
    const { capture, config, html } = await expectShell(enabledStaffAuth());
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /<meta name="theme-color" content="#330020" \/>/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
    assert.match(html, /<div id="phab-residency-check-root">/);
    assert.match(html, /<div class="phab-rc-boot"/);
    assert.match(html, /<noscript>/);
    assert.match(html, /<link rel="stylesheet" href="\/api\/client-script\/residency-check.css" \/>/);
    assert.match(html, /<script src="\/api\/client-script\/residency-check.js"><\/script>/);
    assert.match(html, /window\.__PHAB_RESIDENCY_CHECK_CONFIG__ = /);

    assert.equal(config.passToken, 'pass-abc');
    assert.equal(config.enabled, true);
    assert.equal(config.version, 'rsp1_');
    assert.equal(config.apiBase, '/api');
    assert.equal(config.demoMode, false);
    assert.deepEqual(config.allowedStationIds, ['Piter']);
    assert.equal(config.defaultStationId, 'Piter');
    assert.deepEqual(config.permissions, [
      'resident-services:issue',
      'resident-services:read',
      'resident-services:return'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'stationLabels'), false);

    assert.equal(capture.getHeader('content-type'), 'text/html; charset=utf-8');
    assert.equal(capture.getHeader('cache-control'), 'private, no-store');
    assert.equal(capture.getHeader('referrer-policy'), 'no-referrer');
    assert.equal(capture.getHeader('x-robots-tag'), 'noindex, nofollow');
    assert.equal(capture.getHeader('vary'), 'Cookie, Authorization');
    assert.equal(
      capture.getHeader('content-security-policy'),
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );

    assert.doesNotMatch(html, /fullName|photoUrl|activeIssuances|residentName/);
    assert.doesNotMatch(html, /Анна/);
  }

  {
    const { config } = await expectShell(enabledStaffAuth(staffUser({ stationIds: [] })), {
      pass: 'pass-abc',
      stationId: 'Yasenevo'
    });
    assert.deepEqual(config.allowedStationIds, []);
    assert.equal(config.defaultStationId, 'Yasenevo');
  }

  {
    const user = staffUser({
      stationIds: ['Piter'],
      permissionStationScopes: {
        'resident-services:issue': ['A', 'B'],
        'resident-services:read': ['A']
      }
    });
    const scoped = await expectShell(enabledStaffAuth(user), { pass: 'p', stationId: 'A' });
    assert.deepEqual(scoped.config.allowedStationIds, ['A', 'B']);
    assert.equal(scoped.config.defaultStationId, 'A');

    const multiNoDefault = await expectShell(enabledStaffAuth(user), { pass: 'p' });
    assert.equal(multiNoDefault.config.defaultStationId, '');

    const outOfScope = await expectShell(enabledStaffAuth(user), { pass: 'p', stationId: 'Piter' });
    assert.equal(outOfScope.config.defaultStationId, '');

    const single = await expectShell(
      enabledStaffAuth(
        staffUser({
          stationIds: [],
          permissionStationScopes: { 'resident-services:issue': ['A'] }
        })
      ),
      { pass: 'p' }
    );
    assert.deepEqual(single.config.allowedStationIds, ['A']);
    assert.equal(single.config.defaultStationId, 'A');

    const globalNull = await expectShell(
      enabledStaffAuth(
        staffUser({
          stationIds: [],
          permissionStationScopes: { 'resident-services:issue': null }
        })
      ),
      { pass: 'p' }
    );
    assert.deepEqual(globalNull.config.allowedStationIds, []);
    assert.equal(globalNull.config.defaultStationId, '');
  }

  {
    const alias = await expectShell(enabledStaffAuth(), { token: 'token-alias' });
    assert.equal(alias.config.passToken, 'token-alias');
  }

  {
    const controller = new ResidencyCheckPageController(enabledStaffAuth());
    const capture = createResponseCapture();
    await controller.residencyCheckPage(createRequest('/api/ui/admin/residency/check'), capture.response, {});
    assert.equal(capture.getStatus(), 400);
    assert.match(capture.getHtml(), /Ссылка неполная/);
    assert.doesNotMatch(capture.getHtml(), /PHAB_RESIDENCY_CHECK_CONFIG/);
    assert.doesNotMatch(capture.getHtml(), /residency-check\.js/);
    assert.equal(capture.getHeader('cache-control'), 'private, no-store');
  }

  {
    process.env.RESIDENCY_CHECK_STATION_LABELS = JSON.stringify({ Piter: 'Станция Питер', A: 'Станция А' });
    const { config } = await expectShell(enabledStaffAuth());
    assert.deepEqual(config.stationLabels, { Piter: 'Станция Питер', A: 'Станция А' });
    delete process.env.RESIDENCY_CHECK_STATION_LABELS;

    process.env.RESIDENCY_CHECK_STATION_LABELS = JSON.stringify({
      Piter: '</script><img src=x onerror=alert(1)>'
    });
    const escaped = await expectShell(enabledStaffAuth());
    const escapedLabels = escaped.config.stationLabels as Record<string, string>;
    assert.equal(escapedLabels.Piter, '</script><img src=x onerror=alert(1)>');
    assert.doesNotMatch(escaped.html, /<\/script><img/);
    delete process.env.RESIDENCY_CHECK_STATION_LABELS;

    process.env.RESIDENCY_CHECK_STATION_LABELS = 'not-a-json-object';
    const malformed = await expectShell(enabledStaffAuth());
    assert.equal(malformed.config.enabled, true);
    assert.equal(Object.prototype.hasOwnProperty.call(malformed.config, 'stationLabels'), false);
    delete process.env.RESIDENCY_CHECK_STATION_LABELS;

    process.env.RESIDENCY_CHECK_STATION_LABELS = JSON.stringify({ Piter: 42, '': 'empty', B: '  ' });
    const filtered = await expectShell(enabledStaffAuth());
    assert.equal(Object.prototype.hasOwnProperty.call(filtered.config, 'stationLabels'), false);
    delete process.env.RESIDENCY_CHECK_STATION_LABELS;
  }

  {
    const malicious = "</script><script>alert('x')//";
    const { config, html } = await expectShell(enabledStaffAuth(), { pass: malicious });
    assert.equal(config.passToken, malicious);
    assert.match(html, /\\u003c\/script\\u003e/);
    assert.doesNotMatch(html, /<\/script><script>alert/);
  }

  {
    process.env.RESIDENCY_CHECK_DEMO_MODE = 'true';
    process.env.NODE_ENV = 'test';
    const demo = await expectShell(enabledStaffAuth());
    assert.equal(demo.config.demoMode, true);

    process.env.NODE_ENV = 'production';
    const production = await expectShell(enabledStaffAuth());
    assert.equal(production.config.demoMode, false);

    delete process.env.RESIDENCY_CHECK_DEMO_MODE;
    delete process.env.NODE_ENV;
    const real = await expectShell(enabledStaffAuth());
    assert.equal(real.config.demoMode, false);
  }

  {
    const authDisabled = createAuthService({ enabled: false, calls: { resolve: 0 } });
    const { config } = await expectShell(authDisabled);
    assert.deepEqual(config.permissions, []);
    assert.equal(config.demoMode, false);
  }

  {
    process.env.RESIDENCY_CHECK_ENABLED = 'false';
    const calls = { resolve: 0 };
    const authService = createAuthService({ enabled: true, source: 'anonymous', calls });
    const controller = new ResidencyCheckPageController(authService);
    const capture = createResponseCapture();
    await controller.residencyCheckPage(createRequest(defaultPageUrl), capture.response, {
      pass: 'pass-abc'
    });
    assert.equal(capture.getStatus(), 503);
    assert.match(capture.getHtml(), /Раздел выключен/);
    assert.doesNotMatch(capture.getHtml(), /PHAB_RESIDENCY_CHECK_CONFIG/);
    assert.doesNotMatch(capture.getHtml(), /residency-check\.js/);
    assert.equal(capture.getHeader('cache-control'), 'private, no-store');
    assert.equal(capture.getHeader('x-robots-tag'), 'noindex, nofollow');
    assert.ok(capture.getHeader('content-security-policy'));
    assert.equal(calls.resolve, 0, 'disabled feature does not require or resolve staff data');
    delete process.env.RESIDENCY_CHECK_ENABLED;
  }

  restoreEnv();
  console.log('Residency check page controller test passed');
}

main().catch((error) => {
  restoreEnv();
  console.error(error);
  process.exitCode = 1;
});
