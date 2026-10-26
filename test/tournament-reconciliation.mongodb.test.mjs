import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import * as recovery from '../scripts/reconcile-public-tournament-pending-payments.mjs';

function decisionFor(payment) {
  return {
    tournamentId: 'cup', transactionId: payment.transactionId, phone: payment.phone,
    currentState: payment.state, providerTransactionId: payment.providerTransactionId,
    expectedFingerprint: recovery.pendingFingerprint(payment), verifiedAt: '2026-10-19T12:00:00Z',
    resolution: 'PAID_BOUND', replacement: {
      ...payment, state: 'PAID_PENDING_FINALIZATION', operationType: 'TRANSACTION',
      exerciseId: 'exercise', studioId: 'studio', widgetId: 'widget',
      selectedPurchaseOptionId: 'product', productType: 'SERVICE', amountMinor: 100, currency: 'RUB',
      eligibilitySnapshot: { decisionId: 'decision', playerId: payment.phone, activityId: 'cup',
        activityType: 'TOURNAMENT', result: 'ALLOWED', evaluatedAt: '2026-10-19T11:59:00Z' },
      verifiedPayment: { provider: 'VIVA', operationType: 'TRANSACTION', operationId: payment.providerTransactionId,
        status: 'PAID', exerciseId: 'exercise', phone: payment.phone, amountMinor: 100, currency: 'RUB',
        verifiedAt: '2026-10-19T12:00:00Z' }
    }
  };
}

test('real Mongo reconciliation refuses concurrent preimage changes and duplicate elements', async () => {
  assert.equal(typeof recovery.applyReconciliationDecision, 'function');
  const raw = process.env.RECONCILIATION_MONGODB_TEST_URI;
  assert.ok(raw, 'Explicit disposable RECONCILIATION_MONGODB_TEST_URI required');
  const uri = new URL(raw);
  assert.ok(['127.0.0.1', 'localhost', 'phab-cup-r1-mongo'].includes(uri.hostname));
  assert.equal(uri.username, '');
  assert.equal(uri.password, '');
  assert.equal(uri.pathname, '/');
  assert.ok(uri.searchParams.get('replicaSet'));
  assert.equal(uri.searchParams.get('retryWrites'), 'true');
  assert.equal(uri.searchParams.get('w'), 'majority');
  const client = new MongoClient(raw, { serverSelectionTimeoutMS: 2000 });
  const name = `phab_reconciliation_${randomUUID().replace(/-/g, '')}`;
  assert.match(name, /^phab_reconciliation_[a-f0-9]{32}$/);
  try {
    await client.connect();
    assert.ok((await client.db('admin').command({ hello: 1 })).setName);
    const collection = client.db(name).collection('custom_tournaments');
    const payment = { transactionId: 'tournament-payment:one', providerTransactionId: 'provider-one',
      phone: '70000000001', state: 'PROVIDER_RESULT_UNKNOWN', operationType: 'TRANSACTION',
      nested: { preserved: true } };
    const reset = async entries => {
      await collection.deleteMany({});
      await collection.insertOne({ id: 'cup', details: { booking: { pendingJoinPayments: entries } } });
    };
    await reset([payment]);
    const decision = decisionFor(payment);
    await recovery.applyReconciliationDecision(collection, decision);
    assert.deepEqual((await collection.findOne({ id: 'cup' })).details.booking.pendingJoinPayments,
      [decision.replacement]);
    await assert.rejects(recovery.applyReconciliationDecision(collection, decision), /CAS precheck/);

    for (const mutation of ['change-other-field', 'append-sibling']) {
      await reset([payment]);
      const wrapper = {
        findOne: (...args) => collection.findOne(...args),
        updateOne: async (...args) => {
          if (mutation === 'change-other-field') {
            await collection.updateOne({ id: 'cup' }, { $set: {
              'details.booking.pendingJoinPayments.0.nested.preserved': false,
              'details.booking.pendingJoinPayments.0.concurrentField': 'must survive'
            } });
          } else {
            await collection.updateOne({ id: 'cup' }, { $push: {
              'details.booking.pendingJoinPayments': { transactionId: 'sibling', state: 'PROVIDER_CREATE_PENDING' }
            } });
          }
          return collection.updateOne(...args);
        }
      };
      await assert.rejects(recovery.applyReconciliationDecision(wrapper, decision), /CAS update/);
      const stored = (await collection.findOne({ id: 'cup' })).details.booking.pendingJoinPayments;
      assert.equal(stored[0].state, 'PROVIDER_RESULT_UNKNOWN');
      if (mutation === 'change-other-field') assert.equal(stored[0].concurrentField, 'must survive');
      else assert.equal(stored.length, 2);
    }
    await reset([payment, { ...payment, nested: { different: true } }]);
    await assert.rejects(recovery.applyReconciliationDecision(collection, decision), /ambiguous/);
    assert.equal((await collection.findOne({ id: 'cup' })).details.booking.pendingJoinPayments.length, 2);
  } finally {
    try { await client.db(name).dropDatabase(); } finally { await client.close(); }
  }
});
