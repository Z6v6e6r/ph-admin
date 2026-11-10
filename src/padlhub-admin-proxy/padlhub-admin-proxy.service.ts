import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Server-side bridge to the PadlHub admin API for the two CUP blocks that used to demand a second
 * PadlHub operator session: «Уведомления» and the public station cards.
 *
 * The ЦУП operator is already authenticated here, so the browser must never hold the PadlHub
 * credential. This service attaches the narrow delegation credential (`PADLHUB_ADMIN_DELEGATION_TOKEN`,
 * accepted by the PadlHub API only for `/admin/api/v1/{tenant}/notifications/**` and
 * `/admin/api/v1/{tenant}/locations**`) and forwards only allowlisted paths.
 */

export const PADLHUB_ADMIN_PROXY_PREFIX = '/api/ui/padlhub-admin';

export interface ForwardRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  /** Path below `/admin/api/v1/{tenantKey}`, always starting with a slash. */
  readonly path: string;
  readonly search?: string;
  readonly contentType?: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly body?: Buffer;
}

export interface ForwardResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

@Injectable()
export class PadlhubAdminProxyService {
  private readonly logger = new Logger(PadlhubAdminProxyService.name);
  private readonly baseUrl = String(process.env.PADLHUB_NOTIFICATION_API_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  private readonly token = String(process.env.PADLHUB_ADMIN_DELEGATION_TOKEN ?? '').trim();
  private readonly tenantKey =
    String(process.env.PADLHUB_NOTIFICATION_TENANT_KEY ?? '').trim() || 'local-padel';
  private readonly timeoutMs = this.resolveTimeout();

  /** Whether the bridge is configured. Without both values the panel keeps its old behaviour. */
  get enabled(): boolean {
    return this.baseUrl.length > 0 && this.token.length > 0;
  }

  /** The single tenant this container may act for; the delegation credential is scoped to it. */
  get allowedTenantKey(): string {
    return this.tenantKey;
  }

  async forward(input: ForwardRequest): Promise<ForwardResponse> {
    if (!this.enabled) {
      throw new Error('PADLHUB_ADMIN_PROXY_NOT_CONFIGURED');
    }
    const url =
      this.baseUrl + '/admin/api/v1/' + encodeURIComponent(this.tenantKey) + input.path +
      (input.search ? input.search : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: input.method,
        headers: {
          Accept: 'application/json',
          'X-App-Platform': 'cup-admin',
          'X-Correlation-ID': input.correlationId?.trim() || randomUUID(),
          Authorization: `Bearer ${this.token}`,
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
      };
    } catch (error) {
      // Never surface the upstream address or credential; the operator only needs the stable code.
      this.logger.warn(
        `PadlHub admin proxy call failed: ${error instanceof Error ? error.name : 'unknown'}`
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveTimeout(): number {
    const configured = Number(process.env.PADLHUB_ADMIN_PROXY_TIMEOUT_MS);
    if (!Number.isFinite(configured)) {
      return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(configured)));
  }
}
