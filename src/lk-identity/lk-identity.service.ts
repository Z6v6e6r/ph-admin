import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import {
  createPublicKey,
  JsonWebKey,
  timingSafeEqual,
  verify as verifySignature
} from 'crypto';
import { LkIdentityVerificationResult } from './lk-identity.types';

interface JwtParts {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

interface JwksKey extends Record<string, unknown> {
  kid: string;
  kty: 'RSA';
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

interface JwksCache {
  keys: JwksKey[];
  expiresAt: number;
  staleUntil: number;
}

interface TrustedIssuerProfile {
  profileId: 'primary' | 'legacy';
  issuer: string;
  jwksUrl: string;
  expectedAudiences: Set<string>;
  expectedAuthorizedParty: string;
}

type InvalidTokenReason =
  | 'JWT_MALFORMED'
  | 'ALGORITHM_UNSUPPORTED'
  | 'KEY_ID_MISSING'
  | 'ISSUER_UNTRUSTED'
  | 'SIGNING_KEY_NOT_FOUND'
  | 'SIGNATURE_INVALID'
  | 'ISSUER_MISMATCH'
  | 'SUBJECT_MISSING'
  | 'TEMPORAL_CLAIMS_INVALID'
  | 'AUTHORIZED_PARTY_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'TENANT_CLAIMS_INCONSISTENT'
  | 'TENANT_MISMATCH'
  | 'PHONE_CLAIMS_INCONSISTENT'
  | 'PHONE_INVALID'
  | 'CLIENT_ID_CLAIMS_INCONSISTENT';

interface JwksState {
  cache?: JwksCache;
  refreshInFlight?: Promise<JwksKey[]>;
  lastForcedRefreshAt: number;
}

@Injectable()
export class LkIdentityService {
  private static readonly diagnosedFailures = new Set<string>();

  private readonly logger = new Logger(LkIdentityService.name);
  private readonly trustedIssuers = this.createTrustedIssuerProfiles();
  private readonly expectedTenantKey = String(
    process.env.LK_IDENTITY_EXPECTED_TENANT_KEY ?? 'iSkq6G'
  ).trim();
  private readonly integrationToken = String(
    process.env.LK_IDENTITY_INTEGRATION_TOKEN ?? ''
  ).trim();
  private readonly requestTimeoutMs = this.readBoundedNumber(
    'LK_IDENTITY_JWKS_TIMEOUT_MS',
    5000,
    500,
    15000
  );
  private readonly cacheTtlMs = this.readBoundedNumber(
    'LK_IDENTITY_JWKS_CACHE_TTL_MS',
    600_000,
    10_000,
    3_600_000
  );
  private readonly staleGraceMs = this.readBoundedNumber(
    'LK_IDENTITY_JWKS_STALE_GRACE_MS',
    3_600_000,
    0,
    3_600_000
  );
  private readonly forcedRefreshMinIntervalMs = this.readBoundedNumber(
    'LK_IDENTITY_JWKS_FORCE_REFRESH_MIN_INTERVAL_MS',
    60_000,
    1000,
    300_000
  );
  private readonly clockSkewSeconds = this.readBoundedNumber(
    'LK_IDENTITY_CLOCK_SKEW_SECONDS',
    30,
    0,
    120
  );
  private readonly diagnosticsEnabled = this.readBoolean(
    process.env.LK_IDENTITY_DIAGNOSTICS_ENABLED
  ) || this.readBoolean(process.env.LK_IDENTITY_FAILURE_LOG_ENABLED);

  private readonly jwksStates = new Map<string, JwksState>();

