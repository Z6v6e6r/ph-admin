import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ModulesContainer } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createApplication } from '../src/bootstrap';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { AdminUserRecord } from '../src/auth/auth.types';
import { Role } from '../src/common/rbac/role.enum';

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  const previousEnvironment = { ...process.env };
  const originalInit = AuthPersistenceService.prototype.onModuleInit;
  const user: AdminUserRecord = {
    id: 'maintenance-fixture-admin', login: 'maintenance_fixture', password: 'not-used-for-login',
    roles: [Role.SUPER_ADMIN], roleIds: [Role.SUPER_ADMIN], stationIds: [], connectorRoutes: [], active: true
  };
  const syntheticSecret = 'synthetic-maintenance-test-key';
  let writes = 0;
  let ready = false;
  let rejectInitialization = false;
  process.env.NODE_ENV = 'production';
  process.env.PHAB_RELEASE_MAINTENANCE_ENABLED = 'true';
  process.env.ADMIN_AUTH_ENABLED = 'true';
  process.env.ADMIN_AUTH_REQUIRE_STAFF_TOKEN = 'true';
  process.env.ADMIN_AUTH_SECRET = syntheticSecret;
  process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([user]);
  delete process.env.MONGODB_URI;
  for (const key of [
    'QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED', 'PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED',
    'SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED', 'TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP',
    'VIVA_TOURNAMENT_SNAPSHOT_ENABLED', 'VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED',
    'VIVA_REFERENCE_CACHE_ENABLED'
  ]) process.env[key] = 'false';
  process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS = '0';
  process.env.TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS = '0';
  AuthPersistenceService.prototype.onModuleInit = async function () {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (rejectInitialization) throw new Error('SYNTHETIC_AUTH_READINESS_FAILURE');
    (this as unknown as { db: unknown }).db = {
      collection: (name: string) => ({
        find: () => ({ toArray: async () => name.includes('roles') ? [] : [{ ...user }] }),
        findOne: async (query: { id: string }) => query.id === user.id ? { ...user } : null,
        insertOne: async () => { writes += 1; },
        updateOne: async () => { writes += 1; },
        bulkWrite: async () => { writes += 1; }
      })
    };
    ready = true;
  };
  const delayedInitialization = AuthPersistenceService.prototype.onModuleInit;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    app = await createApplication();
    assert.equal(ready, true, 'bootstrap waits for the delayed auth persistence hook');
    const moduleNames = [...app.get(ModulesContainer).values()].map((module) => module.metatype.name);
    assert.ok(moduleNames.includes('AuthModule'), 'the real auth graph is instantiated');
    for (const forbidden of ['AppModule', 'TournamentsModule', 'SupportModule', 'MessengerModule', 'TelegramConnectorModule', 'WebPushModule', 'SubscriptionsModule', 'PlayerRatingsModule']) {
      assert.equal(moduleNames.includes(forbidden), false, `${forbidden} must not be constructed in maintenance`);
    }
    assert.equal(writes, 0, 'maintenance startup cannot seed or audit');
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const signed = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, iat: now, exp: now + 300, typ: 'admin' })}`;
    const token = `${signed}.${createHmac('sha256', syntheticSecret).update(signed).digest('base64url')}`;
    const headers = { Cookie: `phab_admin_token=${token}` };
    const me = await fetch(origin + '/api/auth/me', { headers });
    const identity = await me.json() as { user: { id: string; authSource: string } };
    assert.equal(me.status, 200);
    assert.equal(identity.user.id, user.id);
    assert.equal(identity.user.authSource, 'token', 'HTTP200 alone is not authenticated smoke');
    const html = await fetch(origin + '/api/ui/admin', { headers, redirect: 'manual' });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /phab-admin-root/);
    const bundle = await fetch(origin + '/api/client-script/admin-panel.js');
    assert.equal(bundle.status, 200);
    assert.ok((await bundle.text()).length > 0);
    for (const [method, path] of [
      ['GET', '/api/tournaments/public/cup/join?paymentsuccess=true'],
      ['GET', '/api/support/outbox/pull'],
      ['POST', '/api/support/dialogs/events'],
      ['POST', '/api/auth/login']
    ]) {
      const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{malformed-json' } : {}) });
      assert.equal(response.status, 503, 'fence rejects before body parsing/auth/controller handlers');
    }
    assert.equal(writes, 0, 'allowed reads and rejected commands do not audit or persist');
    user.active = false;
    const revoked = await fetch(origin + '/api/auth/me', { headers });
    assert.equal((await revoked.json() as { user: unknown }).user, null, 'existing auth revocation lookup is retained');
    await app.close();
    app = undefined;
    user.active = true;
    delete process.env.ADMIN_AUTH_USERS_JSON;
    ready = false;
    app = await createApplication();
    assert.equal(ready, true, 'database-only auth must be ready before AuthService initializes');
    await app.listen(0, '127.0.0.1');
    const databaseOnlyMe = await fetch(await app.getUrl() + '/api/auth/me', { headers });
    assert.equal((await databaseOnlyMe.json() as { user: { id: string } }).user.id, user.id);
    assert.equal(writes, 0, 'database-only startup remains read-only');
    await app.close();
    app = undefined;
    process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([user]);
    rejectInitialization = true;
    await assert.rejects(createApplication(), /SYNTHETIC_AUTH_READINESS_FAILURE/);
    rejectInitialization = false;
    AuthPersistenceService.prototype.onModuleInit = async function () {};
    await assert.rejects(async () => { app = await createApplication(); }, /RELEASE_MAINTENANCE_AUTH_NOT_READY/);
    AuthPersistenceService.prototype.onModuleInit = delayedInitialization;
    process.env.ADMIN_AUTH_ENABLED = 'false';
    await assert.rejects(async () => { app = await createApplication(); }, /RELEASE_MAINTENANCE_AUTH_NOT_READY/);
    process.env.ADMIN_AUTH_ENABLED = 'true';
    process.env.ADMIN_AUTH_REQUIRE_STAFF_TOKEN = 'false';
    await assert.rejects(async () => { app = await createApplication(); }, /RELEASE_MAINTENANCE_AUTH_NOT_READY/);
    process.env.ADMIN_AUTH_REQUIRE_STAFF_TOKEN = 'true';
    delete process.env.ADMIN_AUTH_SECRET;
    await assert.rejects(async () => { app = await createApplication(); }, /RELEASE_MAINTENANCE_AUTH_NOT_READY/);
    process.env.ADMIN_AUTH_SECRET = 'dev-insecure-admin-auth-secret';
    await assert.rejects(async () => { app = await createApplication(); }, /RELEASE_MAINTENANCE_AUTH_NOT_READY/);
    process.env.ADMIN_AUTH_SECRET = syntheticSecret;
    process.env.PHAB_RELEASE_MAINTENANCE_ENABLED = 'false';
    // This route/CORS fixture has no Mongo authority; exercise the explicit receipt mode.
    // Legacy production startup correctly requires its durable MAX authority.
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
    app = await createApplication();
    assert.ok([...app.get(ModulesContainer).values()].some((module) => module.metatype.name === 'TournamentsModule'));
    await app.listen(0, '127.0.0.1');
    const normalOrigin = await app.getUrl();
    assert.equal((await fetch(normalOrigin + '/api/auth/config')).status, 200, 'normal mode retains normal routes');
    assert.equal((await fetch(normalOrigin + '/api/auth/me', { method: 'OPTIONS', headers: { Origin: 'https://example.invalid' } })).status, 204, 'normal CORS behavior is retained');
    console.log('Real Nest maintenance graph/HTTP/auth/delayed-readiness/failure test passed (auth transport double)');
  } finally {
    if (app) await app.close();
    AuthPersistenceService.prototype.onModuleInit = originalInit;
    for (const key of Object.keys(process.env)) if (!(key in previousEnvironment)) delete process.env[key];
    Object.assign(process.env, previousEnvironment);
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
