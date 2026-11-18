import * as assert from 'node:assert/strict';
import { evaluateTournamentLevelAdmission, type PlayerLevelEvidence } from '../src/tournaments/tournament-level-admission';
import {
  parseTournamentServerBookingPrice,
  readTournamentServerBookingMode,
  TOURNAMENT_SERVER_BOOKING_LEASE_MS,
  TournamentServerBookingCoordinator,
  TournamentServerBookingError,
  type ProviderBookingResult,
  type ProviderCheckoutResult,
  type TournamentServerBookingAdmission,
  type TournamentServerBookingAttempt,
  type TournamentServerBookingPrice,
  type TournamentServerBookingStore
} from '../src/tournaments/tournament-server-booking';
import { VivaAdminTournamentBookingAdapter } from '../src/integrations/viva/viva-admin-tournament-booking.adapter';

const C_SLIDER = ['3', '3.125', '3.25', '3.375', '3.5'];
const KEY = 'fixture-key-0001';
const PRICE: TournamentServerBookingPrice = { baseAmountMinor: 150000, discountMinor: 0, discountReason: 'Турнир', productId: null };

class MemoryStore implements TournamentServerBookingStore {
  rows = new Map<string, TournamentServerBookingAttempt>();
  writes = 0;
  async find(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }
  async insert(doc: TournamentServerBookingAttempt) {
    if (this.rows.has(doc._id)) return false;
    this.writes += 1;
    this.rows.set(doc._id, structuredClone(doc));
    return true;
  }
  async replace(doc: TournamentServerBookingAttempt, expectedRevision: number) {
    const row = this.rows.get(doc._id);
    if (!row || row.revision !== expectedRevision) return false;
    this.writes += 1;
    this.rows.set(doc._id, structuredClone(doc));
    return true;
  }
}

function decision(player: PlayerLevelEvidence, mode: 'ENFORCE' | 'LEGACY' = 'ENFORCE') {
  return evaluateTournamentLevelAdmission(
    { id: 't-1', accessLevels: C_SLIDER, levelTolerance: 0.2, updatedAt: '2026-11-17T10:00:00.000Z' },
    player,
    { mode, now: new Date('2026-11-17T12:00:00.000Z') }
  );
}

function harness(options: {
  rating?: number | null;
  player?: PlayerLevelEvidence;
  mode?: 'ENABLED' | 'DISABLED';
  levelMode?: 'ENFORCE' | 'LEGACY';
  price?: typeof PRICE | null;
  exerciseId?: string | null;
  otherRefusal?: { code: string; message: string } | null;
  booking?: () => Promise<ProviderBookingResult>;
  find?: () => Promise<{ bookingId: string } | null | 'UNAVAILABLE'>;
  checkout?: (input: { price: typeof PRICE }) => Promise<ProviderCheckoutResult>;
} = {}) {
  const store = new MemoryStore();
  const calls = { booking: 0, find: 0, checkout: 0, admit: 0, operationKeys: [] as string[], checkoutInputs: [] as unknown[] };
  let clock = Date.parse('2026-11-17T12:00:00.000Z');
  const state = { ...options };
  const admission = (): TournamentServerBookingAdmission => {
    const player = state.player ?? (state.rating === null ? { status: 'MISSING' as const } : { status: 'OK' as const, ratingNumeric: state.rating ?? 3.31 });
    return {
      tournamentId: 't-1',
      exerciseId: state.exerciseId === undefined ? 'exercise-1' : state.exerciseId,
      studioId: 'studio-1',
      levelMode: state.levelMode ?? 'ENFORCE',
      decision: decision(player, state.levelMode ?? 'ENFORCE'),
      actor: { clientId: 'client-1', phone: '79990000000' },
      price: state.price === undefined ? PRICE : state.price,
      otherRefusal: state.otherRefusal ?? null
    };
  };
  const coordinator = new TournamentServerBookingCoordinator({
    mode: () => state.mode ?? 'ENABLED',
    admission: { admit: async () => { calls.admit += 1; return admission(); } },
    store,
    booking: {
      createBooking: async (input) => {
        calls.booking += 1;
        calls.operationKeys.push(input.operationKey);
        return state.booking ? state.booking() : { outcome: 'CREATED', bookingId: 'booking-1' };
      },
      findBooking: async () => { calls.find += 1; return state.find ? state.find() : null; }
    },
    checkout: {
      createCheckout: async (input) => {
        calls.checkout += 1;
        calls.checkoutInputs.push(input);
        if (state.checkout) return state.checkout(input);
        const toPay = input.price.baseAmountMinor - input.price.discountMinor;
        return { outcome: 'CREATED', transactionId: 'tx-1', paymentUrl: toPay > 0 ? 'https://pay.example/tx-1' : null, toPayMinor: toPay, paid: toPay === 0, expiresAt: null };
      }
    },
    now: () => new Date(clock)
  });
  return { coordinator, store, calls, state, tick: (ms: number) => { clock += ms; } };
}

