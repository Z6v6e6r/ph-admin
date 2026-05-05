import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';
import { TournamentParticipant } from '../src/tournaments/tournaments.types';

interface VivaTournamentsServiceInternals {
  resolveParticipants(exercise: Record<string, unknown>): TournamentParticipant[];
  toTournament(
    exercise: Record<string, unknown>,
    studioNames: Map<string, string | undefined>,
    trainerNames: Map<string, string | undefined>,
    trainerAvatars: Map<string, string | null | undefined>
  ): {
    id: string;
    name: string;
    exerciseTypeId?: string;
    maxPlayers?: number;
    participantsCount?: number;
    startsAt?: string;
    endsAt?: string;
    studioName?: string;
    courtName?: string;
    trainerName?: string;
    trainerAvatarUrl?: string | null;
    tournamentType?: string;
  } | null;
  unwrapRecords(payload: unknown): Record<string, unknown>[];
}

function main(): void {
  const service = new VivaTournamentsService() as unknown as VivaTournamentsServiceInternals;

  const participants = service.resolveParticipants({
    clients: [
      {
        id: 'booking-1',
        clientName: 'Евгения Чабыкина',
        avatarUrl: 'https://example.com/wrong-booking-avatar.jpg',
        client: {
          id: 'client-1',
          name: 'Атемасова Татьяна',
          phone: '+7 925 333 23 14',
          avatarUrl: 'https://example.com/atemasova.jpg',
          rating: 2.75
        }
      },
      {
        id: 'booking-2',
        clientName: 'Евгения Чабыкина',
        avatarUrl: 'https://example.com/wrong-booking-avatar.jpg',
        client: {
          id: 'client-2',
          name: 'Вишневская Анна',
          phone: '+7 915 021 11 35',
          avatarUrl: 'https://example.com/vishnevskaya.jpg',
          levelScore: '2.5'
        }
      },
      {
        id: 'client-3',
        name: 'Евгения Чабыкина',
        phone: '+7 914 472 21 20',
        avatarUrl: 'https://example.com/chabykina.jpg',
        levelLabel: 'D+',
        rating: '2.25'
      },
      {
        id: 'client-4',
        name: 'Игрок с русским полем',
        phone: '+7 900 000 00 04',
        fields: [
          {
            name: 'Уровень падел числовой',
            value: '2.90400'
          }
        ]
      },
      {
        id: 'client-5',
        name: 'Игрок со смешанным уровнем',
        phone: '+7 900 000 00 05',
        level: {
          label: 'C+',
          value: '3.50926'
        }
      }
    ]
  });

  assert.deepEqual(
    participants.map((participant) => participant.name),
    [
      'Атемасова Татьяна',
      'Вишневская Анна',
      'Евгения Чабыкина',
      'Игрок с русским полем',
      'Игрок со смешанным уровнем'
    ]
  );
  assert.deepEqual(
    participants.map((participant) => participant.id),
    ['client-1', 'client-2', 'client-3', 'client-4', 'client-5']
  );
  assert.deepEqual(
    participants.map((participant) => participant.avatarUrl),
    [
      'https://example.com/atemasova.jpg',
      'https://example.com/vishnevskaya.jpg',
      'https://example.com/chabykina.jpg',
      undefined,
      undefined
    ]
  );
  assert.deepEqual(
    participants.map((participant) => participant.levelLabel),
    ['2.75', '2.5', '2.25', '2.904', '3.509']
  );

  const nestedRecords = service.unwrapRecords({
    data: {
      content: [
        {
          id: 'booking-4',
          client: {
            id: 'client-4',
            name: 'Дворецкая Виктория',
            phone: '+7 903 711 04 40'
          }
        }
      ]
    }
  });
  assert.equal(nestedRecords.length, 1);
  assert.equal(nestedRecords[0]?.id, 'booking-4');

  const nestedParticipants = service.resolveParticipants({
    bookings: {
      content: nestedRecords
    }
  });
  assert.deepEqual(
    nestedParticipants.map((participant) => participant.name),
    ['Дворецкая Виктория']
  );

  const adminParticipants = service.resolveParticipants({
    bookings: [
      {
        id: 'admin-booking-1',
        customer: {
          id: 'admin-client-1',
          firstName: 'Евгения',
          lastName: 'Чабыкина',
          phoneNumber: '+7 914 472 21 20',
          level: {
            value: '2,75'
          }
        },
        paymentStatus: 'PAID'
      }
    ]
  });
  assert.equal(adminParticipants[0]?.id, 'admin-client-1');
  assert.equal(adminParticipants[0]?.name, 'Евгения Чабыкина');
  assert.equal(adminParticipants[0]?.phone, '79144722120');
  assert.equal(adminParticipants[0]?.levelLabel, '2.75');
  assert.equal(adminParticipants[0]?.paymentStatus, 'PAID');

  const liveShapeTournament = service.toTournament(
    {
      id: 'bf25c965-55a6-4d85-9b82-fe4695db85a0',
      direction: {
        id: 2617,
        name: 'Падел турнир от ПадлхАБ',
        description: 'Классический турнир по игре в падл'
      },
      type: {
        id: 839,
        name: 'Падел Турнир',
        color: 'yellow',
        format: 'GROUP'
      },
      timeFrom: '2026-05-08T17:00:00+03:00',
      timeTo: '2026-05-08T19:00:00+03:00',
      clientsCount: 0,
      maxClientsCount: 12,
      girlsOnly: false,
      studio: {
        id: '42c6d4df-833d-480a-bdc8-986716569884',
        name: 'Нагатинская Премиум'
      },
      room: {
        id: '12f432af-d90a-4013-9871-c0a312259e72',
        name: 'Корт №1 панорамик'
      },
      trainers: [
        {
          id: '5e9c259d-39e3-4275-8847-705ce38da9ce',
          firstName: 'Турниры',
          lastName: 'Екатерина-Ян',
          photo: 'https://example.com/trainer.jpg'
        }
      ],
      availableClientSubscriptions: [],
      availableClientOneTimes: [],
      customFields: [],
      requirements: []
    },
    new Map(),
    new Map(),
    new Map()
  );
  assert.equal(liveShapeTournament?.id, 'bf25c965-55a6-4d85-9b82-fe4695db85a0');
  assert.equal(liveShapeTournament?.name, 'Падел турнир от ПадлхАБ');
  assert.equal(liveShapeTournament?.exerciseTypeId, '839');
  assert.equal(liveShapeTournament?.tournamentType, 'Турнир');
  assert.equal(liveShapeTournament?.maxPlayers, 12);
  assert.equal(liveShapeTournament?.participantsCount, 0);
  assert.equal(liveShapeTournament?.startsAt, '2026-05-08T17:00:00+03:00');
  assert.equal(liveShapeTournament?.endsAt, '2026-05-08T19:00:00+03:00');
  assert.equal(liveShapeTournament?.studioName, 'Нагатинская Премиум');
  assert.equal(liveShapeTournament?.courtName, 'Корт №1 панорамик');
  assert.equal(liveShapeTournament?.trainerName, 'Турниры Екатерина-Ян');
  assert.equal(liveShapeTournament?.trainerAvatarUrl, 'https://example.com/trainer.jpg');

  console.log('Viva tournament participants test passed');
}

main();
