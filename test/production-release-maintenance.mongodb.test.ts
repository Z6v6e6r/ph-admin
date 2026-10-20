import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { MongoClient } from 'mongodb';
import { createApplication } from '../src/bootstrap';
import { Role } from '../src/common/rbac/role.enum';

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  const uri = String(process.env.PRODUCTION_MONGO_INDEX_GUARD_TEST_URI ?? '').trim();
  const target = new URL(uri);
  assert.equal(target.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', 'phab-cup-r1-mongo'].includes(target.hostname), 'only the owned local fixture is permitted');
  assert.ok(!target.port || target.port === '27017');
  assert.equal(target.username + target.password, '', 'no authenticated/shared target');
  assert.ok(target.pathname === '' || target.pathname === '/');
  const environment = { ...process.env };
  const originalConnect = MongoClient.prototype.connect;
  const client = new MongoClient(uri);
  const dbName = `phab_release_maintenance_${process.pid}_${Date.now()}`;
  const db = client.db(dbName);
  const user = {
    id: 'maintenance-fixture-admin', login: 'maintenance_fixture', password: 'not-used-for-login',
    roles: [Role.SUPER_ADMIN], roleIds: [Role.SUPER_ADMIN], stationIds: [], connectorRoutes: [], active: true
  };
  const secret = 'synthetic-maintenance-mongo-key';
  const commands: string[] = [];
  let connections = 0;
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const snapshot = async () => Promise.all(['admin_users', 'admin_roles', 'admin_audit_log'].map(async (name) => ({
    name, rows: await db.collection(name).find({}).sort({ _id: 1 }).toArray()
  })));
  const assertReadOnly = () => {
    assert.ok(commands.includes('listIndexes'), 'actual index-readiness commands must be observed');
    assert.ok(commands.every((name) => ['listIndexes', 'find', 'getMore', 'killCursors', 'endSessions'].includes(name)), `unexpected runtime command: ${commands.join(',')}`);
    assert.equal(connections, 1, 'readiness plus Nest lifecycle must use one actual client');
  };
  try {
    await client.connect();
    await db.collection('admin_users').insertOne(user);
    await db.collection('admin_users').createIndex({ id: 1 }, { unique: true });
    await db.collection('admin_users').createIndex({ login: 1 }, { unique: true });
    await db.collection('admin_roles').insertOne({
      id: Role.SUPER_ADMIN, name: 'Fixture superadmin', permissions: ['*'], stationIds: [],
      isSystem: true, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
    });
    await db.collection('admin_roles').createIndex({ id: 1 }, { unique: true });
    await db.collection('admin_audit_log').createIndex({ at: -1 });
    await db.collection('admin_audit_log').createIndex({ 'actor.id': 1, at: -1 });
    await db.collection('admin_audit_log').createIndex({ targetId: 1, at: -1 });
    Object.assign(process.env, {
      NODE_ENV: 'production', PHAB_RELEASE_MAINTENANCE_ENABLED: 'true', MONGODB_URI: uri,
      MONGODB_DB: dbName, ADMIN_AUTH_MONGODB_DB: dbName, ADMIN_AUTH_ENABLED: 'true',
      ADMIN_AUTH_REQUIRE_STAFF_TOKEN: 'true', ADMIN_AUTH_SECRET: secret,
      QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false', SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
      PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false', SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
      TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false', TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
      VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false', VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
      VIVA_REFERENCE_CACHE_ENABLED: 'false'
    });
    delete process.env.ADMIN_AUTH_USERS_JSON;
    MongoClient.prototype.connect = async function () {
      connections += 1;
      Object.assign(this.options, { monitorCommands: true });
      this.on('commandStarted', (event) => commands.push(event.commandName));
      return originalConnect.call(this);
    };
    const before = await snapshot();
    app = await createApplication();
    const modules = [...app.get(ModulesContainer).values()].map((module) => module.metatype.name);
    assert.deepEqual(new Set(modules), new Set(['InternalCoreModule', 'ReleaseMaintenanceModule', 'AuthModule', 'ClientScriptModule']));
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, iat: now, exp: now + 300, typ: 'admin' })}`;
    const headers = { Cookie: `phab_admin_token=${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}` };
    const me = await fetch(origin + '/api/auth/me', { headers });
    assert.equal(me.status, 200);
    const identity = await me.json() as { user: { id: string; authSource: string } };
    assert.equal(identity.user.id, user.id);
    assert.equal(identity.user.authSource, 'token');
    assert.equal((await fetch(origin + '/api/health')).status, 200);
    assert.equal((await fetch(origin + '/api/ui/admin', { headers, redirect: 'manual' })).status, 200);
    assert.equal((await fetch(origin + '/api/client-script/admin-panel.js')).status, 200);
    for (const [method, path] of [
      ['GET', '/api/tournaments/public/cup/join?paymentsuccess=true'],
      ['POST', '/api/support/dialogs/events'], ['POST', '/api/integrations/telegram/webhook'],
      ['GET', '/api/support/outbox/pull'], ['POST', '/api/auth/login']
    ]) assert.equal((await fetch(origin + path, { method })).status, 503);
    assert.deepEqual(await snapshot(), before, 'runtime startup and HTTP requests must preserve actual documents');
    assertReadOnly();
    await db.collection('admin_users').updateOne({ id: user.id }, { $set: { active: false } });
    const revokedSnapshot = await snapshot();
    const revoked = await fetch(origin + '/api/auth/me', { headers });
    assert.equal((await revoked.json() as { user: unknown }).user, null, 'revocation is read from real persistence');
    assert.deepEqual(await snapshot(), revokedSnapshot, 'revocation lookup itself must remain read-only');
    await app.close();
    app = undefined;
    assertReadOnly();
    const observedReadCommands = commands.length;
    await db.collection('admin_users').dropIndex('login_1');
    commands.length = 0;
    connections = 0;
    await assert.rejects(createApplication(), /^Error: MONGO_INDEX_NOT_READY:admin_users:unnamed$/);
    assertReadOnly();
    assert.deepEqual(await snapshot(), revokedSnapshot, 'missing-index startup must not seed, repair or audit');
    console.log(`Real Mongo/Nest maintenance verified: ${observedReadCommands} observed read/session commands; database-only authenticated reads, persisted revocation, zero runtime document changes and missing-index fail-closed (no privilege or provider-delivery proof)`);
  } finally {
    if (app) await app.close();
    MongoClient.prototype.connect = originalConnect;
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
    await client.db(dbName).dropDatabase();
    await client.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
