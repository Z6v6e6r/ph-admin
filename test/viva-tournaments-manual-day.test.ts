import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalWidgetIds = process.env.VIVA_END_USER_WIDGET_IDS;
  const originalUserAgent = process.env.VIVA_END_USER_USER_AGENT;
  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'iSkq6G';
  delete process.env.VIVA_END_USER_WIDGET_IDS;
  delete process.env.VIVA_END_USER_USER_AGENT;

  const requestedUrls: string[] = [];
  const requestedUserAgents: Array<string | null> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    requestedUserAgents.push(new Headers(init?.headers).get('user-agent'));
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
    assert.equal(requestedUrls.length, 2, 'manual day refresh must make two bounded requests per widget');
    const requestUrls = requestedUrls.map((url) => new URL(url));
    assert.ok(requestUrls.every((url) =>
      url.pathname === '/end-user/api/v1/iSkq6G/exercises'
    ));
    assert.ok(requestUrls.every((url) => url.searchParams.get('date') === '2026-08-04'));
    assert.ok(requestUrls.every((url) => url.searchParams.get('includePast') === 'true'));
    assert.ok(requestUrls.every((url) => url.searchParams.get('past') === 'true'));
    assert.equal(
      requestUrls.filter((url) =>
        url.searchParams.get('studioId') === '1ea77cbf-bc36-49a1-96d6-f35c216a409b'
      ).length,
      1
    );
    assert.deepEqual(requestedUserAgents, [
      'PadlHub-LK-Tournament-Refresh/1.0',
      'PadlHub-LK-Tournament-Refresh/1.0'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_END_USER_WIDGET_IDS', originalWidgetIds);
    restoreEnv('VIVA_END_USER_USER_AGENT', originalUserAgent);
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
