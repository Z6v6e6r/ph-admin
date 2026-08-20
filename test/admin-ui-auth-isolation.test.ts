import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Request, Response } from 'express';
import { AuthService } from '../src/auth/auth.service';
import { Role } from '../src/common/rbac/role.enum';
import { UiController } from '../src/ui/ui.controller';

const piterAdmin = {
  id: 'admin-piter',
  login: 'admin_piter',
  roles: [Role.STATION_ADMIN],
  roleIds: [Role.STATION_ADMIN],
  permissions: ['dialogs:read', 'dialogs:write', 'games:read', 'tournaments:read'],
  permissionStationScopes: {
    'dialogs:read': ['Piter'],
    'dialogs:write': ['Piter'],
    'games:read': ['Piter'],
    'tournaments:read': ['Piter']
  },
  stationIds: ['Piter'],
  connectorRoutes: ['MAX_BOT', 'LK_WEB_MESSENGER'],
  authSource: 'token' as const
};

function createResponseCapture(): {
  response: Response;
  getHtml: () => string;
  getRedirect: () => string | null;
  getHeader: (name: string) => string | undefined;
} {
  let html = '';
  let redirect: string | null = null;
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    send(payload: string) {
      html = payload;
      return this;
    },
    redirect(url: string) {
      redirect = url;
      return this;
    }
  } as unknown as Response;
  return {
    response,
    getHtml: () => html,
    getRedirect: () => redirect,
    getHeader: (name: string) => headers.get(name.toLowerCase())
  };
}

function createRequest(): Request {
  return {
    protocol: 'https',
    originalUrl: '/api/ui/admin',
    get: (name: string) => (name.toLowerCase() === 'host' ? 'padlhub.su' : undefined),
    headers: {}
  } as unknown as Request;
}

function parseAdminConfig(html: string): Record<string, unknown> {
  const match = html.match(/window\.__PHAB_ADMIN_CONFIG__ = (\{.*\});/);
  assert.ok(match?.[1], 'admin page must embed a config object');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const authService = {
    isEnabled: () => true,
    resolveUserFromRequest: async () => ({ user: piterAdmin, source: 'token' as const }),
    hasStaffAccess: () => true
  } as unknown as AuthService;
  const controller = new UiController(authService);

  const loginCapture = createResponseCapture();
  controller.adminLogin(createRequest(), loginCapture.response, {});
  const loginHtml = loginCapture.getHtml();
  assert.match(loginHtml, /localStorage\.removeItem\('phab_admin_token'\)/);
  assert.doesNotMatch(loginHtml, /localStorage\.setItem\('phab_admin_token'/);

  const panelCapture = createResponseCapture();
  await controller.adminPanel(createRequest(), panelCapture.response, {
    authToken: 'stale-superadmin-token'
  });
  assert.equal(panelCapture.getRedirect(), null);
  const config = parseAdminConfig(panelCapture.getHtml());
  assert.equal(config.cookieAuthOnly, true);
  assert.equal(config.authToken, undefined);
  assert.equal(config.userId, piterAdmin.id);
  assert.deepEqual(config.roles, [Role.STATION_ADMIN]);
  assert.deepEqual(config.stationIds, ['Piter']);
  assert.deepEqual(config.connectorRoutes, ['MAX_BOT', 'LK_WEB_MESSENGER']);
  assert.equal(panelCapture.getHeader('cache-control'), 'private, no-store');
  assert.equal(panelCapture.getHeader('referrer-policy'), 'no-referrer');
  assert.equal(panelCapture.getHeader('vary'), 'Cookie, Authorization');

  const clientSource = readFileSync(
    resolve(process.cwd(), 'client-sdk/phab-admin-panel.js'),
    'utf8'
  );
  assert.match(clientSource, /cookieAuthOnly: false/);
  assert.match(
    clientSource,
    /if \(cfg\.cookieAuthOnly\) \{\s*cfg\.authToken = '';[\s\S]*?localStorage\.removeItem\('phab_admin_token'\)/
  );
  assert.match(
    clientSource,
    /else if \(!cfg\.authToken\) \{[\s\S]*?localStorage\.getItem\('phab_admin_token'\)/
  );

  console.log('Admin UI cookie-only auth isolation test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
