import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_INDEXES, READ_INDEX, TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { fixture, copy, leave, organizer } from './tournament-chat.fixture';

test('READ readiness requires exact existing persisted selector index, never creates any index/collection',async()=>{
 const names=['tournament_chat_requests_v1','custom_tournaments'];const indexes:any={};
 indexes[names[0]]=[{name:'_id_',key:{_id:1}},...copy(CHAT_INDEXES.requests)];indexes[names[1]]=[{name:'_id_',key:{_id:1}},...copy(CHAT_INDEXES.tournaments),copy(READ_INDEX)];
 const collection=(name:string)=>({collectionName:name,listIndexes:()=>({toArray:async()=>indexes[name]})});
 const db={listCollections:({name}:any)=>({toArray:async()=>[{name,type:'collection',options:{}}]}),collection};
 const source={tournamentChatCollections:async()=>({db,requests:collection(names[0]),tournaments:collection(names[1])})};
 const store=new TournamentChatPersistence(source as unknown as TournamentsPersistenceService);await store.readyReads();
 for(const change of [(i:any)=>i.unique=true,(i:any)=>i.partialFilterExpression={x:1},(i:any)=>i.expireAfterSeconds=30,(i:any)=>i.hidden=true,(i:any)=>i.collation={locale:'en'},(i:any)=>i.key={'notPersisted.pending':1}]){
  const original=copy(indexes[names[1]][2]);change(indexes[names[1]][2]);await assert.rejects(store.readyReads());indexes[names[1]][2]=original;
 }
 indexes[names[1]].pop();await assert.rejects(store.readyReads());await store.ready();
});
test('actual terminal persistence preserves malformed read marker and publication/read positions remain in full raw CAS',async()=>{
 const f=fixture();await f.service.send(f.a,f.input());let before=copy(f.store.row);before.tournamentChatReadV1=null;
 const calls:any[]=[];const collection={findOneAndUpdate:async(q:any,u:any,o:any)=>{calls.push([q,u,o]);return before;}};
 const p=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>collection}) as TournamentsPersistenceService;
 const left=copy(before);leave(left,f.a);await p.commitLocalParticipation(before,left.localParticipationOperations.at(-1),left.participants);
 assert.deepEqual(calls[0][0].$expr,{$eq:['$$ROOT',{$literal:before}]});assert.equal('tournamentChatReadV1' in calls[0][1].$set,false);
 const org=copy(before);organizer(org,f.a);before=org;const revoked=copy(before);organizer(revoked,f.a,null);
 await p.commitOrganizerAssignment(before,revoked.tournamentOrganizerV1,null);assert.equal('tournamentChatReadV1' in calls[1][1].$set,false);
 assert.deepEqual(calls[1][0].$expr.$and[0],{$eq:['$$ROOT',{$literal:before}]});
});
test('actual generic edit keeps orphan marker under full preimage CAS and public projection never includes it',async()=>{
 const f=fixture();await f.service.send(f.a,f.input());const row=copy(f.store.row);delete row.localParticipationOperations;delete row.localParticipationTenantKey;delete row.tournamentChatV1;
 let query:any,update:any;const collection={findOne:async()=>copy(row),updateOne:async(q:any,u:any)=>{query=q;update=u;return{matchedCount:1};}};
 const p=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>collection}) as TournamentsPersistenceService;
 const publicRow=await p.updateCustomTournament(row.id,{name:'Synthetic edited'} as any);
 assert.deepEqual(query.$expr,{$eq:['$$ROOT',{$literal:row}]});assert.equal('tournamentChatReadV1' in update.$set,false);assert.ok(publicRow);assert.equal('tournamentChatReadV1' in publicRow,false);
 await assert.rejects((p as any).restoreExistingTournamentDocument({...collection,updateOne:async(q:any)=>{query=q;return{matchedCount:0};}},row,{name:'Synthetic',tournamentType:'CUSTOM',accessLevels:[],gender:'MIXED',maxPlayers:4,participants:[],waitlist:[],allowedManagerPhones:[]}));
 assert.equal(query.tournamentChatReadV1.$exists,false);
});
