import assert from 'node:assert/strict';
import {
  isLegacyPendingPayment,
  pendingFingerprint,
  validateDecision
} from '../scripts/reconcile-public-tournament-pending-payments.mjs';

const legacy = { transactionId: 'tx-legacy', phone: '79990000001', createdAt: '2026-08-01' };
assert.equal(isLegacyPendingPayment(legacy), true);
assert.equal(isLegacyPendingPayment({ ...legacy, state: 'PENDING_PAYMENT' }), false);
assert.match(pendingFingerprint(legacy), /^[0-9a-f]{64}$/);

const expired = validateDecision({
  tournamentId: 'tournament-1',
  transactionId: 'tx-legacy',
  phone: '79990000001',
  expectedFingerprint: pendingFingerprint(legacy),
  verifiedAt: '2026-08-17T10:00:00.000Z',
  resolution: 'EXPIRED_UNPAID',
  providerStatus: 'UNPAID'
});
assert.equal(expired.replacement.state, 'EXPIRED');

assert.throws(() => validateDecision({
  tournamentId: 'tournament-1',
  transactionId: 'tx-legacy',
  phone: '79990000001',
  expectedFingerprint: pendingFingerprint(legacy),
  verifiedAt: '2026-08-17T10:00:00.000Z',
  resolution: 'EXPIRED_UNPAID',
  providerStatus: 'PAID'
}), /providerStatus=UNPAID/);

const paidReplacement = {
  ...legacy,
  state: 'PAID_PENDING_FINALIZATION',
  operationType: 'TRANSACTION',
  exerciseId: 'exercise-1',
  studioId: 'studio-1',
  widgetId: 'widget-1',
  selectedPurchaseOptionId: 'product-1',
  productType: 'SERVICE',
  amountMinor: 250000,
  currency: 'RUB',
  eligibilitySnapshot: {
    decisionId: 'decision-1',
    playerId: '79990000001',
    activityId: 'tournament-1',
    activityType: 'TOURNAMENT',
    policyVersion: 1,
    levelScaleVersion: 1,
    result: 'ALLOWED',
    reasonCode: 'LEVEL_ALLOWED',
    evaluatedAt: '2026-08-17T09:59:00.000Z'
  },
  verifiedPayment: {
    provider: 'VIVA',
    operationType: 'TRANSACTION',
    operationId: 'tx-legacy',
    status: 'PAID',
    exerciseId: 'exercise-1',
    phone: '79990000001',
    amountMinor: 250000,
    currency: 'RUB',
    verifiedAt: '2026-08-17T10:00:00.000Z'
  }
};
assert.equal(validateDecision({
  tournamentId: 'tournament-1',
  transactionId: 'tx-legacy',
  phone: '79990000001',
  expectedFingerprint: pendingFingerprint(legacy),
  verifiedAt: '2026-08-17T10:00:00.000Z',
  resolution: 'PAID_BOUND',
  replacement: paidReplacement
}).replacement.state, 'PAID_PENDING_FINALIZATION');

console.log('Tournament pending payment reconciliation validation test passed');
