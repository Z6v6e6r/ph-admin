import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CommunityTypeSettings, parseEventRegistrationPolicy } from './community-policy';

/**
 * Operator export of the private EVENT questionnaire. Read-only: no membership,
 * admission or payment state changes, and no contact data in logs or audit.
 */
const MAX_EVENT_ENTRIES = 500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EventRegistrationsExportSource {
  communityId: string;
  communityName: string;
  communityType?: string;
  typeSettings?: CommunityTypeSettings;
  typeSettingsRevision?: number;
  typeSettingsEffectiveAt?: string;
  eventEntries?: unknown;
  stationId?: string;
}

export interface EventRegistrationsExportRow {
  fullName: string;
  company: string;
  phone: string | null;
  email: string;
  registeredAt: string;
  receivesResultsPush: boolean;
}

export interface EventRegistrationsExport {
  communityId: string;
  communityName: string;
  typeSettingsRevision: number;
  exportedAt: string;
  count: number;
  rows: EventRegistrationsExportRow[];
}

function invalidSource(): never {
  throw new ServiceUnavailableException('EVENT_REGISTRATIONS_SOURCE_INVALID');
}

function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value as string).toISOString() === value;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') invalidSource();
  const text = (value as string).trim().replace(/\s+/g, ' ');
  if (!text || [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    invalidSource();
  }
  // A long community name must not block the export of the questionnaire itself.
  return text.length > 160 ? text.slice(0, 160) : text;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') invalidSource();
  const text = (value as string).trim().replace(/\s+/g, ' ');
  if (!text || text.length > max ||
      [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    invalidSource();
  }
  return text;
}

export function buildEventRegistrationsExport(
  source: EventRegistrationsExportSource,
  nowIso: string
): EventRegistrationsExport {
  const now = Date.parse(nowIso);
  if (!isCanonicalIso(nowIso) || !Number.isFinite(now)) invalidSource();
  if (source.communityType !== 'EVENT') {
    throw new BadRequestException('EVENT_REGISTRATIONS_NOT_EVENT');
  }
  const communityName = normalizeDisplayName(source.communityName);
  const revision = source.typeSettingsRevision;
  const effectiveAt = source.typeSettingsEffectiveAt;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1 || !isCanonicalIso(effectiveAt)) {
    invalidSource();
  }
  try {
    parseEventRegistrationPolicy(source.typeSettings?.registrationPolicy);
  } catch {
    invalidSource();
  }
  // A configured community has not collected anything yet when the private array
  // is absent; that is an empty questionnaire, not a source defect.
  const storedEntries = source.eventEntries === undefined || source.eventEntries === null
    ? []
    : source.eventEntries;
  if (!Array.isArray(storedEntries) || storedEntries.length > MAX_EVENT_ENTRIES) {
    invalidSource();
  }

  const latestByPlayer = new Map<string, EventRegistrationsExportRow>();
  for (const rawEntry of storedEntries as unknown[]) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) invalidSource();
    const entry = rawEntry as Record<string, unknown>;
    const playerId = entry.playerId;
    if (typeof playerId !== 'string' || !playerId) invalidSource();
    if (!isCanonicalIso(entry.registeredAt) || !isCanonicalIso(entry.retentionUntil) ||
        Date.parse(entry.registeredAt) > now) {
      invalidSource();
    }
    // Retention is per entry: an expired questionnaire is not offered again.
    if (now >= Date.parse(entry.retentionUntil)) continue;
    const fullName = cleanText(entry.fullName, 160);
    const company = cleanText(entry.company, 160);
    const email = cleanText(entry.email, 254).toLowerCase();
    if (!EMAIL_PATTERN.test(email) || fullName.split(' ').length < 2) invalidSource();
    if (entry.pushOptIn !== undefined && typeof entry.pushOptIn !== 'boolean') invalidSource();
    let phone: string | null = null;
    if (entry.phone !== undefined && entry.phone !== null) {
      if (typeof entry.phone !== 'string' || !/^\d{11}$/.test(entry.phone)) invalidSource();
      phone = entry.phone;
    }
    const receivesResultsPush = entry.pushOptIn === true;
    if (receivesResultsPush && !phone) invalidSource();
    // A settings edit raises the policy revision without re-stamping every stored
    // questionnaire, and a player may submit again. The export keeps the newest
    // questionnaire per player within retention, so an operator never loses a
    // registrant or sees the same person twice.
    const previous = latestByPlayer.get(playerId);
    if (previous && previous.registeredAt >= entry.registeredAt) continue;
    latestByPlayer.set(playerId, {
      fullName,
      company,
      phone,
      email,
      registeredAt: entry.registeredAt,
      receivesResultsPush
    });
  }

  const rows = Array.from(latestByPlayer.values())
    .sort((left, right) => left.registeredAt.localeCompare(right.registeredAt));
  return {
    communityId: source.communityId,
    communityName,
    typeSettingsRevision: revision as number,
    exportedAt: nowIso,
    count: rows.length,
    rows
  };
}
