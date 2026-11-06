import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ResidentServiceLimitPeriod } from './resident-services.types';

export const RESIDENT_PASS_TOKEN_PREFIX = 'rsp1_';
export const RESIDENT_PASS_TOKEN_PATTERN = /^rsp1_[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_CONTEXT = 'resident-pass-token:v1';
const IDEMPOTENCY_HASH_CONTEXT = 'resident-services-idempotency:v1';

export function generateResidentPassToken(): string {
  return RESIDENT_PASS_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function isResidentPassToken(value: string): boolean {
  return RESIDENT_PASS_TOKEN_PATTERN.test(value);
}

export function hashResidentPassToken(pepper: string, token: string): string {
  return createHmac('sha256', pepper)
    .update(TOKEN_HASH_CONTEXT + '\0' + token)
    .digest('hex');
}

export function hashResidentIdempotencyKey(input: {
  pepper: string;
  tenantId: string;
  actorId: string;
  key: string;
}): string {
  return createHmac('sha256', input.pepper)
    .update([
      IDEMPOTENCY_HASH_CONTEXT,
      input.tenantId,
      input.actorId,
      input.key
    ].join('\0'))
    .digest('hex');
}

export function residentRequestHash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function safeStringEqual(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function moscowLocalDateParts(value: Date): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((item) => item.type === 'year')?.value);
  const month = Number(parts.find((item) => item.type === 'month')?.value);
  const day = Number(parts.find((item) => item.type === 'day')?.value);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    throw new Error('RESIDENT_SERVICES_LOCAL_DATE_INVALID');
  }
  return { year, month, day };
}

export function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return String(weekYear) + '-W' + String(week).padStart(2, '0');
}

export function residentPeriodKey(
  period: ResidentServiceLimitPeriod,
  now: Date,
  subscriptionInstanceId?: string,
  issuanceId?: string
): string {
  if (period === 'MANUAL_PER_ISSUANCE') {
    if (!issuanceId) {
      throw new Error('RESIDENT_SERVICES_MANUAL_ISSUANCE_IDENTITY_REQUIRED');
    }
    return issuanceId;
  }
  if (period === 'SUBSCRIPTION') {
    if (!subscriptionInstanceId) {
      throw new Error('RESIDENT_SERVICES_SUBSCRIPTION_PERIOD_IDENTITY_REQUIRED');
    }
    return subscriptionInstanceId;
  }
  const parts = moscowLocalDateParts(now);
  const dateKey = String(parts.year) + '-'
    + String(parts.month).padStart(2, '0') + '-'
    + String(parts.day).padStart(2, '0');
  if (period === 'DAY') return dateKey;
  if (period === 'MONTH') {
    return String(parts.year) + '-' + String(parts.month).padStart(2, '0');
  }
  if (period === 'WEEK') return isoWeekKey(parts.year, parts.month, parts.day);
  throw new Error('RESIDENT_SERVICES_LIMIT_PERIOD_INVALID');
}

export function residentStationScopeKey(stationIds: readonly string[]): string {
  const normalized = [...new Set(stationIds.map((item) => item.trim()).filter(Boolean))].sort();
  return normalized.length === 0 ? 'ALL' : 'STATIONS:' + normalized.join(',');
}
