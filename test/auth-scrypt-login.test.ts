import * as assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { Role } from '../src/common/rbac/role.enum';
import { AdminUserRecord } from '../src/auth/auth.types';

function createPersistence(user: AdminUserRecord) {
  return {
    isEnabled: () => true,
    loadUsers: async () => [user],
    seedUsers: async () => undefined
  };
}

function createUser(password: string): AdminUserRecord {
  return {
    id: 'admin-scrypt-test',
    login: 'scrypt-test',
    password,
    roles: [Role.SUPER_ADMIN],
    stationIds: [],
    connectorRoutes: []
  };
}

async function main(): Promise<void> {
  const password = 'correct-password';
  const salt = 'fixed-test-salt';
  const digest = scryptSync(password, salt, 64).toString('base64url');
  const scryptService = new AuthService(
    createPersistence(createUser(`scrypt$${salt}$${digest}`)) as never
  );
  await scryptService.onModuleInit();

  const login = await scryptService.login('scrypt-test', password);
  assert.equal(login.tokenType, 'Bearer');
  assert.equal(login.user.login, 'scrypt-test');
  assert.ok(login.accessToken.length > 0);

  await assert.rejects(
    () => scryptService.login('scrypt-test', 'wrong-password'),
    (error: unknown) =>
      error instanceof UnauthorizedException
      && error.message === 'Invalid login or password'
  );

  const legacyService = new AuthService(
    createPersistence(createUser('legacy-plaintext-password')) as never
  );
  await legacyService.onModuleInit();
  const legacyLogin = await legacyService.login(
    'scrypt-test',
    'legacy-plaintext-password'
  );
  assert.equal(legacyLogin.tokenType, 'Bearer');

  console.log('Auth scrypt login test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
