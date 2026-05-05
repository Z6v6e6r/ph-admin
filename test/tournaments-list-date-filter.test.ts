import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createSourceTournament(id: string, startsAt: string): Tournament {
  return {
    id,
    source: 'VIVA',
    name: `Source ${id}`,
    status: TournamentStatus.REGISTRATION,
    startsAt,
    studioName: 'TestMiniApp'
  };
}

function createCustomTournament(
  id: string,
  startsAt: string,
  sourceTournamentId?: string
): CustomTournament {
  return {
    id,
    source: 'CUSTOM',
    ...(sourceTournamentId ? { sourceTournamentId } : {}),
    slug: id,
    publicUrl: `/api/tournaments/public/${id}`,
    name: `Custom ${id}`,
    status: TournamentStatus.REGISTRATION,
    startsAt,
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
      title: `Skin ${id}`
    }
  };
}

function createService(sourceTournaments: Tournament[], customTournaments: CustomTournament[]): TournamentsService {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => sourceTournaments } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => customTournaments
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
}

async function main(): Promise<void> {
  const sourceOnRequestedDate = createSourceTournament(
    'source-on-date',
    '2026-05-05T19:00:00+03:00'
  );
  const sourceOnOtherDate = createSourceTournament(
    'source-other-date',
    '2026-05-06T19:00:00+03:00'
  );
  const linkedSkinOnRequestedDate = createCustomTournament(
    'custom-linked-on-date',
    '2026-05-05T19:00:00+03:00',
    sourceOnRequestedDate.id
  );
  const linkedSkinOnOtherDate = createCustomTournament(
    'custom-linked-other-date',
    '2026-05-06T19:00:00+03:00',
    sourceOnOtherDate.id
  );
  const standaloneSkinOnRequestedDate = createCustomTournament(
    'custom-standalone-on-date',
    '2026-05-05T21:00:00+03:00'
  );
  const standaloneSkinOnOtherDate = createCustomTournament(
    'custom-standalone-other-date',
    '2026-05-07T21:00:00+03:00'
  );

  const service = createService(
    [sourceOnRequestedDate, sourceOnOtherDate],
    [
      linkedSkinOnRequestedDate,
      linkedSkinOnOtherDate,
      standaloneSkinOnRequestedDate,
      standaloneSkinOnOtherDate
    ]
  );

  const filtered = await service.findAll({ date: '2026-05-05' });
  assert.deepEqual(
    filtered.map((tournament) => tournament.linkedCustomTournamentId ?? tournament.id),
    ['custom-linked-on-date', 'custom-standalone-on-date']
  );
  assert.deepEqual(
    filtered.map((tournament) => tournament.skin?.title),
    ['Skin custom-linked-on-date', 'Skin custom-standalone-on-date']
  );

  const unfiltered = await service.findAll();
  assert.equal(unfiltered.length, 4);

  console.log('Tournament list date filter test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
