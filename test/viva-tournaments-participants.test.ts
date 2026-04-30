import * as assert from 'node:assert/strict';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';
import { TournamentParticipant } from '../src/tournaments/tournaments.types';

interface VivaTournamentsServiceInternals {
  resolveParticipants(exercise: Record<string, unknown>): TournamentParticipant[];
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
          avatarUrl: 'https://example.com/atemasova.jpg'
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
          avatarUrl: 'https://example.com/vishnevskaya.jpg'
        }
      },
      {
        id: 'client-3',
        name: 'Евгения Чабыкина',
        phone: '+7 914 472 21 20',
        avatarUrl: 'https://example.com/chabykina.jpg'
      }
    ]
  });

  assert.deepEqual(
    participants.map((participant) => participant.name),
    ['Атемасова Татьяна', 'Вишневская Анна', 'Евгения Чабыкина']
  );
  assert.deepEqual(
    participants.map((participant) => participant.id),
    ['client-1', 'client-2', 'client-3']
  );
  assert.deepEqual(
    participants.map((participant) => participant.avatarUrl),
    [
      'https://example.com/atemasova.jpg',
      'https://example.com/vishnevskaya.jpg',
      'https://example.com/chabykina.jpg'
    ]
  );

  console.log('Viva tournament participants test passed');
}

main();
