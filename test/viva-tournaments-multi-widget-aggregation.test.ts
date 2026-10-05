import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalWidgetIds = process.env.VIVA_END_USER_WIDGET_IDS;

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  delete process.env.VIVA_END_USER_WIDGET_ID;
  process.env.VIVA_END_USER_WIDGET_IDS = 'iSkq6G,widget-b';

  const requestedUrls: string[] = [];
  let failPiterRequest = false;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());

    if (
      url.pathname.includes('/end-user/api/v1/iSkq6G/exercises')
      && url.searchParams.has('studioId')
    ) {
      if (failPiterRequest) {
        return new Response('Unavailable', { status: 503 });
      }
      return jsonResponse([
        {
          id: 'shared-tournament',
          name: 'Питерский турнир',
          exerciseTypeId: '839',
          studio: { id: 'piter', name: 'Питер' },
          startsAt: '2026-06-07T12:00:00+03:00',
          endsAt: '2026-06-07T14:00:00+03:00',
          clientsCount: 10
        }
      ]);
    }

    if (url.pathname.includes('/end-user/api/v1/iSkq6G/exercises')) {
      return jsonResponse([
        {
          id: 'from-widget-a',
          name: 'Падел турнир от ПадлхАБ',
          exerciseTypeId: '839',
          studio: { id: 'skolkovo', name: 'Сколково' },
          startsAt: '2026-06-07T09:00:00+03:00',
          endsAt: '2026-06-07T11:00:00+03:00'
        },
        {
          id: 'shared-tournament',
          name: 'Питерский турнир',
          exerciseTypeId: '839',
          studio: { id: 'piter', name: 'Питер' },
          startsAt: '2026-06-07T12:00:00+03:00',
          endsAt: '2026-06-07T14:00:00+03:00',
          clientsCount: 0
        }
      ]);
    }

    if (url.pathname.includes('/end-user/api/v1/widget-b/exercises')) {
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
        },
        {
          id: 'shared-tournament',
          name: 'Shared tournament',
          exerciseTypeId: '839',
          studio: { id: 'other', name: 'Другой клуб' },
          startsAt: '2026-06-07T12:00:00+03:00',
          endsAt: '2026-06-07T14:00:00+03:00',
          clientsCount: 2
        }
      ]);
    }

    return jsonResponse([]);
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments({ date: '2026-06-07' });

    assert.ok(Array.isArray(tournaments));
    assert.equal(tournaments?.length, 3);
    assert.ok(tournaments?.some((item) => item.id === 'from-widget-a'));
    assert.ok(tournaments?.some((item) => item.id === '73fe515e-2872-493b-a1c6-fb013e661e33'));
    assert.equal(
      tournaments?.find((item) => item.id === '73fe515e-2872-493b-a1c6-fb013e661e33')?.studioName,
      'Сочи'
    );
    assert.equal(
      tournaments?.find((item) => item.id === 'shared-tournament')?.participantsCount,
      10,
      'the scoped iSkq6G record must win regardless of configured widget order'
    );

    assert.ok(
      requestedUrls.some((url) => url.includes('/end-user/api/v1/iSkq6G/exercises?date=2026-06-07'))
    );
    assert.ok(
      requestedUrls.some((url) => url.includes('/end-user/api/v1/widget-b/exercises?date=2026-06-07'))
    );
    assert.equal(requestedUrls.length, 3, 'date loading should add one Piter request globally');
    assert.equal(
      requestedUrls.filter((url) =>
        url.includes('studioId=1ea77cbf-bc36-49a1-96d6-f35c216a409b')
      ).length,
      1
    );

    requestedUrls.length = 0;
    failPiterRequest = true;
    assert.equal(
      await service.listTournaments({ date: '2026-06-07' }),
      null,
      'a failed widget leg must not expose a partial multi-widget date snapshot'
    );
    assert.equal(requestedUrls.length, 3);
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
