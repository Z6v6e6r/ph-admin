import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPublicController } from '../src/tournaments/tournaments-public.controller';
import { TournamentsController } from '../src/tournaments/tournaments.controller';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { readTournamentLevelAdmissionMode, parseTournamentLevelRule } from '../src/tournaments/tournament-level-admission';

const clone = <T>(value: T): T => structuredClone(value);
const phone = '12025550101';
function fixture() {
  let row: any = { id: 'synthetic', slug: 'synthetic', gender: 'MIXED', source: 'CUSTOM',
    updatedAt: '2026-11-18T00:00:00Z', accessLevels: ['3', '3.125', '3.25', '3.375', '3.5'],
    levelTolerance: 0, maxPlayers: 4, participants: [], waitlist: [], status: 'REGISTRATION' };
  let rating: number | null = 3.25, writes = 0, levelReads = 0;
  const service: any = Object.create(TournamentsService.prototype);
  const identities = new WeakMap<object, any>();
  const identity = { phone, clientId: 'client-synthetic' }; identities.set(identity, identity);
  const persistence: any = { isEnabled: () => true,
    readPublicAdmissionRule: async () => ({ gender: row.gender, updatedAt: row.updatedAt,
      accessLevels: clone(row.accessLevels), levelTolerance: row.levelTolerance }),
    findCustomTournamentById: async () => clone(row),
    appendPublicParticipantIfCapacity: async (_id: string, target: string, participant: any, rule: any) => {
      if (row.participants.some((p: any) => p.phone === target) || row.updatedAt !== rule.updatedAt) return null;
      writes++; row.participants.push(clone(participant)); return clone(row);
    },
    appendPublicWaitlistWithAdmission: async (_id: string, target: string, participant: any, rule: any) => {
      if (row.waitlist.some((p: any) => p.phone === target) || row.updatedAt !== rule.updatedAt) return null;
      writes++; row.waitlist.push(clone(participant)); return clone(row);
    },
    updateCustomTournament: async (_id: string, mutation: any, before: any) => {
      assert.equal(before.updatedAt, row.updatedAt); writes++; row = { ...row, ...clone(mutation) }; return clone(row);
    }
  };
  Object.assign(service, { tournamentsPersistence: persistence, trustedRegistrationIdentities: identities,
    playerRatingsService: { resolveCanonicalLevelByIdentity: async () => {
      levelReads++; return rating === null ? null : { levelLabel: String(rating), ratingNumeric: rating };
    } },
    requireCustomBySlug: async () => clone(row), requireCustomByPublicRef: async () => clone(row),
    ensureTournamentVisibleForUser: () => {}, hydrateCustomTournament: async (x: any) => x,
    fetchVivaJoinPurchaseOptions: async () => [],
    resolveJoinPayment: () => ({ required: false, code: 'NOT_REQUIRED' }),
    findPendingJoinPayment: () => null, getPendingJoinPayments: () => [],
    enrichTournamentParticipantWithViva: async (p: any) => p,
    resolveSourceTournamentProvider: () => 'NON_VIVA',
    createSourceTournamentBooking: async () => ({ ok: true }),
    publishTournamentToSelectedCommunities: async () => {}, invalidatePublicDirectoryCache: () => {}
  });
  const input = { trustedIdentity: identity, phone, clientId: identity.clientId, name: 'Synthetic', levelLabel: '7' };
  return { service, persistence, input, setRating: (n: number | null) => { rating = n; },
    get row() { return row; }, get writes() { return writes; }, get levelReads() { return levelReads; } };
}

