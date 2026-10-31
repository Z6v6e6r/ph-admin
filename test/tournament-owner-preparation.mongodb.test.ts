import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

// Existing CI Mongo7 only. No ambient URI, local provisioning or silent skip.
const URI_KEY = 'TOURNAMENT_OWNER_PREPARATION_MONGODB_TEST_URI';
function fixtureUri(): string {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'Z6v6e6r/ph-admin') {
    throw new Error('TOURNAMENT_OWNER_PREPARATION_CI_ONLY');
  }
  if (process.env[URI_KEY] !== 'mongodb://127.0.0.1:27017/?replicaSet=rs0') {
    throw new Error(`${URI_KEY}_UNSAFE_OR_MISSING`);
  }
  // Never follow replica-set discovery to a different advertised host.
  return 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true';
}

const DB_PATTERN = /^phab_tournament_owner_ci_[1-9][0-9]*_[a-f0-9]{32}$/;
test('physical read projection preserves corrupt-parent types, suppresses PII and leaves owned records/indexes unchanged', async () => {
  const uri = fixtureUri();
  const name = `phab_tournament_owner_ci_${process.pid}_${randomUUID().replace(/-/g, '')}`;
  assert.match(name, DB_PATTERN);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, socketTimeoutMS: 5000,
    monitorCommands: true, writeConcern: { w: 'majority' } });
  const commands: string[] = [];
  let reading = false;
  client.on('commandStarted', (event) => { if (reading) commands.push(event.commandName); });
  await client.connect();
  const db = client.db(name);
  try {
    const collection = db.collection('custom_tournaments');
    const parents = [
      { id: 'missing', expected: ['missing', 'missing', 'missing', 'missing', 'missing'] },
      { id: 'null', details: null, expected: ['null', 'missing', 'missing', 'missing', 'missing'] },
      { id: 'details-bool', details: false, expected: ['bool', 'missing', 'missing', 'missing', 'missing'] },
      { id: 'booking-bool', details: { booking: false }, expected: ['object', 'bool', 'missing', 'missing', 'missing'] },
      { id: 'viva-bool', details: { booking: { viva: false } }, expected: ['object', 'object', 'bool', 'missing', 'missing'] },
      { id: 'join-bool', details: { joinFlow: false }, expected: ['object', 'missing', 'missing', 'bool', 'missing'] },
      { id: 'join-viva-bool', details: { joinFlow: { viva: false } }, expected: ['object', 'missing', 'missing', 'object', 'bool'] },
      { id: 'details-array', details: [], expected: ['array', 'array', 'array', 'array', 'array'] },
      { id: 'valid', details: { booking: { vivaExerciseId: 'exercise-1', viva: { exerciseId: 'exercise-1',
        clientId: 'synthetic-private-client' }, phone: 'synthetic-private-phone' } },
        expected: ['object', 'object', 'object', 'missing', 'missing'] }
    ];
    await collection.insertMany(parents.map(({ expected: _expected, ...row }) => ({ ...row,
      sourceTournamentId: 'source-1', exerciseId: 'exercise-1',
      participants: [{ phone: 'synthetic-private-phone' }], waitlist: [{ name: 'synthetic-private-person' }],
      allowedManagerPhones: ['synthetic-private-phone'], updatedBy: 'synthetic-private-actor',
      // The projection must compute types, never trust a same-name stored field.
      ownerPreparationMappingTypes: { details: 'forged-stored-value' }
    })));
    const digest = async () => createHash('sha256').update(JSON.stringify(await collection.find({}).sort({ id: 1 }).toArray())).digest('hex');
    const before = await digest(); const indexesBefore = await collection.listIndexes().toArray();
    const service = Object.create(TournamentsPersistenceService.prototype) as TournamentsPersistenceService;
    Object.assign(service, { db, mongoUri: uri, collectionName: 'custom_tournaments', indexesEnsured: false });
    reading = true;
    const rows = await service.readOwnerPreparationCustomRecords();
    reading = false;
    assert.equal(rows.length, parents.length);
    for (const expected of parents) {
      const row = rows.find((item) => item.id === expected.id)!;
      const types = row.ownerPreparationMappingTypes as Record<string, string>;
      if (expected.id === 'details-array') assert.equal(types.details, 'array');
      else assert.deepEqual(['details', 'booking', 'bookingViva', 'joinFlow', 'joinFlowViva'].map((key) => types[key]), expected.expected);
    }
    assert.ok(!JSON.stringify(rows).includes('synthetic-private-'));
    assert.ok(!JSON.stringify(rows).includes('forged-stored-value'));
    assert.equal(await digest(), before);
    assert.deepEqual(await collection.listIndexes().toArray(), indexesBefore);
    assert.deepEqual(commands, ['find']);
    assert.equal((service as unknown as { indexesEnsured: boolean }).indexesEnsured, false);
  } finally {
    reading = false;
    assert.match(db.databaseName, DB_PATTERN); assert.equal(db.databaseName, name);
    try { await db.dropDatabase(); } finally { await client.close(); }
  }
});
