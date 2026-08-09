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

  console.log('Tournament admin open snapshot-only test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
