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

test('stream-adopted moderation binds current frontier and preserves same-epoch read cursor', async () => {
 const service:any=Object.create(CommunitiesPersistenceService.prototype);
 let document:any={...community(),communityMessageOutbox:{version:2,streamId:'00000000-0000-4000-8000-000000000090',revision:7,acceptedSequence:12,publishedSequence:10,intents:[]},stationMembershipLifetime:{version:2,streamId:'00000000-0000-4000-8000-000000000090',revision:4,players:[{playerId:'player-a',epoch:2,state:'ACTIVE',readPosition:{streamId:'00000000-0000-4000-8000-000000000090',baselineSequence:3,readThroughSequence:6}}]}};
 let filter:any,set:any;
 const collection={async updateOne(f:any,u:any){filter=f;set=u.$set;document={...document,...set};return {acknowledged:true,matchedCount:1,modifiedCount:1};}};
 service.findDocumentWithSourceById=async()=>({document,collection});service.toCommunity=(row:any)=>row;
 await service.manageMember('station-a',{action:'WARN',member:{id:'player-a'},actor:{id:'admin'}});
 assert.equal(document.stationMembershipLifetime.players[0].readPosition.readThroughSequence,6);assert.equal(document.stationMembershipLifetime.players[0].epoch,2);
 assert.equal(filter.$and[1]['stationMembershipLifetime.version'],2);assert.deepEqual(filter.$and[1].communityMessageOutbox,document.communityMessageOutbox);assert.equal('communityMessageOutbox' in set,false);
 await service.manageMember('station-a',{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});
 document.communityMessageOutbox.publishedSequence=12;
 await service.manageMember('station-a',{action:'APPROVE',member:{id:'player-a'},actor:{id:'admin'}});
 assert.deepEqual(document.stationMembershipLifetime.players[0].readPosition,{streamId:document.communityMessageOutbox.streamId,baselineSequence:12,readThroughSequence:12});
 for(const mutate of [(c:any)=>delete c.stationMembershipLifetime.players[0].readPosition,(c:any)=>c.stationMembershipLifetime.version=1,(c:any)=>c.communityMessageOutbox=[]]){const c=structuredClone(document);mutate(c);assert.throws(()=>stationLifetimeFence(c));}
});

test('actual old CUP validator rejects stream lifetime floor instead of silently dropping read authority', async () => {
 const old = await import('./fixtures/station-stream/old-lifetime');
 const c:any={...community(),communityMessageOutbox:{version:2,streamId:'00000000-0000-4000-8000-000000000090',revision:0,acceptedSequence:0,publishedSequence:0,intents:[]},stationMembershipLifetime:{version:2,streamId:'00000000-0000-4000-8000-000000000090',revision:1,players:[{playerId:'player-a',epoch:0,state:'ACTIVE',readPosition:{streamId:'00000000-0000-4000-8000-000000000090',baselineSequence:0,readThroughSequence:0}}]}};
 assert.throws(()=>old.stationLifetime(c),/STATION_LIFETIME_INVALID/);assert.throws(()=>old.stationModerationTransition(c,'APPROVE',{id:'player-a'}),/STATION_LIFETIME_INVALID/);
});

