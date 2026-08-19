import * as assert from 'node:assert/strict';
import { VivaTournamentSnapshotService } from '../src/integrations/viva/viva-tournament-snapshot.service';
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

function seedSnapshot(service: VivaTournamentSnapshotService, tournaments: Tournament[]): void {
  (service as any).snapshot = {
    key: 'default',
    generatedAt: '2026-07-01T10:00:00.000Z',
    lastSuccessfulAt: '2026-07-01T10:00:00.000Z',
    windowFrom: '2026-07-01',
    windowTo: '2026-07-10',
    tournaments,
    tournamentsCount: tournaments.length,
    refreshReason: 'persisted',
    dateLastSuccessfulAt: {}
  };
}

async function withSnapshotEnv(callback: () => Promise<void>): Promise<void> {
  const names = [
    'VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL',
    'VIVA_TOURNAMENT_SNAPSHOT_ENABLED',
    'VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI',
    'TOURNAMENTS_MONGODB_URI',
    'MONGODB_URI'
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL = 'true';
  process.env.VIVA_TOURNAMENT_SNAPSHOT_ENABLED = 'false';
  delete process.env.VIVA_TOURNAMENT_SNAPSHOT_MONGODB_URI;
  delete process.env.TOURNAMENTS_MONGODB_URI;
  delete process.env.MONGODB_URI;
  try {
    await callback();
  } finally {
    names.forEach((name) => {
      const value = previous.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
}

async function testRangeRefreshIsSequentialAndPreservesFailedDates(): Promise<void> {
  await withSnapshotEnv(async () => {
    const calls: string[] = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;
    let persistCalls = 0;
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string }) => {
        const date = String(options?.date || '');
        calls.push(date);
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeCalls -= 1;
        if (date === '2026-07-05') {
          return null;
        }
        return [createTournament(`fresh-${date}`, `${date}T19:00:00+03:00`)];
      }
    } as never);
    seedSnapshot(snapshotService, [
      createTournament('stale-04', '2026-07-04T19:00:00+03:00'),
      createTournament('preserved-05', '2026-07-05T19:00:00+03:00'),
      createTournament('stale-06', '2026-07-06T19:00:00+03:00'),
      createTournament('untouched-07', '2026-07-07T19:00:00+03:00')
    ]);
    (snapshotService as any).persistSnapshot = async () => {
      persistCalls += 1;
      return true;
    };

    try {
      const result = await snapshotService.refreshRange(
        '2026-07-04',
        '2026-07-06',
        'test_manual_range'
      );
      assert.equal(result.refreshed, true);
      assert.equal(result.reason, 'partial');
      assert.equal(result.requestedDays, 3);
      assert.equal(result.refreshedDays, 2);
      assert.equal(result.failedDays, 1);
      assert.deepEqual(result.refreshedDates, ['2026-07-04', '2026-07-06']);
      assert.deepEqual(result.failedDates, ['2026-07-05']);
      assert.equal(result.tournamentsCount, 2);
      assert.equal(result.persisted, true);
      assert.deepEqual(calls, ['2026-07-04', '2026-07-05', '2026-07-06']);
      assert.equal(maxActiveCalls, 1, 'range must call Viva sequentially');
      assert.equal(persistCalls, 1, 'range must persist the merged snapshot once');

      assert.deepEqual(
        (await snapshotService.listTournaments({ date: '2026-07-04', refreshOnRead: false }))
          ?.map((item) => item.id),
        ['fresh-2026-07-04']
      );
      assert.deepEqual(
        (await snapshotService.listTournaments({ date: '2026-07-05', refreshOnRead: false }))
          ?.map((item) => item.id),
        ['preserved-05'],
        'failed dates must retain the prior snapshot data'
      );
      assert.deepEqual(
        (await snapshotService.listTournaments({ date: '2026-07-07', refreshOnRead: false }))
          ?.map((item) => item.id),
        ['untouched-07']
      );
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testRangeRefreshSingleFlightCooldownAndValidation(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string }) => {
        calls += 1;
        if (calls === 1) {
          await gate;
        }
        const date = String(options?.date || '');
        return [createTournament(`fresh-${date}`, `${date}T19:00:00+03:00`)];
      }
    } as never);
    seedSnapshot(snapshotService, []);
    (snapshotService as any).persistSnapshot = async () => true;

    try {
      const first = snapshotService.refreshRange('2026-07-04', '2026-07-05', 'first');
      const duplicate = snapshotService.refreshRange('2026-07-04', '2026-07-05', 'duplicate');
      const different = snapshotService.refreshRange('2026-07-05', '2026-07-06', 'different');
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls, 1, 'concurrent range requests must not start another Viva call');
      const differentResult = await different;
      assert.equal(differentResult.reason, 'cooldown');
      release?.();

      const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
      assert.equal(firstResult.reason, 'refreshed');
      assert.deepEqual(duplicateResult, firstResult);
      assert.equal(calls, 2, 'identical range requests must share one two-day fan-out');

      const throttled = await snapshotService.refreshRange(
        '2026-07-06',
        '2026-07-06',
        'after_range'
      );
      assert.equal(throttled.reason, 'cooldown');
      assert.equal(calls, 2);

      await assert.rejects(
        () => snapshotService.refreshRange('2026-02-30', '2026-03-01'),
        /valid YYYY-MM-DD/
      );
      await assert.rejects(
        () => snapshotService.refreshRange('2026-07-06', '2026-07-04'),
        /from <= to/
      );
      await assert.rejects(
        () => snapshotService.refreshRange('2026-07-01', '2026-08-01'),
        /cannot exceed 31 days/
      );
      assert.equal(calls, 2, 'invalid ranges must not call Viva');
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testDayRefreshCannotQueueBehindSlowRange(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async (options?: { date?: string }) => {
        calls += 1;
        if (calls === 1) {
          await gate;
        }
        const date = String(options?.date || '');
        return [createTournament(`fresh-${date}`, `${date}T19:00:00+03:00`)];
      }
    } as never);
    seedSnapshot(snapshotService, []);
    (snapshotService as any).manualRefreshCooldownMs = 1;
    (snapshotService as any).persistSnapshot = async () => true;

    try {
      const range = snapshotService.refreshRange('2026-07-04', '2026-07-05', 'slow_range');
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      const day = snapshotService.refreshDate('2026-07-06', 'queued_day');
      const dayResult = await day;
      assert.equal(dayResult.reason, 'cooldown');
      assert.equal(calls, 1, 'day refresh must not queue another Viva call behind an active range');

      release?.();
      const rangeResult = await range;
      assert.equal(rangeResult.reason, 'refreshed');
      assert.equal(calls, 2, 'only the two range dates may reach Viva');
    } finally {
      release?.();
      await snapshotService.onModuleDestroy();
    }
  });
}