async function rejects(promise: Promise<unknown>, code: string, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TournamentServerBookingError);
    assert.equal(error.code, code);
    assert.equal(error.httpStatus, status);
    return true;
  });
}

async function main() {
  // Switch: unset/unknown is DISABLED.
  assert.equal(readTournamentServerBookingMode({}), 'DISABLED');
  assert.equal(readTournamentServerBookingMode({ TOURNAMENT_SERVER_BOOKING_MODE: 'yes' }), 'DISABLED');
  assert.equal(readTournamentServerBookingMode({ TOURNAMENT_SERVER_BOOKING_MODE: ' Enabled ' }), 'ENABLED');

  // Price config: fail closed, 100% discount allowed, no client values.
  assert.deepEqual(parseTournamentServerBookingPrice({ baseAmountMinor: 150000, discountReason: 'Турнир' }), PRICE);
  assert.equal(parseTournamentServerBookingPrice({ baseAmountMinor: 150000, discountMinor: 150000, discountReason: 'Бесплатно' })?.discountMinor, 150000);
  for (const bad of [null, [], {}, { baseAmountMinor: 0, discountReason: 'x' }, { baseAmountMinor: 1.5, discountReason: 'x' },
    { baseAmountMinor: 100, discountMinor: 101, discountReason: 'x' }, { baseAmountMinor: 100, discountMinor: -1, discountReason: 'x' },
    { baseAmountMinor: 100 }, { baseAmountMinor: 100, discountReason: 'x', productId: 'bad id' }]) {
    assert.equal(parseTournamentServerBookingPrice(bad), null, JSON.stringify(bad));
  }

  // Disabled: nothing is read or written.
  {
    const h = harness({ mode: 'DISABLED' });
    await rejects(h.coordinator.join('t-1', 'Bearer x', KEY), 'SERVER_BOOKING_DISABLED', 503);
    assert.equal(h.calls.admit + h.calls.booking + h.store.writes, 0);
  }
  // Level gate not enforced: server booking refuses to run.
  {
    const h = harness({ levelMode: 'LEGACY' });
    await rejects(h.coordinator.join('t-1', 'Bearer x', KEY), 'SERVER_BOOKING_REQUIRES_LEVEL_ENFORCE', 503);
    assert.equal(h.calls.booking + h.store.writes, 0);
  }
  // Idempotency key required.
  for (const key of [undefined, '', 'short', 'has space in it', 'x'.repeat(129)]) {
    const h = harness();
    await rejects(h.coordinator.join('t-1', 'Bearer x', key), 'SERVER_BOOKING_IDEMPOTENCY_KEY_INVALID', 400);
  }

  // Refusals never store an attempt and never reach Viva.
  for (const [rating, code, status] of [[3.8, 'LEVEL_NOT_ALLOWED', 403], [2.79999, 'LEVEL_NOT_ALLOWED', 403], [null, 'PLAYER_LEVEL_REQUIRED', 403]] as const) {
    const h = harness({ rating });
    const result = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok('refused' in result);
    assert.equal(result.code, code);
    assert.equal(result.httpStatus, status);
    assert.equal(h.calls.booking + h.calls.checkout + h.store.writes, 0);
  }
  {
    const h = harness({ player: { status: 'UNAVAILABLE' } });
    const result = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok('refused' in result && result.code === 'LEVEL_CHECK_UNAVAILABLE' && result.httpStatus === 503);
    assert.equal(h.store.writes, 0);
  }
  {
    const h = harness({ otherRefusal: { code: 'GENDER_NOT_ALLOWED', message: 'Этот турнир предназначен для женщин.' } });
    const result = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok('refused' in result && result.code === 'GENDER_NOT_ALLOWED' && result.httpStatus === 403);
    assert.equal(h.calls.booking + h.store.writes, 0);
  }
  // Missing target or price: fail closed before any write.
  {
    const h = harness({ price: null });
    await rejects(h.coordinator.join('t-1', 'Bearer x', KEY), 'SERVER_BOOKING_PRICE_NOT_CONFIGURED', 409);
    const g = harness({ exerciseId: null });
    await rejects(g.coordinator.join('t-1', 'Bearer x', KEY), 'SERVER_BOOKING_TARGET_INVALID', 409);
    assert.equal(h.store.writes + g.store.writes + h.calls.booking + g.calls.booking, 0);
  }

  // Happy path: one booking, one checkout, payment link, decision snapshot kept.
  {
    const h = harness({ rating: 2.8 });
    const view = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in view));
    assert.equal(view.state, 'PAYMENT_PENDING');
    assert.equal(view.bookingId, 'booking-1');
    assert.equal(view.paymentUrl, 'https://pay.example/tx-1');
    assert.equal(view.toPayMinor, 150000);
    assert.equal(view.levelDecision.reasonCode, 'LEVEL_ALLOWED_WITH_TOLERANCE');
    assert.deepEqual(h.calls.operationKeys, ['t-1:client-1:1']);
    assert.deepEqual(h.calls.checkoutInputs[0], { clientId: 'client-1', clientPhone: '79990000000', studioId: 'studio-1', bookingId: 'booking-1', price: PRICE });
    const stored = h.store.rows.get('t-1:client-1')!;
    assert.equal(stored.startDecision.ruleVersion, view.levelDecision.ruleVersion);
    // Retry with the same key: no second booking or checkout.
    const again = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in again) && again.state === 'PAYMENT_PENDING');
    assert.equal(h.calls.booking, 1);
    assert.equal(h.calls.checkout, 1);
    // A started payment keeps its start decision even if the player is now out of range.
    h.state.rating = 3.9;
    const kept = await h.coordinator.join('t-1', 'Bearer x', 'another-key-0002');
    assert.ok(!('refused' in kept) && kept.state === 'PAYMENT_PENDING');
    assert.equal(h.calls.booking, 1);
  }
  // 100% discount: confirmed without a payment link.
  {
    const h = harness({ price: { ...PRICE, discountMinor: PRICE.baseAmountMinor, discountReason: 'Бесплатно для участника' } });
    const view = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in view));
    assert.equal(view.state, 'CONFIRMED');
    assert.equal(view.toPayMinor, 0);
    assert.equal(view.paymentUrl, null);
  }
  // Concurrent joins for the same player: exactly one provider booking.
  {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ booking: async () => { await gate; return { outcome: 'CREATED', bookingId: 'booking-1' }; } });
    const first = h.coordinator.join('t-1', 'Bearer x', KEY);
    await new Promise((resolve) => setImmediate(resolve));
    const second = h.coordinator.join('t-1', 'Bearer x', 'other-key-0003');
    await rejects(second, 'SERVER_BOOKING_IN_PROGRESS', 409);
    const sameKey = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in sameKey) && sameKey.state === 'BOOKING');
    release();
    const done = await first;
    assert.ok(!('refused' in done) && done.state === 'PAYMENT_PENDING');
    assert.equal(h.calls.booking, 1);
    assert.equal(h.calls.checkout, 1);
  }
  // Ambiguous provider answer: never reposted; resolved only by a read.
  {
    const h = harness({ booking: async () => ({ outcome: 'UNKNOWN', reasonCode: 'TRANSPORT_ERROR' }) });
    const first = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in first) && first.state === 'BOOKING_UNKNOWN');
    const stillUnknown = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in stillUnknown) && stillUnknown.state === 'BOOKING_UNKNOWN');
    assert.equal(h.calls.booking, 1);
    h.state.find = async () => ({ bookingId: 'booking-late' });
    const recovered = await h.coordinator.status('t-1', 'Bearer x');
    assert.equal(recovered.state, 'BOOKED');
    assert.equal(recovered.bookingId, 'booking-late');
    const paid = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in paid) && paid.state === 'PAYMENT_PENDING');
    assert.equal(h.calls.booking, 1);
    assert.equal(h.calls.checkout, 1);
  }
  // Provider throws: same as unknown.
  {
    const h = harness({ booking: async () => { throw new Error('socket hang up'); } });
    const view = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in view) && view.state === 'BOOKING_UNKNOWN' && view.errorCode === 'PROVIDER_EXCEPTION');
  }
  // Crashed while BOOKING: after the lease a read decides; not found stays unknown.
  {
    const h = harness();
    const now = '2026-11-17T12:00:00.000Z';
    await h.store.insert({ _id: 't-1:client-1', schemaVersion: 1, tournamentId: 't-1', clientId: 'client-1', exerciseId: 'exercise-1',
      studioId: 'studio-1', idempotencyKey: KEY, generation: 1, revision: 1, state: 'BOOKING',
      startDecision: { ...(await harness().coordinator.join('t-1', 'b', KEY) as any).levelDecision }, providerDecision: null,
      price: PRICE, bookingId: null, payment: null, errorCode: null, createdAt: now, updatedAt: now });
    const inLease = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in inLease) && inLease.state === 'BOOKING');
    assert.equal(h.calls.find, 0);
    h.tick(TOURNAMENT_SERVER_BOOKING_LEASE_MS);
    const after = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in after) && after.state === 'BOOKING_UNKNOWN' && after.errorCode === 'BOOKING_NOT_VISIBLE');
    assert.equal(h.calls.booking, 0);
  }
  // Provider rejection ends the attempt; a new join starts generation 2 with a fresh decision.
  {
    let attempt = 0;
    const h = harness({ booking: async () => (++attempt === 1 ? { outcome: 'REJECTED', reasonCode: 'CAPACITY_FULL' } : { outcome: 'CREATED', bookingId: 'booking-2' }) });
    const failed = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in failed) && failed.state === 'FAILED' && failed.errorCode === 'CAPACITY_FULL');
    h.state.rating = 3.9;
    const refused = await h.coordinator.join('t-1', 'Bearer x', 'next-key-0004');
    assert.ok('refused' in refused && refused.code === 'LEVEL_NOT_ALLOWED');
    h.state.rating = 3.4;
    const second = await h.coordinator.join('t-1', 'Bearer x', 'next-key-0005');
    assert.ok(!('refused' in second) && second.generation === 2 && second.state === 'PAYMENT_PENDING');
    assert.deepEqual(h.calls.operationKeys, ['t-1:client-1:1', 't-1:client-1:2']);
  }
  // Admitted but not yet sent: the decision is re-evaluated before the provider call.
  {
    const h = harness();
    const view = await harness().coordinator.join('t-1', 'b', KEY) as any;
    const now = '2026-11-17T12:00:00.000Z';
    await h.store.insert({ _id: 't-1:client-1', schemaVersion: 1, tournamentId: 't-1', clientId: 'client-1', exerciseId: 'exercise-1',
      studioId: 'studio-1', idempotencyKey: KEY, generation: 1, revision: 1, state: 'ADMITTED', startDecision: view.levelDecision,
      providerDecision: null, price: PRICE, bookingId: null, payment: null, errorCode: null, createdAt: now, updatedAt: now });
    h.state.rating = 3.9;
    const rejected = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in rejected) && rejected.state === 'REJECTED' && rejected.errorCode === 'LEVEL_NOT_ALLOWED');
    assert.equal(h.calls.booking, 0);
  }
  // Checkout ambiguity and amount mismatch: never a second checkout.
  {
    const h = harness({ checkout: async () => { throw new Error('timeout'); } });
    const view = await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in view) && view.state === 'PAYMENT_UNKNOWN' && view.errorCode === 'CHECKOUT_EXCEPTION');
    await h.coordinator.join('t-1', 'Bearer x', KEY);
    assert.equal(h.calls.checkout, 1);
    const g = harness({ checkout: async () => ({ outcome: 'CREATED', transactionId: 'tx', paymentUrl: 'https://pay.example', toPayMinor: 1, paid: false, expiresAt: null }) });
    const mismatch = await g.coordinator.join('t-1', 'Bearer x', KEY);
    assert.ok(!('refused' in mismatch) && mismatch.state === 'PAYMENT_UNKNOWN' && mismatch.errorCode === 'CHECKOUT_AMOUNT_MISMATCH');
  }
  // Status without an attempt.
  {
    const h = harness();
    await rejects(h.coordinator.status('t-1', 'Bearer x'), 'SERVER_BOOKING_NOT_FOUND', 404);
  }

  // Viva adapter: booking-create is not configured and makes no call.
  {
    const deps = { listed: 0, checkouts: [] as any[] };
    const adapter = new VivaAdminTournamentBookingAdapter({
      listExerciseBookings: async () => {
        deps.listed += 1;
        return [
          { id: 'b-cancelled', exerciseId: 'exercise-1', client: { id: 'client-1' }, isCancelled: true },
          { id: 'b-other', exerciseId: 'exercise-1', client: { id: 'client-2' } },
          { bookingId: 'b-1', exercise: { id: 'exercise-1' }, clientId: 'client-1', isCancelled: false }
        ];
      },
      createBookingPaymentCheckout: async (input) => { deps.checkouts.push(input); return { clientId: 'client-1', productId: 'p', bookingIds: input.bookingIds, paid: input.amountMinor === 0, toPayMinor: input.amountMinor, transactionId: 'tx', paymentUrl: input.amountMinor ? 'https://pay.example' : undefined }; }
    });
    assert.deepEqual(await adapter.createBooking({ clientId: 'client-1', exerciseId: 'exercise-1', phone: '79990000000' }),
      { outcome: 'REJECTED', reasonCode: 'PROVIDER_BOOKING_METHOD_NOT_CONFIGURED' });
    const wired = new VivaAdminTournamentBookingAdapter({
      createExerciseBooking: async (input) => (input.exerciseId === 'boom' ? Promise.reject(new Error('x')) : { outcome: 'CREATED', bookingId: 'b-9' }),
      listExerciseBookings: async () => [], createBookingPaymentCheckout: async () => { throw new Error('unused'); }
    });
    assert.deepEqual(await wired.createBooking({ clientId: 'c', exerciseId: 'e', phone: '7' }), { outcome: 'CREATED', bookingId: 'b-9' });
    assert.deepEqual(await wired.createBooking({ clientId: 'c', exerciseId: 'boom', phone: '7' }), { outcome: 'UNKNOWN', reasonCode: 'PROVIDER_EXCEPTION' });
    assert.equal(deps.listed, 0);
    assert.deepEqual(await adapter.findBooking({ clientId: 'client-1', exerciseId: 'exercise-1' }), { bookingId: 'b-1' });
    assert.equal(await adapter.findBooking({ clientId: 'client-3', exerciseId: 'exercise-1' }), null);
    const free = await adapter.createCheckout({ clientId: 'client-1', clientPhone: '79990000000', studioId: 'studio-1', bookingId: 'b-1',
      price: { baseAmountMinor: 150000, discountMinor: 150000, discountReason: 'Бесплатно', productId: null } });
    assert.ok(free.outcome === 'CREATED' && free.paid && free.toPayMinor === 0);
    assert.deepEqual(deps.checkouts[0], { clientPhone: '79990000000', clientId: 'client-1', studioId: 'studio-1', bookingIds: ['b-1'],
      paymentMethod: 'SMS', amountMinor: 0, baseAmountMinor: 150000, discountAmountMinor: 150000, discountReason: 'Бесплатно' });
    const ambiguous = new VivaAdminTournamentBookingAdapter({
      listExerciseBookings: async () => [{ id: 'a', exerciseId: 'e', clientId: 'c' }, { id: 'b', exerciseId: 'e', clientId: 'c' }],
      createBookingPaymentCheckout: async () => { throw new Error('timeout'); }
    });
    assert.equal(await ambiguous.findBooking({ clientId: 'c', exerciseId: 'e' }), 'UNAVAILABLE');
    assert.deepEqual(await ambiguous.createCheckout({ clientId: 'c', clientPhone: '7', studioId: 's', bookingId: 'b', price: PRICE }),
      { outcome: 'UNKNOWN', reasonCode: 'CHECKOUT_RESULT_UNKNOWN' });
    const failing = new VivaAdminTournamentBookingAdapter({
      listExerciseBookings: async () => { throw new Error('down'); },
      createBookingPaymentCheckout: async () => { throw new Error('x'); }
    });
    assert.equal(await failing.findBooking({ clientId: 'c', exerciseId: 'e' }), 'UNAVAILABLE');
  }

  console.log('tournament-server-booking tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
