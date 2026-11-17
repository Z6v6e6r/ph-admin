import * as assert from 'node:assert/strict';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomTournamentFromSourceDto } from '../src/tournaments/dto/create-custom-tournament-from-source.dto';
import { UpdateCustomTournamentDto } from '../src/tournaments/dto/update-custom-tournament.dto';
import { TournamentsController } from '../src/tournaments/tournaments.controller';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

/** Real TournamentsService routes with synthetic collaborators; no Viva, Mongo or payment is reached. */

const C_SLIDER = ['3', '3.125', '3.25', '3.375', '3.5'];
const PHONE = '79123456789';

function tournament(overrides: Partial<CustomTournament> = {}): CustomTournament {
  return {
    id: 'custom-level-1', source: 'CUSTOM', slug: 'level-cup', publicUrl: '/api/tournaments/public/level-cup',
    name: 'Level Cup', status: TournamentStatus.REGISTRATION, sourceTournamentId: 'exercise-level-1',
    tournamentType: 'Американо', accessLevels: C_SLIDER, levelTolerance: 0.2, gender: 'MIXED',
    updatedAt: '2026-11-17T10:00:00.000Z', maxPlayers: 16, participants: [], participantsCount: 0,
    paidParticipantsCount: 0, waitlist: [], waitlistCount: 0, allowedManagerPhones: [], studioId: 'studio-1',
    studioName: 'Synthetic', startsAt: '2026-12-09T07:00:00+03:00', endsAt: '2026-12-09T08:00:00+03:00',
    mechanics: { enabled: false } as never, changeLog: [], skin: { title: 'Турнир', priceLabel: '2 500 ₽' },
    details: { booking: { paymentRequired: true, vivaWidgetId: 'iSkq6G', vivaExerciseId: 'exercise-level-1', vivaStudioId: 'studio-1' } },
    ...overrides
  } as CustomTournament;
}

type Rating = number | null | 'CONFLICT' | 'DOWN';
function ratings(value: () => Rating) {
  const calls: Array<{ clientId?: string; phone: string }> = [];
  return {
    calls,
    service: {
      resolveCanonicalLevelByIdentity: async (input: { clientId?: string; phone: string }) => {
        calls.push(input);
        const current = value();
        if (current === 'CONFLICT') throw new ConflictException({ code: 'RATING_STATE_NOT_CANONICAL' });
        if (current === 'DOWN') throw new ServiceUnavailableException({ code: 'RATING_STORE_UNAVAILABLE' });
        return current === null ? null : { playerKey: 'p', clientId: 'client-1', levelLabel: String(current), ratingNumeric: current };
      }
    }
  };
}

const identity = {
  verifyTrustedBearer: async (header?: string) => {
    if (header !== 'Bearer synthetic') throw new Error('unauthenticated');
    return { actor: { clientId: 'client-1', phoneNorm: PHONE, name: 'Synthetic' } };
  }
};

function service(row: CustomTournament, rating: ReturnType<typeof ratings>, viva: Record<string, unknown> = {}, persistence: Record<string, unknown> = {}) {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    {} as never,
    {
      isEnabled: () => true,
      readPublicAdmissionRule: async () => ({ gender: row.gender, updatedAt: row.updatedAt }),
      listCustomTournaments: async () => [row],
      findCustomTournamentById: async (id: string) => (id === row.id ? row : null),
      findCustomTournamentBySlug: async (slug: string) => (slug === row.slug ? row : null),
      findCustomTournamentBySourceTournamentId: async (id: string) => (id === row.sourceTournamentId ? row : null),
      ...persistence
    } as never,
    {} as never,
    {} as never,
    viva as never,
    undefined,
    undefined,
    identity as never,
    rating.service as never
  );
}

function withMode<T>(mode: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.TOURNAMENT_LEVEL_ADMISSION_MODE;
  if (mode === undefined) delete process.env.TOURNAMENT_LEVEL_ADMISSION_MODE;
  else process.env.TOURNAMENT_LEVEL_ADMISSION_MODE = mode;
  return run().finally(() => {
    if (previous === undefined) delete process.env.TOURNAMENT_LEVEL_ADMISSION_MODE;
    else process.env.TOURNAMENT_LEVEL_ADMISSION_MODE = previous;
  });
}

