import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TRUSTED_TOURNAMENT_CLIENT } from '../src/tournaments/tournaments.types';
import { TournamentsController } from '../src/tournaments/tournaments.controller';
import { TournamentCheckoutService } from '../src/tournaments/tournament-checkout.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

const clone = <T>(value: T): T => structuredClone(value);
type Row = Record<string, any>;
const actor = { clientId: 'synthetic-client', phoneNorm: '79000000001', tenantKey: 'fixture-tenant', verified: true };
const ownerToken = 'synthetic-owner-token';
const ownProfileUrl = 'https://viva.example/end-user/api/v1/fixture-tenant/profile';
const exerciseId = 'synthetic-exercise', studioId = 'synthetic-studio';
const auth = 'Bearer synthetic-not-a-real-token';
const levels = ['3', '3.125', '3.25', '3.375', '3.5'];
function fixture() {
  const row: Row = { id: 'synthetic-tournament', slug: 'synthetic-tournament', source: 'CUSTOM', gender: 'MIXED',
    accessLevels: levels, levelTolerance: 0, updatedAt: '2026-11-18T00:00:00.000Z', maxPlayers: 8,
    status: 'REGISTRATION', participants: [], waitlist: [], details: { booking: {
      vivaExerciseId: exerciseId, vivaStudioId: studioId, vivaWidgetId: actor.tenantKey } } };
  let operation: Row | null = null, rating = 3.25;
  let verifiedActor: Row = { ...actor };
  const calls: Array<{ url: string; body?: Row }> = [];
  const bookings: Row[] = [];
  const ratingClientIds: string[] = [];
  const products: Row[] = [{ id: 'one-time', name: 'Разовое участие', type: 'SERVICE', cost: 250000 }];
  const exercise: Row = { id: exerciseId, studio: { id: studioId }, timeFrom: '2099-11-18T10:00:00+03:00', availableClientOneTimes: [] };
  const persistence: any = {
    bindTournamentSubscriptionCopay: async (_id: string, current: Row, receipt: Row) => {
      assert.equal(current.clientId, actor.clientId);
      assert.equal(operation?.transactionId, current.transactionId);
      operation!.ownerReceipt = clone(receipt);
      return 'PAYMENT_PENDING';
    },
    isEnabled: () => true,
    findCheckoutTournamentByExerciseId: async (ref: string) => ref === exerciseId
      ? { tournament: clone(row), mappingChecks: [] } : null,
    readPublicAdmissionRule: async () => ({ gender: row.gender, accessLevels: clone(row.accessLevels),
      levelTolerance: row.levelTolerance, updatedAt: row.updatedAt }),
    readTournamentCheckoutOperation: async (_id: string, phone: string, selector?: Row) => clone(operation && operation.phone === phone &&
      (!selector?.requestKey || operation.ownerCommand?.requestKey === selector.requestKey) &&
      (!selector?.transactionId || operation.transactionId === selector.transactionId) ? operation : null),
    reservePublicJoinPayment: async (_id: string, next: Row) => {
      if (operation) return null;
      operation = clone(next); row.details.booking.pendingJoinPayments = [operation]; return clone(row);
    },
    claimTournamentCheckout: async (_id: string, current: Row) => {
      if (!operation || operation.transactionId !== current.transactionId || operation.state !== 'PROVIDER_CREATE_PENDING') return false;
      operation.state = 'PROVIDER_RESULT_UNKNOWN'; operation.providerCreateAttemptedAt = '2026-11-18T12:00:00.000Z'; return true;
    },
    rejectTournamentCheckoutPreparation: async (_id: string, current: Row, code: string) => {
      if (operation && operation.transactionId === current.transactionId && operation.state === 'PROVIDER_CREATE_PENDING') {
        operation.state = 'FAILED'; operation.ownerRefusal = code; operation.ownerNoDispatch = true;
      }
    },
    completeTournamentCheckout: async () => { throw Error('completion must not be called for an untrusted caller'); },
    recordTournamentCheckoutReceipt: async (_id: string, current: Row, receipt: Row) => {
      assert.equal(operation?.transactionId, current.transactionId);
      operation!.ownerReceipt = clone(receipt);
    }
  };
  const tournaments: any = Object.create(TournamentsService.prototype);
  Object.assign(tournaments, { tournamentsPersistence: persistence, trustedRegistrationIdentities: new WeakMap(),
    requireCustomByPublicRef: async () => clone(row),
    requireCustomByPublicRefReadModel: async () => clone(row),
    requireCustomBySlug: async () => clone(row),
    vivaEndUserApiBaseUrl: 'https://viva.example', vivaEndUserRequestTimeoutMs: 5000,
    lkIdentityService: { verifyTrustedBearer: async (header: string) => {
      assert.equal(header, auth); return { actor: verifiedActor };
    }, verify: async (header: string, token: string) => {
      if (header === auth && token === ownerToken) return { actor: verifiedActor };
      throw new ForbiddenException({ code: 'INTEGRATION_TOKEN_REQUIRED' });
    } },
    playerRatingsService: { resolveCanonicalLevelByIdentity: async (identity: Row) => {
      ratingClientIds.push(identity.clientId);
      return { ratingNumeric: rating, levelLabel: String(rating) };
    } },
  });
  let copayProof: Row | undefined;
  let response: () => Promise<unknown> = async () => ({ transactionId: 'provider-original', paymentUrl: 'https://pay.example/original' });
  const make = () => {
    const service = new TournamentCheckoutService(tournaments, persistence as TournamentsPersistenceService,
      { readTournamentCopayTransaction: async () => copayProof } as never);
    (service as any).http = async (url: string, header: string, body?: Row) => {
      assert.equal(header, auth); calls.push({ url, ...(body ? { body: clone(body) } : {}) });
      if (body) return response();
      if (url.includes('/exercises/')) return clone(exercise);
      if (url.includes('/products/')) return clone(products);
      if (url.includes('/bookings/history')) return [];
      if (url.includes('/bookings?')) return clone(bookings);
      throw Error(`Unexpected synthetic request ${url}`);
    };
    return service;
  };
  return { service: make(), restart: make, row, exercise, products, calls, persistence, tournaments, bookings, ratingClientIds,
    setCopayProof: (value: Row) => { copayProof = value; },
    setVerifiedActor: (value: Row) => { verifiedActor = value; },

    setRating: (value: number) => { rating = value; }, setResponse: (value: typeof response) => { response = value; },
    get operation() { return operation; }, setOperation: (value: Row) => {
      operation = clone(value); row.details.booking.pendingJoinPayments = [operation];
    } };
}
const body = { productId: 'one-time', source: 'one-time' };
const postCalls = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.body);
const errorCode = (code: string) => (error: any) => error.getResponse?.().code === code;

