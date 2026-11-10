import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import { Role } from '../src/common/rbac/role.enum';
import {
  PADLHUB_ADMIN_PROXY_PREFIX,
  PadlhubAdminProxyService
} from '../src/padlhub-admin-proxy/padlhub-admin-proxy.service';
import { PadlhubAdminProxyController } from '../src/padlhub-admin-proxy/padlhub-admin-proxy.controller';

/**
 * The notification and station-card blocks used to need their own PadlHub operator session inside
 * ЦУП. The bridge replaces it, so these assertions pin the two halves of that contract: the browser
 * reaches only an explicit allowlist of paths, and the upstream call carries the narrow delegation
 * credential — never anything the browser supplied.
 */

const TOKEN = 'cup-admin-delegation-token-at-least-32-chars';
const TENANT = 'local-padel';

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | undefined;
}

function configuredService(overrides: Record<string, string | undefined> = {}) {
  process.env.PADLHUB_NOTIFICATION_API_BASE_URL = 'https://padlhub.test';
  process.env.PADLHUB_ADMIN_DELEGATION_TOKEN = TOKEN;
  process.env.PADLHUB_NOTIFICATION_TENANT_KEY = TENANT;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return new PadlhubAdminProxyService();
}

function fakeResponse(): { response: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, headers: {}, body: undefined };
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return response;
    },
    json(payload: unknown) {
      captured.body = Buffer.from(JSON.stringify(payload));
      return response;
    },
    send(payload: Buffer | string) {
      captured.body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      return response;
    }
  } as unknown as Response;
  return { response, captured };
}

