import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.env.CUP_RECOVERY_ROOT;
assert.ok(root && root.startsWith('/'), 'Explicit isolated compiled recovery root required');
const require = createRequire(resolve(root, 'package.json'));
require('reflect-metadata');
const { TournamentsService } = require(resolve(root, 'dist/tournaments/tournaments.service.js'));
let forbiddenCalls = 0;
const deny = () => { forbiddenCalls++; throw Error('Recovery must not invoke provider/persistence mutation'); };
const originalFetch = globalThis.fetch;
globalThis.fetch = deny;
try {
  for (const state of ['PROVIDER_CREATE_PENDING', 'PROVIDER_RESULT_UNKNOWN']) {
    for (const olderState of [null, 'PENDING_PAYMENT', 'PAID_PENDING_FINALIZATION']) {
    for (const method of ['createPublicJoinPurchaseTransaction', 'registerPublicParticipant', 'confirmPublicJoinAfterPayment']) {
      const pending = { transactionId: 'synthetic-local-attempt', phone: '79990000000', state, operationType: 'TRANSACTION' };
      const tournament = { id: 'synthetic-cup', slug: 'synthetic-cup', participants: [], waitlist: [],
        details: { booking: { paymentRequired: false, pendingJoinPayments: [...(olderState ? [{ ...pending, transactionId: 'older-synthetic', state: olderState }] : []), pending] } } };
      const before = structuredClone(tournament);
      const service = Object.create(TournamentsService.prototype);
      service.ensurePersistenceEnabled = () => {};
      service.requireCustomBySlug = async () => tournament;
      service.tournamentsPersistence = new Proxy({}, { get: () => deny });
      for (const name of ['fetchVivaJoinPurchaseOptions', 'createSourceTournamentBooking',
        'createVivaJoinPurchaseTransaction', 'verifyVivaTransaction', 'createVivaJoinBookingWithSubscription',
        'verifyVivaJoinBookingWithSubscription', 'markPendingJoinPaymentPaid', 'finalizePaidPublicJoin']) service[name] = deny;
      const result = await service[method](tournament.slug, { phone: pending.phone, name: 'Synthetic', levelLabel: 'C' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BOOKING_FAILED');
      assert.doesNotMatch(result.message, /подтвержден/i, 'Unknown outcome must not be described as paid');
      assert.equal(forbiddenCalls, 0);
      assert.deepEqual(tournament, before);
      assert.equal(service.isCapacityHoldingPendingJoinPayment(service.parsePendingJoinPayment(pending)), true);
    }
  }
  }
  console.log('Recovery service: both new states x three public paths, zero provider/mutation, capacity preserved PASS');
} finally { globalThis.fetch = originalFetch; }
