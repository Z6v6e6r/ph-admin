import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ROLES_KEY } from '../src/common/rbac/roles.decorator';
import { Role } from '../src/common/rbac/role.enum';
import { TournamentsController } from '../src/tournaments/tournaments.controller';

function main(): void {
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
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.findById),
    []
  );
  assert.equal(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.findCustomById),
    undefined
  );
  assert.equal(
    Reflect.getMetadata(ROLES_KEY, TournamentsController.prototype.createCustomFromSource),
    undefined
  );

  console.log('Tournaments controller public routes test passed');
}

main();
