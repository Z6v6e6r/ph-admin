import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createSourceTournament(): Tournament {
  return {
    id: 'source-tournament-1',
    source: 'VIVA',
    name: 'Старое имя турнира',
    status: TournamentStatus.REGISTRATION,
    startsAt: '2026-04-18T12:00:00.000Z',
    studioName: 'TestMiniApp',
    trainerName: 'Тренер Сергеев'
  };
}

function createCustomTournament(sourceTournamentId: string): CustomTournament {
  return {
    id: 'custom-tournament-1',
    source: 'CUSTOM',
    sourceTournamentId,
    slug: 'test-custom-tournament',
    publicUrl: '/api/tournaments/public/test-custom-tournament',
    name: 'Новое имя турнира',
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
      title: 'Заголовок карточки'
    }
  };
}

async function main(): Promise<void> {
  const sourceTournament = createSourceTournament();
  const customTournament = createCustomTournament(sourceTournament.id);

  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [sourceTournament] } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [customTournament]
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );

  const tournaments = await service.findAll();

  assert.equal(tournaments.length, 1);
  assert.equal(tournaments[0]?.id, sourceTournament.id);
  assert.equal(tournaments[0]?.source, sourceTournament.source);
  assert.equal(tournaments[0]?.linkedCustomTournamentId, customTournament.id);
  assert.equal(
    tournaments[0]?.name,
    customTournament.name,
    'linked source tournaments should expose the saved custom name'
  );

  console.log('Custom tournament name merge test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