test('one-time cart preserves historical Viva v2 fields, promo and return aliases; client price/level do not enter it', async () => {
  const f = fixture();
  const successUrl = 'https://padlhub.ru/tournament?paid=1', failUrl = 'https://padlhub.ru/tournament?paid=0';
  const result = await f.service.checkout(exerciseId, auth, { ...body, promoCode: 'PADEL20', successUrl, failUrl,
    amountMinor: 1, discountAmount: 249999, levelLabel: '7', clientId: 'forged', clientPhone: '12025550999' }, 'key-original');
  assert.equal(result.transactionId, 'provider-original');
  assert.deepEqual(postCalls(f), [{ url: 'https://api.vivacrm.ru/end-user/api/v2/fixture-tenant/transactions', body: {
    products: [{ id: 'one-time', name: 'Разовое участие', type: 'SERVICE', count: 1,
      bookingRequests: [{ exerciseId, client: null, comment: null, marketingAttribution: {} }] }],
    clientPhone: actor.phoneNorm, paymentMethod: 'WIDGET', exerciseId, studioId, promoCode: 'PADEL20',
    successUrl, baseRedirectUrl: successUrl, redirectUrl: successUrl, returnUrl: successUrl, successRedirectUrl: successUrl,
    failUrl, failRedirectUrl: failUrl, failureRedirectUrl: failUrl
  } }]);
});

