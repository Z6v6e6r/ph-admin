import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { SupportService } from '../src/support/support.service';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { Role } from '../src/common/rbac/role.enum';
import { SupportConnectorRoute as Route } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2]; assert.ok(uri, 'Explicit disposable loopback Mongo required');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'mongodb:'); assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(parsed.port); assert.equal(parsed.username + parsed.password + parsed.search, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 }); await client.connect();
  const prefix = 'support_list_test_' + randomUUID().replaceAll('-', '');
  const backends = ['primary', 'web', 'max'].map(key => ({ config: { key, uri }, db: client.db(prefix + '_' + key) }));
  const persistence = Object.create(SupportPersistenceService.prototype) as any;
  persistence.backendConfigs = backends.map(backend => backend.config);
  persistence.isEnabled = () => true; persistence.getActiveBackends = () => backends;
  persistence.collection = (backend: any, key: string) => backend.db.collection(key);
  const aliases = [
    { route: Route.MAX_BOT, aliases: ['MAX_BOT', 'MAX'] },
    { route: Route.LK_WEB_MESSENGER, aliases: ['WEB', 'WEB_LK', Route.LK_WEB_MESSENGER] },
    { route: Route.PROMO_WEB_MESSENGER, aliases: ['WEB_PROMO', Route.PROMO_WEB_MESSENGER] }
  ];
  const registry: any = { listEntries: () => aliases, resolveRoute: (value: unknown) =>
    aliases.find(entry => entry.aliases.includes(String(value).trim().toUpperCase()))?.route
      ?? Object.values(Route).find(route => route === value) };
  const service = new SupportService(persistence, registry, {} as any), state = service as any;
  const staff: any = { id: 'staff', roles: [Role.STATION_ADMIN], stationIds: ['station-a'], connectorRoutes: [Route.MAX_BOT] };
  const stamp = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  const row = (id: string, day: number, extra: any = {}): any => ({ id, clientId: 'client-' + id,
    stationId: 'station-a', stationName: 'Synthetic', accessStationIds: ['station-a'], writeStationIds: ['station-a'],
    readOnlyStationIds: [], connectors: [Route.MAX_BOT], lastInboundConnector: Route.MAX_BOT,
    status: 'OPEN', authStatus: 'VERIFIED', createdAt: stamp(1), updatedAt: stamp(day),
    lastRankingMessageAt: stamp(day), lastMessageAt: stamp(day), lastMessageText: 'Synthetic preview',
    lastMessageSenderRole: Role.CLIENT, unreadCount: 4, hasUnreadMessages: true, hasNewMessages: true,
    pendingClientMessageIds: ['pending'], waitingForStaffSince: stamp(1), responseCount: 1, responseTimeTotalMs: 123,
    phones: [], emails: [], ...extra });
  const primary = backends[0].db, web = backends[1].db, max = backends[2].db;
  async function snapshot() {
    return Promise.all(backends.flatMap(backend => ['dialogs', 'clients', 'messages', 'outbox'].map(name =>
      backend.db.collection(name).find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray())));
  }
  try {
    for (const backend of backends) {
      await backend.db.collection('dialogs').createIndex({ id: 1 }, { unique: true });
      await backend.db.collection('clients').createIndex({ id: 1 }, { unique: true });
    }
    await max.collection('dialogs').insertMany([
      row('pending', 8), row('hot', 20), row('foreign', 30, { stationId: 'foreign', accessStationIds: ['foreign'] }),
      row('write-readonly-alone', 30, { stationId: 'foreign', accessStationIds: [], writeStationIds: ['station-a'], readOnlyStationIds: ['station-a'] }),
      row('other-connector', 29, { connectors: [Route.EMAIL], lastInboundConnector: Route.EMAIL }),
      row('system-only', 28, { lastRankingMessageAt: null, lastMessageSenderRole: 'SYSTEM' }),
      row('bot-only', 31, { lastRankingMessageAt: null, lastMessageSenderRole: 'BOT' }),
      row('service-only', 30, { lastRankingMessageAt: null, lastMessageSenderRole: 'SERVICE' }),
      row('mixed-resolved', 18, { isResolved: true, pendingClientMessageIds: [], connectors: [Route.PROMO_WEB_MESSENGER, Route.MAX_BOT], lastInboundConnector: Route.PROMO_WEB_MESSENGER })
    ]);
    await primary.collection('dialogs').insertOne(row('middle', 15));
    await web.collection('dialogs').insertOne(row('legacy-web', 12, {
      stationId: 'Nagatinskaya', stationName: 'Нагатинская', accessStationIds: [], writeStationIds: [],
      connectors: ['WEB_LK'], lastInboundConnector: undefined, lastRankingMessageAt: null,
      lastMessageSenderRole: undefined, lastMessageAuthorType: 'CLIENT', lastMessageText: undefined, lastMessagePreview: 'Legacy preview'
    }));
    await primary.collection('clients').insertOne({ id: 'client-pending', displayName: 'Synthetic client',
      primaryPhone: '70000000002', phones: ['70000000001', '70000000002'], emails: [] });
    const before = await snapshot();
    const prefixRows = await service.listDialogsWindowWithReadThrough(staff, {}, 3);
    assert.deepEqual(prefixRows.map(dialog => dialog.dialogId), ['hot', 'mixed-resolved', 'middle']);
    assert.deepEqual((await service.listDialogsWindowWithReadThrough(staff, {}, 1)).map(dialog => dialog.dialogId), ['hot'],
      'Unranked BOT/SERVICE previews cannot consume a ranked prefix slot');
    assert.deepEqual((await service.listDialogsWindowWithReadThrough(staff, {}, 4)).slice(3).map(dialog => dialog.dialogId), ['pending']);
    const searched = await service.listDialogsByPhone('70000000001', staff);
    assert.deepEqual(searched.map(dialog => dialog.dialogId), ['pending']);
    assert.equal(searched[0].clientDisplayName, 'Synthetic client');
    assert.equal(searched[0].unreadCount, 4); assert.equal(searched[0].pendingClientMessagesCount, 1);
    assert.equal(searched[0].waitingForStaffSince, stamp(1));
    const webUser = { ...staff, stationIds: ['nagat'], connectorRoutes: [Route.LK_WEB_MESSENGER] };
    const legacy = await service.listDialogsWindowWithReadThrough(webUser, {}, 1);
    assert.deepEqual(legacy.map(dialog => dialog.dialogId), ['legacy-web']);
    assert.equal(legacy[0].lastMessageText, 'Legacy preview');
    const allConnectors = { ...staff, connectorRoutes: [] };
    assert.ok(!(await service.listDialogsWindowWithReadThrough(allConnectors, {}, 20)).some(dialog => dialog.dialogId === 'mixed-resolved'),
      'Resolved PROMO preferred connector must retain its existing hidden-list rule');
    assert.deepEqual(await service.listDialogsWindowWithReadThrough(staff, { stationId: 'foreign' }, 1), []);
    assert.deepEqual(await snapshot(), before, 'LIST may not change any dialog/client/message/outbox record');
    for (const key of ['clients', 'dialogs', 'messages', 'outbox']) assert.equal(state[key].size, 0);

    await max.collection('dialogs').insertOne(row('pending-promo', 26, { isResolved: true,
      connectors: [Route.PROMO_WEB_MESSENGER], lastInboundConnector: Route.PROMO_WEB_MESSENGER }));
    const promo = await service.listDialogsWindowWithReadThrough({ ...staff, connectorRoutes: [Route.PROMO_WEB_MESSENGER] }, {}, 1);
    assert.deepEqual(promo.map(dialog => dialog.dialogId), ['pending-promo']);
    assert.equal(promo[0].isResolved, false); assert.equal(promo[0].pendingClientMessagesCount, 1);
    assert.equal((await max.collection('dialogs').findOne({ id: 'pending-promo' }))?.isResolved, true,
      'Response normalization must not write pending/resolved markers back');
    await max.collection('dialogs').deleteOne({ id: 'pending-promo' });

    // Updated timestamps alone can lag across stores; identical list projections remain safe.
    await primary.collection('dialogs').insertOne(row('hot', 20, { updatedAt: stamp(30) }));
    assert.deepEqual((await service.listDialogsWindowWithReadThrough(staff, {}, 1)).map(dialog => dialog.dialogId), ['hot']);
    await primary.collection('dialogs').deleteOne({ id: 'hot' });
    // Selecting each store's raw prefix and then choosing a lower-ranked newer
    // replica would otherwise hide the next valid dialog outside that prefix.
    await primary.collection('dialogs').insertOne(row('rank-copy', 27));
    await max.collection('dialogs').insertOne(row('rank-copy', 1, { updatedAt: stamp(30) }));
    await assert.rejects(service.listDialogsWindowWithReadThrough(staff, {}, 1), (e: any) => e.getStatus() === 503);
    await primary.collection('dialogs').deleteOne({ id: 'rank-copy' });
    await max.collection('dialogs').deleteOne({ id: 'rank-copy' });

    // A conflicting hidden copy must not be ignored by the limited authorized selector.
    await primary.collection('dialogs').insertOne(row('hot', 20, { stationId: 'foreign', accessStationIds: ['foreign'] }));
    await assert.rejects(service.listDialogsWindowWithReadThrough(staff, {}, 1), (e: any) => e.getStatus() === 503);
    await primary.collection('dialogs').deleteOne({ id: 'hot' });
    persistence.getActiveBackends = () => backends.slice(0, 2);
    await assert.rejects(service.listDialogsWindowWithReadThrough(staff, {}, 1), (e: any) => e.getStatus() === 503);
    persistence.getActiveBackends = () => backends;
    console.log('Physical Mongo list read-through: cold rank/offset, phone, ACL/aliases, normalized visibility, copy projection conflicts, outage and no writes PASS');
  } finally { for (const backend of backends) await backend.db.dropDatabase(); await client.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
