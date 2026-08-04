import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalWidgetIds = process.env.VIVA_END_USER_WIDGET_IDS;
  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'widget-test';
  delete process.env.VIVA_END_USER_WIDGET_IDS;

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    return new Response(JSON.stringify([
      {
        id: 'manual-day-tournament',
        name: 'Турнир Американо',
        startsAt: '2026-08-04T19:00:00+03:00',
        endsAt: '2026-08-04T21:00:00+03:00'
      }
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments({
      date: '2026-08-04',
      includePast: true
    });

    assert.deepEqual(tournaments?.map((item) => item.id), ['manual-day-tournament']);
    assert.equal(requestedUrls.length, 1, 'manual day refresh must make one request per widget');
    const requestUrl = new URL(requestedUrls[0]);
    assert.equal(requestUrl.pathname, '/end-user/api/v1/widget-test/exercises');
    assert.equal(requestUrl.searchParams.get('date'), '2026-08-04');
    assert.equal(requestUrl.searchParams.get('includePast'), 'true');
    assert.equal(requestUrl.searchParams.get('past'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_END_USER_WIDGET_IDS', originalWidgetIds);
  }

  console.log('Viva tournaments manual-day test passed');
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
