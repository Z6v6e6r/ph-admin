import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentOrganizerService } from '../src/tournaments/tournament-organizer.service';
import { TournamentOrganizerLookupClient } from '../src/tournaments/tournament-organizer-lookup.client';
import { OrganizerCommand, OrganizerState } from '../src/tournaments/tournament-organizer.contract';
import { commandIdentity, LocalOperation, publicTournamentId } from '../src/tournaments/tournament-local-operation.contract';
import { RequestUser } from '../src/common/rbac/request-user.interface';
function fixtureUri():string {
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Z6v6e6r/ph-admin')throw Error('TOURNAMENT_ORGANIZER_CI_ONLY');
 if(process.env.TOURNAMENT_LOCAL_OWNER_MONGODB_TEST_URI!=='mongodb://127.0.0.1:27017/?replicaSet=rs0')throw Error('TOURNAMENT_ORGANIZER_UNSAFE_URI');
 return 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&retryWrites=true&w=majority';
}
const tenantId=randomUUID(),tenantKey='synthetic',selected=randomUUID();
const actor:RequestUser={id:'synthetic-staff',authSource:'token',roles:[],permissions:['tournaments:write'],stationIds:['synthetic-station'],connectorRoutes:[]};
function raw(id:string){return {id,source:'CUSTOM',slug:id,name:'Synthetic',studioId:'synthetic-station',archived:false,isPublic:true,status:'REGISTRATION',gender:'MIXED',accessLevels:[],maxPlayers:2,participants:[],waitlist:[],updatedAt:'2026-11-01T00:00:00.000Z',details:{booking:{enabled:false,paymentRequired:false,acceptedSubscriptions:[],purchaseOptions:[]}}};}
const command=(revision=0,action:'ASSIGN'|'REVOKE'='ASSIGN'):OrganizerCommand=>({contractVersion:1,operationId:randomUUID(),action,selectedUserId:action==='ASSIGN'?selected:null,expectedRevision:revision});
function localOperation(id:string):LocalOperation {const command={schemaVersion:1 as const,action:'JOIN' as const,tournamentId:publicTournamentId(id),date:'2026-11-02'};const identity=commandIdentity('provider-synthetic','synthetic-provider-client','key-'+randomUUID(),command);return {schemaVersion:1,tenantKey:'provider-synthetic',phone:'12025550101',...identity,command,outcome:'REGISTERED',reason:'REGISTERED',generation:identity.operationId,committedAt:new Date().toISOString(),mappingHash:'a'.repeat(64),eligibility:{gender:'MIXED',playerGender:null,levelLabel:null,accessLevels:[],ruleUpdatedAt:'2026-11-01T00:00:00.000Z'},audit:'TOURNAMENT_LOCAL_OPERATION_V1'};}
test('CI Mongo7 actual organizer service and writer custody',async t=>{
 const uri=fixtureUri(),name='phab_organizer_'+randomUUID().replace(/-/g,'');assert.match(name,/^phab_organizer_[a-f0-9]{32}$/);
 const clients=[new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}}),new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}})];
 const collection=clients[0].db(name).collection('custom_tournaments');
 const repos=clients.map(c=>Object.assign(Object.create(TournamentsPersistenceService.prototype),{db:c.db(name),mongoUri:uri,collectionName:'custom_tournaments',indexesEnsured:true})) as TournamentsPersistenceService[];
 const scope=Object.create(TournamentsService.prototype) as TournamentsService;
 const lookup={config:{enabled:true,tenantId,tenantKey,expectedOwnerTenantKey:'provider-synthetic'},lookup:async(input:any)=>({profile:{userId:input.selectedUserId,displayName:'Synthetic'},ownerTenantKey:'provider-synthetic',expiresAt:new Date(Date.now()+30000).toISOString()})};
 const service=(repo:TournamentsPersistenceService,client=lookup)=>new TournamentOrganizerService(repo,scope,client as unknown as TournamentOrganizerLookupClient);
 const send=(s:TournamentOrganizerService,id:string,c:OrganizerCommand)=>s.command(id,c,c.operationId,actor,randomUUID());
 try{
 await Promise.all(clients.map(c=>c.connect()));
 await t.test('concurrent assignments have one permanent winner; exact old replay after revoke remains historical',async()=>{
  const id='assign-race';await collection.insertOne(raw(id));const a=command(),b=command();
  const results=await Promise.all([send(service(repos[0]),id,a),send(service(repos[1]),id,b)]);assert.equal(results.filter(r=>r.operation?.outcome==='ASSIGNED').length,1);
  const state=(await collection.findOne({id}))!.tournamentOrganizerV1 as OrganizerState;const winner=state.operations.find(r=>r.outcome==='ASSIGNED')!;
  await send(service(repos[0]),id,command(1,'REVOKE'));const replay=await send(service(repos[1]),id,winner.command);assert.equal(replay.current.selectedUserId,null);assert.equal(replay.operation?.resultingSelectedUserId,selected);
 });
 await t.test('same key with different selected profiles commits at most one body',async()=>{
  const id='same-key';await collection.insertOne(raw(id));const c=command();const result=await Promise.allSettled([send(service(repos[0]),id,c),send(service(repos[1]),id,{...c,selectedUserId:randomUUID()})]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal((await repos[0].readOrganizerTarget(id))!.tournamentOrganizerV1.operations.length,1);
 });
 await t.test('lost ACK followed by exact GET proves commit; CAS0 before any write stays UNKNOWN',async()=>{
  const id='ack';await collection.insertOne(raw(id));const actual=repos[0].commitOrganizerAssignment.bind(repos[0]);
  const proxy=Object.create(repos[0]) as TournamentsPersistenceService;proxy.commitOrganizerAssignment=async(...args)=>{await actual(...args);throw Error('synthetic lost ACK');};
  const c=command();assert.equal((await send(service(proxy),id,c)).status,'CONFIRMED');assert.equal((await service(repos[1]).readOperation(id,c.operationId,actor)).status,'CONFIRMED');
  const id2='cas0';await collection.insertOne(raw(id2));proxy.commitOrganizerAssignment=async()=>null;
  assert.equal((await send(service(proxy),id2,command())).status,'UNKNOWN');assert.equal((await collection.findOne({id:id2}))!.tournamentOrganizerV1,undefined);
 });
 await t.test('revoke between lost assignment ACK and readback cannot resurrect the historical organizer',async()=>{
  const id='ack-revoke';await collection.insertOne(raw(id));const actual=repos[0].commitOrganizerAssignment.bind(repos[0]);
  const proxy=Object.create(repos[0]) as TournamentsPersistenceService;proxy.commitOrganizerAssignment=async(...args)=>{await actual(...args);await send(service(repos[1]),id,command(1,'REVOKE'));throw Error('lost ACK after revoke');};
  const result=await send(service(proxy),id,command());assert.equal(result.status,'CONFIRMED');assert.equal(result.operation?.resultingSelectedUserId,selected);assert.equal(result.current.selectedUserId,null);assert.equal(result.current.revision,2);
 });
 await t.test('Mongo clock independently refuses expired proof; actual full preimage CAS competes with JOIN in both orders',async()=>{
  for(const order of ['organizer','join']){const id='order-'+order;await collection.insertOne(raw(id));const before=(await repos[0].readOrganizerTarget(id))!;
   const op=localOperation(id),participant={id:op.generation,name:'Synthetic',phone:op.phone,paymentStatus:'UNPAID',status:'REGISTERED'};
   if(order==='organizer'){
    await send(service(repos[0]),id,command());assert.equal(await repos[1].commitLocalParticipation(before,op,[participant]),null);
    const after=(await repos[1].readOrganizerTarget(id))!;const custody=JSON.stringify(after.tournamentOrganizerV1);assert.ok(await repos[1].commitLocalParticipation(after,op,[participant]));assert.equal(JSON.stringify((await repos[0].readOrganizerTarget(id))!.tournamentOrganizerV1),custody);
   }else{
    assert.ok(await repos[1].commitLocalParticipation(before,op,[participant]));const state=(await send(service(repos[0]),id,command())).current;assert.equal(state.revision,1);assert.equal((await repos[0].readOrganizerTarget(id))!.participants[0].id,op.generation);
   }
   const row=(await repos[0].readOrganizerTarget(id))!;assert.equal(await repos[0].commitOrganizerAssignment(row,row.tournamentOrganizerV1,new Date(1).toISOString()),null);assert.equal(await repos[0].commitOrganizerAssignment(row,row.tournamentOrganizerV1,new Date(Date.now()+1000).toISOString()),null);
  }
 });
 await t.test('pre-first-JOIN generic update preserves exact custody; stale edit cannot cross adoption or concurrent assignment',async()=>{
  const id='generic';await collection.insertOne(raw(id));await send(service(repos[0]),id,command());const before=(await repos[0].readOrganizerTarget(id))!;
  await repos[1].updateCustomTournament(id,{name:'Synthetic edited'});const edited=(await repos[0].readOrganizerTarget(id))!;assert.deepEqual(edited.tournamentOrganizerV1,before.tournamentOrganizerV1);
  const rawCollection=clients[1].db(name).collection('custom_tournaments');let release!:()=>void,seen!:()=>void;
  const reached=new Promise<void>(r=>seen=r),resume=new Promise<void>(r=>release=r);
  const proxyCollection=new Proxy(rawCollection,{get(target,key){if(key==='findOne')return async(...args:any[])=>{const value=await (target.findOne as any)(...args);seen();await resume;return value;};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
  const stale=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>proxyCollection}) as TournamentsPersistenceService;
  const pending=stale.updateCustomTournament(id,{name:'stale'});await reached;await send(service(repos[0]),id,command(1,'REVOKE'));release();await assert.rejects(pending);assert.equal((await repos[0].readOrganizerTarget(id))!.name,'Synthetic edited');
  const beforeEdit=(await repos[0].readOrganizerTarget(id))!;await repos[1].updateCustomTournament(id,{name:'new first'});assert.equal(await repos[0].commitOrganizerAssignment(beforeEdit,beforeEdit.tournamentOrganizerV1,null),null);
 });
 await t.test('unadopted stale generic edit cannot cross first organizer adoption; restore remains fenced',async()=>{
  const id='first-adoption';await collection.insertOne(raw(id));const rawCollection=clients[1].db(name).collection('custom_tournaments');let release!:()=>void,seen!:()=>void;
  const reached=new Promise<void>(r=>seen=r),resume=new Promise<void>(r=>release=r);
  const proxyCollection=new Proxy(rawCollection,{get(target,key){if(key==='findOne')return async(...args:any[])=>{const value=await (target.findOne as any)(...args);seen();await resume;return value;};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
  const stale=Object.assign(Object.create(TournamentsPersistenceService.prototype),{collection:async()=>proxyCollection}) as TournamentsPersistenceService;
  const pending=stale.updateCustomTournament(id,{name:'stale unadopted edit'});await reached;await send(service(repos[0]),id,command());release();await assert.rejects(pending);
  const stored=(await repos[0].readOrganizerTarget(id))!;assert.equal(stored.name,'Synthetic');assert.equal(stored.tournamentOrganizerV1.revision,1);
  const reset=(repos[0] as any).restoreExistingTournamentDocument.bind(repos[0]);
  await assert.rejects(reset(collection,stored,{name:'reset',tournamentType:'AMERICANO',accessLevels:[],gender:'MIXED',maxPlayers:2,participants:[],waitlist:[],allowedManagerPhones:[]}),(e:any)=>e.getResponse?.().code==='TOURNAMENT_LOCAL_OWNER_REQUIRED');
  assert.deepEqual((await repos[0].readOrganizerTarget(id))!.tournamentOrganizerV1,stored.tournamentOrganizerV1);
 });
 await t.test('station scope changed during lookup denies acceptance/readback; public projections omit private state',async()=>{
  const id='station';await collection.insertOne(raw(id));const changing={...lookup,lookup:async(input:any)=>{await collection.updateOne({id},{$set:{studioId:'other-station'}});return lookup.lookup(input);}};
  await assert.rejects(send(service(repos[0],changing),id,command()));assert.equal((await collection.findOne({id}))!.tournamentOrganizerV1,undefined);
  const id2='projection';await collection.insertOne(raw(id2));await send(service(repos[0]),id2,command());const projected=await repos[0].findCustomTournamentById(id2);assert.ok(projected);assert.equal(JSON.stringify(projected).includes('tournamentOrganizerV1'),false);assert.equal(JSON.stringify(projected).includes('synthetic-staff'),false);
 });
 }finally{try{await clients[0].db(name).dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});
