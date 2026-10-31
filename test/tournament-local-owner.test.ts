import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { TournamentsLocalOwnerController } from '../src/tournaments/tournaments-local-owner.controller';
import { assertLocalOnly, operations, publicTournamentId } from '../src/tournaments/tournament-local-operation.contract';

const date = '2026-11-02';
const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v));
function fixture() {
  process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED = 'true';
  let row: any = { _id:'raw-id',id:'local-cup',source:'CUSTOM',slug:'local',name:'Synthetic local cup',
    startsAt:date+'T10:00:00+03:00',endsAt:date+'T12:00:00+03:00',archived:false,isPublic:true,status:'REGISTRATION',
    gender:'MIXED',accessLevels:[],maxPlayers:2,participants:[],waitlist:[],updatedAt:'2026-11-01T00:00:00.000Z',
    details:{booking:{enabled:false,paymentRequired:false,acceptedSubscriptions:[],purchaseOptions:[]}} };
  let commits=0, reads=0, prepares=0, auth=0, loseAck=false, beforeCommit: (()=>void)|undefined;
  let actor:any={verified:true,tenantKey:'synthetic-tenant',clientId:'actor-A',phoneNorm:'12025550101',name:'Synthetic'};
  const service = Object.create(TournamentsService.prototype) as any;
  const persistence:any={
    readLocalParticipationTarget:async()=>{reads++;return clone(row);},
    readPublicAdmissionRule:async()=>({gender:row.gender,updatedAt:row.updatedAt}),
    commitLocalParticipation:async(before:any,op:any,participants:any)=>{
      beforeCommit?.(); beforeCommit=undefined;
      if(JSON.stringify(before)!==JSON.stringify(row))return null;
      commits++; row={...row,participants:clone(participants),updatedAt:op.committedAt,
        localParticipationTenantKey:op.tenantKey,localParticipationOperations:[...(row.localParticipationOperations??[]),clone(op)]};
      if(loseAck){loseAck=false;throw Error('synthetic response loss');} return clone(row);
    }
  };
  Object.assign(service,{tournamentsPersistence:persistence,trustedRegistrationIdentities:new WeakMap(),
    lkIdentityService:{verify:async(a:string,t:string)=>{auth++;assert.equal(a,'Bearer fixture');assert.equal(t,'integration-fixture');return {actor:clone(actor)};}},
    playerRatingsService:{resolveCanonicalLevelByIdentity:async()=>({levelLabel:'C'})},
    vivaAdminService:{readTournamentProfileSex:async()=> 'MALE'},
    prepareTournamentOwner:async()=>{prepares++;return {status:'RESOLVED',owner:'CUP_CUSTOM',binding:{exerciseId:null,customTournamentId:row.id,customUpdatedAt:row.updatedAt,mappingSha256:'sha256:'+'a'.repeat(64)}};},
    invalidatePublicDirectoryCache:()=>{}
  });
  const tournamentId=publicTournamentId(row.id);
  const command=(key='key-0001',extra:any={})=>service.executeLocalTournamentOperation('Bearer fixture','integration-fixture',key,{schemaVersion:1,action:'JOIN',tournamentId,date,...extra});
  const read=(operationId:string)=>service.readLocalTournamentOperation('Bearer fixture','integration-fixture',{schemaVersion:1,tournamentId,operationId});
  return {service,command,read,get row(){return row;},set row(r:any){row=r;},get counts(){return {commits,reads,prepares,auth};},actor:(v:any)=>{actor={...actor,...v};},loseAck:()=>{loseAck=true;},beforeCommit:(f:()=>void)=>{beforeCommit=f;}};
}
const code=(expected:string)=>(e:any)=>e?.getResponse?.().code===expected;

