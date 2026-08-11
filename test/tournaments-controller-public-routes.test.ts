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

  console.log('Tournaments controller public routes test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
