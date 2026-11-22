import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import { TournamentCheckoutService } from '../src/tournaments/tournament-checkout.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

type Row = Record<string, any>;
const levels = ['3', '3.125', '3.25', '3.375', '3.5'];
const clone = <T>(value: T): T => structuredClone(value);
async function main() {
  const uri = process.env.TEST_MONGODB_URI;
  assert.ok(uri, 'TEST_MONGODB_URI must identify a task-owned local replica set; no skip is a pass');
  const target = new URL(uri);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'local synthetic Mongo only');
  assert.ok(['tournamentTask', 'rs0'].includes(target.searchParams.get('replicaSet') ?? ''));
  assert.equal(target.searchParams.get('retryWrites'), 'true');
  assert.equal(target.searchParams.get('w'), 'majority');
  const databaseName = `tournament_checkout_task_${randomUUID().replace(/-/g, '')}`;
  process.env.TOURNAMENTS_MONGODB_URI = uri;
  process.env.TOURNAMENTS_MONGODB_DB = databaseName;
  process.env.TOURNAMENTS_MONGODB_COLLECTION = 'custom_tournaments';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  assert.equal((await client.db('admin').command({ hello: 1 })).setName, target.searchParams.get('replicaSet'));
  const collection = client.db(databaseName).collection<Row>('custom_tournaments');
  const repositories: TournamentsPersistenceService[] = [];
  let postCount = 0, result: () => Promise<unknown> = async () => ({ transactionId: `provider-${postCount}`, paymentUrl: 'https://pay.example/synthetic' });
  let rating = 3.25;
  const actor = (n = 1) => ({ clientId: `synthetic-client-${n}`, phoneNorm: `1202555${String(n).padStart(4, '0')}`, tenantKey: 'fixture-tenant' });
  async function seed(name: string, capacity = 4) {
    await collection.insertOne({ id: name, slug: name, source: 'CUSTOM', gender: 'MIXED',
      accessLevels: levels, levelTolerance: 0, updatedAt: '2026-11-18T00:00:00.000Z', createdAt: '2026-11-18T00:00:00.000Z',
      name, status: 'REGISTRATION', maxPlayers: capacity, participants: [], waitlist: [], allowedManagerPhones: [],
      skin: {}, mechanics: { enabled: false, config: {} }, details: { booking: { vivaExerciseId: `exercise-${name}`,
        vivaStudioId: 'synthetic-studio', vivaWidgetId: 'fixture-tenant', pendingJoinPayments: [] } } });
  }
  function instance(n = 1) {
    const repo = new TournamentsPersistenceService(); repositories.push(repo);
    const tournaments: any = Object.create(TournamentsService.prototype);
    Object.assign(tournaments, { tournamentsPersistence: repo, trustedRegistrationIdentities: new WeakMap(),
      lkIdentityService: { verifyTrustedBearer: async (header: string) => {
        assert.equal(header, 'Bearer synthetic-token'); return { actor: actor(n) };
      } },
      playerRatingsService: { resolveCanonicalLevelByIdentity: async () => ({ ratingNumeric: rating, levelLabel: String(rating) }) },
    });
    const service = new TournamentCheckoutService(tournaments, repo);
    (service as any).http = async (url: string, _auth: string, payload?: Row) => {
      if (payload) { postCount++; return result(); }
      if (url.includes('/exercises/')) return { id: decodeURIComponent(url.split('/exercises/')[1]), studio: { id: 'synthetic-studio' }, timeFrom: '2099-11-18T10:00:00+03:00' };
      if (url.includes('/products/')) return [{ id: 'one-time', name: 'Разовое участие', type: 'SERVICE' }];
      throw Error('Unexpected synthetic transport');
    };
    return { service, repo, tournaments };
  }
  const checkout = (service: TournamentCheckoutService, name: string, key: string) => service.checkout("exercise-" + name, 'Bearer synthetic-token', { productId: 'one-time', source: 'one-time' }, key);
  const check = async (name: string, run: () => Promise<void>) => { await run(); console.log(`PASS ${name}`); };
  try {
    await check('legacy nested exercise mapping works with distinct CUP and source IDs and no level rule', async () => {
      await seed('legacy-lookup');
      await collection.updateOne({ id: 'legacy-lookup' }, {
        $set: { sourceTournamentId: 'different-source-id', accessLevels: [],
          participants: [{ phone: actor(99).phoneNorm, name: 'Existing', status: 'REGISTERED' }] },
        $unset: { levelTolerance: '' }
      });
      const f = instance();
      f.tournaments.playerRatingsService = { resolveCanonicalLevelByIdentity: async () => {
        throw Error('unrestricted bookings must not require level evidence');
      } };
      const before = postCount;
      const receipt = await checkout(f.service, 'legacy-lookup', 'legacy-key');
      assert.ok(receipt.transactionId);
      assert.equal(postCount - before, 1);
      assert.equal((await collection.findOne({ id: 'legacy-lookup' }))?.participants[0].phone, actor(99).phoneNorm);
      await seed('ambiguous-lookup');
      await collection.updateOne({ id: 'ambiguous-lookup' }, { $set: { exerciseId: 'exercise-legacy-lookup' } });
      await assert.rejects(checkout(f.service, 'legacy-lookup', 'ambiguous-key'),
        (error: any) => error.getResponse?.().code === 'TOURNAMENT_TARGET_AMBIGUOUS');
      assert.equal(postCount - before, 1);
      await seed('top-level-lookup');
      await collection.updateOne({ id: 'top-level-lookup' }, {
        $set: { exerciseId: 'exercise-top-level-lookup', studioId: 'synthetic-studio',
          sourceTournamentSnapshot: { id: 'source-top-level-lookup', exerciseId: 'exercise-top-level-lookup' } },
        $unset: { 'details.booking.vivaExerciseId': '', 'details.booking.vivaStudioId': '' }
      });
      assert.ok((await checkout(instance().service, 'top-level-lookup', 'top-level-key')).transactionId);
      assert.equal(postCount - before, 2);
      await seed('join-flow-lookup');
      await collection.updateOne({ id: 'join-flow-lookup' }, {
        $set: { 'details.joinFlow.viva': { exerciseId: 'exercise-join-flow-lookup',
          studioId: 'synthetic-studio', widgetId: 'fixture-tenant' } },
        $unset: { 'details.booking': '' }
      });
      assert.ok((await checkout(instance().service, 'join-flow-lookup', 'join-flow-key')).transactionId);
      assert.equal(postCount - before, 3);
    });
    await check('same-timestamp changes to legacy target binding fence provider dispatch', async () => {
      await seed('mapping-drift');
      const f = instance(), before = postCount;
      const claim = f.repo.claimTournamentCheckout.bind(f.repo);
      f.repo.claimTournamentCheckout = async (...args) => {
        await collection.updateOne({ id: 'mapping-drift' }, {
          $set: { 'details.booking.vivaStudioId': 'new-studio' }
        });
        return claim(...args);
      };
      assert.equal((await checkout(f.service, 'mapping-drift', 'mapping-key')).state, 'PENDING_CONFIRMATION');
      assert.equal(postCount, before);
    });
    await check('physical Mongo: different service instances and keys dispatch exactly once', async () => {
      await seed('race'); const a = instance(), b = instance(); const before = postCount;
      const outcomes = await Promise.all(Array.from({ length: 8 }, (_, n) => checkout(n % 2 ? a.service : b.service, 'race', `race-key-${n}`)));
      assert.equal(postCount - before, 1);
      assert.equal(new Set(outcomes.map(x => x.operationId)).size, 1);
      const row = await collection.findOne({ id: 'race' }); assert.equal(row?.details.booking.pendingJoinPayments.length, 1);
      const receipt = await checkout(instance().service, 'race', 'after-process-restart');
      assert.ok(receipt.transactionId); assert.equal(receipt.operationId, outcomes[0].operationId);
      assert.equal(postCount - before, 1);
    });
    await check('physical Mongo: canonical tournament maxPlayers includes cross-path pending reservations', async () => {
      await seed('capacity', 2);
      await collection.updateOne({ id: 'capacity' }, { $set: { participants: [{ phone: '12025550999', name: 'Existing', status: 'REGISTERED' }] } });
      const before = postCount;
      const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, n) => checkout(instance(n + 10).service, 'capacity', `capacity-key-${n}`)));
      assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(postCount - before, 1);
      const row = await collection.findOne({ id: 'capacity' });
      assert.equal(row!.participants.length + row!.details.booking.pendingJoinPayments.length, 2);
      for (const outcome of outcomes) if (outcome.status === 'rejected') {
        assert.ok(['TOURNAMENT_RULE_OR_CAPACITY_CHANGED', 'TOURNAMENT_RULE_CHANGED'].includes(outcome.reason.getResponse?.().code));
      }
    });
    await check('physical Mongo: administrative roster additions cannot consume a checkout reservation', async () => {
      await seed('admin-capacity', 2); const f=instance(200);
      result = async () => ({ transactionId: `admin-capacity-provider-${postCount}` });
      await checkout(f.service, 'admin-capacity', 'reserved-before-admin');
      const current = await f.repo.findCustomTournamentById('admin-capacity'); assert.ok(current);
      const participants = [201,202].map(n=>({ phone:actor(n).phoneNorm, name:'Synthetic admin participant', status:'REGISTERED' as const }));
      await assert.rejects(f.tournaments.checkRosterAdditions(current, { participants }, current.id),
        (error:any)=>error.getResponse?.().code === 'TOURNAMENT_FULL');
      const stored = await collection.findOne({id:'admin-capacity'});
      assert.equal(stored!.participants.length,0);
      assert.equal(stored!.details.booking.pendingJoinPayments.length,1);
    });
    await check('physical Mongo: reducing maxPlayers cannot strand existing checkout reservations', async () => {
      await seed('admin-lower-capacity', 3); const f=instance(210);
      await checkout(f.service,'admin-lower-capacity','held-one');
      await checkout(instance(211).service,'admin-lower-capacity','held-two');
      await checkout(instance(212).service,'admin-lower-capacity','held-three');
      const current=await f.repo.findCustomTournamentById('admin-lower-capacity'); assert.ok(current);
      await assert.rejects(f.tournaments.checkRosterAdditions(current,{maxPlayers:2},current.id),
        (error:any)=>error.getResponse?.().code === 'TOURNAMENT_FULL');
      assert.equal((await collection.findOne({id:'admin-lower-capacity'}))!.maxPlayers,3);
    });
    await check('physical Mongo: administrator CAS fences a new reservation even with unchanged timestamp', async () => {
      await seed('admin-cas-pending',2); const f=instance(230);
      const before=await f.repo.findCustomTournamentById('admin-cas-pending'); assert.ok(before);
      await checkout(f.service,'admin-cas-pending','concurrent-reservation');
      // Same millisecond writes cannot use updatedAt as the whole admission version.
      await collection.updateOne({id:'admin-cas-pending'},{$set:{updatedAt:before.updatedAt}});
      const participants=[231,232].map(n=>({phone:actor(n).phoneNorm,name:'Synthetic admin',status:'REGISTERED' as const}));
      await assert.rejects(f.repo.updateCustomTournament('admin-cas-pending',{participants},before),
        (error:any)=>['TOURNAMENT_RULE_CHANGED','TOURNAMENT_FULL'].includes(error.getResponse?.().code));
      assert.equal((await collection.findOne({id:'admin-cas-pending'}))!.participants.length,0);
    });
    await check('physical Mongo: anonymous tournament detail does not expose durable checkout commands or receipts', async () => {
      await seed('public-checkout-privacy'); const f=instance(220);
      result=async()=>({transactionId:'private-provider-id',paymentUrl:'https://pay.example/private-owner-link'});
      await checkout(f.service,'public-checkout-privacy','private-operation-key');
      await collection.updateOne({id:'public-checkout-privacy'},{$set:{isPublic:true}});
      const current=await f.repo.findCustomTournamentById('public-checkout-privacy'); assert.ok(current);
      f.tournaments.findCustomTournamentByIdReadModelSafe=async()=>current;
      const view=await f.tournaments.findById('public-checkout-privacy');
      const serialized=JSON.stringify(view);
      assert.equal(view.details?.booking?.pendingJoinPayments,undefined);
      for(const secret of ['private-provider-id','https://pay.example/private-owner-link','private-operation-key',actor(220).phoneNorm]) {
        assert.equal(serialized.includes(secret),false,'anonymous detail must not disclose checkout identity or payment custody');
      }
      const publicView=f.tournaments.toPublicView(current);
      assert.equal(JSON.stringify(publicView).includes(actor(220).phoneNorm),false,
        'a pending anonymous participant name must not fall back to the private phone');
      assert.ok((await f.repo.readTournamentCheckoutOperation('public-checkout-privacy',actor(220).phoneNorm))?.ownerReceipt,
        'sanitizing a read model must preserve internal recovery evidence');
    });
    await check('physical Mongo: unchanged timestamp rule change fences new financial operation', async () => {
      await seed('same-timestamp'); const f = instance(), before = postCount;
      const admission = f.tournaments.checkCheckoutAdmission.bind(f.tournaments);
      f.tournaments.checkCheckoutAdmission = async (...args: unknown[]) => {
        const decision = await admission(...args);
        await collection.updateOne({ id: 'same-timestamp' }, { $set: { accessLevels: ['D'], levelTolerance: 0.125 } });
        return decision;
      };
      await assert.rejects(checkout(f.service, 'same-timestamp', 'changed-key'));
      assert.equal(postCount, before);
      assert.equal((await collection.findOne({ id: 'same-timestamp' }))!.details.booking.pendingJoinPayments.length, 0);
    });
    await check('physical Mongo: lost provider response survives process restart and alternate key without redispatch', async () => {
      await seed('lost-response'); const before = postCount;
      result = async () => { throw Error('synthetic provider response lost'); };
      const first = await checkout(instance().service, 'lost-response', 'original-key');
      const retry = await checkout(instance().service, 'lost-response', 'alternate-key');
      assert.equal(first.state, 'PENDING_CONFIRMATION'); assert.equal(retry.operationId, first.operationId);
      assert.equal(postCount - before, 1);
      const stored = await instance().repo.readTournamentCheckoutOperation('lost-response', actor().phoneNorm);
      assert.equal(stored?.state, 'PROVIDER_RESULT_UNKNOWN'); assert.ok(stored?.providerCreateAttemptedAt);
    });
    await check('physical Mongo: restart before dispatch refuses a changed canonical level', async () => {
      await seed('prepared'); const f = instance(), before = postCount;
      f.repo.claimTournamentCheckout = async () => { throw Error('synthetic crash before claim'); };
      await assert.rejects(checkout(f.service, 'prepared', 'prepared-key'), /synthetic crash/);
      assert.equal(postCount, before);
      rating = 6;
      await assert.rejects(checkout(instance().service, 'prepared', 'new-key'));
      assert.equal(postCount, before);
      const refused = await collection.findOne({ id: 'prepared' });
      assert.equal(refused!.details.booking.pendingJoinPayments[0].state, 'FAILED',
        'a definitive pre-dispatch refusal must stop holding canonical capacity');
      rating = 3.25;
    });
    await check('physical Mongo: concurrent dispatch wins over a stale predispatch refusal', async () => {
      await seed('refusal-race'); const prepared = instance(), before = postCount;
      prepared.repo.claimTournamentCheckout = async () => { throw Error('synthetic crash before claim'); };
      await assert.rejects(checkout(prepared.service, 'refusal-race', 'prepare'), /synthetic crash/);
      const stale = instance(), winner = instance();
      const reject = stale.repo.rejectTournamentCheckoutPreparation.bind(stale.repo);
      let winningOutcome: Row | undefined;
      stale.repo.rejectTournamentCheckoutPreparation = async (...args) => {
        // The stale request resolved an inadmissible level before another request claimed
        // the same operation using a fresh admissible rating. Only the persisted winner counts.
        rating = 3.25;
        result = async () => { throw Error('synthetic provider timeout'); };
        winningOutcome = await checkout(winner.service, 'refusal-race', 'winner');
        return reject(...args);
      };
      rating = 6;
      const recovered = await checkout(stale.service, 'refusal-race', 'stale');
      assert.equal(recovered.state, 'PENDING_CONFIRMATION');
      assert.equal(recovered.operationId, winningOutcome?.operationId);
      assert.equal(postCount - before, 1);
      assert.equal((await winner.repo.readTournamentCheckoutOperation('refusal-race', actor().phoneNorm))?.state, 'PROVIDER_RESULT_UNKNOWN');
      rating = 3.25;
    });
    await check('physical Mongo: late provider receipt survives concurrent status/retry', async () => {
      await seed('late'); const before = postCount;
      let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
      result = async () => { await wait; return { transactionId: 'late-original', paymentUrl: 'https://pay.example/late' }; };
      const original = checkout(instance().service, 'late', 'late-first');
      while (postCount === before) await new Promise(resolve => setTimeout(resolve, 5));
      const pending = await checkout(instance().service, 'late', 'late-second');
      assert.equal(pending.state, 'PENDING_CONFIRMATION'); release();
      const completed = await original; const recovered = await checkout(instance().service, 'late', 'late-third');
      assert.deepEqual(recovered, completed); assert.equal(recovered.transactionId, 'late-original');
      assert.equal(postCount - before, 1);
    });
    await check('physical Mongo: subscription admission occupies the same canonical capacity budget', async () => {
      await seed('subscription-budget', 2); const f = instance(100);
      const first = await f.service.subscriptionAdmission('exercise-subscription-budget', 'Bearer synthetic-token', { operationId: 'subscription-first', clientSubscriptionId: 'fixture-subscription' });
      const replay = await instance(100).service.subscriptionAdmission('exercise-subscription-budget', 'Bearer synthetic-token', { operationId: 'subscription-first', clientSubscriptionId: 'fixture-subscription' });
      assert.deepEqual(replay, first);
      result = async () => ({ transactionId: `budget-${postCount}` });
      await checkout(instance(101).service, 'subscription-budget', 'paid-other-player');
      await assert.rejects(checkout(instance(102).service, 'subscription-budget', 'over-capacity'));
      const row = await collection.findOne({ id: 'subscription-budget' }); assert.equal(row!.details.booking.pendingJoinPayments.length, 2);
    });
    await check('physical Mongo: reservation becomes one participant atomically and identical completion is idempotent', async () => {
      await seed('transfer', 2); const a = instance(201), b = instance(201);
      await a.service.subscriptionAdmission('exercise-transfer', 'Bearer synthetic-token', { operationId: 'transfer-first', clientSubscriptionId: 'fixture-subscription' });
      const operation = await a.repo.readTournamentCheckoutOperation('transfer', actor(201).phoneNorm); assert.ok(operation);
      const outcomes = await Promise.all([
        a.repo.completeTournamentCheckout('transfer', operation, 'booking-original', false),
        b.repo.completeTournamentCheckout('transfer', operation, 'booking-original', false)
      ]);
      assert.deepEqual(outcomes, [true, true]);
      let row = await collection.findOne({ id: 'transfer' });
      assert.equal(row!.participants.length, 1);
      assert.equal(row!.participants[0].vivaBookingId, 'booking-original');
      assert.equal(row!.details.booking.pendingJoinPayments[0].state, 'OWNER_COMPLETED');
      await checkout(instance(202).service, 'transfer', 'second-seat');
      await assert.rejects(checkout(instance(203).service, 'transfer', 'third-seat'));
      row = await collection.findOne({ id: 'transfer' });
      assert.equal(row!.participants.length, 1);
      assert.equal(row!.details.booking.pendingJoinPayments.filter((x: Row) => x.state !== 'OWNER_COMPLETED').length, 1);
    });
    await check('late exact completion never restores a participant removed after completion', async () => {
      await seed('removed-participant');
      const f = instance(205);
      await f.service.subscriptionAdmission('exercise-removed-participant', 'Bearer synthetic-token',
        { operationId: 'original', clientSubscriptionId: 'fixture-subscription' });
      const operation = await f.repo.readTournamentCheckoutOperation('removed-participant', actor(205).phoneNorm);
      assert.ok(operation);
      assert.ok(await f.repo.completeTournamentCheckout('removed-participant', operation, 'old-booking', false));
      await collection.updateOne({ id: 'removed-participant' }, { $set: { participants: [
        { phone: actor(99).phoneNorm, name: 'Remaining', status: 'REGISTERED' }
      ] } });
      assert.ok(await f.repo.completeTournamentCheckout('removed-participant', operation, 'old-booking', false));
      const row = await collection.findOne({ id: 'removed-participant' });
      assert.deepEqual(row?.participants.map((p: Row) => p.phone), [actor(99).phoneNorm]);
      assert.equal(row?.details.booking.pendingJoinPayments[0].providerBookingId, 'old-booking');
    });
    await check('physical Mongo: completion cannot replace a previously acknowledged booking identity', async () => {
      const a = instance(201);
      const operation = await a.repo.readTournamentCheckoutOperation('transfer', actor(201).phoneNorm); assert.ok(operation);
      assert.equal(await a.repo.completeTournamentCheckout('transfer', operation, 'booking-conflicting', false), false);
      const row = await collection.findOne({ id: 'transfer' });
      assert.equal(row!.participants[0].vivaBookingId, 'booking-original');
      assert.equal(row!.details.booking.pendingJoinPayments[0].providerBookingId, 'booking-original');
    });
    await check('new key after proven refusal rechecks level and rule; old key replays even after a new payment', async () => {
      await seed('fresh-after-refusal'); const f = instance(), before = postCount;
      f.repo.claimTournamentCheckout = async () => { throw Error('before dispatch'); };
      await assert.rejects(checkout(f.service, 'fresh-after-refusal', 'old-key'));
      rating = 6;
      await assert.rejects(checkout(instance().service, 'fresh-after-refusal', 'old-key'));
      const refused = await instance().repo.readTournamentCheckoutOperation('fresh-after-refusal', actor().phoneNorm);
      assert.equal(refused?.ownerNoDispatch, true);
      await assert.rejects(checkout(instance().service, 'fresh-after-refusal', 'still-disallowed'));
      assert.equal(postCount, before);
      // Rule, not player, changes after the refusal.
      await collection.updateOne({ id: 'fresh-after-refusal' }, { $set: { accessLevels: ['A'] } });
      result = async () => ({ transactionId: 'new-allowed-payment' });
      const outcomes = await Promise.all(Array.from({ length: 8 }, (_, n) => checkout(instance().service, 'fresh-after-refusal', 'new-' + n)));
      assert.equal(postCount - before, 1);
      assert.equal(new Set(outcomes.map(x => x.operationId)).size, 1);
      const replay = await checkout(instance().service, 'fresh-after-refusal', 'old-key');
      assert.equal(replay.state, 'REJECTED'); assert.equal(replay.code, 'LEVEL_NOT_ALLOWED');
      assert.equal(replay.operationId, refused?.transactionId);
      assert.equal((await collection.findOne({ id: 'fresh-after-refusal' }))!.details.booking.pendingJoinPayments.length, 2);
      rating = 3.25;
    });
    await check('same new key races create one journal row; bare FAILED never permits a second payment', async () => {
      await seed('same-new-key'); result = async () => ({ transactionId: 'synthetic-payment-' + postCount });
      const before = postCount;
      await Promise.all(Array.from({ length: 6 }, () => checkout(instance().service, 'same-new-key', 'same-key')));
      assert.equal(postCount - before, 1);
      const row = await collection.findOne({ id: 'same-new-key' });
      assert.equal(row!.details.booking.pendingJoinPayments.length, 1);
      await collection.updateOne({ id: 'same-new-key' }, { $set: { 'details.booking.pendingJoinPayments.0.state': 'FAILED' } });
      await checkout(instance().service, 'same-new-key', 'unsafe-new-key');
      assert.equal(postCount - before, 1);
    });
    const seedLastSeat = async (name: string) => {
      await seed(name, 2);
      await collection.updateOne({ id: name }, { $set: { participants: [{ phone: '12025550999', name: 'Existing', status: 'REGISTERED' }] } });
    };
    const subscription = (operationId: string) => ({ operationId, clientSubscriptionId: 'synthetic-subscription' });
    const owner = (n: number) => {
      const f = instance(n);
      f.tournaments.verifyCheckoutOwner = async (_auth: string, token: string) => {
        assert.equal(token, 'synthetic-owner-token'); return actor(n);
      };
      return f;
    };
    const abort = (f: ReturnType<typeof owner>, name: string, grant: Row) => f.service.abortSubscription("exercise-" + name,
      'Bearer synthetic-token', 'synthetic-owner-token', { ...subscription(grant.requestOperationId),
        ownerOperationId: grant.operationId, proof: 'PRE_DISPATCH_REJECTED_V1', code: 'SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE' });
    await check('subscription abort releases one seat, survives lost ACK/restart, and late abort preserves a new hold', async () => {
      await seedLastSeat('abort-seat'); const f = owner(300);
      const grant = await f.service.subscriptionAdmission('exercise-abort-seat', 'Bearer synthetic-token', subscription('original'));
      const apply = f.repo.abortTournamentSubscription.bind(f.repo);
      f.repo.abortTournamentSubscription = async (...args) => { await apply(...args); throw Error('lost ACK after commit'); };
      await assert.rejects(abort(f, 'abort-seat', grant), /lost ACK/);
      assert.equal((await abort(owner(300), 'abort-seat', grant)).state, 'ABORTED');
      const next = await owner(300).service.subscriptionAdmission('exercise-abort-seat', 'Bearer synthetic-token', subscription('new-operation'));
      assert.notEqual(next.operationId, grant.operationId);
      assert.equal((await abort(owner(300), 'abort-seat', grant)).state, 'ABORTED');
      assert.equal((await instance(300).repo.readTournamentCheckoutOperation('abort-seat', actor(300).phoneNorm))?.transactionId, next.operationId);
      await assert.rejects(checkout(instance(301).service, 'abort-seat', 'full'));
      const replay = await owner(300).service.subscriptionAdmission('exercise-abort-seat', 'Bearer synthetic-token', subscription('original'));
      assert.equal(replay.state, 'REJECTED');
    });
    await check('verified paid cancellation retires only the original hold and rechecks current level', async () => {
      const name = 'paid-cancel-rejoin';
      await seedLastSeat(name);
      const f = instance(350);
      const originalCount = postCount;
      result = async () => ({ transactionId: 'paid-cancel-tx-' + postCount, paymentUrl: 'https://pay.example/synthetic' });
      const original = await checkout(f.service, name, 'first');
      const booking = { id: 'original-paid-booking', exerciseId: 'exercise-' + name, clientId: actor(350).clientId,
        transactionId: original.transactionId, transactionStatus: 'PAID' };
      let cancelled = false;
      let contradictory = false;
      const mockBookings = (service: TournamentCheckoutService) => {
        const next = (service as any).http;
        (service as any).http = async (url: string, auth: string, data?: Row) => {
          if (!url.includes('/bookings')) return next(url, auth, data);
          if (url.includes('/history?')) return { content: [cancelled ? { ...booking, status: 'CANCELLED', isCancelled: true } : booking] };
          return { content: !cancelled || contradictory ? [booking] : [] };
        };
      };
      mockBookings(f.service);
      await f.service.reconcile('exercise-' + name, 'Bearer synthetic-token');
      const old = await f.repo.readTournamentCheckoutOperation(name, actor(350).phoneNorm);
      assert.equal(old?.state, 'OWNER_COMPLETED');
      // An older complete receipt may have been normalized without vivaBookingId.
      await collection.updateOne({ id: name, 'participants.id': 'owner:' + old?.transactionId },
        { $unset: { 'participants.$.vivaBookingId': '' } });
      assert.equal((await collection.findOne({ id: name }))!.participants.length, 2);
      cancelled = true;
      contradictory = true;
      assert.equal((await f.service.reconcile('exercise-' + name, 'Bearer synthetic-token', booking.id)).state, 'PENDING_CONFIRMATION');
      assert.equal((await collection.findOne({ id: name }))!.participants.length, 2);
      contradictory = false;
      assert.equal((await f.service.reconcile('exercise-' + name, 'Bearer synthetic-token', booking.id)).state, 'CANCELLED');
      assert.equal((await checkout(f.service, name, 'first')).state, 'CANCELLED');
      rating = 6;
      try { await assert.rejects(checkout(f.service, name, 'refused-after-cancel'), /Forbidden/); }
      finally { rating = 3.25; }
      const restarted = instance(350);
      mockBookings(restarted.service);
      const fresh = await checkout(restarted.service, name, 'fresh-after-cancel');
      assert.notEqual(fresh.operationId, original.operationId);
      assert.notEqual(fresh.transactionId, original.transactionId);
      assert.equal(postCount - originalCount, 2);
      assert.equal(await f.repo.completeTournamentCheckout(name, old!, booking.id, true), false);
      const row = (await collection.findOne({ id: name }))!;
      assert.deepEqual(row.participants.map((p: Row) => p.phone), ['12025550999']);
      assert.equal(row.details.booking.pendingJoinPayments[0].state, 'OWNER_CANCELLED');
      assert.equal(row.details.booking.pendingJoinPayments[1].transactionId, fresh.operationId);
    });
    await check('cancelled subscription re-admits a new request and late complete/abort preserve its owner hold', async () => {
      const name = 'subscription-cancel-rejoin';
      await seedLastSeat(name);
      const f = owner(351);
      const grant = await f.service.subscriptionAdmission('exercise-' + name, 'Bearer synthetic-token', subscription('first'));
      const finish = (service: TournamentCheckoutService) => service.completeSubscription('exercise-' + name, 'Bearer synthetic-token',
        'synthetic-owner-token', { ...subscription('first'), ownerOperationId: grant.operationId, bookingId: 'old-subscription-booking' });
      await finish(f.service);
      const restarted = owner(351);
      (restarted.service as any).http = async (url: string) => url.includes('/history?') ? [{
        id: 'old-subscription-booking', exerciseId: 'exercise-' + name,
        clientId: actor(351).clientId, status: 'CANCELLED'
      }] : [];
      const successor = await restarted.service.subscriptionAdmission('exercise-' + name, 'Bearer synthetic-token', subscription('next'));
      assert.notEqual(successor.operationId, grant.operationId);
      await assert.rejects(finish(restarted.service), /Conflict/);
      await assert.rejects(abort(restarted, name, grant));
      const row = (await collection.findOne({ id: name }))!;
      assert.deepEqual(row.participants.map((p: Row) => p.phone), ['12025550999']);
      assert.equal(row.details.booking.pendingJoinPayments[0].state, 'OWNER_CANCELLED');
      assert.equal(row.details.booking.pendingJoinPayments[1].transactionId, successor.operationId);
    });
    await check('subscription copay holds the last seat until exact paid settlement and replays one participant', async () => {
      const name = 'subscription-copay';
      const exerciseId = 'exercise-' + name;
      await seedLastSeat(name);
      const f = owner(355);
      const token = 'Bearer synthetic-token';
      const integration = 'synthetic-owner-token';
      const grant = await f.service.subscriptionAdmission(exerciseId, token, subscription('copay-key'));
      const booking = { id: 'copay-booking', exerciseId, clientId: actor(355).clientId, studioId: 'synthetic-studio' };
      const transaction = { id: 'copay-transaction', status: 'PAID', toPayMinor: 50000,
        bookingId: booking.id, clientId: booking.clientId };
      const request = { ...subscription('copay-key'), ownerOperationId: grant.operationId, bookingId: booking.id,
        payment: { transactionId: transaction.id, amountMinor: transaction.toPayMinor } };
      const bound = await f.service.completeSubscription(exerciseId, token, integration, request, true);
      assert.equal(bound.state, 'PAYMENT_PENDING');
      await assert.rejects(f.service.completeSubscription(exerciseId, token, integration,
        { ...request, payment: undefined }), (error: any) => error.getResponse().code === 'TOURNAMENT_PAYMENT_PENDING');
      await assert.rejects(f.service.completeSubscription(exerciseId, token, integration,
        { ...request, payment: { ...request.payment, transactionId: 'wrong-tx' } }, true));
      await assert.rejects(instance(356).service.subscriptionAdmission(exerciseId, token, subscription('other-key')));
      const before = (await collection.findOne({ id: name }))!;
      const originalRoster = before.participants;
      const staleViva = { source: 'VIVA', participantsCount: 2, participants: [
        ...originalRoster, { name: 'Unpaid carrier', vivaBookingId: booking.id, status: 'REGISTERED', paymentStatus: 'UNPAID' }
      ] };
      assert.equal(originalRoster.length, 1);
      assert.deepEqual(f.tournaments.buildDisplayTournamentParticipants(before), originalRoster);
      const standalone = { ...before, participants: [], participantsCount: 0 };
      const enriched = await f.tournaments.enrichTournamentVivaProfiles(standalone);
      assert.deepEqual(f.tournaments.buildDisplayTournamentParticipants(enriched), []);
      const beforeView = f.tournaments.mergeCustomWithSourceTournament(before, staleViva);
      assert.equal(beforeView.participants.length, 1);
      assert.equal(beforeView.participantsCount, 1);
      assert.equal(beforeView.details.sourceTournamentSnapshot.participantsCount, 1);

      let readback: Row = { ...transaction, status: 'WAITING' };
      let activeBooking: Row | null = booking;
      let readbackUnavailable = false;
      const viva = { readTournamentCopayTransaction: async (id: string) => {
        assert.equal(id, transaction.id);
        if (readbackUnavailable) throw new Error('Synthetic Viva timeout');
        return readback;
      } } as unknown as VivaAdminService;
      const reconciler = new TournamentCheckoutService(f.tournaments, f.repo, viva);
      (reconciler as any).http = async (url: string) => url.includes('/history?') || !activeBooking ? [] : [activeBooking];
      const query = () => reconciler.reconcile(exerciseId, token);
      assert.equal((await query()).state, 'PAYMENT_PENDING');
      for (const invalid of [{ id: 'wrong-tx' }, { toPayMinor: 49999 }, { transactionStatus: 'WAITING' },
        { bookingId: undefined }, { bookingId: null, bookingIds: [] }, { bookingId: 'other-booking' },
        { cardPaymentInfo: { refundedAmountMinor: 50000 } },
        { bookingIds: [{ id: booking.id, bookingId: 'wrong-booking' }] }]) {
        readback = { ...transaction, ...invalid };
        assert.equal((await query()).state, 'PAYMENT_PENDING');
        assert.deepEqual(await collection.findOne({ id: name }), before);
      }
      readback = { ...transaction, bookingId: undefined, products: [{ pricingDetails: [{ clientBookingId: booking.id }] }] };
      readbackUnavailable = true;
      assert.equal((await query()).state, 'PAYMENT_PENDING');
      assert.deepEqual(await collection.findOne({ id: name }), before);
      readbackUnavailable = false;
      activeBooking = { ...booking, isCancelled: true };
      assert.equal((await query()).state, 'PAYMENT_PENDING');
      activeBooking = booking;
      for (const reply of await Promise.all([query(), query(), query()])) {
        assert.deepEqual(reply, { state: 'COMPLETED', bookingId: booking.id, transactionId: transaction.id,
          requestOperationId: request.operationId });
      }
      assert.equal((await f.service.completeSubscription(exerciseId, token, integration, request, true)).state, 'COMPLETED');
      const after = (await collection.findOne({ id: name }))!;
      assert.equal(after.details.booking.pendingJoinPayments[0].state, 'OWNER_COMPLETED');
      assert.equal(after.details.booking.pendingJoinPayments[0].providerTransactionId, transaction.id);
      assert.equal(after.participants.length, 2);
      assert.equal(after.participants[1].paymentStatus, 'PAID');
      assert.equal(after.participants[1].vivaBookingId, booking.id);
      const storedView = await f.repo.findCustomTournamentBySlug(name);
      const afterView = f.tournaments.mergeCustomWithSourceTournament(storedView, staleViva);
      assert.equal(afterView.participants.length, 2);
      assert.equal(afterView.participants.filter((player: Row) => player.paymentStatus === 'PAID').length, 1);
    });
    await check('exact cancelled booking with a pending payment releases its only held seat', async () => {
      const name = 'paid-cancelled-before-completion';
      await seedLastSeat(name);
      const f = instance(352);
      const original = await checkout(f.service, name, 'original');
      const booking = { id: 'cancelled-before-commit', exerciseId: 'exercise-' + name, clientId: actor(352).clientId,
        transactionId: original.transactionId, status: 'CANCELLED' };
      (f.service as any).http = async (url: string) => url.includes('/history?') ? [booking] : [];
      assert.equal((await f.service.reconcile('exercise-' + name, 'Bearer synthetic-token', booking.id)).state, 'CANCELLED');
      const row = (await collection.findOne({ id: name }))!;
      assert.equal(row.participants.length, 1);
      assert.equal(row.details.booking.pendingJoinPayments[0].state, 'OWNER_CANCELLED');
      await checkout(instance(353).service, name, 'last-seat');
    });
    await check('level-restricted linked free registration uses one booking, no checkout or visit, and rejects invalid candidates', async () => {
      const name = 'free-restricted';
      await seedLastSeat(name);
      await collection.updateOne({ id: name }, { $set: { 'details.sourceTournamentSnapshot': { source: 'VIVA' } } });
      let bookingPosts = 0;
      const before = postCount;
      const fixture = () => {
        const f = instance(354);
        Object.assign(f.tournaments, {
          requireCustomBySlug: async () => collection.findOne({ id: name }),
          requireCustomByPublicRef: async () => collection.findOne({ id: name }),
          resolveSourceTournamentProvider: () => 'VIVA',
          fetchVivaJoinPurchaseOptions: async () => [],
          enrichTournamentParticipantWithViva: async (p: Row) => p,
          invalidatePublicDirectoryCache: () => {},
          vivaAdminService: { createExerciseBooking: async (binding: Row) => {
            assert.deepEqual(binding, { exerciseId: 'exercise-' + name, clientId: actor(354).clientId, phone: actor(354).phoneNorm });
            bookingPosts += 1;
            return { outcome: 'CREATED', bookingId: 'free-provider-booking' };
          } }
        });
        return f;
      };
      const register = (f = fixture()) => f.tournaments.registerPublicParticipantByTournamentRef(name, {
        phone: actor(354).phoneNorm, name: 'Synthetic', vivaAuthorizationHeader: 'Bearer synthetic-token',
        trustedIdentity: f.tournaments.rememberRegistrationIdentity({ phone: actor(354).phoneNorm, clientId: actor(354).clientId })
      });
      rating = 6;
      try { assert.equal((await register()).code, 'LEVEL_NOT_ALLOWED'); }
      finally { rating = 3.25; }
      assert.equal(bookingPosts, 0);
      assert.equal((await collection.findOne({ id: name }))!.details.booking.pendingJoinPayments.length, 0);
      const results = await Promise.all([register(), register()]);
      assert.ok(results.some(response => response.code === 'REGISTERED'));
      assert.equal((await register()).code, 'ALREADY_REGISTERED');
      const row = (await collection.findOne({ id: name }))!;
      assert.equal(row.participants.length, 2);
      assert.equal(row.details.booking.pendingJoinPayments[0].ownerCommand.kind, 'FREE_BOOKING');
      assert.equal(row.details.booking.pendingJoinPayments[0].providerBookingId, 'free-provider-booking');
      assert.equal(row.details.booking.pendingJoinPayments[0].providerTransactionId, undefined);
      assert.equal(bookingPosts, 1);
      assert.equal(postCount, before);
    });
    await check('recovery-only completes the original free booking before or after provider dispatch', async () => {
      for (const hasReceipt of [false, true]) {
        const name = hasReceipt ? 'recover-free-receipt' : 'recover-free-prepared';
        const player = actor(357);
        await seedLastSeat(name);
        await collection.updateOne({ id: name }, { $set: { 'details.sourceTournamentSnapshot': { source: 'VIVA' } } });
        let providerBookings = 0;
        const before = postCount;
        function fixture() {
          const f = instance(357);
          Object.assign(f.tournaments, {
            requireCustomBySlug: async () => collection.findOne({ id: name }),
            requireCustomByPublicRef: async () => collection.findOne({ id: name }),
            resolveSourceTournamentProvider: () => 'VIVA',
            fetchVivaJoinPurchaseOptions: async () => [],
            enrichTournamentParticipantWithViva: async (participant: Row) => participant,
            invalidatePublicDirectoryCache: () => {},
            vivaAdminService: { createExerciseBooking: async (binding: Row) => {
              assert.deepEqual(binding, { exerciseId: 'exercise-' + name, clientId: player.clientId, phone: player.phoneNorm });
              providerBookings++;
              return { outcome: 'CREATED', bookingId: 'original-free-booking' };
            } }
          });
          return f;
        }
        const register = (f = fixture()) => f.tournaments.registerPublicParticipantByTournamentRef(name, {
          phone: player.phoneNorm, name: 'Synthetic', vivaAuthorizationHeader: 'Bearer synthetic-token',
          trustedIdentity: f.tournaments.rememberRegistrationIdentity({ phone: player.phoneNorm, clientId: player.clientId })
        });
        const interrupted = fixture();
        if (hasReceipt) interrupted.repo.completeTournamentCheckout = async () => false;
        else interrupted.repo.claimTournamentCheckout = async () => false;
        assert.equal((await register(interrupted)).code, 'BOOKING_FAILED');
        const pending = (await collection.findOne({ id: name }))!.details.booking.pendingJoinPayments[0];
        assert.equal(pending.state, hasReceipt ? 'PROVIDER_RESULT_UNKNOWN' : 'PROVIDER_CREATE_PENDING');
        assert.equal(providerBookings, Number(hasReceipt));

        const previousMode = process.env.TOURNAMENT_OWNER_RECOVERY_ONLY;
        process.env.TOURNAMENT_OWNER_RECOVERY_ONLY = 'true';
        try {
          const replies = await Promise.all([register(), register()]);
          assert.ok(replies.some(reply => reply.code === 'REGISTERED'));
          assert.equal((await register()).code, 'ALREADY_REGISTERED');
        } finally {
          if (previousMode === undefined) delete process.env.TOURNAMENT_OWNER_RECOVERY_ONLY;
          else process.env.TOURNAMENT_OWNER_RECOVERY_ONLY = previousMode;
        }
        const row = (await collection.findOne({ id: name }))!;
        assert.equal(row.participants.length, 2);
        assert.equal(row.participants.filter((participant: Row) => participant.phone === player.phoneNorm).length, 1);
        assert.equal(row.details.booking.pendingJoinPayments.length, 1);
        const completed = row.details.booking.pendingJoinPayments[0];
        assert.equal(completed.transactionId, pending.transactionId);
        assert.equal(completed.state, 'OWNER_COMPLETED');
        assert.equal(completed.providerBookingId, 'original-free-booking');
        assert.equal(completed.providerTransactionId, undefined);
        assert.equal(providerBookings, 1);
        assert.equal(postCount, before);
      }
    });
    await check('abort/complete race never leaves a completed participant without capacity accounting', async () => {
      for (const order of ['abort', 'complete', 'concurrent']) {
        const name = 'abort-race-' + order; await seedLastSeat(name); const f = owner(310);
        const grant = await f.service.subscriptionAdmission("exercise-" + name, 'Bearer synthetic-token', subscription('race'));
        const operation = await f.repo.readTournamentCheckoutOperation(name, actor(310).phoneNorm); assert.ok(operation);
        const complete = () => instance(310).repo.completeTournamentCheckout(name, operation, 'original-booking', false);
        let completed: boolean;
        if (order === 'abort') { await abort(f, name, grant); completed = await complete(); }
        else if (order === 'complete') { completed = await complete(); assert.equal((await abort(f, name, grant)).state, 'COMPLETED'); }
        else { const results = await Promise.all([abort(f, name, grant), complete()]); completed = results[1]; }
        const row = await collection.findOne({ id: name });
        assert.equal(row!.participants.length, completed ? 2 : 1);
        assert.equal(row!.details.booking.pendingJoinPayments[0].state, completed ? 'OWNER_COMPLETED' : 'FAILED');
        if (completed) await assert.rejects(checkout(instance(311).service, name, 'cannot-overbook'));
        else await checkout(instance(311).service, name, 'replacement');
      }
    });
    await check('abort rejects foreign owner, unknown proof and dispatch evidence; unknown hold retains capacity', async () => {
      await seedLastSeat('abort-unknown'); const f = owner(320);
      const grant = await f.service.subscriptionAdmission('exercise-abort-unknown', 'Bearer synthetic-token', subscription('unknown'));
      await assert.rejects(abort(owner(321), 'abort-unknown', grant));
      await assert.rejects(f.service.abortSubscription('exercise-abort-unknown', 'Bearer synthetic-token', 'synthetic-owner-token', {
        ...subscription('unknown'), ownerOperationId: grant.operationId, proof: 'TIMEOUT', code: 'SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE' }));
      await collection.updateOne({ id: 'abort-unknown' }, { $set: {
        'details.booking.pendingJoinPayments.0.providerCreateAttemptedAt': '2026-11-18T10:00:00Z' } });
      await assert.rejects(abort(f, 'abort-unknown', grant));
      await assert.rejects(checkout(instance(321).service, 'abort-unknown', 'still-full'));
      assert.equal((await collection.findOne({ id: 'abort-unknown' }))!.details.booking.pendingJoinPayments[0].state, 'PROVIDER_CREATE_PENDING');
    });
    await check('corrected player level permits a new checkout; an unknown older payment keeps the last seat', async () => {
      await seedLastSeat('level-retry'); const f = instance(), before = postCount;
      f.repo.claimTournamentCheckout = async () => { throw Error('before dispatch'); };
      await assert.rejects(checkout(f.service, 'level-retry', 'level-original'));
      rating = 6;
      await assert.rejects(checkout(instance().service, 'level-retry', 'level-original'));
      rating = 3.25;
      result = async () => { throw Error('provider outcome unknown'); };
      const next = await checkout(instance().service, 'level-retry', 'level-corrected');
      assert.equal(next.state, 'PENDING_CONFIRMATION'); assert.equal(postCount - before, 1);
      const replay = await checkout(instance().service, 'level-retry', 'level-original');
      assert.equal(replay.state, 'REJECTED'); assert.notEqual(replay.operationId, next.operationId);
      const alternate = await checkout(instance().service, 'level-retry', 'another-new-key');
      assert.equal(alternate.operationId, next.operationId);
      await assert.rejects(checkout(instance(330).service, 'level-retry', 'other-player'));
      assert.equal(postCount - before, 1);
    });
    console.log('PASS physical Mongo checkout-owner scenarios; synthetic provider only');
  } finally {
    await Promise.all(repositories.map(repo => repo.onModuleDestroy()));
    assert.ok(databaseName.startsWith('tournament_checkout_task_'));
    await client.db(databaseName).dropDatabase();
    await client.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