test('whole owner JOIN/read/LEAVE/rejoin preserves original receipts and rejects stale generation',async()=>{
 const f=fixture(); const join=await f.command(); assert.equal(join.operation.outcome,'REGISTERED');assert.equal(join.registration.status,'REGISTERED');
 const original=join.operation.operationId;const first=clone(f.row.localParticipationOperations[0]);
 const left=await f.command('key-leave1',{action:'LEAVE',originalJoinOperationId:original});assert.equal(left.operation.outcome,'LEFT');assert.equal(f.row.participants.length,0);
 const second=await f.command('key-0002');assert.equal(second.operation.outcome,'REGISTERED');
 const stale=await f.command('key-leave2',{action:'LEAVE',originalJoinOperationId:original});assert.equal(stale.operation.reason,'GENERATION_NOT_CURRENT');
 assert.equal(f.row.participants[0].id,second.operation.generation);assert.deepEqual(f.row.localParticipationOperations[0],first);
 const replay=await f.command();assert.deepEqual(replay.operation,join.operation);assert.equal(replay.registration.status,'UNKNOWN');
 const counts=f.counts;await f.read(original);assert.equal(f.counts.commits,counts.commits);
});
test('simultaneous same key and different actor-key commands never duplicate one membership',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.command(),f.command()]);assert.equal(a.operation.operationId,b.operation.operationId);assert.equal(f.counts.commits,1);
 const next=await f.command('key-other');assert.equal(next.operation.reason,'MEMBERSHIP_EXISTS');assert.equal(f.row.participants.length,1);
});
test('last seat CAS recomputes capacity; FULL records refusal, no waitlist promotion',async()=>{
 const f=fixture();f.row.participants=[{id:'11111111-1111-4111-a111-111111111111',phone:'12025550102',name:'Existing',paymentStatus:'UNPAID',status:'REGISTERED'}];
 f.beforeCommit(()=>{f.row.participants.push({id:'22222222-2222-4222-a222-222222222222',phone:'12025550103',paymentStatus:'UNPAID',status:'REGISTERED'});});
 const result=await f.command();assert.equal(result.operation.reason,'FULL');assert.equal(f.row.participants.length,2);assert.equal(f.row.waitlist.length,0);
});
test('lost commit ACK resolves exact receipt and does not rewrite on retry',async()=>{
 const f=fixture();f.loseAck();const a=await f.command();const b=await f.command();assert.deepEqual(a.operation,b.operation);assert.equal(f.counts.commits,1);
});
test('replay works before discovery/rule checks after drift; read distinguishes cancelled current state',async()=>{
 const f=fixture();const a=await f.command();f.row.status='CANCELED';f.service.prepareTournamentOwner=()=>{throw Error('must not prepare');};
 const b=await f.command();assert.deepEqual(a.operation,b.operation);assert.equal(b.registration.status,'UNKNOWN');
 const read=await f.read(a.operation.operationId);assert.equal(read.operation.outcome,'REGISTERED');assert.equal(read.registration.status,'UNKNOWN');
});
test('key/body/date conflicts and foreign actor or tenant cannot reuse a receipt',async()=>{
 const f=fixture();const a=await f.command();await assert.rejects(f.command('key-0001',{date:'2026-11-03'}),code('TOURNAMENT_LOCAL_KEY_CONFLICT'));
 f.actor({clientId:'actor-B',phoneNorm:'12025550102'});await assert.rejects(f.read(a.operation.operationId),code('TOURNAMENT_LOCAL_OPERATION_NOT_FOUND'));
 f.actor({tenantKey:'foreign'});await assert.rejects(f.command(),code('TOURNAMENT_LOCAL_STATE_INVALID'));
});
test('off/invalid auth before any persistence, strict DTO and key shape',async()=>{
 const f=fixture();process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED='false';await assert.rejects(f.command(),code('TOURNAMENT_LOCAL_DISABLED'));assert.equal(f.counts.reads,0);
 process.env.TOURNAMENT_LOCAL_OPERATIONS_ENABLED='true';f.service.lkIdentityService.verify=()=>{throw Error('invalid token');};await assert.rejects(f.command());assert.equal(f.counts.reads,0);
 const g=fixture();for(const extra of [{phone:'12025550102'},{action:'LEAVE'},{originalJoinOperationId:'11111111-1111-4111-a111-111111111111'},{date:'2026-02-31'}])await assert.rejects(g.command('key-0001',extra));
 await assert.rejects(g.command('x'));assert.equal(g.counts.commits,0);
});
test('raw provider/payment/missing evidence never downgrades to free and leaves no journal',async()=>{
 const deltas=[{sourceTournamentId:'viva-id'},{exerciseId:'viva-id'},{sourceTournamentSnapshot:{}},{source:'VIVA'},{details:{}},
 {details:{booking:{enabled:false,paymentRequired:true,acceptedSubscriptions:[],purchaseOptions:[]}}},
 {pricePopover:{rows:[]}},{skin:{priceLabel:'Free'}},{summerSubscriptionOffer:{}},{details:{booking:{enabled:false,paymentRequired:false,acceptedSubscriptions:[],purchaseOptions:[],pendingJoinPayments:[]}}}];
 for(const delta of deltas){const f=fixture();f.row={...f.row,...delta};await assert.rejects(f.command(),code('TOURNAMENT_LOCAL_UNSUPPORTED'));assert.equal(f.counts.commits,0);}
});
test('canonical gender/level fail before mutation and MIXED needs no profile',async()=>{
 const f=fixture();f.row.gender='FEMALE';await assert.rejects(f.command(),code('GENDER_NOT_ALLOWED'));assert.equal(f.counts.commits,0);
 const g=fixture();g.row.accessLevels=['A'];await assert.rejects(g.command(),code('LEVEL_NOT_ALLOWED'));assert.equal(g.counts.commits,0);
 const h=fixture();h.service.vivaAdminService.readTournamentProfileSex=()=>{throw Error('MIXED cannot query sex');};await h.command();
});
test('operation corruption and bounded ledger are closed, not evicted',async()=>{
 const f=fixture();await f.command();f.row.localParticipationOperations[0].requestHash='b'.repeat(64);await assert.rejects(f.command(),code('TOURNAMENT_LOCAL_STATE_INVALID'));
 const g=fixture();await g.command();g.row.localParticipationOperations=new Array(513).fill(g.row.localParticipationOperations[0]);await assert.rejects(g.command(),code('TOURNAMENT_LOCAL_STATE_INVALID'));
});
test('public DTO projection excludes private journal; raw classifiers do not manufacture IDs',()=>{
 const f=fixture();const repo=Object.create(TournamentsPersistenceService.prototype) as any;
 const projected=repo.toCustomTournament({...f.row,localParticipationOperations:[{private:'proof'}],localParticipationTenantKey:'secret-tenant'});
 assert.ok(!JSON.stringify(projected).includes('localParticipation'));assert.ok(!JSON.stringify(projected).includes('proof'));
 assert.throws(()=>assertLocalOnly({...f.row,participants:[{phone:'12025550102',paymentStatus:'UNPAID'}]}));
});
test('controller private routes are exact and both suppress external audit payload capture',()=>{
 assert.equal(Reflect.getMetadata('path',TournamentsLocalOwnerController),'internal/tournaments/local-operations');
 assert.equal(Reflect.getMetadata('path',TournamentsLocalOwnerController.prototype.read),'read');
});

