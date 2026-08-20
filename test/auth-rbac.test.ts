import * as assert from 'node:assert/strict';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { AuthService } from '../src/auth/auth.service';
import { getStationScopeForPermission } from '../src/common/rbac/permissions';
import {
  AdminAuditEntry,
  AdminRoleDefinition,
  AdminUserRecord
} from '../src/auth/auth.types';

class InMemoryAuthPersistence {
  private users: AdminUserRecord[] = [];
  private roles: AdminRoleDefinition[] = [];
  readonly audit: AdminAuditEntry[] = [];

  isEnabled(): boolean {
    return true;
  }

  async loadUsers(): Promise<AdminUserRecord[]> {
    return this.users.map((user) => ({ ...user, roleIds: [...user.roleIds] }));
  }

  async seedUsers(users: AdminUserRecord[]): Promise<void> {
    if (this.users.length === 0) {
      this.users = users.map((user) => ({ ...user, roleIds: [...user.roleIds] }));
    }
  }

  async findUserById(id: string): Promise<AdminUserRecord | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async upsertUser(user: AdminUserRecord): Promise<void> {
    const index = this.users.findIndex((item) => item.id === user.id);
    if (index >= 0) {
      this.users[index] = { ...user, roleIds: [...user.roleIds] };
      return;
    }
    this.users.push({ ...user, roleIds: [...user.roleIds] });
  }

  async deleteUser(id: string): Promise<boolean> {
    const before = this.users.length;
    this.users = this.users.filter((user) => user.id !== id);
    return this.users.length !== before;
  }

  async loadRoles(): Promise<AdminRoleDefinition[]> {
    return this.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  }

  async seedRoles(roles: AdminRoleDefinition[]): Promise<void> {
    for (const role of roles) {
      if (!this.roles.some((item) => item.id === role.id)) {
        this.roles.push({ ...role, permissions: [...role.permissions] });
      }
    }
  }

  async upsertRole(role: AdminRoleDefinition): Promise<void> {
    const index = this.roles.findIndex((item) => item.id === role.id);
    if (index >= 0) {
      this.roles[index] = { ...role, permissions: [...role.permissions] };
      return;
    }
    this.roles.push({ ...role, permissions: [...role.permissions] });
  }

  async deleteRole(id: string): Promise<boolean> {
    const before = this.roles.length;
    this.roles = this.roles.filter((role) => role.id !== id);
    return this.roles.length !== before;
  }

  async appendAudit(entry: AdminAuditEntry): Promise<void> {
    this.audit.push(entry);
  }

  async listAudit(): Promise<AdminAuditEntry[]> {
    return [...this.audit];
  }
}

