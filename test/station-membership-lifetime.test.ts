import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
import { stationLifetimeFence, stationModerationTransition } from '../src/communities/station-membership-lifetime';
const community = () => ({ id: 'station-a', name: 'Synthetic station', communityType: 'STATION', typeSettingsRevision: 1,
  typeSettings: { stationId: 'station-a' }, members: [{ id: 'player-a', name: 'Player', role: 'MEMBER' }], pendingMembers: [], bannedMembers: [] });
test('CUP real member writer atomically preserves tombstones and fences private epoch', async () => {
  const previous = process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;
  process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = 'true';
  try {
    const service: any = Object.create(CommunitiesPersistenceService.prototype);
    let document: any = community(), last: any;
    const collection = { async updateOne(filter: any, update: any) { last = { filter, update }; document = { ...document, ...update.$set }; return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }; } };
    service.findDocumentWithSourceById = async () => ({ document, collection });
    service.toCommunity = (row: any) => row;
    for (const [i, action] of ['REMOVE','APPROVE','BAN','UNBAN'].entries()) {
      await service.manageMember('station-a', { action, member: { id: 'player-a', name: 'Player' }, actor: { id: 'admin' } });
      assert.equal(document.stationMembershipLifetime.players[0].epoch, i + 1);
      assert.equal(document.stationMembershipLifetime.players[0].state, action === 'REMOVE' ? 'REMOVED' : action === 'BAN' ? 'BANNED' : 'ACTIVE');
      const fence = last.filter.$and[1];
      if (i === 0) assert.deepEqual(fence.stationMembershipLifetime, { $exists: false });
      else assert.equal(fence['stationMembershipLifetime.revision'], i);
      assert.ok(last.update.$set.members);
    }
    const epoch = document.stationMembershipLifetime.players[0].epoch;
    await service.manageMember('station-a', { action: 'WARN', member: { id: 'player-a' }, actor: { id: 'admin' } });
    assert.equal(document.stationMembershipLifetime.players[0].epoch, epoch);
    await assert.rejects(() => service.persistDocument(document, { async updateOne() { return { acknowledged: true, matchedCount: 0 }; } }, document), /COMMUNITY_MEMBERS_CHANGED/);
    const publicService: any = Object.create(CommunitiesPersistenceService.prototype);
    publicService.inviteBaseUrl = 'https://example.test';
    assert.equal(JSON.stringify(publicService.toCommunity(document)).includes('stationMembershipLifetime'), false);
  } finally { if (previous === undefined) delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED; else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = previous; }
});
test('default off and non-STATION unchanged; adopted history stays fenced after flag disable', () => {
  const before = process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;
  delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;
  try {
    const c: any = community(); assert.equal(stationModerationTransition(c, 'REMOVE', { id: 'player-a' }), undefined);
    c.stationMembershipLifetime = { version: 1, revision: 3, players: [{ playerId: 'player-a', epoch: 3, state: 'LEFT' }] };
    assert.equal(stationModerationTransition(c, 'BAN', { id: 'player-a' })!.players[0].epoch, 4);
    assert.deepEqual(stationLifetimeFence(c), { 'stationMembershipLifetime.version': 1, 'stationMembershipLifetime.revision': 3 });
    assert.equal(stationModerationTransition({ ...community(), communityType: 'FRIENDS' }, 'REMOVE', { id: 'player-a' }), undefined);
  } finally { if (before !== undefined) process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = before; }
});
test('actual delete writer retains adopted identity across flag disable and type change', async () => {
  const prior=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;
  const service:any=Object.create(CommunitiesPersistenceService.prototype);
  let document:any=community(), writes=0, filter:any;
  service.findDocumentWithSourceById=async()=>({document,collection:{async deleteOne(query:any){writes++;filter=query;return {deletedCount:0};}}});
  try {
    process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='true';
    await assert.rejects(()=>service.deleteCommunity(document.id),/STATION_LIFETIME_REQUIRES_ARCHIVE/);
    process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='false';
    document={...document,communityType:'FRIENDS',stationMembershipLifetime:null};
    await assert.rejects(()=>service.deleteCommunity(document.id),/STATION_LIFETIME_REQUIRES_ARCHIVE/);
    assert.equal(writes,0);
    document=community();
    assert.equal(await service.deleteCommunity(document.id),false);
    assert.deepEqual(filter.$and[1],{$or:[{communityMessageOutbox:{$exists:false}},{communityMessageOutbox:{$size:0}}],stationMembershipLifetime:{$exists:false},communityType:'STATION'});
  } finally {if(prior===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=prior;}
});
