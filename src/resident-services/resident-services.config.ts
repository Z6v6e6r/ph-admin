import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { safeStringEqual } from './resident-service-crypto';
import {
  RESIDENT_SERVICES_ERROR_CODES,
  RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS,
  RESIDENT_SERVICES_MAX_PASS_TTL_SECONDS,
  RESIDENT_SERVICES_MIN_EVIDENCE_AGE_SECONDS,
  RESIDENT_SERVICES_MIN_PASS_TTL_SECONDS
} from './resident-services.types';

export const RESIDENT_SERVICES_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
export const RESIDENT_SERVICES_DEFAULT_PASS_TTL_SECONDS =
  RESIDENT_SERVICES_MAX_PASS_TTL_SECONDS;

export function isResidentServicesFlagEnabled(name: string): boolean {
  return ['1', 'true', 'yes'].includes(
    String(process.env[name] ?? '').trim().toLowerCase()
  );
}

export function residentServicesEnabled(): boolean {
  return isResidentServicesFlagEnabled('RESIDENT_SERVICES_ENABLED');
}

export function assertResidentServicesEnabled(): void {
  if (!residentServicesEnabled()) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.DISABLED,
      message: 'Resident services are disabled'
    });
  }
}

export function requireResidentServicesIntegrationToken(supplied?: string): void {
  const expected = String(
    process.env.RESIDENT_SERVICES_INTEGRATION_TOKEN ?? ''
  ).trim();
  if (Buffer.byteLength(expected, 'utf8') < 32) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.NOT_CONFIGURED,
      message: 'Resident services integration token is not configured'
    });
  }
  if (!safeStringEqual(expected, String(supplied ?? '').trim())) {
    throw new ForbiddenException({
      code: RESIDENT_SERVICES_ERROR_CODES.INTEGRATION_FORBIDDEN,
      message: 'Resident services integration access is forbidden'
    });
  }
}

export function requireResidentServicesTenantId(): string {
  const value = String(
    process.env.RESIDENT_SERVICES_TENANT_ID
      ?? process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID
      ?? ''
  ).trim();
  if (!RESIDENT_SERVICES_ID_PATTERN.test(value)) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.NOT_CONFIGURED,
      message: 'Resident services tenant is not configured'
    });
  }
  return value;
}

export function requireResidentServicesTokenPepper(): string {
  const value = String(process.env.RESIDENT_SERVICES_TOKEN_PEPPER ?? '');
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.NOT_CONFIGURED,
      message: 'Resident pass token pepper is not configured'
    });
  }
  return value;
}

export function requireResidentServicesClientHashPepper(): string {
  const value = String(process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER ?? '');
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.NOT_CONFIGURED,
      message: 'Subscription client hash pepper is not configured'
    });
  }
  return value;
}

function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = String(process.env[name] ?? '').trim();
  const value = raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.CONFIG_INVALID,
      message: name + ' must be an integer between ' + minimum + ' and ' + maximum
    });
  }
  return value;
}

export function residentServicesPassTtlSeconds(): number {
  return boundedInteger(
    'RESIDENT_SERVICES_PASS_TTL_SECONDS',
    RESIDENT_SERVICES_DEFAULT_PASS_TTL_SECONDS,
    RESIDENT_SERVICES_MIN_PASS_TTL_SECONDS,
    RESIDENT_SERVICES_MAX_PASS_TTL_SECONDS
  );
}

export function residentServicesMaxEvidenceAgeSeconds(): number {
  const raw = String(
    process.env.RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS
      ?? process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS
      ?? ''
  ).trim();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)
    || value < RESIDENT_SERVICES_MIN_EVIDENCE_AGE_SECONDS
    || value > RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS) {
    throw new ServiceUnavailableException({
      code: RESIDENT_SERVICES_ERROR_CODES.CONFIG_INVALID,
      message: 'Resident services evidence freshness is not configured'
    });
  }
  return value;
}

export function requireResidentServicesIdempotencyKey(header?: string): string {
  const value = String(header ?? '');
  if (value !== value.trim() || value.length < 16 || value.length > 128) {
    throw new BadRequestException({
      code: RESIDENT_SERVICES_ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
      message: 'Idempotency-Key must contain 16..128 characters without surrounding spaces'
    });
  }
  return value;
}

export function residentServicesCorrelationId(header?: string): string {
  const value = String(header ?? '');
  if (value === value.trim() && value.length >= 8 && value.length <= 128) {
    return value;
  }
  return 'corr:' + randomUUID();
}
