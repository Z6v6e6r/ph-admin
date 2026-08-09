import * as assert from 'node:assert/strict';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import {
  CustomTournament,
  Tournament,
  TournamentStatus
} from '../src/tournaments/tournaments.types';

function createSourceTournament(): Tournament {
  return {
    id: 'source-read-model-1',
    exerciseId: 'exercise-read-model-1',
    source: 'VIVA',
    name: 'Viva read-model tournament',
    status: TournamentStatus.REGISTRATION,
    startsAt: '2026-08-12T16:00:00.000Z',
    endsAt: '2026-08-12T18:00:00.000Z',
    studioName: 'PadlHub Test',
    trainerName: 'Persisted Trainer',
    tournamentType: 'Американо',
    maxPlayers: 12,
    participants: [
      {
        id: 'source-player-1',
        name: 'Persisted Player',
        phone: '79990001111',
        status: 'REGISTERED'
      },
      {
        id: 'source-player-2',
        name: 'Snapshot-only Player',
        phone: '79990003333',
        levelLabel: 'D+',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 2
  };
}

function createCustomTournament(source: Tournament): CustomTournament {
  return {
    id: 'custom-read-model-1',
    source: 'CUSTOM',
    sourceTournamentId: source.id,
    exerciseId: source.exerciseId,
    slug: 'read-model-cup',
    publicUrl: '/api/tournaments/public/read-model-cup',
    name: 'Read-model Cup',
    status: TournamentStatus.REGISTRATION,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    tournamentType: 'Американо',
    accessLevels: ['D+', 'C'],
    gender: 'MIXED',
    maxPlayers: 12,
    participants: [
      {
        id: 'custom-player-1',
        name: 'Persisted Player',
        phone: '79990001111',
        levelLabel: 'C',
        avatarUrl: 'https://example.com/persisted-player.jpg',
        status: 'REGISTERED'
      },
      {
        id: 'custom-only-player-1',
        name: 'Custom-only Registered Player',
        phone: '79990005555',
        levelLabel: 'C',
        status: 'REGISTERED'
      }
    ],
    participantsCount: 2,
    paidParticipantsCount: 0,
    waitlist: [
      {
        id: 'waitlist-player-1',
        name: 'Persisted Waitlist Player',
        phone: '79990002222',
        levelLabel: 'D+',
        status: 'WAITLIST'
      }
    ],
    waitlistCount: 1,
    allowedManagerPhones: [],
    studioName: source.studioName,
    trainerName: source.trainerName,
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
      title: 'Read-model Cup',
      priceLabel: '5 500 ₽'
    },
    pricePopover: {
      triggerLabel: '5 500 ₽',
      rows: [{ id: 'persisted-pass', label: 'Persisted Pass', value: '5 500 ₽' }]
    },
    hasFriendlySubscriptionTag: true,
    summerSubscriptionOffer: {
      id: 'summer-pass',
      label: 'Летний абонемент',
      value: 'Включён'
    },
    pricingSnapshotStatus: 'READY',
    pricingSnapshotUpdatedAt: '2026-08-09T18:00:00.000Z',
    pricingSnapshotVersion: 1,
    details: {
      booking: {
        acceptedSubscriptions: [{ id: 'persisted-pass', label: 'Persisted Pass' }],
        purchaseOptions: [{ id: 'persisted-product', label: 'Persisted Product' }],
        purchaseFlowUrl: 'https://example.com/persisted-purchase',
        vivaExerciseId: source.exerciseId,
        vivaWidgetId: 'iSkq6G',
        vivaStudioId: 'persisted-studio',
        pendingJoinPayments: [{ id: 'pending-payment-1', phone: '79990006666' }]
      },
      sourceTournamentSnapshot: {
        ...source,
        participants: [
          {
            id: 'embedded-source-player-1',
            name: 'Stale Embedded Player',
            phone: '79990001111',
            levelLabel: 'D',
            status: 'REGISTERED'
          },
          {
            id: 'embedded-removed-player',
            name: 'Removed Embedded Player',
            phone: '79990009999',
            levelLabel: 'C',
            status: 'REGISTERED'
          }
        ],
        participantsCount: 2
      }
    }
  };
}

async function main(): Promise<void> {
  const source = createSourceTournament();
  const custom = createCustomTournament(source);
  let liveListCalls = 0;
  let liveDetailCalls = 0;
  let profileCalls = 0;
  let snapshotCalls = 0;
  let snapshotAvailable = true;
  let snapshotThrows = false;

  const service = new TournamentsService(
    {
      listTournaments: async () => {
        throw new Error('Detail reads must not use the LK live fallback');
      }
    } as never,
    {
      listTournaments: async () => {
        liveListCalls += 1;
        throw new Error('Detail reads must not use the live Viva list');
      },
      findTournamentById: async () => {
        liveDetailCalls += 1;
        throw new Error('Detail reads must not use live Viva detail or roster');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async (id: string) => id === custom.id ? custom : null,
      findCustomTournamentBySourceTournamentId: async (id: string) =>
        id === source.id ? custom : null,
      findCustomTournamentByExerciseId: async (id: string) =>
        id === source.exerciseId ? custom : null,
      findCustomTournamentBySlug: async (slug: string) => slug === custom.slug ? custom : null
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    {
      lookupClientCabinetByPhone: async () => {
        profileCalls += 1;
        throw new Error('Detail reads must not enrich profiles from Viva');
      }
    } as never,
    undefined,
    {
      listTournaments: async (options: { refreshOnRead?: boolean }) => {
        snapshotCalls += 1;
        assert.equal(options.refreshOnRead, false);
        if (snapshotThrows) {
          throw new Error('Persisted snapshot is temporarily unavailable');
        }
        return snapshotAvailable ? [source] : null;
      }
    } as never
  );

  const customDetail = await service.findById(custom.id);
  assert.equal(customDetail.id, custom.id);
  assert.equal(customDetail.linkedCustomTournamentId, custom.id);
  assert.equal(customDetail.format, 'Американо');
  assert.equal(customDetail.participants?.[0]?.name, 'Persisted Player');
  assert.equal(customDetail.participants?.[0]?.id, 'source-player-1');
  assert.equal(customDetail.participants?.[0]?.level, 'C');
  assert.equal(customDetail.participants?.[0]?.ratingLabel, 'C');
  assert.equal(customDetail.participants?.[1]?.id, 'source-player-2');
  assert.equal(customDetail.participants?.[1]?.name, 'Snapshot-only Player');
  assert.equal(customDetail.participants?.[2]?.id, 'custom-only-player-1');
  assert.equal(
    customDetail.participants?.some((participant) => participant.id === 'embedded-removed-player'),
    false
  );
  assert.equal(customDetail.waitlist?.[0]?.name, 'Persisted Waitlist Player');

  const sourceDetail = await service.findById(source.id);
  assert.equal(sourceDetail.id, source.id);
  assert.equal(sourceDetail.linkedCustomTournamentId, custom.id);
  assert.equal(sourceDetail.participants?.[0]?.name, 'Persisted Player');
  assert.equal(sourceDetail.participants?.[0]?.avatarUrl, 'https://example.com/persisted-player.jpg');
  assert.equal(
    sourceDetail.participants?.some((participant) => participant.id === 'custom-only-player-1'),
    true
  );
  assert.equal(
    sourceDetail.participants?.some((participant) => participant.id === 'embedded-removed-player'),
    false
  );
  assert.equal(sourceDetail.waitlist?.[0]?.name, 'Persisted Waitlist Player');
  const sourceBooking = sourceDetail.details?.booking as Record<string, unknown> | undefined;
  assert.equal(sourceBooking?.vivaExerciseId, source.exerciseId);
  assert.equal(sourceBooking?.vivaWidgetId, 'iSkq6G');
  assert.equal(sourceBooking?.vivaStudioId, 'persisted-studio');
  assert.equal(sourceBooking?.purchaseFlowUrl, 'https://example.com/persisted-purchase');
  assert.equal((sourceBooking?.acceptedSubscriptions as unknown[])?.length, 1);
  assert.equal((sourceBooking?.purchaseOptions as unknown[])?.length, 1);
  assert.equal((sourceBooking?.pendingJoinPayments as unknown[])?.length, 1);
  assert.equal(sourceDetail.pricePopover?.triggerLabel, '5 500 ₽');
  assert.equal(sourceDetail.hasFriendlySubscriptionTag, true);
  assert.equal(sourceDetail.summerSubscriptionOffer?.id, 'summer-pass');
  assert.equal(sourceDetail.pricingSnapshotStatus, 'READY');
  assert.equal(sourceDetail.pricingSnapshotUpdatedAt, '2026-08-09T18:00:00.000Z');
  assert.equal(sourceDetail.pricingSnapshotVersion, 1);

  const sourceDetailByExerciseId = await service.findById(source.exerciseId as string);
  assert.equal(sourceDetailByExerciseId.id, source.id);
  assert.equal(sourceDetailByExerciseId.exerciseId, source.exerciseId);
  assert.equal(sourceDetailByExerciseId.linkedCustomTournamentId, custom.id);
  assert.equal(
    sourceDetailByExerciseId.participants?.some(
      (participant) => participant.id === 'embedded-removed-player'
    ),
    false
  );

  snapshotAvailable = false;
  const persistedSourceFallback = await service.findById(source.id);
  assert.equal(persistedSourceFallback.id, source.id);
  assert.equal(persistedSourceFallback.exerciseId, source.exerciseId);
  assert.equal(persistedSourceFallback.linkedCustomTournamentId, custom.id);
  assert.equal(persistedSourceFallback.skin?.title, 'Read-model Cup');
  assert.equal(
    persistedSourceFallback.participants?.some(
      (participant) => participant.id === 'custom-only-player-1'
    ),
    true
  );
  const persistedFallbackBooking = persistedSourceFallback.details?.booking as
    | Record<string, unknown>
    | undefined;
  assert.equal(persistedFallbackBooking?.vivaExerciseId, source.exerciseId);
  assert.equal((persistedFallbackBooking?.acceptedSubscriptions as unknown[])?.length, 1);
  assert.equal(persistedSourceFallback.pricePopover?.triggerLabel, '5 500 ₽');
  assert.equal(persistedSourceFallback.hasFriendlySubscriptionTag, true);
  assert.equal(persistedSourceFallback.summerSubscriptionOffer?.id, 'summer-pass');
  assert.equal(persistedSourceFallback.pricingSnapshotStatus, 'READY');

  snapshotAvailable = true;
  snapshotThrows = true;
  const persistedSourceFallbackAfterSnapshotError = await service.findById(source.id);
  assert.equal(persistedSourceFallbackAfterSnapshotError.id, source.id);
  assert.equal(persistedSourceFallbackAfterSnapshotError.linkedCustomTournamentId, custom.id);
  assert.equal(persistedSourceFallbackAfterSnapshotError.pricePopover?.triggerLabel, '5 500 ₽');

  const registrationDuringSnapshotError = await service.getPublicRegistrationByTournamentRef(
    custom.id,
    '+7 999 000-44-44'
  );
  assert.equal(registrationDuringSnapshotError.status, 'NONE');
  assert.equal(registrationDuringSnapshotError.canRegister, false);

  const persistedRegistrationDuringSnapshotError =
    await service.getPublicRegistrationByTournamentRef(
      custom.id,
      '+7 999 000-11-11'
    );
  assert.equal(persistedRegistrationDuringSnapshotError.status, 'REGISTERED');
  assert.equal(persistedRegistrationDuringSnapshotError.canCancel, true);

  const persistedWaitlistDuringSnapshotError =
    await service.getPublicRegistrationByTournamentRef(
      custom.id,
      '+7 999 000-22-22'
    );
  assert.equal(persistedWaitlistDuringSnapshotError.status, 'WAITLIST');
  assert.equal(persistedWaitlistDuringSnapshotError.canCancel, true);

  const staleEmbeddedRegistrationDuringSnapshotError =
    await service.getPublicRegistrationByTournamentRef(
      custom.id,
      '+7 999 000-99-99'
    );
  assert.equal(staleEmbeddedRegistrationDuringSnapshotError.status, 'NONE');
  assert.equal(staleEmbeddedRegistrationDuringSnapshotError.canRegister, false);

  snapshotThrows = false;
  snapshotAvailable = false;

  await assert.rejects(
    () => service.findById('source-only-out-of-window'),
    /Persisted tournament snapshot for source-only-out-of-window is unavailable/
  );

  snapshotAvailable = true;

  const registrationByCustomId = await service.getPublicRegistrationByTournamentRef(
    custom.id,
    '+7 999 000-11-11'
  );
  assert.equal(registrationByCustomId.status, 'REGISTERED');
  assert.equal(registrationByCustomId.placeNumber, 1);

  const registrationBySourceId = await service.getPublicRegistrationByTournamentRef(
    source.id,
    '+7 999 000-22-22'
  );
  assert.equal(registrationBySourceId.status, 'WAITLIST');
  assert.equal(registrationBySourceId.waitlistNumber, 1);

  const registrationByExerciseId = await service.getPublicRegistrationByTournamentRef(
    source.exerciseId as string,
    '+7 999 000-11-11'
  );
  assert.equal(registrationByExerciseId.status, 'REGISTERED');
  assert.equal(registrationByExerciseId.placeNumber, 1);

  const snapshotOnlyRegistration = await service.getPublicRegistrationByTournamentRef(
    custom.slug,
    '+7 999 000-33-33'
  );
  assert.equal(snapshotOnlyRegistration.status, 'REGISTERED');
  assert.equal(snapshotOnlyRegistration.placeNumber, 2);

  const registrationBySlug = await service.getPublicRegistrationByTournamentRef(
    custom.slug,
    '+7 999 000-44-44'
  );
  assert.equal(registrationBySlug.status, 'NONE');
  assert.equal(registrationBySlug.canRegister, true);

  assert.equal(snapshotCalls, 15);
  assert.equal(liveListCalls, 0);
  assert.equal(liveDetailCalls, 0);
  assert.equal(profileCalls, 0);

  const unavailableCustom: CustomTournament = {
    ...custom,
    id: 'custom-without-source-snapshot',
    sourceTournamentId: 'missing-viva-source',
    exerciseId: 'missing-viva-exercise',
    slug: 'missing-viva-source-cup',
    publicUrl: '/api/tournaments/public/missing-viva-source-cup',
    participants: [],
    participantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    details: {}
  };
  let unavailableLiveDetailCalls = 0;
  let unavailableBookingCalls = 0;
  let unavailableUpdateCalls = 0;
  const unavailableService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async () => {
        unavailableLiveDetailCalls += 1;
        throw new Error('Viva detail is unavailable');
      },
      createTournamentBooking: async () => {
        unavailableBookingCalls += 1;
        return false;
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async (id: string) =>
        id === unavailableCustom.id ? unavailableCustom : null,
      findCustomTournamentBySourceTournamentId: async (id: string) =>
        id === unavailableCustom.sourceTournamentId ? unavailableCustom : null,
      findCustomTournamentByExerciseId: async (id: string) =>
        id === unavailableCustom.exerciseId ? unavailableCustom : null,
      findCustomTournamentBySlug: async (slug: string) =>
        slug === unavailableCustom.slug ? unavailableCustom : null,
      updateCustomTournament: async () => {
        unavailableUpdateCalls += 1;
        return unavailableCustom;
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );

  const unavailableRegistration = await unavailableService.getPublicRegistrationByTournamentRef(
    unavailableCustom.id,
    '+7 999 000-77-77'
  );
  assert.equal(unavailableRegistration.status, 'NONE');
  assert.equal(unavailableRegistration.canRegister, false);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] })
    })) as unknown as typeof fetch;
    const unavailableRegistrationOutcome =
      await unavailableService.registerPublicParticipantByTournamentRef(
        unavailableCustom.id,
        {
          name: 'Fail-closed Player',
          phone: '+7 999 000-77-77',
          levelLabel: 'C'
        }
      );
    assert.equal(unavailableRegistrationOutcome.ok, false);
    assert.equal(unavailableRegistrationOutcome.code, 'BOOKING_FAILED');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(unavailableLiveDetailCalls, 2);
  assert.equal(unavailableBookingCalls, 0);
  assert.equal(unavailableUpdateCalls, 0);

  const nonVivaCustom: CustomTournament = {
    ...unavailableCustom,
    id: 'custom-linked-to-lk-source',
    sourceTournamentId: 'lk-source-id',
    exerciseId: 'lk-exercise-id',
    slug: 'lk-source-cup',
    publicUrl: '/api/tournaments/public/lk-source-cup',
    details: {
      sourceTournamentSnapshot: {
        id: 'lk-source-id',
        exerciseId: 'lk-exercise-id',
        source: 'LK_PADELHUB',
        name: 'LK source tournament',
        status: TournamentStatus.REGISTRATION,
        participants: [],
        participantsCount: 0
      }
    }
  };
  let nonVivaBookingCalls = 0;
  let nonVivaUpdateCalls = 0;
  const nonVivaService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => [],
      findTournamentById: async () => null,
      createTournamentBooking: async () => {
        nonVivaBookingCalls += 1;
        return true;
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async (id: string) => id === nonVivaCustom.id ? nonVivaCustom : null,
      findCustomTournamentBySourceTournamentId: async (id: string) =>
        id === nonVivaCustom.sourceTournamentId ? nonVivaCustom : null,
      findCustomTournamentByExerciseId: async (id: string) =>
        id === nonVivaCustom.exerciseId ? nonVivaCustom : null,
      findCustomTournamentBySlug: async (slug: string) =>
        slug === nonVivaCustom.slug ? nonVivaCustom : null,
      updateCustomTournament: async () => {
        nonVivaUpdateCalls += 1;
        return nonVivaCustom;
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );

  const nonVivaSourceDetail = await nonVivaService.findById('lk-source-id');
  assert.equal(nonVivaSourceDetail.source, 'LK_PADELHUB');
  assert.equal(nonVivaSourceDetail.linkedCustomTournamentId, nonVivaCustom.id);

  try {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] })
    })) as unknown as typeof fetch;
    const nonVivaRegistrationOutcome =
      await nonVivaService.registerPublicParticipantByTournamentRef(
        nonVivaCustom.id,
        {
          name: 'LK Player',
          phone: '+7 999 000-88-88',
          levelLabel: 'C'
        }
      );
    assert.equal(nonVivaRegistrationOutcome.ok, true);
    assert.equal(nonVivaRegistrationOutcome.code, 'REGISTERED');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(nonVivaBookingCalls, 0);
  assert.equal(nonVivaUpdateCalls, 1);

  const persistenceOutageService = new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => {
        throw new Error('Live Viva list must not be used');
      },
      findTournamentById: async () => {
        throw new Error('Live Viva detail must not be used');
      }
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      findCustomTournamentById: async () => null,
      findCustomTournamentBySourceTournamentId: async () => {
        throw new Error('MongoDB is unavailable');
      },
      findCustomTournamentByExerciseId: async () => {
        throw new Error('MongoDB is unavailable');
      }
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    undefined,
    undefined,
    {
      listTournaments: async (options: { refreshOnRead?: boolean }) => {
        assert.equal(options.refreshOnRead, false);
        return [source];
      }
    } as never
  );
  await assert.rejects(
    () => persistenceOutageService.findById(source.id),
    /Tournament read model is temporarily unavailable/
  );

  console.log('Tournament read-model detail and registration test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
