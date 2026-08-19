import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import { RolesGuard } from '../src/common/rbac/roles.guard';
import { Role } from '../src/common/rbac/role.enum';
import { TournamentsController } from '../src/tournaments/tournaments.controller';

function createAnonymousContext(handler: (...args: never[]) => unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} })
    }),
    getHandler: () => handler,
    getClass: () => TournamentsController
  } as unknown as ExecutionContext;
}

function createAuthenticatedContext(
  handler: (...args: never[]) => unknown,
  permissions: string[]
): { context: ExecutionContext; authService: AuthService } {
  const request = { headers: {} };
  const authService = {
    resolveUserFromRequest: async () => ({
      source: 'token' as const,
      user: {
        id: 'admin:tournaments',
        roles: [Role.MANAGER],
        permissions,
        stationIds: [],
        connectorRoutes: []
      }
    }),
    shouldRequireStaffToken: () => false,
    hasStaffRole: () => true
  } as unknown as AuthService;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request
    }),
    getHandler: () => handler,
    getClass: () => TournamentsController
  } as unknown as ExecutionContext;
  return { context, authService };
}

async function main(): Promise<void> {
  const classRoles = Reflect.getMetadata(ROLES_KEY, TournamentsController);
  assert.deepEqual(classRoles, [
    Role.SUPER_ADMIN,
    Role.TOURNAMENT_MANAGER,
    Role.MANAGER,
    Role.STATION_ADMIN,
    Role.GAME_MANAGER
  ]);

  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.findAll),
    []
  );
  assert.equal(
    Reflect.getMetadata(PERMISSIONS_KEY, TournamentsController.prototype.findAll),
    undefined
  );
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.findById),
    []
  );
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.refreshSnapshotDay),
    []
  );
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.refreshSnapshotAdminDay),
    []
  );
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.refreshSnapshotAdminRange),
    []
  );
  assert.deepEqual(
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      TournamentsController.prototype.refreshSnapshotAdminDay
    ),
    ['tournaments:write']
  );
  assert.deepEqual(
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      TournamentsController.prototype.refreshSnapshotAdminRange
    ),
    ['tournaments:write']
  );
  assert.deepEqual(
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      TournamentsController.prototype.refreshSnapshotOnOpen
    ),
    ['tournaments:read']
  );
  assert.equal(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.findCustomById),
    undefined
  );
  assert.equal(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.createCustomFromSource),
    undefined
  );

  const authService = {
    resolveUserFromRequest: async () => ({ source: 'anonymous' as const }),
    shouldRequireStaffToken: () => false,
    hasStaffRole: () => false
  } as unknown as AuthService;
  const guard = new RolesGuard(new Reflector(), authService);

  assert.equal(
    await guard.canActivate(
      createAnonymousContext(TournamentsController.prototype.findAll)
    ),
    true,
    'anonymous LK clients must be allowed to load the public tournament list'
  );
  assert.equal(
    await guard.canActivate(
      createAnonymousContext(TournamentsController.prototype.refreshSnapshotOnOpen)
    ),
    false,
    'permission-protected tournament routes must remain closed to anonymous clients'
  );
  assert.equal(
    await guard.canActivate(
      createAnonymousContext(TournamentsController.prototype.refreshSnapshotAdminDay)
    ),
    false,
    'admin Viva refresh must remain closed to anonymous clients'
  );
  assert.equal(
    await guard.canActivate(
      createAnonymousContext(TournamentsController.prototype.refreshSnapshotAdminRange)
    ),
    false,
    'admin Viva range refresh must remain closed to anonymous clients'
  );

  const readOnlyAdmin = createAuthenticatedContext(
    TournamentsController.prototype.refreshSnapshotAdminDay,
    ['tournaments:read']
  );
  assert.equal(
    await new RolesGuard(new Reflector(), readOnlyAdmin.authService).canActivate(
      readOnlyAdmin.context
    ),
    false,
    'tournaments:read must not authorize a Viva refresh mutation'
  );
  const writeAdmin = createAuthenticatedContext(
    TournamentsController.prototype.refreshSnapshotAdminDay,
    ['tournaments:write']
  );
  assert.equal(
    await new RolesGuard(new Reflector(), writeAdmin.authService).canActivate(
      writeAdmin.context
    ),
    true,
    'tournaments:write must authorize the bounded admin Viva refresh'
  );
  const readOnlyRangeAdmin = createAuthenticatedContext(
    TournamentsController.prototype.refreshSnapshotAdminRange,
    ['tournaments:read']
  );
  assert.equal(
    await new RolesGuard(new Reflector(), readOnlyRangeAdmin.authService).canActivate(
      readOnlyRangeAdmin.context
    ),
    false,
    'tournaments:read must not authorize a Viva range refresh mutation'
  );
  const writeRangeAdmin = createAuthenticatedContext(
    TournamentsController.prototype.refreshSnapshotAdminRange,
    ['tournaments:write']
  );
  assert.equal(
    await new RolesGuard(new Reflector(), writeRangeAdmin.authService).canActivate(
      writeRangeAdmin.context
    ),
    true,
    'tournaments:write must authorize the bounded admin Viva range refresh'
  );

  let trustedAuthorization: string | undefined;
  let registrationInput: Record<string, unknown> | undefined;
  let refreshAdminUser: unknown;
  let refreshRangeAdminUser: unknown;
  const tournamentsService = {
    refreshVivaTournamentSnapshotAdminDay: async (date: unknown, user: unknown) => {
      refreshAdminUser = user;
      return { date };
    },
    refreshVivaTournamentSnapshotAdminRange: async (
      from: unknown,
      to: unknown,
      user: unknown
    ) => {
      refreshRangeAdminUser = user;
      return { from, to };
    },
    resolveTrustedLkRegistrationClient: async (authorization?: string) => {
      trustedAuthorization = authorization;
      return {
        name: 'Trusted Player',
        phone: '79000000001',
        levelLabel: 'C'
      };
    },
    registerPublicParticipantByTournamentRef: async (
      _id: string,
      input: Record<string, unknown>
    ) => {
      registrationInput = input;
      return {
        ok: true,
        code: 'REGISTERED',
        message: 'registered',
        participant: { status: 'REGISTERED' }
      };
    }
  };
  const controller = new TournamentsController(
    tournamentsService as never,
    {} as never,
    {} as never
  );
  assert.deepEqual(
    await controller.refreshSnapshotAdminDay(
      { date: '2026-09-02' },
      {
        id: 'admin:tournaments',
        roles: [Role.MANAGER],
        permissions: ['tournaments:write'],
        permissionStationScopes: { 'tournaments:write': null },
        stationIds: [],
        connectorRoutes: []
      }
    ),
    { date: '2026-09-02' }
  );
  assert.equal((refreshAdminUser as { id?: string })?.id, 'admin:tournaments');
  assert.deepEqual(
    await controller.refreshSnapshotAdminRange(
      { from: '2026-09-02', to: '2026-09-04' },
      {
        id: 'admin:tournaments',
        roles: [Role.MANAGER],
        permissions: ['tournaments:write'],
        permissionStationScopes: { 'tournaments:write': null },
        stationIds: [],
        connectorRoutes: []
      }
    ),
    { from: '2026-09-02', to: '2026-09-04' }
  );
  assert.equal((refreshRangeAdminUser as { id?: string })?.id, 'admin:tournaments');
  const registration = await controller.registerFromLkWidget(
    'tournament-1',
    {
      headers: {
        authorization: 'Bearer trusted-token',
        'x-user-phone': '79999999999',
        'x-user-level-label': 'A'
      }
    } as never,
    {
      phone: '78888888888',
      name: 'Forged Player',
      levelLabel: 'A',
      notes: 'left handed'
    }
  );
  assert.equal(registration.status, 'REGISTERED');
  assert.equal(trustedAuthorization, 'Bearer trusted-token');
  assert.equal(registrationInput?.phone, '79000000001');
  assert.equal(registrationInput?.name, 'Trusted Player');
  assert.equal(registrationInput?.levelLabel, 'C');
  assert.equal(registrationInput?.notes, 'left handed');

  console.log('Tournaments controller public routes test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
