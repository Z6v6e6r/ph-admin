import * as assert from 'node:assert/strict';
import { VivaTournamentSnapshotService } from '../src/integrations/viva/viva-tournament-snapshot.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import {
  CustomTournament,
  Tournament,
  TournamentStatus
} from '../src/tournaments/tournaments.types';

function createTournament(id: string, startsAt: string): Tournament {
  return {
    id,
    source: 'VIVA',
    name: `Tournament ${id}`,
    status: TournamentStatus.REGISTRATION,
    startsAt,
    endsAt: startsAt.replace('19:00:00', '21:00:00'),
    studioName: 'Test station'
  };
}

function createCustomTournament(id: string, sourceTournamentId: string, startsAt: string): CustomTournament {
  return {
    id,
    source: 'CUSTOM',
    sourceTournamentId,
    exerciseId: sourceTournamentId,
    name: `Custom ${id}`,
    status: TournamentStatus.REGISTRATION,
    startsAt,
    endsAt: startsAt.replace('19:00:00', '21:00:00'),
    studioId: 'station-test',
    studioName: 'Test station',
    slug: `custom-${id}`,
    publicUrl: `https://example.test/tournaments/${id}`,
    isPublic: true,
    tournamentType: 'Мексикано',
    accessLevels: ['D'],
    gender: 'MIXED',
    maxPlayers: 8,
    participants: [],
    waitlist: [],
    allowedManagerPhones: [],
    skin: {
      title: `Custom ${id}`,
      ctaLabel: 'Записаться',
      tags: []
    },
    mechanics: {
      enabled: false,
      config: {} as never
    },
    changeLog: [],
    details: {
      sourceTournamentSnapshot: {
        id: sourceTournamentId,
        source: 'VIVA',
        name: `Snapshot ${sourceTournamentId}`,
        status: TournamentStatus.REGISTRATION,
        startsAt,
        endsAt: startsAt.replace('19:00:00', '21:00:00'),
        studioName: 'Test station'
      }
    }
  };
}

function withSnapshotEnv<T>(callback: () => Promise<T>): Promise<T> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalTick = process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS;
  const originalPastDays = process.env.VIVA_TOURNAMENT_SNAPSHOT_PAST_DAYS;
  const originalHydrateRetryMs = process.env.VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;
  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS = '600000';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_PAST_DAYS = '10000';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  return callback().finally(() => {
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_TICK_MS', originalTick);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_PAST_DAYS', originalPastDays);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS', originalHydrateRetryMs);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function testSnapshotRefreshSingleflightAndLocalDateFilter(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let lastOptions: { from?: string; to?: string } | undefined;
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { from?: string; to?: string }) => {
        calls += 1;
        lastOptions = options;
        return [
          createTournament('first', '2026-07-04T19:00:00+03:00'),
          createTournament('second', '2026-07-05T19:00:00+03:00')
        ];
      }
    } as never);

    try {
      const [firstSnapshot, secondSnapshot] = await Promise.all([
        snapshotService.refreshNow('test'),
        snapshotService.refreshNow('duplicate')
      ]);
      assert.equal(calls, 1);
      assert.equal(firstSnapshot?.tournamentsCount, 2);
      assert.equal(secondSnapshot?.tournamentsCount, 2);
      assert.ok(lastOptions?.from);
      assert.ok(lastOptions?.to);

      const filtered = await snapshotService.listTournaments({ date: '2026-07-04' });
      assert.deepEqual(filtered?.map((tournament) => tournament.id), ['first']);

      const diagnostics = snapshotService.getDiagnostics();
      assert.equal(diagnostics.enabled, true);
      assert.equal(diagnostics.refreshEnabled, true);
      assert.equal(diagnostics.readModelEnabled, true);
      assert.equal(diagnostics.snapshot?.tournamentsCount, 2);
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testSnapshotShadowRefreshDoesNotServeReadModel(): Promise<void> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalTick = process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;
  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'false';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS = '600000';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  const snapshotService = new VivaTournamentSnapshotService({
    listTournaments: async () => [createTournament('shadow', '2026-07-04T19:00:00+03:00')]
  } as never);

  try {
    const snapshot = await snapshotService.refreshNow('shadow-test');
    assert.equal(snapshot?.tournamentsCount, 1);
    assert.equal(await snapshotService.listTournaments({ date: '2026-07-04' }), null);
    const diagnostics = snapshotService.getDiagnostics();
    assert.equal(diagnostics.refreshEnabled, true);
    assert.equal(diagnostics.readModelEnabled, false);
    assert.equal(diagnostics.snapshot?.tournamentsCount, 1);
  } finally {
    await snapshotService.onModuleDestroy();
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_TICK_MS', originalTick);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  }
}

async function testSnapshotHydrationRetriesAfterMongoFailure(): Promise<void> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalTick = process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS;
  const originalHydrateRetryMs = process.env.VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;

  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'false';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS = '600000';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS = '1';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI = 'mongodb://snapshot-test';
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  const persistedTournament = createTournament('persisted', '2026-07-04T19:00:00+03:00');
  let collectionReads = 0;
  const snapshotService = new VivaTournamentSnapshotService({
    listTournaments: async () => []
  } as never);
  (snapshotService as any).collection = async () => ({
    findOne: async () => {
      collectionReads += 1;
      if (collectionReads === 1) {
        throw new Error('temporary mongo outage');
      }
      return {
        key: 'default',
        generatedAt: '2026-07-04T10:00:00.000Z',
        lastSuccessfulAt: '2026-07-04T10:00:00.000Z',
        windowFrom: '2026-07-01',
        windowTo: '2026-07-10',
        tournaments: [persistedTournament],
        tournamentsCount: 1,
        refreshReason: 'persisted'
      };
    }
  });

  try {
    assert.equal(await snapshotService.listTournaments({ date: '2026-07-04' }), null);
    assert.ok(snapshotService.getDiagnostics().lastHydrateFailureAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const hydrated = await snapshotService.listTournaments({ date: '2026-07-04' });
    assert.deepEqual(hydrated?.map((tournament) => tournament.id), ['persisted']);
    assert.equal(collectionReads, 2);
  } finally {
    await snapshotService.onModuleDestroy();
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_TICK_MS', originalTick);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS', originalHydrateRetryMs);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  }
}