const streamCommunity = () => ({ ...community(),
  communityMessageOutbox: { version: 2, streamId: '00000000-0000-4000-8000-000000000090', revision: 1, acceptedSequence: 5, publishedSequence: 5, intents: [] },
  stationMembershipLifetime: { version: 2, streamId: '00000000-0000-4000-8000-000000000090', revision: 1, players: [{ playerId: 'player-a', epoch: 2, state: 'ACTIVE', readPosition: { streamId: '00000000-0000-4000-8000-000000000090', baselineSequence: 0, readThroughSequence: 1 } }] }
});
function actualWriter(initial: any) {
  let document: any = structuredClone(initial), writes = 0, last: any;
  const service: any = Object.create(CommunitiesPersistenceService.prototype);
  const collection = { async updateOne(filter: any, update: any) { writes++; last = { filter, update }; document = { ...document, ...update.$set }; return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }; } };
  service.findDocumentWithSourceById = async () => ({ document, collection });
  service.findCommunityById = async () => document; service.toCommunity = (row: any) => row;
  return { service, collection, current: () => document, writes: () => writes, last: () => last };
}
test('actual type edit refuses lifetime v1/v2 despite disabled flag; unrelated metadata remains editable', async () => {
 const before=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='false';
 try{
  for(const c of [{...community(),stationMembershipLifetime:{version:1,revision:0,players:[]}},streamCommunity()]){
   const f=actualWriter(c),original=structuredClone(c);
   await assert.rejects(()=>f.service.updateCommunity(c.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/STATION_LIFETIME_TYPE_LOCKED/);assert.equal(f.writes(),0);
   await f.service.updateCommunity(c.id,{description:'Safe metadata'});assert.deepEqual(f.current().stationMembershipLifetime,original.stationMembershipLifetime);assert.equal(f.current().communityType,'STATION');
  }
 }finally{if(before===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=before;}
});
test('inconsistent adopted non-STATION rows and malformed markers refuse all edits/moderation, including apparent repair',async()=>{
 for(const marker of [null,undefined,{},streamCommunity().stationMembershipLifetime]){
  for(const type of ['STATION','FRIENDS']){
   if(type==='STATION'&&marker&&'version' in marker&&marker.version===2)continue;
   const c:any={...streamCommunity(),communityType:type,stationMembershipLifetime:marker},f=actualWriter(c),original=structuredClone(c);
   for(const mutation of [{name:'Safe?'},{communityType:'STATION',typeSettings:{stationId:'station-a'},expectedTypeSettingsRevision:1}])await assert.rejects(()=>f.service.updateCommunity(c.id,mutation),/STATION_(LIFETIME|STREAM)/);
   for(const action of ['REMOVE','APPROVE','BAN','UNBAN','WARN'])await assert.rejects(()=>f.service.manageMember(c.id,{action,member:{id:'player-a'},actor:{id:'admin'}}),/STATION_(LIFETIME|STREAM)/);
   assert.equal(f.writes(),0);assert.deepEqual(f.current(),original);
  }
 }
 const orphan:any={...streamCommunity()};delete orphan.stationMembershipLifetime;const f=actualWriter(orphan);await assert.rejects(()=>f.service.updateCommunity(orphan.id,{name:'Repair?'}),/STATION_LIFETIME_INVALID/);assert.equal(f.writes(),0);
});
test('ordinary unadopted type changes retain revision CAS plus exact raw type and lifetime absence',async()=>{
 for(const rawType of ['STATION','FRIENDS',null,undefined]){
  const c:any={...community(),communityType:rawType};if(rawType===undefined)delete c.communityType;
  const f=actualWriter(c),next=rawType==='STATION'?'FRIENDS':'STATION';await f.service.updateCommunity(c.id,{communityType:next,typeSettings:next==='STATION'?{stationId:'station-a'}:{},expectedTypeSettingsRevision:1});
  assert.deepEqual(f.last().filter.$and[2],{stationMembershipLifetime:{$exists:false},communityType:rawType===undefined?{$exists:false}:{$eq:rawType,$exists:true}});assert.equal(f.current().communityType,next);assert.equal(f.current().typeSettingsRevision,2);
 }
});
test('actual stale type and flag-off moderation writers fail on adoption or unacknowledged mutation',async()=>{
 const before=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='false';
 try{
  const original:any=community(),service:any=Object.create(CommunitiesPersistenceService.prototype);let seen:any;
  const collection={async updateOne(filter:any){seen=filter;return {acknowledged:true,matchedCount:0,modifiedCount:0};}};
  service.findDocumentWithSourceById=async()=>({document:original,collection});
  await assert.rejects(()=>service.updateCommunity(original.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/COMMUNITY_POLICY_REVISION_CONFLICT/);assert.deepEqual(seen.$and[2].stationMembershipLifetime,{$exists:false});
  await assert.rejects(()=>service.manageMember(original.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}}),/COMMUNITY_MEMBERS_CHANGED/);assert.deepEqual(seen.$and[1].stationMembershipLifetime,{$exists:false});
  collection.updateOne=async()=>({acknowledged:false,matchedCount:1,modifiedCount:1});await assert.rejects(()=>service.updateCommunity(original.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/COMMUNITY_POLICY_REVISION_CONFLICT/);
 }finally{if(before===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=before;}
});
test('actual REMOVE/APPROVE cannot cross mutable-type detour and revive original queued epoch',async()=>{
 const f=actualWriter(streamCommunity()),original=f.current().stationMembershipLifetime.players[0];
 await assert.rejects(()=>f.service.updateCommunity('station-a',{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/STATION_LIFETIME_TYPE_LOCKED/);
 await f.service.manageMember('station-a',{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});await f.service.manageMember('station-a',{action:'APPROVE',member:{id:'player-a'},actor:{id:'admin'}});
 const current=f.current().stationMembershipLifetime.players[0];assert.equal(current.epoch,original.epoch+2);assert.equal(current.readPosition.baselineSequence,5);assert.notEqual(current.epoch,original.epoch);assert.equal(current.readPosition.baselineSequence>original.readPosition.baselineSequence,true);
});

test('actual first lifetime moderation and type edit retain complementary type/absence CAS predicates',async()=>{
 const previous=process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED='true';
 try{
  const c=community(),f=actualWriter(c);await f.service.manageMember(c.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});
  const filter=f.last().filter.$and[1];assert.equal(filter.communityType,'STATION');assert.deepEqual(filter.stationMembershipLifetime,{$exists:false});assert.equal(f.current().stationMembershipLifetime.version,1);
  const stale:any=Object.create(CommunitiesPersistenceService.prototype);let seen:any;
  stale.findDocumentWithSourceById=async()=>({document:c,collection:{async updateOne(q:any){seen=q;return {acknowledged:true,matchedCount:0};}}});
  await assert.rejects(()=>stale.updateCommunity(c.id,{communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:1}),/COMMUNITY_POLICY_REVISION_CONFLICT/);assert.deepEqual(seen.$and[2].stationMembershipLifetime,{$exists:false});
  // In the opposite ordering, current type no longer matches the actual moderator's pinned STATION filter.
  const changed=actualWriter({...community(),communityType:'FRIENDS',typeSettings:{},typeSettingsRevision:2});assert.equal(filter.communityType===changed.current().communityType,false);
  await changed.service.manageMember(c.id,{action:'REMOVE',member:{id:'player-a'},actor:{id:'admin'}});assert.equal(changed.current().stationMembershipLifetime,undefined);
 }finally{if(previous===undefined)delete process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED;else process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=previous;}
});
