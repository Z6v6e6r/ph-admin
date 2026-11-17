import * as assert from 'node:assert/strict';
import { SupportService } from '../src/support/support.service';
import { SupportMediaService } from '../src/support/support-media.service';
import { MessageAttachmentType as Type } from '../src/common/messages/message-attachment.types';
import { SupportClientAuthStatus as Auth, SupportConnectorRoute as Route, SupportDialogStatus as Status } from '../src/support/support.types';
import { Role } from '../src/common/rbac/role.enum';
import { MessengerService } from '../src/messenger/messenger.service';
import { ConnectorRoute, ThreadStatus } from '../src/messenger/messenger.types';
const sharp: typeof import('sharp').default = require('sharp');
const user: any = { id: 'synthetic-staff', roles: [Role.SUPER_ADMIN], permissions: ['dialogs:read', 'dialogs:write'], stationIds: ['synthetic-station'], connectorRoutes: [Route.MAX_BOT] };
const at = '2026-01-01T00:00:00.000Z';
const context = () => ({ client: { id: 'synthetic-client', authStatus: Auth.VERIFIED, displayName: 'Synthetic', phones: [], emails: [],
  identities: [{ connector: Route.MAX_BOT, externalUserId: 'synthetic-user', externalChatId: 'synthetic-chat' }], createdAt: at, updatedAt: at },
  dialog: { id: 'synthetic-dialog', clientId: 'synthetic-client', stationId: 'synthetic-station', stationName: 'Synthetic',
    accessStationIds: ['synthetic-station'], writeStationIds: ['synthetic-station'], readOnlyStationIds: [],
    connectors: [Route.MAX_BOT], lastInboundConnector: Route.MAX_BOT, status: Status.OPEN, authStatus: Auth.VERIFIED,
    phones: [], emails: [], subject: 'Synthetic', unreadCount: 0, pendingClientMessageIds: [], responseTimeTotalMs: 0,
    responseCount: 0, createdAt: at, updatedAt: at } });