  async verify(
    authorizationHeader?: string,
    suppliedIntegrationToken?: string
  ): Promise<LkIdentityVerificationResult> {
    this.assertIntegrationAccess(suppliedIntegrationToken);
    const token = this.extractBearerToken(authorizationHeader);
    const parts = this.decodeJwt(token);
    const algorithm = this.pickString(parts.header.alg);
    const kid = this.pickString(parts.header.kid);
    const issuer = this.pickString(parts.claims.iss);
    const issuerProfile = issuer ? this.trustedIssuers.get(issuer) : undefined;
    if (algorithm !== 'RS256') {
      throw this.invalidToken('ALGORITHM_UNSUPPORTED');
    }
    if (!kid) {
      throw this.invalidToken('KEY_ID_MISSING');
    }
    if (!issuerProfile) {
      throw this.invalidToken('ISSUER_UNTRUSTED');
    }

    const key = await this.resolveSigningKey(issuerProfile, kid);
    let validSignature = false;
    try {
      const keyObject = createPublicKey({
        key: key as unknown as JsonWebKey,
        format: 'jwk'
      });
      validSignature = verifySignature(
        'RSA-SHA256',
        Buffer.from(parts.signingInput),
        keyObject,
        parts.signature
      );
    } catch (_error) {
      throw new ServiceUnavailableException({
        code: 'LK_IDENTITY_JWKS_INVALID',
        message: 'LK identity signing keys are invalid'
      });
    }
    if (!validSignature) {
      throw this.invalidToken('SIGNATURE_INVALID', issuerProfile);
    }

    return this.validateClaims(parts.claims, issuerProfile);
  }

  private assertIntegrationAccess(suppliedToken?: string): void {
    if (Buffer.byteLength(this.integrationToken, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'LK_IDENTITY_NOT_CONFIGURED',
        message: 'LK identity verifier is not configured'
      });
    }
    const supplied = String(suppliedToken ?? '').trim();
    const expectedBuffer = Buffer.from(this.integrationToken);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw new ForbiddenException({
        code: 'LK_IDENTITY_INTEGRATION_FORBIDDEN',
        message: 'LK identity verifier access is forbidden'
      });
    }
  }

