import {
  ResidentPreviewError,
  ResidentPreviewEvidence,
  ResidentPreviewPort,
  ResidentPreviewRequest
} from './residency-check.types';

const DEFAULT_API_PORT = '3000';
const DEFAULT_TIMEOUT_MS = 5000;
const PASS_PREVIEW_PATH = '/api/v1/admin/resident-services/passes/preview';
const MAX_UPSTREAM_BODY_CHARS = 64 * 1024;

/** Narrow structural fetch contract: keeps the adapter testable without a live server. */
export interface ResidentPreviewFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  redirect: 'error';
}

export interface ResidentPreviewFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type ResidentPreviewFetch = (
  url: string,
  init: ResidentPreviewFetchInit
) => Promise<ResidentPreviewFetchResponse>;

export interface ResidentPreviewAdapterOptions {
  fetchImpl?: ResidentPreviewFetch;
  timeoutMs?: number;
}

/**
 * HTTP implementation of the D preview port.
 *
 * The call is server-to-server against the same ph-ab API that hosts D
 * (loopback by default). The staff cookie/authorization of the current request
 * is forwarded so D performs its own authorization and station-scope checks;
 * nothing from the browser body is trusted. The response is reduced to the
 * minimum evidence (pass id + verified subscription instance id + station) and
 * every failure collapses into a typed error that carries no token, session or
 * upstream body.
 */
export class HttpResidentPreviewAdapter implements ResidentPreviewPort {
  private readonly fetchImpl: ResidentPreviewFetch;
  private readonly timeoutMs: number;

  constructor(options: ResidentPreviewAdapterOptions = {}) {
    const fetchImpl = options.fetchImpl;
    if (typeof fetchImpl !== 'function' && typeof fetch !== 'function') {
      throw new ResidentPreviewError(
        'UNAVAILABLE',
        'RESIDENCY_PASS_PREVIEW_UNAVAILABLE'
      );
    }
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
    const timeout = Number(options.timeoutMs);
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0
      ? Math.min(Math.trunc(timeout), 30000)
      : DEFAULT_TIMEOUT_MS;
  }

  async previewPass(
    request: ResidentPreviewRequest
  ): Promise<ResidentPreviewEvidence> {
    const url = this.previewUrl();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json'
    };
    const session = request.staffSession ?? {};
    if (session.cookie) {
      headers.cookie = session.cookie;
    }
    if (session.authorization) {
      headers.authorization = session.authorization;
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    let response: ResidentPreviewFetchResponse;
    let raw = '';
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          token: request.passToken,
          stationId: request.stationId
        }),
        // A redirect could leak the forwarded staff credentials to another URL.
        redirect: 'error',
        ...(controller ? { signal: controller.signal } : {})
      });
      // Body read stays inside the same abort window.
      raw = await response.text();
    } catch {
      throw new ResidentPreviewError(
        'UNAVAILABLE',
        'RESIDENCY_PASS_PREVIEW_UNAVAILABLE'
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    return mapPreviewResponse(response.status, raw);
  }

  /** Base URL of the ph-ab API that hosts D; same origin is the safe default. */
  private previewUrl(): string {
    const configured = String(
      process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL ?? ''
    ).trim();
    const fallbackPort = String(process.env.PORT ?? '').trim() || DEFAULT_API_PORT;
    const candidate = configured || `http://127.0.0.1:${fallbackPort}`;
    return `${normalizeApiBaseUrl(candidate)}${PASS_PREVIEW_PATH}`;
  }
}

/** Only plain http(s) without embedded credentials is a valid API base. */
export function normalizeApiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResidentPreviewError(
      'UNAVAILABLE',
      'RESIDENCY_PASS_PREVIEW_URL_INVALID'
    );
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new ResidentPreviewError(
      'UNAVAILABLE',
      'RESIDENCY_PASS_PREVIEW_URL_INVALID'
    );
  }
  const basePath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${basePath}`;
}

function mapPreviewResponse(
  status: number,
  rawBody: string
): ResidentPreviewEvidence {
  if (status === 401) {
    throw new ResidentPreviewError(
      'UNAUTHENTICATED',
      'RESIDENCY_AUTH_REQUIRED'
    );
  }
  if (status >= 500) {
    throw new ResidentPreviewError(
      'UNAVAILABLE',
      'RESIDENCY_PASS_PREVIEW_UNAVAILABLE'
    );
  }
  if (status < 200 || status >= 300) {
    // 4xx from D means the pass is unknown, expired, already used or outside
    // this staff member's station scope. The reason stays in D; E returns a
    // generic refusal without PII.
    throw new ResidentPreviewError(
      'REJECTED',
      'RESIDENCY_PASS_NOT_VERIFIED'
    );
  }

  let body: unknown = null;
  if (rawBody && rawBody.length <= MAX_UPSTREAM_BODY_CHARS) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }
  const evidence = readPreviewEvidence(body);
  if (!evidence) {
    throw new ResidentPreviewError(
      'UNAVAILABLE',
      'RESIDENCY_PASS_PREVIEW_INVALID'
    );
  }
  return evidence;
}

/**
 * Reads only the fields E needs. A preview that does not positively confirm
 * the resident instance is rejected instead of being partially trusted.
 */
function readPreviewEvidence(body: unknown): ResidentPreviewEvidence | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const preview = body as Record<string, unknown>;
  const resident =
    preview.resident && typeof preview.resident === 'object'
      ? (preview.resident as Record<string, unknown>)
      : null;
  if (!resident || resident.confirmed !== true) {
    return null;
  }
  const passId = typeof preview.passId === 'string' ? preview.passId.trim() : '';
  const subscriptionInstanceId = typeof resident.subscriptionInstanceId === 'string'
    ? resident.subscriptionInstanceId.trim()
    : '';
  const stationId = typeof preview.stationId === 'string' ? preview.stationId.trim() : '';
  const expiresAt = typeof preview.expiresAt === 'string' ? preview.expiresAt.trim() : '';
  if (!passId || !subscriptionInstanceId || !stationId) {
    return null;
  }
  return { passId, subscriptionInstanceId, stationId, expiresAt };
}