async function main(): Promise<void> {
  const originalUsers = process.env.ADMIN_AUTH_USERS_JSON;
  const originalSecret = process.env.ADMIN_AUTH_SECRET;
  process.env.ADMIN_AUTH_SECRET = 'test-secret';
  process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([
    {
      id: 'root-admin',
      login: 'root_admin',
      password: 'RootAdmin123',
      roleIds: ['SUPER_ADMIN'],
      stationIds: []
    }
  ]);

  try {
    const persistence = new InMemoryAuthPersistence();
    const service = new AuthService(persistence as unknown as AuthPersistenceService);
    await service.onModuleInit();

    const superAdmin = await service.login('root_admin', 'RootAdmin123');
    const piterAdmin = await service.createAdminUser(
      {
        login: 'admin_piter',
        password: 'PiterAdmin123',
        title: 'Администратор Питер',
        roleIds: ['STATION_ADMIN'],
        stationIds: ['Piter'],
        connectorRoutes: ['MAX_BOT', 'LK_WEB_MESSENGER']
      },
      superAdmin.user
    );
    const piterLogin = await service.login('admin_piter', 'PiterAdmin123');
    assert.equal(piterLogin.user.id, piterAdmin.id);
    assert.deepEqual(piterLogin.user.roles, ['STATION_ADMIN']);
    assert.deepEqual(piterLogin.user.stationIds, ['Piter']);
    assert.deepEqual(getStationScopeForPermission(piterLogin.user, 'dialogs:read'), ['Piter']);
    assert.equal(piterLogin.user.permissions?.includes('settings:read'), false);
    assert.equal(piterLogin.user.permissions?.includes('admin-users:read'), false);

    const cookieOnlyPiter = await service.resolveUserFromRequest(
      { headers: { cookie: `phab_admin_token=${piterLogin.accessToken}` } } as never,
      { allowHeaderFallback: false }
    );
    assert.equal(cookieOnlyPiter.user?.id, piterAdmin.id);
    assert.deepEqual(cookieOnlyPiter.user?.stationIds, ['Piter']);

    const matchingCookieAndBearer = await service.resolveUserFromRequest(
      {
        headers: {
          authorization: `Bearer ${piterLogin.accessToken}`,
          cookie: `phab_admin_token=${piterLogin.accessToken}`
        }
      } as never,
      { allowHeaderFallback: true }
    );
    assert.equal(matchingCookieAndBearer.user?.id, piterAdmin.id);

    await assert.rejects(
      service.resolveUserFromRequest(
        {
          headers: {
            authorization: `Bearer ${superAdmin.accessToken}`,
            cookie: `phab_admin_token=${piterLogin.accessToken}`
          }
        } as never,
        { allowHeaderFallback: true }
      ),
      /Conflicting authentication credentials/
    );

    const invalidTokenWithPrivilegedHeaders = await service.resolveUserFromRequest(
      {
        headers: {
          authorization: 'Bearer invalid-token',
          'x-user-id': 'legacy-superadmin',
          'x-user-roles': 'SUPER_ADMIN'
        }
      } as never,
      { allowHeaderFallback: true }
    );
    assert.equal(invalidTokenWithPrivilegedHeaders.source, 'anonymous');
    assert.equal(invalidTokenWithPrivilegedHeaders.user, undefined);

    const invalidBearerWithValidCookie = await service.resolveUserFromRequest(
      {
        headers: {
          authorization: 'Bearer invalid-token',
          cookie: `phab_admin_token=${piterLogin.accessToken}`
        }
      } as never,
      { allowHeaderFallback: true }
    );
    assert.equal(invalidBearerWithValidCookie.source, 'anonymous');
    assert.equal(invalidBearerWithValidCookie.user, undefined);

    const malformedBearerWithPrivilegedHeaders = await service.resolveUserFromRequest(
      {
        headers: {
          authorization: 'Bearer   ',
          'x-user-id': 'legacy-superadmin',
          'x-user-roles': 'SUPER_ADMIN'
        }
      } as never,
      { allowHeaderFallback: true }
    );
    assert.equal(malformedBearerWithPrivilegedHeaders.source, 'anonymous');
    assert.equal(malformedBearerWithPrivilegedHeaders.user, undefined);

    const emptyCookieWithPrivilegedHeaders = await service.resolveUserFromRequest(
      {
        headers: {
          cookie: 'phab_admin_token=',
          'x-user-id': 'legacy-superadmin',
          'x-user-roles': 'SUPER_ADMIN'
        }
      } as never,
      { allowHeaderFallback: true }
    );
    assert.equal(emptyCookieWithPrivilegedHeaders.source, 'anonymous');
    assert.equal(emptyCookieWithPrivilegedHeaders.user, undefined);

    const role = await service.createAdminRole(
      {
        id: 'station-games-reader',
        name: 'Чтение игр Ясенево',
        permissions: ['games:read'],
        stationIds: ['Yasenevo']
      },
      superAdmin.user
    );
    const writeRole = await service.createAdminRole(
      {
        id: 'station-games-editor',
        name: 'Изменение игр Бутово',
        permissions: ['games:write'],
        stationIds: ['Butovo']
      },
      superAdmin.user
    );
    const created = await service.createAdminUser(
      {
        login: 'games_reader',
        password: 'GamesReader123',
        title: 'Чтение игр',
        roleIds: [role.id, writeRole.id],
        stationIds: ['Yasenevo', 'Butovo']
      },
      superAdmin.user
    );

    assert.equal('password' in created, false, 'password must never be returned by admin API');
    const login = await service.login('games_reader', 'GamesReader123');
    assert.deepEqual(login.user.permissions, ['games:read', 'games:write']);
    assert.deepEqual(login.user.stationIds, ['Yasenevo', 'Butovo']);
    assert.deepEqual(getStationScopeForPermission(login.user, 'games:read'), ['Yasenevo']);
    assert.deepEqual(getStationScopeForPermission(login.user, 'games:write'), ['Butovo']);

    await service.updateAdminUser(created.id, { active: false }, superAdmin.user);
    const resolved = await service.resolveUserFromRequest(
      { headers: { authorization: `Bearer ${login.accessToken}` } } as never,
      { allowHeaderFallback: false }
    );
    assert.equal(resolved.source, 'anonymous', 'disabled users must lose access immediately');
    assert.ok(persistence.audit.some((entry) => entry.action === 'ROLE_CREATED'));
    assert.ok(persistence.audit.some((entry) => entry.action === 'ADMIN_USER_UPDATED'));
    console.log('Auth RBAC persistence test passed');
  } finally {
    restoreEnv('ADMIN_AUTH_USERS_JSON', originalUsers);
    restoreEnv('ADMIN_AUTH_SECRET', originalSecret);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
