import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { RequestUser } from '../common/rbac/request-user.interface';
import {
  TournamentClientSubscription,
  TournamentPublicClientProfile
} from './tournaments.types';

interface TournamentPublicSessionPayload {
  clientId: string;
  name?: string;
  phone?: string;
  phoneVerified?: boolean;
  levelLabel?: string;
  subscriptions?: TournamentClientSubscription[];
  iat: number;
  exp: number;
}

interface PhoneAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
}

@Injectable()
export class TournamentsPublicSessionService {
  private readonly logger = new Logger(TournamentsPublicSessionService.name);
  private readonly cookieName =
    this.readEnv('TOURNAMENTS_PUBLIC_SESSION_COOKIE') ?? 'ph_tournament_client';
  private readonly ttlDays = this.readPositiveNumberEnv(
    'TOURNAMENTS_PUBLIC_SESSION_TTL_DAYS',
    30
  );
  private readonly requireRealAuth = this.readBooleanEnv(
    'TOURNAMENTS_PUBLIC_REQUIRE_LK_AUTH',
    true
  );
  private readonly secret =
    this.readEnv('TOURNAMENTS_PUBLIC_SESSION_SECRET')
    ?? this.readEnv('ADMIN_AUTH_SECRET')
    ?? 'dev-insecure-tournament-public-session-secret';
  private readonly authBaseUrl =
    this.normalizeBaseUrl(
      this.readEnv('TOURNAMENTS_PUBLIC_KEYCLOAK_BASE_URL')
      ?? this.readEnv('KEYCLOAK_BASE_URL')
      ?? this.readEnv('VIVA_KEYCLOAK_BASE_URL')
    ) ?? 'https://kc.vivacrm.ru';
  private readonly authRealm = this.readEnv('TOURNAMENTS_PUBLIC_KEYCLOAK_REALM') ?? 'prod';
  private readonly authTenantKey =
    this.readEnv('TOURNAMENTS_PUBLIC_TENANT_KEY')
    ?? this.readEnv('VIVA_END_USER_WIDGET_ID')
    ?? 'iSkq6G';
  private readonly authClientId = this.readEnv('TOURNAMENTS_PUBLIC_AUTH_CLIENT_ID') ?? 'widget';
  private readonly authChannel = this.readEnv('TOURNAMENTS_PUBLIC_AUTH_CHANNEL') ?? 'cascade';
  private readonly authRequestTimeoutMs = this.readPositiveNumberEnv(
    'TOURNAMENTS_PUBLIC_AUTH_TIMEOUT_MS',
    5000
  );

  requiresRealAuth(): boolean {
    return this.requireRealAuth;
  }

  ensureAuthorizedClient(
    request: Request,
    response: Response,
    user?: RequestUser
  ): TournamentPublicClientProfile {
    const session = this.readSessionCookie(request);
    const headerClient = this.resolveHeaderClient(request, user);
    if (headerClient) {
      return this.mergeHeaderClientWithSession(headerClient, session);
    }

    if (session) {
      return this.toClientProfile(
        session,
        'cookie',
        this.requireRealAuth ? false : true
      );
    }

    const created = this.createSessionPayload();
    this.writeSessionCookie(response, request, created);
    return this.toClientProfile(
      created,
      'cookie',
      this.requireRealAuth ? false : true
    );
  }

  rememberClient(
    request: Request,
    response: Response,
    current: TournamentPublicClientProfile,
    patch: {
      name?: string;
      phone?: string;
      levelLabel?: string;
    }
  ): TournamentPublicClientProfile {
    const now = Math.floor(Date.now() / 1000);
    const levelLabel =
      this.normalizeLevel(patch.levelLabel)
      ?? this.normalizeLevel(current.levelLabel)
      ?? undefined;
    const previousPhone = this.normalizePhone(current.phone);
    const nextPhone = this.normalizePhone(patch.phone) ?? previousPhone ?? undefined;
    const payload: TournamentPublicSessionPayload = {
      clientId: String(current.id || '').trim() || `tour-${randomUUID()}`,
      name: this.pickString(patch.name) ?? this.pickString(current.name) ?? undefined,
      phone: nextPhone,
      phoneVerified: current.phoneVerified === true && nextPhone === previousPhone,
      levelLabel,
      subscriptions: current.subscriptions,
      iat: now,
      exp: now + this.ttlDays * 24 * 60 * 60
    };

    this.writeSessionCookie(response, request, payload);

    return {
      id: current.authSource === 'headers' ? current.id : payload.clientId,
      authorized: current.authorized,
      authSource: current.authSource === 'headers' ? 'headers' : 'cookie',
      name: this.pickString(payload.name) ?? undefined,
      phone: this.normalizePhone(payload.phone) ?? undefined,
      phoneVerified: payload.phoneVerified === true,
      levelLabel,
      onboardingCompleted: Boolean(levelLabel),
      subscriptions: this.normalizeSubscriptions(payload.subscriptions)
    };
  }

