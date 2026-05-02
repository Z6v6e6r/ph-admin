import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';
import { TournamentParticipant } from '../src/tournaments/tournaments.types';

interface VivaTournamentsServiceInternals {
  resolveParticipants(exercise: Record<string, unknown>): TournamentParticipant[];
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
    ['2.75', '2.5', 'D+', '2.904', 'C+']
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

  console.log('Viva tournament participants test passed');
}

main();
