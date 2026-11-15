import * as assert from 'node:assert/strict';
const sharp: typeof import('sharp').default = require('sharp');
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupportMediaService } from '../src/support/support-media.service';
import { S3SupportMediaStore, SupportMediaObjectStore } from '../src/support/support-media-store';
import { SupportMediaController, PrepareSupportMediaDto, ResolveSupportMediaDto } from '../src/support/support-media.controller';
import { MessageAttachmentType as Type } from '../src/common/messages/message-attachment.types';
import { providerImageUrl, publicV4 } from '../src/support/support-media-download';
import { abortable } from '../src/support/support-media-download';
import { SupportController } from '../src/support/support.controller';
import { SupportConnectorRoute } from '../src/support/support.types';
import { authorizeSupportMedia } from '../src/support/support-media-auth';
import { SupportService } from '../src/support/support.service';

const secret = 'synthetic-signing-key-that-never-leaves-this-test';
const memory = new Map<string, Buffer>(); let puts = 0, grants = 0;
const store: SupportMediaObjectStore = {
  put: async (key, body) => { puts++; memory.set(key, Buffer.from(body)); return 'synthetic-object-version'; },
  deliveryUrl: async (key, version) => { assert.equal(version, 'synthetic-object-version'); grants++;
    return `https://synthetic-storage.invalid/${key}?X-Amz-Signature=synthetic-${grants}`; }
};
const service = (options: Record<string, unknown> = {}) => new SupportMediaService({ enabled: true, secret, store, ...options });
async function main() {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#126abc' } }).jpeg().toBuffer();
  const inline = { id: 'synthetic-photo', type: Type.IMAGE, url: 'data:image/jpeg;base64,' + jpeg.toString('base64'), name: 'synthetic.jpg' };
  for (const enabled of [false, true]) for (const connector of [SupportConnectorRoute.MAX_BOT, SupportConnectorRoute.LK_WEB_MESSENGER, SupportConnectorRoute.EMAIL]) {
    let normalizations = 0, uploads = 0, writes = 0;
    const ingress = new SupportService({ persistMessage: () => writes++ } as any,
      { resolveRoute: () => { normalizations++; throw Error('synthetic normalization reached'); } } as any, {} as any,
      { managedIngestEnabled: enabled, prepare: async () => { uploads++; throw Error('No upload allowed'); } } as any);
    for (const attachment of [{ ...inline, url: ' cup-media:v1:forged.reference ' },
      { ...inline, mediaRef: '' }, { ...inline, mediaScope: '' }]) {
      await assert.rejects(ingress.ingestEvent({ connector, attachments: [attachment] } as any),
        (error: any) => error.getStatus?.() === 400 && error.getResponse().code === 'SUPPORT_MEDIA_INPUT_INVALID');
    }
    assert.equal(normalizations + uploads + writes, 0, 'Raw references are refused before every side effect, independently of media mode/connector');
    for (const attachment of [inline, { ...inline, url: 'https://i.oneme.ru/synthetic-photo' }]) {
      await assert.rejects(ingress.ingestEvent({ connector, attachments: [attachment] }), /synthetic normalization reached/);
    }
    await assert.rejects(ingress.ingestEvent({ connector, text: 'ordinary text' }), /synthetic normalization reached/);
    assert.equal(normalizations, 3, 'Existing raw image/text input continues into the unchanged business path');
  }
  const media = service();
  const attachments = await media.prepare([inline, { ...inline, id: 'second' }], 'synthetic-owner');
  assert.equal(attachments.length, 2); assert.equal(attachments[0].mimeType, 'image/jpeg');
  assert(attachments[0].url.startsWith('cup-media:v1:')); assert(!attachments[0].url.includes('base64,'));
  assert.equal(attachments[0].mediaScope, attachments[1].mediaScope);
  const persisted = { message: { id: 'message', text: '', attachments }, meta: { attachments: [{ url: 'leave-user-metadata-alone' }] } };
  const before = JSON.stringify(persisted);
  const presented = await media.present(persisted);
  assert(presented.message.attachments[0].url.startsWith('https://'));
  assert(!('mediaRef' in presented.message.attachments[0]));
  assert.equal(presented.meta, persisted.meta); assert.equal(JSON.stringify(persisted), before, 'No cache/persistence mutation');
  const restarted = service();
  const renewed = await restarted.present(persisted);
  assert.notEqual(renewed.message.attachments[0].url, presented.message.attachments[0].url);
  assert.equal(JSON.stringify(persisted), before, 'Restart/read refresh does not rewrite durable references');
  await assert.rejects(media.present({ attachments: [{ ...attachments[0], mediaScope: 'a'.repeat(64) }] }), /Bad Request/);
  const ref = attachments[0].mediaRef!;
  await assert.rejects(media.present({ attachments: [{ ...attachments[0], mediaRef: ref.slice(0, -1) + (ref.endsWith('0') ? '1' : '0') }] }));
  const owner2 = await media.prepare([inline], 'another-owner');
  assert.notEqual(owner2[0].mediaScope, attachments[0].mediaScope);
  const n = puts;
  for (const input of [
    [{ ...inline, url: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    [{ ...inline, url: 'https://127.0.0.1/private' }],
    [{ ...inline, url: 'data:image/jpeg;base64,not-a-photo' }],
    [{ ...inline, mediaRef: attachments[0].mediaRef }],
    Array.from({ length: 11 }, () => inline)
  ]) await assert.rejects(media.prepare(input, 'synthetic-owner'));
  assert.equal(puts, n, 'Invalid input produces no object writes');
  await assert.rejects(new SupportMediaService({ enabled: false }).prepare([inline], 'owner'));
  const source = 'https://i.oneme.ru/synthetic-photo?expires=1';
  const max = service({ download: async () => jpeg });
  const incoming = await max.prepare([{ id: 'max-photo', type: Type.IMAGE, url: source }], 'max-owner', true);
  assert.equal(incoming[0].url, source, 'Exact deployed receiver (type,url) confirmation remains valid');
  assert(incoming[0].mediaRef); const read = await max.present({ attachments: incoming });
  assert(!read.attachments[0].url.includes('i.oneme.ru'));
  let calls = 0;
  const broken = service({ store: { ...store, put: async () => { if (++calls === 2) throw Error('synthetic outage'); return 'synthetic-object-version'; } } });
  await assert.rejects(broken.prepare([inline, { ...inline, id: 'second' }], 'owner'));
  assert.equal(calls, 2, 'A partial object upload cannot return a partial attachment success');
  const s3 = new S3SupportMediaStore('synthetic-bucket', { endpoint: 'https://synthetic-storage.invalid', region: 'synthetic-region',
    accessKeyId: 'synthetic-access-key', secretAccessKey: 'synthetic-secret-key', forcePathStyle: true });
  const signed = new URL(await s3.deliveryUrl('cup-support/v1/synthetic.jpg', 'synthetic-version'));
  assert.equal(signed.searchParams.get('versionId'), 'synthetic-version');
  (s3 as any).client = { send: async () => ({ Metadata: { sha256: 'synthetic-hash' }, ContentLength: 1, ContentType: 'image/jpeg' }) };
  await assert.rejects(s3.put('synthetic-key', Buffer.from('a'), 'synthetic-hash', new AbortController().signal), /VERSIONING_REQUIRED/);
  await assert.rejects(service({ store: { ...store, put: async () => '' } }).prepare([inline], 'owner'), /Service Unavailable/);
  const timeout = new AbortController();
  const dns = abortable(new Promise<never>(() => {}), timeout.signal); timeout.abort();
  await assert.rejects(dns, /SUPPORT_MEDIA_TIMEOUT/);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1']) assert(!publicV4(ip));
  assert(publicV4('8.8.8.8'));
  for (const url of ['http://i.oneme.ru/a', 'https://i.oneme.ru.evil.invalid/a', 'https://u:p@i.oneme.ru/a', 'https://i.oneme.ru:8443/a', 'https://127.0.0.1/a']) assert.throws(() => providerImageUrl(url, ['i.oneme.ru']));
  assert.equal(providerImageUrl(source, ['i.oneme.ru']).hostname, 'i.oneme.ru');
  const controller = new SupportMediaController(media);
  const old = process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN, ingress = process.env.SUPPORT_INTEGRATION_TOKEN, enabled = process.env.SUPPORT_MEDIA_ENABLED;
  try {
    delete process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN; delete process.env.SUPPORT_INTEGRATION_TOKEN;
    await assert.rejects(controller.prepare(undefined, { owner: 'WEB_LK:0123456789abcdef', attachments: [inline] }));
    process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN = 'synthetic-internal-service-token';
    process.env.SUPPORT_MEDIA_ENABLED = 'true';
    let ingressCalls = 0;
    const ingressController = new SupportController({ ingestEvent: async () => { ingressCalls++; return {}; },
      authorizeMediaIngest: (_dto: unknown, token: string) => authorizeSupportMedia(token) } as any);
    await ingressController.ingestEvent(undefined, {} as any);
    await assert.rejects(ingressController.ingestEvent(undefined, { connector: SupportConnectorRoute.MAX_BOT, attachments: [inline] } as any));
    await ingressController.ingestEvent(undefined, { connector: SupportConnectorRoute.MAX_BOT, attachments: [inline] } as any, process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN);
    assert.equal(ingressCalls, 2, 'Dedicated photo auth does not activate a global ingress key');
    await assert.rejects(controller.prepare('wrong', { owner: 'WEB_LK:0123456789abcdef', attachments: [inline] }));
    const output = await controller.prepare(process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN, { owner: 'WEB_LK:0123456789abcdef', attachments: [inline] });
    const resolved = await controller.resolve(process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN, { items: [{ index: 0, id: inline.id,
      mediaRef: output.attachments[0].mediaRef!, mediaScope: output.attachments[0].mediaScope! }] });
    assert.equal(resolved.items[0].id, inline.id); assert(resolved.items[0].url.startsWith('https://'));
  } finally {
    if (old === undefined) delete process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN; else process.env.SUPPORT_MEDIA_INTEGRATION_TOKEN = old;
    if (ingress === undefined) delete process.env.SUPPORT_INTEGRATION_TOKEN; else process.env.SUPPORT_INTEGRATION_TOKEN = ingress;
    if (enabled === undefined) delete process.env.SUPPORT_MEDIA_ENABLED; else process.env.SUPPORT_MEDIA_ENABLED = enabled;
  }
  const invalid = plainToInstance(PrepareSupportMediaDto, { owner: 'WEB_LK:0123456789abcdef', source: 'MAX', attachments: [inline] });
  assert((await validate(invalid, { whitelist: true, forbidNonWhitelisted: true })).length > 0);
  assert((await validate(plainToInstance(ResolveSupportMediaDto, { items: Array.from({ length: 301 }, () => ({ index: 0, id: 'x', mediaRef: 'x', mediaScope: 'a'.repeat(64) })) }))).length > 0);
  console.log('support media: normalization, immutable refs/restart, receiver compatibility, scopes/auth, invalid images, partial S3 failure, SSRF and bounds PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
