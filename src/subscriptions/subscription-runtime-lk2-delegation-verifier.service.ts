import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject
} from 'node:crypto';
import {
  ManagedSubscriptionRuntimeV1QuoteRequest,
  validateManagedSubscriptionRuntimeV1QuoteRequest
} from './subscription-runtime-contracts';
import { TrustedSubscriptionRuntimeActor } from './subscription-runtime-trusted-actor';
import { SubscriptionsRepository } from './subscriptions.repository';

const DELEGATION_TYP = 'phub-subscription-runtime-actor-delegation+jwt';
const DELEGATION_SCOPE = 'subscription-runtime.quote';
const TOKEN_PATTERN = /^[!-~]{32,4096}$/;
const HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const KID_PATTERN = /^[A-Za-z0-9._:-]{3,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ALLOWED_ACTIONS = new Set(['CREATE_GAME', 'JOIN_GAME']);
const REQUIRED_CLAIM_KEYS = [
  'iss',
  'aud',
  'sub',
  'iat',
  'nbf',
  'exp',
  'jti',
  'contract_version',
  'scope',
  'tenant_id',
  'tenant_key',
  'sid',
  'provider',
  'provider_client_id',
  'provider_mapping_id',
  'action',
  'correlation_id',
  'request_sha256',
  'idempotency_key_sha256'
] as const;

interface DelegationHeader {
  alg: 'RS256';
  typ: typeof DELEGATION_TYP;
  kid: string;
}

interface DelegationClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  contract_version: 1;
  scope: typeof DELEGATION_SCOPE;
  tenant_id: string;
  tenant_key: string;
  sid: string;
  provider: 'VIVA';
  provider_client_id: string;
  provider_mapping_id: string;
  action: 'CREATE_GAME' | 'JOIN_GAME';
  correlation_id: string;
  request_sha256: string;
  idempotency_key_sha256: string;
}

interface TenantBinding {
  lk2TenantId: string;
  runtimeTenantId: string;
}

interface ParsedDelegation {
  header: DelegationHeader;
  claims: DelegationClaims;
  signingInput: string;
  signature: Buffer;
}

export function computeSubscriptionRuntimeQuoteRequestHash(
  request: ManagedSubscriptionRuntimeV1QuoteRequest
): string {
  validateManagedSubscriptionRuntimeV1QuoteRequest(request);
  const canonical = {
    contractVersion: 1,
    action: request.action,
    target: {
      kind: request.target.kind,
      id: request.target.id,
      expectedRevision: request.target.expectedRevision ?? null
    },
    preferredSubscriptionInstanceId: request.preferredSubscriptionInstanceId ?? null,
    paymentIntent: request.paymentIntent
  };
  return `sha256:${createHash('sha256')
    .update(`subscription-runtime-quote:v1\0${JSON.stringify(canonical)}`, 'utf8')
    .digest('hex')}`;
}

export function computeSubscriptionRuntimeIdempotencyKeyHash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

