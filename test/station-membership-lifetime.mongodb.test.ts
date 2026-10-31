import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
import { stationModerationTransition } from '../src/communities/station-membership-lifetime';
const uri = process.env.STATION_MEMBERSHIP_MONGODB_TEST_URI;
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'Z6v6e6r/ph-admin' || uri !== 'mongodb://127.0.0.1:27017/?replicaSet=rs0') throw Error('STATION_MEMBERSHIP_EXISTING_CI_FIXTURE_REQUIRED');
test('physical CUP writer fences competing LK epoch, preserves permanent admin tombstone', async () => {
  const clients = [new MongoClient(uri + '&directConnection=true'), new MongoClient(uri + '&directConnection=true')];
  const name = 'phab_station_lifetime_ci_' + randomUUID().replaceAll('-', '');
  const beforeFlag = process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;
  process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = 'true';
  await Promise.all(clients.map(c => c.connect()));
  try {
    const collection = clients[0].db(name).collection('lk_communities'), other = clients[1].db(name).collection('lk_communities');
    await collection.insertOne({ id: 'station-a', name: 'Synthetic', communityType: 'STATION', typeSettingsRevision: 1, members: [{ id: 'player-a' }], pendingMembers: [], bannedMembers: [] });
    const service: any = Object.create(CommunitiesPersistenceService.prototype);
    const preimage: any = await collection.findOne({ id: 'station-a' });
    const removed = { ...preimage, members: [], stationMembershipLifetime: stationModerationTransition(preimage, 'REMOVE', { id: 'player-a' }) };
    await service.persistDocument(removed, collection, preimage);
    await assert.rejects(() => service.persistDocument({ ...preimage, members: [{ id: 'player-a' }, { id: 'foreign' }] }, other, preimage), /COMMUNITY_MEMBERS_CHANGED/);
    const current: any = await other.findOne({ id: 'station-a' });
    assert.equal(current.stationMembershipLifetime.players[0].state, 'REMOVED'); assert.equal(current.members.length, 0);
    const restored = { ...current, members: [{ id: 'player-a' }], stationMembershipLifetime: stationModerationTransition(current, 'UNBAN', { id: 'player-a' }) };
    await service.persistDocument(restored, other, current);
    assert.equal((await collection.findOne({ id: 'station-a' }))!.stationMembershipLifetime.players[0].epoch, 2);
  } finally {
    if (beforeFlag === undefined) delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED; else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = beforeFlag;
    try { await clients[0].db(name).dropDatabase(); } finally { await Promise.all(clients.map(c => c.close())); }
  }
});