for (const [rating, allowed] of [[2.99999, false], [3, true], [3.25, true], [3.5, true], [3.50001, false]] as const) {
  test(`legacy server register reads canonical ${rating}: ${allowed ? 'allow' : 'refuse'}`, async () => {
    const f = fixture(); f.setRating(rating);
    const result = await f.service.registerPublicParticipant('synthetic', f.input);
    assert.equal(result.ok, allowed);
    assert.equal(result.code, allowed ? 'REGISTERED' : 'LEVEL_NOT_ALLOWED');
    assert.equal(f.writes, allowed ? 1 : 0);
    if (allowed) assert.equal(f.row.participants[0].levelLabel, String(rating));
  });
}
test('mandatory mode cannot be disabled by unset, OFF, LEGACY or unknown settings', () => {
  for (const value of [undefined, 'off', 'legacy', 'enforce', 'typo']) {
    assert.equal(readTournamentLevelAdmissionMode({ TOURNAMENT_LEVEL_ADMISSION_MODE: value }), 'ENFORCE');
  }
  for (const value of [[null], [''], ['3', {}], ['3', '4']]) assert.equal(parseTournamentLevelRule(value).kind, 'INVALID');
});
test('direct old API ignores forged level and invitation/override fields', async () => {
  for (const extra of [{}, { invitation: { type: 'PERSONAL', bypassLevel: true } }, { invitation: { type: 'PUBLIC' } }, { skipLevelCheck: true }]) {
    const f = fixture(); f.setRating(5);
    const result = await f.service.registerPublicParticipantByTournamentRef('synthetic', { ...f.input, levelLabel: '3.25', ...extra });
    assert.equal(result.code, 'LEVEL_NOT_ALLOWED'); assert.equal(f.writes, 0);
  }
});
test('fresh canonical level is checked again before admission after slow preparation', async () => {
  const f = fixture();
  f.service.fetchVivaJoinPurchaseOptions = async () => { f.setRating(5); return []; };
  const result = await f.service.registerPublicParticipant('synthetic', f.input);
  assert.equal(result.code, 'LEVEL_NOT_ALLOWED'); assert.equal(f.writes, 0); assert.equal(f.levelReads, 2);
});
test('rule change during preparation fails closed without writing', async () => {
  const f = fixture();
  f.service.fetchVivaJoinPurchaseOptions = async () => { f.row.accessLevels = ['4']; return []; };
  assert.equal((await f.service.registerPublicParticipant('synthetic', f.input)).code, 'TOURNAMENT_RULE_CHANGED');
  assert.equal(f.writes, 0);
});
test('repeat and concurrent legacy registration creates one membership; replay survives level change', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.registerPublicParticipant('synthetic', f.input), f.service.registerPublicParticipant('synthetic', f.input)]);
  assert.ok(results.every(x => x.ok)); assert.equal(f.writes, 1); assert.equal(f.row.participants.length, 1);
  f.setRating(5);
  assert.equal((await f.service.registerPublicParticipant('synthetic', f.input)).code, 'ALREADY_REGISTERED');
  assert.equal(f.writes, 1);
});
test('waitlist admission and manual promotion use current canonical level', async () => {
  const f = fixture();
  assert.equal((await f.service.addPublicParticipantToWaitlist('synthetic', f.input)).code, 'WAITLISTED');
  const entrant = clone(f.row.waitlist[0]); f.setRating(5);
  await assert.rejects(f.service.updateCustom('synthetic', { participants: [{ ...entrant, status: 'REGISTERED', levelLabel: '3.25' }], waitlist: [] }),
    (e: any) => e.getResponse().code === 'LEVEL_NOT_ALLOWED');
  assert.equal(f.row.participants.length, 0); assert.equal(f.row.waitlist.length, 1);
  f.setRating(3.5);
  await f.service.updateCustom('synthetic', { participants: [{ ...entrant, status: 'REGISTERED' }], waitlist: [] });
  assert.equal(f.row.participants.length, 1); assert.equal(f.row.waitlist.length, 0);
});
test('admin additions have no implicit role bypass; existing participants can be retained or removed', async () => {
  const f = fixture(); f.setRating(5);
  await assert.rejects(f.service.updateCustom('synthetic', { participants: [{ phone, levelLabel: '3.25' }] }),
    (e: any) => e.getResponse().code === 'LEVEL_NOT_ALLOWED');
  f.row.participants = [{ phone, status: 'REGISTERED' }];
  await f.service.updateCustom('synthetic', { participants: clone(f.row.participants) });
  await f.service.updateCustom('synthetic', { participants: [] });
  assert.equal(f.row.participants.length, 0);
});
test('missing or unavailable level refuses without provider or roster mutation', async () => {
  const f = fixture(); f.setRating(null);
  assert.equal((await f.service.registerPublicParticipant('synthetic', f.input)).code, 'PLAYER_LEVEL_REQUIRED');
  f.service.playerRatingsService.resolveCanonicalLevelByIdentity = async () => { throw Error('offline'); };
  assert.equal((await f.service.registerPublicParticipant('synthetic', f.input)).code, 'LEVEL_CHECK_UNAVAILABLE');
  assert.equal(f.writes, 0);
});
test('legacy response retains old shape and adds stable reason code', () => {
  const controller: any = Object.create(TournamentsController.prototype);
  const response = controller.toLkRegistrationState({ ok: false, code: 'LEVEL_NOT_ALLOWED', message: 'denied' });
  assert.deepEqual(response, { status: 'NONE', canRegister: false, canCancel: false, message: 'denied', code: 'LEVEL_NOT_ALLOWED' });
});
test('raw rule read does not turn missing/malformed accessLevels into unrestricted', async () => {
  const persistence: any = Object.create(TournamentsPersistenceService.prototype);
  for (const levels of [undefined, null, ['C', {}]]) {
    persistence.collection = async () => ({ findOne: async () => ({ gender: 'MIXED', updatedAt: '2026-11-18T00:00:00Z', accessLevels: levels }) });
    assert.equal(await persistence.readPublicAdmissionRule('synthetic'), null);
  }
});

