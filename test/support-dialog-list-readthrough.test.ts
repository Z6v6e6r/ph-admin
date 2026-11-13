import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { SupportService } from '../src/support/support.service';
import { MessengerController } from '../src/messenger/messenger.controller';
import { SupportConnectorRoute as Route } from '../src/support/support.types';
import { Role } from '../src/common/rbac/role.enum';

const stamp = '2026-01-01T00:00:00.000Z';
const user: any = { id: 'staff', roles: [Role.STATION_ADMIN], stationIds: ['station-a'], connectorRoutes: [Route.MAX_BOT] };
export const dialog = (id = 'a', day = 1): any => ({ id, clientId: 'client-' + id,
  stationId: 'station-a', stationName: 'Synthetic', accessStationIds: ['station-a'],
  writeStationIds: ['station-a'], readOnlyStationIds: [], connectors: [Route.MAX_BOT],
  lastInboundConnector: Route.MAX_BOT, status: 'OPEN', authStatus: 'VERIFIED',
  currentPhone: '70000000001', phones: ['70000000001'], emails: [], createdAt: stamp,
  updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  lastMessageAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  lastRankingMessageAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  lastMessageText: 'Synthetic', lastMessageSenderRole: Role.CLIENT, unreadCount: 7,
  hasUnreadMessages: true, hasNewMessages: true, pendingClientMessageIds: ['pending'],
  waitingForStaffSince: stamp, responseCount: 2, responseTimeTotalMs: 123 });

function fixture() {
  const rows = [dialog('a'), dialog('b', 2)], calls: any[] = [];
  const persistence: any = { isEnabled: () => true,
    findDialogListIds: async (options: any) => { calls.push(options); return rows.map(row => row.id); },
    loadDialogListContexts: async (ids: string[]) => rows.filter(row => ids.includes(row.id)).map(row => ({
      dialog: structuredClone(row), client: { id: row.clientId, displayName: 'Synthetic name', primaryPhone: row.currentPhone, emails: [] }
    })),
    persistDialog: () => assert.fail('List must never persist dialogs'),
    persistClient: () => assert.fail('List must never persist clients'),
    persistMessage: () => assert.fail('List must never persist messages'),
    persistOutboxCommand: () => assert.fail('List must never modify outbox'),
    loadState: () => assert.fail('List must not hydrate')
  };
  const service = new SupportService(persistence, {
    listEntries: () => [{ route: Route.MAX_BOT, aliases: ['MAX_BOT'] }],
    resolveRoute: (value: string) => Object.values(Route).includes(value as Route) ? value : undefined
  } as any, {} as any);
  return { rows, calls, persistence, service, state: service as any };
}

test('cold list restores pending conversations and exact client titles without writes or hydration', async () => {
  const f = fixture(), before = structuredClone(f.rows);
  const result = await f.service.listDialogsWindowWithReadThrough(user, {}, 15);
  assert.deepEqual(result.map(row => row.dialogId), ['b', 'a']);
  assert.ok(result.every(row => row.clientDisplayName === 'Synthetic name'));
  assert.ok(result.every(row => row.unreadCount === 7 && row.pendingClientMessagesCount === 1 && row.waitingForStaffSince === stamp));
  assert.deepEqual(f.rows, before);
  for (const key of ['clients', 'dialogs', 'messages', 'outbox']) assert.equal(f.state[key].size, 0);
  assert.equal(f.state.dialogsNeedingUnreadRebuild.size, 0);
});

test('phone search takes the same bounded read-through path', async () => {
  const f = fixture();
  assert.equal((await f.service.listDialogsByPhone('+70000000001', user, {}, 17)).length, 2);
  assert.equal(f.calls[0].phone, '70000000001'); assert.equal(f.calls[0].limit, 17);
});

test('newer unpersisted cached conversation stays in the ranked prefix', async () => {
  const f = fixture(), hot = dialog('hot', 3);
  f.state.dialogs.set(hot.id, hot);
  const before = structuredClone(hot);
  assert.deepEqual((await f.service.listDialogsWindowWithReadThrough(user, {}, 2)).map(row => row.dialogId), ['hot', 'b']);
  assert.deepEqual(f.state.dialogs.get(hot.id), before);
});

