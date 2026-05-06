import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const requestedUrls: string[] = [];

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'widget-test';

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    return new Response(
      JSON.stringify([
        {
          id: 'tournament-on-date',
          name: 'Padel tournament',
          exerciseTypeId: '839',
          startsAt: '2026-05-06T19:00:00+03:00',
          endsAt: '2026-05-06T21:00:00+03:00',
          studio: { name: 'Сколково' },
          trainer: { name: 'Тренер' }
        }
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    );
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments({ date: '2026-05-06' });

    assert.equal(tournaments?.length, 1);
    assert.equal(tournaments?.[0]?.id, 'tournament-on-date');
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? '', /\/exercises\?date=2026-05-06$/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiBaseUrl === undefined) {
      delete process.env.VIVA_END_USER_API_BASE_URL;
    } else {
      process.env.VIVA_END_USER_API_BASE_URL = originalApiBaseUrl;
    }
    if (originalWidgetId === undefined) {
      delete process.env.VIVA_END_USER_WIDGET_ID;
    } else {
      process.env.VIVA_END_USER_WIDGET_ID = originalWidgetId;
    }
  }

  console.log('Viva tournaments date loading test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
