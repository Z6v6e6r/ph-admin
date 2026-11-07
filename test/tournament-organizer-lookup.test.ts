import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify, createHash } from 'node:crypto';
import { test } from 'node:test';
import { TournamentOrganizerLookupClient, organizerLookupBodyBytes, organizerLookupConfig } from '../src/tournaments/tournament-organizer-lookup.client';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const input={contractVersion:1 as const,requestId:randomUUID(),assignmentOperationId:randomUUID(),tournamentId:randomUUID(),selectedUserId:randomUUID(),expectedAssignmentRevision:2};
function fixture(){const client=new TournamentOrganizerLookupClient();Object.assign(client,{config:{enabled:true,tenantId:randomUUID(),tenantKey:'synthetic',expectedOwnerTenantKey:'provider-synthetic',origin:'https://synthetic.invalid',issuer:'cup-organizer',audience:'lk2-organizer',subject:'cup-organizer-service',kid:'synthetic',privateKey}});return client;}
test('dedicated signer binds exact input/tenant/method/path/correlation and minimal response; no credentials reused',async()=>{
 const client=fixture(),correlationId=randomUUID(),old=global.fetch;
 global.fetch=async(url,init)=>{
  assert.equal(url,'https://synthetic.invalid/internal/api/v1/synthetic/tournament-organizer-profile-lookups');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  const headers=init!.headers as Record<string,string>;assert.equal(headers['x-correlation-id'],correlationId);assert.equal(init?.body,organizerLookupBodyBytes(input));
  const [h,p,s]=headers.authorization.slice(7).split('.');const header=JSON.parse(Buffer.from(h,'base64url').toString()),claims=JSON.parse(Buffer.from(p,'base64url').toString());
  assert.deepEqual(header,{alg:'RS256',typ:'phub-tournament-organizer-lookup+jwt',kid:'synthetic'});assert.equal(verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')),true);
  assert.equal(claims.scope,'tournaments.organizer-profile.read');assert.equal(claims.exp-claims.iat,30);assert.equal(claims.tenant_id,client.config.tenantId);assert.equal(claims.request_sha256,createHash('sha256').update(String(init!.body)).digest('hex'));
  assert.equal(claims.sid,undefined);assert.equal(claims.provider_client_id,undefined);
  return new Response(JSON.stringify({...input,tenantId:client.config.tenantId,tenantKey:'synthetic',ownerTenantKey:'provider-synthetic',profile:{userId:input.selectedUserId,displayName:'Synthetic'},checkedAt:new Date(claims.iat*1000).toISOString(),expiresAt:new Date(claims.exp*1000).toISOString()}));
 };
 try{const result=await client.lookup(input,correlationId);assert.deepEqual(result.profile,{userId:input.selectedUserId,displayName:'Synthetic'});}finally{global.fetch=old;}
});
test('access denials do not poison dependency breaker; malformed/transport failures do; calls never blindly retry',async()=>{
 const old=global.fetch;try{
 const client=fixture();let calls=0;global.fetch=async()=>{calls++;return new Response('{}',{status:403});};
 for(let i=0;i<4;i++)await assert.rejects(client.lookup(input,randomUUID()));assert.equal(calls,4);assert.equal(client.metrics.denied,4);
 global.fetch=async()=>{calls++;return new Response('{}');};for(let i=0;i<4;i++)await assert.rejects(client.lookup(input,randomUUID()));assert.equal(calls,7);assert.equal(client.metrics.unavailable,3);
 }finally{global.fetch=old;}
});
test('default-disabled dedicated config ignores user/subscription credentials',()=>{
 const config=organizerLookupConfig({ADMIN_AUTH_SECRET:'synthetic-not-used',SUBSCRIPTIONS_LK2_DELEGATION_PUBLIC_KEYS:'synthetic-not-used',JWT_ACCESS_SECRET:'synthetic-not-used'});
 assert.equal(config.enabled,false);assert.equal(config.privateKey,undefined);
});