test('a large warm cache contributes only the requested ranked prefix to exact context reads', async () => {
  const f = fixture(), sizes: number[] = [], load = f.persistence.loadDialogListContexts;
  for (let index = 0; index < 5100; index++) f.state.dialogs.set('cached-' + index, dialog('cached-' + index));
  const hot = dialog('fresh-unpersisted', 3); f.state.dialogs.set(hot.id, hot);
  f.persistence.loadDialogListContexts = async (ids: string[]) => { sizes.push(ids.length); return load(ids); };
  const result = await f.service.listDialogsWindowWithReadThrough(user, {}, 2);
  assert.deepEqual(result.map(row => row.dialogId), ['fresh-unpersisted', 'b']);
  assert.ok(sizes.every(size => size <= 4), 'Two cached plus two persisted IDs are the only contexts needed');
  assert.equal(f.state.dialogs.size, 5101);
  for (const row of f.state.dialogs.values()) if (row.id !== hot.id) {
    row.currentPhone = '70000000002'; row.phones = ['70000000002'];
  }
  sizes.length = 0;
  assert.deepEqual((await f.service.listDialogsByPhone('70000000001', user, {}, 2)).map(row => row.dialogId), ['fresh-unpersisted', 'b']);
  assert.ok(sizes.every(size => size <= 3), 'Nonmatching cached phones never enter exact context lookups');
});

test('persisted rank and preview survive an empty message cache and missing role', async () => {
  const f = fixture(); delete f.rows[0].lastMessageSenderRole;
  assert.equal((await f.service.listDialogsWindowWithReadThrough(user, {}, 15)).find(row => row.dialogId === 'a')?.lastRankingMessageAt, stamp);
});

test('role denial occurs before persistence and station/connector scope is rechecked', async () => {
  const f = fixture();
  await assert.rejects(f.service.listDialogsWindowWithReadThrough({ ...user, roles: [Role.CLIENT] }, {}, 15), (e: any) => e.getStatus() === 403);
  assert.equal(f.calls.length, 0);
  f.rows.forEach(row => { row.stationId = 'foreign'; row.accessStationIds = ['foreign']; });
  assert.deepEqual(await f.service.listDialogsWindowWithReadThrough(user, {}, 15), []);
  assert.deepEqual(await f.service.listDialogsWindowWithReadThrough(user, { connector: Route.EMAIL }, 15), []);
});

test('authority changes during awaited contexts fail closed', async () => {
  const f = fixture(), read = f.persistence.loadDialogListContexts; let calls = 0;
  f.persistence.loadDialogListContexts = async (...args: any[]) => {
    if (++calls === 2) f.rows[0].clientId = 'different-owner';
    return read(...args);
  };
  await assert.rejects(f.service.listDialogsWindowWithReadThrough(user, {}, 15), (e: any) => e.getStatus() === 503);
});

test('list projection changes during awaited contexts fail closed', async () => {
  const f = fixture(), read = f.persistence.loadDialogListContexts; let calls = 0;
  f.persistence.loadDialogListContexts = async (...args: any[]) => {
    if (++calls === 2) f.rows[0].lastRankingMessageAt = '2026-01-30T00:00:00.000Z';
    return read(...args);
  };
  await assert.rejects(f.service.listDialogsWindowWithReadThrough(user, {}, 15), (e: any) => e.getStatus() === 503);
});

test('backend failure and oversized prefixes never masquerade as an empty successful list', async () => {
  const f = fixture(); f.persistence.findDialogListIds = async () => { throw new ServiceUnavailableException(); };
  await assert.rejects(f.service.listDialogsWindowWithReadThrough(user, {}, 15), (e: any) => e.getStatus() === 503);
  await assert.rejects(f.service.listDialogsWindowWithReadThrough(user, {}, 5001), (e: any) => e.getStatus() === 503);
});

test('CUP compatibility controller awaits support prefix and preserves array offset pagination', async () => {
  const f = fixture();
  const controller = new MessengerController({ listDialogsWindow: () => [] } as any, f.service,
    { lookupClientCabinetByPhone: async () => ({ status: 'NOT_FOUND' }) } as any, {} as any);
  (controller as any).attachVivaCabinetUrls = async (rows: unknown[]) => rows;
  const result = await (controller as any).listCompatibleDialogs(user, { limit: 1, offset: 1 }, 'list');
  assert.deepEqual(result.map((row: any) => row.threadId), ['a']);
  assert.equal(f.calls[0].limit, 2);
});