function fakeRequest(input: {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  return {
    url: input.url ?? '/api/ui/padlhub-admin/local-padel/notifications/capabilities',
    originalUrl: input.url ?? '/api/ui/padlhub-admin/local-padel/notifications/capabilities',
    headers: input.headers ?? {},
    body: input.body
  } as unknown as Request;
}

async function main(): Promise<void> {
  process.env.PADLHUB_NOTIFICATION_API_BASE_URL = 'https://padlhub.test';
  process.env.PADLHUB_ADMIN_DELEGATION_TOKEN = TOKEN;
  process.env.PADLHUB_NOTIFICATION_TENANT_KEY = TENANT;
  const service = new PadlhubAdminProxyService();
  const controller = new PadlhubAdminProxyController(service);

  assert.equal(PADLHUB_ADMIN_PROXY_PREFIX, '/api/ui/padlhub-admin');
  assert.equal(service.enabled, true);
  assert.equal(service.allowedTenantKey, TENANT);
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PadlhubAdminProxyController),
    'ui/padlhub-admin/:tenantKey'
  );
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, PadlhubAdminProxyController), [
    Role.SUPER_ADMIN
  ]);

  // Every forwarded path is declared explicitly: the set below is the whole allowlist.
  const declared = new Set<string>();
  for (const name of Object.getOwnPropertyNames(PadlhubAdminProxyController.prototype)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(
      PadlhubAdminProxyController.prototype,
      name
    );
    const handler = descriptor?.value as ((...args: never[]) => unknown) | undefined;
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    if (path === undefined || method === undefined) continue;
    declared.add(`${method}:${path}`);
  }
  const expectedDeclared = new Set([
    // 0 = GET, 1 = POST, 2 = PUT, 3 = DELETE, 4 = PATCH, 5 = ALL ... use RequestMethod values.
    '0:session',
    '0:notifications/capabilities',
    '0:notifications/web-push-subscribers',
    '0:notifications/delivery-stats',
    '1:notifications/recipients/resolve',
    '1:notifications/campaigns',
    '0:notifications/scenarios',
    '0:notifications/scenarios/runs',
    '1:notifications/scenarios',
    '2:notifications/scenarios/:scenarioId',
    '0:locations',
    '0:locations/:locationId',
    '1:locations',
    '4:locations/:locationId',
    '1:location-media'
  ]);
  assert.deepEqual(declared, expectedDeclared, 'controller route allowlist changed');

  // Upstream call shape: delegation credential, CUP platform header, query string and idempotency key.
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ channels: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  try {
    const { response, captured } = fakeResponse();
    await controller.capabilities(
      TENANT,
      fakeRequest({
        url: '/api/ui/padlhub-admin/local-padel/notifications/capabilities?probe=1',
        headers: { 'x-correlation-id': 'correlation-test-0001', authorization: 'Bearer browser-supplied' }
      }),
      response
    );
    assert.equal(captured.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      // The probe query is not a forwarded parameter, so it must not reach the upstream call.
      'https://padlhub.test/admin/api/v1/local-padel/notifications/capabilities'
    );
    const headers = calls[0].init.headers as Record<string, string>;
    // The shared secret never travels: the console sends a short-lived HMAC over tenant + timestamp.
    const assertion = /^Bearer cupv1\.(\d{10,16})\.([0-9a-f]{64})$/.exec(
      headers.Authorization ?? ''
    );
    assert.ok(assertion, `unexpected delegation header: ${String(headers.Authorization)}`);
    const issuedAtMs = Number(assertion[1]);
    assert.ok(Math.abs(Date.now() - issuedAtMs) < 5_000, 'assertion must be minted for now');
    assert.equal(
      assertion[2],
      createHmac('sha256', TOKEN).update(`cupv1\n${TENANT}\n${assertion[1]}`).digest('hex')
    );
    assert.equal(headers['X-App-Platform'], 'cup-admin');
    // Correlation is generated server-side: a browser value must never reach the LK2 audit trail.
    assert.notEqual(headers['X-Correlation-ID'], 'correlation-test-0001');
    assert.match(String(headers['X-Correlation-ID']), /^[0-9a-f-]{36}$/);
    assert.equal(captured.headers['X-Correlation-ID'], headers['X-Correlation-ID']);

    // A campaign carries the operator Idempotency-Key through, and refuses to invent one.
    const campaign = fakeResponse();
    await controller.createCampaign(
      TENANT,
      fakeRequest({
        url: '/api/ui/padlhub-admin/local-padel/notifications/campaigns',
        headers: { 'idempotency-key': 'cup-campaign-key-0001' },
        body: { phones: ['+79990000001'], title: 'Тест', body: 'Текст', channels: ['IN_APP'] }
      }),
      campaign.response
    );
    const campaignCall = calls[1];
    const campaignHeaders = campaignCall.init.headers as Record<string, string>;
    assert.equal(campaignHeaders['Idempotency-Key'], 'cup-campaign-key-0001');
    assert.equal(campaignHeaders['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(campaignCall.init.body)), {
      phones: ['+79990000001'],
      title: 'Тест',
      body: 'Текст',
      channels: ['IN_APP']
    });

    const missingKey = fakeResponse();
    await controller.createLocation(
      TENANT,
      fakeRequest({
        url: '/api/ui/padlhub-admin/local-padel/locations',
        body: { slug: 'test' }
      }),
      missingKey.response
    );
    assert.equal(missingKey.captured.statusCode, 400);
    assert.equal(calls.length, 2, 'a command without an idempotency key must not reach PadlHub');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Query strings are filtered: only the parameters the forwarded routes read survive.
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ channels: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  try {
    const queryCall = fakeResponse();
    await controller.deliveryStats(
      TENANT,
      fakeRequest({
        url: '/api/ui/padlhub-admin/local-padel/notifications/delivery-stats?days=7&tenantKey=other&debug=1'
      }),
      queryCall.response
    );
    assert.equal(
      calls[calls.length - 1].url,
      'https://padlhub.test/admin/api/v1/local-padel/notifications/delivery-stats?days=7'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // The console refuses an oversized photo itself instead of buffering it in memory.
  process.env.PADLHUB_ADMIN_PROXY_MAX_MEDIA_BYTES = '1024';
  const smallService = new PadlhubAdminProxyService();
  const smallConsole = new PadlhubAdminProxyController(smallService);
  await assert.rejects(
    async () =>
      smallConsole.uploadLocationMedia(
        TENANT,
        fakeRequest({
          url: '/api/ui/padlhub-admin/local-padel/location-media',
          headers: { 'content-type': 'image/png', 'content-length': '4096' }
        }),
        fakeResponse().response,
        'cup-media-oversized-0001'
      ),
    (error: unknown) => error instanceof PayloadTooLargeException
  );
  delete process.env.PADLHUB_ADMIN_PROXY_MAX_MEDIA_BYTES;

  // No implicit tenant: a token without PADLHUB_NOTIFICATION_TENANT_KEY leaves the bridge off.
  const missingTenant = configuredService({ PADLHUB_NOTIFICATION_TENANT_KEY: undefined });
  assert.equal(missingTenant.enabled, false);
  process.env.PADLHUB_NOTIFICATION_TENANT_KEY = TENANT;

  // Tenant and configuration guards fail closed.
  const { response: wrongTenantResponse } = fakeResponse();
  await assert.rejects(
    async () =>
      controller.capabilities(
        'another-padel',
        fakeRequest({ url: '/api/ui/padlhub-admin/another-padel/notifications/capabilities' }),
        wrongTenantResponse
      ),
    (error: unknown) => error instanceof NotFoundException
  );

  const disabledService = configuredService({ PADLHUB_ADMIN_DELEGATION_TOKEN: undefined });
  assert.equal(disabledService.enabled, false);
  await assert.rejects(
    async () =>
      new PadlhubAdminProxyController(disabledService).session(
        TENANT,
        fakeRequest({ url: '/api/ui/padlhub-admin/local-padel/session' }),
        fakeResponse().response
      ),
    (error: unknown) => error instanceof ServiceUnavailableException
  );

  // The panel must actually use the bridge and drop the operator login card when it is announced.
  const panelSource = readFileSync(
    join(__dirname, '..', 'client-sdk', 'phab-admin-panel.js'),
    'utf8'
  );
  assert.match(panelSource, /padlhubAdminProxyBaseUrl: ''/);
  assert.match(panelSource, /proxyBaseUrl \+ '\/' \+ tenantKey/);
  assert.match(panelSource, /request\(adminRoot \+ '\/session', \{ method: 'GET'/);
  assert.match(
    panelSource,
    /if \(cfg\.padlhubAdminProxyBaseUrl\) \{\s*\/\/ The console authorizes this block/
  );

  process.stdout.write('cup-admin-delegation proxy: ok\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
