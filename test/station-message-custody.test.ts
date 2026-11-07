import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
const document = () => ({ _id:'synthetic', id:'community', name:'Synthetic', communityType:'FRIENDS', typeSettingsRevision:1, members:[], pendingMembers:[], bannedMembers:[] });
test('delete rejects pending/malformed custody independent of community type; exact atomic empty-or-absent fence', async () => {
 const service:any=Object.create(CommunitiesPersistenceService.prototype);let row:any=document(),calls=0,filter:any;
 service.findDocumentWithSourceById=async()=>({document:row,collection:{async deleteOne(f:any){calls++;filter=f;return {deletedCount:0};}}});
 for(const outbox of [null,{},'invalid',[{id:'accepted'}]]){row={...document(),communityMessageOutbox:outbox};await assert.rejects(()=>service.deleteCommunity(row.id),/COMMUNITY_MESSAGE_CUSTODY_PENDING/);}
 assert.equal(calls,0);row={...document(),communityMessageOutbox:[]};assert.equal(await service.deleteCommunity(row.id),false);
 assert.deepEqual(filter.$or,[{communityMessageOutbox:{$exists:false}},{communityMessageOutbox:{$size:0}}]);assert.equal(filter._id,row._id);
});
test('roster persistence preserves concurrently accepted outbox and never replaces community; private details redact', async () => {
 const service:any=Object.create(CommunitiesPersistenceService.prototype),before:any={...document(),communityMessageOutbox:[]};let set:any;
 await service.persistDocument({...before,members:[{id:'player'}]}, {async updateOne(_filter:any,update:any){set=update.$set;return {matchedCount:1,acknowledged:true};}},before);
 assert.equal('communityMessageOutbox' in set,false);assert.deepEqual(set.members,[{id:'player'}]);
 service.inviteBaseUrl='https://example.test';const response=service.toCommunity({...before,communityMessageOutbox:[{message:{text:'private-candidate'}}]});
 assert.equal(JSON.stringify(response).includes('private-candidate'),false);assert.equal(JSON.stringify(response).includes('communityMessageOutbox'),false);
});
