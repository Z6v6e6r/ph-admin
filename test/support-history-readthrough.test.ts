import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupportService } from '../src/support/support.service';
import { MessengerController } from '../src/messenger/messenger.controller';
import { Role } from '../src/common/rbac/role.enum';
import { SupportConnectorRoute as Route } from '../src/support/support.types';

const stamp = '2026-01-01T00:00:00.000Z';
const staff: any = { id: 'synthetic-staff', roles: [Role.STATION_ADMIN],
  stationIds: ['station-a'], connectorRoutes: [Route.LK_WEB_MESSENGER] };

function fixture() {
  const dialog: any = { id: 'dialog-a', clientId: 'client-a', stationId: 'station-a',
    stationName: 'Synthetic', accessStationIds: ['station-a'], writeStationIds: ['station-a'],
    readOnlyStationIds: [], status: 'OPEN', authStatus: 'VERIFIED', phones: [], emails: [],
    connectors: [Route.LK_WEB_MESSENGER], lastInboundConnector: Route.LK_WEB_MESSENGER,
    unreadCount: 3, hasUnreadMessages: true, hasNewMessages: true,
    pendingClientMessageIds: ['message-3'], waitingForStaffSince: stamp,
    responseCount: 0, responseTimeTotalMs: 0, createdAt: stamp, updatedAt: stamp,
    lastMessageAt: '2026-01-03T00:00:00.000Z' };
  const messages: any[] = [1, 2, 3].map(n => ({ id: `message-${n}`, dialogId: dialog.id,
    clientId: dialog.clientId, connector: Route.LK_WEB_MESSENGER, direction: 'INBOUND',
    kind: 'TEXT', text: `Synthetic ${n}`, senderId: 'client-a', senderRole: Role.CLIENT,
    stationId: 'station-a', createdAt: `2026-01-0${n}T00:00:00.000Z` }));
  const calls: string[] = [];
  const persistence: any = {
    isEnabled: () => true,
    loadHistoryDialog: async (id: string) => { calls.push('dialog'); return id === dialog.id ? structuredClone(dialog) : null; },
    findHistoryMessages: async (expected: any, options: any) => {
      calls.push('messages');
      return structuredClone(messages.filter(m => m.dialogId === expected.id
        && options.connectors.includes(m.connector)
        && (!options.before || Date.parse(m.createdAt) < Date.parse(options.before)))
        .slice(-options.limit));
    },
    markHistoryRead: async (expected: any) => {
      calls.push('read');
      if (expected.updatedAt !== dialog.updatedAt || expected.unreadCount !== dialog.unreadCount) return false;
      dialog.unreadCount = 0; dialog.hasUnreadMessages = false; return true;
    },
    findServiceMessages: async () => [],
    findDialogIdsByPhone: async () => assert.fail('No phone expansion in cold history'),
    loadState: async () => assert.fail('No hydration or reconciliation'),
    persistDialog: () => assert.fail('No full-document history write'),
    persistClient: () => assert.fail('No identity write'),
    persistMessage: () => assert.fail('No message write'),
    persistOutboxCommand: () => assert.fail('No outbox operation')
  };
  const service = new SupportService(persistence, {
    resolveRoute: (route: unknown) => Object.values(Route).includes(route as Route) ? route : undefined,
    listEntries: () => []
  } as any, {} as any);
  return { service, state: service as any, persistence, dialog, messages, calls };
}

test('CUP compatibility route restores a bounded cold page without hydration or cache mutation', async () => {
  const f = fixture();
  const controller = new MessengerController({ listMessages: () => { throw new NotFoundException(); } } as any,
    f.service, {} as any, {} as any);
  const result = await controller.listDialogMessages('dialog-a', 2, undefined, undefined, staff);
  assert.deepEqual(result.map(m => m.id), ['message-2', 'message-3']);
  assert.ok(result.every(m => m.threadId === 'dialog-a'));
  assert.equal(f.state.dialogs.size, 0); assert.equal(f.state.clients.size, 0); assert.equal(f.state.messages.size, 0);
  assert.deepEqual(f.dialog.pendingClientMessageIds, ['message-3']);
  assert.equal(f.dialog.hasNewMessages, true); assert.equal(f.dialog.waitingForStaffSince, stamp);
  assert.equal(f.dialog.unreadCount, 0);
});

