import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentClientSubscription, TournamentStatus } from '../src/tournaments/tournaments.types';

function createTournament(): CustomTournament {
  return {
    id: 'custom-public-join-1',
    source: 'CUSTOM',
    slug: 'weekend-cup',
    publicUrl: '/api/tournaments/public/weekend-cup',
    name: 'Padel Weekend Cup',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['D+', 'C'],
    gender: 'MIXED',
    maxPlayers: 16,
    participants: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    studioName: 'PadelHab Селигерская',
    trainerName: 'Игорь Махнов',
    startsAt: '2026-04-25T09:00:00.000Z',
    mechanics: {
      enabled: true,
      config: {
        mode: 'short_americano',
        rounds: null,
        courts: null,
        useRatings: true,
        firstRoundSeeding: 'auto',
        roundExactThreshold: 12,
        balanceOutlierThreshold: 1.1,
        balanceOutlierWeight: 120,
        strictPartnerUniqueness: 'high',
        strictBalance: 'medium',
        avoidRepeatOpponents: true,
        avoidRepeatPartners: true,
        distributeByesEvenly: true,
        historyDepth: 0,
        localSearchIterations: 6,
        pairingExactThreshold: 16,
        matchExactThreshold: 12,
        weights: {
          partnerRepeat: 1000,
          partnerImmediateRepeat: 1200,
          opponentRepeat: 150,
          opponentRecentRepeat: 250,
          balance: 100,
          unevenBye: 300,
          consecutiveBye: 700,
          pairInternalImbalance: 30
        }
      }
    },
    changeLog: [],
    skin: {
      title: 'Padel Weekend Cup',
      subtitle: 'от PadlxAB'
    },
    details: {
      booking: {
        paymentRequired: true,
        acceptedSubscriptions: [
          {
            id: 'tournament-pass',
            label: 'Турнирный абонемент',
            compatibleTournamentTypes: ['Американо'],
            compatibleAccessLevels: ['D+', 'C']
          }
        ],
        purchaseOptions: [
          {
            id: 'single-entry',
            label: 'Разовое участие',
            priceLabel: '2 500 ₽',
            productType: 'SUBSCRIPTION'
          }
        ],
        vivaWidgetId: 'iSkq6G',
        vivaExerciseId: 'ee4aef31-7fc9-4dbc-976c-86ecbde5a11c',
        vivaStudioId: '588b6151-f4f5-47d9-9449-80edf8cbc748'
      }
    }
  };
}

function createService(tournament: CustomTournament): TournamentsService {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [] } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async (id: string) =>
        id === tournament.id ? tournament : null,
      findCustomTournamentBySlug: async (slug: string) =>
        slug === tournament.slug ? tournament : null,
      findCustomTournamentBySourceTournamentId: async (sourceTournamentId: string) =>
        sourceTournamentId === tournament.sourceTournamentId ? tournament : null,
      updateCustomTournament: async (_id: string, mutation: { participants?: unknown; waitlist?: unknown }) => {
        if (Array.isArray(mutation.participants)) {
          tournament.participants = mutation.participants as typeof tournament.participants;
          tournament.participantsCount = tournament.participants.length;
          tournament.paidParticipantsCount = tournament.participants.filter(
            (item) => item.paymentStatus === 'PAID'
          ).length;
        }
        if (Array.isArray(mutation.waitlist)) {
          tournament.waitlist = mutation.waitlist as typeof tournament.waitlist;
          tournament.waitlistCount = tournament.waitlist.length;
        }
        return tournament;
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
}

function buildSubscriptions(): TournamentClientSubscription[] {
  return [
    {
      id: 'tournament-pass',
      label: 'Турнирный абонемент',
      remainingUses: 2,
      compatibleTournamentTypes: ['Американо'],
      compatibleAccessLevels: ['D+', 'C']
    }
  ];
}

