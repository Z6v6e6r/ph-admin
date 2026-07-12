import * as assert from 'node:assert/strict';
import { GamesService } from '../src/games/games.service';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';

type MutableGameDoc = Record<string, unknown>;

function createAdminUser(): RequestUser {
  return {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    stationIds: [],
    connectorRoutes: []
  };
}

function createServiceWithDoc(initialDoc: MutableGameDoc): {
  service: GamesService;
  getDoc: () => MutableGameDoc;
} {
  const lkPadelHubClient = {
    async listGames() {
      return [];
    },
    async getGameById() {
      return null;
    }
  };

  const service = new GamesService(lkPadelHubClient as never);
  let currentDoc = structuredClone(initialDoc);
  const collection = {
    async findOne() {
      return structuredClone(currentDoc);
    },
    async updateOne(_filter: unknown, update: { $set?: Record<string, unknown> }) {
      currentDoc = {
        ...currentDoc,
        ...(update && update.$set ? structuredClone(update.$set) : {})
      };
      return {
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1
      };
    }
  };

  (service as unknown as { getMongoCollection: () => Promise<typeof collection> }).getMongoCollection =
    async () => collection;

  return {
    service,
    getDoc: () => structuredClone(currentDoc)
  };
}

async function testRemovePlayerFromPublication() {
  const initialDoc: MutableGameDoc = {
    _id: 'mongo-game-1',
    id: 'game-1',
    organizer: {
      name: 'Организатор',
      phone: '+7 (999) 000-00-00'
    },
    participants: [
      {
        name: 'Alice',
        phone: '+7 (999) 111-22-33',
        rating: 3.1,
        status: 'JOINED'
      },
      {
        name: 'Bob',
        phone: '+7 (999) 444-55-66',
        rating: 3.7,
        status: 'JOINED'
      }
    ],
    participantPhones: ['79991112233', '79994445566'],
    relatedPhones: ['79990000000', '79991112233', '79994445566'],
    allRelatedPhones: ['79990000000', '79991112233', '79994445566'],
    invitedPhones: ['79991112233'],
    waitlistPhones: ['79991112233'],
    booking: {
      studioName: 'Дворотека',
      roomName: 'Корт 1',
      date: '2026-07-05',
      timeFrom: '10:00',
      timeTo: '11:30'
    },
    metadata: {
      participantPhones: ['79991112233', '79994445566'],
      allRelatedPhones: ['79990000000', '79991112233', '79994445566'],
      invitedPhones: ['79991112233'],
      waitlistPhones: ['79991112233'],
      joinResponses: {
        '79991112233': {
          name: 'Alice',
          phone: '79991112233'
        },
        '79994445566': {
          name: 'Bob',
          phone: '79994445566'
        }
      },
      teamSlots: [
        {
          team: 'A',
          name: 'Alice',
          phone: '79991112233',
          rating: 3.1
        },
        {
          team: 'B',
          name: 'Bob',
          phone: '79994445566',
          rating: 3.7
        }
      ]
    }
  };

  const { service, getDoc } = createServiceWithDoc(initialDoc);
  const updated = await service.removePlayerFromPublication(
    'game-1',
    { phone: '8 (999) 111-22-33' },
    createAdminUser()
  );

  assert.deepEqual(
    updated.participantNames,
    ['Bob'],
    'public participant list should no longer include removed player'
  );

  const saved = getDoc();
  assert.deepEqual(saved.participantPhones, ['79994445566']);
  assert.deepEqual(saved.invitedPhones, []);
  assert.deepEqual(saved.waitlistPhones, []);
  assert.equal(Array.isArray(saved.participants), true);
  assert.equal((saved.participants as Array<unknown>).length, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      (saved.metadata as Record<string, unknown>).joinResponses as Record<string, unknown>,
      '79991112233'
    ),
    false
  );

  const teamSlots = ((saved.metadata as Record<string, unknown>).teamSlots ?? []) as Array<Record<string, unknown>>;
  assert.equal(teamSlots[0]?.hiddenFromPublication, true);
  assert.equal(teamSlots[0]?.name, null);
  assert.equal(teamSlots[0]?.phone, null);
  assert.deepEqual(saved.allRelatedPhones, ['79994445566', '79990000000']);
}

async function testUpdateMetadataSynchronizesPhoneMirrors() {
  const initialDoc: MutableGameDoc = {
    _id: 'mongo-game-2',
    id: 'game-2',
    organizer: {
      name: 'Организатор',
      phone: '+7 (999) 000-00-00'
    },
    participants: [],
    participantPhones: [],
    relatedPhones: [],
    allRelatedPhones: [],
    invitedPhones: [],
    waitlistPhones: [],
    booking: {
      studioName: 'Дворотека',
      roomName: 'Корт 2',
      date: '2026-07-06',
      timeFrom: '12:00',
      timeTo: '13:30'
    },
    metadata: {}
  };

  const { service, getDoc } = createServiceWithDoc(initialDoc);
  await service.updateMetadata(
    'game-2',
    {
      customLabel: 'Опубликованная игра',
      invitedPhones: ['+7 (999) 222-33-44'],
      waitlistPhones: ['89995556677'],
      teamSlots: [
        {
          team: 'A',
          name: 'Bob',
          phone: '+7 (999) 444-55-66'
        }
      ],
      joinResponses: {
        '8 (999) 777-88-99': {
          name: 'Carol',
          phone: '+7 (999) 777-88-99'
        }
      }
    },
    createAdminUser()
  );

  const saved = getDoc();
  assert.equal((saved.metadata as Record<string, unknown>).customLabel, 'Опубликованная игра');
  assert.deepEqual(saved.participantPhones, ['79994445566']);
  assert.deepEqual(saved.invitedPhones, ['+7 (999) 222-33-44']);
  assert.deepEqual(saved.waitlistPhones, ['89995556677']);
  assert.deepEqual(
    [...((saved.relatedPhones as string[]) || [])].sort(),
    ['79990000000', '79992223344', '79994445566', '79995556677', '79997778899'].sort()
  );
  assert.deepEqual(
    (saved.metadata as Record<string, unknown>).allRelatedPhones,
    saved.allRelatedPhones
  );
}

