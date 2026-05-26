import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalWidgetIds = process.env.VIVA_END_USER_WIDGET_IDS;

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  delete process.env.VIVA_END_USER_WIDGET_ID;
  process.env.VIVA_END_USER_WIDGET_IDS = 'widget-a,widget-b';

  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('/end-user/api/v1/widget-a/exercises?date=2026-06-07')) {
      return jsonResponse([
        {
          id: 'from-widget-a',
          name: 'Падел турнир от ПадлхАБ',
          exerciseTypeId: '839',
          studio: { id: 'skolkovo', name: 'Сколково' },
          startsAt: '2026-06-07T09:00:00+03:00',
          endsAt: '2026-06-07T11:00:00+03:00'
        }
      ]);
    }

    if (url.includes('/end-user/api/v1/widget-b/exercises?date=2026-06-07')) {
      return jsonResponse([
        {
          id: '73fe515e-2872-493b-a1c6-fb013e661e33',
          direction: { id: 2617, name: 'Падел турнир от ПадлхАБ' },
          type: { id: 839, name: 'Падел Турнир' },
          timeFrom: '2026-06-07T10:00:00+03:00',
          timeTo: '2026-06-07T11:00:00+03:00',
          studio: { id: '233c1405-1eac-40de-8ec6-1cf7e24c9276', name: 'Сочи' },
          room: { name: 'Корт №4 Панорамик 2 на 2' },
          maxClientsCount: 8,
          canceled: false
        }
      ]);
    }

    return jsonResponse([]);
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments({ date: '2026-06-07' });

    assert.ok(Array.isArray(tournaments));
    assert.equal(tournaments?.length, 2);
    assert.ok(tournaments?.some((item) => item.id === 'from-widget-a'));
    assert.ok(tournaments?.some((item) => item.id === '73fe515e-2872-493b-a1c6-fb013e661e33'));
    assert.equal(
      tournaments?.find((item) => item.id === '73fe515e-2872-493b-a1c6-fb013e661e33')?.studioName,
      'Сочи'
    );

    assert.ok(
      requestedUrls.some((url) => url.includes('/end-user/api/v1/widget-a/exercises?date=2026-06-07'))
    );
    assert.ok(
      requestedUrls.some((url) => url.includes('/end-user/api/v1/widget-b/exercises?date=2026-06-07'))
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_END_USER_WIDGET_IDS', originalWidgetIds);
  }

  console.log('Viva tournaments multi-widget aggregation test passed');
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