async function main(): Promise<void> {
  const tournament = createTournament();
  const service = createService(tournament);
  const originalFetch = globalThis.fetch;
  const defaultVivaFetch = (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.includes('/bookings/payment-types')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ paymentTypes: ['ON_PLACE'], subscriptions: [] })
      } as Response;
    }
    if (value.includes('/products/subscriptions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'catalog-subscription',
              name: 'Турнирный абонемент Viva',
              priceLabel: '3 990 ₽'
            }
          ]
        })
      } as Response;
    }
    if (value.includes('/products/one-times')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'catalog-one-time',
              name: 'Разовое участие Viva',
              priceLabel: '2 500 ₽'
            }
          ]
        })
      } as Response;
    }
    throw new Error(`Unexpected fetch in test: ${value}`);
  }) as typeof fetch;
  globalThis.fetch = defaultVivaFetch;

  const unauthorizedFlow = await service.getPublicJoinFlow(
    tournament.slug,
    {
      id: 'guest-1',
      authorized: false,
      authSource: 'cookie',
      onboardingCompleted: false,
      subscriptions: []
    },
    { requireAuth: true }
  );
  assert.equal(unauthorizedFlow.code, 'PROFILE_REQUIRED');

  const unverifiedPhoneFlow = await service.getPublicJoinFlow(
    tournament.slug,
    {
      id: 'guest-2',
      authorized: false,
      authSource: 'cookie',
      phone: '+7 999 000-11-20',
      onboardingCompleted: false,
      subscriptions: []
    },
    { requireAuth: true }
  );
  assert.equal(unverifiedPhoneFlow.code, 'PHONE_VERIFICATION_REQUIRED');

  const disallowedLevelFlow = await service.getPublicJoinFlow(tournament.slug, {
    id: 'user-1',
    authorized: true,
    authSource: 'headers',
    name: 'Игрок',
    phone: '+7 999 000-11-22',
    levelLabel: 'B',
    onboardingCompleted: true,
    subscriptions: buildSubscriptions()
  });
  assert.equal(disallowedLevelFlow.code, 'LEVEL_NOT_ALLOWED');
  assert.equal(disallowedLevelFlow.waitlistAllowed, true);
  assert.match(disallowedLevelFlow.message, /D\+ - C/);

  const subscriptionFlow = await service.getPublicJoinFlow(tournament.slug, {
    id: 'user-2',
    authorized: true,
    authSource: 'headers',
    name: 'Игрок',
    phone: '+7 999 000-11-23',
    levelLabel: 'C',
    onboardingCompleted: true,
    subscriptions: buildSubscriptions()
  });
  assert.equal(subscriptionFlow.code, 'SUBSCRIPTION_AVAILABLE');
  assert.equal(subscriptionFlow.payment.code, 'SUBSCRIPTION_AVAILABLE');

  const purchaseFlow = await service.getPublicJoinFlow(tournament.slug, {
    id: 'user-3',
    authorized: true,
    authSource: 'headers',
    name: 'Игрок',
    phone: '+7 999 000-11-24',
    levelLabel: 'C',
    onboardingCompleted: true,
    subscriptions: []
  });
  assert.equal(purchaseFlow.code, 'PURCHASE_REQUIRED');
  assert.equal(purchaseFlow.payment.purchaseOptions.length, 2);

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.includes('/products/subscriptions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] })
      } as Response;
    }
    if (value.includes('/products/one-times')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] })
      } as Response;
    }
    assert.match(value, /\/bookings\/payment-types\?phone=79990001129$/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        paymentTypes: ['ON_PLACE'],
        subscriptions: [
          {
            id: 'viva-pass',
            name: 'Турнирный абонемент',
            visitsLeft: 1,
            expirationDate: '2026-05-02'
          }
        ]
      })
    } as Response;
  }) as typeof fetch;
  const vivaSubscriptionFlow = await service.getPublicJoinFlow(tournament.slug, {
    id: 'user-4',
    authorized: true,
    authSource: 'headers',
    name: 'Игрок',
    phone: '+7 999 000-11-29',
    levelLabel: 'C',
    onboardingCompleted: true,
    subscriptions: []
  });
  globalThis.fetch = defaultVivaFetch;
  assert.equal(vivaSubscriptionFlow.code, 'SUBSCRIPTION_AVAILABLE');
  assert.equal(vivaSubscriptionFlow.payment.selectedSubscription?.id, 'viva-pass');

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.includes('/products/subscriptions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] })
      } as Response;
    }
    if (value.includes('/products/one-times')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] })
      } as Response;
    }
    if (value.includes('/bookings/payment-types')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ paymentTypes: ['ON_PLACE'], subscriptions: [] })
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'write-off-1' })
    } as Response;
  }) as typeof fetch;
  const subscriptionRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игорь Махнов',
    phone: '+7 999 000-11-25',
    levelLabel: 'C',
    selectedSubscriptionId: 'tournament-pass',
    subscriptions: buildSubscriptions()
  });
  globalThis.fetch = defaultVivaFetch;
  assert.equal(subscriptionRegistration.code, 'REGISTERED');
  assert.equal(subscriptionRegistration.participant?.paymentStatus, 'PAID');
  assert.match(subscriptionRegistration.participant?.notes ?? '', /Абонемент списан/);

  const lkWidgetRegistration = await service.registerPublicParticipantByTournamentRef(tournament.id, {
    name: 'LK Игрок',
    phone: '+7 999 000-11-28',
    levelLabel: 'C',
    purchaseConfirmed: true,
    selectedPurchaseOptionId: 'single-entry',
    subscriptions: []
  });
  assert.equal(lkWidgetRegistration.code, 'REGISTERED');

  const lkWidgetTournamentDetail = await service.findById(tournament.id);
  assert.equal(lkWidgetTournamentDetail.format, 'Американо');
  assert.equal(lkWidgetTournamentDetail.participants?.at(-1)?.level, 'C');
  assert.equal(lkWidgetTournamentDetail.participants?.at(-1)?.ratingLabel, 'C');

  const lkWidgetRegistrationStatus = await service.getPublicRegistrationByTournamentRef(
    tournament.id,
    '+7 999 000-11-28'
  );
  assert.equal(lkWidgetRegistrationStatus.status, 'REGISTERED');

  const lkWidgetCancelStatus = await service.cancelPublicRegistrationByTournamentRef(
    tournament.id,
    '+7 999 000-11-28'
  );
  assert.equal(lkWidgetCancelStatus.status, 'NONE');

  const blockedPurchaseRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игрок без оплаты',
    phone: '+7 999 000-11-26',
    levelLabel: 'C',
    subscriptions: []
  });
  assert.equal(blockedPurchaseRegistration.code, 'PURCHASE_REQUIRED');

  let transactionRequest:
    | { url: string; headers: Record<string, string>; body: Record<string, unknown> }
    | undefined;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const value = String(url);
    if (value.includes('/products/subscriptions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] })
      } as Response;
    }
    if (value.includes('/products/one-times')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 'single-entry', name: 'Разовое участие', priceLabel: '2 500 ₽' }] })
      } as Response;
    }
    if (value.includes('/bookings/payment-types')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ paymentTypes: ['ON_PLACE'], subscriptions: [] })
      } as Response;
    }
    transactionRequest = {
      url: value,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'tx-1',
          payment: {
            formUrl: 'https://pay.tbank.ru/Yk04YJoQ'
          }
        }
      })
    } as Response;
  }) as typeof fetch;

  try {
    const purchaseStart = await service.createPublicJoinPurchaseTransaction(tournament.slug, {
      name: 'Игрок с покупкой Viva',
      phone: '+7 999 000-11-28',
      levelLabel: 'C',
      selectedPurchaseOptionId: 'single-entry',
      subscriptions: [],
      successUrl: 'https://padlhub.ru/padel_torneos?paymentsuccess=true',
      failUrl: 'https://padlhub.ru/padel_torneos?paymentfailed=true'
    });
    assert.equal(purchaseStart.code, 'PURCHASE_STARTED');
    assert.equal(purchaseStart.payment?.checkoutUrl, 'https://pay.tbank.ru/Yk04YJoQ');
    assert.equal(
      transactionRequest?.url,
      'https://api.vivacrm.ru/end-user/api/v1/iSkq6G/transactions'
    );
    assert.equal(transactionRequest?.body.clientPhone, '79990001128');
    assert.equal(transactionRequest?.headers.Authorization, undefined);
    const products = transactionRequest?.body.products as Array<Record<string, unknown>>;
    assert.equal(products[0]?.id, 'single-entry');
    assert.equal(products[0]?.name, 'Разовое участие');
    assert.equal(products[0]?.type, 'SERVICE');
    const bookingRequests = products[0]?.bookingRequests as Array<Record<string, unknown>>;
    assert.equal(bookingRequests[0]?.exerciseId, 'ee4aef31-7fc9-4dbc-976c-86ecbde5a11c');
    assert.equal(bookingRequests[0]?.paymentType, undefined);
    assert.equal(
      transactionRequest?.body.successUrl,
      'https://padlhub.ru/padel_torneos?TorneosPADL_exercise=ee4aef31-7fc9-4dbc-976c-86ecbde5a11c&TorneosPADL_paymentsuccess=true'
    );
    assert.equal(
      transactionRequest?.body.failUrl,
      'https://padlhub.ru/padel_torneos?TorneosPADL_exercise=ee4aef31-7fc9-4dbc-976c-86ecbde5a11c&TorneosPADL_paymentfailed=true'
    );
    assert.equal(transactionRequest?.body.studioId, '588b6151-f4f5-47d9-9449-80edf8cbc748');
  } finally {
    globalThis.fetch = defaultVivaFetch;
  }

  const paidRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игрок с покупкой',
    phone: '+7 999 000-11-27',
    levelLabel: 'C',
    purchaseConfirmed: true,
    selectedPurchaseOptionId: 'catalog-subscription',
    subscriptions: []
  });
  assert.equal(paidRegistration.code, 'REGISTERED');
  assert.equal(paidRegistration.participant?.paymentStatus, 'PAID');
  assert.match(paidRegistration.participant?.notes ?? '', /catalog-subscription/);

  globalThis.fetch = originalFetch;

  console.log('Tournament public join flow test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
