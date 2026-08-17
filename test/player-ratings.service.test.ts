import * as assert from 'node:assert/strict';
import { PlayerRatingsService } from '../src/player-ratings/player-ratings.service';
import { PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

const actor = { id: 'admin-1', login: 'chief', roles: ['SUPER_ADMIN'] as never[], stationIds: [], connectorRoutes: [] };
const state: PlayerRatingStateDocument = {
  playerKey: 'player:1', clientId: 'client-1', phoneNorm: '79990000000', name: 'Анна Тест', nameSearch: 'анна тест',
  ratingNumeric: 3.2, rating: 'C', ownership: 'CUP_CANONICAL', source: 'CUP', schemaVersion: 1,
  createdAt: '2026-07-12T10:00:00.000Z', updatedAt: '2026-07-12T10:00:00.000Z', lastEventId: 'rating_evt:old',
  lastEventAt: '2026-07-12T10:00:00.000Z', lastEventType: 'RATING_INITIAL_IMPORTED', lastSource: 'IMPORT',
  lastChangedBy: { id: 'import', name: 'Import', type: 'IMPORT' }
};

async function main(): Promise<void> {
  const events: any[] = [];
  let written: any = null;
  const repository: any = {
    connect: async () => undefined,
    close: async () => undefined,
    stateByKey: async (key: string) => key === state.playerKey ? (written?.nextState ?? state) : null,
    eventById: async (id: string) => events.find((event) => event.id === id) ?? null,
    eventByIdempotencyKey: async (key: string) => events.find((event) => event.idempotencyKey === key) ?? null,
    latestOutbox: async () => written?.outbox ?? null,
    statesByIdentity: async (identity: { clientId?: string; phoneNorm?: string }) =>
      identity.clientId === state.clientId || identity.phoneNorm === state.phoneNorm ? [state] : [],
    searchStates: async () => [written?.nextState ?? state],
    listEvents: async () => events,
    runAtomicChange: async (input: any) => { events.push(input.event); written = input; return 'ok'; },
    retryLatestFailedProjection: async () => null,
    isDuplicateKey: () => false
  };
  const service = new PlayerRatingsService(repository);

  const found = await service.search('Анна');
  assert.equal(found.items.length, 1, 'search reads canonical local state');
  assert.equal(found.items[0].ratingNumeric, 3.2);

  const canonicalLevel = await service.resolveCanonicalLevelByIdentity({
    clientId: 'client-1',
    phone: '+7 (999) 000-00-00'
  });
  assert.deepEqual(canonicalLevel, {
    playerKey: 'player:1',
    clientId: 'client-1',
    levelLabel: '3.2',
    ratingNumeric: 3.2
  });

  const missingCanonicalLevel = await service.resolveCanonicalLevelByIdentity({
    clientId: 'missing-client',
    phone: '+7 (999) 111-22-33'
  });
  assert.equal(missingCanonicalLevel, null, 'missing CUP rating remains missing');

  const changed = await service.change('player:1', {
    ratingNumeric: 3.45,
    reason: 'Уточнение после контрольной игры',
    expectedLastEventId: 'rating_evt:old',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    actor: { id: 'spoofed' }
  } as any, actor as any);
  assert.equal(events.length, 1);
  assert.equal(changed.event.actor.id, 'admin-1', 'actor comes from current user, never request body');
  assert.equal(changed.state.ratingNumeric, 3.45);
  assert.equal(written.outbox.payload.vivaNumericFieldId, 'eabfe27b-3f72-4496-9185-1a2ec6e6465e');

  const duplicate = await service.change('player:1', {
    ratingNumeric: 3.45, reason: 'Уточнение после контрольной игры', expectedLastEventId: 'rating_evt:old',
    idempotencyKey: '11111111-1111-4111-8111-111111111111'
  }, actor as any);
  assert.equal(events.length, 1, 'idempotency prevents duplicate event');
  assert.equal(duplicate.event.id, changed.event.id);

  await assert.rejects(
    () => service.change('player:1', { ratingNumeric: 3.5, reason: 'Достаточная причина', expectedLastEventId: 'rating_evt:old', idempotencyKey: '22222222-2222-4222-8222-222222222222' }, actor as any),
    (error: any) => error?.status === 409
  );
  assert.equal(events.length, 1, 'CAS conflict does not write an event');
  console.log('Player ratings service test passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
