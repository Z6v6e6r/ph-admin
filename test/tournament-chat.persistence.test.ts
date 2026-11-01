import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_INDEXES, TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { fixture, copy } from './tournament-chat.fixture';
import { TournamentChatRecovery } from '../src/tournaments/tournament-chat.recovery';
function readyFixture(){
 const names=['tournament_chat_requests_v1','custom_tournaments'];const indexes:any={};
 indexes[names[0]]=[{name:'_id_',key:{_id:1}},...copy(CHAT_INDEXES.requests)];indexes[names[1]]=[{name:'_id_',key:{_id:1}},...copy(CHAT_INDEXES.tournaments)];
 let calls=0; const db={listCollections:({name}:any)=>({toArray:async()=>[{name,type:'collection',options:{}}]}),collection:(name:string)=>({listIndexes:()=>({toArray:async()=>indexes[name]})})};
 const source={tournamentChatCollections:async()=>{calls++;return{db,requests:{collectionName:names[0]},tournaments:{collectionName:names[1]}}}};
 return{repo:new TournamentChatPersistence(source as unknown as TournamentsPersistenceService),indexes,names,db,get calls(){return calls;}};
}
test('readiness inspects exact existing indexes and refuses absent/TTL/partial/collation changes without provisioning',async()=>{
 const f=readyFixture();await f.repo.ready();assert.equal(f.calls,1);
 for(const change of [(i:any)=>i.unique=false,(i:any)=>i.partialFilterExpression={foo:1},(i:any)=>i.expireAfterSeconds=5,(i:any)=>i.collation={locale:'en'},(i:any)=>i.hidden=true]){
  const x=readyFixture();change(x.indexes[x.names[0]][1]);await assert.rejects(x.repo.ready());
 }
 const missing=readyFixture();missing.db.listCollections=()=>({toArray:async()=>[]});await assert.rejects(missing.repo.ready());
});
test('existing raw writer query includes permanent chat floor and generic update preserves chat preimage',async()=>{
 const f=fixture(); await f.service.send(f.a,f.input()); const row=copy(f.store.row); delete row.localParticipationOperations; delete row.localParticipationTenantKey;
 const captured:any[]=[];const collection={findOne:async()=>copy(row),updateOne:async(q:any,u:any)=>{captured.push([q,u]);return{matchedCount:1};}};
 const persistence=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>collection}) as TournamentsPersistenceService;
 // Minimal existing DTO update exercises actual whitelist + CAS query rather than a copied predicate.
 await persistence.updateCustomTournament(row.id,{name:'Edited'} as any);
 assert.deepEqual(captured[0][0].$expr,{$eq:['$$ROOT',{$literal:row}]});
 assert.equal(captured[0][0].localParticipationOperations.$exists,false);assert.equal('tournamentChatV1' in captured[0][1].$set,false);
 let restore:any;collection.updateOne=async(q:any)=>{restore=q;return{matchedCount:0};};
 await assert.rejects((persistence as any).restoreExistingTournamentDocument(collection,row,{name:'Synthetic',tournamentType:'CUSTOM',accessLevels:[],gender:'MIXED',maxPlayers:4,participants:[],waitlist:[],allowedManagerPhones:[]}));
 assert.equal(restore.tournamentChatV1.$exists,false);
});
test('recovery lifecycle does not start by default, prevents overlapping ticks, reports fixed failures',async()=>{
 const f=fixture();let resolve!:()=>void;let calls=0;const service={recoveryTick:async()=>{calls++;await new Promise<void>(r=>resolve=r);return{recovered:0,failed:0};}};
 const worker=new TournamentChatRecovery(service as any);worker.onModuleInit();assert.equal((worker as any).timer,undefined);
 const first=worker.tick();await worker.tick();assert.equal(calls,1);resolve();await first;await worker.onModuleDestroy();await worker.tick();assert.equal(calls,1);
});
