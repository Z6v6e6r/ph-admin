import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';

const ACCESS_FIELD_ID = 'e17a32f3-65f7-47c5-bda1-33d79932c884';
const TEST_DATE = new Date().toISOString().slice(0, 10);

function createService(refreshDay: (date: string, reason: string) => Promise<unknown>) {
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    { isEnabled: () => false, listCustomTournaments: async () => [] } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    { refreshDate: refreshDay } as never
  );
  (service as any).verifyLkJwtToken = async () => ({
    exp: Math.floor(Date.now() / 1000) + 300,
    tenantKey: 'iSkq6G'
  });
  return service;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let profilePayload: unknown = {
    customFields: [
      {
        id: ACCESS_FIELD_ID,
        value: ['host-option'],
        attributes: {
          options: [{ id: 'host-option', name: 'Проводит турниры' }]
        }
      }
    ]
  };
  let profileCalls = 0;
  let profileGate: Promise<void> | undefined;
  let releaseProfile: (() => void) | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    profileCalls += 1;
    assert.equal(
      String(input),
      'https://api.vivacrm.ru/end-user/api/v1/iSkq6G/profile'
    );
    assert.match(
      new Headers(init?.headers).get('authorization') ?? '',
      /^Bearer (valid|denied)-token$/
    );
    if (profileGate) {
      await profileGate;
    }
    return new Response(JSON.stringify(profilePayload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    let refreshCalls = 0;
    const service = createService(async (date, reason) => {
      refreshCalls += 1;
      assert.equal(date, TEST_DATE);
      assert.equal(reason, 'lk_tournament_mechanics_manual_refresh');
      return {
        enabled: true,
        refreshed: true,
        reason: 'refreshed',
        date,
        snapshotAvailable: true,
        tournaments: []
      };
    });

    profileGate = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const first = service.refreshVivaTournamentSnapshotDay({
      date: TEST_DATE,
      authorizationHeader: 'Bearer valid-token',
      tenantKeyHeader: 'iSkq6G'
    });
    const duplicate = service.refreshVivaTournamentSnapshotDay({
      date: TEST_DATE,
      authorizationHeader: 'Bearer valid-token',
      tenantKeyHeader: 'iSkq6G'
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(profileCalls, 1);
    releaseProfile?.();
    profileGate = undefined;
    const [result, duplicateResult] = await Promise.all([first, duplicate]);
    assert.equal(result.refreshed, true);
    assert.equal(duplicateResult.refreshed, true);
    assert.equal(refreshCalls, 2);

    await service.refreshVivaTournamentSnapshotDay({
      date: TEST_DATE,
      authorizationHeader: 'Bearer valid-token',
      tenantKeyHeader: 'iSkq6G'
    });
    assert.equal(profileCalls, 1, 'repeated token must reuse the bounded access check');
    assert.equal(refreshCalls, 3);

    profilePayload = {
      customFields: [{ id: ACCESS_FIELD_ID, value: ['не проводит турниры'] }]
    };
    await assert.rejects(
      () => service.refreshVivaTournamentSnapshotDay({
        date: TEST_DATE,
        authorizationHeader: 'Bearer denied-token',
        tenantKeyHeader: 'iSkq6G'
      }),
      (error: any) => error?.getStatus?.() === 403
    );
    assert.equal(profileCalls, 2);
    assert.equal(refreshCalls, 3, 'access denial must happen before snapshot refresh');

    await assert.rejects(
      () => service.refreshVivaTournamentSnapshotDay({
        date: TEST_DATE,
        authorizationHeader: 'Bearer denied-token',
        tenantKeyHeader: 'iSkq6G'
      }),
      (error: any) => error?.getStatus?.() === 403
    );
    assert.equal(profileCalls, 2, 'denied token must also use the bounded access check');

    await assert.rejects(
      () => service.refreshVivaTournamentSnapshotDay({
        date: '2026-02-30',
        authorizationHeader: 'Bearer valid-token',
        tenantKeyHeader: 'iSkq6G'
      }),
      (error: any) => error?.getStatus?.() === 400
    );
    assert.equal(profileCalls, 2, 'invalid date must fail before profile lookup');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Tournament manual refresh auth test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
