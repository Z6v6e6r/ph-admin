import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { MemoryStore, actor, raw, copy } from './tournament-chat.fixture';
import { ChatActor, ChatState, parseCandidate, chatState } from '../src/tournaments/tournament-chat.contract';
import { TournamentChatService } from '../src/tournaments/tournament-chat.service';
import { TournamentChatNotificationService } from '../src/tournaments/tournament-chat-notification.service';
import { TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { FeedScope, Fact, Recipient, Eligibility, Publications } from '../src/tournaments/tournament-chat-notification.contract';
import { publicTournamentId, digest, commandIdentity } from '../src/tournaments/tournament-local-operation.contract';
export class NotificationMemoryStore extends MemoryStore {
 async notificationPublications(s:ChatState,after:number,through:number,limit:number){return [...this.docs.values()].filter(d=>d.tenantId===s.tenantId&&d.tournamentId===s.tournamentId&&d.streamId===s.streamId&&d.publication&&d.publication.sequence>after&&d.publication.sequence<=through).sort((a,b)=>a.publication!.sequence-b.publication!.sequence).slice(0,limit+1).map(d=>parseCandidate(copy(d)));}
}
export function notificationFixture(extra=0){
 const a=actor(),b={...actor(),tenantId:a.tenantId,userId:randomUUID(),providerClientId:'synthetic-recipient'},row=raw(a);
 function append(person:ChatActor,n:number){const r=raw(person,row.id),op=r.localParticipationOperations[0];op.phone='1202555'+String(n).padStart(4,'0');r.participants[0].phone=op.phone;row.localParticipationOperations.push(op);row.participants.push(r.participants[0]);}
 append(b,2);for(let i=0;i<extra;i++)append({...b,userId:randomUUID(),providerClientId:'synthetic-extra-'+i},i+3);
 const store=new NotificationMemoryStore(row),persistence=store as unknown as TournamentChatPersistence,chat=new TournamentChatService(persistence),feed=new TournamentChatNotificationService(persistence),tournamentId=publicTournamentId(row.id);
 const scope:FeedScope={tenantId:a.tenantId,tenantKey:a.tenantKey,ownerTenantKey:a.ownerTenantKey,expiresAt:a.expiresAt,correlationId:a.correlationId};
 const send=()=>chat.send(a,{contractVersion:1,tournamentId,requestId:randomUUID(),text:'Synthetic identical message'});
 const input=(after=0,through:number|null=null,limit=50):Publications=>{const s=chatState(store.row)!;return {version:1,tournamentId,incarnationHash:s.incarnation,streamId:s.streamId,afterSequence:after,throughSequence:through,limit};};
 const eligibility=(fact:Fact,recipient:Recipient,person:ChatActor=b):Eligibility=>({version:1,fact,recipient,identity:{userId:person.userId,ownerTenantKey:person.ownerTenantKey,providerClientId:person.providerClientId,observedAt:Date.now()}});
 return {a,b,store,chat,feed,scope,tournamentId,send,input,eligibility};
}
export async function emitNotificationWire(){const f=notificationFixture();await f.send();const input=f.input();const publications=await f.feed.publications(f.scope,input);const fact=publications.facts[0];const recipients=await f.feed.recipients(f.scope,{version:1,fact,limit:50,cursor:null});const candidate=recipients.candidates.find(c=>c.witness.kind==='PARTICIPANT'&&c.witness.actorHash!==[...f.store.docs.values()][0].providerActorHash)!;const command=f.eligibility(fact,candidate);const eligibility=await f.feed.eligibility(f.scope,command);return {source:'Actual CUP notification service; synthetic memory only',scope:f.scope,input,identity:{...command.identity,providerMappingId:randomUUID()},candidate,wire:{publications:JSON.stringify(publications),recipients:JSON.stringify(recipients),eligibility:JSON.stringify(eligibility)}};}
export function notificationLeave(row:Record<string,any>,a:ChatActor){
 const j=row.localParticipationOperations.find((o:any)=>o.actorHash===digest('tournament-local-actor:v1',[a.ownerTenantKey,a.providerClientId])&&o.outcome==='REGISTERED'&&!row.localParticipationOperations.some((l:any)=>l.outcome==='LEFT'&&l.generation===o.generation));
 const command={schemaVersion:1 as const,action:'LEAVE' as const,tournamentId:publicTournamentId(row.id),date:j.command.date,originalJoinOperationId:j.generation};
 const id=commandIdentity(a.ownerTenantKey,a.providerClientId,'synthetic-leave-'+randomUUID(),command);
 row.localParticipationOperations.push({...copy(j),...id,command,outcome:'LEFT',reason:'LEFT',generation:j.generation,committedAt:new Date().toISOString()});row.participants=row.participants.filter((p:any)=>p.id!==j.generation);
}
export function notificationRejoin(row:Record<string,any>,a:ChatActor){
 const j=copy(row.localParticipationOperations.find((o:any)=>o.actorHash===digest('tournament-local-actor:v1',[a.ownerTenantKey,a.providerClientId])&&o.outcome==='REGISTERED'));
 const id=commandIdentity(a.ownerTenantKey,a.providerClientId,'synthetic-join-'+randomUUID(),j.command);Object.assign(j,id,{generation:id.operationId,committedAt:new Date().toISOString()});row.localParticipationOperations.push(j);row.participants.push({id:j.generation,phone:j.phone,name:'Synthetic',status:'REGISTERED',paymentStatus:'UNPAID'});
}
