import * as assert from 'node:assert/strict';
import {
  CreateCustomTournamentMutation
} from '../src/tournaments/tournaments-persistence.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createMechanics(): CustomTournament['mechanics'] {
  return {
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
  };
}

function createCustomFromMutation(
  mutation: CreateCustomTournamentMutation
): CustomTournament {
  return {
    id: 'custom-manual-viva-1',
    source: 'CUSTOM',
    sourceTournamentId: mutation.sourceTournamentId,
    slug: 'manual-viva-link',
    publicUrl: '/api/tournaments/public/manual-viva-link',
    name: mutation.name,
    status: mutation.status ?? TournamentStatus.REGISTRATION,
    tournamentType: mutation.tournamentType,
    accessLevels: mutation.accessLevels,
    gender: mutation.gender,
    maxPlayers: mutation.maxPlayers,
    participants: mutation.participants,
    participantsCount: mutation.participants.length,
    paidParticipantsCount: mutation.participants.filter((item) => item.paymentStatus === 'PAID').length,
    waitlist: mutation.waitlist,
    waitlistCount: mutation.waitlist.length,
    allowedManagerPhones: mutation.allowedManagerPhones,
    publicationCommunityIds: mutation.publicationCommunityIds ?? [],
    studioId: mutation.studioId,
    studioName: mutation.studioName,
    startsAt: mutation.startsAt,
    endsAt: mutation.endsAt,
    mechanics: createMechanics(),
    changeLog: [],
    skin: mutation.skin ?? { title: mutation.name },
    details: {
      sourceTournamentSnapshot: mutation.sourceTournamentSnapshot
    }
  };
}

async function main(): Promise<void> {
  let capturedMutation: CreateCustomTournamentMutation | null = null;

  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async () => null
    } as never,
    {
      getTournamentResults: async () => {
        throw new Error('Not used in test');
      }
    } as never,
    {
      isEnabled: () => true,
      findCustomTournamentBySourceTournamentId: async () => null,
      createCustomTournament: async (mutation: CreateCustomTournamentMutation) => {
        capturedMutation = mutation;
        return createCustomFromMutation(mutation);
      },
      updateCustomTournament: async (_id: string, mutation: {
        exerciseId?: string;
        pricePopover?: unknown;
        hasFriendlySubscriptionTag?: boolean;
        summerSubscriptionOffer?: unknown;
        pricingSnapshotStatus?: string;
        pricingSnapshotUpdatedAt?: string;
        pricingSnapshotVersion?: number;
      }) => {
        const baseMutation = capturedMutation as CreateCustomTournamentMutation;
        const created = createCustomFromMutation(baseMutation);
        return {
          ...created,
          exerciseId: mutation.exerciseId ?? created.exerciseId,
          pricePopover: mutation.pricePopover as typeof created.pricePopover,
          hasFriendlySubscriptionTag: mutation.hasFriendlySubscriptionTag ?? false,
          summerSubscriptionOffer:
            mutation.summerSubscriptionOffer as typeof created.summerSubscriptionOffer,
          pricingSnapshotStatus: mutation.pricingSnapshotStatus as typeof created.pricingSnapshotStatus,
          pricingSnapshotUpdatedAt: mutation.pricingSnapshotUpdatedAt,
          pricingSnapshotVersion: mutation.pricingSnapshotVersion
        };
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    {
      getExerciseStatus: async () => ({
        id: '8fae2b19-baa4-4eb9-98b8-93c9f988f425',
        rawStatus: 'ACTIVE',
        canceled: false,
        timeFrom: '10:00',
        timeTo: '13:00'
      }),
      listExerciseBookings: async () => ([
        {
          clientName: 'Игрок 1',
          clientPhone: '+7 (999) 111-22-33',
          paymentStatus: 'PAID'
        },
        {
          client: {
            name: 'Игрок 2',
            phone: '89995554433',
            levelLabel: 'C+'
          }
        }
      ])
    } as never
  );

  const created = await service.createCustomFromVivaLink(
    'https://cabinet.vivacrm.ru/schedule/233c1405-1eac-40de-8ec6-1cf7e24c9276/exercise/8fae2b19-baa4-4eb9-98b8-93c9f988f425?date=2026-06-07',
    {}
  );

  assert.ok(capturedMutation, 'create mutation should be captured');
  const mutation = capturedMutation as CreateCustomTournamentMutation;
  assert.equal(
    mutation.sourceTournamentId,
    '8fae2b19-baa4-4eb9-98b8-93c9f988f425'
  );
  assert.equal(
    mutation.studioId,
    '233c1405-1eac-40de-8ec6-1cf7e24c9276'
  );
  assert.equal(mutation.participants.length, 2);
  assert.equal(mutation.participants[0]?.name, 'Игрок 1');
  assert.equal(mutation.participants[0]?.phone, '79991112233');
  assert.equal(mutation.participants[0]?.paymentStatus, 'PAID');
  assert.equal(mutation.participants[1]?.name, 'Игрок 2');
  assert.equal(mutation.participants[1]?.phone, '79995554433');
  assert.equal(mutation.participants[1]?.levelLabel, 'C+');
  assert.equal(mutation.startsAt, '2026-06-07T10:00:00');
  assert.equal(mutation.endsAt, '2026-06-07T13:00:00');
  assert.equal(created.sourceTournamentId, '8fae2b19-baa4-4eb9-98b8-93c9f988f425');

  console.log('Custom tournament from Viva link test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
