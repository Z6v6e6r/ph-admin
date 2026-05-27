import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

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

async function main(): Promise<void> {
  const inWindowAndCanceled = createCustomTournament(
    'custom-canceled-in-window',
    '2026-05-28T19:00:00+03:00',
    'source-canceled'
  );
  const inWindowAndActive = createCustomTournament(
    'custom-active-in-window',
    '2026-05-29T19:00:00+03:00',
    'source-active'
  );
  const outOfWindow = createCustomTournament(
    'custom-out-of-window',
    '2026-06-05T19:00:00+03:00',
    'source-canceled-outside'
  );
  const alreadyCanceled = createCustomTournament(
    'custom-already-canceled',
    '2026-05-28T19:00:00+03:00',
    'source-canceled-already'
  );
  alreadyCanceled.status = TournamentStatus.CANCELED;
  const standalone = createCustomTournament(
    'custom-standalone',
    '2026-05-28T19:00:00+03:00'
  );

  const sourceById: Record<string, Tournament> = {
    'source-canceled': {
      id: 'source-canceled',
      source: 'VIVA',
      name: 'Source canceled',
      status: TournamentStatus.CANCELED,
      rawStatus: 'CANCELED',
      startsAt: '2026-05-28T19:00:00+03:00'
    },
    'source-active': {
      id: 'source-active',
      source: 'VIVA',
      name: 'Source active',
      status: TournamentStatus.REGISTRATION,
      rawStatus: 'REGISTRATION',
      startsAt: '2026-05-29T19:00:00+03:00'
    }
  };

  const updates: Array<{ id: string; mutation: Record<string, unknown> }> = [];
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async (id: string) => sourceById[id] ?? null
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [
        inWindowAndCanceled,
        inWindowAndActive,
        outOfWindow,
        alreadyCanceled,
        standalone
      ],
      updateCustomTournament: async (id: string, mutation: Record<string, unknown>) => {
        updates.push({ id, mutation });
        return {
          ...(id === inWindowAndCanceled.id ? inWindowAndCanceled : inWindowAndActive),
          status: mutation.status as TournamentStatus
        };
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );

  const result = await service.syncCanceledCustomTournamentsFromViva({
    now: new Date('2026-05-27T10:00:00+03:00'),
    forwardDays: 3
  });

  assert.equal(result.candidatesCount, 2);
  assert.equal(result.checkedCount, 2);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.sourceNotCanceledCount, 1);
  assert.equal(result.sourceNotFoundCount, 0);

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, inWindowAndCanceled.id);
  assert.equal(updates[0]?.mutation.status, TournamentStatus.CANCELED);
  assert.equal(updates[0]?.mutation.statusSource, 'VIVA_SYNC');
  assert.equal(updates[0]?.mutation.autoStatusChange, true);
  assert.match(
    String(updates[0]?.mutation.statusReason ?? ''),
    /подтверждённо отменён/i
  );

  console.log('Tournament Viva hourly cancel sync test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
