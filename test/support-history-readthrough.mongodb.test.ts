import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MongoClient } from 'mongodb';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { Role } from '../src/common/rbac/role.enum';
import { SupportConnectorRoute as Route } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  assert.ok(uri, 'An explicit disposable loopback Mongo URI is required');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'mongodb:'); assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(parsed.port); assert.equal(parsed.username + parsed.password + parsed.search, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const prefix = 'support_history_test_' + randomUUID().replaceAll('-', '');
  const backends = ['primary', 'web', 'max'].map(key => ({ config: { key, uri }, db: client.db(prefix + '_' + key) }));
  const persistence = Object.create(SupportPersistenceService.prototype) as any;
  persistence.backendConfigs = backends.map(b => b.config);
  persistence.isEnabled = () => true;
  persistence.getActiveBackends = () => backends;
  persistence.collection = (backend: any, key: string) => backend.db.collection(key);
  const web = backends[1].db, primary = backends[0].db;
  const t = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  const dialog: any = { id: 'dialog-a', clientId: 'client-a', stationId: 'station-a', stationName: 'Synthetic',
    accessStationIds: ['station-a'], writeStationIds: ['station-a'], readOnlyStationIds: [],
    connectors: [Route.LK_WEB_MESSENGER], lastInboundConnector: Route.LK_WEB_MESSENGER,
    authStatus: 'VERIFIED', status: 'OPEN', phones: [], emails: [], createdAt: t(1), updatedAt: t(3),
    lastMessageAt: t(3), unreadCount: 3, hasUnreadMessages: true, hasNewMessages: true,
    pendingClientMessageIds: ['m3'], waitingForStaffSince: t(1) };
  const message = (id: string, day: number, extra: any = {}) => ({ id, dialogId: dialog.id, clientId: dialog.clientId,
    connector: Route.LK_WEB_MESSENGER, direction: 'INBOUND', kind: 'TEXT', text: id,
    senderId: dialog.clientId, senderRole: Role.CLIENT, createdAt: t(day), ...extra });
  const who: any = { id: 'staff', roles: [Role.STATION_ADMIN], stationIds: ['station-a'], connectorRoutes: [Route.LK_WEB_MESSENGER] };
  const registry: any = {
    resolveRoute: (route: unknown) => ['WEB', 'WEB_LK', Route.LK_WEB_MESSENGER].includes(String(route))
      ? Route.LK_WEB_MESSENGER : Object.values(Route).find(r => r === route),
    listEntries: () => [{ route: Route.LK_WEB_MESSENGER, aliases: ['WEB', 'WEB_LK', Route.LK_WEB_MESSENGER] }]
  };
  try {
    for (const backend of backends) {
      await backend.db.collection('dialogs').createIndex({ id: 1 }, { unique: true });
      await backend.db.collection('messages').createIndex({ dialogId: 1, createdAt: 1 });
    }
    await web.collection('dialogs').insertOne(structuredClone(dialog));
    await web.collection('messages').insertMany([
      message('m1', 1),
      message('m2', 2, { createdAt: undefined, createdTs: Date.parse(t(2)), connector: 'WEB_LK' }),
      message('m3', 3, { createdAt: new Date(t(3)) }),
      message('auto', 4, { direction: 'SYSTEM', kind: 'SYSTEM', senderName: 'Система · Автоответ' }),
      message('service', 5, { direction: 'SYSTEM', kind: 'SYSTEM' }),
      message('denied-channel', 6, { connector: Route.MAX_BOT }),
      message('foreign-client', 7, { clientId: 'another-client' }),
      message('foreign-dialog', 8, { dialogId: 'another-dialog' }),
      message('deleted', 9, { deleted: true })
    ]);
    // Persisted copies of a message must appear only once across stores.
    await primary.collection('messages').insertOne(message('m1', 1));
    const service = new SupportService(persistence, registry, {} as any);
    const page = await service.listMessages(dialog.id, who, { limit: 2 });
    assert.deepEqual(page.map(row => row.id), ['m3', 'auto']);
    assert.ok(page.every(row => row.createdAt.endsWith('Z')));
    const older = await service.listMessages(dialog.id, who, { limit: 2, before: t(3) });
    assert.deepEqual(older.map(row => row.id), ['m1', 'm2']);
    const withService = await service.listMessages(dialog.id, who, { limit: 2, includeService: true });
    assert.deepEqual(withService.map(row => row.id), ['auto', 'service']);
    const marked = await web.collection('dialogs').findOne({ id: dialog.id });
    assert.equal(marked!.unreadCount, 0); assert.equal(marked!.hasUnreadMessages, false);
    assert.equal(marked!.hasNewMessages, true); assert.deepEqual(marked!.pendingClientMessageIds, ['m3']);
    assert.equal(marked!.waitingForStaffSince, t(1));
    assert.equal((service as any).dialogs.size, 0); assert.equal((service as any).messages.size, 0);
    assert.equal(await web.collection('messages').countDocuments(), 9);
    for (const backend of backends) {
      assert.equal(await backend.db.collection('clients').countDocuments(), 0);
      assert.equal(await backend.db.collection('outbox').countDocuments(), 0);
    }

    const snapshot = await persistence.loadHistoryDialog(dialog.id);
    await web.collection('dialogs').updateOne({ id: dialog.id }, { $inc: { unreadCount: 1 } });
    assert.equal(await persistence.markHistoryRead(snapshot), false, 'Same timestamp new inbound must defeat read CAS');
    assert.equal((await web.collection('dialogs').findOne({ id: dialog.id }))!.unreadCount, 1);

    await primary.collection('dialogs').insertOne({ ...dialog, unreadCount: 10 });
    assert.ok(await persistence.loadHistoryDialog(dialog.id), 'Counter-only divergence is not an ACL conflict');
    for (const changed of [{ clientId: 'foreign-owner' }, { stationName: 'Foreign alias authority' },
      { lastInboundChannel: 'MAX_BOT' }]) {
      await primary.collection('dialogs').replaceOne({ id: dialog.id }, { ...dialog, ...changed });
      await assert.rejects(persistence.loadHistoryDialog(dialog.id), (e: any) => e.getStatus() === 503);
    }
    await primary.collection('dialogs').deleteOne({ id: dialog.id });
    assert.equal(await persistence.loadHistoryDialog('missing'), null);
    await assert.rejects(persistence.loadHistoryDialog(dialog.id, performance.now() - 1), (e: any) => e.getStatus() === 503);
    persistence.getActiveBackends = () => backends.slice(0, 2);
    await assert.rejects(persistence.loadHistoryDialog(dialog.id), (e: any) => e.getStatus() === 503);
    persistence.getActiveBackends = () => backends;

    // Historical storage placement does not require moving the dialog to read it.
    await web.collection('dialogs').deleteOne({ id: dialog.id });
    await primary.collection('dialogs').insertOne(structuredClone(dialog));
    const oldStorePage = await service.listMessages(dialog.id, who, { limit: 2 });
    assert.deepEqual(oldStorePage.map(row => row.id), ['m3', 'auto']);
    assert.equal((await primary.collection('dialogs').findOne({ id: dialog.id }))!.unreadCount, 0);
    assert.equal(await web.collection('dialogs').countDocuments(), 0, 'History must not migrate a dialog');
    console.log('Physical Mongo history: cold/warm format compatibility, pagination, scope, CAS, copies, outage, old store PASS');
  } finally {
    for (const backend of backends) await backend.db.dropDatabase();
    await client.close();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
