import { Injectable } from '@nestjs/common';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { RequestUser } from '../common/rbac/request-user.interface';
import { TournamentPublicClientProfile } from './tournaments.types';

interface TournamentPublicSessionPayload {
  clientId: string;
  name?: string;
  phone?: string;
  levelLabel?: string;
  iat: number;
  exp: number;
}

@Injectable()
export class TournamentsPublicSessionService {
  private readonly cookieName =
    this.readEnv('TOURNAMENTS_PUBLIC_SESSION_COOKIE') ?? 'ph_tournament_client';
  private readonly ttlDays = this.readPositiveNumberEnv(
    'TOURNAMENTS_PUBLIC_SESSION_TTL_DAYS',
    30
  );
  private readonly requireRealAuth = this.readBooleanEnv(
    'TOURNAMENTS_PUBLIC_REQUIRE_LK_AUTH',
    false
  );
  private readonly secret =
    this.readEnv('TOURNAMENTS_PUBLIC_SESSION_SECRET')
    ?? this.readEnv('ADMIN_AUTH_SECRET')
    ?? 'dev-insecure-tournament-public-session-secret';

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
    const payload: TournamentPublicSessionPayload = {
      clientId: String(current.id || '').trim() || `tour-${randomUUID()}`,
      name: this.pickString(patch.name) ?? this.pickString(current.name) ?? undefined,
      phone: this.normalizePhone(patch.phone) ?? this.normalizePhone(current.phone) ?? undefined,
      levelLabel,
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
      levelLabel,
      onboardingCompleted: Boolean(levelLabel)
    };
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

    return {
      id: String(resolvedUser.id),
      authorized: true,
      authSource: 'headers',
      name,
      phone,
      levelLabel,
      onboardingCompleted: Boolean(levelLabel)
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
    const phone = this.normalizePhone(client.phone) ?? this.normalizePhone(session.phone) ?? undefined;
    const levelLabel =
      this.normalizeLevel(client.levelLabel)
      ?? this.normalizeLevel(session.levelLabel)
      ?? undefined;

    return {
      ...client,
      name,
      phone,
      levelLabel,
      onboardingCompleted: Boolean(levelLabel)
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
      levelLabel,
      onboardingCompleted: Boolean(levelLabel)
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
