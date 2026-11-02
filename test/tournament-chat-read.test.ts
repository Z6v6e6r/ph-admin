import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixture, copy, leave, rejoin, organizer } from './tournament-chat.fixture';
import { adoptReadState, readJoinTransition, readOrganizerTransition, readState, readRequestId } from '../src/tournaments/tournament-chat-read.contract';
import { chatState } from '../src/tournaments/tournament-chat.contract';
import { emitTournamentReadWire } from './tournament-chat-read.wire-fixture';
async function setup() { const f = fixture(); await f.service.send(f.a, f.input()); const p = await f.service.position(f.a, f.input().tournamentId);
  const command = (throughSequence = 1) => ({ contractVersion: 1 as const, tournamentId: p.tournamentId, requestId: randomUUID(), streamId: p.streamId, witnessHash: p.witnessHash, throughSequence }); return { ...f, p, command }; }
test('actual service emits private position and identical immutable confirmed/status wire', async () => {
 const emitted = await emitTournamentReadWire();
 assert.equal(emitted.wire.confirmed, emitted.wire.status);
 assert.equal(JSON.parse(emitted.wire.position).publishedSequence, 1);
 assert.equal(JSON.parse(emitted.wire.confirmed).readThroughSequence, 1);
});
test('first stream atomically adopts all current witnesses; position/status read no writes', async () => {
 const f = fixture(); organizer(f.store.row, f.a); await f.service.send(f.a, f.input()); const s = readState(f.store.row)!;
 assert.equal(s.positions.length, 2); assert.ok(s.positions.every(p => p.baselineSequence === 0)); const n=f.store.writes;
 await f.service.position(f.a,f.input().tournamentId); assert.equal((await f.service.readStatus(f.a,f.input())).status,'UNKNOWN'); assert.equal(f.store.writes,n);
});
test('immutable acceptance result survives newer READ and exact historical replay',async()=>{
 const f=await setup(),x=f.command(); f.store.failReadFinish=true; assert.equal((await f.service.advanceRead(f.a,x)).status,'UNKNOWN');
 await f.service.send(f.a,f.input()); const y=f.command(2); await f.service.advanceRead(f.a,y); assert.equal(readState(f.store.row)!.positions[0].readThroughSequence,2);
 f.store.failReadFinish=false;await f.service.recoverReadOne(x.tournamentId);const original=await f.service.readStatus(f.a,x);
 assert.equal(original.status,'CONFIRMED');if(original.status==='CONFIRMED')assert.equal(original.readThroughSequence,1);
 assert.deepEqual(await f.service.advanceRead(f.a,x),original);assert.equal(readState(f.store.row)!.positions[0].readThroughSequence,2);
 await assert.rejects(f.service.advanceRead(f.a,{...x,throughSequence:2}));
});
test('cleanup between initial candidate and captured target never accepts original twice',async()=>{
 const f=await setup(),x=f.command();f.store.failReadFinish=true;await f.service.advanceRead(f.a,x);f.store.failReadFinish=false;
 const get=f.store.readTarget.bind(f.store);let n=0;f.store.readTarget=async id=>{if(++n===2)await f.service.recoverReadOne(id);return get(id);};
 assert.equal((await f.service.advanceRead(f.a,x)).status,'CONFIRMED');assert.equal(readState(f.store.row)!.pendingCount,0);assert.equal(f.store.readDocs.size,1);
});
test('LEAVE before acceptance denies, rejoin and organizer fallback cannot rebind original',async()=>{
 const f=await setup();organizer(f.store.row,f.a);const x=f.command();f.store.afterReadInsert=()=>{f.store.afterReadInsert=undefined;leave(f.store.row,f.a);};
 await assert.rejects(f.service.advanceRead(f.a,x));const original=copy(f.store.readDocs.get(readRequestId(f.a,x)));rejoin(f.store.row,f.a);
 await assert.rejects(f.service.advanceRead(f.a,x));assert.deepEqual(f.store.readDocs.get(readRequestId(f.a,x)),original);
});
test('accepted READ recovers after LEFT but cannot disclose; final current ACL fences response',async()=>{
 const f=await setup(),x=f.command();f.store.failReadFinish=true;await f.service.advanceRead(f.a,x);leave(f.store.row,f.a);
 f.store.failReadFinish=false;assert.equal(await f.service.recoverReadOne(x.tournamentId),true);await assert.rejects(f.service.readStatus(f.a,x));
 const g=await setup(),y=g.command();await g.service.advanceRead(g.a,y);const get=g.store.readReadRequest.bind(g.store);
 g.store.readReadRequest=async id=>{const c=await get(id);leave(g.store.row,g.a);return c;};await assert.rejects(g.service.readStatus(g.a,y));
});
test('existing streams need full explicit adoption; missing marker never partially enrolls',async()=>{
 const f=await setup();delete f.store.row.tournamentChatReadV1;const before=copy(f.store.row);await assert.rejects(f.service.position(f.a,f.p.tournamentId));assert.deepEqual(f.store.row,before);
 leave(f.store.row,f.a);rejoin(f.store.row,f.a);const op=f.store.row.localParticipationOperations.at(-1);assert.equal(readJoinTransition(f.store.row,op),undefined);
 const s=adoptReadState(f.store.row,chatState(f.store.row)!, { actorUserId: f.a.userId, correlationId: f.a.correlationId });assert.equal(s.positions.length,1);assert.equal(s.positions[0].baselineSequence,1);
});
test('new JOIN/ASSIGN baseline is current publication and malformed/full marker never gates terminal removal',async()=>{
 const f=await setup();leave(f.store.row,f.a);rejoin(f.store.row,f.a);const op=f.store.row.localParticipationOperations.at(-1);
 const joined=readJoinTransition(f.store.row,op)!;assert.equal(joined.positions.at(-1)!.baselineSequence,1);
 organizer(f.store.row,f.a);const assigned=readOrganizerTransition(f.store.row,f.store.row.tournamentOrganizerV1)!;assert.equal(assigned.positions.at(-1)!.baselineSequence,1);
 f.store.row.tournamentChatReadV1=null;assert.throws(()=>readJoinTransition(f.store.row,op));assert.throws(()=>readOrganizerTransition(f.store.row,f.store.row.tournamentOrganizerV1));
 leave(f.store.row,f.a);assert.equal(readJoinTransition(f.store.row,f.store.row.localParticipationOperations.at(-1)),undefined);
 organizer(f.store.row,f.a,null);assert.equal(readOrganizerTransition(f.store.row,f.store.row.tournamentOrganizerV1),undefined);
});
test('bounds, wrong witness/stream and near-expiry fail closed with no acceptance',async()=>{
 const f=await setup(),x=f.command();await assert.rejects(f.service.advanceRead(f.a,{...x,throughSequence:2}));await assert.rejects(f.service.advanceRead(f.a,{...x,witnessHash:'f'.repeat(64)}));
 await assert.rejects(f.service.advanceRead({...f.a,expiresAt:Date.now()+4000},x));assert.equal(readState(f.store.row)!.pendingCount,0);
 f.store.row.status='FINISHED';assert.equal((await f.service.advanceRead(f.a,x)).status,'CONFIRMED');f.store.row.status='CANCELED';await assert.rejects(f.service.position(f.a,x.tournamentId));
});

