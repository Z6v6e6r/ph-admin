import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { TournamentOrganizerService } from '../src/tournaments/tournament-organizer.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';
import { TournamentOrganizerLookupClient } from '../src/tournaments/tournament-organizer-lookup.client';
import { organizerCommand, organizerState, OrganizerCommand, OrganizerState, ORGANIZER_OPERATION_LIMIT } from '../src/tournaments/tournament-organizer.contract';
import { RequestUser } from '../src/common/rbac/request-user.interface';
const clone = <T>(x:T):T => JSON.parse(JSON.stringify(x));
const tenantId=randomUUID(), selected=randomUUID(), other=randomUUID();
const actor:RequestUser={id:'synthetic-staff',roles:[],permissions:['tournaments:write'],stationIds:['synthetic-station'],permissionStationScopes:{'tournaments:write':['synthetic-station']},connectorRoutes:[],authSource:'token'};
function raw(){return {_id:'mongo-identity',id:'synthetic-tournament',source:'CUSTOM',slug:'synthetic',name:'Synthetic',studioId:'synthetic-station',archived:false,isPublic:true,status:'REGISTRATION',gender:'MIXED',accessLevels:[],maxPlayers:2,participants:[],waitlist:[],updatedAt:'2026-11-01T00:00:00.000Z',details:{booking:{enabled:false,paymentRequired:false,acceptedSubscriptions:[],purchaseOptions:[]}}};}
function cmd(action:'ASSIGN'|'REVOKE'='ASSIGN',revision=0):OrganizerCommand{return {contractVersion:1,operationId:randomUUID(),action,selectedUserId:action==='ASSIGN'?selected:null,expectedRevision:revision};}
function fixture(){
 let row:Record<string,any>=raw(), calls=0, writes=0; let beforeWrite:(()=>void)|undefined, lookupFailure=false, ackLost=false, expired=false, nearExpiry=false;
 const lookup={config:{tenantId,tenantKey:'synthetic',expectedOwnerTenantKey:'provider-synthetic',enabled:true},lookup:async(input:any)=>{calls++;if(lookupFailure)throw Error('disabled');return {profile:{userId:input.selectedUserId,displayName:'Synthetic'},ownerTenantKey:'provider-synthetic',expiresAt:new Date(Date.now()+(expired?-1000:nearExpiry?1000:30000)).toISOString()};}};
 const persistence={readOrganizerTarget:async()=>clone(row),commitOrganizerAssignment:async(before:Record<string,any>,next:OrganizerState,expiry:string|null)=>{
   beforeWrite?.();if(JSON.stringify(before)!==JSON.stringify(row)||expiry&&Date.parse(expiry)<=Date.now())return null;
   writes++;row={...row,tournamentOrganizerV1:clone(next)};if(ackLost)throw Error('lost acknowledgement');return clone(row);
 }};
 const scope=Object.create(TournamentsService.prototype) as TournamentsService;
 const service=new TournamentOrganizerService(persistence as unknown as TournamentsPersistenceService,scope,lookup as unknown as TournamentOrganizerLookupClient);
 return {service,lookup,get row(){return row;},get calls(){return calls;},get writes(){return writes;},set beforeWrite(v:(()=>void)|undefined){beforeWrite=v;},set lookupFailure(v:boolean){lookupFailure=v;},set ackLost(v:boolean){ackLost=v;},set expired(v:boolean){expired=v;},set nearExpiry(v:boolean){nearExpiry=v;},send:(c:OrganizerCommand,user=actor)=>service.command(row.id,c,c.operationId,user,randomUUID())};
}
test('assign/revoke and old exact replay expose historical result separately from current; no relookup/rewrite',async()=>{
 const f=fixture(),a=cmd();const first=await f.send(a);assert.equal(first.status,'CONFIRMED');assert.equal(first.current.revision,1);assert.equal(f.calls,1);
 await f.send(cmd('REVOKE',1));const replay=await f.send(a);assert.equal(replay.operation?.resultingSelectedUserId,selected);assert.equal(replay.operation?.resultingRevision,1);assert.equal(replay.current.selectedUserId,null);assert.equal(replay.current.revision,2);assert.equal(f.writes,2);assert.equal(f.calls,1);
 await assert.rejects(f.send({...a,selectedUserId:other}),(e:any)=>e.getResponse().code==='TOURNAMENT_ORGANIZER_OPERATION_CONFLICT');
 await assert.rejects(f.send(a,{...actor,id:'other-staff'}),(e:any)=>e.getResponse().code==='TOURNAMENT_ORGANIZER_OPERATION_CONFLICT');
});
test('lost ACK is recovered by exact receipt; stale revision is durably receipted and does not reauthorize profile',async()=>{
 const f=fixture();f.ackLost=true;const a=cmd();assert.equal((await f.send(a)).status,'CONFIRMED');assert.equal(f.writes,1);
 const stale=cmd();const result=await f.send(stale);assert.equal(result.operation?.outcome,'REJECTED');assert.equal(result.current.revision,1);assert.equal(f.calls,1);
 assert.equal((await f.service.readOperation(f.row.id,stale.operationId,actor)).status,'CONFIRMED');
});
test('lookup failure/expiry does not mutate; GET absence is UNKNOWN and never runs lookup',async()=>{
 const f=fixture(),a=cmd();f.lookupFailure=true;await assert.rejects(f.send(a));assert.equal(f.writes,0);
 const result=await f.service.readOperation(f.row.id,a.operationId,actor);assert.equal(result.status,'UNKNOWN');assert.equal(f.calls,1);
 f.lookupFailure=false;f.expired=true;await assert.rejects(f.send(a));assert.equal(f.writes,0);
});
test('actual staff/station scope rejects spoofed header actor and read/replay after station move',async()=>{
 const f=fixture(),a=cmd();await assert.rejects(f.send(a,{...actor,authSource:'headers'}));assert.equal(f.calls,0);
 await f.send(a);f.row.studioId='other-station';await assert.rejects(f.send(a));await assert.rejects(f.service.readOperation(f.row.id,a.operationId,actor));assert.equal(f.writes,1);
});
test('roster or station changed before CAS: no stale write and no fresh-revision retry',async()=>{
 for(const field of ['participants','studioId']){const f=fixture();f.beforeWrite=()=>{f.row[field]=field==='participants'?[{id:'concurrent-generation'}]:'other-station';};
  if(field==='studioId')await assert.rejects(f.send(cmd()));else assert.equal((await f.send(cmd())).status,'UNKNOWN');assert.equal(f.writes,0);assert.equal(f.calls,1);}
});
test('concurrent same operation different bodies have one first-wins receipt; loser conflicts',async()=>{
 const f=fixture(),a=cmd();const results=await Promise.allSettled([f.send(a),f.send({...a,selectedUserId:other})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.writes,1);assert.equal(f.row.tournamentOrganizerV1.operations.length,1);
});
test('journal reserves capacity for revoke; no eviction or reset; disabled lookup cannot block revoke',async()=>{
 const f=fixture();for(let i=0;i<ORGANIZER_OPERATION_LIMIT-1;i++)await f.send(cmd('ASSIGN',i));assert.equal(f.row.tournamentOrganizerV1.operations.length,127);
 await assert.rejects(f.send(cmd('ASSIGN',127)));await assert.rejects(f.send(cmd('REVOKE',0)));f.lookup.config.enabled=false;f.lookupFailure=true;f.row.archived=true;
 const result=await f.send(cmd('REVOKE',127));assert.equal(result.current.selectedUserId,null);assert.equal(f.row.tournamentOrganizerV1.operations.length,128);
 f.row.archived=false;await assert.rejects(f.send(cmd('ASSIGN',128)));assert.equal(f.row.tournamentOrganizerV1.operations.length,128);
});
test('strict input/malformed permanent marker fail closed',async()=>{
 assert.throws(()=>organizerCommand({...cmd(),profile:{verified:true}}));const f=fixture();f.row.tournamentOrganizerV1=null;await assert.rejects(f.send(cmd()));assert.equal(f.writes,0);
 assert.throws(()=>organizerState({...raw(),tournamentOrganizerV1:{}},tenantId,'synthetic'));
});

test('canonical/provider namespaces differ legitimately; foreign row or current namespace denies replay',async()=>{
 const f=fixture();f.row.localParticipationTenantKey='foreign-provider';await assert.rejects(f.send(cmd()));assert.equal(f.calls,0);
 delete f.row.localParticipationTenantKey;const a=cmd();await f.send(a);assert.equal(f.row.tournamentOrganizerV1.ownerTenantKey,'provider-synthetic');
 assert.equal(f.row.tournamentOrganizerV1.tenantKey,'synthetic');f.lookup.config.expectedOwnerTenantKey='foreign-provider';await assert.rejects(f.send(a));assert.equal(f.writes,1);
});

test('near-expiry proof cannot consume journal budget; adequate original signed lifetime can commit',async()=>{
 const f=fixture(),a=cmd();f.nearExpiry=true;await assert.rejects(f.send(a),(e:any)=>e.getResponse().code==='TOURNAMENT_ORGANIZER_LOOKUP_EXPIRED');assert.equal(f.writes,0);
 f.nearExpiry=false;const result=await f.send(a);assert.equal(result.status,'CONFIRMED');assert.equal(f.writes,1);assert.ok(Date.parse(f.row.tournamentOrganizerV1.operations[0].lookupExpiresAt)>Date.now()+5000);
});