// ---- Energy checkout (custom-energy-checkout) ------------------------------------------------

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function energyBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authProvider: 'lk-keycloak', tenantKey: 'iSkq6G', exerciseId: 'exercise-level-1', studioId: 'studio-1',
    client: { id: 'client-1', phone: PHONE },
    product: { name: 'Энергия турниры', type: 'SUBSCRIPTION', kind: 'TOURNAMENT_CUSTOM_ENERGY' },
    pricing: { currency: 'RUB', priceLabel: '2 500 ₽', amount: 2500, amountMinor: 250000, baseAmount: 20000,
      baseAmountMinor: 2000000, discountAmount: 17500, discountAmountMinor: 1750000,
      discountReason: 'Участие в турнире «Турнир» 09.12.2026' },
    tournament: { id: 'custom-level-1', exerciseId: 'exercise-level-1', linkedCustomTournamentId: 'custom-level-1',
      title: 'Турнир', startsAt: '2026-12-09T07:00:00+03:00', dateLabel: '09.12.2026', studioId: 'studio-1' },
    returnUrls: { successUrl: 'https://padlhub.ru/t?ok=1', failUrl: 'https://padlhub.ru/t?fail=1' },
    ...overrides
  };
}

async function energyCases(): Promise<void> {
  process.env.TOURNAMENTS_PUBLIC_TENANT_KEY = 'iSkq6G';
  process.env.TOURNAMENTS_PUBLIC_KEYCLOAK_REALM = 'prod';
  const token = buildJwt({ exp: Math.floor(Date.now() / 1000) + 3600, phone_number: PHONE, tenantKey: 'iSkq6G', sub: 'client-1' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200,
    json: async () => ({ phone_number: PHONE, tenantKey: 'iSkq6G', sub: 'client-1' }) })) as unknown as typeof fetch;
  try {
    let current: Rating = 3.31;
    const rating = ratings(() => current);
    let providerCalls = 0;
    const viva = { createTournamentEnergyCheckout: async () => { providerCalls += 1;
      return { clientId: 'client-1', transactionId: 't-1', paymentUrl: 'https://pay.example/1', toPayMinor: 250000 }; } };
    const run = (body = energyBody()) => service(tournament(), rating, viva).createCustomEnergyCheckout('exercise-level-1', {
      body, authorizationHeader: `Bearer ${token}`, authSourceHeader: 'lk-keycloak', tenantKeyHeader: 'iSkq6G'
    });
    const refusal = async (code: string, status: number, body?: Record<string, unknown>) => {
      const before = providerCalls;
      await assert.rejects(() => run(body), (error: any) => {
        assert.equal(error.getStatus(), status);
        assert.equal(error.getResponse().code, code);
        assert.equal(error.getResponse().levelDecision.reasonCode, code);
        return true;
      });
      assert.equal(providerCalls, before, `${code}: no Viva payment may be created`);
    };

    await withMode('enforce', async () => {
      assert.equal((await run()).ok, true, '3.31 inside 3.0–3.5 pays');
      current = 2.8; assert.equal((await run()).ok, true, 'boundary admitted by tolerance');
      current = 3.80001; await refusal('LEVEL_NOT_ALLOWED', 403);
      current = null; await refusal('PLAYER_LEVEL_REQUIRED', 403);
      current = 'CONFLICT'; await refusal('PLAYER_LEVEL_UNKNOWN', 403);
      current = 'DOWN'; await refusal('LEVEL_CHECK_UNAVAILABLE', 503);
      // Client-supplied level, range and tolerance are ignored; the CUP level is re-read.
      current = 4.5;
      await refusal('LEVEL_NOT_ALLOWED', 403, energyBody({ levelLabel: '3.2', levelTolerance: 2, accessLevels: [],
        client: { id: 'client-1', phone: PHONE, levelLabel: '3.2', ratingNumeric: 3.2 } }));
      assert.ok(rating.calls.every((call) => call.clientId === 'client-1' && call.phone === PHONE));
    });
    // Rollout switch: LEGACY (unset) keeps the previous energy behavior; OFF disables the gate.
    current = 5;
    await withMode(undefined, async () => assert.equal((await run()).ok, true));
    await withMode('off', async () => assert.equal((await run()).ok, true));
    // Unrestricted tournament never reads the rating and never refuses.
    const unrestricted = ratings(() => { throw new Error('must not read rating'); });
    await withMode('enforce', async () => {
      const result = await service(tournament({ accessLevels: [] }), unrestricted, viva)
        .createCustomEnergyCheckout('exercise-level-1', { body: energyBody(), authorizationHeader: `Bearer ${token}`,
          authSourceHeader: 'lk-keycloak', tenantKeyHeader: 'iSkq6G' });
      assert.equal(result.ok, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---- Decision route and registration/me ----------------------------------------------------

async function decisionCases(): Promise<void> {
  let current: Rating = 3.31;
  const rating = ratings(() => current);
  const svc = service(tournament(), rating);
  await withMode('enforce', async () => {
    const allowed = await svc.getLevelDecisionByTournamentRef('custom-level-1', 'Bearer synthetic');
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.reasonCode, 'LEVEL_ALLOWED');
    assert.deepEqual(allowed.baseRange, { min: 3, max: 3.5 });
    assert.deepEqual(allowed.effectiveRange, { min: 2.8, max: 3.7 });
    assert.equal(allowed.levelTolerance, 0.2);
    assert.equal(allowed.enforced, true);
    current = 2.9;
    assert.equal((await svc.getLevelDecisionByTournamentRef('exercise-level-1', 'Bearer synthetic')).reasonCode,
      'LEVEL_ALLOWED_WITH_TOLERANCE');
    current = 3.70001;
    assert.equal((await svc.getLevelDecisionByTournamentRef('level-cup', 'Bearer synthetic')).allowed, false);
    await assert.rejects(() => svc.getLevelDecisionByTournamentRef('custom-level-1', 'Bearer forged'));
  });
  await withMode(undefined, async () => {
    current = 5;
    const legacy = await svc.getLevelDecisionByTournamentRef('custom-level-1', 'Bearer synthetic');
    assert.equal(legacy.enforced, false);
    assert.equal(legacy.allowed, true);
    assert.equal(legacy.reasonCode, 'LEVEL_GATE_LEGACY');
  });

  // registration/me: only a new registration is gated; existing participants are not re-evaluated.
  const registrationFor = (status: 'NONE' | 'REGISTERED') => ({
    getPublicRegistrationByTournamentRef: async () => status === 'NONE'
      ? { status, canRegister: true, canCancel: false, message: 'Игрок пока не записан в турнир.' }
      : { status, placeNumber: 1, canRegister: false, canCancel: true, message: 'Игрок уже записан в турнир.' },
    resolveTrustedLkRegistrationClient: async () => ({ name: 'Synthetic', phone: PHONE }),
    getLevelDecisionByTournamentRef: (ref: string, header?: string) => svc.getLevelDecisionByTournamentRef(ref, header)
  });
  const controller = (status: 'NONE' | 'REGISTERED') =>
    new TournamentsController(registrationFor(status) as never, {} as never, {} as never);
  const request = { headers: { authorization: 'Bearer synthetic' } } as never;
  await withMode('enforce', async () => {
    current = 4.2;
    const denied = await controller('NONE').getMyRegistration('custom-level-1', request);
    assert.equal(denied.canRegister, false);
    assert.equal(denied.levelDecision?.reasonCode, 'LEVEL_NOT_ALLOWED');
    assert.match(denied.message, /вне допустимого диапазона 2,80–3,70/);
    const registered = await controller('REGISTERED').getMyRegistration('custom-level-1', request);
    assert.equal(registered.status, 'REGISTERED');
    assert.equal(registered.canCancel, true);
    assert.equal(registered.levelDecision, undefined);
    current = 3.2;
    const allowed = await controller('NONE').getMyRegistration('custom-level-1', request);
    assert.equal(allowed.canRegister, true);
    assert.equal(allowed.levelDecision?.allowed, true);
  });
  await withMode(undefined, async () => {
    current = 4.2;
    const legacy = await controller('NONE').getMyRegistration('custom-level-1', request);
    assert.equal(legacy.canRegister, true, 'LEGACY must not change the LK button');
  });
}

// ---- Purchase recovery after a rule change --------------------------------------------------

async function purchaseCases(): Promise<void> {
  const rating = ratings(() => 4.5);
  const paidPending = { transactionId: 'tp-1', state: 'PAID_PENDING_FINALIZATION', operationType: 'TRANSACTION', phone: PHONE };
  const row = tournament({ details: { booking: { paymentRequired: true, vivaWidgetId: 'iSkq6G', vivaExerciseId: 'exercise-level-1',
    vivaStudioId: 'studio-1', pendingJoinPayments: [paidPending] } } as never });
  const svc = service(row, rating) as any;
  let finalized = 0;
  svc.fetchVivaJoinPurchaseOptions = async () => [{ id: 'one-time', label: 'Участие', priceLabel: '2500', productType: 'SERVICE' }];
  svc.findPendingJoinPayment = (_t: unknown, phone: string) => (phone === PHONE ? paidPending : null);
  svc.hasDurableVerifiedPayment = () => true;
  svc.finalizePaidPublicJoin = async () => { finalized += 1; return { ok: true, code: 'REGISTERED', message: 'ok' }; };
  await withMode('enforce', async () => {
    // Rating 4.5 is now outside 2.80–3.70, but the paid participation is finalized, not lost.
    const result = await svc.createPublicJoinPurchaseTransaction('level-cup', {
      phone: PHONE, name: 'Synthetic', levelLabel: '4.5', selectedPurchaseOptionId: 'one-time'
    });
    assert.equal(result.code, 'REGISTERED');
    assert.equal(finalized, 1);
    // Without a started payment the same player is refused before any payment exists.
    svc.findPendingJoinPayment = () => null;
    const refused = await svc.createPublicJoinPurchaseTransaction('level-cup', {
      phone: PHONE, name: 'Synthetic', levelLabel: '4.5', selectedPurchaseOptionId: 'one-time'
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'LEVEL_NOT_ALLOWED');
    assert.equal(refused.levelDecision.reasonCode, 'LEVEL_NOT_ALLOWED');
    assert.equal(finalized, 1);
  });
}

// ---- Registration route (registerPublicParticipant) ----------------------------------------

async function registrationCases(): Promise<void> {
  const rating = ratings(() => null);
  let appended = 0;
  const row = tournament({ details: {} as never });
  const svc = service(row, rating, {}, {
    appendPublicParticipantIfCapacity: async () => { appended += 1; return { ...row, participants: [{ phone: PHONE, name: 'S' }] }; }
  }) as any;
  svc.fetchVivaJoinPurchaseOptions = async () => [];
  const register = (levelLabel?: string) => svc.registerPublicParticipant('level-cup', { phone: PHONE, name: 'S', levelLabel });
  await withMode('enforce', async () => {
    for (const [level, code] of [['3.80001', 'LEVEL_NOT_ALLOWED'], [undefined, 'PLAYER_LEVEL_REQUIRED']] as const) {
      const result = await register(level);
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
    }
    assert.equal(appended, 0, 'refused registrations write nothing');
    const corrupt = service(tournament({ accessLevels: ['3', '3.5'] }), rating) as any;
    const invalid = await corrupt.registerPublicParticipant('level-cup', { phone: PHONE, name: 'S', levelLabel: '3.2' });
    assert.equal(invalid.code, 'ACTIVITY_LEVEL_INVALID');
  });
  await withMode(undefined, async () => {
    // LEGACY keeps the audited behaviour (documents why ENFORCE is required for the fix).
    const legacy = await register('3.31');
    assert.equal(legacy.code, 'LEVEL_NOT_ALLOWED');
  });
}

// ---- Persistence: tolerance validation, 0 preserved, default, audit, participants untouched --

function fakeCollection(seed: Record<string, any>[]) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    findOne: async (filter: Record<string, any>) => {
      const id = filter.id ?? filter.$or?.[0]?.id;
      if (filter.sourceTournamentId !== undefined) return rows.find((row) => row.sourceTournamentId === filter.sourceTournamentId) ?? null;
      if (filter.slug !== undefined) return rows.find((row) => row.slug === filter.slug) ?? null;
      return rows.find((row) => row.id === id) ?? null;
    },
    find: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => [] }),
    insertOne: async (doc: Record<string, any>) => { rows.push({ ...doc }); return { acknowledged: true }; },
    updateOne: async (filter: Record<string, any>, update: { $set: Record<string, unknown> }) => {
      const row = rows.find((item) => item.id === (filter.id ?? filter.$or?.[0]?.id));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    }
  };
}

