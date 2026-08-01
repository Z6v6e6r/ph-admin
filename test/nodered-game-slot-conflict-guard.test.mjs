import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREPARE_SLOT_CONFLICT_FUNCTION_SOURCE,
  RESOLVE_SLOT_CONFLICT_FUNCTION_SOURCE,
  prepareSlotConflictLookup,
  resolveSlotConflictLookup,
} from '../scripts/nodered-game-slot-conflict-guard.mjs';

const baseRequest = ({
  path = '/lk/games/slot-conflicts/check',
  status,
  paid,
  paymentRef = 'pay-new',
  gameId = 'game-new',
  vivaExerciseId = 'viva-new',
} = {}) => ({
  req: { path, query: {} },
  payload: {
    id: gameId,
    ...(status ? { status } : {}),
    booking: {
      studioId: 'station-1',
      roomId: 'court-1',
      date: '2026-08-01',
      timeFrom: '14:00',
      timeTo: '16:00',
      vivaExerciseId,
    },
    payment: { paymentRef, ...(typeof paid === 'boolean' ? { paid } : {}) },
    metadata: { paymentRef },
  },
});

const activeGame = ({
  id = 'game-existing',
  studioId = 'station-1',
  roomId = 'court-1',
  date = '2026-08-01',
  timeFrom = '14:30',
  timeTo = '15:30',
  status = 'PAID',
  archived = false,
  paymentRef = 'pay-existing',
  vivaExerciseId = 'viva-existing',
} = {}) => ({
  id,
  status,
  archived,
  booking: {
    studioId,
    roomId,
    date,
    timeFrom,
    timeTo,
    startTs: Date.parse(`${date}T${timeFrom}:00+03:00`),
    endTs: Date.parse(`${date}T${timeTo}:00+03:00`),
    vivaExerciseId,
  },
  payment: { paymentRef },
});

const afterLookup = (request, rows) => {
  const [lookup] = prepareSlotConflictLookup(request);
  assert.ok(lookup);
  lookup.payload = rows;
  return resolveSlotConflictLookup(lookup);
};

test('Mongo query uses strict interval overlap and exact court identity', () => {
  const [lookup, error] = prepareSlotConflictLookup(baseRequest());
  assert.equal(error, null);
  assert.equal(lookup.payload['booking.studioId'], 'station-1');
  assert.equal(lookup.payload['booking.roomId'], 'court-1');
  assert.equal(lookup.payload['booking.date'], '2026-08-01');
  assert.deepEqual(lookup.payload['booking.startTs'], {
    $lt: Date.parse('2026-08-01T16:00:00+03:00'),
  });
  assert.deepEqual(lookup.payload['booking.endTs'], {
    $gt: Date.parse('2026-08-01T14:00:00+03:00'),
  });
  assert.ok(lookup.payload.$nor.some((item) => item.id === 'game-new'));
  assert.ok(lookup.payload.$nor.some((item) => item['payment.paymentRef'] === 'pay-new'));
  assert.ok(lookup.payload.$nor.some((item) => item['booking.vivaExerciseId'] === 'viva-new'));
});

test('partial overlap is rejected with 409 before payment', () => {
  const [proceed, response] = afterLookup(baseRequest(), [activeGame()]);
  assert.equal(proceed, null);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'GAME_SLOT_CONFLICT');
  assert.equal(response.payload.conflict.id, 'game-existing');
});

test('exact, contained, and enveloping intervals are rejected', () => {
  for (const record of [
    activeGame({ timeFrom: '14:00', timeTo: '16:00' }),
    activeGame({ timeFrom: '14:30', timeTo: '15:00' }),
    activeGame({ timeFrom: '13:00', timeTo: '17:00' }),
  ]) {
    const [, response] = afterLookup(baseRequest(), [record]);
    assert.equal(response.statusCode, 409);
    assert.equal(response.payload.code, 'GAME_SLOT_CONFLICT');
  }
});

test('adjacent intervals are allowed', () => {
  const [proceed, response] = afterLookup(baseRequest(), [activeGame({
    timeFrom: '12:00',
    timeTo: '14:00',
  })]);
  assert.equal(proceed, null);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.available, true);
});

test('other station, court, or date does not conflict', () => {
  for (const record of [
    activeGame({ studioId: 'station-2' }),
    activeGame({ roomId: 'court-2' }),
    activeGame({ date: '2026-08-02' }),
  ]) {
    const [, response] = afterLookup(baseRequest(), [record]);
    assert.equal(response.statusCode, 200);
  }
});

test('cancelled and archived games do not occupy the court', () => {
  for (const record of [
    activeGame({ status: 'CANCELLED' }),
    activeGame({ status: 'CANCELED' }),
    activeGame({ status: 'ARCHIVED' }),
    activeGame({ archived: true }),
  ]) {
    const [, response] = afterLookup(baseRequest(), [record]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.available, true);
  }

  const metadataCancelled = activeGame();
  metadataCancelled.metadata = { rawStatus: 'cancelled' };
  const [, response] = afterLookup(baseRequest(), [metadataCancelled]);
  assert.equal(response.statusCode, 200);
});

test('same game, paymentRef, or Viva exercise is idempotent', () => {
  for (const record of [
    activeGame({ id: 'game-new' }),
    activeGame({ paymentRef: 'pay-new' }),
    activeGame({ vivaExerciseId: 'viva-new' }),
  ]) {
    const [, response] = afterLookup(baseRequest(), [record]);
    assert.equal(response.statusCode, 200);
  }
});

test('post-payment overlap is preserved for conflict review instead of being dropped', () => {
  const request = baseRequest({
    path: '/lk/games/payment/confirm',
    status: 'PAID',
    paid: true,
  });
  const [proceed, response] = afterLookup(request, [activeGame()]);
  assert.equal(response, null);
  assert.equal(proceed.payload.status, 'CONFLICT_REVIEW');
  assert.equal(proceed.payload.payment.paid, true);
  assert.equal(
    proceed.payload.metadata.slotConflictReview.code,
    'GAME_SLOT_CONFLICT_AFTER_PAYMENT',
  );
  assert.equal(proceed.payload.metadata.slotConflictReview.conflict.id, 'game-existing');
});

test('invalid or inverted interval fails closed', () => {
  const request = baseRequest();
  request.payload.booking.timeTo = '13:00';
  const [lookup, response] = prepareSlotConflictLookup(request);
  assert.equal(lookup, null);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'INVALID_GAME_SLOT');
});

test('exported source runs in Node-RED Function-node shape', () => {
  const prepare = new Function('msg', PREPARE_SLOT_CONFLICT_FUNCTION_SOURCE);
  const resolve = new Function('msg', RESOLVE_SLOT_CONFLICT_FUNCTION_SOURCE);
  const [lookup] = prepare(baseRequest());
  lookup.payload = [activeGame()];
  const [, response] = resolve(lookup);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'GAME_SLOT_CONFLICT');
});
