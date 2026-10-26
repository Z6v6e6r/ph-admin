import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Owner-attested booking evidence.
 *
 * A bare provider booking id supplied by a caller is not proof that the booking exists or belongs
 * to the operation. In strict mode the owner of the booking (the Viva/LK1 integration) attests the
 * operation and booking id with a short-lived HMAC over a canonical payload; CUP verifies the
 * binding, freshness and signature before treating the benefit as confirmed. The shared secret is
 * server-to-server only and never leaves the two backends.
 */
export const OWNER_EVIDENCE_HEADER = 'x-subscription-owner-evidence';
export const OWNER_EVIDENCE_PREFIX = 'v1';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const HMAC_PATTERN = /^[a-f0-9]{64}$/;
const HMAC_CONTEXT = 'owner-evidence:v1\0';

export type OwnerEvidenceErrorCode =
  | 'OWNER_EVIDENCE_CONFIGURATION_INVALID'
  | 'OWNER_EVIDENCE_REQUIRED'
  | 'OWNER_EVIDENCE_MALFORMED'
  | 'OWNER_EVIDENCE_SIGNATURE_INVALID'
  | 'OWNER_EVIDENCE_EXPIRED'
  | 'OWNER_EVIDENCE_BINDING_MISMATCH';

export class OwnerEvidenceError extends Error {
  public constructor(
    public readonly code: OwnerEvidenceErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'OwnerEvidenceError';
  }
}

export interface OwnerEvidenceConfig {
  readonly secret: string;
  readonly maxAgeSeconds: number;
}

export interface OwnerEvidenceClaims {
  readonly operationId: string;
  readonly providerBookingId: string;
  readonly issuedAt: string;
}

function fail(code: OwnerEvidenceErrorCode): never {
  throw new OwnerEvidenceError(code);
}

export function loadOwnerEvidenceConfig(
  env: NodeJS.ProcessEnv = process.env,
): OwnerEvidenceConfig {
  const secret = String(env.SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET ?? '').trim();
  const maxAgeSeconds = Number(env.SUBSCRIPTIONS_OWNER_EVIDENCE_MAX_AGE_SECONDS ?? '60');
  if (
    Buffer.byteLength(secret, 'utf8') < 32 ||
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds < 10 ||
    maxAgeSeconds > 300
  ) {
    fail('OWNER_EVIDENCE_CONFIGURATION_INVALID');
  }
  return { secret, maxAgeSeconds };
}

function signature(secret: string, encodedPayload: string): string {
  return createHmac('sha256', secret).update(`${HMAC_CONTEXT}${encodedPayload}`).digest('hex');
}

export function createOwnerEvidence(
  input: OwnerEvidenceClaims,
  secret: string,
): string {
  if (!ID_PATTERN.test(input.operationId) || !ID_PATTERN.test(input.providerBookingId)) {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  const issuedAt = new Date(input.issuedAt);
  if (!Number.isFinite(issuedAt.getTime()) || issuedAt.toISOString() !== input.issuedAt) {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  const payload = JSON.stringify({
    operationId: input.operationId,
    providerBookingId: input.providerBookingId,
    issuedAt: input.issuedAt,
  });
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  return `${OWNER_EVIDENCE_PREFIX}.${encodedPayload}.${signature(secret, encodedPayload)}`;
}

export function verifyOwnerEvidence(input: {
  readonly evidence: string | undefined;
  readonly config: OwnerEvidenceConfig;
  readonly operationId: string;
  readonly providerBookingId: string;
  readonly now: Date;
}): OwnerEvidenceClaims {
  if (!input.evidence) fail('OWNER_EVIDENCE_REQUIRED');
  const parts = input.evidence.split('.');
  if (parts.length !== 3 || parts[0] !== OWNER_EVIDENCE_PREFIX) {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  const encodedPayload = parts[1] as string;
  const suppliedSignature = parts[2] as string;
  if (!HMAC_PATTERN.test(suppliedSignature)) fail('OWNER_EVIDENCE_MALFORMED');
  const expected = signature(input.config.secret, encodedPayload);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8');
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    fail('OWNER_EVIDENCE_SIGNATURE_INVALID');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
  } catch {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  const row = payload as Record<string, unknown>;
  if (
    typeof row.operationId !== 'string' ||
    !ID_PATTERN.test(row.operationId) ||
    typeof row.providerBookingId !== 'string' ||
    !ID_PATTERN.test(row.providerBookingId) ||
    typeof row.issuedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.issuedAt)) ||
    new Date(row.issuedAt).toISOString() !== row.issuedAt
  ) {
    fail('OWNER_EVIDENCE_MALFORMED');
  }
  if (row.operationId !== input.operationId || row.providerBookingId !== input.providerBookingId) {
    fail('OWNER_EVIDENCE_BINDING_MISMATCH');
  }
  const issuedAt = new Date(row.issuedAt);
  const ageMs = input.now.getTime() - issuedAt.getTime();
  if (ageMs < -60_000 || ageMs > input.config.maxAgeSeconds * 1000) {
    fail('OWNER_EVIDENCE_EXPIRED');
  }
  return {
    operationId: row.operationId,
    providerBookingId: row.providerBookingId,
    issuedAt: row.issuedAt,
  };
}
