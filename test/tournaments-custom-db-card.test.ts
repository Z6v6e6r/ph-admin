import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createHydrationSourceTournament(): Tournament {
  return {
    id: 'source-viva-1',
    source: 'VIVA',
    name: 'Viva Tournament',
    status: TournamentStatus.REGISTRATION,
    trainerName: 'Тренер из Viva',
    trainerAvatarUrl: 'https://example.com/trainer-viva.jpg',
    tournamentType: 'Американо',
    maxPlayers: 8,
    participants: [
      {
        name: 'Игрок из Viva',
        phone: '79990001111',
        avatarUrl: 'https://example.com/source-player.jpg',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 1,
    startsAt: '2026-04-25T09:00:00.000Z'
  };
}

function createHydrationCustomTournament(): CustomTournament {
  return {
    id: 'custom-db-1',
    source: 'CUSTOM',
    slug: 'db-only-card',
    publicUrl: '/api/tournaments/public/db-only-card',
    sourceTournamentId: 'source-viva-1',
    name: 'Карточка из БД',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['D', 'C'],
    gender: 'MIXED',
    maxPlayers: 12,
    participants: [
      {
        name: 'Игрок из БД',
        phone: '79990002222',
        levelLabel: 'D',
        status: 'REGISTERED'
      },
      {
        name: 'Игрок',
        phone: '79104303190',
        levelLabel: 'D+',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 1,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    studioName: 'PadelHab',
    trainerName: 'Тренер из БД',
    startsAt: '2026-04-26T10:00:00.000Z',
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
      title: 'Карточка из БД'
    },
    details: {
      booking: {
        pendingJoinPayments: [
          {
            transactionId: 'pending-player-1',
            phone: '79603075826',
            name: '79603075826',
            levelLabel: 'D',
            createdAt: '2026-04-29T10:22:00.000Z'
          },
          {
            transactionId: 'pending-source-duplicate',
            phone: '79990001111',
            name: 'Игрок из Viva',
            levelLabel: 'C',
            createdAt: '2026-04-29T10:24:00.000Z'
          }
        ]
      },
      sourceTournamentSnapshot: {
        id: 'source-viva-1',
        trainerName: 'Старый тренер',
        participants: [
          {
            name: 'Старый игрок из snapshot',
            phone: '79990003333',
            levelLabel: 'C'
          }
        ]
      }
    }
  };
}

function createWaitlistTournament(): CustomTournament {
  return {
    id: 'custom-waitlist-1',
    source: 'CUSTOM',
    slug: 'waitlist-test',
    publicUrl: '/api/tournaments/public/waitlist-test',
    name: 'Waitlist Test',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['C'],
    gender: 'MIXED',
    maxPlayers: 2,
    participants: [
      {
        name: 'Уже записан',
        phone: '79990004444',
        levelLabel: 'C',
        status: 'REGISTERED'
      },
      {
        name: 'Уже записан 2',
        phone: '79990004445',
        levelLabel: 'C',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 2,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    studioName: 'PadelHab',
    trainerName: 'Тренер',
    startsAt: '2026-04-27T10:00:00.000Z',
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
      title: 'Waitlist Test'
    }
  };
}

function createService(options: {
  sourceTournaments?: Tournament[];
  customById?: CustomTournament;
  customBySlug?: CustomTournament;
  vivaAdminService?: unknown;
}): TournamentsService {
  const sourceTournaments = options.sourceTournaments ?? [];
  const customById = options.customById;
  const customBySlug = options.customBySlug;

  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => sourceTournaments } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async (id: string) =>
        customById && customById.id === id ? customById : null,
      findCustomTournamentBySlug: async (slug: string) =>
        customBySlug && customBySlug.slug === slug ? customBySlug : null,
      updateCustomTournament: async (_id: string, mutation: { participants?: unknown; waitlist?: unknown }) => {
        if (customBySlug && Array.isArray(mutation.participants)) {
          customBySlug.participants = mutation.participants as typeof customBySlug.participants;
          customBySlug.participantsCount = customBySlug.participants.length;
        }
        if (customBySlug && Array.isArray(mutation.waitlist)) {
          customBySlug.waitlist = mutation.waitlist as typeof customBySlug.waitlist;
          customBySlug.waitlistCount = customBySlug.waitlist.length;
        }
        return customBySlug ?? customById ?? null;
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    options.vivaAdminService as never
  );
}

async function main(): Promise<void> {
  const hydrationCustomTournament = createHydrationCustomTournament();
  const hydrationService = createService({
    sourceTournaments: [createHydrationSourceTournament()],
    customById: hydrationCustomTournament,
    customBySlug: hydrationCustomTournament,
    vivaAdminService: {
      lookupClientCabinetByPhone: async (phone: string) => {
        if (phone === '79990001111') {
          return {
            status: 'FOUND',
            vivaClientId: 'viva-client-1111',
            displayName: 'Игрок из Viva',
            avatarUrl: 'https://example.com/source-player-fresh.jpg',
            levelLabel: '2.904'
          };
        }
        if (phone === '79104303190') {
          return {
            status: 'FOUND',
            vivaClientId: 'viva-client-3190',
            displayName: 'Алексей Смирнов',
            avatarUrl: 'https://example.com/alexey.jpg'
          };
        }
        if (phone === '79603075826') {
          return {
            status: 'FOUND',
            vivaClientId: 'viva-client-5826',
            displayName: 'Анна Максимова',
            avatarUrl: 'https://example.com/anna.jpg'
          };
        }
        return null;
      }
    }
  });

  const hydrated = await hydrationService.findCustomById(hydrationCustomTournament.id);
  assert.equal(hydrated.participants.length, 1);
  assert.equal(hydrated.participants[0]?.name, 'Игрок из Viva');
  assert.equal(hydrated.participants[0]?.levelLabel, '2.904');
  assert.equal(hydrated.participantsCount, 1);
  assert.equal(hydrated.trainerName, 'Тренер из Viva');
  assert.equal(hydrated.trainerAvatarUrl, 'https://example.com/trainer-viva.jpg');
  const pendingJoinPayments = (
    hydrated.details?.booking as { pendingJoinPayments?: Array<{ name?: string; avatarUrl?: string | null }> } | undefined
  )?.pendingJoinPayments ?? [];
  assert.equal(pendingJoinPayments[0]?.name, 'Анна Максимова');
  assert.equal(pendingJoinPayments[0]?.avatarUrl, 'https://example.com/anna.jpg');

  const publicView = await hydrationService.getPublicBySlug(hydrationCustomTournament.slug);
  assert.ok(publicView, 'Public view should be returned for custom tournament');
  assert.equal(publicView.participants?.[0]?.name, 'Игрок из Viva');
  assert.equal(publicView.participants?.[0]?.levelLabel, '2.904');
  assert.equal(publicView.participants?.length, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicView.participants?.[0] ?? {}, 'phone'),
    false
  );

  const staleCustomTournament = createHydrationCustomTournament();
  staleCustomTournament.details = {};
  staleCustomTournament.participants = [
    {
      id: 'booking-1',
      name: 'Евгения Чабыкина',
      phone: '79253332314',
      levelLabel: 'D',
      avatarUrl: 'https://example.com/wrong-booking-avatar.jpg',
      status: 'REGISTERED'
    }
  ];
  staleCustomTournament.participantsCount = 1;
  const staleSourceTournament: Tournament = {
    ...createHydrationSourceTournament(),
    participants: [
      {
        id: 'client-atemasova',
        name: 'Атемасова Татьяна',
        phone: '79253332314',
        levelLabel: 'D+',
        avatarUrl: 'https://example.com/atemasova.jpg',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 1
  };
  const staleService = createService({
    sourceTournaments: [staleSourceTournament],
    customById: staleCustomTournament
  });
  const staleHydrated = await staleService.findCustomById(staleCustomTournament.id);
  assert.equal(staleHydrated.participants[0]?.id, 'client-atemasova');
  assert.equal(staleHydrated.participants[0]?.name, 'Атемасова Татьяна');
  assert.equal(staleHydrated.participants[0]?.avatarUrl, 'https://example.com/atemasova.jpg');
  assert.equal(staleHydrated.participants[0]?.levelLabel, 'D+');

  const waitlistTournament = createWaitlistTournament();
  const waitlistService = createService({ customBySlug: waitlistTournament });

  const fullWaitlistOutcome = await waitlistService.registerPublicParticipant(
    waitlistTournament.slug,
    {
      name: 'В лист по местам',
      phone: '+7 999 000-55-55',
      levelLabel: 'C'
    }
  );
  assert.equal(fullWaitlistOutcome.code, 'WAITLISTED');
  assert.equal(fullWaitlistOutcome.participant?.waitlistReason, 'FULL');

  const levelMismatchOutcome = await waitlistService.addPublicParticipantToWaitlist(
    waitlistTournament.slug,
    {
      name: 'В лист по уровню',
      phone: '+7 999 000-66-66',
      levelLabel: 'B'
    }
  );
  assert.equal(levelMismatchOutcome.code, 'WAITLISTED');
  assert.equal(levelMismatchOutcome.participant?.waitlistReason, 'LEVEL_MISMATCH');

  console.log('Custom tournament DB card test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
