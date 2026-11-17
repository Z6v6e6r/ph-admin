import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
const sharp: typeof import('sharp').default = require('sharp');
import { MessageAttachment, MessageAttachmentType } from '../common/messages/message-attachment.types';
import { downloadProviderImage, providerImageUrl } from './support-media-download';
import { S3SupportMediaStore, SupportMediaObjectStore } from './support-media-store';

export const MEDIA_SOURCE_BYTES = 4 * 1024 * 1024;
export const MEDIA_TOTAL_BYTES = 12 * 1024 * 1024;
export const MEDIA_OUTPUT_BYTES = 3 * 1024 * 1024;
const PREFIX = 'cup-support/v1';
const REF_PREFIX = 'cup-media:v1:';
const HASH = /^[a-f0-9]{64}$/;
type Binding = { scope: string; sha: string; version: string; bytes: number };
type MediaOptions = { store?: SupportMediaObjectStore; secret?: string; enabled?: boolean;
  hosts?: string[]; download?: typeof downloadProviderImage };

function invalid(code: string): never {
  throw new BadRequestException({ code, ...(code === 'SUPPORT_MEDIA_SOURCE_FORBIDDEN'
    ? { message: 'Прикрепите фото заново с устройства и повторите отправку.' } : {}) });
}

@Injectable()
export class SupportMediaService {
  private readonly store?: SupportMediaObjectStore;
  private readonly secret: string;
  private readonly enabled: boolean;
  private readonly hosts: string[];
  private readonly download: typeof downloadProviderImage;
  private busy = 0;

