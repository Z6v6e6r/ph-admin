import * as assert from 'node:assert/strict';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { resolveSubscriptionSalePeriod } from '../src/subscriptions/subscription-sale-period-resolver';
import { StoredSubscriptionPolicyPublication } from '../src/subscriptions/subscriptions.types';

const publication = (version: number, effectiveAt: string): StoredSubscriptionPolicyPublication => {
  const runtimeProjection: StoredSubscriptionPolicyPublication['runtimeProjection'] = {
    runtimeSchemaVersion: 1, subscriptionTypeId: 'subscription_type:sale-period', policyVersion: version,
    status: 'PUBLISHED', effectiveAt, timeZone: 'Europe/Moscow',
    createGame: { enabled: false, durationsMinutes: [] },
    joinGame: { enabled: false, minDurationMinutes: 60, maxDurationMinutes: 60 },
    activeServicesLimit: { enabled: false, max: null, scope: 'SUBSCRIPTION_BENEFIT_ONLY' },
    bookingWindow: { enabled: false, days: null }, dailyUsageLimit: 1,
    usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
    stationAccessRules: [], benefitRules: [],
    lifecycle: { allowBookingsAfterExpiry: false, activationMode: 'PURCHASE', activationWindowDays: 0, fixedActivationAt: null, validityDays: 365 },
    usage: { weeklyUsageLimit: null, monthlyUsageLimit: null, maxFutureBookings: null, minHoursBetweenUses: 0, blackoutDates: [] }
  };
  return {
    schemaVersion: 1, publicationId: `publication:sale-period-v${version}`,
    subscriptionTypeId: runtimeProjection.subscriptionTypeId, policyVersion: version,
    policyDigest: computeSubscriptionRuntimeProjectionDigest(runtimeProjection), mappingId: 'mapping:sale-period',
    dictionaryRevision: 'dictionary:sale-period', runtimeProjection, state: 'PUBLISHED', effectiveAt,
    publishedAt: effectiveAt, publishedBy: 'admin:subscriptions', supersededAt: null, supersededBy: null,
    impactPreviewRef: `impact:sale-period-v${version}`, approvalAuditRef: `audit:sale-period-v${version}`
  };
};

const first = publication(1, '2026-01-01T00:00:00.000Z');
const second = publication(2, '2026-02-01T00:00:00.000Z');
first.state = 'SUPERSEDED';
first.supersededAt = second.publishedAt;
first.supersededBy = second.publicationId;
const history = [first, second];
const matchedVersion = (purchasedAt: string, publications = history): number | null => {
  const result = resolveSubscriptionSalePeriod({ purchasedAt, publications });
  return result.kind === 'MATCH' ? result.publication.policyVersion : null;
};

assert.equal(matchedVersion('2026-01-01T00:00:00.000Z'), 1);
assert.equal(matchedVersion('2026-01-02T00:00:00.000Z'), 1);
assert.equal(matchedVersion('2026-01-31T23:59:59.000Z'), 1);
assert.equal(matchedVersion('2026-01-31T23:59:59.999Z'), 1);
assert.equal(matchedVersion('2026-02-01T00:00:00.000Z'), 2);
assert.equal(matchedVersion('2026-02-01T00:00:01.000Z'), 2);
assert.equal(matchedVersion('2026-02-02T00:00:00.000Z'), 2);
assert.equal(matchedVersion('2026-02-01T00:00:00.001Z'), 2);
assert.equal(matchedVersion('2026-03-01T00:00:00.000Z'), 2);
assert.equal(matchedVersion('2026-02-01T03:00:00.000+03:00'), 2);
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2025-12-31T23:59:59.999Z', publications: history }), { matchCount: 0, kind: 'NO_MATCH' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: 'not-a-date', publications: history }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-02-30T00:00:00.000Z', publications: history }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-02-01T00:00:00', publications: history }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-02-01T00:00:00.000Z', publications: [first, second, publication(3, second.effectiveAt)] }), { matchCount: 2, kind: 'AMBIGUOUS' });
assert.deepEqual(resolveSubscriptionSalePeriod({
  purchasedAt: '2026-03-01T00:00:00.000Z',
  publications: [first, publication(2, first.effectiveAt), publication(3, second.effectiveAt)]
}), { matchCount: 2, kind: 'AMBIGUOUS' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-02-01T00:00:00.000Z', publications: [{ ...first, effectiveAt: 'not-a-date' }] }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-02-01T00:00:00.000Z', publications: [{ ...first, effectiveAt: '2026-02-30T00:00:00.000Z' }] }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({
  purchasedAt: '2026-03-01T00:00:00.000Z',
  publications: [
    publication(2, '2026-01-01T00:00:00.000Z'),
    publication(1, '2026-02-01T00:00:00.000Z')
  ]
}), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({ purchasedAt: '2026-03-01T00:00:00.000Z', publications: [first, { ...second, subscriptionTypeId: 'subscription_type:other' }] }), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({
  purchasedAt: '2026-02-01T00:00:00.000Z',
  publications: [{ ...first, state: 'PUBLISHED', supersededAt: null, supersededBy: null }, second]
}), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({
  purchasedAt: '2026-02-01T00:00:00.000Z',
  publications: [{ ...first, supersededBy: 'publication:sale-period-wrong' }, second]
}), { matchCount: 0, kind: 'MALFORMED' });
assert.deepEqual(resolveSubscriptionSalePeriod({
  purchasedAt: '2026-02-01T00:00:00.000Z',
  publications: [{ ...first, supersededAt: '2026-01-31T23:59:59.999Z' }, second]
}), { matchCount: 0, kind: 'MALFORMED' });
console.log('subscription sale-period resolver tests passed');
