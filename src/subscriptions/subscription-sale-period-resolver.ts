import { StoredSubscriptionPolicyPublication } from './subscriptions.types';

const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export type SubscriptionSalePeriodResolution =
  | { matchCount: 0; kind: 'NO_MATCH' }
  | { matchCount: 0; kind: 'MALFORMED' }
  | { matchCount: 1; kind: 'MATCH'; publication: StoredSubscriptionPolicyPublication }
  | { matchCount: number; kind: 'AMBIGUOUS' };

export type SubscriptionSalePeriodHistoryValidation =
  | { kind: 'VALID'; publications: StoredSubscriptionPolicyPublication[] }
  | { kind: 'MALFORMED' }
  | { kind: 'AMBIGUOUS'; matchCount: number };

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

export function validateSubscriptionSalePeriodHistory(
  publications: readonly StoredSubscriptionPolicyPublication[]
): SubscriptionSalePeriodHistoryValidation {
  if (publications.length < 1
    || new Set(publications.map((publication) => publication.subscriptionTypeId)).size !== 1
    || new Set(publications.map((publication) => publication.publicationId)).size
      !== publications.length) {
    return { kind: 'MALFORMED' };
  }
  const candidates = publications.map((publication) => ({
    publication,
    effectiveAt: parseStrictInstant(publication.effectiveAt)
  }));
  if (candidates.some((candidate) => candidate.effectiveAt === null)) {
    return { kind: 'MALFORMED' };
  }
  const ordered = (candidates as Array<{
    publication: StoredSubscriptionPolicyPublication;
    effectiveAt: number;
  }>).sort((left, right) => left.effectiveAt - right.effectiveAt);
  const startCounts = new Map<number, number>();
  for (const candidate of ordered) {
    startCounts.set(candidate.effectiveAt, (startCounts.get(candidate.effectiveAt) ?? 0) + 1);
  }
  const duplicateStartCount = Math.max(0, ...startCounts.values());
  if (duplicateStartCount > 1) {
    return { kind: 'AMBIGUOUS', matchCount: duplicateStartCount };
  }
  if (ordered.some((candidate, index) => index > 0
      && candidate.publication.policyVersion
        !== ordered[index - 1].publication.policyVersion + 1)) {
    return { kind: 'MALFORMED' };
  }
  const tail = ordered.at(-1)!.publication;
  if (tail.state !== 'PUBLISHED'
    || tail.supersededAt !== null
    || tail.supersededBy !== null
    || ordered.filter(({ publication }) => publication.state === 'PUBLISHED').length !== 1) {
    return { kind: 'MALFORMED' };
  }
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const publication = ordered[index].publication;
    const next = ordered[index + 1].publication;
    if (publication.state !== 'SUPERSEDED'
      || publication.supersededBy !== next.publicationId
      || publication.supersededAt !== next.publishedAt
      || parseStrictInstant(publication.supersededAt) === null
      || parseStrictInstant(next.publishedAt) === null) {
      return { kind: 'MALFORMED' };
    }
  }
  return { kind: 'VALID', publications: ordered.map(({ publication }) => publication) };
}

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

  const history = validateSubscriptionSalePeriodHistory(input.publications);
  if (history.kind === 'MALFORMED') {
    return { matchCount: 0, kind: 'MALFORMED' };
  }
  if (history.kind === 'AMBIGUOUS') {
    return { matchCount: history.matchCount, kind: 'AMBIGUOUS' };
  }
  const startsAtOrBeforePurchase = history.publications.filter(
    (publication) => Date.parse(publication.effectiveAt) <= purchasedAt
  );
  if (startsAtOrBeforePurchase.length === 0) return { matchCount: 0, kind: 'NO_MATCH' };
  const latestStart = Math.max(...startsAtOrBeforePurchase.map(
    (publication) => Date.parse(publication.effectiveAt)
  ));
  const matches = startsAtOrBeforePurchase.filter(
    (publication) => Date.parse(publication.effectiveAt) === latestStart
  );
  if (matches.length !== 1) return { matchCount: matches.length, kind: 'AMBIGUOUS' };
  return { matchCount: 1, kind: 'MATCH', publication: matches[0] };
}
