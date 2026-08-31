import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const requestedUrls: string[] = [];

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'iSkq6G';

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    const date = url.searchParams.get('date');
    const studioId = url.searchParams.get('studioId');

    if (date === '2026-05-07' && studioId) {
      return new Response('Unavailable', { status: 503 });
    }

    if (studioId) {
      return jsonResponse([
        {
          id: 'piter-tournament',
          name: 'Piter tournament',
          exerciseTypeId: '839',
          startsAt: '2026-05-06T20:00:00+03:00',
          endsAt: '2026-05-06T22:00:00+03:00',
          studio: { id: studioId, name: 'Питер' },
          maxClientsCount: 16,
          clientsCount: 10
        }
      ]);
    }

    return jsonResponse([
      ...(date === '2026-05-06'
        ? [{
            id: 'piter-tournament',
            name: 'Piter tournament',
            exerciseTypeId: '839',
            startsAt: '2026-05-06T20:00:00+03:00',
            endsAt: '2026-05-06T22:00:00+03:00',
            studio: { name: 'Питер' },
            maxClientsCount: 16,
            clientsCount: 0
          }]
        : []),
        {
          id: `tournament-on-${date}`,
          name: 'Padel tournament',
          exerciseTypeId: '839',
          startsAt: `${date}T19:00:00+03:00`,
          endsAt: `${date}T21:00:00+03:00`,
          studio: { name: 'Сколково' },
          trainer: { name: 'Тренер' }
        }
      ]);
  }) as typeof fetch;

  try {
    const service = new VivaTournamentsService(undefined);
    const tournaments = await service.listTournaments({
      date: '2026-05-06',
      includePast: true
    });

    assert.equal(tournaments?.length, 2);
    assert.equal(
      tournaments?.find((tournament) => tournament.id === 'piter-tournament')?.participantsCount,
      10
    );
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every((url) => url.includes('date=2026-05-06')));
    assert.ok(requestedUrls.every((url) => url.includes('includePast=true')));
    assert.ok(requestedUrls.every((url) => url.includes('past=true')));
    assert.equal(
      requestedUrls.filter((url) => url.includes('studioId=1ea77cbf-bc36-49a1-96d6-f35c216a409b')).length,
      1
    );

    const fallbackTournaments = await service.listTournaments({ date: '2026-05-07' });
    assert.equal(
      fallbackTournaments,
      null,
      'a failed supplemental request must not expose a partial date snapshot'
    );
    assert.equal(requestedUrls.length, 4);
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
