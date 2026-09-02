import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateSubscriptionSalePeriodHistory } from './subscription-sale-period-resolver';
import { validateStoredSubscriptionPolicyPublication } from './subscription-runtime-contracts';
import {
  StoredSubscriptionInstancePolicyResolution,
  StoredSubscriptionPolicyPublication
} from './subscriptions.types';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
};

const sha256 = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256')
  .update(JSON.stringify(stableValue(value)))
  .digest('hex')}`;

export function buildSubscriptionPublicationHistoryEvidence(
  publications: readonly StoredSubscriptionPolicyPublication[]
): StoredSubscriptionInstancePolicyResolution['publicationHistory'] {
  const canonicalPublications = publications.map((publication) => {
    validateStoredSubscriptionPolicyPublication(publication);
    return structuredClone(publication);
  }).sort((left, right) => {
    const effectiveOrder = Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt);
    if (effectiveOrder !== 0) return effectiveOrder;
    return left.publicationId < right.publicationId ? -1
      : left.publicationId > right.publicationId ? 1 : 0;
  });
  const entries = canonicalPublications.map((publication) => ({
      publicationId: publication.publicationId,
      subscriptionTypeId: publication.subscriptionTypeId,
      policyVersion: publication.policyVersion,
      policyDigest: publication.policyDigest as `sha256:${string}`,
      mappingId: publication.mappingId,
      state: publication.state,
      effectiveAt: publication.effectiveAt
    }));
  return {
    historyDigest: sha256(canonicalPublications),
    entries
  };
}

export function subscriptionPublicationHistoryMatchesResolution(
  publications: readonly StoredSubscriptionPolicyPublication[],
  resolution: StoredSubscriptionInstancePolicyResolution
): boolean {
  if (validateSubscriptionSalePeriodHistory(publications).kind !== 'VALID') return false;
  return isDeepStrictEqual(
    buildSubscriptionPublicationHistoryEvidence(publications),
    resolution.publicationHistory
  );
}

export function buildSubscriptionInstancePolicyResolution(
  publications: readonly StoredSubscriptionPolicyPublication[],
  selections: StoredSubscriptionInstancePolicyResolution['selections']
): StoredSubscriptionInstancePolicyResolution {
  const publicationHistory = buildSubscriptionPublicationHistoryEvidence(publications);
  const canonicalSelections = structuredClone(selections).sort((left, right) =>
    left.subscriptionInstanceId < right.subscriptionInstanceId ? -1
      : left.subscriptionInstanceId > right.subscriptionInstanceId ? 1 : 0);
  return {
    publicationHistory,
    selections: canonicalSelections,
    resolutionDigest: sha256({ publicationHistory, selections: canonicalSelections })
  };
}
