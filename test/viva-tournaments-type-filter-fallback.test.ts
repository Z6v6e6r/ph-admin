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
      return jsonResponse([{ id: 'studio-sochi', name: 'Сочи' }]);
    }
    if (url.pathname.endsWith('/trainers')) {
      return jsonResponse([]);
    }
    if (url.pathname.endsWith('/exercises/dates')) {
      const hasExerciseTypeFilter = url.searchParams.getAll('exerciseTypeIds').length > 0;
      return jsonResponse(hasExerciseTypeFilter ? [] : ['2026-06-07']);
    }
    if (url.pathname.endsWith('/exercises')) {
      const date = url.searchParams.get('date');
      if (date === '2026-06-07') {
        return jsonResponse([
          {
            id: 'sochi-unknown-type',
            name: 'Падел турнир от ПадлхАБ',
            exerciseTypeId: '7777',
            startsAt: '2026-06-07T10:00:00+03:00',
            endsAt: '2026-06-07T11:00:00+03:00',
            studioId: 'studio-sochi'
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
    assert.equal(tournaments?.length, 1);
    assert.equal(tournaments?.[0]?.id, 'sochi-unknown-type');
    assert.equal(tournaments?.[0]?.studioName, 'Сочи');

    const datesRequests = requestedUrls.filter((url) => url.includes('/exercises/dates?'));
    assert.equal(datesRequests.length, 2, 'dates endpoint should be called twice (with and without type filter)');
    assert.ok(
      datesRequests.some((url) => url.includes('exerciseTypeIds=839') && url.includes('exerciseTypeIds=1013'))
    );
    assert.ok(
      datesRequests.some((url) => !url.includes('exerciseTypeIds=')),
      'second dates call should fallback without exerciseTypeIds'
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_TOURNAMENT_EXERCISE_TYPE_IDS', originalExerciseTypeIds);
  }

  console.log('Viva tournaments type-filter fallback test passed');
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