@Injectable()
export class SubscriptionRuntimeLk2DelegationVerifierService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async verify(input: {
    authorization?: string;
    actorDelegation?: string;
    integrationToken?: string;
    request: ManagedSubscriptionRuntimeV1QuoteRequest;
    correlationId?: string;
    idempotencyKey?: string;
    contractVersion?: string;
  }): Promise<TrustedSubscriptionRuntimeActor> {
    this.assertEnabled();
    this.assertIntegrationToken(input.integrationToken);
    if (input.authorization !== undefined) this.invalid();
    const correlationId = String(input.correlationId ?? '');
    const idempotencyKey = String(input.idempotencyKey ?? '');
    if (!HEADER_PATTERN.test(correlationId)
      || !HEADER_PATTERN.test(idempotencyKey)
      || input.contractVersion !== '1') {
      this.invalid();
    }
    const request = {
      ...input.request,
      target: { ...input.request.target }
    } as ManagedSubscriptionRuntimeV1QuoteRequest;
    validateManagedSubscriptionRuntimeV1QuoteRequest(request);

    const parsed = this.parse(String(input.actorDelegation ?? ''));
    const key = this.resolveKey(parsed.header.kid);
    if (!verifySignature(
      'RSA-SHA256',
      Buffer.from(parsed.signingInput, 'utf8'),
      key,
      parsed.signature
    )) this.invalid();

    const claims = parsed.claims;
    this.assertClaims(claims, request, correlationId, idempotencyKey);
    const binding = this.tenantBinding(claims.tenant_key);
    const runtimeTenantId = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (claims.tenant_id !== binding.lk2TenantId
      || binding.runtimeTenantId !== runtimeTenantId) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_DELEGATION_TENANT_UNMAPPED',
        message: 'Subscription runtime delegation tenant is not mapped'
      });
    }

    await this.repository.connect();
    const consumedAt = this.now();
    const replayRetentionSeconds = this.integerEnv(
      'SUBSCRIPTIONS_RUNTIME_LK2_REPLAY_RETENTION_SECONDS',
      300,
      60,
      3_600
    );
    const replay = await this.repository.consumeRuntimeDelegationReplay({
      issuer: claims.iss,
      jti: claims.jti,
      expiresAt: new Date(Math.max(
        (claims.exp + replayRetentionSeconds) * 1000,
        consumedAt.getTime() + replayRetentionSeconds * 1000
      )),
      consumedAt
    });
    if (replay === 'REPLAY') {
      throw new UnauthorizedException({
        code: 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_REPLAYED',
        message: 'Subscription runtime delegation was already used'
      });
    }

    const verifiedAt = this.now().toISOString();
    const evidenceHash = createHash('sha256')
      .update(['subscription-runtime-lk2-delegation:v1', claims.iss, claims.jti].join('\0'))
      .digest('hex');
    return {
      source: 'LK2_DELEGATION',
      runtimeTenantId: binding.runtimeTenantId,
      actorUserId: claims.sub,
      provider: 'VIVA',
      providerClientId: claims.provider_client_id,
      evidenceRef: `evidence:lk2-delegation:${evidenceHash}`,
      verifiedAt
    };
  }

  protected now(): Date {
    return new Date();
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED')
      || !this.flag('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_DISABLED',
        message: 'Subscription runtime LK2 delegation is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedValue?: string): void {
    const expected = String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN ?? '').trim();
    const supplied = String(suppliedValue ?? '').trim();
    if (!TOKEN_PATTERN.test(expected)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_NOT_CONFIGURED',
        message: 'Subscription runtime LK2 integration is not configured'
      });
    }
    if (!TOKEN_PATTERN.test(supplied)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_FORBIDDEN',
        message: 'Subscription runtime LK2 integration is forbidden'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_FORBIDDEN',
        message: 'Subscription runtime LK2 integration is forbidden'
      });
    }
  }

  private parse(token: string): ParsedDelegation {
    if (!TOKEN_PATTERN.test(token) || token.length > 8192) this.invalid();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) this.invalid();
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as unknown;
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
      if (!this.record(header) || !this.record(claims)) this.invalid();
      if (!this.exactKeys(header, ['alg', 'typ', 'kid'])
        || header.alg !== 'RS256'
        || header.typ !== DELEGATION_TYP
        || typeof header.kid !== 'string'
        || !KID_PATTERN.test(header.kid)) this.invalid();
      if (!this.exactKeys(claims, REQUIRED_CLAIM_KEYS)) this.invalid();
      return {
        header: header as unknown as DelegationHeader,
        claims: claims as unknown as DelegationClaims,
        signingInput: `${parts[0]}.${parts[1]}`,
        signature: Buffer.from(parts[2], 'base64url')
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.invalid();
    }
  }

  private resolveKey(kid: string): KeyObject {
    const expectedIssuer = String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER ?? '').trim();
    const expectedAudience = String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE ?? '').trim();
    if (!expectedIssuer || !expectedAudience) this.notConfigured();
    let value: unknown;
    try {
      value = JSON.parse(String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON ?? ''));
    } catch {
      this.notConfigured();
    }
    if (!this.record(value) || !Array.isArray(value.keys)) this.notConfigured();
    const matches = value.keys.filter((item): item is JsonWebKey & { kid: string } =>
      this.record(item)
      && item.kid === kid
      && item.kty === 'RSA'
      && item.alg === 'RS256'
      && item.use === 'sig'
      && typeof item.n === 'string'
      && typeof item.e === 'string'
      && this.exactKeys(item, ['kty', 'kid', 'alg', 'use', 'n', 'e'])
    );
    if (matches.length !== 1) this.invalid();
    try {
      const key = createPublicKey({ key: matches[0], format: 'jwk' });
      if (key.asymmetricKeyType !== 'rsa'
        || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) this.invalid();
      return key;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.notConfigured();
    }
  }

  private assertClaims(
    claims: DelegationClaims,
    request: ManagedSubscriptionRuntimeV1QuoteRequest,
    correlationId: string,
    idempotencyKey: string
  ): void {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const expectedIssuer = String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER ?? '').trim();
    const expectedAudience = String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE ?? '').trim();
    const maxTtl = this.integerEnv('SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS', 60, 10, 60);
    const skew = this.integerEnv('SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS', 5, 0, 5);
    if (claims.iss !== expectedIssuer
      || claims.aud !== expectedAudience
      || !UUID_PATTERN.test(claims.sub)
      || !UUID_PATTERN.test(claims.tenant_id)
      || !UUID_PATTERN.test(claims.sid)
      || !UUID_PATTERN.test(claims.jti)
      || !UUID_PATTERN.test(claims.provider_mapping_id)
      || claims.contract_version !== 1
      || claims.scope !== DELEGATION_SCOPE
      || claims.provider !== 'VIVA'
      || !ID_PATTERN.test(claims.provider_client_id)
      || !ID_PATTERN.test(claims.tenant_key)
      || !ALLOWED_ACTIONS.has(claims.action)
      || claims.action !== request.action
      || !Number.isSafeInteger(claims.iat)
      || !Number.isSafeInteger(claims.nbf)
      || !Number.isSafeInteger(claims.exp)
      || claims.nbf !== claims.iat
      || claims.iat > nowSeconds + skew
      || claims.exp <= nowSeconds
      || claims.exp <= claims.iat
      || claims.exp - claims.iat > maxTtl
      || claims.correlation_id !== correlationId
      || claims.request_sha256 !== computeSubscriptionRuntimeQuoteRequestHash(request)
      || claims.idempotency_key_sha256 !== computeSubscriptionRuntimeIdempotencyKeyHash(idempotencyKey)
      || !SHA256_PATTERN.test(claims.request_sha256)
      || !SHA256_PATTERN.test(claims.idempotency_key_sha256)) {
      this.invalid();
    }
  }

  private tenantBinding(tenantKey: string): TenantBinding {
    let value: unknown;
    try {
      value = JSON.parse(String(process.env.SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON ?? ''));
    } catch {
      this.notConfigured();
    }
    if (!this.record(value)) this.notConfigured();
    const binding = value[tenantKey];
    if (!this.record(binding)
      || !this.exactKeys(binding, ['lk2TenantId', 'runtimeTenantId'])
      || typeof binding.lk2TenantId !== 'string'
      || !UUID_PATTERN.test(binding.lk2TenantId)
      || typeof binding.runtimeTenantId !== 'string'
      || !ID_PATTERN.test(binding.runtimeTenantId)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_DELEGATION_TENANT_UNMAPPED',
        message: 'Subscription runtime delegation tenant is not mapped'
      });
    }
    return binding as unknown as TenantBinding;
  }

  private integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = String(process.env[name] ?? '').trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      this.notConfigured();
    }
    return value;
  }

  private exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);
  }

  private record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }

  private invalid(): never {
    throw new UnauthorizedException({
      code: 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID',
      message: 'Subscription runtime LK2 delegation is invalid'
    });
  }

  private notConfigured(): never {
    throw new ServiceUnavailableException({
      code: 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_NOT_CONFIGURED',
      message: 'Subscription runtime LK2 delegation is not configured'
    });
  }
}
