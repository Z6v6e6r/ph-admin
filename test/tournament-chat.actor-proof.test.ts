import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import { TournamentChatActorProof, chatProofConfig } from '../src/tournaments/tournament-chat.actor-proof';
import { TournamentChatController } from '../src/tournaments/tournament-chat.controller';
import { TournamentChatService } from '../src/tournaments/tournament-chat.service';
import { bodyBytes, CHAT_PATH, historyInput, readInput, sendInput } from '../src/tournaments/tournament-chat.contract';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const tenantId=randomUUID(), userId=randomUUID(), correlationId=randomUUID(), now=Math.floor(Date.now()/1000);
const input=sendInput({contractVersion:1,tournamentId:randomUUID(),requestId:randomUUID(),text:'Synthetic text'});
const path=CHAT_PATH+'/message-requests';
function proof(){const p=new TournamentChatActorProof();Object.assign(p,{config:{enabled:true,tenantId,tenantKey:'synthetic',ownerTenantKey:'provider-synthetic',issuer:'lk2-chat-test',kid:'synthetic',publicKey}});return p;}
function token(overrides:Record<string,unknown>={},header:Record<string,unknown>={}){
 const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'phub-tournament-chat-actor+jwt',kid:'synthetic',...header})).toString('base64url');
 const p=Buffer.from(JSON.stringify({contract_version:1,iss:'lk2-chat-test',aud:'cup-tournament-chat-v1',sub:userId,scope:'tournaments.chat.actor',tenant_id:tenantId,tenant_key:'synthetic',owner_tenant_key:'provider-synthetic',provider_client_id:'synthetic-client',session_id:randomUUID(),method:'POST',path,request_sha256:createHash('sha256').update(bodyBytes(input)).digest('hex'),correlation_id:correlationId,jti:randomUUID(),iat:now,nbf:now,exp:now+30,...overrides})).toString('base64url');
 return 'Bearer '+h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
}
test('dedicated actor assertion binds canonical/provider namespaces, exact command bytes and correlation',()=>{
 const p=proof(),t=token();const a=p.verify(t,path,bodyBytes(input),correlationId,now*1000);assert.equal(a.userId,userId);assert.equal(a.ownerTenantKey,'provider-synthetic');assert.notEqual(a.tenantKey,a.ownerTenantKey);
 assert.deepEqual(p.verify(t,path,bodyBytes(input),correlationId,now*1000),a); // Same signed request is not a new operation.
});
test('wrong credential purposes, claims, key, signature, scopes, timing and payload are denied',()=>{
 const p=proof();const verify=(t:string)=>p.verify(t,path,bodyBytes(input),correlationId,now*1000);
 for(const patch of [{aud:'organizer-lookup'},{scope:'tournaments.organizer-profile.read'},{scope:'tournaments.chat.actor extra'},{tenant_id:randomUUID()},{tenant_key:'foreign'},{owner_tenant_key:'foreign'},{sub:['array']},{session_id:'bad'},{provider_client_id:''},{method:'GET'},{path:path+'/read'},{request_sha256:'a'.repeat(64)},{correlation_id:randomUUID()},{exp:now+31},{iat:now+1,nbf:now+1},{exp:now},{nbf:now-1},{jti:'bad'},{extra:true}]) assert.throws(()=>verify(token(patch)));
 for(const h of [{typ:'phub-tournament-organizer-lookup+jwt'},{typ:'JWT'},{alg:'HS256'},{alg:'none'},{kid:'foreign'},{jku:'https://synthetic.invalid'}])assert.throws(()=>verify(token({},h)));
 const good=token();assert.throws(()=>verify(good.slice(0,-5)+'AAAAA'));assert.throws(()=>verify('Bearer synthetic-user-token'));
 assert.throws(()=>p.verify(good,path,bodyBytes({...input,text:'Changed'}),correlationId,now*1000));
});
test('actual controller denied/body/key paths perform zero service calls; history/status are separate readonly methods',async()=>{
 let sends=0,reads=0,histories=0;
 const service={send:async()=>{sends++;},status:async()=>{reads++;},history:async()=>{histories++;}} as unknown as TournamentChatService;
 const c=new TournamentChatController(proof(),service);
 assert.throws(()=>c.send(token({sub:'bad'}),correlationId,input.requestId,input));
 assert.throws(()=>c.send(token(),correlationId,randomUUID(),input));
 assert.throws(()=>c.send(token(),correlationId,input.requestId,{...input,userId}));assert.equal(sends+reads+histories,0);
 await c.send(token(),correlationId,input.requestId,input);assert.equal(sends,1);
 const r=readInput({contractVersion:1,tournamentId:input.tournamentId,requestId:input.requestId});
 await c.read(token({path:CHAT_PATH+'/message-requests/read',request_sha256:createHash('sha256').update(bodyBytes(r)).digest('hex')}),correlationId,r);
 const q=historyInput({contractVersion:1,tournamentId:input.tournamentId,limit:50});
 await c.history(token({path:CHAT_PATH+'/history',request_sha256:createHash('sha256').update(bodyBytes(q)).digest('hex')}),correlationId,q);
 assert.equal(reads,1);assert.equal(histories,1);assert.equal(sends,1);
});
test('config defaults disabled and never adopts organizer/user/subscription credentials',()=>{
 const c=chatProofConfig({TOURNAMENT_ORGANIZER_LOOKUP_ENABLED:'true',ADMIN_AUTH_SECRET:'synthetic-unused',JWT_ACCESS_SECRET:'synthetic-unused',SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS:'synthetic-unused'});
 assert.equal(c.enabled,false);assert.equal(c.publicKey,undefined);assert.throws(()=>chatProofConfig({TOURNAMENT_CHAT_ENABLED:'true'}));
});
test('READ controller binds new exact paths/body/key and readonly operations cannot mark',async()=>{
 let writes=0,reads=0;
 const service={advanceRead:async()=>{writes++;},position:async()=>{reads++;},readStatus:async()=>{reads++;}} as unknown as TournamentChatService;
 const c=new TournamentChatController(proof(),service);
 const x={contractVersion:1,tournamentId:input.tournamentId,requestId:input.requestId,streamId:randomUUID(),witnessHash:'a'.repeat(64),throughSequence:1};
 const signed=(suffix:string,body:unknown)=>token({path:CHAT_PATH+suffix,request_sha256:createHash('sha256').update(JSON.stringify(body)).digest('hex')});
 assert.throws(()=>c.advanceRead(token(),correlationId,x.requestId,x));
 assert.throws(()=>c.advanceRead(signed('/read-requests',x),correlationId,randomUUID(),x));
 assert.throws(()=>c.advanceRead(signed('/read-requests',x),correlationId,x.requestId,{...x,actorUserId:userId}));assert.equal(writes,0);
 await c.advanceRead(signed('/read-requests',x),correlationId,x.requestId,x);assert.equal(writes,1);
 const position={contractVersion:1,tournamentId:x.tournamentId};await c.position(signed('/read-position',position),correlationId,position);
 const status={contractVersion:1,tournamentId:x.tournamentId,requestId:x.requestId};await c.readStatus(signed('/read-requests/read',status),correlationId,status);
 assert.equal(reads,2);assert.equal(writes,1);
 assert.throws(()=>c.position(signed('/read-position',position).replace('Bearer ','Bearer synthetic-user-'),correlationId,position));
});
