import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function tournamentFixture(): CustomTournament {
  return {
    id: 'tournament-payment-binding',
    source: 'CUSTOM',
    slug: 'payment-binding',
    publicUrl: '/api/tournaments/public/payment-binding',
    name: 'Payment Binding Cup',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['C'],
    gender: 'MIXED',
    maxPlayers: 8,
    participants: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    changeLog: [],
    skin: {},
    mechanics: { enabled: false, config: {} as never },
    details: {
      booking: {
        paymentRequired: true,
        acceptedSubscriptions: [],
        purchaseOptions: [],
        vivaWidgetId: 'test-widget',
        vivaExerciseId: 'exercise-payment-binding',
        vivaStudioId: 'studio-payment-binding'
      }
    }
  };
}

function serviceFixture(tournament: CustomTournament) {
  let failFinalize = false;
  const persistence = {
    isEnabled: () => true,
    findCustomTournamentById: async (id: string) => id === tournament.id ? tournament : null,
    findCustomTournamentBySlug: async (slug: string) => slug === tournament.slug ? tournament : null,
    findCustomTournamentBySourceTournamentId: async () => null,
    reservePublicJoinPayment: async (_id: string, pending: Record<string, unknown>) => {
      const details = tournament.details ?? {};
      const booking = (details.booking ?? {}) as Record<string, unknown>;
      const current = Array.isArray(booking.pendingJoinPayments)
        ? booking.pendingJoinPayments
        : [];
      if (current.some((item) => {
        const record = item as Record<string, unknown>;
        return record.phone === pending.phone
          && (record.state === undefined
            || record.state === 'PENDING_PAYMENT'
            || record.state === 'PAID_PENDING_FINALIZATION');
      })) {
        return null;
      }
      booking.pendingJoinPayments = [...current, pending];
      tournament.details = { ...details, booking };
      return tournament;
    },
    markPublicJoinPaymentPaid: async (
      _id: string,
      transactionId: string,
      phone: string,
      verifiedPayment: Record<string, unknown>
    ) => {
      const details = tournament.details ?? {};
      const booking = (details.booking ?? {}) as Record<string, unknown>;
      const current = Array.isArray(booking.pendingJoinPayments)
        ? booking.pendingJoinPayments as Array<Record<string, unknown>>
        : [];
      const index = current.findIndex((item) => (
        item.transactionId === transactionId && item.phone === phone
      ));
      if (index < 0) return null;
      current[index] = {
        ...current[index],
        state: 'PAID_PENDING_FINALIZATION',
        verifiedPayment
      };
      booking.pendingJoinPayments = current;
      tournament.details = { ...details, booking };
      return tournament;
    },
    expirePublicJoinPayment: async (
      _id: string,
      transactionId: string,
      phone: string,
      expiredAt: string
    ) => {
      const details = tournament.details ?? {};
      const booking = (details.booking ?? {}) as Record<string, unknown>;
      const current = Array.isArray(booking.pendingJoinPayments)
        ? booking.pendingJoinPayments as Array<Record<string, unknown>>
        : [];
      const index = current.findIndex((item) => (
        item.transactionId === transactionId && item.phone === phone
      ));
      if (index < 0) return null;
      current[index] = { ...current[index], state: 'EXPIRED', expiredAt };
      booking.pendingJoinPayments = current;
      tournament.details = { ...details, booking };
      return tournament;
    },
    finalizePublicJoinPayment: async (
      _id: string,
      transactionId: string,
      phone: string,
      participant: Record<string, unknown>
    ) => {
      if (failFinalize) {
        return null;
      }
      const details = tournament.details ?? {};
      const booking = (details.booking ?? {}) as Record<string, unknown>;
      const current = Array.isArray(booking.pendingJoinPayments)
        ? booking.pendingJoinPayments
        : [];
      const matching = current.some((item) => {
        const record = item as Record<string, unknown>;
        return record.transactionId === transactionId && record.phone === phone;
      });
      if (!matching) {
        return null;
      }
      tournament.participants = [...tournament.participants, participant as never];
      tournament.participantsCount = tournament.participants.length;
      tournament.paidParticipantsCount = tournament.participants.filter(
        (item) => item.paymentStatus === 'PAID'
      ).length;
      booking.pendingJoinPayments = current.filter((item) => {
        const record = item as Record<string, unknown>;
        return record.transactionId !== transactionId || record.phone !== phone;
      });
      tournament.details = { ...details, booking };
      return tournament;
    },
    updateCustomTournament: async () => tournament
  };
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [] } as never,
    { getTournamentResults: async () => { throw new Error('Not used'); } } as never,
    persistence as never,
    { generateSchedule: () => { throw new Error('Not used'); } } as never,
    { simulateRating: () => { throw new Error('Not used'); } } as never
  );
  return {
    service,
    setFailFinalize(value: boolean) {
      failFinalize = value;
    }
  };
}