test('subscription purchase keeps subscription identifiers and tournament booking together in the historical basket', async () => {
  const f = fixture(); f.products.splice(0, 1, { id: 'monthly-product', name: 'Абонемент и турнир', type: 'SUBSCRIPTION',
    subscriptionId: 'catalog-subscription', clientSubscriptionId: 'provider-owned-subscription' });
  await f.service.checkout(exerciseId, auth, { productId: 'monthly-product', source: 'subscription' }, 'composite-key');
  assert.deepEqual(postCalls(f)[0]?.body?.products, [{ id: 'monthly-product', name: 'Абонемент и турнир', type: 'SUBSCRIPTION', count: 1,
    bookingRequests: [{ exerciseId, client: null, comment: null, marketingAttribution: {} }],
    clientSubscriptionId: 'provider-owned-subscription', subscriptionId: 'catalog-subscription' }]);
  assert.ok(f.calls.some(c => c.url.endsWith('/products/subscriptions?exerciseId=synthetic-exercise')));
  assert.equal(postCalls(f).length, 1);
});

test('owned client-one-time can be purchased only from this authenticated exercise response', async () => {
  const f = fixture(); f.exercise.availableClientOneTimes = [{ id: 'owned-single', name: 'Моя разовая услуга', type: 'SERVICE' }];
  await f.service.checkout(exerciseId, auth, { productId: 'owned-single', source: 'client-one-time' }, 'owned-single-key');
  assert.equal(postCalls(f)[0]?.body?.products[0].id, 'owned-single');
  assert.equal(f.calls.filter(c => c.url.includes('/products/')).length, 0);
  const absent = fixture();
  await assert.rejects(absent.service.checkout(exerciseId, auth, { productId: 'someone-elses', source: 'client-one-time' }, 'unowned-key'),
    errorCode('TOURNAMENT_CHECKOUT_PRODUCT_UNAVAILABLE'));
  assert.equal(postCalls(absent).length, 0);
});

test('canonical owner level rejects forged level and invitation without a provider POST', async () => {
  const f = fixture(); f.setRating(5);
  await assert.rejects(f.service.checkout(exerciseId, auth, { ...body, levelLabel: '3.25', invitation: { bypassLevel: true } }, 'denied-key'),
    errorCode('LEVEL_NOT_ALLOWED'));
  assert.equal(postCalls(f).length, 0); assert.equal(f.operation, null);
});

test('same and alternate keys recover the original payment after level/range/catalog change', async () => {
  const f = fixture(); const first = await f.service.checkout(exerciseId, auth, body, 'original-key');
  f.setRating(6); f.row.accessLevels = ['D']; f.products.splice(0);
  const same = await f.restart().checkout(exerciseId, auth, body, 'original-key');
  const other = await f.restart().checkout(exerciseId, auth, { productId: 'different', source: 'subscription' }, 'other-key');
  assert.deepEqual(same, first); assert.deepEqual(other, first); assert.equal(postCalls(f).length, 1);
});

test('concurrent requests have one provider winner and recovery returns its original transaction', async () => {
  const f = fixture(); let release!: () => void;
  const latch = new Promise<void>(resolve => { release = resolve; });
  f.setResponse(async () => { await latch; return { transactionId: 'single-winner' }; });
  const first = f.service.checkout(exerciseId, auth, body, 'first-key');
  while (postCalls(f).length === 0) await new Promise(resolve => setImmediate(resolve));
  const second = await f.restart().checkout(exerciseId, auth, body, 'different-key');
  assert.equal(second.state, 'PENDING_CONFIRMATION'); assert.equal(postCalls(f).length, 1);
  release(); const receipt = await first;
  assert.equal(receipt.transactionId, 'single-winner');
  assert.deepEqual(await f.restart().checkout(exerciseId, auth, body, 'third-key'), receipt);
});

