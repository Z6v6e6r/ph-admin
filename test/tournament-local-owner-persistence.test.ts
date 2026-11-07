import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

function repo() {
 const service=Object.create(TournamentsPersistenceService.prototype) as any;const filters:any[]=[];
 const collection={findOne:async()=>({id:'local',name:'Synthetic',slug:'local',participants:[],waitlist:[],details:{}}),
  findOneAndUpdate:async(q:any)=>{filters.push(q);return null;},updateOne:async(q:any)=>{filters.push(q);return {matchedCount:0};}};
 Object.assign(service,{collection:async()=>collection});return {service,filters,collection};
}
test('every legacy capacity/payment transition has permanent adopted-document absence predicate',async()=>{
 process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED='false';const {service,filters}=repo();
 await service.appendPublicWaitlistWithAdmission('local','12025550101',{}, {gender:'MIXED',updatedAt:'now'});
 await service.reservePublicJoinPayment('local',{phone:'12025550101',transactionId:'payment'});
 await service.claimPublicJoinTransactionCreate('local','attempt','12025550101','now');
 await service.recordPublicJoinTransactionProviderIdentity('local','attempt','12025550101','provider','now');
 await service.bindPublicJoinTransaction('local','attempt','12025550101','provider',{checkoutUrl:'https://example.invalid',amountMinor:1,paymentExpiresAt:'later'});
 await service.markPublicJoinPaymentPaid('local','attempt','12025550101',{});
 await service.claimPublicJoinSubscriptionBooking('local','attempt','12025550101','claim','now','later');
 await service.bindPublicJoinSubscriptionBooking('local','attempt','12025550101','booking');
 await service.appendPublicParticipantIfCapacity('local','12025550101',{});
 await service.finalizePublicJoinPayment('local','attempt','12025550101',{});
 assert.equal(filters.length,10);for(const q of filters)assert.deepEqual(q.localParticipationOperations,{$exists:false});
});
test('stale admin/LK1 roster replacement and recreate cannot overwrite adoption, even flag off',async()=>{
 process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED='false';const {service,filters,collection}=repo();
 await assert.rejects(service.updateCustomTournament('local',{participants:[]}), (e:any)=>e.getResponse().code==='TOURNAMENT_LOCAL_OWNER_REQUIRED');
 service.buildCreateDocument=async()=>({id:'local',participants:[],archived:false});
 await assert.rejects(service.restoreExistingTournamentDocument(collection,{id:'local',slug:'local'},{}),(e:any)=>e.getResponse().code==='TOURNAMENT_LOCAL_OWNER_REQUIRED');
 assert.equal(filters.length,2);for(const q of filters)assert.deepEqual(q.localParticipationOperations,{$exists:false});
});
test('unadopted metadata/roster update retains existing behavior',async()=>{
 const {service,collection}=repo();collection.updateOne=async()=>({matchedCount:1});
 const result=await service.updateCustomTournament('local',{name:'Updated'});assert.equal(result.name,'Updated');
});
