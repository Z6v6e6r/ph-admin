const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MongoClient } = require('mongodb');
const { actor, auth, ownerToken } = require('./identity.cjs');

const phase = process.argv[2];
assert.ok(['seed', 'recover'].includes(phase));
const uri = process.env.TOURNAMENTS_MONGODB_URI;
assert.equal(new URL(uri).hostname, '127.0.0.1');
const dbName = 'rating_recovery_fixture';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(dbName);
const tournaments = db.collection('custom_tournaments');
const ops = db.collection('operations');
const handoff = process.env.RATING_CHECKPOINT;
const projectionOrigin = 'http://127.0.0.1:' + process.env.RATING_LK2_PORT;
const completeEvent = 'exercise-complete';
const abortEvent = 'exercise-abort';
const freshEvent = 'exercise-fresh';
const serverEvent = 'exercise-server-booking';
const bookingId = 'synthetic-original-booking';
const pauseCode = 'TOURNAMENT_NEW_OPERATIONS_PAUSED';
const studioId = 'synthetic-studio';
const directionId = 2617;
const typeId = 839;
const productId = '11111111-1111-4111-8111-111111111111';
const tariffProductId = 'synthetic-tariff';
const startsAt = '2099-11-18T07:00:00.000Z';
const serviceDate = '2099-11-18';
let cup, router, origin, providerPosts = 0;

function managed(exerciseId, operationId, clientSubscriptionId) {
  const subscription = {
    subscriptionId: clientSubscriptionId, clientId: actor.clientId, productId,
    purchaseDate: '2026-10-01', activationDate: '2026-10-01', expirationDate: '2099-12-31',
    status: 'ACTIVE', visitsLeft: 3,
  };
  const rule = {
    productId, maxActiveBookings: 8, freeGameMinutesPerDay: 60, gameOverageDiscountPercent: 30,
    groupTrainingDiscountPercent: 50, tournamentDiscountPercent: 50,
  };
  const target = {
    resolutionSource: 'SERVER', eventId: exerciseId, category: 'TOURNAMENT',
    externalEventTypeId: 'viva:direction:' + directionId + ':type:' + typeId,
    productTypeId: null, stationId: studioId, roomId: 'fixture-room', directionId,
    durationMinutes: 60, startsAt, basePriceMinor: 100000, currency: 'RUB',
    priceSource: 'VIVA_EXISTING_TARIFF', priceProductId: tariffProductId,
    subscriptionValidity: {
      status: subscription.status, activationDate: subscription.activationDate, expirationDate: subscription.expirationDate,
    },
  };
  const action = 'BOOK_TOURNAMENT';
  const tenantKey = actor.tenantKey;
  const actorClientId = actor.clientId;
  return {
    caller: 'http', category: 'tournament', action: 'book', actorClientId, exerciseId, operationId,
    operationKey: 'lk1-product:' + JSON.stringify([tenantKey, actorClientId, operationId]),
    limitMode: 'shared_day', tenantKey, clientSubscriptionId, serviceDate, authHeader: auth, studioId,
    managedAction: action, lk1FreeGateCleared: true,
    lk1ProductIdentity: {
      actorClientId, subscriptionId: clientSubscriptionId, tenantKey, productId,
      name: 'Synthetic plan', purchaseDate: subscription.purchaseDate, subscription,
    },
    lk1MoneyOwnership: { actorClientId, exerciseId, observedAt: Date.now(), subscription },
    lk1TariffProof: {
      source: 'VIVA_EXISTING_TARIFF', kind: 'EVENT_ONE_TIME', productId: tariffProductId,
      amountMinor: 100000, stationId: studioId, roomId: 'fixture-room', durationMinutes: 60,
      startsAt, observedAt: Date.now(),
    },
    lk1: {
      rule, purchaseDate: subscription.purchaseDate, target,
      fingerprint: JSON.stringify({
        tenantKey, actorClientId, clientSubscriptionId, action, rule,
        purchaseDate: subscription.purchaseDate, target,
      }),
      dailyVisitPolicyVersion: 1,
      decision: { eligible: true, subscriptionVisitCount: 1, benefit: { kind: 'FREE_ENTITLEMENT', finalPriceMinor: 0 } },
    },
  };
}

