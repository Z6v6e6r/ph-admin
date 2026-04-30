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
        levelLabel: 'C',
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
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
}

async function main(): Promise<void> {
  const hydrationCustomTournament = createHydrationCustomTournament();
  const hydrationService = createService({
    sourceTournaments: [createHydrationSourceTournament()],
    customById: hydrationCustomTournament,
    customBySlug: hydrationCustomTournament
  });

  const hydrated = await hydrationService.findCustomById(hydrationCustomTournament.id);
  assert.equal(hydrated.participants.length, 2);
  assert.equal(hydrated.participants[0]?.name, 'Игрок из Viva');
  assert.equal(hydrated.participants[1]?.name, 'Игрок из БД');
  assert.equal(hydrated.participantsCount, 2);
  assert.equal(hydrated.trainerName, 'Тренер из БД');
  assert.equal(hydrated.trainerAvatarUrl, 'https://example.com/trainer-viva.jpg');

  const publicView = await hydrationService.getPublicBySlug(hydrationCustomTournament.slug);
  assert.ok(publicView, 'Public view should be returned for custom tournament');
  assert.equal(publicView.participants?.[0]?.name, 'Игрок из Viva');
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicView.participants?.[0] ?? {}, 'phone'),
    false
  );

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
