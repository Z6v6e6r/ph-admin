import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as recovery from '../scripts/reconcile-public-tournament-pending-payments.mjs';

test('report retains malformed active attempts and makes zero count non-authoritative', () => {
  assert.equal(typeof recovery.buildPendingReport, 'function');
  const report = recovery.buildPendingReport([
    { id: 't1', details: { booking: { pendingJoinPayments: [
      { transactionId: 'legacy-unbound', state: 'PENDING_PAYMENT', phone: '70000000001' },
      { transactionId: 'unknown', state: 'PROVIDER_RESULT_UNKNOWN', phone: '70000000002' },
      null
    ] } } },
    { id: 't2', details: { booking: { pendingJoinPayments: { corrupted: true } } } }
  ], { databaseName: 'test_db', collectionName: 'custom_tournaments' });
  assert.equal(report.count, 4);
  assert.equal(report.readyForDeployment, false);
  assert.equal(report.target.databaseName, 'test_db');
  assert.equal(report.rows[0].state, 'PENDING_PAYMENT');
  assert.equal(report.rows[0].requiredResolution, 'MANUAL_BINDING_REVIEW; NO AUTOMATIC RETRY OR RELEASE');
  assert.equal(report.rows[0].reasonCode, 'ACTIVE_PAYMENT_BINDING_INCOMPLETE');
  assert.equal(report.rows[2].reasonCode, 'MALFORMED_PENDING_RECORD');
  assert.equal(report.rows[3].reasonCode, 'MALFORMED_PENDING_ARRAY');
  assert.doesNotMatch(JSON.stringify(report), /70000000001|70000000002|legacy-unbound/);
  const empty = recovery.buildPendingReport([], { databaseName: 'test_db', collectionName: 'custom_tournaments' });
  assert.equal(empty.count, 0);
  assert.equal(empty.readyForDeployment, false);
});

for (const [kind, state] of [
  ['object', { phone: '70000000001', checkoutUrl: 'https://pay.example/private-checkout' }],
  ['array', ['70000000001', 'https://pay.example/private-checkout']],
  ['unknown string', '70000000001 https://pay.example/private-checkout']
]) {
  test(`report does not echo a malformed ${kind} state`, () => {
    const payment = { transactionId: 'synthetic-attempt', phone: '70000000002', state };
    const report = recovery.buildPendingReport([
      { id: 'cup', details: { booking: { pendingJoinPayments: [payment] } } }
    ], { databaseName: 'test_db', collectionName: 'custom_tournaments' });
    assert.equal(report.count, 1, 'Malformed state must not hide its record');
    assert.equal(report.rows[0].state, null);
    assert.equal(report.rows[0].expectedFingerprint, recovery.pendingFingerprint(payment));
    assert.doesNotMatch(JSON.stringify(report), /70000000001|70000000002|private-checkout|pay\.example/);
  });
}

test('report preserves only known active and terminal state labels', () => {
  const states = ['PROVIDER_CREATE_PENDING', 'PROVIDER_RESULT_UNKNOWN', 'PENDING_PAYMENT',
    'BOOKING_CREATION_IN_PROGRESS', 'PAID_PENDING_FINALIZATION', 'EXPIRED', 'FAILED'];
  const report = recovery.buildPendingReport([{ id: 'cup', details: { booking: {
    pendingJoinPayments: states.map(state => ({ transactionId: state, phone: '70000000001', state }))
  } } }], { databaseName: 'test_db', collectionName: 'custom_tournaments' });
  assert.deepEqual(report.rows.map(row => row.state), states);
});