const completed = managed(completeEvent, 'synthetic-operation-complete', 'synthetic-sub-complete');
const aborted = managed(abortEvent, 'synthetic-operation-abort', 'synthetic-sub-abort');
const fresh = managed(freshEvent, 'synthetic-operation-fresh', 'synthetic-sub-fresh');
const server = managed(serverEvent, 'synthetic-operation-server', 'synthetic-sub-server');
const row = ctx => ops.findOne({ _id: ctx.operationKey });
const tournament = ctx => tournaments.findOne({ id: ctx.exerciseId });
const owner = async ctx => {
  const journal = (await tournament(ctx)).details.booking.pendingJoinPayments;
  assert.equal(journal.length, 1, ctx.exerciseId);
  return journal[0];
};
const guardId = ctx => 'lk1-daily-visit:' + JSON.stringify([ctx.tenantKey, ctx.clientSubscriptionId, serviceDate]);
const guard = ctx => ops.findOne({ _id: guardId(ctx) });

function child(file) {
  return fork(path.join(__dirname, file), { serialization: 'advanced', execArgv: [] });
}

async function receive(proc, message) {
  const abort = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(12000), abort.signal]);
  try {
    const reply = once(proc, 'message', { signal });
    const exited = once(proc, 'exit', { signal }).then(([code]) => {
      throw new Error('Fixture process ' + proc.pid + ' exited: ' + code);
    });
    if (message !== undefined) proc.send(message);
    const [result] = await Promise.race([reply, exited]);
    assert.equal(result.error, undefined);
    return result;
  } finally {
    abort.abort();
  }
}

async function stop(proc) {
  if (!proc?.connected) return;
  const exit = once(proc, 'exit');
  proc.disconnect();
  proc.kill();
  await exit;
}

async function route(msg) {
  const { output } = await receive(router, msg);
  const selected = output.findIndex(Boolean);
  assert.ok(selected >= 0);
  return { selected, msg: output[selected] };
}
const step = (ctx, current, payload) => route({ _subscriptionBooking: { ...ctx, step: current }, payload });
const stage = effect => effect.msg._subscriptionBooking.step;
const expect = (effect, expected) => assert.equal(stage(effect), expected, JSON.stringify(effect.msg.payload));

async function mongo(effect) {
  const { selected, msg } = effect;
  if (selected === 1) msg.payload = await ops.find(msg.payload).toArray();
  else if (selected === 2) msg.payload = await ops.insertOne(Array.isArray(msg.payload) ? msg.payload[0] : msg.payload);
  else if (selected === 3) msg.payload = await ops.updateOne(...msg.payload);
  else assert.fail('Unexpected Mongo effect index ' + selected);
  return route(msg);
}

async function post(ref, suffix, payload, headers = {}) {
  const requestHeaders = new Headers({ authorization: auth, 'content-type': 'application/json' });
  for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
  const response = await fetch(origin + '/api/tournaments/' + ref + suffix, {
    method: 'POST', headers: requestHeaders,
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(6000),
  });
  return { status: response.status, body: await response.json() };
}

async function cupEffect(effect, { loseAck = false } = {}) {
  const { selected, msg } = effect;
  const url = new URL(msg.url);
  assert.equal(selected, 0);
  assert.equal(url.origin, 'https://cup.fixture');
  assert.equal(msg.method, 'POST');
  assert.equal(msg.followRedirects, false);
  const prefix = '/api/tournaments/';
  assert.ok(url.pathname.startsWith(prefix));
  const suffixAt = url.pathname.indexOf('/', prefix.length);
  const { status, body } = await post(url.pathname.slice(prefix.length, suffixAt), url.pathname.slice(suffixAt),
    msg.payload, msg.headers);
  if (status >= 400) console.log(JSON.stringify({ cupHttp: url.pathname, status, body }));
  if (loseAck) {
    assert.equal(status, 201);
    return route({ ...msg, error: { message: 'fixture lost CUP HTTP ACK' } });
  }
  return route({ ...msg, statusCode: status, payload: body, responseUrl: msg.url });
}