test('repeated create-from-source preserves saved rule when fields are omitted', async () => {
  const f = fixture(); f.setRating(5);
  f.persistence.findCustomTournamentBySourceTournamentId = async () => clone(f.row);
  await assert.rejects(f.service.createOrUpdateCustomTournamentFromSource(
    { id: 'provider-synthetic', name: 'Synthetic', participants: [] },
    { participants: [{ phone, name: 'Synthetic', levelLabel: '3.25' }] }),
    (e: any) => { if (!e.getResponse) throw e; return e.getResponse().code === 'LEVEL_NOT_ALLOWED'; });
  assert.equal(f.writes, 0); assert.equal(f.row.accessLevels[0], '3');
});

test('repair writer fences raw preimage and never restores a restricted or populated shell', async () => {
  const p: any = Object.create(TournamentsPersistenceService.prototype);
  const before = { id: 'synthetic', slug: 'synthetic', accessLevels: ['C'], participants: [], waitlist: [] };
  p.buildCreateDocument = async () => ({ id: 'synthetic', slug: 'synthetic', name: 'Synthetic' });
  let query: any;
  await assert.rejects(p.restoreExistingTournamentDocument({ updateOne: async (q: any) => {
    query = q; return { matchedCount: 0 };
  } }, before, {}));
  assert.deepEqual(query.$expr, { $eq: ['$$ROOT', { $literal: before }] });
  for (const key of ['accessLevels', 'participants', 'waitlist']) assert.deepEqual(query[key], { $eq: [] });
});

test('admin additions cannot turn malformed raw accessLevels into unrestricted DTO fallback', async () => {
  const f = fixture(); f.row.accessLevels = [];
  f.persistence.readPublicAdmissionRule = async () => null;
  await assert.rejects(f.service.updateCustom('synthetic', { participants: [{ phone, name: 'Synthetic' }] }),
    (e: any) => e.getResponse().code === 'TOURNAMENT_RULE_CHANGED');
  assert.equal(f.writes, 0);
});


test('unrestricted admission preserves canonical level for subscription compatibility', async () => {
  const f = fixture(); f.row.accessLevels = []; f.setRating(5);
  const seen: any[] = [];
  f.service.resolveJoinPayment = (_t: any, _client: any, level: string) => {
    seen.push(level);
    const compatible = f.service.isSubscriptionCompatible(
      { id: 'c-only', label: 'C only', remainingUses: 1, compatibleAccessLevels: ['C'] },
      { acceptedSubscriptions: [] },
      { ...f.row, tournamentType: 'Американо' }, level);
    assert.equal(compatible, false);
    return { required: true, code: 'PURCHASE_REQUIRED', purchaseOptions: [{ id: 'single' }] };
  };
  const result = await f.service.registerPublicParticipant('synthetic', { ...f.input, levelLabel: '3.25' });
  assert.equal(result.code, 'PURCHASE_REQUIRED');
  assert.deepEqual(seen, ['5']);
  assert.equal(f.writes, 0);
});


test('real public controller reaches original payment recovery after rating and catalog change', async () => {
  const f = fixture(); f.setRating(6);
  const operation = { transactionId: 'original-attempt', providerTransactionId: 'original-tx',
    phone, clientId: f.input.clientId, state: 'PENDING_PAYMENT', operationType: 'TRANSACTION',
    checkoutUrl: 'https://pay.example/original', paymentExpiresAt: '2099-01-01T00:00:00Z' };
  f.service.findPendingJoinPayment = () => operation;
  f.service.isPendingJoinPaymentBoundToTournament = () => true;
  f.service.enrichTournamentVivaProfiles = async (x: any) => x;
  f.service.fetchVivaBookingSubscriptions = async () => [];
  f.service.toPublicView = (x: any) => x;
  f.service.resolveTrustedLkRegistrationClient = async () => ({ ...f.input, levelLabel: '6' });
  f.service.fetchVivaJoinPurchaseOptions = async () => [];
  f.service.resolveJoinPayment = () => ({ required: false, code: 'NOT_REQUIRED', availableSubscriptions: [], purchaseOptions: [] });
  const sessions = { ensureAuthorizedClient: () => ({ authorized: true, phoneVerified: true, phone }),
    resolveLkAuthorizationHeader: () => 'Bearer synthetic', resolveExternalAuthorizationHeader: () => 'Bearer synthetic' };
  const controller: any = new TournamentsPublicController(f.service, sessions as never);
  // Keep real controller routing + real getPublicJoinFlow/createPublicJoinPurchaseTransaction.
  controller.enrichJoinFlow = (x: any) => x;
  controller.buildCanonicalPublicJoinUrl = () => 'https://padlhub.ru/tournament';
  let response: any;
  await controller.submitJoinPage('synthetic', { headers: { authorization: 'Bearer synthetic' }, query: { format: 'json' } },
    { json: (x: any) => { response = x; } }, undefined, { format: 'json', purchaseConfirmed: true });
  assert.equal(response.code, 'PURCHASE_STARTED');
  assert.equal(response.payment.transactionId, 'original-tx');
  assert.equal(response.payment.checkoutUrl, 'https://pay.example/original');
  assert.equal(f.writes, 0);
});