test('timeout after dispatch never grants another POST, including a different purchase key', async () => {
  const f = fixture(); f.setResponse(async () => { throw new Error('synthetic lost provider response'); });
  const first = await f.service.checkout(exerciseId, auth, body, 'lost-key');
  const retry = await f.restart().checkout(exerciseId, auth, { productId: 'monthly', source: 'subscription' }, 'new-key');
  assert.equal(first.state, 'PENDING_CONFIRMATION'); assert.equal(retry.operationId, first.operationId);
  assert.equal(retry.state, 'PENDING_CONFIRMATION'); assert.equal(postCalls(f).length, 1);
});

test('restart before dispatch rechecks changed admission rather than spending against an old prepared decision', async () => {
  const f = fixture(); const claim = f.persistence.claimTournamentCheckout;
  f.persistence.claimTournamentCheckout = async () => { throw new Error('synthetic crash before dispatch claim'); };
  await assert.rejects(f.service.checkout(exerciseId, auth, body, 'prepared-key'), /synthetic crash/);
  assert.equal(postCalls(f).length, 0); assert.equal(f.operation?.state, 'PROVIDER_CREATE_PENDING');
  f.persistence.claimTournamentCheckout = claim; f.setRating(6); f.row.accessLevels = ['D'];
  await assert.rejects(f.restart().checkout(exerciseId, auth, body, 'restart-key'), errorCode('LEVEL_NOT_ALLOWED'));
  assert.equal(f.operation?.state, 'FAILED');
  assert.equal(postCalls(f).length, 0, 'a prepared reservation is not a provider-dispatched payment');
});

test('subscription admission is durable, replays its identity and blocks a second operation', async () => {
  const f = fixture(); const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
  const first = await f.service.subscriptionAdmission(exerciseId, auth, input);
  f.setRating(6);
  assert.deepEqual(await f.restart().subscriptionAdmission(exerciseId, auth, input), first);
  assert.equal(first.actorClientId, actor.clientId); assert.equal(first.exerciseId, exerciseId);
  await assert.rejects(f.service.subscriptionAdmission(exerciseId, auth, { ...input, operationId: 'other-operation' }),
    errorCode('TOURNAMENT_OPERATION_ALREADY_STARTED'));
  assert.equal(postCalls(f).length, 0);
});


test('subscription completion cannot be attested by the ordinary browser bearer', async () => {
  const f = fixture(); const old = process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED;
  process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED = 'true';
  try {
    const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
    await f.service.subscriptionAdmission(exerciseId, auth, input);
    const before = clone(f.operation);
    await assert.rejects(f.service.completeSubscription(exerciseId, auth, undefined, { ...input, bookingId: 'forged-booking' }),
      errorCode('INTEGRATION_TOKEN_REQUIRED'));
    assert.deepEqual(f.operation, before);
  } finally {
    if (old === undefined) delete process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED;
    else process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED = old;
  }
});


test('an explicit owner ID cannot use the legacy untracked completion path', async () => {
  const { service } = fixture();
  const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription',
    bookingId: 'original-booking' };
  const token = 'synthetic-owner-token';
  await assert.rejects(service.completeSubscription(exerciseId, auth, token, {
    ...input, ownerOperationId: 'missing-owner',
  }), errorCode('TOURNAMENT_OPERATION_BINDING_MISMATCH'));
  assert.deepEqual(await service.completeSubscription(exerciseId, auth, token, input), {
    state: 'LEGACY_UNTRACKED', requestOperationId: input.operationId,
  });
});

test('subscription abort cannot be attested by browser bearer or a malformed proof', async () => {
  const f = fixture();
  const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
  const grant = await f.service.subscriptionAdmission(exerciseId, auth, input);
  const before = clone(f.operation);
  await assert.rejects(f.service.abortSubscription(exerciseId, auth, undefined, {
    ...input, ownerOperationId: grant.operationId, proof: 'PRE_DISPATCH_REJECTED_V1',
    code: 'SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE' }), errorCode('INTEGRATION_TOKEN_REQUIRED'));
  assert.deepEqual(f.operation, before);
});