  private extractBearerToken(authorizationHeader?: string): string {
    const match = String(authorizationHeader ?? '').trim().match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException({
        code: 'LK_IDENTITY_BEARER_REQUIRED',
        message: 'Bearer token is required'
      });
    }
    return match[1];
  }

  private decodeJwt(token: string): JwtParts {
    const encoded = token.split('.');
    if (encoded.length !== 3 || encoded.some((part) => !part)) {
      throw this.invalidToken('JWT_MALFORMED');
    }
    try {
      const header = this.toRecord(
        JSON.parse(Buffer.from(encoded[0], 'base64url').toString('utf8'))
      );
      const claims = this.toRecord(
        JSON.parse(Buffer.from(encoded[1], 'base64url').toString('utf8'))
      );
      if (!header || !claims) {
        throw new Error('JWT sections must be objects');
      }
      return {
        header,
        claims,
        signingInput: `${encoded[0]}.${encoded[1]}`,
        signature: Buffer.from(encoded[2], 'base64url')
      };
    } catch (_error) {
      throw this.invalidToken('JWT_MALFORMED');
    }
  }

  private async resolveSigningKey(
    profile: TrustedIssuerProfile,
    kid: string
  ): Promise<JwksKey> {
    const state = this.getJwksState(profile.issuer);
    const hadCache = Boolean(state.cache);
    let keys = await this.loadJwks(profile, false);
    let matches = keys.filter((key) => key.kid === kid);
    if (matches.length === 0 && hadCache) {
      keys = await this.loadJwks(profile, true);
      matches = keys.filter((key) => key.kid === kid);
    }
    if (matches.length !== 1) {
      throw this.invalidToken('SIGNING_KEY_NOT_FOUND', profile);
    }
    return matches[0];
  }

  private async loadJwks(
    profile: TrustedIssuerProfile,
    forceRefresh: boolean
  ): Promise<JwksKey[]> {
    const state = this.getJwksState(profile.issuer);
    const now = Date.now();
    if (!forceRefresh && state.cache && state.cache.expiresAt > now) {
      return state.cache.keys;
    }
    if (state.refreshInFlight) {
      return state.refreshInFlight;
    }
    if (
      forceRefresh
      && state.cache
      && now - state.lastForcedRefreshAt < this.forcedRefreshMinIntervalMs
    ) {
      return state.cache.keys;
    }
    if (forceRefresh) {
      state.lastForcedRefreshAt = now;
    }

    state.refreshInFlight = this.fetchJwks(profile, state).catch((error) => {
      if (!forceRefresh && state.cache && state.cache.staleUntil > Date.now()) {
        return state.cache.keys;
      }
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'LK_IDENTITY_JWKS_UNAVAILABLE',
        message: 'LK identity signing keys are unavailable'
      });
    }).finally(() => {
      state.refreshInFlight = undefined;
    });
    return state.refreshInFlight;
  }

  private async fetchJwks(
    profile: TrustedIssuerProfile,
    state: JwksState
  ): Promise<JwksKey[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(profile.jwksUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`JWKS responded with ${response.status}`);
      }
      const record = this.toRecord(payload);
      const keys = Array.isArray(record?.keys)
        ? record.keys.filter((value): value is JwksKey => this.isUsableJwksKey(value))
        : [];
      if (keys.length === 0) {
        throw new Error('JWKS has no usable RS256 keys');
      }
      const now = Date.now();
      state.cache = {
        keys,
        expiresAt: now + this.cacheTtlMs,
        staleUntil: now + this.cacheTtlMs + this.staleGraceMs
      };
      return keys;
    } catch (_error) {
      throw new ServiceUnavailableException({
        code: 'LK_IDENTITY_JWKS_UNAVAILABLE',
        message: 'LK identity signing keys are unavailable'
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private isUsableJwksKey(value: unknown): value is JwksKey {
    const key = this.toRecord(value);
    if (!key) return false;
    const use = this.pickString(key.use);
    const alg = this.pickString(key.alg);
    return this.pickString(key.kty) === 'RSA'
      && Boolean(this.pickString(key.kid))
      && Boolean(this.pickString(key.n))
      && Boolean(this.pickString(key.e))
      && (!use || use === 'sig')
      && (!alg || alg === 'RS256');
  }

  private validateClaims(
    claims: Record<string, unknown>,
    profile: TrustedIssuerProfile
  ): LkIdentityVerificationResult {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuer = this.pickString(claims.iss);
    const subject = this.pickString(claims.sub);
    const expiresAt = this.pickInteger(claims.exp);
    const hasNotBefore = Object.prototype.hasOwnProperty.call(claims, 'nbf');
    const notBefore = hasNotBefore ? this.pickInteger(claims.nbf) : undefined;
    const issuedAt = this.pickInteger(claims.iat);
    const authorizedParty = this.pickString(claims.azp);
    const audience = this.resolveAudience(claims.aud);

    if (!issuer || issuer !== profile.issuer) {
      throw this.invalidToken('ISSUER_MISMATCH', profile);
    }
    if (!subject) {
      throw this.invalidToken('SUBJECT_MISSING', profile);
    }
    if (
      expiresAt === undefined
      || expiresAt <= nowSeconds - this.clockSkewSeconds
      || issuedAt === undefined
      || expiresAt <= issuedAt
      || expiresAt > 8_640_000_000_000
      || (hasNotBefore && notBefore === undefined)
      || (notBefore !== undefined && notBefore > nowSeconds + this.clockSkewSeconds)
      || issuedAt > nowSeconds + this.clockSkewSeconds
    ) {
      throw this.invalidToken('TEMPORAL_CLAIMS_INVALID', profile);
    }
    if (authorizedParty !== profile.expectedAuthorizedParty) {
      throw this.invalidToken('AUTHORIZED_PARTY_MISMATCH', profile);
    }
    if (!audience.some((value) => profile.expectedAudiences.has(value))) {
      throw this.invalidToken('AUDIENCE_MISMATCH', profile);
    }

    const tenantKey = this.resolveConsistentString([
      claims.tenantKey,
      claims.tenant_key,
      claims.tenant
    ], 'TENANT_CLAIMS_INCONSISTENT', profile);
    const client = this.toRecord(claims.client);
    const phoneNorm = this.resolveConsistentPhone([
      claims.phone_number,
      claims.phone,
      claims.mobile,
      this.normalizePhone(claims.preferred_username) ? claims.preferred_username : undefined,
      client?.phone_number,
      client?.phone,
      client?.mobile
    ], profile);
    const clientId = this.resolveConsistentString([
      claims.clientId,
      claims.client_id,
      claims.vivaClientId,
      claims.viva_client_id,
      client?.id,
      client?.clientId
    ], 'CLIENT_ID_CLAIMS_INCONSISTENT', profile);
    if (tenantKey !== this.expectedTenantKey) {
      throw this.invalidToken('TENANT_MISMATCH', profile);
    }
    if (!phoneNorm) {
      throw this.invalidToken('PHONE_INVALID', profile);
    }

    const preferredUsername = this.pickString(claims.preferred_username);
    const name = this.pickString(
      claims.name
        ?? claims.full_name
        ?? (this.normalizePhone(preferredUsername) ? undefined : preferredUsername)
    );
    return {
      ok: true,
      actor: {
        subject,
        ...(clientId ? { clientId } : {}),
        phoneNorm,
        ...(name ? { name: name.slice(0, 240) } : {}),
        tenantKey,
        authorizedParty,
        verified: true,
        source: 'cup-keycloak-jwt'
      },
      token: {
        expiresAt: new Date(expiresAt * 1000).toISOString()
      }
    };
  }

  private resolveConsistentString(
    values: unknown[],
    reason: InvalidTokenReason,
    profile: TrustedIssuerProfile
  ): string | undefined {
    const normalized = values
      .map((value) => this.pickString(value))
      .filter((value): value is string => Boolean(value));
    if (new Set(normalized).size > 1) {
      throw this.invalidToken(reason, profile);
    }
    return normalized[0];
  }

  private resolveConsistentPhone(
    values: unknown[],
    profile: TrustedIssuerProfile
  ): string | undefined {
    const present = values.filter((value) => this.pickString(value) !== undefined);
    const normalized = present.map((value) => this.normalizePhone(value));
    if (normalized.some((value) => !value)) {
      throw this.invalidToken('PHONE_INVALID', profile);
    }
    const phones = normalized.filter((value): value is string => Boolean(value));
    if (new Set(phones).size > 1) {
      throw this.invalidToken('PHONE_CLAIMS_INCONSISTENT', profile);
    }
    return phones[0];
  }

  private resolveAudience(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [value];
    if (raw.length === 0 || raw.some((item) => typeof item !== 'string' || !item.trim())) {
      return [];
    }
    return raw.map((item) => String(item).trim());
  }

  private normalizePhone(value: unknown): string | undefined {
    const digits = String(value ?? '').replace(/\D/g, '');
    const normalized = digits.length === 10
      ? `7${digits}`
      : digits.length === 11 && digits.startsWith('8')
        ? `7${digits.slice(1)}`
        : digits;
    return /^7\d{10}$/.test(normalized) ? normalized : undefined;
  }

  private invalidToken(
    reason: InvalidTokenReason,
    profile?: TrustedIssuerProfile
  ): UnauthorizedException {
    this.logInvalidTokenReason(reason, profile?.profileId ?? 'unresolved');
    return new UnauthorizedException({
      code: 'LK_IDENTITY_TOKEN_INVALID',
      message: 'LK auth token is invalid'
    });
  }

  private logInvalidTokenReason(
    reason: InvalidTokenReason,
    issuerProfile: TrustedIssuerProfile['profileId'] | 'unresolved'
  ): void {
    if (!this.diagnosticsEnabled) return;
    const diagnosticKey = `${issuerProfile}:${reason}`;
    if (LkIdentityService.diagnosedFailures.has(diagnosticKey)) return;
    LkIdentityService.diagnosedFailures.add(diagnosticKey);
    this.logger.warn(JSON.stringify({
      type: 'lk_identity_token_rejected',
      reason,
      issuerProfile
    }));
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private pickString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  }

  private pickInteger(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number.NaN;
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  private normalizeUrl(value: string): string {
    return String(value ?? '').trim().replace(/\/+$/, '');
  }

  private createTrustedIssuerProfiles(): Map<string, TrustedIssuerProfile> {
    const primaryIssuer = this.normalizeUrl(
      process.env.LK_IDENTITY_KEYCLOAK_ISSUER
        ?? 'https://kc.vivacrm.ru/realms/clients'
    );
    const primaryProfile: TrustedIssuerProfile = {
      profileId: 'primary',
      issuer: primaryIssuer,
      jwksUrl: String(
        process.env.LK_IDENTITY_KEYCLOAK_JWKS_URL
          ?? `${primaryIssuer}/protocol/openid-connect/certs`
      ).trim(),
      expectedAudiences: this.readExpectedAudiences(
        process.env.LK_IDENTITY_EXPECTED_AUDIENCES
          ?? `${process.env.LK_IDENTITY_EXPECTED_AUDIENCE ?? 'widget'},account`
      ),
      expectedAuthorizedParty: String(
        process.env.LK_IDENTITY_EXPECTED_AUTHORIZED_PARTY ?? 'widget'
      ).trim()
    };
    const legacyIssuer = this.normalizeUrl(
      process.env.LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER
        ?? 'https://kc.vivacrm.ru/realms/prod'
    );
    const profiles = [primaryProfile];
    if (legacyIssuer) {
      profiles.push({
        profileId: 'legacy',
        issuer: legacyIssuer,
        jwksUrl: String(
          process.env.LK_IDENTITY_LEGACY_KEYCLOAK_JWKS_URL
            ?? `${legacyIssuer}/protocol/openid-connect/certs`
        ).trim(),
        expectedAudiences: this.readExpectedAudiences(
          process.env.LK_IDENTITY_LEGACY_EXPECTED_AUDIENCES
            ?? (process.env.LK_IDENTITY_LEGACY_EXPECTED_AUDIENCE
              ? `${process.env.LK_IDENTITY_LEGACY_EXPECTED_AUDIENCE},account`
              : undefined)
            ?? 'widget,account'
        ),
        expectedAuthorizedParty: String(
          process.env.LK_IDENTITY_LEGACY_EXPECTED_AUTHORIZED_PARTY
            ?? primaryProfile.expectedAuthorizedParty
        ).trim()
      });
    }
    if (profiles.some((profile) => (
      !profile.issuer
      || !profile.jwksUrl
      || profile.expectedAudiences.size === 0
      || !profile.expectedAuthorizedParty
    ))) {
      throw new Error('LK identity issuer profile is incomplete');
    }
    const trustedIssuers = new Map(
      profiles.map((profile) => [profile.issuer, profile] as const)
    );
    if (trustedIssuers.size !== profiles.length) {
      throw new Error('LK identity issuer profiles must be unique');
    }
    return trustedIssuers;
  }

  private readExpectedAudiences(value: string): Set<string> {
    return new Set(
      String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  private getJwksState(issuer: string): JwksState {
    const current = this.jwksStates.get(issuer);
    if (current) return current;
    const created: JwksState = { lastForcedRefreshAt: 0 };
    this.jwksStates.set(issuer, created);
    return created;
  }

  private readBoolean(value: unknown): boolean {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
  }

  private readBoundedNumber(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number
  ): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
  }
}
