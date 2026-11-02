import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { VivaTournamentSnapshotService } from '../src/integrations/viva/viva-tournament-snapshot.service';

function fixture(rows: Record<string, unknown>[]) {
  const calls: { query: unknown; options: Record<string, unknown>; limit?: number }[] = [];
  const collection = {
    find: (query: unknown, options: Record<string, unknown>) => {
      const call = { query, options, limit: undefined as number | undefined }; calls.push(call);
      return { limit: (limit: number) => { call.limit = limit; return { toArray: async () => rows }; } };
    },
    createIndex: () => { throw new Error('Read must not create indexes'); },
    insertOne: () => { throw new Error('Read must not insert'); },
    updateOne: () => { throw new Error('Read must not update'); }
  };
  return { calls, db: { collection: () => collection } };
}

test('canonical custom read is primary/majority, complete bounded all-record scan with no implicit indexes', async () => {
  const f = fixture([{ _id: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), sourceTournamentId: 'source' }]);
  const service = Object.create(TournamentsPersistenceService.prototype) as TournamentsPersistenceService;
  Object.assign(service, { db: f.db, mongoUri: 'configured-synthetic-only', collectionName: 'custom_tournaments', indexesEnsured: false });
  const rows = await service.readOwnerPreparationCustomRecords();
  assert.equal(rows[0]?.id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(f.calls[0]?.query, {}); assert.equal(f.calls[0]?.limit, 501);
  assert.equal(f.calls[0]?.options.readPreference, 'primary');
  assert.equal(f.calls[0]?.options.maxTimeMS, 2000);
  assert.deepEqual(f.calls[0]?.options.readConcern, { level: 'majority' });
  const projection = f.calls[0]?.options.projection as Record<string, unknown>;
  for (const field of ['participants', 'waitlist', 'allowedManagerPhones', 'createdBy', 'updatedBy']) assert.ok(!(field in projection));
  assert.deepEqual(projection.ownerPreparationMappingTypes, {
    details: { $type: '$details' }, booking: { $type: '$details.booking' },
    bookingViva: { $type: '$details.booking.viva' }, joinFlow: { $type: '$details.joinFlow' },
    joinFlowViva: { $type: '$details.joinFlow.viva' }
  });
  assert.equal((service as unknown as { indexesEnsured: boolean }).indexesEnsured, false);
});

test('dated source reader ignores memory fallback, does not refresh, and denies duplicate persisted snapshots', async () => {
  const f = fixture([]);
  const service = Object.create(VivaTournamentSnapshotService.prototype) as VivaTournamentSnapshotService;
  Object.assign(service, { db: f.db, client: {}, mongoUri: 'configured-synthetic-only',
    readModelEnabled: true, collectionName: 'viva_tournament_snapshots', snapshotKey: 'default',
    indexesEnsured: false, activeRefreshIntervalMs: 60_000, snapshot: { key: 'cached-not-authoritative' },
    refreshSnapshot: () => { throw new Error('No provider refresh'); },
    scheduleRefreshIfDue: () => { throw new Error('No scheduled refresh'); } });
  assert.equal(await service.readOwnerPreparationSnapshot(), null);
  assert.deepEqual(f.calls[0]?.query, { key: 'default' }); assert.equal(f.calls[0]?.limit, 2);
  assert.equal(f.calls[0]?.options.readPreference, 'primary');
  assert.equal(f.calls[0]?.options.maxTimeMS, 2000);
  assert.deepEqual(f.calls[0]?.options.readConcern, { level: 'majority' });
  const projection = f.calls[0]?.options.projection as Record<string, unknown>;
  assert.ok(!Object.keys(projection).some((key) => /participants\.|phone|client|trainer/.test(key)));
  assert.equal((service as unknown as { indexesEnsured: boolean }).indexesEnsured, false);
  const duplicate = fixture([{ key: 'default' }, { key: 'default' }]);
  Object.assign(service, { db: duplicate.db }); assert.equal(await service.readOwnerPreparationSnapshot(), null);
  const single = fixture([{ key: 'default', tournaments: [] }]);
  Object.assign(service, { db: single.db });
  assert.deepEqual(await service.readOwnerPreparationSnapshot(), { document: { key: 'default', tournaments: [] }, freshnessIntervalMs: 60_000 });
});

test('read errors propagate, never becoming complete empty custom records', async () => {
  const service = Object.create(TournamentsPersistenceService.prototype) as TournamentsPersistenceService;
  Object.assign(service, { mongoUri: 'configured-synthetic-only', db: { collection: () => { throw new Error('database unavailable'); } } });
  await assert.rejects(service.readOwnerPreparationCustomRecords(), /database unavailable/);
});
