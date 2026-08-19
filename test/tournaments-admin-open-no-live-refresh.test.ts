import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TournamentsService } from '../src/tournaments/tournaments.service';

async function main(): Promise<void> {
  let broadRefreshCalls = 0;
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    { isEnabled: () => false, listCustomTournaments: async () => [] } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      refreshOnAdminOpen: async () => {
        broadRefreshCalls += 1;
        throw new Error('Broad Viva refresh must not run on open');
      },
      getFreshnessMetadata: () => ({
        refreshEnabled: false,
        readModelEnabled: true,
        refreshInProgress: false,
        stale: false,
        snapshotAvailable: true,
        snapshotAgeMs: 1_000,
        lastSuccessfulAt: '2026-08-05T05:00:00.000Z'
      })
    } as never
  );

  const result = await service.refreshVivaTournamentSnapshotOnAdminOpen();
  assert.equal(broadRefreshCalls, 0);
  assert.deepEqual(result, {
    enabled: true,
    refreshed: false,
    reason: 'fresh',
    snapshotAvailable: true,
    snapshotAgeMs: 1_000,
    lastSuccessfulAt: '2026-08-05T05:00:00.000Z'
  });

  const sdkSource = readFileSync('client-sdk/phab-admin-panel.js', 'utf8');
  const openHandler = sdkSource.match(
    /async function openTournamentsSchedule\(\) \{([\s\S]*?)\n    \}/
  )?.[1];
  assert.ok(openHandler, 'admin tournament open handler must exist');
  assert.doesNotMatch(openHandler, /refreshTournamentSnapshotOnOpen|refresh-on-open/);
  assert.match(openHandler, /await loadTournaments\(\)/);

  assert.match(
    sdkSource,
    /request\('\/tournaments\/snapshot\/admin-refresh-day', 'POST'/
  );
  assert.match(
    sdkSource,
    /request\('\/tournaments\/snapshot\/admin-refresh-range', 'POST'/
  );
  assert.match(sdkSource, /tournamentsVivaRefreshToDateInput\.type = 'date'/);
  assert.match(sdkSource, /Viva по \(до 31 дня\)/);
  assert.match(sdkSource, /tournamentsVivaRefreshBtn\.textContent = '↻ Обновить из Viva'/);
  const refreshHandlerStart = sdkSource.indexOf(
    'async function refreshTournamentRangeFromViva()'
  );
  const refreshHandlerEnd = sdkSource.indexOf(
    'async function createTournamentFromVivaLink()',
    refreshHandlerStart
  );
  assert.ok(refreshHandlerStart >= 0 && refreshHandlerEnd > refreshHandlerStart);
  const refreshHandler = sdkSource.slice(refreshHandlerStart, refreshHandlerEnd);
  assert.match(refreshHandler, /refreshTournamentSnapshotAdminRange\(from, to\)/);
  assert.match(refreshHandler, /requestedDays > 31/);
  assert.match(refreshHandler, /tournamentsVivaRefreshBtn\.disabled = true/);
  assert.match(refreshHandler, /tournamentsVivaRefreshToDateInput\.disabled = true/);
  assert.match(refreshHandler, /result\.reason === 'cooldown'/);
  assert.match(refreshHandler, /result\.reason === 'refresh_failed'/);
  assert.match(refreshHandler, /result\.reason === 'partial'/);
  assert.match(refreshHandler, /result\.persisted === false/);
  assert.ok(
    refreshHandler.indexOf('result.persisted === false') <
      refreshHandler.indexOf("result.reason === 'partial'"),
    'persistence failure must take precedence over a partial provider result'
  );
  assert.match(refreshHandler, /await loadTournaments\(\)/);
  assert.ok(
    refreshHandler.indexOf('await loadTournaments()') <
      refreshHandler.indexOf("result.reason === 'refresh_failed'"),
    'snapshot must be reread before handling a completed refresh response'
  );
  assert.match(refreshHandler, /result && result\.tournamentsCount/);
  assert.doesNotMatch(refreshHandler, /result && result\.tournaments(?:\W|$)/);

  console.log('Tournament admin open snapshot-only test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
