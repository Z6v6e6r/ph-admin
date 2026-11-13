import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { SupportService } from '../src/support/support.service';
import { Role } from '../src/common/rbac/role.enum';
import { SupportClientAuthStatus as Auth, SupportConnectorRoute as Route,
  SupportDialogStatus as DialogStatus, SupportOutboxStatus as Status } from '../src/support/support.types';

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => assert.fail('No provider/network call in this synthetic fixture')) as typeof fetch;
after(() => { globalThis.fetch = originalFetch; });

const staff = { id: 'synthetic-staff', roles: [Role.SUPER_ADMIN], stationIds: [], connectorRoutes: [] };
const stamp = '2026-01-01T00:00:00.000Z';
function fixture() {
  const state: any = { clients: [{ id: 'synthetic-client', authStatus: Auth.VERIFIED,
    phones: [], emails: [], identities: [], createdAt: stamp, updatedAt: stamp }],
  dialogs: [{ id: 'synthetic-dialog', clientId: 'synthetic-client', stationId: 'synthetic-station',
    stationName: 'Synthetic', accessStationIds: ['synthetic-station'], writeStationIds: ['synthetic-station'],
    readOnlyStationIds: [], status: DialogStatus.OPEN, authStatus: Auth.VERIFIED, phones: [], emails: [],
    connectors: [Route.LK_WEB_MESSENGER], lastInboundConnector: Route.LK_WEB_MESSENGER,
    unreadCount: 0, hasUnreadMessages: false, hasNewMessages: false, isResolved: false,
    pendingClientMessageIds: [], responseTimeTotalMs: 0, responseCount: 0, createdAt: stamp, updatedAt: stamp }],
  messages: [], responseMetrics: [], outbox: [] };
  const events: string[] = [];
  const upsert = (key: string, row: any) => {
    const at = state[key].findIndex((x: any) => x.id === row.id);
    if (at < 0) state[key].push(structuredClone(row)); else state[key][at] = structuredClone(row);
  };
  const persistence: any = {
    isEnabled: () => true, loadState: async () => structuredClone(state),
    loadHistoryDialog: async (id: string) => structuredClone(state.dialogs.find((row: any) => row.id === id) ?? null),
    findHistoryMessages: async (dialog: any) => structuredClone(state.messages.filter((row: any) => row.dialogId === dialog.id)),
    markHistoryRead: async () => true,
    persistDialog: (row: any) => upsert('dialogs', row),
    persistMessage: (row: any) => { events.push('message'); upsert('messages', row); },
    persistOutboxCommand: (row: any) => { events.push('outbox'); upsert('outbox', row); },
    persistServiceMessage: () => assert.fail('No service-message fixture'),
    persistResponseMetric: () => assert.fail('No response-metric fixture'),
    hasMaxOutbox: () => assert.fail('Web history must not consult MAX receipt storage'),
    pullMaxOutbox: () => assert.fail('No MAX claim'),
  };
  const create = async () => {
    const service = new SupportService(persistence, { resolveRoute: (route: unknown) => Object.values(Route).includes(route as Route) ? route : undefined, listEntries: () => [] } as any, {} as any);
    await service.hydrateFromPersistence(); return service;
  };
  return { state, events, create };
}

test('web reply history is available while its command remains PENDING; reading never leases or ACKs it', async () => {
  const f = fixture(), service = await f.create();
  const reply = await service.replyToDialog('synthetic-dialog', { text: 'Synthetic reply', connector: Route.LK_WEB_MESSENGER }, staff);
  assert.ok(reply.outbox); assert.equal(reply.outbox.status, Status.PENDING);
  assert.deepEqual(f.events, ['message', 'outbox']);
  const before = structuredClone(f.state.outbox);
  for (let i = 0; i < 2; i++) {
    const history = await service.listMessages('synthetic-dialog', staff);
    assert.deepEqual(history.map(row => row.id), [reply.message.id]);
    assert.equal(history[0].text, 'Synthetic reply');
  }
  assert.deepEqual(f.state.outbox, before); assert.deepEqual(f.events, ['message', 'outbox']);
});

test('reconstructed service hydrates exact web message and pending command IDs without replay', async () => {
  const f = fixture(), service = await f.create();
  const reply = await service.replyToDialog('synthetic-dialog', { text: 'Retained synthetic reply', connector: Route.LK_WEB_MESSENGER }, staff);
  const before = structuredClone(f.state), events = [...f.events];
  const restarted = await f.create();
  const history = await restarted.listMessages('synthetic-dialog', staff);
  assert.deepEqual(history.map(row => row.id), before.messages.map((row: any) => row.id));
  assert.equal(history[0].id, reply.message.id);
  assert.deepEqual((restarted as any).outbox.get(reply.outbox!.id), before.outbox[0]);
  assert.equal(before.outbox[0].status, Status.PENDING);
  assert.deepEqual(f.events, events, 'hydration/history must not enqueue or acknowledge');
  assert.deepEqual(f.state.outbox, before.outbox);
});

test('unauthorized history read neither discloses messages nor changes pending commands', async () => {
  const f = fixture(), service = await f.create();
  await service.replyToDialog('synthetic-dialog', { text: 'Synthetic protected history', connector: Route.LK_WEB_MESSENGER }, staff);
  const before = structuredClone(f.state), events = [...f.events];
  await assert.rejects(service.listMessages('synthetic-dialog', { id: 'other-client', roles: [Role.CLIENT], stationIds: [], connectorRoutes: [] }), (error: any) => error.getStatus() === 403);
  assert.deepEqual(f.state, before); assert.deepEqual(f.events, events);
});