function fixture(media: SupportMediaService, onLoad = () => context()) {
  const writes: string[] = [];
  const persistence: any = { isEnabled: () => true, loadReplyContext: async () => onLoad(),
    persistMessage: () => writes.push('message'), persistServiceMessage: () => writes.push('service-message'), persistDialog: () => writes.push('dialog'),
    persistOutboxCommand: (command: any) => { writes.push('outbox'); return command; }, persistResponseMetric: () => writes.push('metric') };
  const service = new SupportService(persistence, { resolveRoute: (x: any) => x } as any,
    { registerUsage() {}, findMatchingRules: () => [] } as any, media);
  return { service, writes };
}
async function main() {
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123abc' } }).jpeg().toBuffer();
  const photo = { id: 'synthetic-photo', type: Type.IMAGE, url: 'data:image/jpeg;base64,' + jpeg.toString('base64') };
  const media = new SupportMediaService({ enabled: true, secret: 'synthetic-secret-longer-than-thirty-two-bytes',
    store: { put: async () => 'synthetic-version', deliveryUrl: async () => 'https://synthetic.invalid/photo.jpg' } });
  for (const count of [1, 10]) {
    const f = fixture(media), result = await f.service.replyToDialogWithReadThrough('synthetic-dialog',
      { text: count === 1 ? '' : 'caption', attachments: Array.from({ length: count }, (_, i) => ({ ...photo, id: `photo-${i}` })) }, user);
    assert.equal(result.message.attachments?.length, count);
    assert.equal(result.outbox?.attachments?.length, count);
    assert(result.outbox?.attachments?.every(a => a.mediaRef && !a.url.includes('base64,')));
    assert(Buffer.byteLength(JSON.stringify(result)) < 40000, 'Mongo history/outbox contain references, not image binaries');
    assert.equal(f.writes.filter(x => x === 'message').length, 1);
  }
  for (const broken of [new SupportMediaService({ enabled: false }),
    { prepare: async () => { throw Error('synthetic storage failure'); } } as unknown as SupportMediaService]) {
    const f = fixture(broken);
    await assert.rejects(f.service.replyToDialogWithReadThrough('synthetic-dialog', { attachments: [photo] }, user));
    assert.equal(f.writes.length, 0, 'Storage failure cannot append message/metrics/outbox');
  }
  let loads = 0;
  const stale = fixture(media, () => { const ctx = context(); if (++loads > 1) ctx.client.identities[0].externalChatId = 'changed-target'; return ctx; });
  await assert.rejects(stale.service.replyToDialogWithReadThrough('synthetic-dialog', { attachments: [photo] }, user));
  assert.equal(stale.writes.length, 0, 'Changed recipient during upload cannot receive a stale-target reply');
  const template = { id: 'synthetic-rule', title: 'Synthetic rule', responseText: 'template caption',
    responseAttachments: [{ ...photo, url: 'https://synthetic-templates.invalid/photo.jpg' }], mode: 'AUTO_REPLY' };
  const oldHosts = process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS;
  try {
    process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS = 'synthetic-templates.invalid';
    const templates = new SupportMediaService({ enabled: true, secret: 'synthetic-secret-longer-than-thirty-two-bytes',
      download: async () => jpeg, store: { put: async () => 'synthetic-version', deliveryUrl: async () => 'https://synthetic.invalid/photo.jpg' } });
    for (const active of [false, true]) {
      const f = fixture(active ? templates : new SupportMediaService({ enabled: false })), ctx = context(), state = f.service as any;
      const dialog = state.normalizeLoadedDialog(ctx.dialog); state.dialogs.set(dialog.id, dialog); state.clients.set(ctx.client.id, ctx.client);
      const outgoing = await state.sendQuickReplyAutoResponse(dialog, { id: 'incoming' }, Route.MAX_BOT, template, {});
      assert.equal(outgoing.text, 'template caption');
      assert.equal(Boolean(outgoing.attachments[0].mediaRef), active, 'Existing template URLs materialize only in enabled MAX path');
    }
    const f = fixture(templates), ctx = context(), state = f.service as any;
    const dialog = state.normalizeLoadedDialog(ctx.dialog); state.dialogs.set(dialog.id, dialog); state.clients.set(ctx.client.id, ctx.client);
    process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS = '';
    assert.equal(await state.sendQuickReplyAutoResponse(dialog, { id: 'already-accepted-incoming' }, Route.MAX_BOT, template, {}), undefined);
    assert.equal(f.writes.length, 0, 'Untrusted template cannot create a broken outgoing or falsify accepted inbound failure');
  } finally {
    if (oldHosts === undefined) delete process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS; else process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS = oldHosts;
  }
  // Existing legacy Messenger threads use the same media barrier before their synchronous writer.
  const legacy = new MessengerService({ analyzeDialog: () => ({}) } as any, { listRules: () => [] } as any,
    { persistMessage() {}, persistThread() {}, persistResponseMetrics() {}, persistAiInsight() {}, persistStation() {}, persistConnector() {}, persistAccessRule() {}, persistAiConfig() {} } as any, media);
  const thread: any = { id: 'legacy', clientId: 'synthetic-client', stationId: 'synthetic-station', connector: ConnectorRoute.MAX_BOT,
    status: ThreadStatus.OPEN, createdAt: at, updatedAt: at, pendingClientMessageIds: [] };
  (legacy as any).threads.set(thread.id, thread);
  const stored = await legacy.sendMessageWithMedia(thread.id, { attachments: [photo] }, user);
  assert(stored.attachments?.[0].mediaRef);
  let finish!: () => void;
  const pendingMedia = { prepare: async () => { await new Promise<void>(resolve => { finish = resolve; }); return stored.attachments; } } as unknown as SupportMediaService;
  (legacy as any).media = pendingMedia;
  const pending = legacy.sendMessageWithMedia(thread.id, { attachments: [photo] }, user);
  thread.status = ThreadStatus.CLOSED; finish();
  await assert.rejects(pending);
  console.log('photo reply: photo-only/caption/ten images, durable small refs, storage failure barrier, changed recipient and closed legacy thread PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
