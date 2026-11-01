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
    process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='false';
    await collection.insertOne({id:'race-delete',communityType:'STATION',members:[],pendingMembers:[],bannedMembers:[]});
    const staleDelete=await collection.findOne({id:'race-delete'});
    await other.updateOne({id:'race-delete'},{$set:{stationMembershipLifetime:{version:1,revision:0,players:[]}}});
    service.findDocumentWithSourceById=async()=>({document:staleDelete,collection});
    assert.equal(await service.deleteCommunity('race-delete'),false);
    assert.ok(await other.findOne({id:'race-delete'}));
    service.findDocumentWithSourceById=async()=>({document:await collection.findOne({id:'race-delete'}),collection});
    await assert.rejects(()=>service.deleteCommunity('race-delete'),/STATION_LIFETIME_REQUIRES_ARCHIVE/);
  } finally {
    if (beforeFlag === undefined) delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED; else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED = beforeFlag;
    try { await clients[0].db(name).dropDatabase(); } finally { await Promise.all(clients.map(c => c.close())); }
  }
});
test('physical actual CUP delete/update retains accepted message intent across stale preimage', async () => {
 const clients=[new MongoClient(uri+'&directConnection=true'),new MongoClient(uri+'&directConnection=true')],name='phab_message_custody_ci_'+randomUUID().replaceAll('-','');
 await Promise.all(clients.map(c=>c.connect()));
 try {
  const collection=clients[0].db(name).collection('lk_communities'),other=clients[1].db(name).collection('lk_communities');
  await collection.insertOne({id:'message-race',name:'Synthetic',communityType:'FRIENDS',members:[],pendingMembers:[],bannedMembers:[],communityMessageOutbox:[]});
  const preimage:any=await collection.findOne({id:'message-race'}),intent={id:'synthetic-accepted',message:{text:'Synthetic'}};
  const service:any=Object.create(CommunitiesPersistenceService.prototype);service.deleteCommunityFeedArtifacts=async()=>{};
  service.findDocumentWithSourceById=async()=>({document:preimage,collection});
  await other.updateOne({_id:preimage._id},{$set:{communityMessageOutbox:[intent]}});
  assert.equal(await service.deleteCommunity('message-race'),false);
  await service.persistDocument({...preimage,members:[{id:'synthetic-member'}]},collection,preimage);
  assert.deepEqual((await other.findOne({_id:preimage._id}))!.communityMessageOutbox,[intent]);
  service.findDocumentWithSourceById=async()=>({document:await collection.findOne({_id:preimage._id}),collection});
  await assert.rejects(()=>service.deleteCommunity('message-race'),/COMMUNITY_MESSAGE_CUSTODY_PENDING/);
  await other.updateOne({_id:preimage._id},{$set:{communityMessageOutbox:null}});
  await assert.rejects(()=>service.deleteCommunity('message-race'),/COMMUNITY_MESSAGE_CUSTODY_PENDING/);
  await other.updateOne({_id:preimage._id},{$set:{communityMessageOutbox:[]}});
  assert.equal(await service.deleteCommunity('message-race'),true);
  // Same full-preimage predicate emitted by LK's transformed legacy send barrier.
  await collection.insertOne({id:'legacy-transition',name:'Synthetic',communityType:'FRIENDS',typeSettingsRevision:1,members:[{id:'player-a'}],pendingMembers:[],bannedMembers:[]});
  const original:any=await collection.findOne({id:'legacy-transition'});
  const acceptance=(row:any)=>[{_id:row._id,$expr:{$eq:['$$ROOT',{$literal:row}]}},{$set:{id:row.id}}] as const;
  service.findDocumentWithSourceById=async()=>({document:await collection.findOne({id:'legacy-transition'}),collection});
  service.findCommunityById=async()=>collection.findOne({id:'legacy-transition'});
  await service.updateCommunity('legacy-transition',{communityType:'STATION',typeSettings:{stationId:'station-a'},expectedTypeSettingsRevision:1});
  assert.equal((await other.updateOne(...acceptance(original))).matchedCount,0);
  await service.updateCommunity('legacy-transition',{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:2});
  const acceptedBefore:any=await collection.findOne({id:'legacy-transition'});
  const accepted=await other.updateOne(...acceptance(acceptedBefore));assert.equal(accepted.acknowledged,true);assert.equal(accepted.matchedCount,1);assert.equal(accepted.modifiedCount,0);
  await service.manageMember('legacy-transition',{action:'BAN',member:{id:'player-a'},actor:{id:'admin'}});
  assert.equal((await other.updateOne(...acceptance(acceptedBefore))).matchedCount,0);
  await service.updateCommunity('legacy-transition',{communityType:'STATION',typeSettings:{stationId:'station-a'},expectedTypeSettingsRevision:3});
  assert.equal((await collection.findOne({id:'legacy-transition'}))!.communityType,'STATION');
  const absent:any=await collection.findOne({id:'legacy-transition'});
  await other.updateOne({_id:absent._id},{$set:{visibility:null}});
  assert.equal((await other.updateOne(...acceptance(absent))).matchedCount,0);

 }finally{try{await clients[0].db(name).dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});