async function replyGet(effect, payload) {
  assert.equal(effect.selected, 0);
  assert.equal(effect.msg.method, 'GET');
  return route({ ...effect.msg, payload, statusCode: 200, responseUrl: effect.msg.url });
}

async function prepare(ctx) {
  const insertAck = await ops.insertOne({ _id: ctx.operationKey, ...ctx, state: 'PREPARED', attempts: 0 });
  let effect = await step(ctx, 'operation_insert', insertAck);
  for (const marker of ['lk1_daily_visit_claim', 'lk1_daily_visit_read']) {
    expect(effect, marker);
    effect = await mongo(effect);
  }
  expect(effect, 'tournament_admission');
  effect = await cupEffect(effect);
  expect(effect, 'operation_preaccept');
  effect = await mongo(effect);
  expect(effect, 'exercise_recheck');
  const subscription = ctx.lk1ProductIdentity.subscription;
  effect = await replyGet(effect, {
    id: ctx.exerciseId, typeId, directionId, studioId, roomId: 'fixture-room',
    durationMinutes: 60, timeFrom: startsAt, availableClientSubscriptions: [subscription],
  });
  for (let i = 0; i < 5 && ['product_owned_recheck', 'lk1_money_owned_subscriptions'].includes(stage(effect)); i++) {
    effect = await replyGet(effect, { content: [subscription], totalElements: 1, last: true });
  }
  expect(effect, 'lk1_event_tariff');
  return replyGet(effect, {
    content: [{ id: tariffProductId, type: 'SERVICE', cost: ctx === aborted ? 120000 : 100000 }],
    totalElements: 1, last: true,
  });
}

async function saveAbort() {
  const effect = await prepare(aborted);
  expect(effect, 'tournament_abort_saved');
  const next = await mongo(effect);
  expect(next, 'tournament_abort_read');
  const saved = await row(aborted);
  assert.equal(saved.state, 'FAILED');
  assert.equal(saved.tournamentAbort.acknowledged, false);
  assert.equal(saved.bookingId, undefined);
  assert.equal((await owner(aborted)).state, 'PROVIDER_CREATE_PENDING');
}

async function saveComplete() {
  let effect = await prepare(completed);
  expect(effect, 'tournament_dispatch_saved');
  effect = await mongo(effect);
  expect(effect, 'booking_create');
  assert.equal(effect.msg.method, 'POST');
  assert.equal(effect.msg.url, 'https://api.vivacrm.ru/api/v1/exercises/' + completeEvent + '/bookings');
  const booking = {
    id: bookingId, exerciseId: completeEvent, clientId: actor.clientId, paymentType: 'SUBSCRIPTION',
    clientSubscriptionId: completed.clientSubscriptionId, count: 1, isCancelled: false,
  };
  providerPosts++;
  effect = await route({ ...effect.msg, payload: booking, statusCode: 201, responseUrl: effect.msg.url });
  expect(effect, 'operation_accept');
  effect = await mongo(effect);
  expect(effect, 'confirmation_bookings');
  effect = await replyGet(effect, { content: [booking], totalElements: 1, last: true });
  expect(effect, 'operation_confirm');
  effect = await mongo(effect);
  expect(effect, 'tournament_completion');
  assert.equal((await row(completed)).state, 'CONFIRMED');
  assert.equal((await owner(completed)).state, 'PROVIDER_CREATE_PENDING');
}

async function replay(ctx) {
  // Profile is the first router step after the HTTP prepare function.
  const { caller, action, tenantKey, clientSubscriptionId, operationId, exerciseId, authHeader } = ctx;
  const lookup = await route({
    _subscriptionBooking: { caller, action, tenantKey, clientSubscriptionId, operationId, exerciseId, authHeader,
      step: 'profile' },
    payload: { id: actor.clientId, phone: actor.phoneNorm }, statusCode: 200,
  });
  expect(lookup, 'lk1_ingress_operation_find');
  return mongo(lookup);
}

