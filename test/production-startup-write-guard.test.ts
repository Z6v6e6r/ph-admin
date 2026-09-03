import * as assert from 'node:assert/strict';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { AuthService } from '../src/auth/auth.service';
import { Role } from '../src/common/rbac/role.enum';
import { AdminRoleDefinition, AdminUserRecord } from '../src/auth/auth.types';
import { MessengerService } from '../src/messenger/messenger.service';
import { SupportService } from '../src/support/support.service';
import { TournamentsVivaStatusSyncService } from '../src/tournaments/tournaments-viva-status-sync.service';

const envKeys = [
  'NODE_ENV',
  'ADMIN_AUTH_ENABLED',
  'ADMIN_AUTH_SECRET',
  'ADMIN_AUTH_USERS_JSON',
  'QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED',
  'TELEGRAM_STATION_MAPPINGS',
  'TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS',
  'TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP'
] as const;

class AuthPersistenceDouble {
  readonly users: AdminUserRecord[] = [];
  readonly roles: AdminRoleDefinition[] = [];
  seedUserCalls = 0;
  seedRoleCalls = 0;

  isEnabled(): boolean {
    return true;
  }

  async loadUsers(): Promise<AdminUserRecord[]> {
    return this.users.map((user) => ({ ...user }));
  }

  async loadRoles(): Promise<AdminRoleDefinition[]> {
    return this.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  }

  async seedUsers(users: AdminUserRecord[]): Promise<void> {
    this.seedUserCalls += 1;
    this.users.push(...users.map((user) => ({ ...user })));
  }

  async seedRoles(roles: AdminRoleDefinition[]): Promise<void> {
    this.seedRoleCalls += 1;
    this.roles.push(...roles.map((role) => ({ ...role, permissions: [...role.permissions] })));
  }

  async appendAudit(): Promise<void> {}
}

class MessengerPersistenceDouble {
  persistCalls = 0;

  isEnabled(): boolean {
    return true;
  }

  async loadState() {
    return {
      threads: [],
      messages: [],
      stations: [],
      connectors: [],
      accessRules: [],
      metrics: [],
      aiConfigs: [],
      aiInsights: [],
      aiSuggestions: []
    };
  }

  persistStation(): void { this.persistCalls += 1; }
  persistConnector(): void { this.persistCalls += 1; }
  persistAccessRule(): void { this.persistCalls += 1; }
}

function setAuthFixtureEnvironment(nodeEnv: string): void {
  process.env.NODE_ENV = nodeEnv;
  process.env.ADMIN_AUTH_ENABLED = 'true';
  process.env.ADMIN_AUTH_SECRET = 'production-startup-write-guard-secret';
  process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([
    {
      id: 'fixture-admin',
      login: 'fixture_admin',
      password: 'FixtureAdmin123',
      roleIds: [Role.SUPER_ADMIN],
      stationIds: []
    }
  ]);
}

async function verifyProductionAuthBootstrapIsReadOnly(): Promise<void> {
  setAuthFixtureEnvironment(' PRODUCTION ');
  const persistence = new AuthPersistenceDouble();
  const service = new AuthService(persistence as unknown as AuthPersistenceService);

  await service.onModuleInit();
  assert.equal(persistence.seedRoleCalls, 0);
  assert.equal(persistence.seedUserCalls, 0);
  assert.equal((await service.listAdminRoles()).length > 0, true);
  assert.equal((await service.listAdminUsers()).length, 1);
  assert.equal((await service.login('fixture_admin', 'FixtureAdmin123')).user.id, 'fixture-admin');
  assert.equal(persistence.seedRoleCalls, 0);
  assert.equal(persistence.seedUserCalls, 0);
}

async function verifyProductionFallbackRemainsFailClosed(): Promise<void> {
  process.env.NODE_ENV = 'PRODUCTION';
  process.env.ADMIN_AUTH_ENABLED = 'true';
  process.env.ADMIN_AUTH_SECRET = 'production-startup-write-guard-secret';
  delete process.env.ADMIN_AUTH_USERS_JSON;
  const persistence = new AuthPersistenceDouble();
  const service = new AuthService(persistence as unknown as AuthPersistenceService);

  await assert.rejects(
    service.onModuleInit(),
    /ADMIN_AUTH_ENABLED=true but no admin users found/
  );
  assert.equal(persistence.seedRoleCalls, 0);
  assert.equal(persistence.seedUserCalls, 0);
}

async function verifyPersistenceRejectsDirectProductionSeeding(): Promise<void> {
  process.env.NODE_ENV = 'production';
  const persistence = new AuthPersistenceService();
  (persistence as unknown as { db: unknown }).db = {};
  const user: AdminUserRecord = {
    id: 'fixture-admin',
    login: 'fixture_admin',
    password: 'not-used',
    roles: [Role.SUPER_ADMIN],
    roleIds: [Role.SUPER_ADMIN],
    stationIds: [],
    connectorRoutes: [],
    active: true
  };
  const role: AdminRoleDefinition = {
    id: Role.SUPER_ADMIN,
    name: 'Fixture superadmin',
    permissions: ['*'],
    stationIds: [],
    isSystem: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };

  await assert.rejects(
    persistence.seedUsers([user]),
    /AUTH_PRODUCTION_BOOTSTRAP_WRITE_FORBIDDEN:seedUsers/
  );
  await assert.rejects(
    persistence.seedRoles([role]),
    /AUTH_PRODUCTION_BOOTSTRAP_WRITE_FORBIDDEN:seedRoles/
  );
}

