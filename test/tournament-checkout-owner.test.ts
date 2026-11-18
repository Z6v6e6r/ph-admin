import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { TournamentCheckoutService } from '../src/tournaments/tournament-checkout.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

const clone = <T>(value: T): T => structuredClone(value);
type Row = Record<string, any>;
const actor = { clientId: 'synthetic-client', phoneNorm: '12025550101', tenantKey: 'fixture-tenant' };
const exerciseId = 'synthetic-exercise', studioId = 'synthetic-studio';
const auth = 'Bearer synthetic-not-a-real-token';
const levels = ['3', '3.125', '3.25', '3.375', '3.5'];
function fixture() {
  const row: Row = { id: 'synthetic-tournament', slug: 'synthetic-tournament', source: 'CUSTOM', gender: 'MIXED',
    accessLevels: levels, levelTolerance: 0, updatedAt: '2026-11-18T00:00:00.000Z', maxPlayers: 8,
    status: 'REGISTRATION', participants: [], waitlist: [], details: { booking: {
      vivaExerciseId: exerciseId, vivaStudioId: studioId, vivaWidgetId: actor.tenantKey } } };
  let operation: Row | null = null, rating = 3.25;
  const calls: Array<{ url: string; body?: Row }> = [];
  const products: Row[] = [{ id: 'one-time', name: 'Разовое участие', type: 'SERVICE', cost: 250000 }];
  const exercise: Row = { id: exerciseId, studio: { id: studioId }, timeFrom: '2099-11-18T10:00:00+03:00', availableClientOneTimes: [] };
  const persistence: any = {
    isEnabled: () => true,
    readPublicAdmissionRule: async () => ({ gender: row.gender, accessLevels: clone(row.accessLevels),
      levelTolerance: row.levelTolerance, updatedAt: row.updatedAt }),
    readTournamentCheckoutOperation: async (_id: string, _phone: string, selector?: Row) => clone(operation &&
      (!selector?.requestKey || operation.ownerCommand?.requestKey === selector.requestKey) &&
      (!selector?.transactionId || operation.transactionId === selector.transactionId) ? operation : null),
    reservePublicJoinPayment: async (_id: string, next: Row) => {
      if (operation) return null;
      operation = clone(next); return clone(row);
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
    lkIdentityService: { verifyTrustedBearer: async (header: string) => {
      assert.equal(header, auth); return { actor };
    }, verify: async (_header: string, _token: string) => {
      throw new ForbiddenException({ code: 'INTEGRATION_TOKEN_REQUIRED' });
    } },
    playerRatingsService: { resolveCanonicalLevelByIdentity: async (identity: Row) => {
      assert.equal(identity.clientId, actor.clientId); return { ratingNumeric: rating, levelLabel: String(rating) };
    } },
    requireCustomByPublicRef: async () => clone(row)
  });
  let response: () => Promise<unknown> = async () => ({ transactionId: 'provider-original', paymentUrl: 'https://pay.example/original' });
  const make = () => {
    const service = new TournamentCheckoutService(tournaments, persistence as TournamentsPersistenceService);
    (service as any).http = async (url: string, header: string, body?: Row) => {
      assert.equal(header, auth); calls.push({ url, ...(body ? { body: clone(body) } : {}) });
      if (body) return response();
      if (url.includes('/exercises/')) return clone(exercise);
      if (url.includes('/products/')) return clone(products);
      throw Error(`Unexpected synthetic request ${url}`);
    };
    return service;
  };
  return { service: make(), restart: make, row, exercise, products, calls, persistence,
    setRating: (value: number) => { rating = value; }, setResponse: (value: typeof response) => { response = value; },
    get operation() { return operation; }, setOperation: (value: Row) => { operation = clone(value); } };
}
const body = { productId: 'one-time', source: 'one-time' };
const postCalls = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.body);
const errorCode = (code: string) => (error: any) => error.getResponse?.().code === code;

