process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { SupportService } from '../src/support/support.service';
import { Role } from '../src/common/rbac/role.enum';
import { SupportClientAuthStatus as Auth, SupportConnectorRoute as Route, SupportDialogStatus as Status } from '../src/support/support.types';
const at = '2026-01-01T00:00:00.000Z';
function setup(admit: (command: any) => Promise<void>) {
  const writes: string[] = [];
  const persistence = { isEnabled: () => true, enqueueMaxOutbox: admit,
    findClients: async () => [], findDialogsByClientId: async () => [], persistClient: () => {},
    persistMessage: () => writes.push('message'), persistDialog: () => writes.push('dialog'),
    persistOutboxCommand: () => {}, persistServiceMessage: () => writes.push('service'), persistResponseMetric: () => writes.push('metric') };
  const service = new SupportService(persistence as any, { resolveRoute: (r: any) => r, normalizeIncomingEvent: () => ({}), listEntries: () => [] } as any, { registerUsage: () => {}, findMatchingRules: () => [{ id: 'synthetic-rule', title: 'Synthetic', responseText: 'synthetic reply', mode: 'AUTO_REPLY' }] } as any) as any;
  const client = { id: 'synthetic-client', authStatus: Auth.VERIFIED, displayName: 'Synthetic', primaryPhone: '70000000001', phones: ['70000000001'], emails: [],
    identities: [{ connector: Route.MAX_BOT, externalUserId: 'synthetic-user', externalChatId: 'synthetic-chat' }], createdAt: at, updatedAt: at };
  const dialog = { id: 'synthetic-dialog', clientId: client.id, stationId: 'synthetic-station', stationName: 'Synthetic',
    accessStationIds: ['synthetic-station'], writeStationIds: ['synthetic-station'], readOnlyStationIds: [], connectors: [Route.MAX_BOT],
    lastInboundConnector: Route.MAX_BOT, status: Status.OPEN, authStatus: Auth.VERIFIED, phones: [], emails: [], subject: 'Synthetic',
    unreadCount: 2, pendingClientMessageIds: [], waitingForStaffSince: at, responseTimeTotalMs: 0, responseCount: 0, createdAt: at, updatedAt: at };
  service.clients.set(client.id, client); service.dialogs.set(dialog.id, dialog);
  const user = { id: 'synthetic-staff', roles: [Role.STATION_ADMIN], stationIds: ['synthetic-station'], connectorRoutes: [Route.MAX_BOT] };
  return { service, dialog, user, writes };
}
async function main() {
  let release!: () => void, admitted: any;
  const good = setup(command => { admitted = command; return new Promise<void>(resolve => { release = resolve; }); });
  let responded = false;
  const pending = good.service.replyToDialogWithReadThrough(good.dialog.id, { text: 'synthetic reply' }, good.user).then((value: any) => { responded = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert(admitted?.id); assert.equal(responded, false); assert.equal(good.writes.length, 0);
  assert.equal(good.dialog.unreadCount, 2); assert.equal(good.service.messages.size, 0);
  release(); const result = await pending;
  assert.equal(result.outbox.id, admitted.id); assert.equal(responded, true); assert(good.writes.includes('message'));
  assert.equal(good.service.messages.get(good.dialog.id).length, 1);
  for (const failure of ['rejected', 'unknown_commit']) {
    const bad = setup(async () => { throw new ServiceUnavailableException({ code: 'MAX_OUTBOX_ENQUEUE_UNCONFIRMED' }); });
    await assert.rejects(() => bad.service.replyToDialogWithReadThrough(bad.dialog.id, { text: failure }, bad.user), (e: any) => e.getStatus() === 503);
    assert.equal(bad.writes.length, 0); assert.equal(bad.service.messages.size, 0); assert.equal(bad.dialog.unreadCount, 2);
    assert.equal(bad.dialog.responseCount, 0); assert.equal(bad.service.outbox.size, 0);
  }
  const auto = setup(async () => { throw new ServiceUnavailableException(); });
  await assert.rejects(() => auto.service.sendQuickReplyAutoResponse(auto.dialog, { createdAt: at }, Route.MAX_BOT,
    { id: 'synthetic-rule', title: 'Synthetic', responseText: 'synthetic', mode: 'AUTO_REPLY' }, {}));
  assert.equal(auto.writes.length, 0); assert.equal(auto.service.messages.size, 0);
  const ids: string[] = [];
  for (let restart = 0; restart < 2; restart++) {
    const automatic = setup(async command => { ids.push(command.id); });
    await automatic.service.sendQuickReplyAutoResponse(automatic.dialog, { id: 'synthetic-source', createdAt: at }, Route.MAX_BOT,
      { id: 'synthetic-rule', title: 'Synthetic', responseText: 'synthetic', mode: 'AUTO_REPLY' }, {});
  }
  const cycle = setup(async command => { ids.push(command.id); });
  for (const staffId of ['synthetic-staff-cycle-a', 'synthetic-staff-cycle-b']) {
    await cycle.service.sendQuickReplyAutoResponse(cycle.dialog, { id: 'same-client-message', createdAt: at }, Route.MAX_BOT,
      { id: 'synthetic-rule', title: 'Synthetic', responseText: 'synthetic', mode: 'AUTO_REPLY' }, {}, staffId);
  }
  assert.notEqual(ids[2], ids[3], 'Separate staff waiting cycles remain distinct intents');
  assert.equal(ids[0], ids[1], 'Automatic retry after restart keeps the same queue intent ID');
  let attempts = 0; const intentIds: string[] = [];
  const retry = setup(async command => { intentIds.push(command.id); if (++attempts === 1) throw new ServiceUnavailableException(); });
  const event = { connector: Route.MAX_BOT, externalUserId: 'synthetic-user', externalChatId: 'synthetic-chat',
    externalMessageId: 'synthetic-provider-inbound', text: 'synthetic inbound' };
  await assert.rejects(() => retry.service.ingestEvent(event));
  const accepted = await retry.service.ingestEvent(event);
  assert.equal(intentIds.length, 2); assert.equal(intentIds[0], intentIds[1]); assert(accepted.outbox);
  assert.equal(retry.service.messages.get(retry.dialog.id).filter((m: any) => m.direction === 'INBOUND').length, 1);
  assert.equal(retry.service.messages.get(retry.dialog.id).filter((m: any) => m.direction === 'SYSTEM').length, 1);
  const fresh = setup(async command => { intentIds.push(command.id); });
  await fresh.service.ingestEvent(event);
  assert.equal(intentIds[2], intentIds[1], 'Fresh service with empty message cache retains the upstream intent');
  let missingIdEnqueues = 0; const missingId = setup(async () => { missingIdEnqueues++; });
  const preserved = await missingId.service.ingestEvent({ ...event, externalMessageId: undefined });
  assert(preserved.message); assert.equal(missingIdEnqueues, 0, 'No unsafe restart retry key can be invented for missing upstream ID');
  const timerIds: string[] = []; let timerAttempts = 0;
  const timer = setup(async command => { timerIds.push(command.id); if (++timerAttempts === 1) throw new ServiceUnavailableException(); });
  timer.service.quickReplies.findMatchingRules = () => [{ id: 'synthetic-timer', title: 'Synthetic', responseText: 'synthetic timer', mode: 'AUTO_REPLY', triggerType: 'CLIENT_NO_REPLY_FOR' }];
  timer.service.messages.set(timer.dialog.id, [{ id: 'synthetic-client-msg', direction: 'INBOUND', kind: 'TEXT', senderRole: 'CLIENT', createdAt: at, externalMessageId: 'synthetic-mid' },
    { id: 'synthetic-staff-msg', direction: 'OUTBOUND', kind: 'TEXT', senderRole: 'STAFF', createdAt: at }]);
  timer.service.sweepNoReplyQuickReplies(); await new Promise(resolve => setImmediate(resolve));
  timer.service.sweepNoReplyQuickReplies(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timerIds.length, 2); assert.equal(timerIds[0], timerIds[1], 'No-reply admission failure retries the same staff-cycle intent');
  assert.equal(timer.service.noReplyQuickReplyAdmissionAttempts.size, 0, 'Successful intent releases bounded retry bookkeeping');
  console.log('MAX durable admission: response waits, no false message/SLA success on enqueue failure, auto replies await custody PASS');
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