const widgetRequest = { headers: { authorization: auth, 'x-user-id': 'untrusted-header-id' } } as never;
const subscription = { operationId: 'registration-operation', clientSubscriptionId: 'synthetic-subscription' };
const playerWithoutId = { ...actor, clientId: undefined, subject: 'keycloak-subject' };
const ownProfile = { id: actor.clientId, phone: '+7 (900) 000-00-01' };

function mockProfile(t: TestContext, read: () => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), ownProfileUrl);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), auth);
    assert.equal(headers.get('x-user-id'), null);
    assert.equal(headers.get('x-user-phone'), null);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    reads++;
    return read();
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return () => reads;
}

test('status and admission share the confirmed player from Viva; existing IDs skip the profile', async (t) => {
  const f = fixture();
  const controller = new TournamentsController(f.tournaments, {} as never, {} as never);
  const reads = mockProfile(t, () => Response.json(ownProfile));
  assert.equal((await controller.getMyRegistration(f.row.id, widgetRequest)).canRegister, true);
  assert.equal(reads(), 0);

  f.setVerifiedActor(playerWithoutId);
  const status = await controller.getMyRegistration(f.row.id, widgetRequest);
  assert.equal(status.canRegister, true);
  assert.equal(status.levelDecision?.allowed, true);
  assert.equal(reads(), 1, 'status and level use the same profile');
  assert.equal((await controller.getMyLevelDecision(f.row.id, widgetRequest) as Row).actorClientId, actor.clientId);
  assert.equal(reads(), 2);
  assert.equal(f.ratingClientIds.length, 5);
  assert.ok(f.ratingClientIds.every(clientId => clientId === actor.clientId));
});

test('checkout, integration copay and paid reconciliation use the confirmed Viva ID', async (t) => {
  const reads = mockProfile(t, () => Response.json(ownProfile));
  const purchase = fixture();
  purchase.setVerifiedActor(playerWithoutId);
  const first = await purchase.service.checkout(exerciseId, auth, body, 'viva-profile-key');
  assert.equal(purchase.operation?.clientId, actor.clientId);
  assert.equal(postCalls(purchase).length, 1);
  assert.equal(reads(), 1, 'a provider dispatch never repeats identity lookup after reserving a seat');
  assert.deepEqual(await purchase.restart().reconcile(exerciseId, auth), first);

  const f = fixture();
  f.setVerifiedActor(playerWithoutId);
  const grant = await f.service.subscriptionAdmission(exerciseId, auth, subscription);
  assert.equal(grant.actorClientId, actor.clientId);
  const bookingId = 'viva-booking', transactionId = 'viva-copay';
  const copay = { ...subscription, ownerOperationId: grant.operationId, bookingId,
    payment: { transactionId, amountMinor: 50000 } };
  await assert.rejects(f.service.completeSubscription(exerciseId, auth, undefined, copay, true),
    errorCode('INTEGRATION_TOKEN_REQUIRED'));
  assert.equal(reads(), 3);
  assert.equal((await f.service.completeSubscription(exerciseId, auth, ownerToken, copay, true)).state, 'PAYMENT_PENDING');
  const controller = new TournamentsController(f.tournaments, {} as never, {} as never);
  assert.equal((await controller.getMyRegistration(f.row.id, widgetRequest)).bookingId, bookingId);
  f.setCopayProof({ id: transactionId, clientId: actor.clientId, bookingId, status: 'PAID', toPayMinor: 50000 });
  f.bookings.push({ id: bookingId, clientId: actor.clientId, exerciseId, studioId, status: 'ACTIVE' });
  f.persistence.completeTournamentCheckout = async (_id: string, operation: Row, verifiedBookingId: string, paid: boolean) => {
    assert.equal(operation.clientId, actor.clientId);
    assert.equal(verifiedBookingId, bookingId);
    assert.equal(paid, true);
    return true;
  };
  assert.equal((await f.restart().reconcile(exerciseId, auth)).state, 'COMPLETED');
  assert.equal(reads(), 6);
  assert.equal(postCalls(f).length, 0);
});

