import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { commandIdentity, publicTournamentId, LocalOperation, operations } from '../src/tournaments/tournament-local-operation.contract';

function fixtureUri():string {
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Z6v6e6r/ph-admin')throw Error('TOURNAMENT_LOCAL_OWNER_CI_ONLY');
 if(process.env.TOURNAMENT_LOCAL_OWNER_MONGODB_TEST_URI!=='mongodb://127.0.0.1:27017/?replicaSet=rs0')throw Error('TOURNAMENT_LOCAL_OWNER_UNSAFE_URI');
 return 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&retryWrites=true&w=majority';
}
const tenant='synthetic-tenant',phone='12025550101';
function row(id:string) {return {id,source:'CUSTOM',slug:id,name:'Synthetic',archived:false,isPublic:true,status:'REGISTRATION',gender:'MIXED',accessLevels:[],maxPlayers:2,
 participants:[],waitlist:[],updatedAt:'2026-11-01T00:00:00.000Z',details:{booking:{enabled:false,paymentRequired:false,acceptedSubscriptions:[],purchaseOptions:[]}}};}
function operation(id:string,key:string,action:'JOIN'|'LEAVE'='JOIN',original?:string):LocalOperation {
 const command={schemaVersion:1 as const,action,tournamentId:publicTournamentId(id),date:'2026-11-02',...(original?{originalJoinOperationId:original}:{})};
 const identity=commandIdentity(tenant,'actor-A',key,command);
 return {schemaVersion:1,tenantKey:tenant,phone,...identity,command,outcome:action==='JOIN'?'REGISTERED':'LEFT',reason:action==='JOIN'?'REGISTERED':'LEFT',
 generation:action==='JOIN'?identity.operationId:original!,committedAt:new Date().toISOString(),mappingHash:'a'.repeat(64),
 eligibility:{gender:'MIXED',playerGender:null,levelLabel:null,accessLevels:[],ruleUpdatedAt:'2026-11-01T00:00:00.000Z'},audit:'TOURNAMENT_LOCAL_OPERATION_V1'};
}
const participant=(op:LocalOperation)=>({id:op.generation,name:'Synthetic',phone,paymentStatus:'UNPAID',status:'REGISTERED'});