async function persistenceCases(): Promise<void> {
  const persistence = new TournamentsPersistenceService() as any;
  const participants = [{ id: 'p-1', name: 'Out of range', phone: '79000000001', levelLabel: '5.5', status: 'REGISTERED' }];
  const collection = fakeCollection([{ id: 'custom-level-1', source: 'CUSTOM', slug: 'level-cup', name: 'Level Cup',
    status: 'REGISTRATION', tournamentType: 'AMERICANO', accessLevels: C_SLIDER, gender: 'MIXED', maxPlayers: 16,
    participants, waitlist: [], allowedManagerPhones: [], changeLog: [], updatedAt: '2026-11-17T10:00:00.000Z' }]);
  persistence.collection = async () => collection;
  const actor = { id: 'admin-1', name: 'Organizer', login: 'organizer' };

  // Old tournament without the field: read back as absent (= 0 by the rule).
  const legacy = await persistence.findCustomTournamentById('custom-level-1');
  assert.equal(legacy.levelTolerance, undefined);

  const zero = await persistence.updateCustomTournament('custom-level-1', { levelTolerance: 0, actor });
  assert.equal(zero.levelTolerance, 0);
  assert.equal(collection.rows[0].levelTolerance, 0, '0 is stored as 0, not replaced by a default');
  assert.equal((await persistence.findCustomTournamentById('custom-level-1')).levelTolerance, 0);

  const changed = await persistence.updateCustomTournament('custom-level-1', { levelTolerance: 0.2, actor });
  assert.equal(changed.levelTolerance, 0.2);
  const entry = changed.changeLog[0];
  assert.equal(entry.actor.id, 'admin-1');
  assert.ok(entry.at);
  const field = (name: string) => entry.changes.find((change: any) => change.field === name);
  assert.deepEqual([field('levelTolerance').before, field('levelTolerance').after], ['±0,00', '±0,20']);
  assert.deepEqual([field('levelEffectiveRange').before, field('levelEffectiveRange').after], ['3,00–3,50', '2,80–3,70']);
  assert.deepEqual(collection.rows[0].participants, participants, 'changing the rule never removes participants');

  for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, '0.2']) {
    await assert.rejects(() => persistence.updateCustomTournament('custom-level-1', { levelTolerance: bad, actor }),
      (error: any) => error.getResponse().code === 'TOURNAMENT_LEVEL_TOLERANCE_INVALID');
  }
  assert.equal(collection.rows[0].levelTolerance, 0.2);

  // New tournament: default 0.2 when omitted; explicit 0 is kept.
  const created = await persistence.buildCreateDocument({ name: 'New', tournamentType: 'AMERICANO', accessLevels: C_SLIDER,
    gender: 'MIXED', maxPlayers: 8, participants: [], waitlist: [], allowedManagerPhones: [] });
  assert.equal(created.levelTolerance, 0.2);
  const strict = await persistence.buildCreateDocument({ name: 'Strict', tournamentType: 'AMERICANO', accessLevels: C_SLIDER,
    levelTolerance: 0, gender: 'MIXED', maxPlayers: 8, participants: [], waitlist: [], allowedManagerPhones: [] });
  assert.equal(strict.levelTolerance, 0);
}

