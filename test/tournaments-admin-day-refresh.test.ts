import * as assert from 'node:assert/strict';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { TournamentsService } from '../src/tournaments/tournaments.service';

function createService(
  snapshotService?: {
    refreshDate: (date: string, reason: string) => Promise<Record<string, unknown>>;
  }
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
    snapshotService as never
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

async function main(): Promise<void> {
  const testDate = new Date().toISOString().slice(0, 10);
  let refreshCalls = 0;
  const service = createService({
    refreshDate: async (date, reason) => {
      refreshCalls += 1;
      assert.equal(date, testDate);
      assert.equal(reason, 'admin_tournaments_manual_day_refresh');
      return {
        enabled: true,
        refreshed: true,
        reason: 'refreshed',
        date,
        snapshotAvailable: true,
        tournaments: [{ id: 'viva-tournament-1' }],
        persisted: true
      };
    }
  });

  const result = await service.refreshVivaTournamentSnapshotAdminDay(
    testDate,
    createUser(null)
  );
  assert.equal(result.refreshed, true);
  assert.equal(result.date, testDate);
  assert.equal(result.tournamentsCount, 1);
  assert.equal('tournaments' in result, false, 'admin response must not expose raw tournament data');
  assert.equal(refreshCalls, 1);

  await assert.rejects(
    () => service.refreshVivaTournamentSnapshotAdminDay('2026-02-30'),
    (error: any) => error?.getStatus?.() === 400
  );
  assert.equal(refreshCalls, 1, 'invalid date must fail before snapshot refresh');

  await assert.rejects(
    () => service.refreshVivaTournamentSnapshotAdminDay(
      testDate,
      createUser(['station:yasenevo'])
    ),
    (error: any) =>
      error?.getStatus?.() === 403 &&
      error?.getResponse?.()?.code === 'TOURNAMENT_VIVA_REFRESH_GLOBAL_SCOPE_REQUIRED'
  );
  await assert.rejects(
    () => service.refreshVivaTournamentSnapshotAdminDay(testDate, createUser([])),
    (error: any) => error?.getStatus?.() === 403
  );
  await assert.rejects(
    () => service.refreshVivaTournamentSnapshotAdminDay(
      testDate,
      createUser(null, ['tournaments:read'])
    ),
    (error: any) => error?.getStatus?.() === 403
  );
  assert.equal(refreshCalls, 1, 'scoped admins must fail before snapshot refresh');

  const unavailableService = createService();
  await assert.rejects(
    () => unavailableService.refreshVivaTournamentSnapshotAdminDay(
      testDate,
      createUser(null)
    ),
    (error: any) => error?.getStatus?.() === 503
  );

  console.log('Tournament admin day refresh test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
