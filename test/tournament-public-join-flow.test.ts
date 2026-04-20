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
            priceLabel: '2 500 ₽'
          }
        ]
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
      findCustomTournamentBySlug: async (slug: string) =>
        slug === tournament.slug ? tournament : null,
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
  assert.equal(unauthorizedFlow.code, 'AUTH_REQUIRED');

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
  assert.equal(purchaseFlow.payment.purchaseOptions.length, 1);

  const subscriptionRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игорь Махнов',
    phone: '+7 999 000-11-25',
    levelLabel: 'C',
    selectedSubscriptionId: 'tournament-pass',
    subscriptions: buildSubscriptions()
  });
  assert.equal(subscriptionRegistration.code, 'REGISTERED');
  assert.equal(subscriptionRegistration.participant?.paymentStatus, 'PAID');
  assert.match(subscriptionRegistration.participant?.notes ?? '', /Абонемент списан/);

  const blockedPurchaseRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игрок без оплаты',
    phone: '+7 999 000-11-26',
    levelLabel: 'C',
    subscriptions: []
  });
  assert.equal(blockedPurchaseRegistration.code, 'PURCHASE_REQUIRED');

  const paidRegistration = await service.registerPublicParticipant(tournament.slug, {
    name: 'Игрок с покупкой',
    phone: '+7 999 000-11-27',
    levelLabel: 'C',
    purchaseConfirmed: true,
    selectedPurchaseOptionId: 'single-entry',
    subscriptions: []
  });
  assert.equal(paidRegistration.code, 'REGISTERED');
  assert.equal(paidRegistration.participant?.paymentStatus, 'PAID');
  assert.match(paidRegistration.participant?.notes ?? '', /single-entry/);

  console.log('Tournament public join flow test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
