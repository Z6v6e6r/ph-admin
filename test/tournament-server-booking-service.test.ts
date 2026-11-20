import * as assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { TournamentServerBookingService } from '../src/tournaments/tournament-server-booking.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

/** Real TournamentsService + Nest service with synthetic collaborators; no Viva or Mongo is reached. */

const C_SLIDER = ['3', '3.125', '3.25', '3.375', '3.5'];
const PHONE = '79123456789';

function tournament(serverBooking: unknown): CustomTournament {
  return {
    id: 'custom-level-1', source: 'CUSTOM', slug: 'level-cup', publicUrl: '/api/tournaments/public/level-cup',
    name: 'Level Cup', status: TournamentStatus.REGISTRATION, sourceTournamentId: 'exercise-level-1',
    tournamentType: 'Американо', accessLevels: C_SLIDER, levelTolerance: 0.2, gender: 'MIXED',
    updatedAt: '2026-11-17T10:00:00.000Z', maxPlayers: 16, participants: [], participantsCount: 0,
    paidParticipantsCount: 0, waitlist: [], waitlistCount: 0, allowedManagerPhones: [], studioId: 'studio-1',
    studioName: 'Synthetic', startsAt: '2026-12-09T07:00:00+03:00', endsAt: '2026-12-09T08:00:00+03:00',
    mechanics: { enabled: false } as never, changeLog: [], skin: { title: 'Турнир', priceLabel: '2 500 ₽' },
    details: { booking: { paymentRequired: true, vivaExerciseId: 'exercise-level-1', vivaStudioId: 'studio-1', serverBooking } }
  } as CustomTournament;
}

function memoryCollection() {
  const rows = new Map<string, any>();
  return {
    rows,
    findOne: async (filter: any) => rows.get(filter._id) ?? null,
    insertOne: async (doc: any) => {
      if (rows.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
      rows.set(doc._id, structuredClone(doc));
    },
    replaceOne: async (filter: any, doc: any) => {
      const row = rows.get(filter._id);
      if (!row || row.revision !== filter.revision) return { matchedCount: 0 };
      rows.set(doc._id, structuredClone(doc));
      return { matchedCount: 1 };
    }
  };
}

function build(row: CustomTournament, rating: number | null) {
  const viva = { listed: 0, checkouts: 0, bookings: [] as unknown[] };
  const vivaAdmin = {
    createExerciseBooking: async (input: unknown) => { viva.bookings.push(input); return { outcome: 'CREATED', bookingId: 'booking-1' }; },
    listExerciseBookings: async () => { viva.listed += 1; return []; },
    createBookingPaymentCheckout: async (input: any) => {
      viva.checkouts += 1;
      return { clientId: 'client-1', productId: 'p', bookingIds: input.bookingIds, transactionId: 'tx-1',
        paymentUrl: 'https://pay.example/tx-1', toPayMinor: input.amountMinor, paid: false };
    }
  };
  const tournaments = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    {} as never,
    {
      isEnabled: () => true,
      readPublicAdmissionRule: async () => ({ gender: row.gender, updatedAt: row.updatedAt }),
      listCustomTournaments: async () => [row],
      findCustomTournamentById: async (id: string) => (id === row.id ? row : null),
      findCustomTournamentBySlug: async (slug: string) => (slug === row.slug ? row : null),
      findCustomTournamentBySourceTournamentId: async (id: string) => (id === row.sourceTournamentId ? row : null)
    } as never,
    {} as never,
    {} as never,
    vivaAdmin as never,
    undefined,
    undefined,
    { verifyTrustedBearer: async (header?: string) => {
      if (header !== 'Bearer synthetic') throw new Error('unauthenticated');
      return { actor: { clientId: 'client-1', phoneNorm: PHONE, name: 'Synthetic' } };
    } } as never,
    { resolveCanonicalLevelByIdentity: async () => (rating === null ? null
      : { playerKey: 'p', clientId: 'client-1', levelLabel: String(rating), ratingNumeric: rating }) } as never
  );
  const collection = memoryCollection();
  const service = new TournamentServerBookingService(
    tournaments,
    { serverBookingAttemptsCollection: async () => collection } as never,
    vivaAdmin as never
  );
  return { service, tournaments, collection, viva };
}

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  try { return await run(); } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
}

async function status(promise: Promise<unknown>, expected: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), expected);
    assert.equal((error.getResponse() as any).code, code);
    return true;
  });
}