test('one-time cart preserves historical Viva v2 fields, promo and return aliases; client price/level do not enter it', async () => {
  const f = fixture();
  const successUrl = 'https://padlhub.ru/tournament?paid=1', failUrl = 'https://padlhub.ru/tournament?paid=0';
  const result = await f.service.checkout('synthetic-tournament', auth, { ...body, promoCode: 'PADEL20', successUrl, failUrl,
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
  await f.service.checkout('synthetic-tournament', auth, { productId: 'monthly-product', source: 'subscription' }, 'composite-key');
  assert.deepEqual(postCalls(f)[0]?.body?.products, [{ id: 'monthly-product', name: 'Абонемент и турнир', type: 'SUBSCRIPTION', count: 1,
    bookingRequests: [{ exerciseId, client: null, comment: null, marketingAttribution: {} }],
    clientSubscriptionId: 'provider-owned-subscription', subscriptionId: 'catalog-subscription' }]);
  assert.ok(f.calls.some(c => c.url.endsWith('/products/subscriptions?exerciseId=synthetic-exercise')));
  assert.equal(postCalls(f).length, 1);
});

test('owned client-one-time can be purchased only from this authenticated exercise response', async () => {
  const f = fixture(); f.exercise.availableClientOneTimes = [{ id: 'owned-single', name: 'Моя разовая услуга', type: 'SERVICE' }];
  await f.service.checkout('synthetic-tournament', auth, { productId: 'owned-single', source: 'client-one-time' }, 'owned-single-key');
  assert.equal(postCalls(f)[0]?.body?.products[0].id, 'owned-single');
  assert.equal(f.calls.filter(c => c.url.includes('/products/')).length, 0);
  const absent = fixture();
  await assert.rejects(absent.service.checkout('synthetic-tournament', auth, { productId: 'someone-elses', source: 'client-one-time' }, 'unowned-key'),
    errorCode('TOURNAMENT_CHECKOUT_PRODUCT_UNAVAILABLE'));
  assert.equal(postCalls(absent).length, 0);
});

test('canonical owner level rejects forged level and invitation without a provider POST', async () => {
  const f = fixture(); f.setRating(5);
  await assert.rejects(f.service.checkout('synthetic-tournament', auth, { ...body, levelLabel: '3.25', invitation: { bypassLevel: true } }, 'denied-key'),
    errorCode('LEVEL_NOT_ALLOWED'));
  assert.equal(postCalls(f).length, 0); assert.equal(f.operation, null);
});

test('same and alternate keys recover the original payment after level/range/catalog change', async () => {
  const f = fixture(); const first = await f.service.checkout('synthetic-tournament', auth, body, 'original-key');
  f.setRating(6); f.row.accessLevels = ['D']; f.products.splice(0);
  const same = await f.restart().checkout('synthetic-tournament', auth, body, 'original-key');
  const other = await f.restart().checkout('synthetic-tournament', auth, { productId: 'different', source: 'subscription' }, 'other-key');
  assert.deepEqual(same, first); assert.deepEqual(other, first); assert.equal(postCalls(f).length, 1);
});

test('concurrent requests have one provider winner and recovery returns its original transaction', async () => {
  const f = fixture(); let release!: () => void;
  const latch = new Promise<void>(resolve => { release = resolve; });
  f.setResponse(async () => { await latch; return { transactionId: 'single-winner' }; });
  const first = f.service.checkout('synthetic-tournament', auth, body, 'first-key');
  while (postCalls(f).length === 0) await new Promise(resolve => setImmediate(resolve));
  const second = await f.restart().checkout('synthetic-tournament', auth, body, 'different-key');
  assert.equal(second.state, 'PENDING_CONFIRMATION'); assert.equal(postCalls(f).length, 1);
  release(); const receipt = await first;
  assert.equal(receipt.transactionId, 'single-winner');
  assert.deepEqual(await f.restart().checkout('synthetic-tournament', auth, body, 'third-key'), receipt);
});

test('timeout after dispatch never grants another POST, including a different purchase key', async () => {
  const f = fixture(); f.setResponse(async () => { throw new Error('synthetic lost provider response'); });
  const first = await f.service.checkout('synthetic-tournament', auth, body, 'lost-key');
  const retry = await f.restart().checkout('synthetic-tournament', auth, { productId: 'monthly', source: 'subscription' }, 'new-key');
  assert.equal(first.state, 'PENDING_CONFIRMATION'); assert.equal(retry.operationId, first.operationId);
  assert.equal(retry.state, 'PENDING_CONFIRMATION'); assert.equal(postCalls(f).length, 1);
});

test('restart before dispatch rechecks changed admission rather than spending against an old prepared decision', async () => {
  const f = fixture(); const claim = f.persistence.claimTournamentCheckout;
  f.persistence.claimTournamentCheckout = async () => { throw new Error('synthetic crash before dispatch claim'); };
  await assert.rejects(f.service.checkout('synthetic-tournament', auth, body, 'prepared-key'), /synthetic crash/);
  assert.equal(postCalls(f).length, 0); assert.equal(f.operation?.state, 'PROVIDER_CREATE_PENDING');
  f.persistence.claimTournamentCheckout = claim; f.setRating(6); f.row.accessLevels = ['D'];
  await assert.rejects(f.restart().checkout('synthetic-tournament', auth, body, 'restart-key'), errorCode('LEVEL_NOT_ALLOWED'));
  assert.equal(f.operation?.state, 'FAILED');
  assert.equal(postCalls(f).length, 0, 'a prepared reservation is not a provider-dispatched payment');
});

test('subscription admission is durable, replays its identity and blocks a second operation', async () => {
  const f = fixture(); const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
  const first = await f.service.subscriptionAdmission('synthetic-tournament', auth, input);
  f.setRating(6);
  assert.deepEqual(await f.restart().subscriptionAdmission('synthetic-tournament', auth, input), first);
  assert.equal(first.actorClientId, actor.clientId); assert.equal(first.exerciseId, exerciseId);
  await assert.rejects(f.service.subscriptionAdmission('synthetic-tournament', auth, { ...input, operationId: 'other-operation' }),
    errorCode('TOURNAMENT_OPERATION_ALREADY_STARTED'));
  assert.equal(postCalls(f).length, 0);
});


test('subscription completion cannot be attested by the ordinary browser bearer', async () => {
  const f = fixture(); const old = process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED;
  process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED = 'true';
  try {
    const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
    await f.service.subscriptionAdmission('synthetic-tournament', auth, input);
    const before = clone(f.operation);
    await assert.rejects(f.service.completeSubscription('synthetic-tournament', auth, undefined, { ...input, bookingId: 'forged-booking' }),
      errorCode('INTEGRATION_TOKEN_REQUIRED'));
    assert.deepEqual(f.operation, before);
  } finally {
    if (old === undefined) delete process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED;
    else process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED = old;
  }
});


test('subscription abort cannot be attested by browser bearer or a malformed proof', async () => {
  const f = fixture();
  const input = { operationId: 'subscription-operation', clientSubscriptionId: 'synthetic-subscription' };
  const grant = await f.service.subscriptionAdmission('synthetic-tournament', auth, input);
  const before = clone(f.operation);
  await assert.rejects(f.service.abortSubscription('synthetic-tournament', auth, undefined, {
    ...input, ownerOperationId: grant.operationId, proof: 'PRE_DISPATCH_REJECTED_V1',
    code: 'SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE' }), errorCode('INTEGRATION_TOKEN_REQUIRED'));
  assert.deepEqual(f.operation, before);
});
