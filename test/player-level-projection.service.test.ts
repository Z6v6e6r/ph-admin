import * as assert from 'node:assert/strict';
import { PlayerLevelProjectionService } from '../src/player-ratings/player-level-projection.service';
import { PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

const state: PlayerRatingStateDocument = {
  playerKey: 'player:1',
  clientId: 'viva-client-1',
  name: 'Анна Тест',
  ratingNumeric: 3.63,
  rating: 'C+',
  ownership: 'CUP_CANONICAL',
  source: 'CUP',
  schemaVersion: 1,
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-19T10:00:00.000Z',
  lastEventId: 'rating_evt:00000000-0000-4000-8000-000000000001',
  lastEventAt: '2026-08-19T10:00:00.000Z',
  lastEventType: 'RATING_INITIAL_IMPORTED',
  lastSource: 'IMPORT',
  lastChangedBy: { id: 'import', name: 'Import', type: 'IMPORT' }
};

async function main(): Promise<void> {
  const previous = {
    enabled: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED,
    url: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL,
    token: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN,
    tenant: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY,
    circuitThreshold: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_FAILURE_THRESHOLD,
    circuitReset: process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_RESET_MS
  };
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = 'true';
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL = 'https://internal.padlhub.test';
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN = 'projection-token-at-least-32-characters';
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY = 'local-padel';

  const ensured: any[] = [];
  const completed: any[] = [];
  let claimed = false;
  const repository: any = {
    connect: async () => undefined,
    listStatesForPadlHubReconcile: async () => [state],
    ensurePadlHubProjectionDesired: async (...args: any[]) => ensured.push(args),
    claimPadlHubProjection: async () => {
      if (claimed) return null;
      claimed = true;
      return {
        playerKey: state.playerKey,
        attempts: 1,
        inFlight: {
          schemaVersion: 1,
          sourceEventId: state.lastEventId,
          sourceRevision: 0,
          occurredAt: state.lastEventAt,
          player: { externalClientId: state.clientId },
          sportCode: 'PADEL',
          level: { code: state.rating, numericValue: state.ratingNumeric },
          source: { eventType: state.lastEventType, formulaVersion: 'padel-rating-grade-v1' }
        }
      };
    },
    completePadlHubProjection: async (input: any) => { completed.push(input); return true; },
    failPadlHubProjection: async () => true
  };
  const originalFetch = global.fetch;
  const calls: any[] = [];
  global.fetch = (async (...args: any[]) => {
    calls.push(args);
    return new Response(JSON.stringify({ outcome: 'applied' }), { status: 200 });
  }) as typeof fetch;
  const service = new PlayerLevelProjectionService(repository);
  try {
    await service.onModuleInit();
    await service.runCycle();
    service.onModuleDestroy();
    assert.equal(ensured.length, 1, 'reconcile seeds existing canonical state');
    assert.equal(ensured[0][1].sourceRevision, 0, 'legacy state starts at projection revision zero');
    assert.equal(calls.length, 1);
    assert.match(String(calls[0][0]), /\/internal\/api\/v1\/local-padel\/player-level-projections$/);
    const request = calls[0][1];
    assert.equal(request.headers['Idempotency-Key'], state.lastEventId);
    assert.equal(request.headers['X-Cup-Player-Level-Token'], process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN);
    assert.equal(request.redirect, 'error', 'the server credential is never forwarded through redirects');
    assert.equal(completed.length, 1, 'successful delivery advances the projection fence');
    assert.deepEqual(service.metricsSnapshot(), {
      attempts: 1,
      applied: 1,
      replayed: 0,
      failed: 0,
      stale: 0,
      circuitSkippedCycles: 0,
      invalidCanonicalStates: 0,
      circuitOpen: false
    });

    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_FAILURE_THRESHOLD = '1';
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_RESET_MS = '60000';
    let failedClaimed = false;
    let failedClaimCalls = 0;
    const failures: any[] = [];
    const failingRepository: any = {
      ...repository,
      listStatesForPadlHubReconcile: async () => [],
      claimPadlHubProjection: async () => {
        failedClaimCalls += 1;
        if (failedClaimed) return null;
        failedClaimed = true;
        return { playerKey: state.playerKey, attempts: 2, inFlight: ensured[0][1] };
      },
      completePadlHubProjection: async () => false,
      failPadlHubProjection: async (input: any) => { failures.push(input); return true; }
    };
    global.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    const failingService = new PlayerLevelProjectionService(failingRepository);
    await failingService.onModuleInit();
    await failingService.runCycle();
    failingService.onModuleDestroy();
    assert.equal(failures.length, 1, 'provider failure remains retryable in the leased outbox');
    assert.equal(failures[0].errorCode, 'PADLHUB_LEVEL_PROJECTION_HTTP_503');
    assert.equal(failingService.metricsSnapshot().circuitOpen, true);
    await failingService.runCycle();
    assert.equal(failedClaimCalls, 1, 'an open circuit performs no additional outbox claim');
    assert.equal(failingService.metricsSnapshot().circuitSkippedCycles, 1);

    let staleClaimed = false;
    const staleFailures: any[] = [];
    const staleRepository: any = {
      ...repository,
      listStatesForPadlHubReconcile: async () => [],
      claimPadlHubProjection: async () => {
        if (staleClaimed) return null;
        staleClaimed = true;
        return { playerKey: state.playerKey, attempts: 3, inFlight: ensured[0][1] };
      },
      failPadlHubProjection: async (input: any) => { staleFailures.push(input); return true; }
    };
    global.fetch = (async () =>
      new Response(JSON.stringify({ outcome: 'stale', currentRevision: 4 }), { status: 200 })) as typeof fetch;
    const staleService = new PlayerLevelProjectionService(staleRepository);
    await staleService.onModuleInit();
    await staleService.runCycle();
    staleService.onModuleDestroy();
    assert.equal(staleFailures.length, 1, 'stale receiver state is never acknowledged as synced');
    assert.equal(staleFailures[0].errorCode, 'PADLHUB_LEVEL_PROJECTION_STALE');

    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL = 'http://projection.example.invalid';
    const insecureService = new PlayerLevelProjectionService(repository);
    await assert.rejects(
      () => insecureService.onModuleInit(),
      /must use https except for explicit loopback development/
    );
    insecureService.onModuleDestroy();
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL = 'https://internal.padlhub.test';
  } finally {
    service.onModuleDestroy();
    global.fetch = originalFetch;
    restore('PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED', previous.enabled);
    restore('PADLHUB_PLAYER_LEVEL_PROJECTION_URL', previous.url);
    restore('PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN', previous.token);
    restore('PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY', previous.tenant);
    restore(
      'PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_FAILURE_THRESHOLD',
      previous.circuitThreshold
    );
    restore('PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_RESET_MS', previous.circuitReset);
  }
  console.log('Player level projection service test passed');
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
