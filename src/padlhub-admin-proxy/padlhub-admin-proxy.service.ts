import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';

/**
 * Server-side bridge to the PadlHub admin API for the two CUP blocks that used to demand a second
 * PadlHub operator session: «Уведомления» and the public station cards.
 *
 * The ЦУП operator is already authenticated here, so the browser must never hold a PadlHub credential.
 * This service attaches a short-lived assertion — an HMAC over the tenant key and the current time,
 * keyed with `PADLHUB_ADMIN_DELEGATION_TOKEN` — which the PadlHub API accepts only for
 * `/admin/api/v1/{tenant}/notifications/**` and `/admin/api/v1/{tenant}/locations**`, only inside its
 * replay window. A captured request therefore stops working within seconds and cannot be replayed for
 * another tenant.
 */

export const PADLHUB_ADMIN_PROXY_PREFIX = '/api/ui/padlhub-admin';

export interface ForwardRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  /** Path below `/admin/api/v1/{tenantKey}`, always starting with a slash. */
  readonly path: string;
  readonly search?: string;
  readonly contentType?: string;
  readonly idempotencyKey?: string;
  readonly body?: Buffer;
}

export interface ForwardResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
  /** Correlation id generated here, never taken from the browser, and echoed to the client. */
  readonly correlationId: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
// LK2 caps a station photo at 8 MiB; a little slack covers its own envelope without letting one
// session push an unbounded body into the console process.
const DEFAULT_MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const MIN_MAX_MEDIA_BYTES = 1_024;
const MAX_MAX_MEDIA_BYTES = 32 * 1024 * 1024;

@Injectable()
export class PadlhubAdminProxyService {
  private readonly logger = new Logger(PadlhubAdminProxyService.name);
  private readonly baseUrl = String(process.env.PADLHUB_NOTIFICATION_API_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  private readonly token = String(process.env.PADLHUB_ADMIN_DELEGATION_TOKEN ?? '').trim();
  private readonly tenantKey = String(process.env.PADLHUB_NOTIFICATION_TENANT_KEY ?? '').trim();
  private readonly timeoutMs = this.resolveTimeout();

  /**
   * Whether the bridge is configured. The tenant key must be explicit: defaulting it while the
   * credential is set would silently point every campaign and station save at another organisation.
   */
  get enabled(): boolean {
    return this.baseUrl.length > 0 && this.token.length > 0 && this.tenantKey.length > 0;
  }

  /** The single tenant this container may act for; the delegation credential is scoped to it. */
  get allowedTenantKey(): string {
    return this.tenantKey;
  }

  /** Largest binary body (station photo) accepted before the console refuses it itself. */
  get maxMediaBytes(): number {
    const configured = Number(process.env.PADLHUB_ADMIN_PROXY_MAX_MEDIA_BYTES);
    if (!Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_MAX_MEDIA_BYTES;
    }
    return Math.min(MAX_MAX_MEDIA_BYTES, Math.max(MIN_MAX_MEDIA_BYTES, Math.floor(configured)));
  }

  async forward(input: ForwardRequest): Promise<ForwardResponse> {
    if (!this.enabled) {
      throw new Error('PADLHUB_ADMIN_PROXY_NOT_CONFIGURED');
    }
    // Correlation is a server fact: a browser-supplied value would let a caller blur two operations
    // together in the LK2 audit trail.
    const correlationId = randomUUID();
    const url =
      this.baseUrl +
      '/admin/api/v1/' +
      encodeURIComponent(this.tenantKey) +
      input.path +
      (input.search ? input.search : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: input.method,
        headers: {
          Accept: 'application/json',
          'X-App-Platform': 'cup-admin',
          'X-Correlation-ID': correlationId,
          Authorization: `Bearer ${this.delegationAssertion()}`,
          ...(input.contentType ? { 'Content-Type': input.contentType } : {}),
          ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
        },
        // A Node Buffer is a valid request body at runtime; the DOM typing only accepts BodyInit.
        ...(input.body === undefined ? {} : { body: input.body as unknown as BodyInit }),
        signal: controller.signal,
      });
      const body = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? 'application/json',
        body,
        correlationId,
      };
    } catch (error) {
      // Never log the upstream address, the credential or the payload; the operator only needs the code.
      this.logger.warn(
        `PadlHub admin proxy failed: ${input.method} ${input.path} correlation=${correlationId} error=${
          error instanceof Error ? error.name : 'unknown'
        }`
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** `cupv1.<issuedAtMs>.<hmacSha256Hex>`, mirrored by the LK2 verifier. */
  private delegationAssertion(issuedAtMs = Date.now()): string {
    const mac = createHmac('sha256', this.token)
      .update(`cupv1\n${this.tenantKey}\n${issuedAtMs}`)
      .digest('hex');
    return `cupv1.${issuedAtMs}.${mac}`;
  }

  private resolveTimeout(): number {
    const configured = Number(process.env.PADLHUB_ADMIN_PROXY_TIMEOUT_MS);
    if (!Number.isFinite(configured)) {
      return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(configured)));
  }
}
