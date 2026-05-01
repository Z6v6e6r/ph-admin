import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';
import { CommunityFeedItem } from '../src/communities/communities.types';

function createTournament(): CustomTournament {
  return {
    id: 'custom-tournament-1',
    source: 'CUSTOM',
    slug: 'padel-tournament',
    publicUrl: '/api/tournaments/public/padel-tournament',
    name: 'Падел турнир',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['D', 'D+'],
    gender: 'MIXED',
    maxPlayers: 8,
    participants: [],
    waitlist: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlistCount: 0,
    allowedManagerPhones: [],
    publicationCommunityIds: ['community-a', 'community-b'],
    studioName: 'TestMiniApp',
    startsAt: '2026-04-30T08:00:00.000Z',
    skin: {
      title: 'Падел турнир от ПадлхАБ',
      subtitle: 'TestMiniApp',
      ctaLabel: 'Записаться'
    },
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
    changeLog: []
  };
}

async function main(): Promise<void> {
  const tournament = createTournament();
  const createdFeedItems: Array<{ communityId: string; payload: Record<string, unknown> }> = [];
  const existingFeedItem = {
    id: 'feed-existing',
    communityId: 'community-b',
    kind: 'TOURNAMENT',
    status: 'PUBLISHED',
    title: 'Падел турнир',
    details: {
      tournamentId: tournament.id
    }
  } satisfies CommunityFeedItem;

  const service = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [] } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      updateCustomTournament: async () => tournament
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    {
      listFeedItems: async (communityId: string) =>
        communityId === 'community-b' ? [existingFeedItem] : [],
      createFeedItem: async (communityId: string, payload: Record<string, unknown>) => {
        createdFeedItems.push({ communityId, payload });
        return {
          id: `feed-${communityId}`,
          communityId,
          kind: 'TOURNAMENT',
          status: 'PUBLISHED',
          title: String(payload.title)
        } satisfies CommunityFeedItem;
      }
    } as never
  );

  await service.updateCustom(tournament.id, {
    publicationCommunityIds: tournament.publicationCommunityIds
  });

  assert.equal(createdFeedItems.length, 1);
  assert.equal(createdFeedItems[0]?.communityId, 'community-a');
  assert.equal(createdFeedItems[0]?.payload.kind, 'TOURNAMENT');
  assert.equal(createdFeedItems[0]?.payload.title, 'Падел турнир от ПадлхАБ');
  const details = createdFeedItems[0]?.payload.details as Record<string, unknown>;
  assert.deepEqual(details.tournamentId, tournament.id);
  assert.equal(details.cardVariant, 'TOURNAMENTS_SHOWCASE_COMPACT');
  assert.equal((details.publicTournament as Record<string, unknown>).id, tournament.id);
  assert.equal((details.publicTournament as Record<string, unknown>).joinUrl, `${tournament.publicUrl}/join`);

  const canceledTournament = {
    ...createTournament(),
    id: 'custom-tournament-canceled',
    status: TournamentStatus.CANCELED,
    publicationCommunityIds: ['community-a']
  };
  const canceledService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [] } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      updateCustomTournament: async () => canceledTournament
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    {
      listFeedItems: async () => [],
      createFeedItem: async () => {
        throw new Error('Canceled tournament should not be published');
      }
    } as never
  );
  await canceledService.updateCustom(canceledTournament.id, {
    status: TournamentStatus.CANCELED,
    publicationCommunityIds: canceledTournament.publicationCommunityIds
  });

  console.log('Tournament community publication test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