async function verifyDevelopmentBootstrapCompatibility(): Promise<void> {
  setAuthFixtureEnvironment('test');
  const persistence = new AuthPersistenceDouble();
  const service = new AuthService(persistence as unknown as AuthPersistenceService);

  await service.onModuleInit();
  assert.equal(persistence.seedRoleCalls, 1);
  assert.equal(persistence.seedUserCalls, 1);
  assert.equal((await service.login('fixture_admin', 'FixtureAdmin123')).user.id, 'fixture-admin');
}

async function verifyProductionMessengerBootstrapIsReadOnly(): Promise<void> {
  process.env.NODE_ENV = ' PRODUCTION ';
  delete process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED;
  delete process.env.TELEGRAM_STATION_MAPPINGS;
  const persistence = new MessengerPersistenceDouble();
  const service = new MessengerService({} as never, {} as never, persistence as never);

  await service.onModuleInit();
  await service.onApplicationBootstrap();
  assert.equal(persistence.persistCalls, 0, 'production hydration must not persist defaults');
  assert.equal(
    (service as unknown as { noReplyQuickReplyTimer?: unknown }).noReplyQuickReplyTimer,
    undefined,
    'production no-reply sweep must require explicit opt-in'
  );
  service.onModuleDestroy();
}

async function verifyNonProductionMessengerBootstrapCompatibility(): Promise<void> {
  process.env.NODE_ENV = 'test';
  delete process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED;
  delete process.env.TELEGRAM_STATION_MAPPINGS;
  const persistence = new MessengerPersistenceDouble();
  const service = new MessengerService({} as never, {} as never, persistence as never);

  await service.onModuleInit();
  assert.equal(persistence.persistCalls > 0, true, 'non-production default seeding remains enabled');
  assert.notEqual(
    (service as unknown as { noReplyQuickReplyTimer?: unknown }).noReplyQuickReplyTimer,
    undefined,
    'non-production no-reply sweep remains enabled'
  );
  service.onModuleDestroy();
}

async function verifyProductionNoReplySweepRequiresOptIn(): Promise<void> {
  process.env.NODE_ENV = 'production';
  delete process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED;
  const disabled = new SupportService({ isEnabled: () => false } as never, {} as never, {} as never);
  await disabled.onModuleInit();
  assert.equal(
    (disabled as unknown as { noReplyQuickReplyTimer?: unknown }).noReplyQuickReplyTimer,
    undefined
  );
  disabled.onModuleDestroy();

  process.env.QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED = 'true';
  const enabled = new SupportService({ isEnabled: () => false } as never, {} as never, {} as never);
  await enabled.onModuleInit();
  assert.notEqual(
    (enabled as unknown as { noReplyQuickReplyTimer?: unknown }).noReplyQuickReplyTimer,
    undefined,
    'explicit production opt-in preserves the auto-reply path'
  );
  enabled.onModuleDestroy();
}

function syncResult() {
  return {
    windowStart: '2026-09-03T00:00:00.000Z',
    windowEnd: '2026-09-06T00:00:00.000Z',
    candidatesCount: 0,
    checkedCount: 0,
    uniqueSourceCount: 0,
    readModelCanceledCandidateCount: 0,
    uniqueAdminStatusLookupCount: 0,
    adminStatusUnknownCandidateCount: 0,
    updatedCount: 0,
    sourceNotFoundCount: 0,
    sourceNotCanceledCount: 0
  };
}

async function waitForStartupTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

async function verifyVivaStartupRequiresProductionOptIn(): Promise<void> {
  process.env.NODE_ENV = ' PRODUCTION ';
  delete process.env.TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS;
  delete process.env.TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP;
  let calls = 0;
  const service = new TournamentsVivaStatusSyncService({
    syncCanceledCustomTournamentsFromViva: async () => {
      calls += 1;
      return syncResult();
    }
  } as never);

  service.onModuleInit();
  await waitForStartupTask();
  const diagnostics = service.getRuntimeDiagnostics();
  service.onModuleDestroy();
  assert.equal(diagnostics.enabled, true, 'hourly reconciliation remains enabled');
  assert.equal(diagnostics.runOnStartup, false, 'production startup must be read-only by default');
  assert.equal(calls, 0);

  process.env.TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP = 'true';
  const optedInService = new TournamentsVivaStatusSyncService({
    syncCanceledCustomTournamentsFromViva: async () => {
      calls += 1;
      return syncResult();
    }
  } as never);
  optedInService.onModuleInit();
  await waitForStartupTask();
  optedInService.onModuleDestroy();
  assert.equal(calls, 1, 'explicit production opt-in must preserve the operator-controlled path');
}

async function verifyDevelopmentVivaStartupCompatibility(): Promise<void> {
  process.env.NODE_ENV = 'test';
  delete process.env.TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS;
  delete process.env.TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP;
  let calls = 0;
  const service = new TournamentsVivaStatusSyncService({
    syncCanceledCustomTournamentsFromViva: async () => {
      calls += 1;
      return syncResult();
    }
  } as never);
  service.onModuleInit();
  await waitForStartupTask();
  service.onModuleDestroy();
  assert.equal(calls, 1, 'non-production default startup behavior must remain compatible');
}

async function main(): Promise<void> {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    await verifyProductionAuthBootstrapIsReadOnly();
    await verifyProductionFallbackRemainsFailClosed();
    await verifyPersistenceRejectsDirectProductionSeeding();
    await verifyDevelopmentBootstrapCompatibility();
    await verifyProductionMessengerBootstrapIsReadOnly();
    await verifyNonProductionMessengerBootstrapCompatibility();
    await verifyProductionNoReplySweepRequiresOptIn();
    await verifyVivaStartupRequiresProductionOptIn();
    await verifyDevelopmentVivaStartupCompatibility();
  } finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log('Production startup write guard test passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