test('identity conflicts and Viva outages deny new operations and protect an existing reservation', async (t) => {
  let response = () => Response.json(ownProfile);
  const reads = mockProfile(t, () => response());
  const f = fixture();
  f.setVerifiedActor({ ...playerWithoutId, tenantKey: 'foreign-tenant' });
  await assert.rejects(f.service.checkout(exerciseId, auth, body, 'foreign-tenant'), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  assert.equal(reads(), 0, 'a mismatched booking tenant receives no bearer');

  f.setVerifiedActor(playerWithoutId);
  const controller = new TournamentsController(f.tournaments, {} as never, {} as never);
  for (const profile of [
    { ...ownProfile, mobilePhone: '+7 900 000-00-02' },
    { ...ownProfile, client: { id: 'other-client' } },
    { ...ownProfile, tenantKey: 'foreign-tenant' },
    { id: actor.clientId },
  ]) {
    response = () => Response.json(profile);
    await assert.rejects(controller.getMyRegistration(f.row.id, widgetRequest), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
    await assert.rejects(f.service.subscriptionAdmission(exerciseId, auth, subscription), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  }
  for (const unavailable of [
    () => new Response(null, { status: 503 }),
    () => new Response('unavailable'),
    () => { throw new Error('network timeout'); }
  ]) {
    response = unavailable;
    const temporary = (error: any) => error.getStatus?.() === 503 && errorCode('TOURNAMENT_PROFILE_UNAVAILABLE')(error);
    await assert.rejects(controller.getMyRegistration(f.row.id, widgetRequest), temporary);
    await assert.rejects(f.service.checkout(exerciseId, auth, body, 'profile-outage'), temporary);
    await assert.rejects(f.service.subscriptionAdmission(exerciseId, auth, subscription), temporary);
  }
  assert.equal(f.operation, null);
  assert.equal(f.calls.length, 0);

  response = () => Response.json(ownProfile);
  await f.service.subscriptionAdmission(exerciseId, auth, subscription);
  const before = clone(f.operation);
  response = () => Response.json({ ...ownProfile, id: 'different-client' });
  await assert.rejects(controller.getMyRegistration(f.row.id, widgetRequest), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  await assert.rejects(f.service.reconcile(exerciseId, auth), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  const trustedIdentity = await f.tournaments.resolveTrustedLkRegistrationClient(auth);
  const legacyInput = { phone: actor.phoneNorm, name: 'Synthetic', trustedIdentity };
  await assert.rejects(f.tournaments.getPublicJoinFlow(f.row.slug,
    { ...legacyInput, [TRUSTED_TOURNAMENT_CLIENT]: trustedIdentity }), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  await assert.rejects(f.tournaments.createPublicJoinPurchaseTransaction(f.row.slug, legacyInput),
    errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  await assert.rejects(f.tournaments.confirmPublicJoinAfterPayment(f.row.slug, legacyInput),
    errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  f.setVerifiedActor({ ...playerWithoutId, phoneNorm: '79000000002' });
  response = () => Response.json({ id: actor.clientId, phone: '79000000002' });
  await assert.rejects(f.service.checkout(exerciseId, auth, body, 'changed-phone'), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  assert.deepEqual(f.operation, before);
});

test('canonical identity conflicts block admission even without a tournament level restriction', async (t) => {
  const f = fixture();
  f.row.accessLevels = [];
  f.setVerifiedActor(playerWithoutId);
  mockProfile(t, () => Response.json(ownProfile));
  f.tournaments.playerRatingsService.resolveCanonicalLevelByIdentity = async () => {
    throw new ConflictException({ code: 'RATING_IDENTITY_CONFLICT' });
  };
  await assert.rejects(f.service.subscriptionAdmission(exerciseId, auth, subscription), errorCode('TOURNAMENT_IDENTITY_MISMATCH'));
  assert.equal(f.operation, null);
});
