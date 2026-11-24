import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

async function main() {
  const uri = process.env.TEST_MONGODB_URI;
  assert.ok(uri);
  const url = new URL(uri);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.searchParams.get('replicaSet'), 'tournamentTask');
  const database = 'synthetic_profile_' + randomUUID().replaceAll('-', '');
  process.env.TOURNAMENTS_MONGODB_URI = uri;
  process.env.TOURNAMENTS_MONGODB_DB = database;
  const mongo = new MongoClient(uri);
  const profiles = new TournamentsPersistenceService();
  const conflict = (code: string) => (error: unknown) =>
    (error as { getResponse?: () => { code?: string } })?.getResponse?.()?.code === code;
  try {
    const initial = await profiles.readLocalPlayerGender('actor-a');
    assert.deepEqual(initial, { gender: null, version: 0 });
    const [left, right] = await Promise.all([
      profiles.writeLocalPlayerGender('actor-a', 0, 'FEMALE', 'key-a', 'payload-a'),
      profiles.writeLocalPlayerGender('actor-a', 0, 'FEMALE', 'key-a', 'payload-a')
    ]);
    assert.deepEqual(left, { gender: 'FEMALE', version: 1 });
    assert.deepEqual(right, left);
    assert.deepEqual(await profiles.readLocalPlayerGender('actor-b'), initial);
    await assert.rejects(profiles.writeLocalPlayerGender('actor-a', 1, 'MALE', 'key-a', 'forged'),
      conflict('IDEMPOTENCY_KEY_REUSED'));
    await assert.rejects(profiles.writeLocalPlayerGender('actor-a', 0, null, 'key-b', 'stale'),
      conflict('TOURNAMENT_LOCAL_PROFILE_VERSION_CONFLICT'));
    assert.deepEqual(await profiles.writeLocalPlayerGender('actor-a', 1, null, 'key-b', 'payload-b'),
      { gender: null, version: 2 });
    assert.deepEqual(await profiles.writeLocalPlayerGender('actor-a', 0, 'FEMALE', 'key-a', 'payload-a'), left);
    assert.deepEqual(await profiles.readLocalPlayerGender('actor-a'), { gender: null, version: 2 });
    const doc = await mongo.db(database).collection('tournament_local_player_gender_v1').findOne({ _id: 'actor-a' as any });
    assert.deepEqual(doc?.changes?.map(({ key, version }: { key: string; version: number }) => [key, version]),
      [['key-a', 1], ['key-b', 2]]);
    console.log('PASS profile CAS, key binding, replay and isolated audit history');
  } finally {
    await profiles.onModuleDestroy();
    await mongo.db(database).dropDatabase();
    await mongo.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
