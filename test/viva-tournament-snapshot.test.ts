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

async function testManualDayRefreshUsesOneBoundedVivaCall(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let lastOptions: { date?: string; includePast?: boolean } | undefined;
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string; includePast?: boolean }) => {
        calls += 1;
        lastOptions = options;
        return [createTournament('fresh-day', '2026-07-04T20:00:00+03:00')];
      }
    } as never);
    const previousLastSuccessfulAt = '2026-07-01T10:00:00.000Z';
    (snapshotService as any).snapshot = {
      key: 'default',
      generatedAt: previousLastSuccessfulAt,
      lastSuccessfulAt: previousLastSuccessfulAt,
      windowFrom: '2026-07-01',
      windowTo: '2026-07-10',
      tournaments: [
        createTournament('stale-day', '2026-07-04T19:00:00+03:00'),
        createTournament('untouched-day', '2026-07-05T19:00:00+03:00')
      ],
      tournamentsCount: 2,
      refreshReason: 'persisted'
    };

    try {
      const refreshed = await snapshotService.refreshDate('2026-07-04', 'test_manual');
      assert.equal(refreshed.refreshed, true);
      assert.equal(refreshed.reason, 'refreshed');
      assert.deepEqual(refreshed.tournaments.map((item) => item.id), ['fresh-day']);
      assert.deepEqual(lastOptions, { date: '2026-07-04', includePast: true });
      assert.equal(calls, 1);

      const selectedDay = await snapshotService.listTournaments({
        date: '2026-07-04',
        refreshOnRead: false
      });
      const untouchedDay = await snapshotService.listTournaments({
        date: '2026-07-05',
        refreshOnRead: false
      });
      assert.deepEqual(selectedDay?.map((item) => item.id), ['fresh-day']);
      assert.deepEqual(untouchedDay?.map((item) => item.id), ['untouched-day']);
      assert.equal(snapshotService.getDiagnostics().lastSuccessfulAt, previousLastSuccessfulAt);

      const throttled = await snapshotService.refreshDate('2026-07-05', 'test_duplicate');
      assert.equal(throttled.refreshed, false);
      assert.equal(throttled.reason, 'cooldown');
      assert.ok((throttled.retryAfterMs ?? 0) > 0);
      assert.equal(calls, 1, 'cooldown must not call Viva for another date');
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testManualDayRefreshCoalescesConcurrentFailures(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async () => {
        calls += 1;
        await gate;
        return null;
      }
    } as never);

    try {
      const first = snapshotService.refreshDate('2026-07-04', 'test_failure');
      const duplicate = snapshotService.refreshDate('2026-07-04', 'test_failure_duplicate');
      await Promise.resolve();
      assert.equal(calls, 1);
      release?.();

      const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
      assert.equal(firstResult.reason, 'refresh_failed');
      assert.equal(duplicateResult.reason, 'refresh_failed');
      assert.equal(calls, 1, 'concurrent failure must remain single-flight');

      const throttled = await snapshotService.refreshDate('2026-07-04', 'test_retry');
      assert.equal(throttled.reason, 'cooldown');
      assert.equal(calls, 1, 'failed attempt must also enter cooldown');
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testManualDayRefreshWorksWithBackgroundRefreshDisabled(): Promise<void> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;
  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'false';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  let calls = 0;
  const snapshotService = new VivaTournamentSnapshotService({
    listTournaments: async () => {
      calls += 1;
      return [createTournament('manual-with-background-off', '2026-07-04T20:00:00+03:00')];
    }
  } as never);

  try {
    const result = await snapshotService.refreshDate('2026-07-04', 'test_manual_background_off');
    assert.equal(result.refreshed, true);
    assert.equal(result.reason, 'refreshed');
    assert.equal(calls, 1);
    assert.deepEqual(
      result.tournaments.map((tournament) => tournament.id),
      ['manual-with-background-off']
    );
  } finally {
    await snapshotService.onModuleDestroy();
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI', originalMongoUri);
    restoreEnv('TOURNAMENTS_MONGODB_URI', originalTournamentsMongoUri);
    restoreEnv('MONGODB_URI', originalMongoUriFallback);
  }
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
        assert.equal(
          snapshotService.getDiagnostics().lastPublicReadAt,
          undefined,
          `${scenario}: read-only GET must not activate the background refresh cadence`
        );
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

async function testPublicDateRevalidationCoalescesConcurrentPageLoads(): Promise<void> {
  await withSnapshotEnv(async () => {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    let calls = 0;
    let releaseViva: (() => void) | undefined;
    const vivaGate = new Promise<void>((resolve) => {
      releaseViva = resolve;
    });
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string; includePast?: boolean }) => {
        calls += 1;
        assert.deepEqual(options, { date, includePast: true });
        await vivaGate;
        return [createTournament('fresh-public-count', `${date}T19:00:00+03:00`)];
      }
    } as never);

    try {
      const pendingResults = Promise.all(
        Array.from({ length: 50 }, () => snapshotService.revalidateDateIfStale(date))
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls, 1);

      releaseViva?.();
      const results = await pendingResults;
      assert.ok(results.every((result) => result.refreshed));
      assert.ok(results.every((result) => result.reason === 'refreshed'));
      assert.ok(results.every((result) => !result.scheduled));
      const freshness = snapshotService.getFreshnessMetadata(date);
      assert.equal(freshness.stale, false);
      assert.equal(freshness.snapshotAvailable, true);

      const repeat = await snapshotService.revalidateDateIfStale(date);
      assert.equal(repeat.scheduled, false);
      assert.equal(repeat.reason, 'fresh');
      assert.equal(calls, 1);
    } finally {
      releaseViva?.();
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testPublicDateRevalidationBypassesManualCooldownForAnotherDate(): Promise<void> {
  await withSnapshotEnv(async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(Date.now() + 24 * 60 * 60_000));
    const requestedDates: string[] = [];
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string }) => {
        const requestedDate = String(options?.date ?? '');
        requestedDates.push(requestedDate);
        return [createTournament(`fresh-${requestedDate}`, `${requestedDate}T19:00:00+03:00`)];
      }
    } as never);

    try {
      const manual = await snapshotService.refreshDate(today, 'test_manual_before_public');
      assert.equal(manual.refreshed, true);

      const publicRefresh = await snapshotService.revalidateDateIfStale(
        tomorrow,
        'test_public_after_manual'
      );
      assert.equal(publicRefresh.refreshed, true);
      assert.equal(publicRefresh.reason, 'refreshed');
      assert.deepEqual(requestedDates, [today, tomorrow]);

      const manualAfterPublic = await snapshotService.refreshDate(
        tomorrow,
        'test_manual_after_public'
      );
      assert.equal(manualAfterPublic.reason, 'cooldown');
      assert.deepEqual(requestedDates, [today, tomorrow]);
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testPublicDateRevalidationHasGlobalBudgetAcrossDates(): Promise<void> {
  await withSnapshotEnv(async () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const dates = Array.from({ length: 5 }, (_, index) =>
      formatter.format(new Date(Date.now() + index * 24 * 60 * 60_000))
    );
    let calls = 0;
    let releaseViva: (() => void) | undefined;
    const vivaGate = new Promise<void>((resolve) => {
      releaseViva = resolve;
    });
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string }) => {
        calls += 1;
        await vivaGate;
        const date = String(options?.date ?? '');
        return [createTournament(`fresh-${date}`, `${date}T19:00:00+03:00`)];
      }
    } as never);

    try {
      const first = snapshotService.revalidateDateIfStale(dates[0]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const otherDates = await Promise.all(
        dates.slice(1).map((date) => snapshotService.revalidateDateIfStale(date))
      );
      assert.equal(calls, 1);
      assert.ok(otherDates.every((result) => result.reason === 'cooldown'));
      assert.ok(otherDates.every((result) => (result.retryAfterMs ?? 0) > 0));

      releaseViva?.();
      assert.equal((await first).reason, 'refreshed');

      const repeatOtherDate = await snapshotService.revalidateDateIfStale(dates[1]);
      assert.equal(repeatOtherDate.reason, 'cooldown');
      assert.equal(calls, 1);
    } finally {
      releaseViva?.();
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testListEnvelopeWaitsForOnlyDayRefresh(): Promise<void> {
  const date = '2026-08-13';
  const sourceTournament = createTournament('source-count', `${date}T19:00:00+03:00`);
  const customTournament = createCustomTournament(
    'public-count',
    sourceTournament.id,
    `${date}T19:00:00+03:00`
  );
  const privateSourceTournament = createTournament(
    'private-source-count',
    `${date}T20:00:00+03:00`
  );
  const privateCustomTournament = {
    ...createCustomTournament(
      'private-count',
      privateSourceTournament.id,
      `${date}T20:00:00+03:00`
    ),
    isPublic: false
  };
  const canceledSourceTournament = {
    ...createTournament('canceled-source-count', `${date}T21:00:00+03:00`),
    status: TournamentStatus.CANCELED,
    rawStatus: 'CANCELLED'
  };
  const staleLinkedCustomTournament = createCustomTournament(
    'stale-linked-count',
    canceledSourceTournament.id,
    `${date}T21:00:00+03:00`
  );
  let revalidationDate: string | undefined;
  let freshnessDate: string | undefined;
  let liveVivaCalls = 0;
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        liveVivaCalls += 1;
        return [];
      },
      findTournamentById: async () => null
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [
        customTournament,
        privateCustomTournament,
        staleLinkedCustomTournament
      ]
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      revalidateDateIfStale: async (requestedDate: string) => {
        revalidationDate = requestedDate;
        return {
          enabled: true,
          scheduled: false,
          refreshed: true,
          reason: 'refreshed',
          date: requestedDate,
          snapshotAvailable: true,
          snapshotAgeMs: 120_000
        };
      },
      listTournaments: async () => [
        sourceTournament,
        privateSourceTournament,
        canceledSourceTournament
      ],
      getFreshnessMetadata: (requestedDate: string) => {
        freshnessDate = requestedDate;
        return {
          refreshEnabled: true,
          readModelEnabled: true,
          refreshInProgress: false,
          stale: false,
          snapshotAvailable: true,
          snapshotAgeMs: 120_000,
          lastSuccessfulAt: '2026-08-13T09:00:00.000Z'
        };
      }
    } as never
  );

  const response = await service.findAllWithSnapshotRevalidation({ date });
  assert.equal(revalidationDate, date);
  assert.equal(freshnessDate, date);
  assert.equal(response.count, 1);
  assert.equal(response.items[0]?.id, sourceTournament.id);
  assert.equal(response.refreshScheduled, false);
  assert.equal(response.refreshCompleted, true);
  assert.equal(response.refreshReason, 'refreshed');
  assert.equal(response.refreshInProgress, false);
  assert.equal(response.stale, false);
  assert.equal(liveVivaCalls, 0);
}

async function main(): Promise<void> {
  await testSnapshotRefreshSingleflightAndLocalDateFilter();
  await testManualDayRefreshUsesOneBoundedVivaCall();
  await testManualDayRefreshCoalescesConcurrentFailures();
  await testManualDayRefreshWorksWithBackgroundRefreshDisabled();
  await testSnapshotShadowRefreshDoesNotServeReadModel();
  await testSnapshotHydrationRetriesAfterMongoFailure();
  await testSnapshotRefreshOnAdminOpenUsesFiveMinuteTtl();
  await testTournamentsServiceUsesSnapshotBeforeLiveViva();
  await testAdminListUsesOnlyPersistedReadModels();
  await testAdminListDoesNotTriggerSnapshotRefreshOnRead();
  await testPublicDirectoryIncludesSnapshotFreshness();
  await testPublicDirectoryDoesNotFallbackToLiveViva();
  await testPublicDateRevalidationCoalescesConcurrentPageLoads();
  await testPublicDateRevalidationBypassesManualCooldownForAnotherDate();
  await testPublicDateRevalidationHasGlobalBudgetAcrossDates();
  await testListEnvelopeWaitsForOnlyDayRefresh();
  console.log('Viva tournament snapshot test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