test('CI-only actual Mongo local-owner atomicity, independent connections and legacy fences',async t=>{
 const uri=fixtureUri(),name='phab_local_owner_'+randomUUID().replace(/-/g,'');assert.match(name,/^phab_local_owner_[a-f0-9]{32}$/);
 const clients=[new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}}),new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}})];
 await Promise.all(clients.map(c=>c.connect()));const db=clients[0].db(name),collection=db.collection('custom_tournaments');
 const repos=clients.map(c=>Object.assign(Object.create(TournamentsPersistenceService.prototype),{db:c.db(name),mongoUri:uri,collectionName:'custom_tournaments',indexesEnsured:true})) as TournamentsPersistenceService[];
 try {
 await t.test('same raw preimage across two connections has one winner with atomic roster/audit receipt',async()=>{
   await collection.insertOne(row('race'));const before=await repos[0].readLocalParticipationTarget(publicTournamentId('race'));assert.ok(before);
   const a=operation('race','key-raceA'),b=operation('race','key-raceB');
   const results=await Promise.all([repos[0].commitLocalParticipation(before,a,[participant(a)]),repos[1].commitLocalParticipation(before,b,[participant(b)])]);
   assert.equal(results.filter(Boolean).length,1);const after=await collection.findOne({id:'race'});assert.ok(after);
   assert.equal(after.participants.length,1);assert.equal(after.localParticipationOperations.length,1);
   assert.equal(after.participants[0].id,after.localParticipationOperations[0].generation);assert.equal(after.localParticipationOperations[0].audit,'TOURNAMENT_LOCAL_OPERATION_V1');
 });
 await t.test('lost response durable read and stale CAS never append second receipt',async()=>{
   await collection.insertOne(row('ack'));const before=await repos[0].readLocalParticipationTarget(publicTournamentId('ack'));assert.ok(before);const op=operation('ack','key-ack01');
   await assert.rejects(async()=>{await repos[0].commitLocalParticipation(before,op,[participant(op)]);throw Error('response lost');});
   const recovered=await repos[1].readLocalParticipationTarget(publicTournamentId('ack'));assert.ok(recovered);assert.equal(operations(recovered,tenant)[0].operationId,op.operationId);
   assert.equal(await repos[1].commitLocalParticipation(before,op,[participant(op)]),null);assert.equal((await collection.findOne({id:'ack'}))?.localParticipationOperations.length,1);
 });
 await t.test('stale legacy update paused before adoption cannot erase member, even disabled',async()=>{
   await collection.insertOne(row('legacy'));const rawCollection=clients[1].db(name).collection('custom_tournaments');
   let release!:()=>void,seen!:()=>void;const reached=new Promise<void>(r=>seen=r),resume=new Promise<void>(r=>release=r);
   const proxy=new Proxy(rawCollection,{get(target,key){if(key==='findOne')return async(...args:any[])=>{const value=await (target.findOne as any)(...args);seen();await resume;return value;};const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}});
   const stale=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>proxy});
   process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED='false';const pending=stale.updateCustomTournament('legacy',{participants:[]});
   await reached;const before=await repos[0].readLocalParticipationTarget(publicTournamentId('legacy'));assert.ok(before);const op=operation('legacy','key-old01');
   await repos[0].commitLocalParticipation(before,op,[participant(op)]);release();await assert.rejects(pending,(e:any)=>e.getResponse().code==='TOURNAMENT_LOCAL_OWNER_REQUIRED');
   assert.equal((await collection.findOne({id:'legacy'}))?.participants.length,1);
   assert.equal(await repos[1].reservePublicJoinPayment('legacy',{phone:'12025550102',transactionId:'provider-payment'}),null);
 });
 await t.test('legacy write winning before adoption forces full-preimage CAS miss with no partial journal',async()=>{
   await collection.insertOne(row('old-first'));const before=await repos[0].readLocalParticipationTarget(publicTournamentId('old-first'));assert.ok(before);
   await repos[1].updateCustomTournament('old-first',{name:'Changed'});const op=operation('old-first','key-old02');
   assert.equal(await repos[0].commitLocalParticipation(before,op,[participant(op)]),null);const after=await collection.findOne({id:'old-first'});assert.ok(after);assert.equal(after.localParticipationOperations,undefined);assert.deepEqual(after.participants,[]);
 });
 await t.test('LEAVE/rejoin preserves old receipt and stale original preimage cannot remove new generation',async()=>{
   await collection.insertOne(row('rejoin'));const first=operation('rejoin','key-join1');let current=await repos[0].readLocalParticipationTarget(publicTournamentId('rejoin'));assert.ok(current);
   current=await repos[0].commitLocalParticipation(current,first,[participant(first)]);assert.ok(current);const original=current;
   const leave=operation('rejoin','key-leave','LEAVE',first.operationId);current=await repos[0].commitLocalParticipation(current,leave,[]);assert.ok(current);
   const second=operation('rejoin','key-join2');current=await repos[1].commitLocalParticipation(current,second,[participant(second)]);assert.ok(current);
   assert.equal(await repos[0].commitLocalParticipation(original,leave,[]),null);assert.equal(current.participants[0].id,second.generation);assert.deepEqual(current.localParticipationOperations[0],first);
 });
 await t.test('adopted corrupt record restore cannot recreate roster or remove permanent custody',async()=>{
   const before=await collection.findOne({id:'race'});assert.ok(before);const repo=repos[0] as any;
   repo.buildCreateDocument=async()=>({id:'race',name:'Reset',slug:'race',participants:[],waitlist:[],archived:false});
   await assert.rejects(repo.restoreExistingTournamentDocument(collection,before,{}),(e:any)=>e.getResponse().code==='TOURNAMENT_LOCAL_OWNER_REQUIRED');
   assert.deepEqual(await collection.findOne({id:'race'}),before);
 });
 assert.deepEqual((await collection.listIndexes().toArray()).map(x=>x.name),['_id_'],'private operations never create an index');
 } finally {assert.equal(db.databaseName,name);assert.match(name,/^phab_local_owner_[a-f0-9]{32}$/);try{await db.dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});