test('full read receipt queue does not block actual terminal transition helper and creates no message sequence',async()=>{
 const f=await setup();f.store.failReadFinish=true;
 for(let i=0;i<64;i++)await f.service.advanceRead(f.a,f.command());
 const before=copy(f.store.row);await assert.rejects(f.service.advanceRead(f.a,f.command()));assert.deepEqual(f.store.row,before);
 assert.equal(chatState(f.store.row)!.allocatedSequence,1);assert.equal((await f.service.history(f.a,{contractVersion:1,tournamentId:f.p.tournamentId,limit:50})).messages.length,1);
 leave(f.store.row,f.a);assert.equal(readJoinTransition(f.store.row,f.store.row.localParticipationOperations.at(-1)),undefined);assert.equal(readState(f.store.row)!.pendingCount,64);
});

test('original participant cannot fall back to organizer; exact witness loss is explicit ACL denial',async()=>{
 const f=fixture();organizer(f.store.row,f.a);await f.service.send(f.a,f.input());const p=await f.service.position(f.a,f.input().tournamentId);
 const x={contractVersion:1 as const,tournamentId:p.tournamentId,requestId:randomUUID(),streamId:p.streamId,witnessHash:p.witnessHash,throughSequence:1};
 f.store.afterReadInsert=()=>{f.store.afterReadInsert=undefined;leave(f.store.row,f.a);};
 await assert.rejects(f.service.advanceRead(f.a,x),(e:any)=>e.getStatus()===403);assert.equal(readState(f.store.row)!.pendingCount,0);
});
