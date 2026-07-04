import * as assert from 'node:assert/strict';
import { VivaTournamentSnapshotService } from '../src/integrations/viva/viva-tournament-snapshot.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

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

function withSnapshotEnv<T>(callback: () => Promise<T>): Promise<T> {
  const originalReadModelEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL;
  const originalRefreshEnabled = process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED;
  const originalTick = process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS;
  const originalHydrateRetryMs = process.env.VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS;
  const originalMongoUri = process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  const originalTournamentsMongoUri = process.env.TOURNAMENTS_MONGODB_URI;
  const originalMongoUriFallback = process.env.MONGODB_URI;
  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_TICK_MS = '600000';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;

  return callback().finally(() => {
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL', originalReadModelEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_ENABLED', originalRefreshEnabled);
    restoreEnv('VIVA_TOURNAMENT_SNAPSHOT_TICK_MS', originalTick);
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
      listTournaments: async () => [sourceTournament],
      getDiagnostics: () => ({ enabled: true }),
      isEnabled: () => true
    } as never
  );

  const result = await service.findAll({ date: '2026-07-04' });
  assert.deepEqual(result.map((tournament) => tournament.id), ['snapshot-source']);
  assert.equal(liveVivaCalls, 0);
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

async function main(): Promise<void> {
  await testSnapshotRefreshSingleflightAndLocalDateFilter();
  await testSnapshotShadowRefreshDoesNotServeReadModel();
  await testSnapshotHydrationRetriesAfterMongoFailure();
  await testTournamentsServiceUsesSnapshotBeforeLiveViva();
  await testPublicDirectoryIncludesSnapshotFreshness();
  console.log('Viva tournament snapshot test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
