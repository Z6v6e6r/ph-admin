import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import { TRUSTED_TOURNAMENT_CLIENT } from '../src/tournaments/tournaments.types';

const NOW = '2026-10-31T10:00:00.000Z';
const PHONE = '79000000001';
function fixture(gender = 'MALE', sex: 'MALE' | 'FEMALE' | null = 'MALE') {
  const tournament: any = { id: 'tournament-synthetic', slug: 'cup', updatedAt: NOW, gender,
    name: 'Synthetic', status: 'OPEN', maxPlayers: 4, accessLevels: [], participants: [], waitlist: [],
    details: { booking: { enabled: true, required: true, vivaExerciseId: 'exercise-1', vivaStudioId: 'studio-1', vivaWidgetId: 'iSkq6G' } } };
  const counters = { profile: 0, append: 0, waitlist: 0, reserve: 0, provider: 0 };
  let raw: any = { gender, updatedAt: NOW };
  const persistence: any = {
    isEnabled: () => true,
    readPublicAdmissionRule: async () => raw,
    appendPublicParticipantIfCapacity: async (_id: string, _phone: string, _participant: any, rule: any) => {
      assert.deepEqual(rule.gender, raw.gender); assert.equal(rule.updatedAt, raw.updatedAt); counters.append++; return tournament;
    },
    appendPublicWaitlistWithAdmission: async (_id: string, _phone: string, _participant: any, rule: any) => {
      assert.equal(rule.gender, raw.gender); assert.equal(rule.updatedAt, raw.updatedAt); counters.waitlist++; return tournament;
    },
    reservePublicJoinPayment: async (_id: string, pending: any, rule: any) => {
      assert.equal(rule.gender, raw.gender); assert.equal(rule.updatedAt, raw.updatedAt);
      assert.equal(pending.eligibilitySnapshot.genderDecision.gender, raw.gender);
      counters.reserve++; tournament.details.booking.pendingJoinPayments = [pending]; return tournament;
    }
  };
  const viva: any = { readTournamentProfileSex: async (identity: any) => {
    assert.deepEqual(identity, { clientId: 'client-1', phone: PHONE }); counters.profile++; return sex;
  } };
  const identity: any = { verifyTrustedBearer: async (header: string) => {
    assert.equal(header, 'Bearer synthetic'); return { actor: { clientId: 'client-1', phoneNorm: PHONE, name: 'Player' } };
  } };
  const service: any = new TournamentsService({} as never, {} as never, {} as never, persistence,
    {} as never, {} as never, viva, undefined, undefined, identity,
    { resolveCanonicalLevelByIdentity: async () => ({ clientId: 'client-1', levelLabel: 'C' }) } as never);
  Object.assign(service, {
    requireCustomBySlug: async () => tournament,
    enrichTournamentVivaProfiles: async (t: any) => t,
    toPublicView: (t: any) => t,
    hydrateCustomTournament: async (t: any) => t, publishTournamentToSelectedCommunities: async () => undefined,
    fetchVivaBookingSubscriptions: async () => [], fetchVivaJoinPurchaseOptions: async () => [],
    resolveJoinPayment: () => ({ required: false, code: 'NOT_REQUIRED', purchaseOptions: [] }),
    enrichTournamentParticipantWithViva: async (p: any) => p,
    enrichPendingJoinPaymentWithViva: async (p: any) => p,
    createSourceTournamentBooking: async () => { counters.provider++; return { ok: true }; },
    continuePublicJoinTransactionCreation: async () => { counters.provider++; return { ok: true, code: 'PURCHASE_STARTED' }; },
    continuePublicJoinSubscriptionBooking: async () => { counters.provider++; return { ok: true, code: 'REGISTERED' }; }
  });
  const input: any = { clientId: 'client-1', phone: PHONE, name: 'Player', levelLabel: 'C',
    vivaAuthorizationHeader: 'Bearer synthetic', successUrl: 'https://example.invalid/ok', failUrl: 'https://example.invalid/fail' };
  return { service, tournament, input, counters, persistence, viva, setRaw: (r: any) => { raw = r; } };
}
async function main() {
  for (const rule of ['MALE', 'FEMALE']) {
    for (const sex of [null, rule === 'MALE' ? 'FEMALE' : 'MALE'] as const) {
      for (const method of ['registerPublicParticipant', 'addPublicParticipantToWaitlist', 'createPublicJoinPurchaseTransaction']) {
        const f = fixture(rule, sex);
        const result = await f.service[method]('cup', { ...f.input, gender: rule });
        assert.equal(result.code, sex ? 'GENDER_NOT_ALLOWED' : 'PLAYER_GENDER_REQUIRED', method);
        assert.equal(f.counters.provider + f.counters.append + f.counters.waitlist + f.counters.reserve, 0);
      }
    }
    const f = fixture(rule, rule as 'MALE' | 'FEMALE');
    assert.equal((await f.service.registerPublicParticipant('cup', f.input)).code, 'REGISTERED');
    assert.equal(f.counters.profile, 1); assert.equal(f.counters.append, 1);
  }
  for (const method of ['registerPublicParticipant', 'addPublicParticipantToWaitlist']) {
    const f = fixture('MIXED', null);
    assert.equal((await f.service[method]('cup', f.input)).ok, true);
    assert.equal(f.counters.profile, 0, 'explicit MIXED has no sex lookup or balance rule');
  }
  for (const invalid of [null, { gender: null, updatedAt: NOW }, { gender: 'MIXED', updatedAt: 'changed' }]) {
    const f = fixture('MIXED'); f.setRaw(invalid);
    assert.equal((await f.service.registerPublicParticipant('cup', f.input)).code, 'TOURNAMENT_RULE_CHANGED');
    assert.equal(f.counters.provider, 0);
  }
  for (const forged of [{ clientId: 'other' }, { phone: '79000000002' }, { vivaAuthorizationHeader: undefined, trustedIdentity: { clientId: 'client-1', phone: PHONE } }]) {
    const f = fixture();
    assert.equal((await f.service.registerPublicParticipant('cup', { ...f.input, ...forged, gender: 'MALE' })).code, 'PLAYER_GENDER_REQUIRED');
    assert.equal(f.counters.profile + f.counters.provider, 0);
  }
  {
    const f = fixture(); f.viva.readTournamentProfileSex = async () => { throw new Error('timeout'); };
    assert.equal((await f.service.addPublicParticipantToWaitlist('cup', f.input)).code, 'PLAYER_GENDER_REQUIRED');
    assert.equal(f.counters.waitlist, 0);
  }
  {
    const f = fixture(); f.tournament.participants = Array.from({ length: 4 }, (_, n) => ({ phone: `7900000000${n + 2}` }));
    assert.equal((await f.service.registerPublicParticipant('cup', f.input)).code, 'WAITLISTED');
    assert.equal(f.counters.waitlist, 1); assert.equal(f.counters.provider, 0);
  }
  {
    const f = fixture(); f.persistence.appendPublicWaitlistWithAdmission = async () => null;
    assert.equal((await f.service.addPublicParticipantToWaitlist('cup', f.input)).code, 'TOURNAMENT_RULE_CHANGED');
  }
  for (const provider of ['VIVA', 'UNKNOWN']) {
    const f = fixture(); f.service.resolveSourceTournamentProvider = () => provider;
    assert.equal((await f.service.registerPublicParticipant('cup', f.input)).code, 'TOURNAMENT_SECURE_JOIN_REQUIRED');
    assert.equal(f.counters.provider + f.counters.append + f.counters.reserve, 0);
    f.tournament.participants = Array.from({ length: 4 }, (_, n) => ({ phone: `7900000000${n + 2}` }));
    assert.equal((await f.service.registerPublicParticipant('cup', f.input)).code, 'WAITLISTED');
    assert.equal(f.counters.provider, 0);
  }
  for (const subscription of [false, true]) {
    const f = fixture();
    f.service.resolveJoinPayment = () => ({ required: true, code: subscription ? 'SUBSCRIPTION_AVAILABLE' : 'PURCHASE_REQUIRED',
      availableSubscriptions: [{ id: 'sub-1', label: 'Entry' }], selectedSubscription: { id: 'sub-1', label: 'Entry' },
      purchaseOptions: [{ id: 'product-1', label: 'Entry', productType: 'ONE_TIME' }] });
    assert.equal((await f.service.createPublicJoinPurchaseTransaction('cup', f.input)).ok, true);
    assert.equal(f.counters.reserve, 1); assert.equal(f.counters.profile, 1);
    const stored = f.service.findPendingJoinPayment(f.tournament, PHONE);
    assert.equal(stored.eligibilitySnapshot.genderDecision.playerGender, 'MALE', 'gender snapshot survives parser');
    const rejected = fixture(); rejected.persistence.reservePublicJoinPayment = async () => null;
    rejected.service.resolveJoinPayment = f.service.resolveJoinPayment;
    assert.equal((await rejected.service.createPublicJoinPurchaseTransaction('cup', rejected.input)).code, 'BOOKING_FAILED');
    assert.equal(rejected.counters.provider, 0, 'CAS miss never dispatches');
  }
  {
    const f = fixture(); const canonical = await f.service.resolveTrustedLkRegistrationClient('Bearer synthetic');
    const flow = await f.service.getPublicJoinFlow('cup', { authorized: true, phone: PHONE, clientId: 'client-1',
      levelLabel: 'C', subscriptions: [], [TRUSTED_TOURNAMENT_CLIENT]: canonical });
    assert.equal(flow.code, 'READY_TO_JOIN');
    const wrong = fixture('FEMALE');
    const identity = await wrong.service.resolveCanonicalLkRegistrationClientByVerifiedPhone({ phone: PHONE });
    const refused = await wrong.service.getPublicJoinFlow('cup', { authorized: true, phone: PHONE, clientId: 'client-1',
      levelLabel: 'C', subscriptions: [], [TRUSTED_TOURNAMENT_CLIENT]: identity });
    assert.equal(refused.code, 'GENDER_NOT_ALLOWED'); assert.equal(refused.waitlistAllowed, false);
  }
  for (const state of ['PROVIDER_RESULT_UNKNOWN', 'PAID_PENDING_FINALIZATION']) {
    const f = fixture('FEMALE');
    f.service.resolveJoinPayment = () => ({ required: true, code: 'PURCHASE_REQUIRED', purchaseOptions: [{ id: 'product-1', label: 'Entry' }] });
    f.service.findPendingJoinPayment = () => ({ state });
    f.service.hasDurableVerifiedPayment = () => true;
    f.service.finalizePaidPublicJoin = async () => ({ ok: true, code: 'REGISTERED' });
    const outcome = await f.service.createPublicJoinPurchaseTransaction('cup', f.input);
    assert.equal(outcome.code, state === 'PAID_PENDING_FINALIZATION' ? 'REGISTERED' : 'BOOKING_FAILED');
    assert.equal(f.counters.profile + f.counters.reserve + f.counters.provider, 0);
  }
  // Real persistence methods: exact rule/generation predicates, minimal primary read, no indexes.
  {
    const p: any = Object.create(TournamentsPersistenceService.prototype);
    p.buildIdFilter = (id: string) => ({ id });
    let row: any = { gender: 'MALE', updatedAt: NOW }; const queries: any[] = [];
    p.collection = async (indexes?: boolean) => ({
      findOne: async (q: any, options: any) => { assert.equal(indexes, false); assert.deepEqual(options.projection, { _id: 0, gender: 1, updatedAt: 1 }); return row; },
      findOneAndUpdate: async (q: any) => { queries.push(q); return null; }
    });
    assert.deepEqual(await p.readPublicAdmissionRule('cup'), row);
    for (const invalid of [null, 'bad', undefined, {}]) { row = { gender: invalid, updatedAt: NOW }; assert.equal(await p.readPublicAdmissionRule('cup'), null); }
    const rule = { gender: 'MALE', updatedAt: NOW };
    await p.reservePublicJoinPayment('cup', { phone: PHONE, transactionId: 'attempt' }, rule);
    await p.appendPublicParticipantIfCapacity('cup', PHONE, {}, rule);
    await p.appendPublicWaitlistWithAdmission('cup', PHONE, {}, rule);
    assert.equal(queries.length, 3);
    for (const query of queries) { assert.equal(query.gender, 'MALE'); assert.equal(query.updatedAt, NOW); }
  }
  // Actual profile transport mocked in-process: exact URL, own identity and M/F/U only.
  {
    const v: any = Object.create(VivaAdminService.prototype);
    v.requireAccessToken = async () => 'synthetic-token'; v.getResolvedSettings = async () => ({ config: { baseUrl: 'https://example.invalid' } });
    v.envEndUserWidgetId = 'iSkq6G'; v.buildAbortSignal = () => undefined;
    const old = global.fetch; let response: any = { id: 'client-1', phone: PHONE, sex: 'M' };
    global.fetch = (async (url: string, options: any) => {
      assert.equal(url, 'https://example.invalid/end-user/api/v1/iSkq6G/profile');
      assert.equal(options.redirect, 'error'); assert.equal(options.headers['x-user-id'], 'client-1');
      return { status: 200, url, redirected: false, json: async () => response };
    }) as any;
    try {
      assert.equal(await v.readTournamentProfileSex({ clientId: 'client-1', phone: PHONE }), 'MALE');
      response.sex = 'F'; assert.equal(await v.readTournamentProfileSex({ clientId: 'client-1', phone: PHONE }), 'FEMALE');
      for (const sex of ['U', 'MALE', '', null, {}]) { response.sex = sex; assert.equal(await v.readTournamentProfileSex({ clientId: 'client-1', phone: PHONE }), null); }
      response.id = 'other'; await assert.rejects(v.readTournamentProfileSex({ clientId: 'client-1', phone: PHONE }));
      response.id = 'client-1'; response.phone = '79000000002'; await assert.rejects(v.readTournamentProfileSex({ clientId: 'client-1', phone: PHONE }));
    } finally { global.fetch = old; }
  }
  console.log('tournament gender admission synthetic scenarios PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
