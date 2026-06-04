import * as assert from 'node:assert/strict';
import {
  CreateCustomTournamentMutation,
  UpdateCustomTournamentMutation
} from '../src/tournaments/tournaments-persistence.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import {
  CustomTournament,
  Tournament,
  TournamentPricePopover,
  TournamentStatus
} from '../src/tournaments/tournaments.types';

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

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'tournament';
}

function createSourceTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 'mongo-exercise-1',
    exerciseId: '92051094-9db6-4cfd-a400-b9ad360d0a4b',
    source: 'VIVA',
    name: 'Snapshot Tournament',
    status: TournamentStatus.REGISTRATION,
    startsAt: '2026-06-07T10:00:00.000Z',
    endsAt: '2026-06-07T13:00:00.000Z',
    studioId: 'studio-1',
    studioName: 'PadelHab Селигерская',
    tournamentType: 'Американо',
    maxPlayers: 16,
    participants: [],
    participantsCount: 0,
    ...overrides
  };
}

function createCustomTournament(overrides: Partial<CustomTournament> = {}): CustomTournament {
  return {
    id: 'custom-1',
    source: 'CUSTOM',
    slug: 'snapshot-tournament',
    publicUrl: '/api/tournaments/public/snapshot-tournament',
    sourceTournamentId: 'mongo-exercise-1',
    exerciseId: '92051094-9db6-4cfd-a400-b9ad360d0a4b',
    name: 'Snapshot Tournament',
    status: TournamentStatus.REGISTRATION,
    tournamentType: 'Американо',
    accessLevels: ['C', 'C+'],
    gender: 'MIXED',
    maxPlayers: 16,
    participants: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    publicationCommunityIds: [],
    studioId: 'studio-1',
    studioName: 'PadelHab Селигерская',
    startsAt: '2026-06-07T10:00:00.000Z',
    endsAt: '2026-06-07T13:00:00.000Z',
    mechanics: createMechanics(),
    changeLog: [],
    skin: {
      title: 'Snapshot Tournament',
      ctaLabel: 'Записаться'
    },
    details: {
      sourceTournamentSnapshot: {
        id: 'mongo-exercise-1',
        exerciseId: '92051094-9db6-4cfd-a400-b9ad360d0a4b',
        source: 'VIVA',
        studioId: 'studio-1'
      }
    },
    ...overrides
  };
}

class MemoryTournamentPersistence {
  readonly records = new Map<string, CustomTournament>();
  lastCreateMutation: CreateCustomTournamentMutation | null = null;
  lastUpdateMutation: UpdateCustomTournamentMutation | null = null;
  private nextId = 1;

  isEnabled(): boolean {
    return true;
  }

  async listCustomTournaments(): Promise<CustomTournament[]> {
    return Array.from(this.records.values()).map((item) => structuredClone(item));
  }

  async findCustomTournamentById(id: string): Promise<CustomTournament | null> {
    return this.clone(this.records.get(id) ?? null);
  }

  async findCustomTournamentBySlug(slug: string): Promise<CustomTournament | null> {
    const found = Array.from(this.records.values()).find((item) => item.slug === slug) ?? null;
    return this.clone(found);
  }

  async findCustomTournamentBySourceTournamentId(
    sourceTournamentId: string
  ): Promise<CustomTournament | null> {
    const found = Array.from(this.records.values()).find(
      (item) => item.sourceTournamentId === sourceTournamentId
    ) ?? null;
    return this.clone(found);
  }

  async createCustomTournament(
    mutation: CreateCustomTournamentMutation
  ): Promise<CustomTournament> {
    this.lastCreateMutation = structuredClone(mutation);
    const id = `custom-${this.nextId++}`;
    const tournament = this.fromCreateMutation(id, mutation);
    this.records.set(id, tournament);
    return structuredClone(tournament);
  }

  async updateCustomTournament(
    id: string,
    mutation: UpdateCustomTournamentMutation
  ): Promise<CustomTournament | null> {
    this.lastUpdateMutation = structuredClone(mutation);
    const current = this.records.get(id);
    if (!current) {
      return null;
    }

    const next = this.applyUpdate(current, mutation);
    this.records.set(id, next);
    return structuredClone(next);
  }

