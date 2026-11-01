import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { CHAT_INDEXES, READ_INDEX, TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { TournamentChatService } from '../src/tournaments/tournament-chat.service';
import { readState, adoptReadState } from '../src/tournaments/tournament-chat-read.contract';
import { chatState } from '../src/tournaments/tournament-chat.contract';
import { publicTournamentId } from '../src/tournaments/tournament-local-operation.contract';
import { actor, copy, leave, rejoin, organizer, raw } from './tournament-chat.fixture';
function fixtureUri(): string {
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Z6v6e6r/ph-admin')throw Error('TOURNAMENT_CHAT_CI_ONLY');
 if(process.env.TOURNAMENT_LOCAL_OWNER_MONGODB_TEST_URI!=='mongodb://127.0.0.1:27017/?replicaSet=rs0')throw Error('TOURNAMENT_CHAT_UNSAFE_URI');
 return 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true&retryWrites=true&w=majority';
}
test('CI Mongo7 tournament read positions: actual owner and independent lifecycle writers',async t=>{
 const uri=fixtureUri(),name='phab_tournament_read_'+randomUUID().replace(/-/g,'');assert.match(name,/^phab_tournament_read_[a-f0-9]{32}$/);
 const clients=[new MongoClient(uri),new MongoClient(uri)],db=clients[0].db(name),rows=db.collection('custom_tournaments'),docs=db.collection('tournament_chat_requests_v1');
 const repos=clients.map(c=>Object.assign(Object.create(TournamentsPersistenceService.prototype),{db:c.db(name),mongoUri:uri,collectionName:'custom_tournaments',indexesEnsured:true})) as TournamentsPersistenceService[];
 const stores=repos.map(r=>new TournamentChatPersistence(r)),services=stores.map(s=>new TournamentChatService(s));
 async function fixture(){const a=actor(),r=raw(a);r._id=new ObjectId();await rows.insertOne(r as any);const id=publicTournamentId(r.id);
  const message=()=>({contractVersion:1 as const,tournamentId:id,requestId:randomUUID(),text:'Synthetic'});await services[0].send(a,message());
  const position=await services[0].position(a,id);const command=(throughSequence=1)=>({contractVersion:1 as const,tournamentId:id,requestId:randomUUID(),streamId:position.streamId,witnessHash:position.witnessHash,throughSequence});
  return{a,r,id,message,command,position};}
 async function leaveActual(f:Awaited<ReturnType<typeof fixture>>){const before=(await rows.findOne({_id:f.r._id}))!,next=copy(before);leave(next,f.a);assert.ok(await repos[1].commitLocalParticipation(before,next.localParticipationOperations.at(-1),next.participants));}
 try{
  await Promise.all(clients.map(c=>c.connect()));await db.createCollection('custom_tournaments');await db.createCollection('tournament_chat_requests_v1');
  for(const [collection,indexes] of [[rows,[...CHAT_INDEXES.tournaments,READ_INDEX]],[docs,CHAT_INDEXES.requests]] as const)
   for(const i of indexes){const{key,...options}=i;await collection.createIndex(key as any,options as any);}
  await t.test('concurrent original READ and lost acceptance ACK yield one immutable result',async()=>{
   const f=await fixture(),x=f.command(),store=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(store),cas=store.casRead.bind(store);
   store.casRead=async(...args)=>{await cas(...args);throw Error('synthetic-lost-ACK');};
   await Promise.allSettled([s.advanceRead(f.a,x),services[1].advanceRead(f.a,x)]);await services[0].recoverReadOne(f.id);
   const r=await services[0].readStatus(f.a,x);assert.equal(r.status,'CONFIRMED');assert.deepEqual(await services[1].advanceRead(f.a,x),r);
   assert.equal(await docs.countDocuments({recordKind:'TOURNAMENT_CHAT_READ_V1',tournamentId:f.id}),1);
  });
  await t.test('older accepted result cannot be recomputed from a newer read position',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(store),finish=store.finishRead.bind(store),x=f.command();
   store.finishRead=async()=>{throw Error('synthetic-delay');};await s.advanceRead(f.a,x);await services[0].send(f.a,f.message());await s.advanceRead(f.a,f.command(2));
   store.finishRead=finish;await s.recoverReadOne(f.id);const old=await s.readStatus(f.a,x);assert.equal(old.status,'CONFIRMED');if(old.status==='CONFIRMED')assert.equal(old.readThroughSequence,1);
   assert.equal(readState((await rows.findOne({_id:f.r._id}))!)!.positions[0].readThroughSequence,2);
  });
  await t.test('independent cleanup after stale candidate read never reaccepts original READ',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(store),finish=store.finishRead.bind(store),x=f.command();
   store.finishRead=async()=>{throw Error('synthetic-delay');};await s.advanceRead(f.a,x);store.finishRead=finish;
   const read=store.readTarget.bind(store);let calls=0;store.readTarget=async id=>{if(++calls===2)await services[1].recoverReadOne(id);return read(id);};
   assert.equal((await s.advanceRead(f.a,x)).status,'CONFIRMED');assert.equal(readState((await rows.findOne({_id:f.r._id}))!)!.pendingCount,0);
  });
  await t.test('LEAVE before READ denies; accepted READ recovers after LEAVE without current disclosure',async()=>{
   const f=await fixture(),store=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(store),insert=store.insertReadCandidate.bind(store),x=f.command();
   store.insertReadCandidate=async c=>{const out=await insert(c);await leaveActual(f);return out;};await assert.rejects(s.advanceRead(f.a,x));
   const g=await fixture(),delay=new TournamentChatPersistence(repos[0]),gs=new TournamentChatService(delay);delay.finishRead=async()=>{throw Error('synthetic-delay');};const y=g.command();await gs.advanceRead(g.a,y);
   await leaveActual(g);assert.equal(await services[1].recoverReadOne(g.id),true);await assert.rejects(services[1].readStatus(g.a,y));
  });
  await t.test('publication versus new JOIN both orders pin causal baseline in real roster CAS',async()=>{
   for(const publishFirst of [true,false]){const f=await fixture();await leaveActual(f);
    const delay=new TournamentChatPersistence(repos[0]),s=new TournamentChatService(delay); // Organizer can author while participant is absent.
    let before=(await rows.findOne({_id:f.r._id}))!,org=copy(before);organizer(org,f.a);assert.ok(await repos[1].commitOrganizerAssignment(before,org.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));
    const publish=delay.publish.bind(delay);delay.publish=async()=>{throw Error('synthetic-delay');};await s.send(f.a,f.message());delay.publish=publish;
    if(publishFirst)await s.recoverOne(f.id);
    before=(await rows.findOne({_id:f.r._id}))!;const next=copy(before);rejoin(next,f.a);assert.ok(await repos[1].commitLocalParticipation(before,next.localParticipationOperations.at(-1),next.participants));
    if(!publishFirst)await s.recoverOne(f.id);
    const p=await services[0].position(f.a,f.id);assert.equal(p.baselineSequence,publishFirst?2:1);
   }
  });
  await t.test('publication versus ASSIGN both orders and stale full-preimage assignment cannot lose frontier',async()=>{
   for(const publishFirst of [true,false]){const f=await fixture(),store=new TournamentChatPersistence(repos[0]),service=new TournamentChatService(store),publish=store.publish.bind(store);
    store.publish=async()=>{throw Error('synthetic-delay');};await service.send(f.a,f.message());store.publish=publish;
    const stale=(await rows.findOne({_id:f.r._id}))!,oldNext=copy(stale);organizer(oldNext,f.a);
    if(publishFirst){await service.recoverOne(f.id);assert.equal(await repos[1].commitOrganizerAssignment(stale,oldNext.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()),null);}
    const before=(await rows.findOne({_id:f.r._id}))!,next=copy(before);organizer(next,f.a);assert.ok(await repos[1].commitOrganizerAssignment(before,next.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));
    if(!publishFirst)await service.recoverOne(f.id);
    const positions=readState((await rows.findOne({_id:f.r._id}))!)!.positions;assert.equal(positions.find(p=>p.witness.kind==='ORGANIZER')!.baselineSequence,publishFirst?2:1);
   }
  });
  await t.test('ASSIGN baseline and revoke/reassign invalidate old revision; malformed marker cannot prevent revoke/leave',async()=>{
   const f=await fixture();await leaveActual(f);let before=(await rows.findOne({_id:f.r._id}))!,next=copy(before);organizer(next,f.a);
   assert.ok(await repos[1].commitOrganizerAssignment(before,next.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));
   const p=await services[0].position(f.a,f.id);assert.equal(p.baselineSequence,1);
   const x={...f.command(),witnessHash:p.witnessHash};await services[0].advanceRead(f.a,x);
   before=(await rows.findOne({_id:f.r._id}))!;next=copy(before);organizer(next,f.a,null);assert.ok(await repos[1].commitOrganizerAssignment(before,next.tournamentOrganizerV1,null));
   before=(await rows.findOne({_id:f.r._id}))!;next=copy(before);organizer(next,f.a);assert.ok(await repos[1].commitOrganizerAssignment(before,next.tournamentOrganizerV1,new Date(Date.now()+30000).toISOString()));await assert.rejects(services[0].readStatus(f.a,x));
   await rows.updateOne({_id:f.r._id},{$set:{tournamentChatReadV1:null}});before=(await rows.findOne({_id:f.r._id}))!;next=copy(before);organizer(next,f.a,null);
   assert.ok(await repos[1].commitOrganizerAssignment(before,next.tournamentOrganizerV1,null));
   const g=await fixture();await rows.updateOne({_id:g.r._id},{$set:{tournamentChatReadV1:null}});await leaveActual(g);
  });
  await t.test('existing stream full adoption requires explicit plan and stale adoption cannot overwrite lifecycle',async()=>{
   const f=await fixture();await rows.updateOne({_id:f.r._id},{$unset:{tournamentChatReadV1:''}});await assert.rejects(services[0].position(f.a,f.id));
   const before=(await rows.findOne({_id:f.r._id}))!,next=adoptReadState(before,chatState(before)!,{actorUserId:f.a.userId,correlationId:f.a.correlationId});
   await leaveActual(f);assert.equal(await stores[0].casRead(before,next),null);
   const current=(await rows.findOne({_id:f.r._id}))!,plan=adoptReadState(current,chatState(current)!,{actorUserId:f.a.userId,correlationId:f.a.correlationId});assert.equal(plan.positions.length,0);assert.ok(await stores[0].casRead(current,plan));
  });
  await t.test('index readiness and Mongo freshness refuse mutation, recovery selector reads persisted count',async()=>{
   const f=await fixture(),row=(await rows.findOne({_id:f.r._id}))!,s=readState(row)!;
   assert.equal(await stores[0].casRead(row,s,Date.now()+4000),null);await rows.dropIndex(READ_INDEX.name);
   await assert.rejects(services[0].advanceRead(f.a,f.command()));assert.equal(await docs.countDocuments({recordKind:'TOURNAMENT_CHAT_READ_V1',tournamentId:f.id}),0);
   const{key,...options}=READ_INDEX;await rows.createIndex(key as any,options);await stores[0].readyReads();const pending=await stores[0].pendingReadTargets();assert.ok(pending.length<=4);assert.ok(pending.every(r=>r.tournamentChatReadV1.pendingCount>0));assert.ok(!pending.some(r=>r.id===f.r.id));
  });
 }finally{try{await db.dropDatabase();}finally{await Promise.all(clients.map(c=>c.close()));}}
});