async function dtoCases(): Promise<void> {
  const check = async (Dto: any, body: Record<string, unknown>) =>
    validate(plainToInstance(Dto, body), { whitelist: true, forbidNonWhitelisted: true });
  for (const Dto of [UpdateCustomTournamentDto, CreateCustomTournamentFromSourceDto]) {
    for (const ok of [0, 0.2, 1, 0.12345]) assert.equal((await check(Dto, { levelTolerance: ok })).length, 0, `accepts ${ok}`);
    for (const bad of [-0.01, 1.00001, 'abc', Number.NaN, Number.POSITIVE_INFINITY, 0.123456]) {
      assert.ok((await check(Dto, { levelTolerance: bad })).length > 0, `rejects ${String(bad)}`);
    }
    const wide = ['1', '1.25', '1.5', '1.75', '2', '2.25', '2.5', '2.75', '3', '3.125', '3.25', '3.375', '3.5',
      '3.625', '3.75', '3.875', '4', '4.175', '4.35', '4.525', '4.7'];
    assert.equal((await check(Dto, { accessLevels: wide })).length, 0, 'a 21-point slider range is storable');
  }
}

// ---- Organizer report over the roster (detects bookings that bypassed PadlHub) -------------

async function reportCases(): Promise<void> {
  const byPhone: Record<string, Rating> = { '79000000001': 3.31, '79000000002': 4.4, '79000000003': null, '79000000004': 2.85 };
  const participants = [
    { id: 'p1', name: 'In range', phone: '79000000001', status: 'REGISTERED', paymentStatus: 'PAID' },
    { id: 'p2', name: 'Direct Viva booking', phone: '79000000002', status: 'REGISTERED', paymentStatus: 'PAID' },
    { id: 'p3', name: 'No level', phone: '79000000003', status: 'REGISTERED' },
    { id: 'p4', name: 'Tolerance', phone: '79000000004', status: 'REGISTERED' }
  ];
  let current = '';
  const rating = ratings(() => byPhone[current]);
  const original = rating.service.resolveCanonicalLevelByIdentity;
  rating.service.resolveCanonicalLevelByIdentity = async (input: { phone: string }) => { current = input.phone; return original(input); };
  const row = tournament({ participants: participants as never, waitlist: [{ id: 'w1', name: 'Wait', phone: '79000000002' }] as never });
  const snapshot = JSON.stringify(row.participants);
  const vivaGuard = new Proxy({}, { get: () => () => { throw new Error('report must not call Viva'); } });
  const svc = service(row, rating, vivaGuard as never) as any;
  svc.hydrateCustomTournament = async (value: CustomTournament) => value;
  const admin = { id: 'admin-1', authSource: 'token', roles: [], permissions: ['tournaments:read'], stationIds: [], connectorRoutes: [] };
  await withMode(undefined, async () => {
    const report = await svc.getLevelAdmissionReport('custom-level-1', admin);
    assert.equal(report.rule.ruleKind, 'RANGE');
    assert.deepEqual(report.rule.effectiveRange, { min: 2.8, max: 3.7 });
    assert.equal(report.checked, 5);
    assert.equal(report.outsideRule, 3, 'out-of-range direct booking, missing level and waitlisted out-of-range');
    const reason = (id: string) => report.entries.find((entry: any) => entry.participantId === id).reasonCode;
    assert.equal(reason('p1'), 'LEVEL_ALLOWED');
    assert.equal(reason('p2'), 'LEVEL_NOT_ALLOWED');
    assert.equal(reason('p3'), 'PLAYER_LEVEL_REQUIRED');
    assert.equal(reason('p4'), 'LEVEL_ALLOWED_WITH_TOLERANCE');
    assert.ok(report.entries.every((entry: any) => !String(entry.phoneMasked).includes('79000000002')), 'phones are masked');
    assert.equal(JSON.stringify(row.participants), snapshot, 'the report never changes participation');
  });
  const unrestricted = service(tournament({ accessLevels: [] }), ratings(() => { throw new Error('no read'); })) as any;
  unrestricted.hydrateCustomTournament = async (value: CustomTournament) => value;
  const empty = await unrestricted.getLevelAdmissionReport('custom-level-1', admin);
  assert.equal(empty.checked, 0);
  // A staff user scoped to another station cannot read this roster.
  await assert.rejects(() => svc.getLevelAdmissionReport('custom-level-1', { ...admin, id: 'other', stationIds: ['other-station'],
    permissionStationScopes: { 'tournaments:read': ['other-station'] } }));
}

async function main(): Promise<void> {
  await dtoCases();
  await reportCases();
  await energyCases();
  await decisionCases();
  await purchaseCases();
  await registrationCases();
  await persistenceCases();
  console.log('tournament-level-admission route tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