async function testSnapshotRefreshOnAdminOpenUsesFiveMinuteTtl(): Promise<void> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalTick = process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;

  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'false';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS = '600000';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  let liveCalls = 0;
  const snapshotService = new VivaTournamentSnapshotService({
    listTournaments: async () => {
      liveCalls += 1;
      return [createTournament('fresh-live', '2026-07-06T19:00:00+03:00')];
    }
  } as never);

  (snapshotService as any).snapshot = {
    key: 'default',
    generatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    lastSuccessfulAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    windowFrom: '2026-07-01',
    windowTo: '2026-07-31',
    tournaments: [createTournament('stale', '2026-07-05T19:00:00+03:00')],
    tournamentsCount: 1,
    refreshReason: 'persisted'
  };

  try {
    const refreshed = await snapshotService.refreshOnAdminOpen(
      'admin_tournaments_schedule_open',
      5 * 60_000
    );
    assert.equal(refreshed.refreshed, true);
    assert.equal(refreshed.reason, 'refreshed');
    assert.equal(liveCalls, 1);

    const fresh = await snapshotService.refreshOnAdminOpen(
      'admin_tournaments_schedule_open',
      5 * 60_000
    );
    assert.equal(fresh.refreshed, false);
    assert.equal(fresh.reason, 'fresh');
    assert.equal(liveCalls, 1);
  } finally {
    await snapshotService.onModuleDestroy();
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_TICK_MS', originalTick);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  }
}

async function testTournamentsServiceUsesSnapshotBeforeLiveViva(): Promise<void> {
  const sourceTournament = createTournament('snapshot-source', '2026-07-04T19:00:00+03:00');
  let liveVivaCalls = 0;
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        liveVivaCalls += 1;
        return [createTournament('live-source', '2026-07-04T20:00:00+03:00')];
      },
      findTournamentById: async () => null
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => false,
      listCustomTournaments: async () => []
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      listTournaments: async (_options?: { date?: string }) => [sourceTournament],
      getDiagnostics: () => ({ enabled: true }),
      isEnabled: () => true
    } as never
  );

  const result = await service.findAll({
    date: '2026-07-04',
    now: new Date('2026-07-04T18:00:00+03:00')
  });
  assert.deepEqual(result.map((tournament) => tournament.id), ['snapshot-source']);
  assert.equal(liveVivaCalls, 0);
}