async function driveActiveBookingReplay() {
  let effect = await replay(completed);
  for (let i = 0; i < 10; i++) {
    if (effect.selected === 1) {
      effect = await mongo(effect);
      continue;
    }
    if (stage(effect) !== 'lk1_seat_recovery') return effect;
    assert.equal(effect.selected, 0);
    assert.equal(effect.msg.url,
      'https://api.vivacrm.ru/api/v1/clients/' + actor.clientId + '/bookings/' + bookingId);
    effect = await replyGet(effect, { id: bookingId, clientId: actor.clientId, exerciseId: completeEvent,
      paymentType: 'SUBSCRIPTION', clientSubscriptionId: completed.clientSubscriptionId, isCancelled: false });
  }
  assert.fail('LK1 did not finish booking readback');
}

async function canonical() {
  const report = await fetch(projectionOrigin + '/rehearsal', { signal: AbortSignal.timeout(5000) });
  assert.equal(report.status, 200);
  const lk2 = await report.json();
  const states = db.collection('player_rating_state');
  const { readCupPlayerLevels } = await import(pathToFileURL(path.join(process.env.RATING_LK1_SOURCE, 'scripts/lib/cupPlayerLevel.mjs')).href);
  const state = await states.findOne({ clientId: actor.clientId });
  const [lk1] = await readCupPlayerLevels(db, [actor.clientId]);
  assert.equal(state.ownership, 'CUP_CANONICAL');
  assert.equal(lk1.source, 'CUP_CANONICAL');
  assert.equal(lk1.status, 'RATED');
  assert.equal(state.ratingNumeric, 3.375);
  assert.equal(lk1.ratingNumeric, state.ratingNumeric);
  assert.equal(lk2.currentLevel.numericValue, state.ratingNumeric);
  assert.equal(lk2.currentLevel.code, state.rating);
  assert.equal(lk2.events.length, 1);
  assert.equal(lk2.events[0].source_event_id, state.lastEventId);
  return {
    value: state.ratingNumeric, grade: state.rating, event: state.lastEventId,
    lk1Version: lk1.version, lk2Event: lk2.events[0], lk2PlayerId: lk2.currentLevel.playerId,
  };
}

async function seed() {
  assert.deepEqual(await db.listCollections().toArray(), [], 'Seed requires an empty synthetic database');
  for (const ctx of [completed, aborted, fresh, server]) {
    await tournaments.insertOne({
      id: ctx.exerciseId, slug: ctx.exerciseId, source: 'CUSTOM', gender: 'MIXED', accessLevels: ['3.375'],
      levelTolerance: 0, updatedAt: '2026-11-18T00:00:00.000Z', createdAt: '2026-11-18T00:00:00.000Z',
      name: ctx.exerciseId, status: 'REGISTRATION', maxPlayers: 1,
      participants: [], waitlist: [], allowedManagerPhones: [], skin: {}, mechanics: { enabled: false, config: {} },
      details: { booking: { vivaExerciseId: ctx.exerciseId, vivaStudioId: studioId, vivaWidgetId: actor.tenantKey, pendingJoinPayments: [],
        ...(ctx === server ? { serverBooking: { baseAmountMinor: 100000, discountMinor: 100000,
          discountReason: 'Synthetic fully discounted server booking' } } : {}) } },
    });
  }
  const { eventId } = await receive(cup, 'seed-rating');
  const level = await canonical();
  assert.equal(level.event, eventId);
  await saveAbort();
  await saveComplete();
  assert.equal(providerPosts, 1);
  const checkpoint = {
    pids: { cup: cup.pid, lk1: router.pid },
    level, providerPosts,
    complete: { ownerId: (await owner(completed)).transactionId, requestId: completed.operationId, bookingId },
    abort: { ownerId: (await owner(aborted)).transactionId, requestId: aborted.operationId },
  };
  writeFileSync(handoff, JSON.stringify(checkpoint, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ phase, checkpoint }));
}

