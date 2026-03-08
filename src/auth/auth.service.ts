import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { resolveRequestUser } from '../common/rbac/request-user.util';
import { AuthLoginResult, AuthResolvedUser, AdminUserConfig } from './auth.types';

interface TokenPayload {
  sub: string;
  login: string;
  roles: Role[];
  stationIds: string[];
  iat: number;
  exp: number;
  typ: 'admin';
}

interface AdminUserRecord {
  id: string;
  login: string;
  password: string;
  roles: Role[];
  stationIds: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authEnabled = this.readBooleanEnv('ADMIN_AUTH_ENABLED', true);
  private readonly requireStaffToken = this.readBooleanEnv(
    'ADMIN_AUTH_REQUIRE_STAFF_TOKEN',
    true
  );
  private readonly tokenTtlHours = this.readNumberEnv('ADMIN_AUTH_TTL_HOURS', 12);
  private readonly secret =
    String(process.env.ADMIN_AUTH_SECRET ?? '').trim() || 'dev-insecure-admin-auth-secret';
  private readonly usersByLogin = this.loadUsers();

  isEnabled(): boolean {
    return this.authEnabled;
  }

  shouldRequireStaffToken(): boolean {
    return this.authEnabled && this.requireStaffToken;
  }

  hasStaffRole(roles: Role[]): boolean {
    return roles.some((role) => STAFF_ROLES.includes(role));
  }

  login(login: string, password: string): AuthLoginResult {
    if (!this.authEnabled) {
      throw new UnauthorizedException('Auth is disabled');
    }

    const normalizedLogin = login.trim().toLowerCase();
    const user = this.usersByLogin.get(normalizedLogin);
    if (!user || !this.passwordsEqual(password, user.password)) {
      throw new UnauthorizedException('Invalid login or password');
    }

    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.tokenTtlHours * 60 * 60;
    const payload: TokenPayload = {
      sub: user.id,
      login: user.login,
      roles: user.roles,
      stationIds: user.stationIds,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
      typ: 'admin'
    };

    const accessToken = this.signToken(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      user: {
        id: user.id,
        roles: user.roles,
        stationIds: user.stationIds,
        authSource: 'token'
      }
    };
  }

  resolveUserFromRequest(
    request: Request,
    options: { allowHeaderFallback?: boolean } = {}
  ): AuthResolvedUser {
    const token = this.extractToken(request);
    if (token) {
      const user = this.verifyToken(token);
      if (user) {
        return { user: { ...user, authSource: 'token' }, source: 'token' };
      }
    }

    if (options.allowHeaderFallback === false) {
      return { source: 'anonymous' };
    }

    const headerUser = resolveRequestUser(request.headers);
    if (headerUser.id !== 'anonymous' || headerUser.roles.length > 0) {
      return {
        user: { ...headerUser, authSource: 'headers' },
        source: 'headers'
      };
    }

    return {
      user: { ...headerUser, authSource: 'anonymous' },
      source: 'anonymous'
    };
  }

  buildAuthCookie(accessToken: string, secure: boolean): string {
    const maxAgeSeconds = this.tokenTtlHours * 60 * 60;
    return [
      `phab_admin_token=${encodeURIComponent(accessToken)}`,
      `Max-Age=${maxAgeSeconds}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      secure ? 'Secure' : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  buildClearAuthCookie(secure: boolean): string {
    return [
      'phab_admin_token=',
      'Max-Age=0',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      secure ? 'Secure' : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  private verifyToken(token: string): RequestUser | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signedPart = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = this.signRaw(signedPart);

    if (!this.safeStringEquals(encodedSignature, expectedSignature)) {
      return null;
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch (_error) {
      return null;
    }

    if (!payload || payload.typ !== 'admin') {
      return null;
    }
    if (!payload.sub || !Array.isArray(payload.roles) || !Array.isArray(payload.stationIds)) {
      return null;
    }
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    const roles = payload.roles.filter((role): role is Role =>
      (Object.values(Role) as string[]).includes(role)
    );

    return {
      id: String(payload.sub),
      roles,
      stationIds: payload.stationIds
        .map((stationId) => String(stationId).trim())
        .filter((stationId) => stationId.length > 0)
    };
  }

  private signToken(payload: TokenPayload): string {
    const encodedHeader = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      'utf8'
    ).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signedPart = `${encodedHeader}.${encodedPayload}`;
    const signature = this.signRaw(signedPart);
    return `${signedPart}.${signature}`;
  }

  private signRaw(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private extractToken(request: Request): string | null {
    const authorization = request.headers.authorization;
    if (authorization) {
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return null;
    }
    const cookies = cookieHeader.split(';');
    for (const entry of cookies) {
      const [name, ...rest] = entry.split('=');
      if (name.trim() !== 'phab_admin_token') {
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

  private loadUsers(): Map<string, AdminUserRecord> {
    if (!this.authEnabled) {
      return new Map();
    }

    const users = this.parseUsers();
    if (users.length === 0) {
      if (this.authEnabled && process.env.NODE_ENV === 'production') {
        throw new Error('ADMIN_AUTH_ENABLED=true but ADMIN_AUTH_USERS_JSON is empty');
      }

      const fallbackUser: AdminUserRecord = {
        id: 'superadmin-local',
        login: 'admin',
        password: 'admin12345',
        roles: [Role.SUPER_ADMIN],
        stationIds: []
      };
      this.logger.warn(
        'Using default admin credentials login=admin password=admin12345. Configure ADMIN_AUTH_USERS_JSON.'
      );
      return new Map([[fallbackUser.login, fallbackUser]]);
    }

    const map = new Map<string, AdminUserRecord>();
    for (const user of users) {
      map.set(user.login.toLowerCase(), user);
    }
    return map;
  }

  private parseUsers(): AdminUserRecord[] {
    const raw = String(process.env.ADMIN_AUTH_USERS_JSON ?? '').trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as AdminUserConfig[];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry, index) => {
          const login = String(entry?.login ?? '').trim();
          const password = String(entry?.password ?? '').trim();
          const id = String(entry?.id ?? `admin-${index + 1}`).trim() || `admin-${index + 1}`;
          const roles = this.parseRoles(entry?.roles ?? []);
          const stationIds = Array.isArray(entry?.stationIds)
            ? entry.stationIds
                .map((stationId) => String(stationId).trim())
                .filter((stationId) => stationId.length > 0)
            : [];

          if (!login || !password || roles.length === 0) {
            return null;
          }

          return {
            id,
            login: login.toLowerCase(),
            password,
            roles,
            stationIds: Array.from(new Set(stationIds))
          } satisfies AdminUserRecord;
        })
        .filter((entry): entry is AdminUserRecord => entry !== null);
    } catch (error) {
      this.logger.error(`Invalid ADMIN_AUTH_USERS_JSON: ${String(error)}`);
      return [];
    }
  }

  private parseRoles(rawRoles: unknown[]): Role[] {
    if (!Array.isArray(rawRoles)) {
      return [];
    }

    const roles = rawRoles
      .map((role) => String(role).trim().toUpperCase())
      .filter((role): role is Role => (Object.values(Role) as string[]).includes(role));

    return Array.from(new Set(roles));
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = String(process.env[name] ?? '').trim().toLowerCase();
    if (!raw) {
      return fallback;
    }
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private readNumberEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private passwordsEqual(left: string, right: string): boolean {
    return this.safeStringEquals(left, right);
  }

  private safeStringEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}