function pendingPayments(tournament: CustomTournament): Array<Record<string, unknown>> {
  const booking = (tournament.details?.booking ?? {}) as Record<string, unknown>;
  return Array.isArray(booking.pendingJoinPayments)
    ? booking.pendingJoinPayments as Array<Record<string, unknown>>
    : [];
}

async function main(): Promise<void> {
  const tournament = tournamentFixture();
  const fixture = serviceFixture(tournament);
  const originalFetch = globalThis.fetch;
  let transactionCounter = 0;
  let transactionResponseMode: 'EXACT' | 'GENERIC_ID' = 'EXACT';
  let statusPayload: Record<string, unknown> = {};
  let statusAuthorization = '';
  let statusLookupCount = 0;
  let failStatusLookup = false;

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const value = String(url);
    if (value.includes('/bookings/payment-types')) {
      return { ok: true, status: 200, json: async () => ({ paymentTypes: ['ON_PLACE'], subscriptions: [] }) } as Response;
    }
    if (value.includes('/products/subscriptions')) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    }
    if (value.includes('/products/one-times')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 'secure-product', name: 'Участие', priceLabel: '2 500 ₽' }] })
      } as Response;
    }
    if (value.endsWith('/transactions')) {
      transactionCounter += 1;
      const transactionIdentity = transactionResponseMode === 'EXACT'
        ? { transactionId: `secure-transaction-${transactionCounter}` }
        : { id: `generic-id-${transactionCounter}` };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          ...transactionIdentity,
          paymentUrl: `https://pay.example/${transactionCounter}`,
          toPay: 250000,
          paymentDueDate: new Date(Date.now() + 20 * 60_000).toISOString()
        })
      } as Response;
    }
    if (value.includes('/transactions/') && value.endsWith('/status')) {
      statusLookupCount += 1;
      if (failStatusLookup) {
        throw new Error('simulated provider outage after durable paid evidence');
      }
      const headers = new Headers(init?.headers);
      statusAuthorization = headers.get('authorization') ?? '';
      return { ok: true, status: 200, json: async () => statusPayload } as Response;
    }
    throw new Error(`Unexpected fetch ${value}`);
  }) as typeof fetch;

  try {
    const started = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок оплаты',
      phone: '+7 999 000-22-01',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer player-token'
    });
    assert.equal(started.code, 'PURCHASE_STARTED');
    const pending = pendingPayments(tournament)[0];
    assert.equal(pending?.transactionId, 'secure-transaction-1');
    assert.equal(pending?.phone, '79990002201');
    assert.equal(pending?.exerciseId, 'exercise-payment-binding');
    assert.equal(pending?.studioId, 'studio-payment-binding');
    assert.equal(pending?.widgetId, 'test-widget');
    assert.equal(pending?.selectedPurchaseOptionId, 'secure-product');
    assert.equal(pending?.amountMinor, 250000);
    assert.equal(pending?.currency, 'RUB');
    assert.equal((pending?.eligibilitySnapshot as Record<string, unknown>)?.activityId, tournament.id);

    const reused = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок оплаты',
      phone: '+7 999 000-22-01',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer player-token'
    });
    assert.equal(reused.code, 'PURCHASE_STARTED');
    assert.equal(reused.payment?.transactionId, 'secure-transaction-1');
    assert.equal(transactionCounter, 1);

    statusPayload = {
      transactionId: 'secure-transaction-1',
      transactionStatus: 'UNPAID',
      unrelated: { status: 'PAID', success: true }
    };
    const substringAttempt = await fixture.service.confirmPublicJoinAfterPayment(tournament.slug, {
      phone: '+7 999 000-22-01',
      vivaAuthorizationHeader: 'Bearer player-token'
    });
    assert.equal(substringAttempt.code, 'PURCHASE_REQUIRED');
    assert.equal(pendingPayments(tournament).length, 1);

    statusPayload = { transactionId: 'different-transaction', transactionStatus: 'PAID' };
    const wrongTransaction = await fixture.service.confirmPublicJoinAfterPayment(tournament.slug, {
      phone: '+7 999 000-22-01',
      vivaAuthorizationHeader: 'Bearer player-token'
    });
    assert.equal(wrongTransaction.code, 'PURCHASE_REQUIRED');
    assert.equal(pendingPayments(tournament).length, 1);

    tournament.accessLevels = ['A'];
    statusPayload = { transactionId: 'secure-transaction-1', transactionStatus: 'PAID' };
    const finalized = await fixture.service.confirmPublicJoinAfterPayment(tournament.slug, {
      phone: '+7 999 000-22-01',
      vivaAuthorizationHeader: 'Bearer player-token'
    });
    assert.equal(finalized.code, 'REGISTERED');
    assert.equal(finalized.participant?.paymentStatus, 'PAID');
    assert.equal(pendingPayments(tournament).length, 0);
    assert.equal(statusAuthorization, 'Bearer player-token');

    tournament.accessLevels = ['C'];
    const secondStarted = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок recovery',
      phone: '+7 999 000-22-02',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer recovery-token'
    });
    assert.equal(secondStarted.code, 'PURCHASE_STARTED');
    statusPayload = { transactionId: 'secure-transaction-2', transactionStatus: 'PAID' };
    fixture.setFailFinalize(true);
    const interrupted = await fixture.service.confirmPublicJoinAfterPayment(tournament.slug, {
      phone: '+7 999 000-22-02',
      vivaAuthorizationHeader: 'Bearer recovery-token'
    });
    assert.equal(interrupted.code, 'BOOKING_FAILED');
    assert.equal(pendingPayments(tournament).length, 1);
    assert.equal(pendingPayments(tournament)[0]?.state, 'PAID_PENDING_FINALIZATION');
    assert.equal(
      (pendingPayments(tournament)[0]?.verifiedPayment as Record<string, unknown>)?.status,
      'PAID'
    );

    fixture.setFailFinalize(false);
    const statusLookupsBeforeRecovery = statusLookupCount;
    failStatusLookup = true;
    const recovered = await fixture.service.confirmPublicJoinAfterPayment(tournament.slug, {
      phone: '+7 999 000-22-02',
      vivaAuthorizationHeader: 'Bearer recovery-token'
    });
    assert.equal(recovered.code, 'REGISTERED');
    assert.equal(pendingPayments(tournament).length, 0);
    assert.equal(statusLookupCount, statusLookupsBeforeRecovery);
    failStatusLookup = false;

    const expiringStarted = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок expired recovery',
      phone: '+7 999 000-22-05',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer expired-token'
    });
    assert.equal(expiringStarted.code, 'PURCHASE_STARTED');
    const expiringPending = pendingPayments(tournament).find(
      (item) => item.phone === '79990002205'
    );
    assert.equal(expiringPending?.transactionId, 'secure-transaction-3');
    if (expiringPending) {
      expiringPending.paymentExpiresAt = new Date(Date.now() - 60_000).toISOString();
    }
    statusPayload = { transactionId: 'secure-transaction-3', transactionStatus: 'UNPAID' };
    const expiredRelease = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок expired recovery',
      phone: '+7 999 000-22-05',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer expired-token'
    });
    assert.equal(expiredRelease.code, 'PURCHASE_REQUIRED');
    assert.equal(
      pendingPayments(tournament).find((item) => item.transactionId === 'secure-transaction-3')?.state,
      'EXPIRED'
    );

    const restartedAfterExpiry = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок expired recovery',
      phone: '+7 999 000-22-05',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer expired-token'
    });
    assert.equal(restartedAfterExpiry.code, 'PURCHASE_STARTED');
    assert.equal(restartedAfterExpiry.payment?.transactionId, 'secure-transaction-4');

    transactionResponseMode = 'GENERIC_ID';
    const genericIdResponse = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок с неточным ответом',
      phone: '+7 999 000-22-03',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer generic-token'
    });
    assert.equal(genericIdResponse.code, 'PURCHASE_REQUIRED');
    assert.equal(
      pendingPayments(tournament).some((item) => item.phone === '79990002203'),
      false
    );

    const booking = (tournament.details?.booking ?? {}) as Record<string, unknown>;
    booking.pendingJoinPayments = [{
      transactionId: 'legacy-unbound-transaction',
      state: 'PENDING_PAYMENT',
      phone: '79990002204',
      checkoutUrl: 'https://pay.example/legacy',
      createdAt: new Date().toISOString()
    }];
    const transactionCountBeforeUnsafeRetry = transactionCounter;
    const unsafeLegacyRetry = await fixture.service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок legacy pending',
      phone: '+7 999 000-22-04',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'secure-product',
      successUrl: 'https://padlhub.ru/success',
      failUrl: 'https://padlhub.ru/fail',
      vivaAuthorizationHeader: 'Bearer legacy-token'
    });
    assert.equal(unsafeLegacyRetry.code, 'BOOKING_FAILED');
    assert.equal(transactionCounter, transactionCountBeforeUnsafeRetry);

    const publicControllerSource = readFileSync(
      'src/tournaments/tournaments-public.controller.ts',
      'utf8'
    );
    const showcaseSource = readFileSync(
      'client-sdk/phab-tournaments-showcase.js',
      'utf8'
    );
    assert.doesNotMatch(publicControllerSource, /directTransactionId|directCheckoutUrl|directViva/);
    assert.doesNotMatch(showcaseSource, /directTransactionId|directCheckoutUrl|directViva|createVivaTransaction/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Tournament public payment binding test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