  private clone(value: CustomTournament | null): CustomTournament | null {
    return value ? structuredClone(value) : null;
  }

  private fromCreateMutation(
    id: string,
    mutation: CreateCustomTournamentMutation
  ): CustomTournament {
    const slug = slugify(mutation.slug ?? mutation.name ?? id);
    const details: Record<string, unknown> = {
      ...(mutation.details ?? {})
    };
    if (mutation.sourceTournamentSnapshot) {
      details.sourceTournamentSnapshot = mutation.sourceTournamentSnapshot;
    }

    return {
      id,
      source: 'CUSTOM',
      slug,
      publicUrl: `/api/tournaments/public/${slug}`,
      sourceTournamentId: mutation.sourceTournamentId,
      exerciseId: mutation.exerciseId ?? undefined,
      name: mutation.name,
      status: mutation.status ?? TournamentStatus.REGISTRATION,
      tournamentType: mutation.tournamentType,
      accessLevels: mutation.accessLevels,
      gender: mutation.gender,
      maxPlayers: mutation.maxPlayers,
      participants: structuredClone(mutation.participants),
      participantsCount: mutation.participants.length,
      paidParticipantsCount: mutation.participants.filter((item) => item.paymentStatus === 'PAID').length,
      waitlist: structuredClone(mutation.waitlist),
      waitlistCount: mutation.waitlist.length,
      allowedManagerPhones: structuredClone(mutation.allowedManagerPhones),
      publicationCommunityIds: structuredClone(mutation.publicationCommunityIds ?? []),
      studioId: mutation.studioId,
      studioName: mutation.studioName,
      courtName: mutation.courtName,
      locationName: mutation.locationName,
      trainerId: mutation.trainerId,
      trainerName: mutation.trainerName,
      trainerAvatarUrl: mutation.trainerAvatarUrl ?? undefined,
      exerciseTypeId: mutation.exerciseTypeId,
      startsAt: mutation.startsAt,
      endsAt: mutation.endsAt,
      pricePopover: mutation.pricePopover ?? undefined,
      hasFriendlySubscriptionTag: mutation.hasFriendlySubscriptionTag === true,
      summerSubscriptionOffer: mutation.summerSubscriptionOffer ?? undefined,
      pricingSnapshotStatus: mutation.pricingSnapshotStatus,
      pricingSnapshotUpdatedAt: mutation.pricingSnapshotUpdatedAt ?? undefined,
      pricingSnapshotVersion: mutation.pricingSnapshotVersion ?? undefined,
      skin: structuredClone(mutation.skin ?? { title: mutation.name }),
      mechanics: structuredClone((mutation.mechanics as CustomTournament['mechanics']) ?? createMechanics()),
      changeLog: [],
      details: Object.keys(details).length > 0 ? details : undefined
    };
  }

