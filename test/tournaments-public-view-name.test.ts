import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createCustomTournament(): CustomTournament {
  return {
    id: 'custom-public-1',
    source: 'CUSTOM',
    slug: 'public-title-test',
    publicUrl: '/api/tournaments/public/public-title-test',
    name: 'Служебное имя турнира',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['D', 'D+'],
    gender: 'MIXED',
    maxPlayers: 12,
    participants: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    studioName: 'TestMiniApp',
    trainerName: 'Тренер Сергеев',
    startsAt: '2026-04-18T12:00:00.000Z',
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
      title: 'Публичное имя из скина',
      subtitle: 'Битва ракеток'
    }
  };
}

function createService(customTournament: CustomTournament): TournamentsService {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [] } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentBySlug: async (slug: string) =>
        slug === customTournament.slug ? customTournament : null,
      listCustomTournaments: async () => [customTournament]
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
}

async function main(): Promise<void> {
  const customTournament = createCustomTournament();
  const service = createService(customTournament);

  const publicBySlug = await service.getPublicBySlug(customTournament.slug);
  assert.equal(
    publicBySlug.name,
    customTournament.skin.title,
    'public tournament view should expose skin title as public name'
  );

  const directory = await service.listPublicDirectory();
  assert.equal(directory.count, 1);
  assert.equal(directory.items[0]?.name, customTournament.skin.title);
  assert.equal(directory.items[0]?.skin.title, customTournament.skin.title);

  console.log('Public tournament display name test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