test('cold history preserves the existing exclusive before cursor', async () => {
  const f = fixture();
  const result = await f.service.listMessages('dialog-a', staff, { limit: 1, before: '2026-01-03T00:00:00.000Z' });
  assert.deepEqual(result.map(m => m.id), ['message-2']);
});

for (const scope of ['station', 'connector', 'role']) test(`cold history denies ${scope} before loading content`, async () => {
  const f = fixture(), denied = structuredClone(staff);
  if (scope === 'station') denied.stationIds = ['foreign'];
  if (scope === 'connector') denied.connectorRoutes = [Route.MAX_BOT];
  if (scope === 'role') denied.roles = [Role.CLIENT];
  await assert.rejects(f.service.listMessages('dialog-a', denied), (error: any) => error.getStatus() === 403);
  assert.ok(!f.calls.includes('messages')); assert.ok(!f.calls.includes('read'));
});

test('missing dialog stays 404 and persistence failures stay 503', async () => {
  const f = fixture();
  await assert.rejects(f.service.listMessages('missing', staff), (error: any) => error.getStatus() === 404);
  f.persistence.loadHistoryDialog = async () => { throw new ServiceUnavailableException(); };
  await assert.rejects(f.service.listMessages('dialog-a', staff), (error: any) => error.getStatus() === 503);
});

test('warm unpersisted message is retained without treating a page as full cache history', async () => {
  const f = fixture();
  f.state.dialogs.set(f.dialog.id, structuredClone(f.dialog));
  const pending = { ...f.messages[2], id: 'pending-write', createdAt: '2026-01-04T00:00:00.000Z' };
  f.state.messages.set(f.dialog.id, [pending]);
  const result = await f.service.listMessages('dialog-a', staff, { limit: 2 });
  assert.deepEqual(result.map(m => m.id), ['message-3', 'pending-write']);
  assert.deepEqual(f.state.messages.get(f.dialog.id), [pending]);
  assert.equal(f.state.dialogs.get(f.dialog.id).unreadCount, 0);
  assert.equal(f.state.dialogs.get(f.dialog.id).hasUnreadMessages, false);
  assert.equal(f.service.listDialogs(staff)[0].unreadCount, 0, 'Dialog-list refresh must keep the cleared badge');
});

test('a newer warm cache unread count survives a successful older persisted marker', async () => {
  const f = fixture(), read = f.persistence.findHistoryMessages;
  const cached = structuredClone(f.dialog);
  f.state.dialogs.set(f.dialog.id, cached);
  f.persistence.findHistoryMessages = async (...args: any[]) => {
    const result = await read(...args);
    cached.unreadCount++;
    return result;
  };
  await f.service.listMessages('dialog-a', staff);
  assert.equal(f.dialog.unreadCount, 0);
  assert.equal(cached.unreadCount, 4); assert.equal(cached.hasUnreadMessages, true);
});

test('concurrent new inbound message is not cleared by the read marker', async () => {
  const f = fixture(), read = f.persistence.findHistoryMessages;
  f.persistence.findHistoryMessages = async (...args: any[]) => {
    const result = await read(...args);
    f.dialog.unreadCount++; // Even same timestamps must invalidate the marker.
    return result;
  };
  assert.equal((await f.service.listMessages('dialog-a', staff)).length, 3);
  assert.equal(f.dialog.unreadCount, 4); assert.equal(f.dialog.hasUnreadMessages, true);
});

for (const source of ['persisted', 'cached']) test(`rechecks ${source} ACL after an awaited message lookup`, async () => {
  const f = fixture(), read = f.persistence.findHistoryMessages;
  f.persistence.findHistoryMessages = async (...args: any[]) => {
    const result = await read(...args);
    const changed = { ...structuredClone(f.dialog), stationId: 'foreign', accessStationIds: ['foreign'] };
    if (source === 'persisted') Object.assign(f.dialog, changed);
    else f.state.dialogs.set(f.dialog.id, changed);
    return result;
  };
  await assert.rejects(f.service.listMessages('dialog-a', staff), (error: any) => [403, 503].includes(error.getStatus()));
  assert.ok(!f.calls.includes('read'));
});
