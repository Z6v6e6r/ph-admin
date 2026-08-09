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
  const duplicateActiveSkin = createCustomTournament(
    'custom-active-duplicate-skin',
    '2026-05-29T20:00:00+03:00',
    'source-active'
  );
  const adminCanceled = createCustomTournament(
    'custom-admin-canceled',
    '2026-05-29T21:00:00+03:00',
    'source-admin-canceled'
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
  const liveDetailLookups: string[] = [];
  const adminStatusLookups: string[] = [];
  let activeAdminLookups = 0;
  let maxActiveAdminLookups = 0;
  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        throw new Error('Hourly sync must not use the live Viva tournament list');
      },
      findTournamentById: async (id: string) => {
        liveDetailLookups.push(id);
        throw new Error('Hourly sync must not use live Viva tournament details');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [
        inWindowAndCanceled,
        inWindowAndActive,
        duplicateActiveSkin,
        adminCanceled,
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
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    {
      getExerciseStatus: async (id: string) => {
        adminStatusLookups.push(id);
        activeAdminLookups += 1;
        maxActiveAdminLookups = Math.max(maxActiveAdminLookups, activeAdminLookups);
        try {
          await new Promise<void>((resolve) => setImmediate(resolve));
          return {
            id,
            rawStatus: id === 'source-admin-canceled' ? 'CANCELED' : 'ACTIVE',
            canceled: id === 'source-admin-canceled'
          };
        } finally {
          activeAdminLookups -= 1;
        }
      }
    } as never,
    undefined,
    {
      listTournaments: async (options: { refreshOnRead?: boolean }) => {
        assert.equal(options.refreshOnRead, false);
        return Object.values(sourceById);
      }
    } as never
  );

  const result = await service.syncCanceledCustomTournamentsFromViva({
    now: new Date('2026-05-27T10:00:00+03:00'),
    forwardDays: 3
  });

  assert.equal(result.candidatesCount, 4);
  assert.equal(result.checkedCount, 4);
  assert.equal(result.uniqueSourceCount, 3);
  assert.equal(result.readModelCanceledCandidateCount, 1);
  assert.equal(result.uniqueAdminStatusLookupCount, 3);
  assert.equal(result.adminStatusUnknownCandidateCount, 0);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.sourceNotCanceledCount, 3);
  assert.equal(result.sourceNotFoundCount, 0);
  assert.deepEqual(liveDetailLookups, []);
  assert.deepEqual(adminStatusLookups, [
    'source-canceled',
    'source-active',
    'source-admin-canceled'
  ]);
  assert.equal(maxActiveAdminLookups, 1);

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, adminCanceled.id);
  assert.equal(updates[0]?.mutation.status, TournamentStatus.CANCELED);
  assert.equal(updates[0]?.mutation.statusSource, 'VIVA_SYNC');
  assert.equal(updates[0]?.mutation.autoStatusChange, true);
  assert.match(
    String(updates[0]?.mutation.statusReason ?? ''),
    /подтверждённо отменён/i
  );

  let fallbackLiveDetailLookups = 0;
  const fallbackService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        throw new Error('Hourly sync must not fall back to the live Viva tournament list');
      },
      findTournamentById: async () => {
        fallbackLiveDetailLookups += 1;
        throw new Error('Hourly sync must not fall back to live Viva tournament details');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [inWindowAndActive],
      updateCustomTournament: async () => {
        throw new Error('UNKNOWN status must not cancel a tournament');
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    { getExerciseStatus: async () => null } as never,
    undefined,
    {
      listTournaments: async () => {
        throw new Error('simulated persisted snapshot outage');
      }
    } as never
  );

  const fallbackResult = await fallbackService.syncCanceledCustomTournamentsFromViva({
    now: new Date('2026-05-27T10:00:00+03:00'),
    forwardDays: 3
  });
  assert.equal(fallbackResult.candidatesCount, 1);
  assert.equal(fallbackResult.uniqueSourceCount, 1);
  assert.equal(fallbackResult.uniqueAdminStatusLookupCount, 1);
  assert.equal(fallbackResult.adminStatusUnknownCandidateCount, 1);
  assert.equal(fallbackResult.sourceNotFoundCount, 1);
  assert.equal(fallbackResult.sourceNotCanceledCount, 0);
  assert.equal(fallbackResult.updatedCount, 0);
  assert.equal(fallbackLiveDetailLookups, 0);

  const staleCanceledUnknownService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        throw new Error('Hourly sync must not use the live Viva tournament list');
      },
      findTournamentById: async () => {
        throw new Error('Hourly sync must not use live Viva tournament details');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [inWindowAndCanceled],
      updateCustomTournament: async () => {
        throw new Error('UNKNOWN Admin status must not cancel a tournament');
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    { getExerciseStatus: async () => null } as never,
    undefined,
    { listTournaments: async () => [sourceById['source-canceled']] } as never
  );

  const staleCanceledUnknownResult =
    await staleCanceledUnknownService.syncCanceledCustomTournamentsFromViva({
      now: new Date('2026-05-27T10:00:00+03:00'),
      forwardDays: 3
    });
  assert.equal(staleCanceledUnknownResult.readModelCanceledCandidateCount, 1);
  assert.equal(staleCanceledUnknownResult.adminStatusUnknownCandidateCount, 1);
  assert.equal(staleCanceledUnknownResult.sourceNotFoundCount, 0);
  assert.equal(staleCanceledUnknownResult.sourceNotCanceledCount, 0);
  assert.equal(staleCanceledUnknownResult.updatedCount, 0);

  console.log('Tournament Viva hourly cancel sync test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
