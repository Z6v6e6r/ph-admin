import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { CHAT_INDEXES, TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { TournamentChatService } from '../src/tournaments/tournament-chat.service';
import { ChatActor, ChatSend, requestId } from '../src/tournaments/tournament-chat.contract';
import { publicTournamentId, LocalOperation } from '../src/tournaments/tournament-local-operation.contract';
import { actor, copy, leave, organizer, raw } from './tournament-chat.fixture';
function fixtureUri():string {
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Z6v6e6r/ph-admin')throw Error('TOURNAMENT_CHAT_CI_ONLY');
 if(process.env.TOURNAMENT_LOCAL_OWNER_MONGODB_TEST_URI!=='mongodb://127.0.0.1:27017/?replicaSet=rs0')throw Error('TOURNAMENT_CHAT_UNSAFE_URI');
 return 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&retryWrites=true&w=majority';
}
test('CI Mongo7 actual tournament chat ownership, publication and competing writer CAS',async t=>{
 const uri=fixtureUri(),name='phab_tournament_chat_'+randomUUID().replace(/-/g,'');assert.match(name,/^phab_tournament_chat_[a-f0-9]{32}$/);
 const clients=[new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}}),new MongoClient(uri,{writeConcern:{w:'majority',j:true,wtimeoutMS:5000}})];
 const db=clients[0].db(name), rows=db.collection('custom_tournaments'), docs=db.collection('tournament_chat_requests_v1');
 const repos=clients.map(c=>Object.assign(Object.create(TournamentsPersistenceService.prototype),{db:c.db(name),mongoUri:uri,collectionName:'custom_tournaments',indexesEnsured:true})) as TournamentsPersistenceService[];
 const stores=repos.map(r=>new TournamentChatPersistence(r));const services=stores.map(s=>new TournamentChatService(s));
 const input=(a:ChatActor,id:string):ChatSend=>({contractVersion:1,tournamentId:publicTournamentId(id),requestId:randomUUID(),text:'Synthetic duplicate text'});
 async function fixture(){const a=actor(),r=raw(a);r._id=new ObjectId();await rows.insertOne(r as any);return{a,r,x:input(a,r.id)};}
 async function leaveActual(r:any,a:ChatActor){const next=copy(r);leave(next,a);const operation=next.localParticipationOperations.at(-1) as LocalOperation;
  assert.ok(await repos[1].commitLocalParticipation(r,operation,next.participants));}
 try{
  await Promise.all(clients.map(c=>c.connect()));
  // Only disposable owned fixture setup. Production/startup never executes these declarations.
  await db.createCollection('custom_tournaments');await db.createCollection('tournament_chat_requests_v1');
  for(const [collection,indexes] of [[rows,CHAT_INDEXES.tournaments],[docs,CHAT_INDEXES.requests]] as const)
   for(const i of indexes){const {key,...options}=i;await collection.createIndex(key as any,options as any);}
  await t.test('independent concurrent first sends share one adopted stream and one original receipt',async()=>{
   const f=await fixture();const results=await Promise.allSettled(services.map(s=>s.send(f.a,f.x)));
   assert.ok(results.some(r=>r.status==='fulfilled'));
   for(let i=0;i<3;i++)await services[0].recoverOne(f.x.tournamentId);
   const stored=await rows.findOne({_id:f.r._id});assert.equal(stored!.tournamentChatV1.allocatedSequence,1);assert.equal(stored!.tournamentChatV1.publishedSequence,1);
   assert.equal(await docs.countDocuments({tournamentId:f.x.tournamentId}),1);
   const result=await services[0].status(f.a,f.x);assert.equal(result.status,'CONFIRMED');assert.deepEqual(await services[1].send(f.a,f.x),result);
   await assert.rejects(services[0].send(f.a,{...f.x,text:'Different'}));
  });
  await t.test('lost bootstrap ACK and failed candidate insertion retain the original stream',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store);
   const cas=store.cas.bind(store),insert=store.insertCandidate.bind(store);store.cas=async(...args)=>{await cas(...args);throw Error('synthetic-ACK-lost');};
   store.insertCandidate=async()=>{throw Error('synthetic-insert-failure');};await assert.rejects(service.send(f.a,f.x));
   const stream=(await rows.findOne({_id:f.r._id}))!.tournamentChatV1.streamId;
   store.insertCandidate=insert;assert.equal((await service.send(f.a,f.x)).status,'CONFIRMED');
   assert.equal((await rows.findOne({_id:f.r._id}))!.tournamentChatV1.streamId,stream);
  });
  await t.test('actual LEAVE before acceptance denies, accepted message before LEAVE still publishes',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store);
   const insert=store.insertCandidate.bind(store);store.insertCandidate=async c=>{const result=await insert(c);await leaveActual(await rows.findOne({_id:f.r._id}),f.a);return result;};
   await assert.rejects(service.send(f.a,f.x));assert.equal((await rows.findOne({_id:f.r._id}))!.tournamentChatV1.allocatedSequence,0);
   const g=await fixture(),delayed=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(delayed),publish=delayed.publish.bind(delayed);
   delayed.publish=async()=>{throw Error('synthetic-delay');};assert.equal((await s.send(g.a,g.x)).status,'UNKNOWN');
   await leaveActual(await rows.findOne({_id:g.r._id}),g.a);delayed.publish=publish;assert.equal(await s.recoverOne(g.x.tournamentId),true);
   await assert.rejects(s.status(g.a,g.x));
  });
  await t.test('organizer REVOKE and send serialize on raw document in both orders',async()=>{
   const f=await fixture();let row=(await rows.findOne({_id:f.r._id}))!;await leaveActual(row,f.a);row=(await rows.findOne({_id:f.r._id}))!;
   const next=copy(row);organizer(next,f.a);assert.ok(await repos[1].commitOrganizerAssignment(row,next.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));
   const store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store),insert=store.insertCandidate.bind(store);
   store.insertCandidate=async c=>{const result=await insert(c);const before=(await rows.findOne({_id:f.r._id}))!;const after=copy(before);organizer(after,f.a,null);assert.ok(await repos[1].commitOrganizerAssignment(before,after.tournamentOrganizerV1,null));return result;};
   await assert.rejects(service.send(f.a,f.x));assert.equal((await rows.findOne({_id:f.r._id}))!.tournamentChatV1.allocatedSequence,0);
   row=(await rows.findOne({_id:f.r._id}))!;const reassigned=copy(row);organizer(reassigned,f.a);assert.ok(await repos[1].commitOrganizerAssignment(row,reassigned.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));
   store.insertCandidate=insert;await assert.rejects(service.send(f.a,f.x));
   const publish=store.publish.bind(store);store.publish=async()=>{throw Error('synthetic-delay');};const fresh=input(f.a,f.r.id);await service.send(f.a,fresh);
   row=(await rows.findOne({_id:f.r._id}))!;const revoked=copy(row);organizer(revoked,f.a,null);assert.ok(await repos[1].commitOrganizerAssignment(row,revoked.tournamentOrganizerV1,null));
   store.publish=publish;await service.recoverOne(f.x.tournamentId);await assert.rejects(service.status(f.a,fresh));
  });
  await t.test('stored publication before frontier remains hidden; lost frontier ACK recovers exact committed state',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store),cas=store.cas.bind(store);
   store.cas=async(row,state,exp)=>{if(state.publishedSequence>0)throw Error('synthetic-before-CAS');return cas(row,state,exp);};
   assert.equal((await service.send(f.a,f.x)).status,'UNKNOWN');assert.ok((await docs.findOne({_id:requestId(f.a,f.x)} as any))!.publication);
   assert.equal((await service.history(f.a,{contractVersion:1,tournamentId:f.x.tournamentId,limit:2})).messages.length,0);
   store.cas=async(...args)=>{await cas(...args);throw Error('synthetic-after-CAS');};assert.equal(await service.recoverOne(f.x.tournamentId),true);
   assert.equal((await service.status(f.a,f.x)).status,'CONFIRMED');
  });
  await t.test('concurrent recovery between candidate read and target read cannot reaccept the same request',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store),publish=store.publish.bind(store);
   store.publish=async()=>{throw Error('synthetic-delay');};await service.send(f.a,f.x);store.publish=publish;
   const read=store.readTarget.bind(store);let calls=0;store.readTarget=async id=>{calls++;if(calls===2)await services[1].recoverOne(id);return read(id);};
   assert.equal((await service.send(f.a,f.x)).status,'CONFIRMED');const row=(await rows.findOne({_id:f.r._id}))!;
   assert.equal(row.tournamentChatV1.allocatedSequence,1);assert.equal(row.tournamentChatV1.publishedSequence,1);assert.equal(row.tournamentChatV1.pendingCount,0);
  });
  await t.test('physical history index pages duplicate bodies with unique sequences and final ACL denial',async()=>{
   const f=await fixture();for(let i=0;i<7;i++)await services[0].send(f.a,input(f.a,f.r.id));
   const q={contractVersion:1 as const,tournamentId:f.x.tournamentId,limit:2};let page=await services[0].history(f.a,q);const ids=page.messages.map(m=>m.messageId);
   while(page.nextCursor){page=await services[0].history(f.a,{...q,cursor:page.nextCursor});ids.push(...page.messages.map(m=>m.messageId));}
   assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
   const store=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(store),read=store.history.bind(store);
   store.history=async(...args)=>{const result=await read(...args);await leaveActual(await rows.findOne({_id:f.r._id}),f.a);return result;};
   await assert.rejects(s.history(f.a,q));
  });
  await t.test('pre-first-JOIN generic edit preserves chat and stale edit cannot cross bootstrap; restore cannot erase',async()=>{
   const f=await fixture();let row=await rows.findOne({_id:f.r._id});await rows.updateOne({_id:f.r._id},{$unset:{localParticipationOperations:'',localParticipationTenantKey:''},$set:{participants:[]}});
   row=await rows.findOne({_id:f.r._id});const assigned=copy(row!);organizer(assigned,f.a);await repos[1].commitOrganizerAssignment(row!,assigned.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString());
   const delayed=Object.assign(Object.create(TournamentsPersistenceService.prototype),{db:clients[1].db(name),mongoUri:uri,collectionName:'custom_tournaments',indexesEnsured:true}) as TournamentsPersistenceService;
   const originalCollection=(delayed as any).collection.bind(delayed);let raced=false;
   (delayed as any).collection=async(...args:any[])=>{const c=await originalCollection(...args);return new Proxy(c,{get(target,key){if(key==='updateOne')return async(...params:any[])=>{if(!raced){raced=true;await services[0].send(f.a,f.x);}return target.updateOne(...params);};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});};
   await assert.rejects(delayed.updateCustomTournament(f.r.id,{name:'Stale'} as any));
   const before=(await rows.findOne({_id:f.r._id}))!;await repos[0].updateCustomTournament(f.r.id,{name:'Fresh'} as any);
   assert.deepEqual((await rows.findOne({_id:f.r._id}))!.tournamentChatV1,before.tournamentChatV1);
   await assert.rejects((repos[0] as any).restoreExistingTournamentDocument(rows,before,{name:'Synthetic',tournamentType:'CUSTOM',accessLevels:[],gender:'MIXED',maxPlayers:4,participants:[],waitlist:[],allowedManagerPhones:[]}));
  });
  await t.test('Mongo clock independently refuses near-expiry adoption and missing index refuses any candidate insert',async()=>{
   const f=await fixture();const {newState}=await import('../src/tournaments/tournament-chat.contract');
   assert.equal(await stores[0].cas(f.r,newState(f.r,f.a,f.x.tournamentId),Date.now()+4000),null);
   await docs.dropIndex('tournament_chat_sequence_v1');await assert.rejects(services[0].send(f.a,f.x));assert.equal(await docs.countDocuments({tournamentId:f.x.tournamentId}),0);
   const {key,...options}=CHAT_INDEXES.requests[0];await docs.createIndex(key as any,options as any);
  });
 }finally{try{await db.dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});
