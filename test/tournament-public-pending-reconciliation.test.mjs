import assert from 'node:assert/strict';
import {
  buildDecisionArrayFilter,
  buildDecisionElementMatch,
  isLegacyPendingPayment,
  isProviderUnresolvedAttempt,
  pendingFingerprint,
  validateDecision
} from '../scripts/reconcile-public-tournament-pending-payments.mjs';

const legacy = { transactionId: 'tx-legacy', phone: '79990000001', createdAt: '2026-08-01' };
assert.equal(isLegacyPendingPayment(legacy), true);
assert.equal(isLegacyPendingPayment({ ...legacy, state: 'PENDING_PAYMENT' }), false);
assert.equal(isProviderUnresolvedAttempt({
  ...legacy,
  operationType: 'TRANSACTION',
  state: 'PROVIDER_RESULT_UNKNOWN'
}), true);
assert.equal(isLegacyPendingPayment({
  ...legacy,
  operationType: 'TRANSACTION',
  state: 'PROVIDER_RESULT_UNKNOWN'
}), false);
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

const unresolved = {
  transactionId: 'tournament-payment:attempt-1',
  providerTransactionId: 'viva-transaction-1',
  phone: '79990000002',
  state: 'PROVIDER_RESULT_UNKNOWN',
  operationType: 'TRANSACTION',
  createdAt: '2026-08-25T09:00:00.000Z'
};
const commonUnresolvedDecision = {
  tournamentId: 'tournament-2',
  transactionId: unresolved.transactionId,
  providerTransactionId: unresolved.providerTransactionId,
  currentState: 'PROVIDER_RESULT_UNKNOWN',
  phone: unresolved.phone,
  expectedFingerprint: pendingFingerprint(unresolved),
  verifiedAt: '2026-08-25T10:00:00.000Z'
};
const unresolvedBaseReplacement = {
  ...unresolved,
  operationType: 'TRANSACTION',
  exerciseId: 'exercise-2',
  studioId: 'studio-2',
  widgetId: 'widget-2',
  selectedPurchaseOptionId: 'product-2',
  productType: 'SERVICE',
  amountMinor: 250000,
  currency: 'RUB',
  eligibilitySnapshot: {
    decisionId: 'decision-2',
    playerId: unresolved.phone,
    activityId: 'tournament-2',
    activityType: 'TOURNAMENT',
    policyVersion: 1,
    levelScaleVersion: 1,
    result: 'ALLOWED',
    reasonCode: 'LEVEL_ALLOWED',
    evaluatedAt: '2026-08-25T09:00:00.000Z'
  }
};
const providerBound = validateDecision({
  ...commonUnresolvedDecision,
  resolution: 'PROVIDER_BOUND',
  replacement: {
    ...unresolvedBaseReplacement,
    state: 'PENDING_PAYMENT',
    checkoutUrl: 'https://pay.example/viva-transaction-1',
    paymentExpiresAt: '2099-08-25T11:00:00.000Z'
  }
});
assert.equal(providerBound.replacement.state, 'PENDING_PAYMENT');
assert.deepEqual(buildDecisionElementMatch(providerBound), {
  transactionId: unresolved.transactionId,
  phone: unresolved.phone,
  state: 'PROVIDER_RESULT_UNKNOWN',
  providerTransactionId: unresolved.providerTransactionId
});
assert.deepEqual(buildDecisionArrayFilter(providerBound), {
  'payment.transactionId': unresolved.transactionId,
  'payment.phone': unresolved.phone,
  'payment.state': 'PROVIDER_RESULT_UNKNOWN',
  'payment.providerTransactionId': unresolved.providerTransactionId
});

const paidBound = validateDecision({
  ...commonUnresolvedDecision,
  resolution: 'PAID_BOUND',
  replacement: {
    ...unresolvedBaseReplacement,
    state: 'PAID_PENDING_FINALIZATION',
    verifiedPayment: {
      provider: 'VIVA',
      operationType: 'TRANSACTION',
      operationId: unresolved.providerTransactionId,
      status: 'PAID',
      exerciseId: 'exercise-2',
      phone: unresolved.phone,
      amountMinor: 250000,
      currency: 'RUB',
      verifiedAt: '2026-08-25T10:00:00.000Z'
    }
  }
});
assert.equal(paidBound.replacement.verifiedPayment.operationId, unresolved.providerTransactionId);

assert.throws(() => validateDecision({
  ...commonUnresolvedDecision,
  resolution: 'PAID_BOUND',
  replacement: {
    ...paidBound.replacement,
    verifiedPayment: {
      ...paidBound.replacement.verifiedPayment,
      operationId: unresolved.transactionId
    }
  }
}), /not fully provider\/activity bound/);

for (const invalidReplacement of [
  { ...providerBound.replacement, exerciseId: '' },
  { ...providerBound.replacement, studioId: '   ' },
  { ...providerBound.replacement, widgetId: '' },
  { ...providerBound.replacement, selectedPurchaseOptionId: '' },
  { ...providerBound.replacement, productType: 'UNKNOWN' },
  {
    ...providerBound.replacement,
    eligibilitySnapshot: {
      ...providerBound.replacement.eligibilitySnapshot,
      decisionId: ''
    }
  },
  {
    ...providerBound.replacement,
    eligibilitySnapshot: {
      ...providerBound.replacement.eligibilitySnapshot,
      evaluatedAt: 'not-a-date'
    }
  }
]) {
  assert.throws(() => validateDecision({
    ...commonUnresolvedDecision,
    resolution: 'PROVIDER_BOUND',
    replacement: invalidReplacement
  }), /not fully provider\/activity bound/);
}

console.log('Tournament pending payment reconciliation validation test passed');
