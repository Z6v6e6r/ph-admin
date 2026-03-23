import { Injectable, Logger } from '@nestjs/common';

export type VivaClientCabinetStatus = 'FOUND' | 'NOT_FOUND' | 'DISABLED';

export interface VivaClientCabinetLookup {
  phone: string;
  status: VivaClientCabinetStatus;
  vivaClientId?: string;
  vivaCabinetUrl?: string;
}

interface VivaClientsSearchResponse {
  content?: Array<Record<string, unknown>>;
}

interface VivaLookupCacheEntry {
  expiresAt: number;
  value: VivaClientCabinetLookup;
}

@Injectable()
export class VivaAdminService {
  private readonly logger = new Logger(VivaAdminService.name);
  private readonly baseUrl = (
    String(process.env.VIVA_ADMIN_API_BASE_URL ?? '').trim() || 'https://api.vivacrm.ru'
  ).replace(/\/+$/, '');
  private readonly token = String(process.env.VIVA_ADMIN_API_TOKEN ?? '').trim();
  private readonly cacheTtlMs = this.readPositiveNumberEnv(
    'VIVA_ADMIN_CACHE_TTL_MS',
    10 * 60 * 1000
  );
  private readonly requestTimeoutMs = this.readPositiveNumberEnv(
    'VIVA_ADMIN_TIMEOUT_MS',
    5000
  );
  private readonly cache = new Map<string, VivaLookupCacheEntry>();
  private readonly inflight = new Map<string, Promise<VivaClientCabinetLookup>>();
  private missingConfigLogged = false;

  async lookupClientCabinetByPhone(phone?: string): Promise<VivaClientCabinetLookup | null> {
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return null;
    }

    const cached = this.cache.get(normalizedPhone);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = this.inflight.get(normalizedPhone);
    if (pending) {
      return pending;
    }

    const request = this.fetchClientCabinetByPhone(normalizedPhone)
      .catch((error) => {
        this.logger.warn(
          `Failed to resolve Viva client cabinet url for ${normalizedPhone}: ${String(error)}`
        );
        return { phone: normalizedPhone, status: 'NOT_FOUND' as const };
      })
      .then((result) => {
        this.cache.set(normalizedPhone, {
          expiresAt: Date.now() + this.cacheTtlMs,
          value: result
        });
        return result;
      })
      .finally(() => {
        this.inflight.delete(normalizedPhone);
      });

    this.inflight.set(normalizedPhone, request);
    return request;
  }

  private async fetchClientCabinetByPhone(phone: string): Promise<VivaClientCabinetLookup> {
    if (!this.token) {
      if (!this.missingConfigLogged) {
        this.missingConfigLogged = true;
        this.logger.log(
          'VIVA_ADMIN_API_TOKEN is empty. Viva CRM cabinet links are disabled.'
        );
      }
      return { phone, status: 'DISABLED' };
    }

    const url = new URL('/api/v1/clients', `${this.baseUrl}/`);
    url.searchParams.set('phone', phone);
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '1');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`
      },
      signal: this.buildAbortSignal()
    });

    if (!response.ok) {
      this.logger.warn(
        `Viva CRM lookup failed for ${phone}: ${response.status} ${response.statusText}`
      );
      return { phone, status: 'NOT_FOUND' };
    }

    const payload = (await response.json().catch(() => null)) as VivaClientsSearchResponse | null;
    const vivaClientId = this.extractClientId(payload);
    if (!vivaClientId) {
      return { phone, status: 'NOT_FOUND' };
    }

    return {
      phone,
      status: 'FOUND',
      vivaClientId,
      vivaCabinetUrl: `https://cabinet.vivacrm.ru/clients/${encodeURIComponent(vivaClientId)}`
    };
  }

  private extractClientId(payload: VivaClientsSearchResponse | null): string | undefined {
    if (!payload || !Array.isArray(payload.content) || payload.content.length === 0) {
      return undefined;
    }

    const candidate = payload.content[0];
    if (!candidate || typeof candidate !== 'object') {
      return undefined;
    }

    const id = String(candidate.id ?? '').trim();
    return id || undefined;
  }

  private buildAbortSignal(): AbortSignal | undefined {
    const abortSignalTimeout = (AbortSignal as typeof AbortSignal & {
      timeout?: (delay: number) => AbortSignal;
    }).timeout;

    return typeof abortSignalTimeout === 'function'
      ? abortSignalTimeout(this.requestTimeoutMs)
      : undefined;
  }

  private normalizePhone(phone?: string): string | undefined {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) {
      return undefined;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? '');
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.trunc(raw);
  }
}