  async createPhoneCode(
    request: Request,
    response: Response,
    current: TournamentPublicClientProfile,
    phone: unknown
  ): Promise<{ ok: boolean; message: string; phone?: string }> {
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return { ok: false, message: 'Укажите корректный номер телефона.' };
    }

    const sent = await this.requestExternalPhoneCode(normalizedPhone);
    if (!sent) {
      return { ok: false, message: 'Не удалось отправить код. Попробуйте позже.' };
    }

    this.writeSessionCookie(response, request, {
      clientId: current.id,
      name: current.name,
      phone: normalizedPhone,
      phoneVerified: false,
      levelLabel: current.levelLabel,
      subscriptions: current.subscriptions,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.ttlDays * 24 * 60 * 60
    });

    return {
      ok: true,
      message: 'Код подтверждения отправлен.',
      phone: normalizedPhone
    };
  }

  async verifyPhoneCode(
    request: Request,
    response: Response,
    current: TournamentPublicClientProfile,
    phone: unknown,
    code: unknown
  ): Promise<TournamentPublicClientProfile | null> {
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedCode = this.pickString(code)?.replace(/\D+/g, '');
    if (!normalizedPhone || !normalizedCode) {
      return null;
    }

    const authResult = await this.verifyExternalPhoneCode(normalizedPhone, normalizedCode);
    if (!authResult) {
      return null;
    }

    const payload: TournamentPublicSessionPayload = {
      clientId: current.id,
      name: current.name,
      phone: normalizedPhone,
      phoneVerified: true,
      levelLabel: current.levelLabel,
      subscriptions: current.subscriptions,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.ttlDays * 24 * 60 * 60
    };
    this.writeSessionCookie(response, request, payload);
    return this.toClientProfile(payload, 'cookie', true);
  }

  private resolveHeaderClient(
    request: Request,
    user?: RequestUser
  ): TournamentPublicClientProfile | null {
    const resolvedUser = user && user.id !== 'anonymous' ? user : undefined;
    if (!resolvedUser) {
      return null;
    }

    const name =
      this.pickString(request.headers['x-user-name'])
      ?? this.pickString(request.headers['x-user-title'])
      ?? this.pickString(resolvedUser.title)
      ?? this.pickString(resolvedUser.login)
      ?? undefined;
    const phone =
      this.normalizePhone(request.headers['x-user-phone'])
      ?? this.normalizePhone(request.headers['x-user-primary-phone'])
      ?? undefined;
    const levelLabel =
      this.normalizeLevel(request.headers['x-user-level-label'])
      ?? this.normalizeLevel(request.headers['x-user-level'])
      ?? undefined;
    const subscriptions = this.readSubscriptionsHeader(request.headers['x-user-subscriptions']);

    return {
      id: String(resolvedUser.id),
      authorized: true,
      authSource: 'headers',
      name,
      phone,
      phoneVerified: Boolean(phone),
      levelLabel,
      onboardingCompleted: Boolean(levelLabel),
      subscriptions
    };
  }

  private mergeHeaderClientWithSession(
    client: TournamentPublicClientProfile,
    session: TournamentPublicSessionPayload | null
  ): TournamentPublicClientProfile {
    if (!session) {
      return client;
    }

    const name = this.pickString(client.name) ?? this.pickString(session.name) ?? undefined;
    const clientPhone = this.normalizePhone(client.phone);
    const sessionPhone = this.normalizePhone(session.phone);
    const phone = clientPhone ?? sessionPhone ?? undefined;
    const levelLabel =
      this.normalizeLevel(client.levelLabel)
      ?? this.normalizeLevel(session.levelLabel)
      ?? undefined;
    const subscriptions =
      client.subscriptions.length > 0
        ? client.subscriptions
        : this.normalizeSubscriptions(session.subscriptions);

    return {
      ...client,
      name,
      phone,
      phoneVerified: clientPhone ? client.phoneVerified === true : session.phoneVerified === true,
      levelLabel,
      onboardingCompleted: Boolean(levelLabel),
      subscriptions
    };
  }

  private createSessionPayload(): TournamentPublicSessionPayload {
    const now = Math.floor(Date.now() / 1000);
    return {
      clientId: `tour-${randomUUID()}`,
      iat: now,
      exp: now + this.ttlDays * 24 * 60 * 60
    };
  }

  private toClientProfile(
    payload: TournamentPublicSessionPayload,
    authSource: 'cookie' | 'headers' | 'anonymous',
    authorized: boolean
  ): TournamentPublicClientProfile {
    const levelLabel = this.normalizeLevel(payload.levelLabel) ?? undefined;
    return {
      id: payload.clientId,
      authorized,
      authSource,
      name: this.pickString(payload.name) ?? undefined,
      phone: this.normalizePhone(payload.phone) ?? undefined,
      phoneVerified: payload.phoneVerified === true,
      levelLabel,
      onboardingCompleted: Boolean(levelLabel),
      subscriptions: this.normalizeSubscriptions(payload.subscriptions)
    };
  }

  private readSessionCookie(request: Request): TournamentPublicSessionPayload | null {
    const token = this.readCookieValue(request, this.cookieName);
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, encodedSignature] = parts;
    const expectedSignature = this.signRaw(encodedPayload);
    if (!this.safeStringEquals(encodedSignature, expectedSignature)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as
        | TournamentPublicSessionPayload
        | undefined;
      if (!payload?.clientId || typeof payload.exp !== 'number') {
        return null;
      }
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch (_error) {
      return null;
    }
  }

  private readCookieValue(request: Request, name: string): string | null {
    const cookieHeader = String(request.headers.cookie ?? '').trim();
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';');
    for (const entry of cookies) {
      const [cookieName, ...rest] = entry.split('=');
      if (cookieName.trim() !== name) {
        continue;
      }
      const rawValue = rest.join('=').trim();
      if (!rawValue) {
        return null;
      }
      try {
        return decodeURIComponent(rawValue);
      } catch (_error) {
        return rawValue;
      }
    }

    return null;
  }

  private writeSessionCookie(
    response: Response,
    request: Request,
    payload: TournamentPublicSessionPayload
  ): void {
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const token = `${encodedPayload}.${this.signRaw(encodedPayload)}`;
    const maxAgeSeconds = this.ttlDays * 24 * 60 * 60;
    response.append(
      'Set-Cookie',
      [
        `${this.cookieName}=${encodeURIComponent(token)}`,
        `Max-Age=${maxAgeSeconds}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        this.isSecureRequest(request) ? 'Secure' : ''
      ]
        .filter(Boolean)
        .join('; ')
    );
  }

  private signRaw(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private safeStringEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private isSecureRequest(request: Request): boolean {
    if (request.secure) {
      return true;
    }
    const forwarded = String(request.headers['x-forwarded-proto'] ?? '')
      .toLowerCase()
      .trim();
    return forwarded.includes('https');
  }

  private normalizePhone(value: unknown): string | null {
    const text = this.pickString(value);
    if (!text) {
      return null;
    }

    const digits = text.replace(/\D+/g, '');
    if (!digits) {
      return null;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private normalizeLevel(value: unknown): string | null {
    const text = this.pickString(value);
    if (!text) {
      return null;
    }
    return text
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    const normalized = this.pickString(value);
    return normalized ? normalized.replace(/\/+$/, '') : undefined;
  }

  private readSubscriptionsHeader(value: unknown): TournamentClientSubscription[] {
    const raw = this.pickString(value);
    if (!raw) {
      return [];
    }

    try {
      return this.normalizeSubscriptions(JSON.parse(raw));
    } catch (_error) {
      const items = raw
        .split(';')
        .map((entry, index) => {
          const label = this.pickString(entry);
          if (!label) {
            return null;
          }
          return {
            id: `sub-${index + 1}`,
            label,
            remainingUses: 1
          } satisfies TournamentClientSubscription;
        });
      return items.filter(Boolean) as TournamentClientSubscription[];
    }
  }

  private normalizeSubscriptions(value: unknown): TournamentClientSubscription[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const subscriptions: TournamentClientSubscription[] = [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const record = item as Record<string, unknown>;
      const label = this.pickString(record.label) ?? this.pickString(record.name);
      if (!label) {
        return;
      }

      subscriptions.push({
        id:
          this.pickString(record.id)
          ?? this.pickString(record.subscriptionId)
          ?? `sub-${index + 1}`,
        label,
        remainingUses: this.pickPositiveNumber(
          record.remainingUses ?? record.remaining ?? record.uses
        ),
        description: this.pickString(record.description) ?? undefined,
        validUntil: this.pickString(record.validUntil ?? record.expiresAt) ?? undefined,
        compatibleTournamentTypes: this.pickStringArray(
          record.compatibleTournamentTypes ?? record.tournamentTypes
        ),
        compatibleAccessLevels: this.pickStringArray(
          record.compatibleAccessLevels ?? record.accessLevels
        ),
        productType: this.normalizeProductType(record.productType ?? record.type)
      });
    });
    return subscriptions;
  }

  private normalizeProductType(value: unknown): 'SUBSCRIPTION' | 'ONE_TIME' | 'SERVICE' | undefined {
    const normalized = this.pickString(value)?.toUpperCase().replace(/[-\s]+/g, '_');
    return normalized === 'SUBSCRIPTION' || normalized === 'ONE_TIME' || normalized === 'SERVICE'
      ? normalized
      : undefined;
  }

  private async requestExternalPhoneCode(phone: string): Promise<boolean> {
    try {
      const url = new URL(
        `/realms/${encodeURIComponent(this.authRealm)}/sms/authentication-code`,
        `${this.authBaseUrl}/`
      );
      url.searchParams.set('phoneNumber', phone);
      url.searchParams.set('channel', this.authChannel);
      url.searchParams.set('tenantKey', this.authTenantKey);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: this.buildAbortSignal(this.authRequestTimeoutMs)
      });
      if (!response.ok) {
        this.logger.warn(`Phone auth code request failed: ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Phone auth code request failed: ${String(error)}`);
      return false;
    }
  }

  private async verifyExternalPhoneCode(phone: string, code: string): Promise<boolean> {
    try {
      const body = new URLSearchParams();
      body.set('grant_type', 'password');
      body.set('phone_number', phone);
      body.set('code', code);
      body.set('client_id', this.authClientId);
      body.set('tenant_key', this.authTenantKey);

      const url = new URL(
        `/realms/${encodeURIComponent(this.authRealm)}/protocol/openid-connect/token`,
        `${this.authBaseUrl}/`
      );
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString(),
        signal: this.buildAbortSignal(this.authRequestTimeoutMs)
      });
      const payload = (await response.json().catch(() => null)) as PhoneAuthTokenResponse | null;
      if (!response.ok || !payload?.access_token) {
        this.logger.warn(
          `Phone auth token request failed: ${response.status} ${payload?.error ?? ''}`
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Phone auth token request failed: ${String(error)}`);
      return false;
    }
  }

  private buildAbortSignal(timeoutMs: number): AbortSignal | undefined {
    const timeout = (AbortSignal as typeof AbortSignal & {
      timeout?: (delay: number) => AbortSignal;
    }).timeout;
    return typeof timeout === 'function' ? timeout(timeoutMs) : undefined;
  }

  private pickStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const items = value
      .map((item) => this.pickString(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }

  private pickPositiveNumber(value: unknown): number | undefined {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 0) {
      return undefined;
    }
    return numeric;
  }

  private pickString(value: unknown): string | null {
    if (Array.isArray(value)) {
      return this.pickString(value[0]);
    }
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  }

  private readEnv(name: string): string | undefined {
    const value = String(process.env[name] ?? '').trim();
    return value || undefined;
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? '');
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const value = this.readEnv(name);
    if (!value) {
      return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
}