  constructor(options: MediaOptions = {}) {
    this.enabled = options.enabled ?? process.env.SUPPORT_MEDIA_ENABLED === 'true';
    this.secret = options.secret ?? String(process.env.SUPPORT_MEDIA_SIGNING_KEY ?? '');
    this.hosts = options.hosts ?? String(process.env.SUPPORT_MEDIA_MAX_IMAGE_HOSTS ?? 'i.oneme.ru').split(',').map(x => x.trim());
    this.download = options.download ?? downloadProviderImage;
    if (options.store) this.store = options.store;
    else if (this.enabled) {
      const endpoint = String(process.env.SUPPORT_MEDIA_S3_ENDPOINT ?? '');
      const bucket = String(process.env.SUPPORT_MEDIA_S3_BUCKET ?? '');
      const region = String(process.env.SUPPORT_MEDIA_S3_REGION ?? '');
      const accessKeyId = String(process.env.SUPPORT_MEDIA_S3_ACCESS_KEY_ID ?? '');
      const secretAccessKey = String(process.env.SUPPORT_MEDIA_S3_SECRET_ACCESS_KEY ?? '');
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          !bucket || !region || !accessKeyId || !secretAccessKey || this.secret.length < 32 ||
          this.hosts.some(x => !/^[a-z0-9.-]+$/.test(x))) throw new Error('SUPPORT_MEDIA_CONFIGURATION_INVALID');
      this.store = new S3SupportMediaStore(bucket, { endpoint, region, accessKeyId, secretAccessKey,
        forcePathStyle: process.env.SUPPORT_MEDIA_S3_FORCE_PATH_STYLE === 'true' });
    }
  }

  assertReady(): void {
    if (!this.enabled || !this.store || this.secret.length < 32) {
      throw new ServiceUnavailableException({ code: 'SUPPORT_MEDIA_UNCONFIGURED' });
    }
  }
  get managedIngestEnabled(): boolean { return this.enabled; }
  private mac(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  private ref(binding: Binding): string {
    const body = Buffer.from(JSON.stringify(binding)).toString('base64url');
    return REF_PREFIX + body + '.' + this.mac('attachment\0' + body);
  }
  private binding(ref: string): Binding {
    this.assertReady();
    const [body, signature, extra] = ref.slice(REF_PREFIX.length).split('.');
    if (!ref.startsWith(REF_PREFIX) || extra || !/^[A-Za-z0-9_-]{1,2048}$/.test(body ?? '') || !HASH.test(signature ?? '')) {
      return invalid('SUPPORT_MEDIA_REFERENCE_INVALID');
    }
    const expected = Buffer.from(this.mac('attachment\0' + body), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return invalid('SUPPORT_MEDIA_REFERENCE_INVALID');
    let b: Binding;
    try { b = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return invalid('SUPPORT_MEDIA_REFERENCE_INVALID'); }
    if (!b || typeof b !== 'object' || Object.keys(b).sort().join(',') !== 'bytes,scope,sha,version' || !HASH.test(b.scope) || !HASH.test(b.sha) ||
        typeof b.version !== 'string' || !b.version || b.version === 'null' || b.version.length > 1024 || !Number.isSafeInteger(b.bytes) ||
        b.bytes < 1 || b.bytes > MEDIA_OUTPUT_BYTES) return invalid('SUPPORT_MEDIA_REFERENCE_INVALID');
    return b;
  }
  private objectKey(b: Binding): string { return `${PREFIX}/${b.scope}/${b.sha}.jpg`; }

  prepareTemplate(raw: unknown[] | undefined, owner: string): Promise<MessageAttachment[]> {
    const hosts = String(process.env.SUPPORT_MEDIA_TEMPLATE_IMAGE_HOSTS ?? '').split(',').map(x => x.trim()).filter(Boolean);
    return this.prepare(raw, owner, false, hosts);
  }

  async prepare(raw: unknown[] | undefined, owner: string, provider = false, templateHosts?: string[]): Promise<MessageAttachment[]> {
    if (!raw?.length) return [];
    this.assertReady();
    if (process.env.SUPPORT_MEDIA_UPLOADS_ENABLED === 'false') {
      throw new ServiceUnavailableException({ code: 'SUPPORT_MEDIA_UPLOADS_DISABLED' });
    }
    if (!Array.isArray(raw) || raw.length > 10) return invalid('SUPPORT_MEDIA_TOO_MANY');
    if (this.busy >= 2) throw new ServiceUnavailableException({ code: 'SUPPORT_MEDIA_BUSY' });
    // Validate every encoded input before the first allocation, download or S3 write.
    let declared = 0;
    const ids = new Set<string>();
    const sources = raw.map(value => {
      const x = value as Partial<MessageAttachment>;
      if (!x || x.type !== MessageAttachmentType.IMAGE || typeof x.url !== 'string' || x.mediaRef || x.mediaScope) {
        return invalid('SUPPORT_MEDIA_INPUT_INVALID');
      }
      if (x.id) { if (ids.has(x.id)) return invalid('SUPPORT_MEDIA_DUPLICATE_ID'); ids.add(x.id); }
      const match = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(x.url);
      if (match) {
        const n = Math.floor(match[1].length * 3 / 4) - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
        if (match[1].length % 4 || n < 1 || n > MEDIA_SOURCE_BYTES) return invalid('SUPPORT_MEDIA_TOO_LARGE');
        declared += n;
        if (declared > MEDIA_TOTAL_BYTES) return invalid('SUPPORT_MEDIA_TOTAL_TOO_LARGE');
        return { attachment: x, inline: match[1] };
      }
      if ((!provider && !templateHosts) || !/^https:\/\//.test(x.url)) return invalid('SUPPORT_MEDIA_SOURCE_FORBIDDEN');
      try { providerImageUrl(x.url, templateHosts ?? this.hosts); } catch { return invalid('SUPPORT_MEDIA_SOURCE_FORBIDDEN'); }
      return { attachment: x, inline: undefined };
    });
    this.busy++;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      let total = 0, outputTotal = 0; const result: MessageAttachment[] = [];
      for (const source of sources) {
        const bytes = source.inline !== undefined ? Buffer.from(source.inline, 'base64') :
          await this.download(source.attachment.url!, templateHosts ?? this.hosts, MEDIA_SOURCE_BYTES, controller.signal);
        total += bytes.length;
        if (!bytes.length || bytes.length > MEDIA_SOURCE_BYTES || total > MEDIA_TOTAL_BYTES) return invalid('SUPPORT_MEDIA_TOO_LARGE');
        const raster = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
        if (!raster) return invalid('SUPPORT_MEDIA_FORMAT_INVALID');
        const decoder = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'warning' }).timeout({ seconds: 5 });
        const metadata = await decoder.metadata().catch(() => invalid('SUPPORT_MEDIA_FORMAT_INVALID'));
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
          return invalid('SUPPORT_MEDIA_FORMAT_INVALID');
        }
        const normalized = await decoder.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()
          .catch(() => invalid('SUPPORT_MEDIA_FORMAT_INVALID'));
        outputTotal += normalized.length;
        if (normalized.length > MEDIA_OUTPUT_BYTES || outputTotal > MEDIA_TOTAL_BYTES || controller.signal.aborted) return invalid('SUPPORT_MEDIA_TOO_LARGE');
        const binding: Binding = { scope: this.mac('owner\0' + owner + '\0upload\0' + randomUUID()),
          sha: createHash('sha256').update(normalized).digest('hex'), version: '', bytes: normalized.length };
        binding.version = await this.store!.put(this.objectKey(binding), normalized, binding.sha, controller.signal);
        if (!binding.version || binding.version === 'null') throw new Error('SUPPORT_MEDIA_VERSIONING_REQUIRED');
        if (controller.signal.aborted) throw new Error('SUPPORT_MEDIA_TIMEOUT');
        const mediaRef = this.ref(binding);
        result.push({ id: source.attachment.id || randomUUID(), type: MessageAttachmentType.IMAGE,
          // The incoming MAX wire binding stays byte-for-byte compatible with its durable receiver.
          // Browsers and outgoing MAX commands use mediaRef, never this expiring provider URL.
          url: provider && !source.inline ? source.attachment.url! : mediaRef,
          mediaRef, mediaScope: binding.scope, name: String(source.attachment.name || 'Фото.jpg').slice(0, 240),
          mimeType: 'image/jpeg', size: normalized.length });
      }
      return result;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ code: 'SUPPORT_MEDIA_STORE_UNAVAILABLE' });
    } finally { clearTimeout(timer); this.busy--; }
  }

  /** Pure response copy: persisted/cache/receipt attachment bindings never receive signed URLs. */
  async present<T>(value: T): Promise<T> {
    const copy = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(copy);
      if (!x || typeof x !== 'object' || x instanceof Date || Buffer.isBuffer(x)) return x;
      return { ...x };
    };
    const out = copy(value) as T;
    const walk = async (x: unknown, depth = 0): Promise<void> => {
      if (!x || typeof x !== 'object' || depth > 6) return;
      if (Array.isArray(x)) { await Promise.all(x.map(y => walk(y, depth + 1))); return; }
      const object = x as Record<string, unknown>;
      for (const key of ['message', 'messages', 'outbox', 'commands']) {
        if (object[key]) { object[key] = copy(object[key]); await walk(object[key], depth + 1); }
      }
      if (Array.isArray(object.attachments)) object.attachments = await Promise.all(object.attachments.map(async original => {
        const a = { ...original } as MessageAttachment;
        if (a.type !== MessageAttachmentType.IMAGE) return a;
        const ref = a.mediaRef || (a.url?.startsWith(REF_PREFIX) ? a.url : undefined);
        if (!ref) return a; // Existing external photos remain read-only legacy links.
        const b = this.binding(ref);
        if (a.mediaScope !== b.scope) return invalid('SUPPORT_MEDIA_OWNER_MISMATCH');
        a.url = await this.store!.deliveryUrl(this.objectKey(b), b.version);
        delete a.mediaRef;
        delete a.mediaScope;
        return a;
      }));
    };
    await walk(out); return out;
  }
}