async function testRangeRefreshAllFailureDoesNotReplaceSnapshot(): Promise<void> {
  await withSnapshotEnv(async () => {
    let calls = 0;
    let persistCalls = 0;
    const snapshotService = new VivaTournamentSnapshotService({
      listTournaments: async () => {
        calls += 1;
        return null;
      }
    } as never);
    seedSnapshot(snapshotService, [
      createTournament('preserved-04', '2026-07-04T19:00:00+03:00'),
      createTournament('preserved-05', '2026-07-05T19:00:00+03:00')
    ]);
    (snapshotService as any).persistSnapshot = async () => {
      persistCalls += 1;
      return true;
    };

    try {
      const result = await snapshotService.refreshRange(
        '2026-07-04',
        '2026-07-05',
        'test_all_failure'
      );
      assert.equal(result.refreshed, false);
      assert.equal(result.reason, 'refresh_failed');
      assert.equal(result.refreshedDays, 0);
      assert.equal(result.failedDays, 2);
      assert.deepEqual(result.failedDates, ['2026-07-04', '2026-07-05']);
      assert.equal(result.tournamentsCount, 0);
      assert.equal(result.snapshotAvailable, true);
      assert.equal(calls, 2);
      assert.equal(persistCalls, 0, 'all-provider failure must not persist a replacement snapshot');
      assert.deepEqual(
        (await snapshotService.listTournaments({
          from: '2026-07-04',
          to: '2026-07-05',
          refreshOnRead: false
        }))?.map((item) => item.id),
        ['preserved-04', 'preserved-05']
      );
    } finally {
      await snapshotService.onModuleDestroy();
    }
  });
}

async function main(): Promise<void> {
  await testRangeRefreshIsSequentialAndPreservesFailedDates();
  await testRangeRefreshSingleFlightCooldownAndValidation();
  await testDayRefreshCannotQueueBehindSlowRange();
  await testRangeRefreshAllFailureDoesNotReplaceSnapshot();
  console.log('Viva tournament snapshot range test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
