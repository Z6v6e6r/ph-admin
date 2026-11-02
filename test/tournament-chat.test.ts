import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CHAT_PENDING_LIMIT, chatState, currentWitness, cursorBytes, cursorInput, historyInput, sendInput } from '../src/tournaments/tournament-chat.contract';
import { fixture, leave, organizer, rejoin, copy } from './tournament-chat.fixture';

test('first-wins exact retry has same public receipt/body binding and read-only status/history', async () => {
  const f=fixture(), x=f.input(); const first=await f.service.send(f.a,x); assert.equal(first.status,'CONFIRMED');
  const stored=copy(f.store.docs.get(f.id(x))!); assert.deepEqual(await f.service.send(f.a,x),first); assert.deepEqual(f.store.docs.get(f.id(x)),stored);
  const n=f.store.writes; assert.deepEqual(await f.service.status(f.a,x),first); const h=await f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:50});
  assert.equal(h.messages.length,1); assert.equal(h.messages[0].text,x.text); assert.equal(f.store.writes,n);
  await assert.rejects(f.service.send(f.a,{...x,text:'Different'})); assert.equal(f.store.writes,n);
});
test('lost adoption ACK reuses permanent stream and failed candidate insert cannot reset it', async()=>{
 const f=fixture(),x=f.input(); f.store.lostCasAck=true; f.store.lostInsert=true;
 await assert.rejects(f.service.send(f.a,x)); const stream=f.store.row.tournamentChatV1.streamId;
 f.store.lostInsert=false; assert.equal((await f.service.send(f.a,x)).status,'CONFIRMED'); assert.equal(f.store.row.tournamentChatV1.streamId,stream);
});
test('concurrent first sends adopt one stream; same original key never duplicates acceptance',async()=>{
 const f=fixture(),x=f.input(); const out=await Promise.all([f.service.send(f.a,x),f.service.send(f.a,x)]);
 assert.ok(out.some(r=>r.status==='CONFIRMED')); assert.equal(f.store.docs.size,1); assert.equal(f.store.row.tournamentChatV1.allocatedSequence,1);
});
test('leave between candidate and acceptance denies; later rejoin cannot rebind original witness',async()=>{
 const f=fixture(),x=f.input(); f.store.afterInsert=()=>{f.store.afterInsert=undefined;leave(f.store.row,f.a);};
 await assert.rejects(f.service.send(f.a,x)); const original=copy(f.store.docs.get(f.id(x))!); rejoin(f.store.row,f.a);
 await assert.rejects(f.service.send(f.a,x)); assert.deepEqual(f.store.docs.get(f.id(x)),original);
 assert.equal((await f.service.send(f.a,f.input())).status,'CONFIRMED');
});
test('acceptance before leave remains recoverable but status/history cannot disclose',async()=>{
 const f=fixture(),x=f.input(); f.store.failPublish=true; assert.equal((await f.service.send(f.a,x)).status,'UNKNOWN');
 leave(f.store.row,f.a); f.store.failPublish=false; assert.equal(await f.service.recoverOne(x.tournamentId),true);
 await assert.rejects(f.service.status(f.a,x)); await assert.rejects(f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:2}));
});
test('organizer revision never switches after revoke/reassign; participant-first dual authority is immutable',async()=>{
 const f=fixture(); organizer(f.store.row,f.a); assert.equal(currentWitness(f.store.row,f.a,f.input().tournamentId).kind,'PARTICIPANT');
 const x=f.input(); f.store.afterInsert=()=>{ f.store.afterInsert=undefined; leave(f.store.row,f.a); };
 await assert.rejects(f.service.send(f.a,x)); assert.equal(f.store.docs.get(f.id(x))!.witness.kind,'PARTICIPANT');
 const y=f.input(); f.store.afterInsert=()=>{ f.store.afterInsert=undefined; organizer(f.store.row,f.a,null); };
 await assert.rejects(f.service.send(f.a,y)); organizer(f.store.row,f.a); await assert.rejects(f.service.send(f.a,y));
 assert.equal((await f.service.send(f.a,f.input())).status,'CONFIRMED');
});
test('delayed oldest publication keeps a contiguous hidden suffix and recovery survives archived/type change',async()=>{
 const f=fixture(); f.store.failPublish=true; const x=f.input('same'),y=f.input('same');
 await f.service.send(f.a,x);await f.service.send(f.a,y);
 assert.equal((await f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:50})).messages.length,0);
 f.store.failPublish=false; await f.service.recoverOne(x.tournamentId); assert.equal(f.store.row.tournamentChatV1.publishedSequence,1);
 assert.equal((await f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:50})).messages.length,1);
 f.store.row.archived=true; f.store.row.source='OTHER'; await f.service.recoverOne(x.tournamentId); assert.equal(f.store.row.tournamentChatV1.publishedSequence,2);
});
test('lost publication ACK does not advance frontier, exact recovery has one publication',async()=>{
 const f=fixture(),x=f.input();f.store.lostPublishAck=true;assert.equal((await f.service.send(f.a,x)).status,'UNKNOWN');
 assert.equal(f.store.row.tournamentChatV1.publishedSequence,0);f.store.lostPublishAck=false;await f.service.recoverOne(x.tournamentId);
 assert.equal((await f.service.status(f.a,x)).status,'CONFIRMED');assert.equal(f.store.docs.size,1);
});
test('fixed snapshot pagination has >2 pages and rejects foreign/rejoin/incarnation cursor',async()=>{
 const f=fixture();for(let i=0;i<7;i++)await f.service.send(f.a,f.input('duplicate body'));
 const q={contractVersion:1 as const,tournamentId:f.input().tournamentId,limit:2};let p=await f.service.history(f.a,q);const cursor=p.nextCursor!;const ids=p.messages.map(m=>m.messageId);
 await f.service.send(f.a,f.input('later'));
 while(p.nextCursor){p=await f.service.history(f.a,{...q,cursor:p.nextCursor});ids.push(...p.messages.map(m=>m.messageId));}
 assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
 await assert.rejects(f.service.history(f.a,{...q,cursor:cursorBytes({...cursorInput(cursor),actorUserId:randomUUID()})}));
 leave(f.store.row,f.a);rejoin(f.store.row,f.a);await assert.rejects(f.service.history(f.a,{...q,cursor}));
 f.store.row._id='recreated';await assert.rejects(f.service.history(f.a,q));
});
test('current ACL is checked after message reads; FINISHED permits current actors and CANCELED denies',async()=>{
 const f=fixture(),x=f.input();await f.service.send(f.a,x);f.store.row.status='FINISHED';assert.equal((await f.service.status(f.a,x)).status,'CONFIRMED');
 f.store.afterHistory=()=>leave(f.store.row,f.a);await assert.rejects(f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:3}));
 rejoin(f.store.row,f.a);f.store.row.status='CANCELED';await assert.rejects(f.service.status(f.a,x));
});
test('freshness margin and full-preimage CAS refuse concurrent revoke without accepting; no terminal absence',async()=>{
 const f=fixture(),x=f.input();await assert.rejects(f.service.send({...f.a,expiresAt:Date.now()+4000},x));assert.equal(f.store.writes,0);
 f.store.beforeCas=s=>{if(s.pendingCount){f.store.beforeCas=undefined;leave(f.store.row,f.a);}};
 await assert.rejects(f.service.send(f.a,x));assert.equal(f.store.row.tournamentChatV1.allocatedSequence,0);
 rejoin(f.store.row,f.a);const status=await f.service.status(f.a,x);assert.equal(status.status,'UNKNOWN');assert.equal('messageId' in status,false);
});
test('bounded outbox does not evict, malformed state/input fails closed',async()=>{
 const f=fixture();f.store.failPublish=true;for(let i=0;i<CHAT_PENDING_LIMIT;i++)await f.service.send(f.a,f.input());
 const before=copy(f.store.row.tournamentChatV1);await assert.rejects(f.service.send(f.a,f.input()));assert.deepEqual(f.store.row.tournamentChatV1,before);
 leave(f.store.row,f.a);assert.equal(chatState(f.store.row)!.pendingCount,CHAT_PENDING_LIMIT);
 f.store.row.tournamentChatV1.pendingCount=0;assert.throws(()=>chatState(f.store.row));
 assert.throws(()=>sendInput({...f.input(),text:'x'.repeat(8001)}));assert.throws(()=>historyInput({contractVersion:1,tournamentId:randomUUID(),limit:51}));
});
test('two distinct concurrent first intents keep one stream and explicit original retries complete both',async()=>{
 const f=fixture(),x=f.input(),y=f.input();await Promise.allSettled([f.service.send(f.a,x),f.service.send(f.a,y)]);
 await f.service.send(f.a,x);await f.service.send(f.a,y);await f.service.recoverOne(x.tournamentId);
 assert.equal(f.store.row.tournamentChatV1.allocatedSequence,2);assert.equal(f.store.row.tournamentChatV1.publishedSequence,2);
 assert.equal(new Set([...f.store.docs.values()].map(c=>c.streamId)).size,1);
});
test('phone-only roster, waitlist, and historical organizer do not authorize any mutation',async()=>{
 const f=fixture(),x=f.input();f.store.row.participants[0].id=randomUUID();await assert.rejects(f.service.send(f.a,x));assert.equal(f.store.writes,0);
 const g=fixture();leave(g.store.row,g.a);g.store.row.waitlist=[{id:randomUUID(),phone:'12025550101',status:'REGISTERED',paymentStatus:'UNPAID'}];
 organizer(g.store.row,g.a);organizer(g.store.row,g.a,null);await assert.rejects(g.service.send(g.a,g.input()));assert.equal(g.store.writes,0);
});
test('unknown and empty reads never bootstrap/create and final status ACL rejects late leave',async()=>{
 const f=fixture(),x=f.input();assert.equal((await f.service.status(f.a,x)).status,'UNKNOWN');assert.equal((await f.service.history(f.a,{contractVersion:1,tournamentId:x.tournamentId,limit:2})).streamId,null);assert.equal(f.store.writes,0);
 await f.service.send(f.a,x);const read=f.store.readRequest.bind(f.store);f.store.readRequest=async id=>{const c=await read(id);leave(f.store.row,f.a);return c;};
 await assert.rejects(f.service.status(f.a,x));
});
test('original candidate cannot adopt a recreated row or disclose a missing accepted record as rejection',async()=>{
 const f=fixture(),x=f.input();f.store.failPublish=true;await f.service.send(f.a,x);const n=f.store.writes;
 f.store.row._id='synthetic-recreated';delete f.store.row.tournamentChatV1;await assert.rejects(f.service.send(f.a,x));assert.equal(f.store.writes,n);
 const g=fixture(),y=g.input();await g.service.send(g.a,y);g.store.docs.delete(g.id(y));assert.equal((await g.service.status(g.a,y)).status,'UNKNOWN');
 await assert.rejects(g.service.history(g.a,{contractVersion:1,tournamentId:y.tournamentId,limit:2}));
});

test('recovery between initial candidate read and acceptance target cannot allocate a second sequence',async()=>{
 const f=fixture(),x=f.input();f.store.failPublish=true;await f.service.send(f.a,x);f.store.failPublish=false;
 const read=f.store.readTarget.bind(f.store);let calls=0;
 f.store.readTarget=async id=>{calls++;if(calls===2)await f.service.recoverOne(id);return read(id);};
 assert.equal((await f.service.send(f.a,x)).status,'CONFIRMED');
 assert.equal(f.store.row.tournamentChatV1.allocatedSequence,1);assert.equal(f.store.row.tournamentChatV1.publishedSequence,1);assert.equal(f.store.row.tournamentChatV1.pendingCount,0);
});
