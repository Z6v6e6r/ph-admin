import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

type FetchCall = {
  url: string;
  headers: Record<string, string>;
};

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload
  } as Response;
}

async function main(): Promise<void> {
  const previousEnv = {
    VIVA_ADMIN_API_TOKEN: process.env.VIVA_ADMIN_API_TOKEN,
    VIVA_ADMIN_API_BASE_URL: process.env.VIVA_ADMIN_API_BASE_URL,
    VIVA_END_USER_API_BASE_URL: process.env.VIVA_END_USER_API_BASE_URL,
    VIVA_END_USER_WIDGET_ID: process.env.VIVA_END_USER_WIDGET_ID,
    MONGODB_URI: process.env.MONGODB_URI
  };
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  process.env.VIVA_ADMIN_API_TOKEN = 'admin-token';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://api.vivacrm.ru';
  process.env.VIVA_END_USER_API_BASE_URL = 'https://api.vivacrm.ru';
  process.env.VIVA_END_USER_WIDGET_ID = 'iSkq6G';
  process.env.MONGODB_URI = '';

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, headers: headers ?? {} });

    if (url.startsWith('https://api.vivacrm.ru/api/v1/clients')) {
      return response({
        content: [
          {
            id: 'client-1',
            firstName: 'Евгения',
            lastName: 'Чабыкина',
            avatarUrl: 'https://example.com/chabykina.jpg'
          }
        ]
      });
    }

    if (url === 'https://api.vivacrm.ru/end-user/api/v1/iSkq6G/profile') {
      assert.equal(headers?.Authorization, 'Bearer admin-token');
      assert.equal(headers?.['x-user-id'], 'client-1');
      assert.equal(headers?.['x-user-phone'], '79144722120');
      return response({
        fields: [
          {
            value: ['3.04934'],
            id: 'eabfe27b-3f72-4496-9185-1a2ec6e6465e',
            name: 'Уровень падел числовой',
            type: 'INPUT'
          }
        ]
      });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const service = new VivaAdminService();
    const lookup = await service.lookupClientCabinetByPhone('+7 914 472 21 20');

    assert.equal(lookup?.status, 'FOUND');
    assert.equal(lookup?.displayName, 'Евгения Чабыкина');
    assert.equal(lookup?.levelLabel, '3.04934');
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }

  console.log('Viva admin profile level test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
