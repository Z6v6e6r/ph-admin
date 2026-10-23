import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * Verifies the short-lived, single-use actor delegation that LK2 mints for the
 * server-to-server managed-subscription quote.
 *
 * The wire contract is owned by LK2 (`SubscriptionRuntimeActorDelegationIssuer`): compact RS256
 * JWS, `typ=phub-subscription-runtime-actor-delegation+jwt`, scope `subscription-runtime.quote`,
 * actor/tenant/session/provider claims, request digest and idempotency-key digest. CUP trusts only
 * the configured recipient public keys and re-derives every digest from the actual request, so a
 * caller cannot replay a valid token for a different target, action or idempotency key.
 */
export const LK2_QUOTE_DELEGATION_TYP = 'phub-subscription-runtime-actor-delegation+jwt';
export const LK2_QUOTE_DELEGATION_SCOPE = 'subscription-runtime.quote';
export const LK2_QUOTE_CONTRACT_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{3,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PRINTABLE_ASCII = /^[!-~]+$/;

const PAYLOAD_KEYS = [
  'aud',
  'contract_version',
  'correlation_id',
  'exp',
  'iat',
  'idempotency_key_sha256',
  'iss',
  'jti',
  'nbf',
  'provider',
  'provider_client_id',
  'provider_mapping_id',
  'request_sha256',
  'scope',
  'sid',
  'sub',
  'tenant_id',
  'tenant_key',
  'action',
] as const;

export type Lk2QuoteDelegationErrorCode =
  | 'LK2_DELEGATION_CONFIGURATION_INVALID'
  | 'LK2_DELEGATION_TOKEN_INVALID'
  | 'LK2_DELEGATION_KEY_UNKNOWN'
  | 'LK2_DELEGATION_SIGNATURE_INVALID'
  | 'LK2_DELEGATION_EXPIRED'
  | 'LK2_DELEGATION_NOT_YET_VALID'
  | 'LK2_DELEGATION_TTL_INVALID'
  | 'LK2_DELEGATION_AUDIENCE_MISMATCH'
  | 'LK2_DELEGATION_ISSUER_MISMATCH'
  | 'LK2_DELEGATION_SCOPE_INVALID'
  | 'LK2_DELEGATION_TENANT_MISMATCH'
  | 'LK2_DELEGATION_ACTION_MISMATCH'
  | 'LK2_DELEGATION_REQUEST_DIGEST_MISMATCH'
  | 'LK2_DELEGATION_IDEMPOTENCY_DIGEST_MISMATCH'
  | 'LK2_DELEGATION_CORRELATION_MISMATCH';

export class Lk2QuoteDelegationError extends Error {
  public constructor(
    public readonly code: Lk2QuoteDelegationErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'Lk2QuoteDelegationError';
  }
}

export interface Lk2QuoteRequestForDigest {
  readonly action: 'CREATE_GAME' | 'JOIN_GAME';
  readonly target: {
    readonly kind: 'GAME';
    readonly id: string;
    readonly expectedRevision?: number;
  };
  readonly preferredSubscriptionInstanceId?: string;
  readonly paymentIntent: 'AUTO_BEST_PRICE' | 'PAY_FULL_PRICE' | 'USE_SUBSCRIPTION';
}

export interface Lk2QuoteDelegationConfig {
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly issuer: string;
  readonly audience: string;
  readonly tenantId: string;
  readonly maxTtlSeconds: number;
  readonly clockToleranceSeconds: number;
}

export interface VerifiedLk2QuoteDelegation {
  readonly keyId: string;
  readonly jti: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantKey: string;
  readonly sessionId: string;
  readonly providerClientId: string;
  readonly providerMappingId: string;
  readonly action: 'CREATE_GAME' | 'JOIN_GAME';
  readonly correlationId: string;
  readonly requestSha256: string;
  readonly idempotencyKeySha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Must stay byte-identical to LK2 `subscriptionRuntimeRequestSha256`: the exact key order of the
 * canonical object is part of the digest.
 */
export function computeLk2QuoteRequestSha256(input: Lk2QuoteRequestForDigest): string {
  const canonical = {
    contractVersion: LK2_QUOTE_CONTRACT_VERSION,
    action: input.action,
    target: {
      kind: input.target.kind,
      id: input.target.id,
      expectedRevision: input.target.expectedRevision ?? null,
    },
    preferredSubscriptionInstanceId: input.preferredSubscriptionInstanceId ?? null,
    paymentIntent: input.paymentIntent,
  };
  return digest(`subscription-runtime-quote:v1\0${JSON.stringify(canonical)}`);
}

export function computeLk2IdempotencyKeySha256(key: string): string {
  return digest(key);
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function invalid(code: Lk2QuoteDelegationErrorCode): never {
  throw new Lk2QuoteDelegationError(code);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64UrlJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
  } catch {
    return invalid('LK2_DELEGATION_TOKEN_INVALID');
  }
}

export function loadLk2QuoteDelegationConfig(
  env: NodeJS.ProcessEnv = process.env,
): Lk2QuoteDelegationConfig {
  const rawKeys = String(env.SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS ?? '').trim();
  const issuer = String(env.SUBSCRIPTIONS_LK2_DELEGATION_ISSUER ?? '').trim();
  const audience = String(env.SUBSCRIPTIONS_LK2_DELEGATION_AUDIENCE ?? '').trim();
  const tenantId = String(env.SUBSCRIPTIONS_LK2_DELEGATION_TENANT_ID ?? '').trim();
  const maxTtlSeconds = Number(env.SUBSCRIPTIONS_LK2_DELEGATION_MAX_TTL_SECONDS ?? '60');
  const clockToleranceSeconds = Number(
    env.SUBSCRIPTIONS_LK2_DELEGATION_CLOCK_TOLERANCE_SECONDS ?? '5',
  );
  if (
    !rawKeys ||
    !issuer ||
    !PRINTABLE_ASCII.test(issuer) ||
    issuer.length > 512 ||
    !audience ||
    !PRINTABLE_ASCII.test(audience) ||
    audience.length > 256 ||
    !UUID_PATTERN.test(tenantId) ||
    !Number.isInteger(maxTtlSeconds) ||
    maxTtlSeconds < 10 ||
    maxTtlSeconds > 60 ||
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > 30
  ) {
    return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys) as unknown;
  } catch {
    return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
  }
  if (!record(parsed) || Object.keys(parsed).length === 0) {
    return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
  }
  const keys = new Map<string, KeyObject>();
  for (const [kid, pem] of Object.entries(parsed)) {
    if (!KEY_ID_PATTERN.test(kid) || typeof pem !== 'string') {
      return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
    }
    let key: KeyObject;
    try {
      key = createPublicKey(pem);
    } catch {
      return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
    }
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      return invalid('LK2_DELEGATION_CONFIGURATION_INVALID');
    }
    keys.set(kid, key);
  }
  return { keys, issuer, audience, tenantId, maxTtlSeconds, clockToleranceSeconds };
}