async function recover() {
  const checkpoint = JSON.parse(readFileSync(handoff));
  const level = await canonical();
  assert.deepEqual(level, checkpoint.level);
  assert.equal((await owner(completed)).transactionId, checkpoint.complete.ownerId);
  assert.equal((await owner(aborted)).transactionId, checkpoint.abort.ownerId);
  assert.equal((await owner(completed)).state, 'PROVIDER_CREATE_PENDING');
  assert.equal((await owner(aborted)).state, 'PROVIDER_CREATE_PENDING');

  const admission = await post(freshEvent, '/subscription-admission', {
    operationId: fresh.operationId, clientSubscriptionId: fresh.clientSubscriptionId,
  });
  const checkout = await post(freshEvent, '/checkout', { productId: 'one-time', source: 'one-time' },
    { 'idempotency-key': 'synthetic-paid-fresh' });
  const paused = await step(fresh, 'operation_insert', { acknowledged: true, insertedId: fresh.operationKey });
  for (const result of [admission, checkout, { status: paused.msg.statusCode, body: paused.msg.payload }]) {
    assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(result.body.code ?? result.body.details?.code, pauseCode);
  }
  assert.deepEqual((await tournament(fresh)).details.booking.pendingJoinPayments, []);
  assert.equal(await row(fresh), null);
  assert.equal(await guard(fresh), null);
  console.log(JSON.stringify({ scenario: 'fresh-checkout-and-subscription', status: 'PASS', code: pauseCode,
    cupCheckout: checkout.status, cupSubscription: admission.status, lk1: paused.msg.statusCode }));
  const serverResponse = await post(serverEvent, '/server-booking', {}, { 'idempotency-key': 'synthetic-new-server-booking' });
  const attempts = await db.collection('tournament_server_booking_attempts_v1').countDocuments();
  assert.equal(serverResponse.status, 503);
  assert.equal(serverResponse.body.code, pauseCode);
  assert.equal(attempts, 0);
  console.log(JSON.stringify({ scenario: 'fresh-server-booking-enabled', status: 'PASS',
    response: serverResponse, attempts }));

  // Changing the event rule after reservation must not force repeat admission on recovery.
  await tournaments.updateMany({ id: { $in: [completeEvent, abortEvent] } }, { $set: { accessLevels: ['D'] } });

  const wrong = await post(completeEvent, '/subscription-admission/complete', {
    operationId: completed.operationId, ownerOperationId: checkpoint.abort.ownerId,
    clientSubscriptionId: completed.clientSubscriptionId, bookingId,
  }, { 'x-cup-integration-token': ownerToken });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.code, 'TOURNAMENT_OPERATION_BINDING_MISMATCH');

  let abort = await replay(aborted);
  expect(abort, 'tournament_abort');
  assert.equal(abort.msg.payload.ownerOperationId, checkpoint.abort.ownerId);
  abort = await cupEffect(abort);
  for (let i = 0; i < 12 && [1, 2, 3].includes(abort.selected); i++) abort = await mongo(abort);
  assert.equal(abort.msg.statusCode, 409, JSON.stringify(abort.msg.payload));
  const abortOwner = await owner(aborted);
  assert.equal(abortOwner.state, 'FAILED');
  assert.equal(abortOwner.ownerNoDispatch, true);
  assert.equal(abortOwner.transactionId, checkpoint.abort.ownerId);
  assert.equal(abortOwner.ownerCommand.requestOperationId, checkpoint.abort.requestId);
  assert.equal((await row(aborted)).tournamentAbort.cleanupComplete, true);
  assert.deepEqual((await guard(aborted)).admissionRelease, {
    operationKey: aborted.operationKey, operationId: aborted.operationId,
  });
  assert.deepEqual((await tournament(aborted)).participants, []);
  for (let repeated = await replay(aborted), i = 0; ; i++) {
    if (repeated.msg.statusCode === 409 && ![1, 2, 3].includes(repeated.selected)) break;
    assert.ok(i < 8 && [1, 2, 3].includes(repeated.selected), JSON.stringify(repeated.msg.payload));
    repeated = await mongo(repeated);
  }
  console.log(JSON.stringify({ scenario: 'abort', status: 'PASS', ownerId: abortOwner.transactionId,
    requestId: abortOwner.ownerCommand.requestOperationId, releasedSeats: 1 }));

  const completionBody = {
    operationId: checkpoint.complete.requestId, clientSubscriptionId: completed.clientSubscriptionId,
    bookingId, ownerOperationId: checkpoint.complete.ownerId,
  };
  const exactReplay = async () => {
    const completion = await driveActiveBookingReplay();
    assert.equal(completion.selected, 0, JSON.stringify(completion.msg.payload));
    expect(completion, 'tournament_completion');
    assert.deepEqual(completion.msg.payload, completionBody);
    return completion;
  };

  // A tracked operation must remain pending if CUP reports it as untracked.
  const untracked = (await exactReplay()).msg;
  const refusedAck = await route({ ...untracked, statusCode: 201, responseUrl: untracked.url,
    payload: { state: 'LEGACY_UNTRACKED', requestOperationId: completed.operationId } });
  assert.equal(refusedAck.msg.statusCode, 202);
  assert.equal((await owner(completed)).state, 'PROVIDER_CREATE_PENDING');

  // CUP completes durably even if LK1 loses its first response. The same ingress replay reads it back.
  const lostAck = await cupEffect(await exactReplay(), { loseAck: true });
  assert.equal(lostAck.msg.statusCode, 202);
  const completeOwner = await owner(completed);
  assert.equal(completeOwner.transactionId, checkpoint.complete.ownerId);
  assert.equal(completeOwner.ownerCommand.requestOperationId, checkpoint.complete.requestId);
  assert.equal(completeOwner.providerBookingId, bookingId);
  assert.equal(completeOwner.state, 'OWNER_COMPLETED');
  const participants = (await tournament(completed)).participants;
  assert.equal(participants.length, 1);
  assert.equal(participants[0].id, 'owner:' + checkpoint.complete.ownerId);
  assert.equal(participants[0].vivaBookingId, bookingId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { msg } = await cupEffect(await exactReplay());
    assert.equal(msg.statusCode, 200);
    assert.equal(msg.payload.state, 'CONFIRMED');
    assert.equal(msg.payload.bookingId, bookingId);
  }
  assert.deepEqual((await tournament(completed)).participants, participants);
  assert.deepEqual(await owner(completed), completeOwner);
  console.log(JSON.stringify({ scenario: 'complete-ingress', status: 'PASS', ownerId: completeOwner.transactionId,
    requestId: completionBody.operationId, bookingId, participants: participants.length, lostAckRecovered: true }));

  assert.deepEqual(await canonical(), level);
  assert.equal(providerPosts, 0);
  assert.equal((await receive(cup, 'provider-calls')).providerCalls, 0);
  console.log(JSON.stringify({ phase, pids: { cup: cup.pid, lk1: router.pid }, level,
    pause: 503,
    complete: { ownerId: completeOwner.transactionId, bookingId, seats: participants.length },
    abort: { ownerId: abortOwner.transactionId, released: true }, providerPosts }));
}

async function main() {
  await client.connect();
  assert.equal((await db.admin().command({ hello: 1 })).setName, 'ratingRecovery');
  cup = child('cup.cjs');
  const { ready } = await receive(cup);
  origin = 'http://127.0.0.1:' + ready;
  router = child('router.cjs');
  await (phase === 'seed' ? seed() : recover());
}

main().catch(error => {
  process.exitCode = 1;
  console.error(error);
}).finally(async () => {
  await Promise.all([stop(router), stop(cup), client.close()]);
});
