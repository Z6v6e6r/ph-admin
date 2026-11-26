import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  assert.ok(uri, 'An explicit disposable loopback Mongo URI is required');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(parsed.port);
  assert.equal(parsed.username + parsed.password + parsed.search, '');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const prefix = 'support_export_test_' + randomUUID().replaceAll('-', '');
  const backends = ['primary', 'web', 'max'].map(key => ({
    config: { key, uri },
    db: client.db(prefix + '_' + key)
  }));
  const [primary, web, max] = backends.map(backend => backend.db);
  const persistence: SupportPersistenceService = Object.assign(
    Object.create(SupportPersistenceService.prototype),
    {
      backendConfigs: backends.map(backend => backend.config),
      getActiveBackends: () => backends,
      collection: (backend: typeof backends[number], key: string) => backend.db.collection(key)
    }
  );
  const registry = {
    resolveRoute: (raw: unknown) => raw === 'WEB_LK' ? Route.LK_WEB_MESSENGER :
      Object.values(Route).find(route => route === raw)
  } as SupportConnectorRegistry;
  const service = new SupportService(persistence, registry, {} as never);
  const user: RequestUser = {
    id: 'staff', roles: [Role.STATION_ADMIN], stationIds: ['station-a'],
    connectorRoutes: [Route.LK_WEB_MESSENGER]
  };
  const period = { from: '2026-11-23', to: '2026-11-26' };
  const start = '2026-11-23T00:00:00.000Z';
  const end = '2026-11-27T00:00:00.000Z';
  const dialog = (id: string, stationId: string, connectors = [Route.LK_WEB_MESSENGER]) => ({
    id, clientId: 'client-' + id, stationId, stationName: stationId,
    accessStationIds: [stationId], writeStationIds: [stationId], readOnlyStationIds: [],
    connectors, lastInboundConnector: connectors[0], phones: [], emails: [],
    status: 'OPEN', authStatus: 'VERIFIED', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: end, unreadCount: 7, pendingClientMessageIds: ['start']
  });
  const message = (id: string, dialogId = 'a', extra: Record<string, unknown> = {}) => ({
    id, dialogId, clientId: 'client-' + dialogId, connector: Route.LK_WEB_MESSENGER,
    direction: 'INBOUND', kind: 'TEXT', senderRole: Role.CLIENT, text: id,
    createdAt: start, ...extra
  });

  try {
    await web.collection('dialogs').insertMany([dialog('a', 'station-a'), dialog('b', 'station-b')]);
    await max.collection('dialogs').insertOne(dialog('c', 'station-a', [Route.MAX_BOT]));
    await primary.collection('clients').insertOne({ id: 'client-a', displayName: 'Test Client' });
    await web.collection('messages').insertMany([
      message('before', 'a', { createdAt: '2026-11-22T23:59:59.999Z' }),
      message('start'),
      message('legacy', 'a', { createdAt: null, createdTs: Date.parse('2026-11-24T12:00:00Z'), connector: 'WEB_LK' }),
      message('last', 'a', {
        createdAt: new Date('2026-11-26T23:59:59.999Z'), direction: 'OUTBOUND', senderRole: Role.STATION_ADMIN
      }),
      message('after', 'a', { createdAt: end }),
      message('deleted', 'a', { deleted: true }),
      message('wrong-owner', 'a', { clientId: 'client-b' }),
      message('wrong-station', 'b'),
      message('orphan', 'missing')
    ]);
    await primary.collection('messages').insertOne(message('start'));
    await max.collection('messages').insertMany([
      message('wrong-connector', 'a', { connector: Route.MAX_BOT }),
      message('max-dialog', 'c', { connector: Route.MAX_BOT })
    ]);
    await web.collection('serviceMessages').insertOne(message('service', 'a', { senderRole: 'SYSTEM' }));

    const report = await service.getDialogsExport(period, user);
    assert.deepEqual(report.period, { ...period, timezone: 'UTC', fromInclusiveIso: start, toExclusiveIso: end });
    assert.deepEqual(report.summary, {
      dialogsCount: 1, clientsCount: 1, messagesCount: 3, inboundMessagesCount: 2,
      outboundMessagesCount: 1, unresolvedDialogsCount: 1, withoutStationDialogsCount: 0
    });
    assert.equal(report.dialogs[0].clientDisplayName, 'Test Client');
    assert.deepEqual(report.dialogs[0].messages.map(row => row.messageId), ['start', 'legacy', 'last']);
    assert.equal(report.dialogs[0].messages[2].senderRole, Role.STATION_ADMIN);
    assert.deepEqual(report.byConnector, [{ connector: Route.LK_WEB_MESSENGER, dialogsCount: 1, messagesCount: 3 }]);
    assert.deepEqual(report.byStation, [{ stationId: 'station-a', stationName: 'station-a', dialogsCount: 1, messagesCount: 3 }]);
    assert.equal((await service.getDialogsExport({ ...period, includeService: true }, user)).summary.messagesCount, 4);
    assert.equal((await service.getDialogsExport({ from: '2026-11-20', to: '2026-11-21' }, user)).summary.messagesCount, 0);
    assert.equal((await web.collection('dialogs').findOne({ id: 'a' }))?.unreadCount, 7);
    const cache = service as unknown as { dialogs: Map<string, unknown>; messages: Map<string, unknown> };
    assert.equal(cache.dialogs.size, 0);
    assert.equal(cache.messages.size, 0);

    await assert.rejects(service.getDialogsExport(period, { ...user, roles: [Role.CLIENT] }), ForbiddenException);
    await primary.collection('messages').updateOne({ id: 'start' }, { $set: { text: 'stale duplicate' } });
    await assert.rejects(service.getDialogsExport(period, user), ServiceUnavailableException);
    await primary.collection('messages').deleteOne({ id: 'start' });

    const firstExport = service.getDialogsExport(period, user);
    await assert.rejects(service.getDialogsExport(period, user), (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      (error.getResponse() as { code: string }).code === 'SUPPORT_DIALOGS_EXPORT_BUSY');
    assert.equal((await firstExport).summary.messagesCount, 3);

    const readExportMessages = persistence.readExportMessages.bind(persistence);
    persistence.readExportMessages = async function* (...args) {
      for await (const row of readExportMessages(...args)) yield row;
      await web.collection('dialogs').replaceOne({ id: 'a' }, dialog('a', 'station-b'));
    };
    await assert.rejects(service.getDialogsExport(period, user), ServiceUnavailableException);
    persistence.readExportMessages = readExportMessages;
    Object.assign(persistence, { getActiveBackends: () => [] });
    await assert.rejects(service.getDialogsExport(period, user), ServiceUnavailableException);

    console.log('Mongo export: cold cache, period, duplicates, station and connector scope, service events, read-only and outages passed');
  } finally {
    for (const backend of backends) await backend.db.dropDatabase();
    await client.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