test('bounded history reserves terminal LEAVE space; other commands cannot consume it',async()=>{
 const f=fixture();
 for(let i=0;i<255;i++) { const join=await f.command('join-'+String(i).padStart(5,'0'));
   await f.command('leave-'+String(i).padStart(5,'0'),{action:'LEAVE',originalJoinOperationId:join.operation.operationId}); }
 const finalJoin=await f.command('join-final'); assert.equal(f.row.localParticipationOperations.length,511);
 await assert.rejects(f.command('join-denied'),code('TOURNAMENT_LOCAL_JOURNAL_FULL'));
 await assert.rejects(f.command('leave-wrong',{action:'LEAVE',originalJoinOperationId:f.row.localParticipationOperations[0].operationId}),code('TOURNAMENT_LOCAL_JOURNAL_FULL'));
 const left=await f.command('leave-final',{action:'LEAVE',originalJoinOperationId:finalJoin.operation.operationId});
 assert.equal(left.operation.outcome,'LEFT');assert.equal(f.row.localParticipationOperations.length,512);assert.equal(f.row.participants.length,0);
 const replay=await f.command('leave-final',{action:'LEAVE',originalJoinOperationId:finalJoin.operation.operationId});assert.deepEqual(replay.operation,left.operation);
});

test('stable canonical actor phone change cannot JOIN twice but can leave exact original generation',async()=>{
 const f=fixture();const original=await f.command();f.actor({phoneNorm:'12025550104'});
 await assert.rejects(f.command('new-phone-key'),code('TOURNAMENT_LOCAL_ACTOR_BINDING_CHANGED'));assert.equal(f.row.participants.length,1);
 assert.equal((await f.read(original.operation.operationId)).operation.outcome,'REGISTERED');
 f.loseAck();const left=await f.command('new-phone-leave',{action:'LEAVE',originalJoinOperationId:original.operation.operationId});assert.equal(left.operation.outcome,'LEFT');assert.equal(f.row.participants.length,0);
 assert.equal(f.row.localParticipationOperations.at(-1).phone,'12025550101');
 const replay=await f.command('new-phone-leave',{action:'LEAVE',originalJoinOperationId:original.operation.operationId});assert.deepEqual(replay.operation,left.operation);
});
test('foreign canonical actor with colliding phone cannot read or leave original generation',async()=>{
 const f=fixture();const original=await f.command();f.actor({clientId:'actor-B'});
 await assert.rejects(f.read(original.operation.operationId),code('TOURNAMENT_LOCAL_OPERATION_NOT_FOUND'));
 await assert.rejects(f.command('foreign-leave',{action:'LEAVE',originalJoinOperationId:original.operation.operationId}),code('TOURNAMENT_LOCAL_ORIGINAL_REQUIRED'));
 const duplicate=await f.command('foreign-join');assert.equal(duplicate.operation.reason,'MEMBERSHIP_EXISTS');assert.equal(f.row.participants.length,1);
});
