import { Injectable, HttpException } from '@nestjs/common';
import { TournamentChatPersistence } from './tournament-chat.persistence';
import { chatState, currentWitness, denied, unavailable, witnessHash, conflict } from './tournament-chat.contract';
import { adoptReadState, exactPosition, readState } from './tournament-chat-read.contract';
import { assertLocalOnly, digest, operations } from './tournament-local-operation.contract';
import { organizerState } from './tournament-organizer.contract';
import { Binding, Eligibility, Fact, FeedScope, NOTIFICATION_BUDGET_MS, NOTIFICATION_VERSION, Publications, Recipient, Recipients, cursorBytes, cursorInput, publicationFact } from './tournament-chat-notification.contract';
@Injectable()
export class TournamentChatNotificationService {
 readonly metrics={publications:0,recipients:0,allowed:0,denied:0};
 constructor(private readonly store:TournamentChatPersistence){}
 private fresh(s:FeedScope){if(s.expiresAt<=Date.now())throw denied();}
 private async target(s:FeedScope,b:Binding){
  this.fresh(s);const row=await this.store.readTarget(b.tournamentId);if(!row)throw denied();
  assertLocalOnly(row);if(row.status==='CANCELED')throw denied();
  if(row.participants.length>512||row.waitlist.length>512)throw unavailable();
  const state=chatState(row),reads=readState(row);if(!state||!reads)throw unavailable();
  if(state.tenantId!==s.tenantId||state.tenantKey!==s.tenantKey||state.ownerTenantKey!==s.ownerTenantKey||state.tournamentId!==b.tournamentId||state.incarnation!==b.incarnationHash||state.streamId!==b.streamId)throw denied();
  const list=operations(row,s.ownerTenantKey),org=organizerState(row,s.tenantId,s.tenantKey);
  if(org.ownerTenantKey!==null&&org.ownerTenantKey!==s.ownerTenantKey)throw denied();
  this.fresh(s);return {row,state,reads,list,org};
 }
 private assertCurrentPositionCoverage(t:Awaited<ReturnType<TournamentChatNotificationService['target']>>){
  // Reuse the existing pure adoption proof for CURRENT joins/organizer only.
  // This does not adopt or persist anything, and does not require historical markers.
  const raw={...t.row};delete raw.tournamentChatReadV1;
  const expected=adoptReadState(raw,t.state,{actorUserId:t.state.bootstrap.actorUserId,correlationId:t.state.bootstrap.correlationId});
  for(const p of expected.positions)exactPosition(t.reads,p.witness);
 }
 private snapshot(t:Awaited<ReturnType<TournamentChatNotificationService['target']>>){return digest('tournament-notification-recipients:v1',[
  t.state.tenantId,t.state.tournamentId,t.state.incarnation,t.state.streamId,
  t.reads.positions.map(p=>[p.witness,p.baselineSequence]),t.list.map(o=>[o.operationId,o.outcome,o.generation,o.actorHash,o.phone]),
  t.row.participants.map((p:any)=>[p.id,p.phone,p.status,p.paymentStatus]),t.org.revision,t.org.selectedUserId,t.row.status]);}
 private async fact(s:FeedScope,f:Fact){
  const t=await this.target(s,f);if(f.sequence>t.state.publishedSequence)throw unavailable();
  const docs=await this.store.notificationPublications(t.state,f.sequence-1,f.sequence,1);
  if(docs.length!==1||docs[0].tenantId!==s.tenantId||docs[0].tenantKey!==s.tenantKey||docs[0].ownerTenantKey!==s.ownerTenantKey||JSON.stringify(publicationFact(docs[0]))!==JSON.stringify(f))throw unavailable();
  const after=await this.target(s,f);if(after.state.publishedSequence<f.sequence)throw unavailable();return after;
 }
 async publications(s:FeedScope,x:Publications){
  await this.store.readyReads();const t=await this.target(s,x),through=x.throughSequence??t.state.publishedSequence;
  if(through>t.state.publishedSequence||x.afterSequence>through)throw conflict();
  const docs=await this.store.notificationPublications(t.state,x.afterSequence,through,x.limit);
  let prior=x.afterSequence;
  for(const d of docs){if(d.tenantId!==s.tenantId||d.tenantKey!==s.tenantKey||d.ownerTenantKey!==s.ownerTenantKey||d.incarnation!==x.incarnationHash||d.streamId!==x.streamId||d.tournamentId!==x.tournamentId||!d.publication||d.publication.sequence!==prior+1)throw unavailable();prior=d.publication.sequence;}
  const hasMore=docs.length>x.limit;if(!hasMore&&prior!==through)throw unavailable();
  const after=await this.target(s,x);if(after.state.publishedSequence<through)throw unavailable();
  this.metrics.publications++;return {contractVersion:NOTIFICATION_VERSION,tournamentId:x.tournamentId,incarnationHash:x.incarnationHash,streamId:x.streamId,throughSequence:through,
   facts:docs.slice(0,x.limit).map(publicationFact),nextAfterSequence:hasMore?docs[x.limit-1].publication!.sequence:null,hasMore};
 }
 async recipients(s:FeedScope,x:Recipients){
  await this.store.readyReads();const t=await this.fact(s,x.fact);this.assertCurrentPositionCoverage(t);const snapshotHash=this.snapshot(t),cursor=x.cursor===null?null:cursorInput(x.cursor),through=cursor?.throughSequence??t.state.publishedSequence;
  if(cursor&&(cursor.factHash!==x.fact.factHash||cursor.snapshotHash!==snapshotHash||through>t.state.publishedSequence||through<x.fact.sequence))throw conflict();
  const positions=t.reads.positions.map(p=>({...p,key:witnessHash(p.witness)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  if(cursor&&!positions.some(p=>p.key===cursor.afterWitnessHash))throw conflict();
  const remaining=positions.filter(p=>!cursor||p.key>cursor.afterWitnessHash),scanned=remaining.slice(0,x.limit),result:Recipient[]=[];
  for(const p of scanned){
   if(p.baselineSequence>=x.fact.sequence||p.readThroughSequence>=x.fact.sequence)continue;
   const w=p.witness;
   if(w.kind==='PARTICIPANT'){
    const joins=t.list.filter(o=>o.actorHash===w.actorHash&&o.outcome==='REGISTERED'&&!t.list.some(l=>l.outcome==='LEFT'&&l.generation===o.generation));
    if(joins.length>1)throw unavailable();if(joins.length!==1||joins[0].generation!==w.generation)continue;
    const j=joins[0],matches=t.row.participants.filter((v:any)=>v.id===j.generation||v.phone===j.phone);
    if(matches.length!==1||matches[0].id!==j.generation||matches[0].phone!==j.phone||matches[0].status!=='REGISTERED'||matches[0].paymentStatus!=='UNPAID')throw unavailable();
   }else if(t.org.selectedUserId!==w.selectedUserId||t.org.revision!==w.revision)continue;
   result.push({witness:w,witnessHash:p.key,baselineSequence:p.baselineSequence,capturedReadThroughSequence:p.readThroughSequence});
  }
  const after=await this.target(s,x.fact);if(this.snapshot(after)!==snapshotHash||after.state.publishedSequence<through)throw conflict();
  // READ progress may suppress a candidate but cannot cause an equality-to-old-readThrough denial.
  const candidates=result.filter(p=>exactPosition(after.reads,p.witness).readThroughSequence<x.fact.sequence);
  const hasMore=remaining.length>scanned.length;this.metrics.recipients++;
  return {contractVersion:NOTIFICATION_VERSION,fact:x.fact,throughSequence:through,snapshotHash,candidates,
   nextCursor:hasMore?cursorBytes({version:1,factHash:x.fact.factHash,snapshotHash,throughSequence:through,afterWitnessHash:scanned[scanned.length-1].key}):null,hasMore};
 }
 async eligibility(s:FeedScope,x:Eligibility){
  await this.store.readyReads();
  const freshness=()=>{this.fresh(s);if(x.identity.ownerTenantKey!==s.ownerTenantKey||x.identity.observedAt>Date.now()||Date.now()-x.identity.observedAt>=NOTIFICATION_BUDGET_MS)throw denied();};
  freshness();let code:'ELIGIBLE'|'CURRENT_CONTEXT_CHANGED'|'AUTHOR'|'READ'|'BASELINE'='ELIGIBLE';
  try {const t=await this.fact(s,x.fact);
   // Never choose original.kind here: current participant authority dominates organizer.
   const w=currentWitness(t.row,{...s,userId:x.identity.userId,providerClientId:x.identity.providerClientId},x.fact.tournamentId);
   if(witnessHash(w)!==x.recipient.witnessHash)code='CURRENT_CONTEXT_CHANGED';
   else {const p=exactPosition(t.reads,w);
    if(p.readThroughSequence<x.recipient.capturedReadThroughSequence)throw unavailable();
    if(p.baselineSequence!==x.recipient.baselineSequence||p.baselineSequence>=x.fact.sequence)code='BASELINE';
    else if(p.readThroughSequence>=x.fact.sequence)code='READ';
    else if(x.identity.userId===x.fact.authorUserId)code='AUTHOR';
   }
  }catch(e){if(e instanceof HttpException&&[403,409].includes(e.getStatus()))code='CURRENT_CONTEXT_CHANGED';else throw e;}
  freshness();const observedAt=Date.now(),validUntil=Math.min(s.expiresAt,x.identity.observedAt+NOTIFICATION_BUDGET_MS,observedAt+NOTIFICATION_BUDGET_MS);
  if(validUntil<=observedAt)throw denied();this.metrics[code==='ELIGIBLE'?'allowed':'denied']++;
  return {contractVersion:NOTIFICATION_VERSION,fact:x.fact,userId:x.identity.userId,witnessHash:x.recipient.witnessHash,baselineSequence:x.recipient.baselineSequence,decision:code==='ELIGIBLE'?'ALLOW' as const:'DENY' as const,code,observedAt,validUntil};
 }
}