async function testHideGameFromPublicListPreservesGameLifecycle() {
  const initialDoc: MutableGameDoc = {
    _id: 'mongo-game-3',
    id: 'game-3',
    status: 'PAID',
    archived: false,
    settings: {
      isPrivate: false,
      ratingGame: true
    },
    booking: {
      studioName: 'Дворотека',
      roomName: 'Корт 3',
      bookingIds: ['booking-3']
    },
    payment: {
      paid: true,
      paymentRef: 'pay-game-3'
    },
    metadata: {
      vivaExerciseId: 'viva-game-3',
      existingValue: 'keep-me'
    }
  };

  const { service, getDoc } = createServiceWithDoc(initialDoc);
  const updated = await service.hideGameFromPublicList('game-3', createAdminUser());
  const saved = getDoc();
  const settings = saved.settings as Record<string, unknown>;
  const metadata = saved.metadata as Record<string, unknown>;
  const audit = metadata.lastManualPublicListHideBy as Record<string, unknown>;

  assert.equal(settings.isPrivate, true);
  assert.equal(settings.ratingGame, true);
  assert.equal(saved.status, 'PAID');
  assert.equal(saved.archived, false);
  assert.deepEqual(saved.booking, initialDoc.booking);
  assert.deepEqual(saved.payment, initialDoc.payment);
  assert.equal(metadata.vivaExerciseId, 'viva-game-3');
  assert.equal(metadata.existingValue, 'keep-me');
  assert.equal(metadata.lastManualPublicListHideReason, 'ADMIN_HIDE_FROM_PUBLIC_LIST');
  assert.equal(typeof metadata.lastManualPublicListHideAt, 'string');
  assert.equal(audit.id, 'admin-1');
  assert.deepEqual(audit.roles, [Role.SUPER_ADMIN]);
  assert.equal(
    ((updated.details?.settings as Record<string, unknown> | undefined) ?? {}).isPrivate,
    true
  );
}

async function testArchiveGameCommunityPublicationsPreservesGameLifecycle() {
  const initialDoc: MutableGameDoc = {
    _id: 'mongo-game-4',
    id: 'game-4',
    status: 'PAID',
    archived: false,
    settings: {
      isPrivate: false
    },
    payment: {
      paid: true,
      paymentRef: 'pay-game-4'
    },
    metadata: {
      vivaExerciseId: 'viva-game-4',
      communityAutoPublish: {
        'community-1': { feedItemId: 'feed-1' },
        'community-2': 'feed-2'
      },
      communityAutoPublishDev: {
        'community-dev': { postId: 'feed-dev' }
      },
      existingValue: 'keep-me'
    }
  };
  const { service, getDoc } = createServiceWithDoc(initialDoc);
  let receivedFilter: Record<string, unknown> | undefined;
  let receivedUpdate: Record<string, unknown> | undefined;
  const feedCollection = {
    async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
      receivedFilter = filter;
      receivedUpdate = update;
      return { modifiedCount: 3 };
    }
  };
  (service as unknown as { getCommunityFeedCollection: () => Promise<typeof feedCollection> }).getCommunityFeedCollection =
    async () => feedCollection;

  const updated = await service.archiveGameCommunityPublications('game-4', createAdminUser());
  const saved = getDoc();
  const metadata = saved.metadata as Record<string, unknown>;

  assert.equal((receivedUpdate?.$set as Record<string, unknown>).archived, true);
  assert.equal((receivedUpdate?.$set as Record<string, unknown>).status, 'ARCHIVED');
  assert.equal(Array.isArray(receivedFilter?.$or), true);
  assert.equal(JSON.stringify(receivedFilter).includes('feed-1'), true);
  assert.equal(JSON.stringify(receivedFilter).includes('viva-game-4'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'communityAutoPublish'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'communityAutoPublishDev'), false);
  assert.equal(metadata.lastManualCommunityPublicationArchiveCount, 3);
  assert.equal(metadata.lastManualCommunityPublicationArchiveReason, 'ADMIN_ARCHIVE_COMMUNITY_PUBLICATIONS');
  assert.equal(saved.status, 'PAID');
  assert.equal(saved.archived, false);
  assert.equal(metadata.existingValue, 'keep-me');
  assert.equal(updated.id, 'game-4');
}

async function main() {
  await testRemovePlayerFromPublication();
  await testUpdateMetadataSynchronizesPhoneMirrors();
  await testHideGameFromPublicListPreservesGameLifecycle();
  await testArchiveGameCommunityPublicationsPreservesGameLifecycle();
  console.log('Games publication mutations test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
