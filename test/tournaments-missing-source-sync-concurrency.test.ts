import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, Tournament, TournamentStatus } from '../src/tournaments/tournaments.types';

interface MissingSourceSyncInternals {
  missingSourceSkinStatusSyncInFlight: Set<string>;
  syncMissingSourceSkinStatuses(
    tournaments: CustomTournament[],
    syncKey: string
  ): Promise<void>;
}

function createCustomTournament(id: string, sourceTournamentId: string): CustomTournament {
  return {
    id,
    source: 'CUSTOM',
    sourceTournamentId,
    slug: id,
    publicUrl: `/api/tournaments/public/${id}`,
    name: `Custom ${id}`,
    status: TournamentStatus.REGISTRATION,
    startsAt: '2026-08-09T19:00:00+03:00',
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
    skin: { title: `Skin ${id}` }
  };
}

function createCanceledSourceTournament(id: string): Tournament {
  return {
    id,
    source: 'VIVA',
    name: `Source ${id}`,
    status: TournamentStatus.CANCELED,
    rawStatus: 'CANCELED',
    startsAt: '2026-08-09T19:00:00+03:00'
  };
}

async function main(): Promise<void> {
  const firstFailed = createCustomTournament('custom-first-failed', 'source-first-failed');
  const firstSibling = createCustomTournament('custom-first-sibling', 'source-first-sibling');
  const secondBatch = createCustomTournament('custom-second-batch', 'source-second-batch');
  const sourceChecks: string[] = [];
  const sourceCheckWaiters = new Map<string, () => void>();
  const sourceCheckReleases = new Map<string, () => void>();
  let activeSourceChecks = 0;
  let maxActiveSourceChecks = 0;
  const persistenceUpdates: Array<{ id: string; mutation: Record<string, unknown> }> = [];

  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async (id: string) => {
        sourceChecks.push(id);
        activeSourceChecks += 1;
        maxActiveSourceChecks = Math.max(maxActiveSourceChecks, activeSourceChecks);
        sourceCheckWaiters.get(id)?.();
        await new Promise<void>((resolve) => sourceCheckReleases.set(id, resolve));
        activeSourceChecks -= 1;
        return createCanceledSourceTournament(id);
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      updateCustomTournament: async (id: string, mutation: Record<string, unknown>) => {
        persistenceUpdates.push({ id, mutation });
        if (id === firstFailed.id) {
          throw new Error('simulated persistence failure');
        }
        return createCustomTournament(id, `source-${id}`);
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
  const internals = service as unknown as MissingSourceSyncInternals;
  const waitForSourceCheck = (id: string): Promise<void> => {
    if (sourceChecks.includes(id)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => sourceCheckWaiters.set(id, resolve));
  };

  internals.missingSourceSkinStatusSyncInFlight.add('batch-a');
  internals.missingSourceSkinStatusSyncInFlight.add('batch-b');
  const firstBatchRun = internals.syncMissingSourceSkinStatuses(
    [firstFailed, firstSibling],
    'batch-a'
  );
  const secondBatchRun = internals.syncMissingSourceSkinStatuses([secondBatch], 'batch-b');

  await waitForSourceCheck(firstFailed.sourceTournamentId!);
  assert.deepEqual(sourceChecks, [firstFailed.sourceTournamentId]);
  assert.equal(maxActiveSourceChecks, 1);
  sourceCheckReleases.get(firstFailed.sourceTournamentId!)?.();

  await waitForSourceCheck(firstSibling.sourceTournamentId!);
  assert.equal(internals.missingSourceSkinStatusSyncInFlight.has('batch-a'), true);
  assert.equal(maxActiveSourceChecks, 1);
  sourceCheckReleases.get(firstSibling.sourceTournamentId!)?.();

  await firstBatchRun;
  assert.equal(internals.missingSourceSkinStatusSyncInFlight.has('batch-a'), false);
  await waitForSourceCheck(secondBatch.sourceTournamentId!);
  assert.equal(maxActiveSourceChecks, 1);
  sourceCheckReleases.get(secondBatch.sourceTournamentId!)?.();
  await secondBatchRun;

  assert.deepEqual(sourceChecks, [
    firstFailed.sourceTournamentId,
    firstSibling.sourceTournamentId,
    secondBatch.sourceTournamentId
  ]);
  assert.equal(maxActiveSourceChecks, 1);
  assert.deepEqual(
    persistenceUpdates.map((update) => update.id),
    [firstFailed.id, firstSibling.id, secondBatch.id]
  );
  assert.deepEqual(persistenceUpdates[1]?.mutation, {
    status: TournamentStatus.CANCELED,
    statusReason:
      'Автоотмена Viva sync: связанный турнир в источнике Viva имеет статус CANCELED.',
    statusSource: 'VIVA_SYNC',
    autoStatusChange: true,
    actor: {
      id: 'system:viva-sync',
      name: 'Viva sync'
    }
  });
  assert.equal(internals.missingSourceSkinStatusSyncInFlight.has('batch-b'), false);

  console.log('Tournament missing-source sync concurrency test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
