import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalExerciseTypeIds = process.env.VIVA_TOURNAMENT_EXERCISE_TYPE_IDS;

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'widget-test';
  process.env.VIVA_TOURNAMENT_EXERCISE_TYPE_IDS = '839,1013';

  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());

    if (url.pathname.endsWith('/profile')) {
      return jsonResponse({});
    }
    if (url.pathname.endsWith('/studios')) {
      return jsonResponse([{ id: 'studio-moscow', name: 'Сколково' }]);
    }
    if (url.pathname.endsWith('/trainers')) {
      return jsonResponse([]);
    }
    if (url.pathname.endsWith('/exercises/dates')) {
      const studioIds = url.searchParams.getAll('studioIds');
      if (studioIds.length > 0) {
        return jsonResponse(['2026-06-08']);
      }
      return jsonResponse(['2026-06-07', '2026-06-08']);
    }
    if (url.pathname.endsWith('/exercises')) {
      const date = url.searchParams.get('date');
      if (date === '2026-06-07') {
        return jsonResponse([
          {
            id: 'sochi-visible',
            direction: { id: 2617, name: 'Падел турнир от ПадлхАБ' },
            type: { id: 839, name: 'Падел Турнир' },
            timeFrom: '2026-06-07T10:00:00+03:00',
            timeTo: '2026-06-07T11:00:00+03:00',
            studio: { id: 'studio-sochi', name: 'Сочи' },
            room: { name: 'Корт №4' },
            maxClientsCount: 8,
            clientsCount: 0,
            canceled: false
          }
        ]);
      }
      return jsonResponse([]);
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments();

    assert.ok(Array.isArray(tournaments), 'tournaments should be an array');
    assert.equal(tournaments?.some((tournament) => tournament.id === 'sochi-visible'), true);
    assert.equal(
      tournaments?.find((tournament) => tournament.id === 'sochi-visible')?.studioName,
      'Сочи'
    );

    assert.ok(
      requestedUrls.some((url) => url.includes('/exercises?date=2026-06-07')),
      'should fetch exercises for date available only in all-studios dates query'
    );

    const datesRequests = requestedUrls.filter((url) => url.includes('/exercises/dates?'));
    assert.equal(datesRequests.length, 2);
    assert.ok(datesRequests.some((url) => url.includes('studioIds=studio-moscow')));
    assert.ok(datesRequests.some((url) => !url.includes('studioIds=')));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_TOURNAMENT_EXERCISE_TYPE_IDS', originalExerciseTypeIds);
  }

  console.log('Viva tournaments studio-filter fallback test passed');
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
