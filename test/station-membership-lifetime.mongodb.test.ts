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

test('physical stream baseline races publication/read cursor and preserves outbox on admin restore', async () => {
 const clients=[new MongoClient(uri+'&directConnection=true'),new MongoClient(uri+'&directConnection=true')];
 const name='phab_station_stream_ci_'+randomUUID().replaceAll('-','');await Promise.all(clients.map(c=>c.connect()));
 try{
  const collection=clients[0].db(name).collection('lk_communities'),other=clients[1].db(name).collection('lk_communities'),streamId=randomUUID();
  await collection.insertOne({id:'station-stream',communityType:'STATION',typeSettingsRevision:1,members:[],pendingMembers:[],bannedMembers:[],communityMessageOutbox:{version:2,streamId,revision:1,acceptedSequence:2,publishedSequence:2,intents:[]},stationMembershipLifetime:{version:2,streamId,revision:1,players:[{playerId:'player-a',epoch:1,state:'REMOVED'}]}});
  const service:any=Object.create(CommunitiesPersistenceService.prototype),before:any=await collection.findOne({id:'station-stream'});
  const stale={...before,members:[{id:'player-a'}],stationMembershipLifetime:stationModerationTransition(before,'APPROVE',{id:'player-a'})};
  await other.updateOne({_id:before._id},{$set:{'communityMessageOutbox.revision':2,'communityMessageOutbox.acceptedSequence':3,'communityMessageOutbox.publishedSequence':3}});
  await assert.rejects(()=>service.persistDocument(stale,collection,before),/COMMUNITY_MEMBERS_CHANGED/);
  const fresh:any=await collection.findOne({_id:before._id});await service.persistDocument({...fresh,members:[{id:'player-a'}],stationMembershipLifetime:stationModerationTransition(fresh,'APPROVE',{id:'player-a'})},collection,fresh);
  const active:any=await other.findOne({_id:before._id});assert.deepEqual(active.stationMembershipLifetime.players[0].readPosition,{streamId,baselineSequence:3,readThroughSequence:3});assert.deepEqual(active.communityMessageOutbox,fresh.communityMessageOutbox);
  const staleWarn={...active,members:[{id:'player-a',warningsCount:1}]};
  await other.updateOne({_id:before._id},{$inc:{'stationMembershipLifetime.revision':1},$set:{'stationMembershipLifetime.players.0.readPosition.readThroughSequence':3}});
  await assert.rejects(()=>service.persistDocument(staleWarn,collection,active),/COMMUNITY_MEMBERS_CHANGED/);
  // Old v1 writer predicate cannot match the adopted v2 row.
  assert.equal((await other.updateOne({_id:before._id,'stationMembershipLifetime.version':1,'stationMembershipLifetime.revision':1},{$set:{members:[]}})).matchedCount,0);
 }finally{try{await clients[0].db(name).dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});

async function withTypeFenceFixture(run: (collection: any, other: any) => Promise<void>) {
 const clients=[new MongoClient(uri+'&directConnection=true'),new MongoClient(uri+'&directConnection=true')],name='phab_station_type_ci_'+randomUUID().replaceAll('-','');
 let connected=false;
 try{await Promise.all(clients.map(c=>c.connect()));connected=true;await run(clients[0].db(name).collection('lk_communities'),clients[1].db(name).collection('lk_communities'));}
 finally{try{if(connected)await clients[0].db(name).dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
}
const typeFenceRow=(id:string)=>({id,name:'Synthetic',communityType:'STATION',typeSettings:{stationId:'station-a'},typeSettingsRevision:1,members:[{id:'player-a'}],pendingMembers:[],bannedMembers:[]});
function adoptionFields(){
 const streamId=randomUUID();return {
  communityMessageOutbox:{version:2,streamId,revision:0,acceptedSequence:0,publishedSequence:0,intents:[]},
  stationMembershipLifetime:{version:2,streamId,revision:1,players:[{playerId:'player-a',epoch:0,state:'ACTIVE',readPosition:{streamId,baselineSequence:0,readThroughSequence:0}}]}
 };
}
// Exact complete raw BSON preimage CAS used by LK285 stationStreamAdoptionPlan;
// no adoption route or production setup is introduced by this fixture.
const adoptFixture=(other:any,before:any)=>other.updateOne({_id:before._id,$expr:{$eq:['$$ROOT',{$literal:before}]}},{$set:adoptionFields()});
test('physical actual type update versus adoption in both orders preserves permanent type/identity',async()=>{
 await withTypeFenceFixture(async(collection,other)=>{
  const service:any=Object.create(CommunitiesPersistenceService.prototype);
  await collection.insertOne(typeFenceRow('adoption-first'));const before=await collection.findOne({id:'adoption-first'});let injected=false;
  const racingCollection={async updateOne(filter:any,update:any){if(!injected){injected=true;assert.equal((await adoptFixture(other,before)).matchedCount,1);}return collection.updateOne(filter,update);}};
  service.findDocumentWithSourceById=async()=>({document:before,collection:racingCollection});service.findCommunityById=async(id:string)=>collection.findOne({id});
  await assert.rejects(()=>service.updateCommunity(before.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/COMMUNITY_POLICY_REVISION_CONFLICT/);
  const after=await other.findOne({_id:before._id});assert.equal(after.communityType,'STATION');assert.equal(after.stationMembershipLifetime.version,2);assert.equal(after.typeSettingsRevision,1);
  await collection.insertOne(typeFenceRow('type-first'));const first=await collection.findOne({id:'type-first'});service.findDocumentWithSourceById=async()=>({document:first,collection});
  await service.updateCommunity(first.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1});assert.equal((await adoptFixture(other,first)).matchedCount,0);
  const final=await other.findOne({_id:first._id});assert.equal(final.communityType,'FRIENDS');assert.equal(final.stationMembershipLifetime,undefined);assert.equal(final.typeSettingsRevision,2);
 });
});
test('physical pre-adoption flag-off moderation loses to adoption; current remove/restore cannot revive old epoch',async()=>{
 const previous=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='false';
 try{await withTypeFenceFixture(async(collection,other)=>{
  await collection.insertOne(typeFenceRow('roster-race'));const before=await collection.findOne({id:'roster-race'}),service:any=Object.create(CommunitiesPersistenceService.prototype);let injected=false;
  const racingCollection={async updateOne(filter:any,update:any){if(!injected){injected=true;assert.equal((await adoptFixture(other,before)).matchedCount,1);}return collection.updateOne(filter,update);}};
  service.findDocumentWithSourceById=async()=>({document:before,collection:racingCollection});service.toCommunity=(row:any)=>row;
  await assert.rejects(()=>service.manageMember(before.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}}),/COMMUNITY_MEMBERS_CHANGED/);
  let current=await other.findOne({_id:before._id});assert.equal(current.members.length,1);assert.equal(current.stationMembershipLifetime.players[0].epoch,0);
  // Fixture represents a subsequently published prefix, while the original queue witness stays immutable.
  await other.updateOne({_id:before._id},{$set:{'communityMessageOutbox.acceptedSequence':5,'communityMessageOutbox.publishedSequence':5}});
  const original={epoch:0,baseline:0,sequence:1};service.findDocumentWithSourceById=async()=>({document:await collection.findOne({_id:before._id}),collection});
  await assert.rejects(()=>service.updateCommunity(before.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/STATION_LIFETIME_TYPE_LOCKED/);
  await service.manageMember(before.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});await service.manageMember(before.id,{action:'APPROVE',member:{id:'player-a'},actor:{id:'admin'}});
  current=await other.findOne({_id:before._id});const player=current.stationMembershipLifetime.players[0];assert.equal(player.epoch,2);assert.equal(player.readPosition.baselineSequence,5);
  assert.equal(player.epoch===original.epoch&&player.readPosition.baselineSequence===original.baseline&&original.sequence>player.readPosition.readThroughSequence,false);
  // A historical inconsistent row is not silently repaired by current service actions.
  await other.updateOne({_id:before._id},{$set:{communityType:'FRIENDS'}});const inconsistent=await other.findOne({_id:before._id});
  await assert.rejects(()=>service.updateCommunity(before.id,{communityType:'STATION',typeSettings:{stationId:'station-a'},expectedTypeSettingsRevision:1}),/STATION_LIFETIME_TYPE_INVALID/);
  await assert.rejects(()=>service.manageMember(before.id,{action:'APPROVE',member:{id:'player-a'},actor:{id:'admin'}}),/STATION_LIFETIME_TYPE_INVALID/);assert.deepEqual(await other.findOne({_id:before._id}),inconsistent);
  await collection.insertOne(typeFenceRow('moderation-first'));const rosterFirst=await collection.findOne({id:'moderation-first'});
  service.findDocumentWithSourceById=async()=>({document:rosterFirst,collection});
  await service.manageMember(rosterFirst.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});
  assert.equal((await adoptFixture(other,rosterFirst)).matchedCount,0);assert.equal((await other.findOne({_id:rosterFirst._id})).stationMembershipLifetime,undefined);
 });}finally{if(previous===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=previous;}
});

test('physical first-v1 moderation versus actual type editor in both orders cannot create lifetime on FRIENDS',async()=>{
 const previous=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='true';
 try{await withTypeFenceFixture(async(collection,other)=>{
  const moderator:any=Object.create(CommunitiesPersistenceService.prototype),editor:any=Object.create(CommunitiesPersistenceService.prototype);
  await collection.insertOne(typeFenceRow('type-before-v1'));const original=await collection.findOne({id:'type-before-v1'});let raced=false;
  editor.findDocumentWithSourceById=async()=>({document:await other.findOne({_id:original._id}),collection:other});editor.findCommunityById=async()=>other.findOne({_id:original._id});
  moderator.findDocumentWithSourceById=async()=>({document:original,collection:{async updateOne(filter:any,update:any){if(!raced){raced=true;await editor.updateCommunity(original.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1});}return collection.updateOne(filter,update);}}});
  await assert.rejects(()=>moderator.manageMember(original.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}}),/COMMUNITY_MEMBERS_CHANGED/);
  const after=await other.findOne({_id:original._id});assert.equal(after.communityType,'FRIENDS');assert.equal(after.stationMembershipLifetime,undefined);assert.equal(after.members.length,1);
  await collection.insertOne(typeFenceRow('v1-before-type'));const first=await collection.findOne({id:'v1-before-type'});let secondRace=false;
  moderator.findDocumentWithSourceById=async()=>({document:await collection.findOne({_id:first._id}),collection});moderator.toCommunity=(row:any)=>row;
  editor.findDocumentWithSourceById=async()=>({document:first,collection:{async updateOne(filter:any,update:any){if(!secondRace){secondRace=true;await moderator.manageMember(first.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});}return other.updateOne(filter,update);}}});
  await assert.rejects(()=>editor.updateCommunity(first.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/COMMUNITY_POLICY_REVISION_CONFLICT/);
  const final=await collection.findOne({_id:first._id});assert.equal(final.communityType,'STATION');assert.equal(final.stationMembershipLifetime.version,1);assert.equal(final.stationMembershipLifetime.players[0].state,'REMOVED');assert.equal(final.stationMembershipLifetime.players[0].epoch,1);
 });}finally{if(previous===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=previous;}
});
