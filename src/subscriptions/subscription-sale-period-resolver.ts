import { StoredSubscriptionPolicyPublication } from './subscriptions.types';

const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export type SubscriptionSalePeriodResolution =
  | { matchCount: 0; kind: 'NO_MATCH' }
  | { matchCount: 0; kind: 'MALFORMED' }
  | { matchCount: 1; kind: 'MATCH'; publication: StoredSubscriptionPolicyPublication }
  | { matchCount: number; kind: 'AMBIGUOUS' };

const parseStrictInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10]);
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11]);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59
    || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Resolves the publication period containing a subscription acquisition instant.
 * Publication periods are derived from effectiveAt history as [effectiveAt(n),
 * effectiveAt(n + 1)); the final publication is open-ended.
 */
export function resolveSubscriptionSalePeriod(input: {
  purchasedAt: string;
  publications: readonly StoredSubscriptionPolicyPublication[];
}): SubscriptionSalePeriodResolution {
  const purchasedAt = parseStrictInstant(input.purchasedAt);
  if (purchasedAt === null) return { matchCount: 0, kind: 'MALFORMED' };

  if (new Set(input.publications.map((publication) => publication.subscriptionTypeId)).size > 1) {
    return { matchCount: 0, kind: 'MALFORMED' };
  }

  const candidates = input.publications.map((publication) => ({
    publication,
    effectiveAt: parseStrictInstant(publication.effectiveAt)
  }));
  if (candidates.some((candidate) => candidate.effectiveAt === null)) {
    return { matchCount: 0, kind: 'MALFORMED' };
  }

  const validCandidates = candidates as Array<{
    publication: StoredSubscriptionPolicyPublication;
    effectiveAt: number;
  }>;

  validCandidates.sort((left, right) => left.effectiveAt - right.effectiveAt);
  const startCounts = new Map<number, number>();
  for (const candidate of validCandidates) {
    startCounts.set(candidate.effectiveAt, (startCounts.get(candidate.effectiveAt) ?? 0) + 1);
  }
  const duplicateStartCount = Math.max(0, ...startCounts.values());
  if (duplicateStartCount > 1) {
    return { matchCount: duplicateStartCount, kind: 'AMBIGUOUS' };
  }
  if (validCandidates.some((candidate, index) => index > 0
    && validCandidates[index - 1].publication.policyVersion >= candidate.publication.policyVersion)) {
    return { matchCount: 0, kind: 'MALFORMED' };
  }
  const startsAtOrBeforePurchase = validCandidates.filter(
    (candidate) => candidate.effectiveAt <= purchasedAt
  );
  if (startsAtOrBeforePurchase.length === 0) return { matchCount: 0, kind: 'NO_MATCH' };
  const latestStart = Math.max(...startsAtOrBeforePurchase.map((candidate) => candidate.effectiveAt));
  const matches = startsAtOrBeforePurchase.filter(
    (candidate) => candidate.effectiveAt === latestStart
  );
  if (matches.length !== 1) return { matchCount: matches.length, kind: 'AMBIGUOUS' };
  return { matchCount: 1, kind: 'MATCH', publication: matches[0].publication };
}