async function main() {
  const price = { baseAmountMinor: 250000, discountReason: 'Турнир' };
  // Default (unset): disabled, nothing stored.
  {
    const h = build(tournament(price), 3.31);
    await withEnv({ TOURNAMENT_SERVER_BOOKING_MODE: undefined, TOURNAMENT_LEVEL_ADMISSION_MODE: 'enforce' }, async () => {
      await status(h.service.join('custom-level-1', 'Bearer synthetic', 'fixture-key-0001'), 503, 'SERVER_BOOKING_DISABLED');
    });
    assert.equal(h.collection.rows.size, 0);
  }
  await withEnv({ TOURNAMENT_SERVER_BOOKING_MODE: 'enabled', TOURNAMENT_OWNER_RECOVERY_ONLY: 'true' }, async () => {
    const h = build(tournament(price), 3.31);
    const join = (key = 'fixture-key-0001') => h.service.join('level-cup', 'Bearer synthetic', key);
    await status(join(), 503, 'TOURNAMENT_NEW_OPERATIONS_PAUSED');
    assert.equal(h.collection.rows.size, 0);
    assert.equal(h.viva.bookings.length, 0);

    // Resume an existing operation with its original generation and receipt.
    const started = await withEnv({ TOURNAMENT_OWNER_RECOVERY_ONLY: undefined }, () => join());
    const before = structuredClone([...h.collection.rows.values()][0]);
    assert.equal(started.state, 'PAYMENT_PENDING');
    assert.deepEqual(await join(), started);
    assert.deepEqual(await h.service.status('level-cup', 'Bearer synthetic'), started);
    assert.deepEqual([...h.collection.rows.values()], [before]);

    // A terminal predecessor gives no permission to create a new generation.
    const terminal = { ...before, state: 'FAILED' as const };
    h.collection.rows.set(terminal._id, terminal);
    await status(join('fixture-key-0002'), 503, 'TOURNAMENT_NEW_OPERATIONS_PAUSED');
    assert.deepEqual([...h.collection.rows.values()], [terminal]);
    assert.equal(h.viva.bookings.length, 1);
  });
  await withEnv({ TOURNAMENT_SERVER_BOOKING_MODE: 'enabled', TOURNAMENT_LEVEL_ADMISSION_MODE: 'enforce' }, async () => {
    // Out of range: refusal with the decision, no attempt.
    const refused = build(tournament(price), 3.8);
    await assert.rejects(refused.service.join('level-cup', 'Bearer synthetic', 'fixture-key-0001'), (error: unknown) => {
      assert.ok(error instanceof HttpException && error.getStatus() === 403);
      const body = error.getResponse() as any;
      assert.equal(body.code, 'LEVEL_NOT_ALLOWED');
      assert.deepEqual(body.levelDecision.effectiveRange, { min: 2.8, max: 3.7 });
      return true;
    });
    assert.equal(refused.collection.rows.size, 0);
    // Forged bearer never reaches the store.
    const forged = build(tournament(price), 3.31);
    await assert.rejects(forged.service.join('level-cup', 'Bearer forged', 'fixture-key-0001'));
    assert.equal(forged.collection.rows.size, 0);
    // No configured price: fail closed.
    const unpriced = build(tournament(undefined), 3.31);
    await status(unpriced.service.join('level-cup', 'Bearer synthetic', 'fixture-key-0001'), 409, 'SERVER_BOOKING_PRICE_NOT_CONFIGURED');
    // Allowed: one admin booking with the verified actor, then one checkout with the server price.
    const allowed = build(tournament(price), 3.31);
    const view = await allowed.service.join('level-cup', 'Bearer synthetic', 'fixture-key-0001');
    assert.equal(view.state, 'PAYMENT_PENDING');
    assert.equal(view.paymentUrl, 'https://pay.example/tx-1');
    assert.equal(view.toPayMinor, 250000);
    assert.equal(view.levelDecision.reasonCode, 'LEVEL_ALLOWED');
    assert.deepEqual(allowed.viva.bookings, [{ exerciseId: 'exercise-level-1', clientId: 'client-1', phone: PHONE }]);
    assert.equal(allowed.viva.checkouts, 1);
    await allowed.service.join('level-cup', 'Bearer synthetic', 'fixture-key-0001');
    assert.equal(allowed.viva.bookings.length, 1, 'retry never books twice');
    const stored = allowed.collection.rows.get('custom-level-1:client-1');
    assert.equal(stored.price.baseAmountMinor, 250000);
    assert.equal(stored.startDecision.ruleVersion, view.levelDecision.ruleVersion);
    assert.equal(JSON.stringify(stored).includes(PHONE), false, 'attempt does not store the phone');
    const current = await allowed.service.status('level-cup', 'Bearer synthetic');
    assert.equal(current.state, 'PAYMENT_PENDING');
  });
  // An absent rollout variable still enforces the owner gate.
  await withEnv({ TOURNAMENT_SERVER_BOOKING_MODE: 'enabled', TOURNAMENT_LEVEL_ADMISSION_MODE: undefined }, async () => {
    const h = build(tournament(price), 3.31);
    assert.equal((await h.service.join('level-cup', 'Bearer synthetic', 'fixture-key-0001')).state, 'PAYMENT_PENDING');
  });
  console.log('tournament-server-booking service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