export function verifyLk2QuoteDelegation(input: {
  readonly token: string;
  readonly config: Lk2QuoteDelegationConfig;
  readonly request: Lk2QuoteRequestForDigest;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly nowSeconds?: number;
}): VerifiedLk2QuoteDelegation {
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return invalid('LK2_DELEGATION_TOKEN_INVALID');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeBase64UrlJson(encodedHeader);
  if (
    !record(header) ||
    header.alg !== 'RS256' ||
    header.typ !== LK2_QUOTE_DELEGATION_TYP ||
    typeof header.kid !== 'string' ||
    !KEY_ID_PATTERN.test(header.kid)
  ) {
    return invalid('LK2_DELEGATION_TOKEN_INVALID');
  }
  const key = input.config.keys.get(header.kid);
  if (!key) return invalid('LK2_DELEGATION_KEY_UNKNOWN');
  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      key,
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return invalid('LK2_DELEGATION_SIGNATURE_INVALID');

  const payload = decodeBase64UrlJson(encodedPayload);
  if (!record(payload)) return invalid('LK2_DELEGATION_TOKEN_INVALID');
  const payloadKeys = Object.keys(payload).sort();
  const expectedKeys = [...PAYLOAD_KEYS].sort();
  if (
    payloadKeys.length !== expectedKeys.length ||
    payloadKeys.some((keyName, index) => keyName !== expectedKeys[index])
  ) {
    return invalid('LK2_DELEGATION_TOKEN_INVALID');
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = input.config.clockToleranceSeconds;
  const iat = payload.iat;
  const nbf = payload.nbf;
  const exp = payload.exp;
  const action = payload.action;
  if (
    typeof iat !== 'number' ||
    !Number.isSafeInteger(iat) ||
    typeof nbf !== 'number' ||
    !Number.isSafeInteger(nbf) ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    (action !== 'CREATE_GAME' && action !== 'JOIN_GAME') ||
    typeof payload.sub !== 'string' ||
    !UUID_PATTERN.test(payload.sub) ||
    typeof payload.jti !== 'string' ||
    !UUID_PATTERN.test(payload.jti) ||
    typeof payload.sid !== 'string' ||
    !UUID_PATTERN.test(payload.sid) ||
    typeof payload.tenant_id !== 'string' ||
    !UUID_PATTERN.test(payload.tenant_id) ||
    typeof payload.tenant_key !== 'string' ||
    !ID_PATTERN.test(payload.tenant_key) ||
    typeof payload.provider_client_id !== 'string' ||
    !ID_PATTERN.test(payload.provider_client_id) ||
    typeof payload.provider_mapping_id !== 'string' ||
    !UUID_PATTERN.test(payload.provider_mapping_id) ||
    typeof payload.correlation_id !== 'string' ||
    !HEADER_PATTERN.test(payload.correlation_id) ||
    typeof payload.request_sha256 !== 'string' ||
    !DIGEST_PATTERN.test(payload.request_sha256) ||
    typeof payload.idempotency_key_sha256 !== 'string' ||
    !DIGEST_PATTERN.test(payload.idempotency_key_sha256)
  ) {
    return invalid('LK2_DELEGATION_TOKEN_INVALID');
  }
  if (exp - iat > input.config.maxTtlSeconds || exp <= iat) {
    return invalid('LK2_DELEGATION_TTL_INVALID');
  }
  if (exp <= now - skew) return invalid('LK2_DELEGATION_EXPIRED');
  if (nbf > now + skew || iat > now + skew) return invalid('LK2_DELEGATION_NOT_YET_VALID');
  if (payload.iss !== input.config.issuer) return invalid('LK2_DELEGATION_ISSUER_MISMATCH');
  if (payload.aud !== input.config.audience) return invalid('LK2_DELEGATION_AUDIENCE_MISMATCH');
  if (
    payload.scope !== LK2_QUOTE_DELEGATION_SCOPE ||
    payload.contract_version !== LK2_QUOTE_CONTRACT_VERSION ||
    payload.provider !== 'VIVA'
  ) {
    return invalid('LK2_DELEGATION_SCOPE_INVALID');
  }
  if (payload.tenant_id !== input.config.tenantId) {
    return invalid('LK2_DELEGATION_TENANT_MISMATCH');
  }
  if (action !== input.request.action) {
    return invalid('LK2_DELEGATION_ACTION_MISMATCH');
  }
  if (payload.correlation_id !== input.correlationId) {
    return invalid('LK2_DELEGATION_CORRELATION_MISMATCH');
  }
  if (payload.request_sha256 !== computeLk2QuoteRequestSha256(input.request)) {
    return invalid('LK2_DELEGATION_REQUEST_DIGEST_MISMATCH');
  }
  if (payload.idempotency_key_sha256 !== computeLk2IdempotencyKeySha256(input.idempotencyKey)) {
    return invalid('LK2_DELEGATION_IDEMPOTENCY_DIGEST_MISMATCH');
  }
  return {
    keyId: header.kid,
    jti: payload.jti,
    userId: payload.sub,
    tenantId: payload.tenant_id,
    tenantKey: payload.tenant_key,
    sessionId: payload.sid,
    providerClientId: payload.provider_client_id,
    providerMappingId: payload.provider_mapping_id,
    action,
    correlationId: payload.correlation_id,
    requestSha256: payload.request_sha256,
    idempotencyKeySha256: payload.idempotency_key_sha256,
    issuedAt: iat,
    expiresAt: exp,
  };
}
