import * as assert from 'node:assert/strict';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { TournamentsService } from '../src/tournaments/tournaments.service';

interface SnapshotRangeInput {
  from: string;
  to: string;
  reason: string;
}

function createService(
  refreshRange?: (from: string, to: string, reason: string) => Promise<Record<string, unknown>>
): TournamentsService {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    { isEnabled: () => false, listCustomTournaments: async () => [] } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    refreshRange ? { refreshRange } as never : undefined
  );
}

function createUser(
  scope: string[] | null,
  permissions: string[] = ['tournaments:write']
): RequestUser {
  return {
    id: 'admin:tournaments',
    roles: [Role.MANAGER],
    permissions,
    permissionStationScopes: { 'tournaments:write': scope },
    stationIds: scope ?? [],
    connectorRoutes: []
  };
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const from = new Date().toISOString().slice(0, 10);
  const to = addUtcDays(from, 2);
  const calls: SnapshotRangeInput[] = [];
  const service = createService(async (requestedFrom, requestedTo, reason) => {
    calls.push({ from: requestedFrom, to: requestedTo, reason });
    return {
      enabled: true,
      refreshed: true,
      reason: 'refreshed',
      from: requestedFrom,
      to: requestedTo,
      requestedDays: 3,
      refreshedDays: 3,
      failedDays: 0,
      refreshedDates: [requestedFrom, addUtcDays(requestedFrom, 1), requestedTo],
      failedDates: [],
      tournamentsCount: 18,
      tournaments: [{ id: 'must-not-leak' }],
      snapshotAvailable: true,
      persisted: true
    };
  });

  const result = await service.refreshVivaTournamentSnapshotAdminRange(
    from,
    to,
    createUser(null)
  );
  assert.equal(result.refreshed, true);
  assert.equal(result.requestedDays, 3);
  assert.equal(result.tournamentsCount, 18);
  assert.equal('tournaments' in result, false, 'range response must not expose raw tournament data');
  assert.deepEqual(calls, [{
    from,
    to,
    reason: 'admin_tournaments_manual_range_refresh'
  }]);

  await service.refreshVivaTournamentSnapshotAdminRange(
    from,
    from,
    createUser(null)
  );
  assert.equal(calls.length, 2, 'a one-day inclusive range must remain valid');

  await service.refreshVivaTournamentSnapshotAdminRange(
    from,
    addUtcDays(from, 30),
    createUser(null)
  );
  assert.equal(calls.length, 3, 'a 31-day inclusive range must remain valid');

  const invalidInputs: Array<[unknown, unknown]> = [
    ['2026-02-30', '2026-03-01'],
    [to, from],
    [from, addUtcDays(from, 31)],
    ['', to]
  ];
  for (const [invalidFrom, invalidTo] of invalidInputs) {
    await assert.rejects(
      () => service.refreshVivaTournamentSnapshotAdminRange(
        invalidFrom,
        invalidTo,
        createUser(null)
      ),
      (error: any) => error?.getStatus?.() === 400
    );
  }
  assert.equal(calls.length, 3, 'invalid ranges must fail before snapshot refresh');

  const deniedUsers: Array<RequestUser | undefined> = [
    undefined,
    createUser(['station:yasenevo']),
    createUser([]),
    createUser(null, ['tournaments:read'])
  ];
  for (const user of deniedUsers) {
    await assert.rejects(
      () => service.refreshVivaTournamentSnapshotAdminRange(from, to, user),
      (error: any) =>
        error?.getStatus?.() === 403
        && error?.getResponse?.()?.code === 'TOURNAMENT_VIVA_REFRESH_GLOBAL_SCOPE_REQUIRED'
    );
  }
  assert.equal(calls.length, 3, 'authorization denial must happen before snapshot refresh');

  const unavailableService = createService();
  await assert.rejects(
    () => unavailableService.refreshVivaTournamentSnapshotAdminRange(
      from,
      to,
      createUser(null)
    ),
    (error: any) => error?.getStatus?.() === 503
  );

  console.log('Tournament admin range refresh test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
