import * as assert from 'node:assert/strict';
import { VivaReferenceCacheService } from '../src/integrations/viva/viva-reference-cache.service';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withReferenceCacheEnv<T>(callback: () => Promise<T>): Promise<T> {
  const originalEnabled = process.env.VIVA_REFERENCE_CACHE_ENABLED;
  const originalMongoUri = process.env.VIVA_REFERENCE_CACHE_MONGODB_URI;
  const originalSnapshotMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;
  process.env.VIVA_REFERENCE_CACHE_ENABLED = 'true';
  delete process.env.VIVA_REFERENCE_CACHE_MONGODB_URI;
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  return callback().finally(() => {
    restoreEnv('VIVA_REFERENCE_CACHE_ENABLED', originalEnabled);
    restoreEnv('VIVA_REFERENCE_CACHE_MONGODB_URI', originalMongoUri);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalSnapshotMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  });
}

async function testReferenceCacheDisabledByDefault(): Promise<void> {
  const originalEnabled = process.env.VIVA_REFERENCE_CACHE_ENABLED;
  delete process.env.VIVA_REFERENCE_CACHE_ENABLED;

  const cache = new VivaReferenceCacheService();
  let calls = 0;
  try {
    assert.equal(cache.getDiagnostics().enabled, false);
    const load = async (): Promise<string[]> => {
      calls += 1;
      return [`value-${calls}`];
    };

    assert.deepEqual(
      await cache.getOrLoad({
        widgetId: 'widget-test',
        type: 'studios',
        ttlMs: 60_000,
        load
      }),
      ['value-1']
    );
    assert.deepEqual(
      await cache.getOrLoad({
        widgetId: 'widget-test',
        type: 'studios',
        ttlMs: 60_000,
        load
      }),
      ['value-2']
    );
    assert.equal(calls, 2);
  } finally {
    await cache.onModuleDestroy();
    restoreEnv('VIVA_REFERENCE_CACHE_ENABLED', originalEnabled);
  }
}

async function testReferenceCacheSingleflightAndStaleFallback(): Promise<void> {
  await withReferenceCacheEnv(async () => {
    let now = Date.parse('2026-07-04T10:00:00.000Z');
    const cache = new VivaReferenceCacheService(() => now);
    let calls = 0;
    let release: ((value: string[]) => void) | undefined;
    const slowLoad = new Promise<string[]>((resolve) => {
      release = resolve;
    });

    try {
      const first = cache.getOrLoad({
        widgetId: 'widget-test',
        type: 'studios',
        ttlMs: 1000,
        load: async () => {
          calls += 1;
          return slowLoad;
        }
      });
      const second = cache.getOrLoad({
        widgetId: 'widget-test',
        type: 'studios',
        ttlMs: 1000,
        load: async () => {
          calls += 1;
          return ['duplicate'];
        }
      });

      await Promise.resolve();
      assert.equal(calls, 1);
      release?.(['cached']);
      assert.deepEqual(await Promise.all([first, second]), [['cached'], ['cached']]);

      assert.deepEqual(
        await cache.getOrLoad({
          widgetId: 'widget-test',
          type: 'studios',
          ttlMs: 1000,
          load: async () => {
            calls += 1;
            return ['fresh'];
          }
        }),
        ['cached']
      );
      assert.equal(calls, 1);

      now += 1001;
      assert.deepEqual(
        await cache.getOrLoad({
          widgetId: 'widget-test',
          type: 'studios',
          ttlMs: 1000,
          load: async () => {
            calls += 1;
            throw new Error('Viva reference timeout');
          }
        }),
        ['cached']
      );
      assert.equal(calls, 2);
      const diagnostics = cache.getDiagnostics();
      assert.equal(diagnostics.entries[0]?.stale, true);
      assert.match(diagnostics.entries[0]?.lastError ?? '', /Viva reference timeout/);
    } finally {
      await cache.onModuleDestroy();
    }
  });
}

async function testVivaTournamentsUsesReferenceCache(): Promise<void> {
  await withReferenceCacheEnv(async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
    const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
    const originalProfilePreload = process.env.VIVA_TOURNAMENT_PROFILE_PRELOAD_ENABLED;
    process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
    process.env.VIVA_END_USER_WIDGET_ID = 'widget-test';
    delete process.env.VIVA_TOURNAMENT_PROFILE_PRELOAD_ENABLED;

    const fetchCounts = new Map<string, number>();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const endpoint = url.pathname.split('/').pop() ?? '';
      fetchCounts.set(endpoint, (fetchCounts.get(endpoint) ?? 0) + 1);

      if (endpoint === 'studios') {
        return new Response(JSON.stringify([{ id: 'studio-1', name: 'Studio One' }]), { status: 200 });
      }
      if (endpoint === 'trainers') {
        return new Response(JSON.stringify([{ id: 'trainer-1', name: 'Trainer One' }]), { status: 200 });
      }
      if (endpoint === 'profile') {
        return new Response(JSON.stringify({ id: 'profile' }), { status: 200 });
      }
      if (endpoint === 'dates') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (endpoint === 'exercises') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const cache = new VivaReferenceCacheService();
    try {
      const service = new VivaTournamentsService(undefined, undefined, cache);
      await service.listTournaments();
      await service.listTournaments();

      assert.equal(fetchCounts.get('studios'), 1);
      assert.equal(fetchCounts.get('trainers'), 1);
      assert.equal(fetchCounts.get('profile'), undefined);
      assert.equal(cache.getDiagnostics().entries.length, 2);
    } finally {
      await cache.onModuleDestroy();
      globalThis.fetch = originalFetch;
      restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
      restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
      restoreEnv('VIVA_TOURNAMENT_PROFILE_PRELOAD_ENABLED', originalProfilePreload);
    }
  });
}

async function main(): Promise<void> {
  await testReferenceCacheDisabledByDefault();
  await testReferenceCacheSingleflightAndStaleFallback();
  await testVivaTournamentsUsesReferenceCache();
  console.log('Viva reference cache test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