  private applyUpdate(
    current: CustomTournament,
    mutation: UpdateCustomTournamentMutation
  ): CustomTournament {
    const next: CustomTournament = structuredClone(current);

    if (mutation.exerciseId !== undefined) {
      next.exerciseId = mutation.exerciseId ?? undefined;
    }
    if (mutation.name !== undefined) {
      next.name = mutation.name ?? next.name;
    }
    if (mutation.status !== undefined) {
      next.status = mutation.status;
      next.rawStatus = mutation.status;
    }
    if (mutation.startsAt !== undefined) {
      next.startsAt = mutation.startsAt ?? undefined;
    }
    if (mutation.endsAt !== undefined) {
      next.endsAt = mutation.endsAt ?? undefined;
    }
    if (mutation.tournamentType !== undefined && mutation.tournamentType) {
      next.tournamentType = mutation.tournamentType;
    }
    if (mutation.accessLevels !== undefined) {
      next.accessLevels = structuredClone(mutation.accessLevels);
    }
    if (mutation.gender !== undefined) {
      next.gender = mutation.gender;
    }
    if (mutation.maxPlayers !== undefined && mutation.maxPlayers > 0) {
      next.maxPlayers = mutation.maxPlayers;
    }
    if (mutation.participants !== undefined) {
      next.participants = structuredClone(mutation.participants);
      next.participantsCount = next.participants.length;
      next.paidParticipantsCount = next.participants.filter((item) => item.paymentStatus === 'PAID').length;
    }
    if (mutation.waitlist !== undefined) {
      next.waitlist = structuredClone(mutation.waitlist);
      next.waitlistCount = next.waitlist.length;
    }
    if (mutation.allowedManagerPhones !== undefined) {
      next.allowedManagerPhones = structuredClone(mutation.allowedManagerPhones);
    }
    if (mutation.publicationCommunityIds !== undefined) {
      next.publicationCommunityIds = structuredClone(mutation.publicationCommunityIds);
    }
    if (mutation.slug !== undefined && mutation.slug) {
      next.slug = slugify(mutation.slug);
      next.publicUrl = `/api/tournaments/public/${next.slug}`;
    }
    if (mutation.studioId !== undefined) {
      next.studioId = mutation.studioId ?? undefined;
    }
    if (mutation.studioName !== undefined) {
      next.studioName = mutation.studioName ?? undefined;
    }
    if (mutation.courtName !== undefined) {
      next.courtName = mutation.courtName ?? undefined;
    }
    if (mutation.locationName !== undefined) {
      next.locationName = mutation.locationName ?? undefined;
    }
    if (mutation.trainerId !== undefined) {
      next.trainerId = mutation.trainerId ?? undefined;
    }
    if (mutation.trainerName !== undefined) {
      next.trainerName = mutation.trainerName ?? undefined;
    }
    if (mutation.trainerAvatarUrl !== undefined) {
      next.trainerAvatarUrl = mutation.trainerAvatarUrl ?? undefined;
    }
    if (mutation.exerciseTypeId !== undefined) {
      next.exerciseTypeId = mutation.exerciseTypeId ?? undefined;
    }
    if (mutation.skin !== undefined) {
      next.skin = structuredClone(mutation.skin);
    }
    if (mutation.mechanics !== undefined) {
      next.mechanics = structuredClone(mutation.mechanics as CustomTournament['mechanics']);
    }
    if (mutation.details !== undefined) {
      next.details = structuredClone(mutation.details);
    }
    if (mutation.pricePopover !== undefined) {
      next.pricePopover = mutation.pricePopover ?? undefined;
    }
    if (mutation.hasFriendlySubscriptionTag !== undefined) {
      next.hasFriendlySubscriptionTag = mutation.hasFriendlySubscriptionTag === true;
    }
    if (mutation.summerSubscriptionOffer !== undefined) {
      next.summerSubscriptionOffer = mutation.summerSubscriptionOffer ?? undefined;
    }
    if (mutation.pricingSnapshotStatus !== undefined) {
      next.pricingSnapshotStatus = mutation.pricingSnapshotStatus ?? undefined;
    }
    if (mutation.pricingSnapshotUpdatedAt !== undefined) {
      next.pricingSnapshotUpdatedAt = mutation.pricingSnapshotUpdatedAt ?? undefined;
    }
    if (mutation.pricingSnapshotVersion !== undefined) {
      next.pricingSnapshotVersion = mutation.pricingSnapshotVersion ?? undefined;
    }

    return next;
  }
}

function createService(options: {
  persistence?: MemoryTournamentPersistence;
  sourceTournaments?: Tournament[];
} = {}): TournamentsService {
  const persistence = options.persistence ?? new MemoryTournamentPersistence();
  const sourceTournaments = options.sourceTournaments ?? [];

  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    {
      listTournaments: async () => sourceTournaments,
      findTournamentById: async (id: string) =>
        sourceTournaments.find((item) => item.id === id || item.exerciseId === id) ?? null
    } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    persistence as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never
  );
}

function assertPricePopover(value: unknown): asserts value is TournamentPricePopover {
  assert.ok(value && typeof value === 'object', 'pricePopover should be present');
  assert.ok(Array.isArray((value as TournamentPricePopover).rows), 'pricePopover.rows should be an array');
}

