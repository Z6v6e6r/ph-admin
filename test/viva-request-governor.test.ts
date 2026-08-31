import * as assert from 'node:assert/strict';
import {
  VivaCircuitOpenError,
  VivaRequestGovernorService
} from '../src/integrations/viva/viva-request-governor.service';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function testSingleflight(): Promise<void> {
  const governor = new VivaRequestGovernorService();
  let executions = 0;
  let release: ((value: string) => void) | undefined;
  const slowResult = new Promise<string>((resolve) => {
    release = resolve;
  });

  const first = governor.run({
    key: 'GET https://viva.example/catalog',
    bucket: 'viva:widget:catalog',
    execute: async () => {
      executions += 1;
      return slowResult;
    }
  });
  const second = governor.run({
    key: 'GET https://viva.example/catalog',
    bucket: 'viva:widget:catalog',
    execute: async () => {
      executions += 1;
      return 'duplicate';
    }
  });

  await Promise.resolve();
  assert.equal(executions, 1);
  release?.('ok');
  assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
}

async function testCircuitBreaker(): Promise<void> {
  const originalThreshold = process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD;
  const originalCooldown = process.env.VIVA_GOVERNOR_CIRCUIT_COOLDOWN_MS;
  let now = Date.parse('2026-07-04T10:00:00.000Z');
  process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD = '2';
  process.env.VIVA_GOVERNOR_CIRCUIT_COOLDOWN_MS = '60000';

  try {
    const governor = new VivaRequestGovernorService(() => now);
    const fail = async (key: string): Promise<void> => {
      await governor.run({
        key,
        bucket: 'viva:widget:catalog',
        execute: async () => {
          const error = new Error('upstream timeout') as Error & { status?: number };
          error.status = 504;
          throw error;
        }
      });
    };

    await assert.rejects(() => fail('first'), /upstream timeout/);
    await assert.rejects(() => fail('second'), /upstream timeout/);
    await assert.rejects(
      () => governor.run({
        key: 'third',
        bucket: 'viva:widget:catalog',
        execute: async () => 'should not execute'
      }),
      VivaCircuitOpenError
    );

    now += 60_001;
    assert.equal(
      await governor.run({
        key: 'after-cooldown',
        bucket: 'viva:widget:catalog',
        execute: async () => 'recovered'
      }),
      'recovered'
    );
  } finally {
    if (originalThreshold === undefined) {
      delete process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD;
    } else {
      process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD = originalThreshold;
    }
    if (originalCooldown === undefined) {
      delete process.env.VIVA_GOVERNOR_CIRCUIT_COOLDOWN_MS;
    } else {
      process.env.VIVA_GOVERNOR_CIRCUIT_COOLDOWN_MS = originalCooldown;
    }
  }
}

async function testVivaTournamentsUsesGovernorSingleflight(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalGovernorEnabled = process.env.VIVA_GOVERNOR_ENABLED;
  let fetchCount = 0;
  let release: (() => void) | undefined;

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'iSkq6G';
  process.env.VIVA_GOVERNOR_ENABLED = 'true';

  const responsePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    fetchCount += 1;
    await responsePromise;
    return new Response(
      JSON.stringify([
        {
          id: 'tournament-1',
          name: 'Padel tournament',
          exerciseTypeId: '839',
          startsAt: '2026-07-04T19:00:00+03:00',
          endsAt: '2026-07-04T21:00:00+03:00'
        }
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    );
  }) as typeof fetch;

  try {
    const governor = new VivaRequestGovernorService();
    const service = new VivaTournamentsService(undefined, governor);
    const first = service.listTournaments({ date: '2026-07-04' });
    const second = service.listTournaments({ date: '2026-07-04' });

    await Promise.resolve();
    assert.equal(fetchCount, 2);
    release?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult?.length, 1);
    assert.equal(secondResult?.length, 1);
    assert.equal(fetchCount, 2);
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
    if (originalGovernorEnabled === undefined) {
      delete process.env.VIVA_GOVERNOR_ENABLED;
    } else {
      process.env.VIVA_GOVERNOR_ENABLED = originalGovernorEnabled;
    }
  }
}

async function testVivaTournamentsGovernorDisabledByDefault(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalApiBaseUrl = process.env.VIVA_END_USER_API_BASE_URL;
  const originalWidgetId = process.env.VIVA_END_USER_WIDGET_ID;
  const originalGovernorEnabled = process.env.VIVA_GOVERNOR_ENABLED;
  let fetchCount = 0;

  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  process.env.VIVA_END_USER_WIDGET_ID = 'iSkq6G';
  delete process.env.VIVA_GOVERNOR_ENABLED;

  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCount += 1;
    const url = new URL(String(input));
    return new Response(
      JSON.stringify([
        {
          id: url.searchParams.has('studioId') ? 'piter-tournament' : 'base-tournament',
          name: 'Padel tournament',
          exerciseTypeId: '839',
          startsAt: '2026-07-04T19:00:00+03:00',
          endsAt: '2026-07-04T21:00:00+03:00'
        }
      ]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    );
  }) as typeof fetch;

  try {
    const governor = new VivaRequestGovernorService();
    const service = new VivaTournamentsService(undefined, governor);
    const [firstResult, secondResult] = await Promise.all([
      service.listTournaments({ date: '2026-07-04' }),
      service.listTournaments({ date: '2026-07-04' })
    ]);

    assert.equal(fetchCount, 4);
    assert.equal(firstResult?.length, 2);
    assert.equal(secondResult?.length, 2);
    assert.equal(service.getRequestGovernorDiagnostics().enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VIVA_END_USER_API_BASE_URL', originalApiBaseUrl);
    restoreEnv('VIVA_END_USER_WIDGET_ID', originalWidgetId);
    restoreEnv('VIVA_GOVERNOR_ENABLED', originalGovernorEnabled);
  }
}

async function main(): Promise<void> {
  await testSingleflight();
  await testCircuitBreaker();
  await testVivaTournamentsGovernorDisabledByDefault();
  await testVivaTournamentsUsesGovernorSingleflight();
  console.log('Viva request governor test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
