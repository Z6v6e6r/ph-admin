import * as assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { SupportPersistenceService, supportClientReplyBinding } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { Role } from '../src/common/rbac/role.enum';
import { SupportClientAuthStatus as Auth, SupportConnectorRoute as Route, SupportDialogStatus as Status,
  SupportMessageDirection as Direction, SupportMessageKind as Kind } from '../src/support/support.types';

const at = '2026-01-01T00:00:00.000Z';
function context() {
  const client: any = { id: 'synthetic-client', authStatus: Auth.VERIFIED, displayName: 'Synthetic', phones: [], emails: [],
    identities: [{ connector: Route.MAX_BOT, externalUserId: 'synthetic-user', externalChatId: 'synthetic-chat' }], createdAt: at, updatedAt: at };
  const dialog: any = { id: 'synthetic-dialog', clientId: client.id, stationId: 'synthetic-station', stationName: 'Synthetic',
    accessStationIds: ['synthetic-station'], writeStationIds: ['synthetic-station'], readOnlyStationIds: [],
    connectors: [Route.MAX_BOT], lastInboundConnector: Route.MAX_BOT, status: Status.OPEN, authStatus: Auth.VERIFIED,
    phones: [], emails: [], subject: 'Synthetic', unreadCount: 2, pendingClientMessageIds: ['first', 'latest'],
    waitingForStaffSince: at, responseTimeTotalMs: 0, responseCount: 0, createdAt: at, updatedAt: at };
  const latestInbound: any = { id: 'latest', dialogId: dialog.id, clientId: client.id, connector: Route.MAX_BOT,
    direction: Direction.INBOUND, kind: Kind.TEXT, text: 'latest synthetic question', createdAt: at };
  return { dialog, client, latestInbound, firstInboundId: 'first' };
}
const user: any = { id: 'synthetic-staff', roles: [Role.STATION_ADMIN], stationIds: ['synthetic-station'], connectorRoutes: [Route.MAX_BOT] };
function service(load: () => Promise<any>) {
  const writes: string[] = [], usage: any[] = [];
  const persistence: any = { isEnabled: () => true, loadReplyContext: load,
    loadState: () => assert.fail('No full hydration'),
    persistMessage: () => writes.push('message'), persistDialog: () => writes.push('dialog'),
    persistOutboxCommand: () => writes.push('outbox'), persistResponseMetric: () => writes.push('metric') };
  const value = new SupportService(persistence, { resolveRoute: (route: any) => route } as any, { registerUsage: (_id: string, ctx: any) => usage.push(ctx) } as any);
  return { value, writes, usage, state: value as any };
}
async function rejectsStatus(action: () => Promise<any>, status: number) {
  await assert.rejects(action, (error: any) => error.getStatus() === status);
}
async function main() {
  const routingA = context().client;
  const routingB = structuredClone(routingA);
  routingA.emails = ['synthetic-first', 'synthetic-second'];
  routingB.emails = [...routingA.emails].reverse();
  assert.notEqual(supportClientReplyBinding(routingA), supportClientReplyBinding(routingB));
  routingA.identities.push({ ...routingA.identities[0], externalChatId: 'synthetic-other-chat' });
  routingB.emails = [...routingA.emails];
  routingB.identities = [...routingA.identities].reverse();
  assert.notEqual(supportClientReplyBinding(routingA), supportClientReplyBinding(routingB));
  const good = service(async () => context());
  const result = await good.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply', quickReplyRuleId: 'synthetic-rule' }, user);
  assert.equal(result.message.text, 'reply');
  assert.equal(result.outbox?.targetExternalChatId, 'synthetic-chat');
  assert.deepEqual(good.writes, ['message', 'metric', 'dialog', 'outbox']);
  assert.equal(good.usage[0].messageText, 'latest synthetic question');
  assert.equal(good.usage[0].isFirstClientMessage, false);
  assert.equal(result.dialog.responseCount, 1);
  assert.equal(good.state.messages.get('synthetic-dialog').length, 1, 'Bounded context is not installed as full history');
  const missing = service(async () => null);
  await rejectsStatus(() => missing.value.replyToDialogWithReadThrough('missing', { text: 'reply' }, user), 404);
  assert.equal(missing.writes.length, 0);
  const outage = service(async () => { throw new ServiceUnavailableException(); });
  await rejectsStatus(() => outage.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, user), 503);
  for (const change of ['station', 'connector', 'closed', 'readonly']) {
    const ctx = context(); const who = { ...user };
    if (change === 'station') who.stationIds = ['foreign-station'];
    if (change === 'connector') who.connectorRoutes = [Route.EMAIL];
    if (change === 'closed') ctx.dialog.status = Status.CLOSED;
    if (change === 'readonly') { ctx.dialog.stationId = 'foreign-station'; ctx.dialog.writeStationIds = ['foreign-station']; ctx.dialog.readOnlyStationIds = ['synthetic-station']; }
    const denied = service(async () => ctx);
    await rejectsStatus(() => denied.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, who), 403);
    assert.equal(denied.writes.length, 0, change);
    assert.equal(denied.state.dialogs.size, 0, change);
  }
  const deniedBeforeRead = service(async () => assert.fail('Non-staff must not read stored reply context'));
  await rejectsStatus(() => deniedBeforeRead.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, { ...user, roles: [Role.CLIENT] }), 403);
  let finish!: (x: any) => void;
  const concurrent = service(() => new Promise(resolve => { finish = resolve; }));
  const pending = concurrent.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, user);
  const newer = context(); newer.dialog.subject = 'newer cache';
  concurrent.state.dialogs.set(newer.dialog.id, newer.dialog);
  concurrent.state.clients.set(newer.client.id, newer.client);
  finish(context());
  await pending;
  assert.equal(concurrent.state.dialogs.get('synthetic-dialog'), newer.dialog);
  assert.equal(newer.dialog.subject, 'newer cache');
  assert.equal(concurrent.writes.filter(x => x === 'message').length, 1);
  for (const warm of [false, true]) {
    const ctx = context(); ctx.client.identities = [];
    const noTarget = service(async () => ctx);
    if (warm) { noTarget.state.dialogs.set(ctx.dialog.id, ctx.dialog); noTarget.state.clients.set(ctx.client.id, ctx.client); }
    await rejectsStatus(() => noTarget.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, user), 503);
    assert.equal(noTarget.writes.length, 0);
  }
  const noEmail = context(); noEmail.client.emails = ['', 'synthetic-second'];
  noEmail.dialog.connectors = [Route.EMAIL]; noEmail.dialog.lastInboundConnector = Route.EMAIL;
  const badEmail = service(async () => noEmail);
  await rejectsStatus(() => badEmail.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, { ...user, connectorRoutes: [Route.EMAIL] }), 503);
  assert.equal(badEmail.writes.length, 0);
  for (const changedBinding of ['phone', 'recency', 'email']) {
    let finishBinding!: (x: any) => void;
    const conflict = service(() => new Promise(resolve => { finishBinding = resolve; }));
    const sending = conflict.value.replyToDialogWithReadThrough('synthetic-dialog', { text: 'reply' }, user);
    const warmClient = context().client;
    if (changedBinding === 'phone') warmClient.primaryPhone = 'synthetic-phone';
    else if (changedBinding === 'email') warmClient.emails = ['synthetic-changed'];
    else warmClient.identities[0].lastSeenAt = '2026-01-02T00:00:00.000Z';
    conflict.state.clients.set(warmClient.id, warmClient);
    finishBinding(context());
    await rejectsStatus(() => sending, 503);
    assert.equal(conflict.writes.length, 0);
    assert.equal(conflict.state.clients.get(warmClient.id), warmClient);
  }
  console.log('Support cold reply: scoped send, SLA, privacy, no full hydrate and concurrent-cache checks PASS');

  // Exercise production lookup with a collection spy; no real database or provider.
  const ctx = context();
  const reads: any[] = [];
  const lookup = Object.create(SupportPersistenceService.prototype) as any;
  const owner = { config: { key: 'max' }, db: {} };
  lookup.backendConfigs = [{ key: 'max', uri: 'synthetic-uri' }];
  lookup.getActiveBackends = () => [owner];
  lookup.resolveBackendKeyForConnector = () => 'max';
  lookup.collection = (_backend: any, name: string) => ({ findOne: async (query: any, options: any) => {
    reads.push({ name, query, options });
    assert.ok(options.timeoutMS > 0 && options.timeoutMS <= 5000);
    if (name === 'dialogs') { assert.deepEqual(query, { id: 'synthetic-dialog' }); return ctx.dialog; }
    if (name === 'clients') { assert.deepEqual(query, { id: 'synthetic-client' }); return ctx.client; }
    assert.equal(name, 'messages');
    assert.deepEqual(query, { dialogId: 'synthetic-dialog', direction: Direction.INBOUND });
    return options.sort.createdAt === -1 ? ctx.latestInbound : { id: ctx.firstInboundId };
  } });
  assert.deepEqual(await lookup.loadReplyContext('synthetic-dialog'), ctx);
  assert.deepEqual(reads.map(x => x.name), ['dialogs','clients','messages','messages']);
  lookup.backendConfigs.push({ key: 'web', uri: 'synthetic-uri' });
  await rejectsStatus(() => lookup.loadReplyContext('synthetic-dialog'), 503);
  lookup.backendConfigs.pop();
  lookup.getActiveBackends = () => [owner, { config: { key: 'web' }, db: {} }];
  lookup.collection = (backend: any) => ({ findOne: async () => backend === owner ? ctx.dialog : { ...ctx.dialog, stationId: 'different' } });
  await rejectsStatus(() => lookup.loadReplyContext('synthetic-dialog'), 503);
  lookup.collection = (backend: any, name: string) => ({ findOne: async () => {
    if (name === 'dialogs') return ctx.dialog;
    if (name === 'clients') return backend === owner ? ctx.client : { ...ctx.client, identities: [{ connector: Route.MAX_BOT, externalChatId: 'foreign-target' }] };
    assert.fail('Conflicting binding must fail before reading message bodies');
  } });
  await rejectsStatus(() => lookup.loadReplyContext('synthetic-dialog'), 503);
  lookup.getActiveBackends = () => [owner];
  lookup.collection = () => ({ findOne: async () => null });
  assert.equal(await lookup.loadReplyContext('missing'), null);
  console.log('Support exact-ID lookup: bounded queries, backend outage/conflict, true404 PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