async function testCanonicalExerciseIdFromSource(): Promise<void> {
  const persistence = new MemoryTournamentPersistence();
  const sourceTournament = createSourceTournament({
    id: 'mongo-record-id-42',
    exerciseId: '92051094-9db6-4cfd-a400-b9ad360d0a4b'
  });
  const service = createService({
    persistence,
    sourceTournaments: [sourceTournament]
  });
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('/products/subscriptions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] })
        } as Response;
      }
      if (value.includes('/products/one-times')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] })
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${value}`);
    }) as typeof fetch;

    const created = await service.createCustomFromSource(sourceTournament.id, {});
    assert.equal(
      persistence.lastCreateMutation?.exerciseId,
      '92051094-9db6-4cfd-a400-b9ad360d0a4b'
    );
    assert.equal(created.exerciseId, '92051094-9db6-4cfd-a400-b9ad360d0a4b');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSnapshotSeparatesPromoAndCalculatesMinPrice(): Promise<void> {
  const service = createService();
  const tournament = createCustomTournament({
    details: {
      booking: {
        purchaseOptions: [
          {
            id: 'one-time-energy',
            label: 'Энергия 🎾',
            priceLabel: '5 500 ₽',
            productType: 'ONE_TIME'
          },
          {
            id: 'subscription-energy-5',
            label: 'Энергия 5',
            priceLabel: '19 800 ₽',
            productType: 'SUBSCRIPTION'
          },
          {
            id: 'subscription-summer-sport',
            label: 'Лето.Падел.Спорт',
            priceLabel: '19 800 ₽',
            productType: 'SUBSCRIPTION'
          }
        ]
      },
      sourceTournamentSnapshot: {
        id: 'mongo-exercise-1',
        exerciseId: '92051094-9db6-4cfd-a400-b9ad360d0a4b',
        source: 'VIVA'
      }
    }
  });

  const snapshot = await (service as unknown as {
    buildTournamentPricingSnapshot: (
      value: CustomTournament,
      exerciseId?: string
    ) => Promise<{
      pricePopover?: TournamentPricePopover;
      hasFriendlySubscriptionTag: boolean;
      summerSubscriptionOffer?: { id: string; label: string; value: string };
    }>;
  }).buildTournamentPricingSnapshot(tournament, tournament.exerciseId);

  assertPricePopover(snapshot.pricePopover);
  assert.equal(snapshot.pricePopover.triggerLabel, '5 500 ₽');
  assert.equal(snapshot.pricePopover.rows.length, 2);
  assert.equal(
    snapshot.pricePopover.rows.some((item) => item.id === 'subscription-summer-sport'),
    false
  );
  assert.equal(snapshot.hasFriendlySubscriptionTag, true);
  assert.deepEqual(snapshot.summerSubscriptionOffer, {
    id: 'subscription-summer-sport',
    label: 'Лето.Падел.Спорт',
    value: '19 800 ₽'
  });
}

async function testCustomPricingBuildsWithoutLiveCatalog(): Promise<void> {
  const service = createService();
  const tournament = createCustomTournament({
    skin: {
      title: 'Custom Energy Tournament',
      priceLabel: '2 500 ₽'
    },
    details: {
      booking: {
        paymentRequired: true,
        vivaWidgetId: 'iSkq6G',
        vivaExerciseId: 'exercise-custom-1',
        vivaStudioId: 'studio-1'
      },
      sourceTournamentSnapshot: {
        id: 'mongo-exercise-1',
        exerciseId: 'exercise-custom-1',
        source: 'VIVA'
      }
    },
    exerciseId: 'exercise-custom-1'
  });
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => {
      throw new Error('Viva is temporarily unavailable');
    }) as typeof fetch;

    const snapshot = await (service as unknown as {
      buildTournamentPricingSnapshot: (
        value: CustomTournament,
        exerciseId?: string
      ) => Promise<{
        source: string;
        pricePopover?: TournamentPricePopover;
        hasFriendlySubscriptionTag: boolean;
      }>;
    }).buildTournamentPricingSnapshot(tournament, tournament.exerciseId);

    assert.equal(snapshot.source, 'CUSTOM_PRICE_FALLBACK');
    assertPricePopover(snapshot.pricePopover);
    assert.equal(snapshot.pricePopover.triggerLabel, '2 500 ₽');
    assert.equal(snapshot.pricePopover.rows[0]?.label, 'Энергия 🎾');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCreateUpdateAndListUsePersistedSnapshot(): Promise<void> {
  const persistence = new MemoryTournamentPersistence();
  const sourceTournament = createSourceTournament();
  const service = createService({
    persistence,
    sourceTournaments: [sourceTournament]
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      fetchCalls += 1;
      const value = String(url);
      if (value.includes('/products/subscriptions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'subscription-energy-5',
                name: 'Энергия 5',
                priceLabel: '19 800 ₽'
              },
              {
                id: 'subscription-summer-sport',
                name: 'Лето.Падел.Спорт',
                priceLabel: '19 800 ₽'
              }
            ]
          })
        } as Response;
      }
      if (value.includes('/products/one-times')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'one-time-energy',
                name: 'Энергия 🎾',
                priceLabel: '5 500 ₽'
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${value}`);
    }) as typeof fetch;

    const created = await service.createCustomFromSource(sourceTournament.id, {});
    assert.equal(created.exerciseId, sourceTournament.exerciseId);
    assertPricePopover(created.pricePopover);
    assert.equal(created.hasFriendlySubscriptionTag, true);
    assert.deepEqual(created.summerSubscriptionOffer, {
      id: 'subscription-summer-sport',
      label: 'Лето.Падел.Спорт',
      value: '19 800 ₽'
    });
    assert.match(created.pricingSnapshotUpdatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(created.pricingSnapshotVersion, 1);

    const updated = await service.updateCustom(
      created.id,
      {
        skin: {
          title: created.skin.title,
          priceLabel: '2 500 ₽'
        }
      },
      {
        rebuildPricingSnapshot: true
      }
    );
    assert.equal(updated.pricingSnapshotStatus, 'READY');
    assertPricePopover(updated.pricePopover);
    assert.equal(updated.pricePopover.triggerLabel, '2 500 ₽');

    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('List read path should not fetch Viva pricing');
    }) as typeof fetch;

    const list = await service.findAll({ date: '2026-06-07' });
    assert.equal(fetchCalls, 0);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.exerciseId, sourceTournament.exerciseId);
    assertPricePopover(list[0]?.pricePopover);
    assert.equal(list[0]?.pricePopover.triggerLabel, '2 500 ₽');
    assert.equal(list[0]?.hasFriendlySubscriptionTag, true);
    assert.equal(list[0]?.pricingSnapshotVersion, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSoftFailAndBackfill(): Promise<void> {
  const persistence = new MemoryTournamentPersistence();
  const sourceTournament = createSourceTournament({
    startsAt: '2026-06-09T10:00:00.000Z',
    endsAt: '2026-06-09T13:00:00.000Z'
  });
  const service = createService({
    persistence,
    sourceTournaments: [sourceTournament]
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('Viva product catalog is down');
    }) as typeof fetch;

    const created = await service.createCustomFromSource(sourceTournament.id, {});
    assert.equal(created.pricingSnapshotStatus, 'MISSING');
    assert.equal(created.pricePopover, undefined);

    fetchCalls = 0;
    const listAfterFailure = await service.findAll({ date: '2026-06-09' });
    assert.equal(fetchCalls, 0);
    assert.equal(listAfterFailure[0]?.pricingSnapshotStatus, 'MISSING');

    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const value = String(url);
      if (value.includes('/products/subscriptions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'subscription-energy-5',
                name: 'Энергия 5',
                priceLabel: '19 800 ₽'
              }
            ]
          })
        } as Response;
      }
      if (value.includes('/products/one-times')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'one-time-energy',
                name: 'Энергия 🎾',
                priceLabel: '5 500 ₽'
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${value}`);
    }) as typeof fetch;

    const backfill = await service.backfillPricingSnapshots({
      now: new Date('2026-06-04T12:00:00.000Z')
    });
    assert.equal(backfill.candidatesCount, 1);
    assert.equal(backfill.readyCount, 1);
    assert.equal(backfill.missingCount, 0);

    const refreshed = await persistence.findCustomTournamentById(created.id);
    assert.ok(refreshed, 'tournament should still exist after backfill');
    assert.equal(refreshed?.pricingSnapshotStatus, 'READY');
    assertPricePopover(refreshed?.pricePopover);
    assert.equal(refreshed?.pricePopover.triggerLabel, '5 500 ₽');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  await testCanonicalExerciseIdFromSource();
  await testSnapshotSeparatesPromoAndCalculatesMinPrice();
  await testCustomPricingBuildsWithoutLiveCatalog();
  await testCreateUpdateAndListUsePersistedSnapshot();
  await testSoftFailAndBackfill();
  console.log('Tournament pricing snapshot tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