async function testAdminListUsesOnlyPersistedReadModels(): Promise<void> {
  for (const scenario of ['snapshot-cache-miss', 'missing-linked-source'] as const) {
    const persistedTournament = createCustomTournament(
      `persisted-${scenario}`,
      'missing-source',
      '2026-07-04T19:00:00+03:00'
    );
    const canceledLiveTournament = createTournament(
      'missing-source',
      '2026-07-04T20:00:00+03:00'
    );
    canceledLiveTournament.status = TournamentStatus.CANCELED;
    const calls = {
      snapshotList: 0,
      liveList: 0,
      liveDetail: 0,
      legacyList: 0,
      adminStatus: 0,
      persistenceUpdate: 0
    };
    const service = new TournamentsService(
      {
        listTournaments: async () => {
          calls.legacyList += 1;
          return [createTournament('legacy-source', '2026-07-04T20:00:00+03:00')];
        }
      } as never,
      {
        listTournaments: async () => {
          calls.liveList += 1;
          return [canceledLiveTournament];
        },
        findTournamentById: async () => {
          calls.liveDetail += 1;
          return canceledLiveTournament;
        }
      } as never,
      { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
      {
        isEnabled: () => true,
        listCustomTournaments: async () => [persistedTournament],
        updateCustomTournament: async () => {
          calls.persistenceUpdate += 1;
          return persistedTournament;
        }
      } as never,
      { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
      { simulateRating: () => { throw new Error('Not used in test'); } } as never,
      {
        getExerciseStatus: async () => {
          calls.adminStatus += 1;
          return { canceled: true };
        }
      } as never,
      undefined,
      {
        listTournaments: async () => {
          calls.snapshotList += 1;
          return scenario === 'snapshot-cache-miss'
            ? null
            : [createTournament('another-source', '2026-07-05T19:00:00+03:00')];
        }
      } as never
    );

    const result = await service.findAll({
      date: '2026-07-04',
      now: new Date('2026-07-04T18:00:00+03:00')
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(result.length, 1, `${scenario}: persisted tournament should remain visible`);
    assert.equal(result[0]?.id, persistedTournament.id);
    assert.equal(result[0]?.sourceTournamentId, persistedTournament.sourceTournamentId);
    assert.equal(result[0]?.name, persistedTournament.name);
    assert.equal(result[0]?.status, TournamentStatus.REGISTRATION);
    assert.deepEqual(result[0]?.participants, persistedTournament.participants);
    assert.equal(
      (result[0]?.details?.sourceTournamentSnapshot as { id?: string } | undefined)?.id,
      persistedTournament.sourceTournamentId
    );
    assert.deepEqual(calls, {
      snapshotList: 1,
      liveList: 0,
      liveDetail: 0,
      legacyList: 0,
      adminStatus: 0,
      persistenceUpdate: 0
    });
  }
}

async function testAdminListDoesNotTriggerSnapshotRefreshOnRead(): Promise<void> {
  await withSnapshotEnv(async () => {
    for (const scenario of ['cold', 'stale'] as const) {
      let liveRefreshCalls = 0;
      let legacyListCalls = 0;
      const sourceTournamentId = scenario === 'stale' ? 'stale-source' : 'cold-source';
      const persistedTournament = createCustomTournament(
        `persisted-${scenario}`,
        sourceTournamentId,
        '2026-07-04T19:00:00+03:00'
      );
      const liveVivaService = {
        listTournaments: async () => {
          liveRefreshCalls += 1;
          return [createTournament('live-refresh', '2026-07-04T20:00:00+03:00')];
        },
        findTournamentById: async () => {
          liveRefreshCalls += 1;
          return null;
        }
      };
      const snapshotService = new VivaTournamentSnapshotService(liveVivaService as never);

      if (scenario === 'stale') {
        (snapshotService as any).snapshot = {
          key: 'default',
          generatedAt: '2020-01-01T00:00:00.000Z',
          lastSuccessfulAt: '2020-01-01T00:00:00.000Z',
          windowFrom: '2026-07-01',
          windowTo: '2026-07-31',
          tournaments: [createTournament(sourceTournamentId, '2026-07-04T19:00:00+03:00')],
          tournamentsCount: 1,
          refreshReason: 'persisted'
        };
      }

      const service = new TournamentsService(
        {
          listTournaments: async () => {
            legacyListCalls += 1;
            return [];
          }
        } as never,
        liveVivaService as never,
        { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
        {
          isEnabled: () => true,
          listCustomTournaments: async () => [persistedTournament]
        } as never,
        { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
        { simulateRating: () => { throw new Error('Not used in test'); } } as never,
        undefined,
        undefined,
        snapshotService
      );

      try {
        const result = await service.findAll({
          date: '2026-07-04',
          now: new Date('2026-07-04T18:00:00+03:00')
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(result.length, 1, `${scenario}: read model should still serve the list`);
        assert.equal(liveRefreshCalls, 0, `${scenario}: list GET must not refresh Viva`);
        assert.equal(legacyListCalls, 0, `${scenario}: list GET must not use the legacy source`);
        assert.equal(snapshotService.getDiagnostics().lastStartedAt, undefined);
      } finally {
        await snapshotService.onModuleDestroy();
      }
    }
  });
}

async function testPublicDirectoryIncludesSnapshotFreshness(): Promise<void> {
  const lastSuccessfulAt = '2026-07-04T10:00:00.000Z';
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async () => null
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => []
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      listTournaments: async () => null,
      getDiagnostics: () => ({ enabled: true }),
      getFreshnessMetadata: () => ({
        refreshEnabled: true,
        readModelEnabled: true,
        refreshInProgress: true,
        stale: false,
        snapshotAvailable: true,
        snapshotAgeMs: 1500,
        lastSuccessfulAt
      }),
      isEnabled: () => true
    } as never
  );

  const response = await service.listPublicDirectory();
  assert.equal(response.count, 0);
  assert.equal(response.snapshotAgeMs, 1500);
  assert.equal(response.lastSuccessfulAt, lastSuccessfulAt);
  assert.equal(response.stale, false);
  assert.equal(response.refreshInProgress, true);
  assert.equal(response.snapshotAvailable, true);
  assert.equal(response.snapshotRefreshEnabled, true);
  assert.equal(response.snapshotReadModelEnabled, true);
}

async function testPublicDirectoryDoesNotFallbackToLiveViva(): Promise<void> {
  const customTournament = createCustomTournament(
    'public-local',
    'snapshot-unavailable',
    '2026-07-04T19:00:00+03:00'
  );
  let liveVivaCalls = 0;
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        liveVivaCalls += 1;
        return [createTournament('live-source', '2026-07-04T20:00:00+03:00')];
      },
      findTournamentById: async () => {
        liveVivaCalls += 1;
        return createTournament('live-detail', '2026-07-04T20:00:00+03:00');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [customTournament]
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      listTournaments: async () => null,
      getDiagnostics: () => ({ enabled: true }),
      getFreshnessMetadata: () => ({
        refreshEnabled: false,
        readModelEnabled: true,
        refreshInProgress: false,
        stale: true,
        snapshotAvailable: false
      }),
      isEnabled: () => true
    } as never
  );

  const response = await service.listPublicDirectory({
    date: '2026-07-04',
    includePast: true
  });
  assert.equal(response.count, 1);
  assert.equal(response.items[0]?.sourceTournamentId, 'snapshot-unavailable');
  assert.equal(liveVivaCalls, 0);
}

async function main(): Promise<void> {
  await testSnapshotRefreshSingleflightAndLocalDateFilter();
  await testSnapshotShadowRefreshDoesNotServeReadModel();
  await testSnapshotHydrationRetriesAfterMongoFailure();
  await testSnapshotRefreshOnAdminOpenUsesFiveMinuteTtl();
  await testTournamentsServiceUsesSnapshotBeforeLiveViva();
  await testAdminListUsesOnlyPersistedReadModels();
  await testAdminListDoesNotTriggerSnapshotRefreshOnRead();
  await testPublicDirectoryIncludesSnapshotFreshness();
  await testPublicDirectoryDoesNotFallbackToLiveViva();
  console.log('Viva tournament snapshot test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
