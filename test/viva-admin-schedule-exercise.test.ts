import * as assert from 'node:assert/strict';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';

async function main(): Promise<void> {
  const exerciseId = '5b1d7bef-cf32-4f75-a217-48553799dd24';
  const originalFetch = globalThis.fetch;
  const service = Object.assign(Object.create(VivaAdminService.prototype), {
    requestTimeoutMs: 5000,
    resolveAccessToken: async () => 'synthetic-token',
    getResolvedSettings: async () => ({ config: { baseUrl: 'https://viva.example' } })
  }) as VivaAdminService;
  const requests: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    assert.ok(init?.signal, 'exact lookups share an abort deadline');
    return Response.json({
      id: path.includes('group-exercises') ? exerciseId : 'different-exercise',
      timeFrom: '2026-11-26T07:00:00+03:00',
      timeTo: '2026-11-26T09:00:00+03:00',
      canceled: true,
      clientsCount: 8,
      maxClientsCount: 8,
      studio: { id: 'synthetic-studio', name: 'Test station' },
      room: { name: 'Test court' },
      clients: [{ firstName: 'Fixture', id: 'synthetic-client' }]
    });
  }) as typeof fetch;

  try {
    const result = await service.getExerciseStatus(exerciseId, { scheduleRead: true });
    assert.deepEqual(result, {
      id: exerciseId,
      rawStatus: undefined,
      canceled: true,
      timeFrom: '2026-11-26T07:00:00+03:00',
      timeTo: '2026-11-26T09:00:00+03:00',
      participantsCount: 8,
      maxPlayers: 8,
      studioId: 'synthetic-studio',
      studioName: 'Test station',
      courtName: 'Test court'
    });
    assert.deepEqual(requests, [`/api/v1/exercises/${exerciseId}`, `/api/v1/group-exercises/${exerciseId}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
