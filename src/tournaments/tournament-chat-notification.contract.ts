import { BadRequestException } from '@nestjs/common';
import { Candidate, Witness, hash, keys, safe, validWitness, witnessHash } from './tournament-chat.contract';
import { digest, object, uuid } from './tournament-local-operation.contract';
export const NOTIFICATION_VERSION = 'tournament-chat-notifications.v1';
export const NOTIFICATION_PATH = '/internal/tournaments/chat-notifications/v1';
export const NOTIFICATION_BUDGET_MS = 5000;
export type Operation = 'publications' | 'recipients' | 'eligibility';
export type FeedScope = { tenantId: string; tenantKey: string; ownerTenantKey: string; expiresAt: number; correlationId: string };
export type Binding = { tournamentId: string; incarnationHash: string; streamId: string };
export type Fact = Binding & { sequence: number; messageId: string; authorUserId: string; factHash: string };
export type Recipient = { witness: Witness; witnessHash: string; baselineSequence: number; capturedReadThroughSequence: number };
export type Identity = { userId: string; ownerTenantKey: string; providerClientId: string; observedAt: number };
export type Publications = Binding & { version: 1; afterSequence: number; throughSequence: number | null; limit: number };
export type Recipients = { version: 1; fact: Fact; limit: number; cursor: string | null };
export type Eligibility = { version: 1; fact: Fact; recipient: Recipient; identity: Identity };
const invalid = () => new BadRequestException({ code: 'TOURNAMENT_NOTIFICATION_INPUT_INVALID' });
const limit = (v: unknown) => safe(v) && v >= 1 && v <= 50;
export function factInput(v: unknown): Fact {
 if (!object(v) || !keys(v,'authorUserId,factHash,incarnationHash,messageId,sequence,streamId,tournamentId') || !uuid(v.tournamentId) || !uuid(v.streamId)
  || !hash(v.incarnationHash) || !safe(v.sequence) || v.sequence < 1 || !uuid(v.messageId) || !uuid(v.authorUserId) || !hash(v.factHash)) throw invalid();
 return {tournamentId:v.tournamentId,incarnationHash:v.incarnationHash,streamId:v.streamId,sequence:v.sequence,messageId:v.messageId,authorUserId:v.authorUserId,factHash:v.factHash};
}
export function recipientInput(v: unknown): Recipient {
 if (!object(v) || !keys(v,'baselineSequence,capturedReadThroughSequence,witness,witnessHash') || !validWitness(v.witness) || v.witnessHash !== witnessHash(v.witness)
  || !safe(v.baselineSequence) || !safe(v.capturedReadThroughSequence) || v.baselineSequence > v.capturedReadThroughSequence) throw invalid();
 const w = v.witness;
 const witness: Witness = w.kind === 'PARTICIPANT' ? {kind:w.kind,generation:w.generation,actorHash:w.actorHash} : {kind:w.kind,revision:w.revision,selectedUserId:w.selectedUserId};
 return {witness,witnessHash:v.witnessHash,baselineSequence:v.baselineSequence,capturedReadThroughSequence:v.capturedReadThroughSequence};
}
export function publicationInput(v: unknown): Publications {
 if (!object(v) || !keys(v,'afterSequence,incarnationHash,limit,streamId,throughSequence,tournamentId,version') || v.version !== 1
  || !uuid(v.tournamentId) || !uuid(v.streamId) || !hash(v.incarnationHash) || !safe(v.afterSequence) || !limit(v.limit)
  || (v.throughSequence !== null && (!safe(v.throughSequence) || v.throughSequence < v.afterSequence))) throw invalid();
 return {version:1,tournamentId:v.tournamentId,incarnationHash:v.incarnationHash,streamId:v.streamId,afterSequence:v.afterSequence,throughSequence:v.throughSequence,limit:v.limit};
}
export function recipientsInput(v: unknown): Recipients {
 if (!object(v) || !keys(v,'cursor,fact,limit,version') || v.version !== 1 || !limit(v.limit)
  || (v.cursor !== null && (typeof v.cursor !== 'string' || v.cursor.length > 1800))) throw invalid();
 return {version:1,fact:factInput(v.fact),limit:v.limit,cursor:v.cursor};
}
export function eligibilityInput(v: unknown): Eligibility {
 if (!object(v) || !keys(v,'fact,identity,recipient,version') || v.version !== 1 || !object(v.identity)
  || !keys(v.identity,'observedAt,ownerTenantKey,providerClientId,userId') || !uuid(v.identity.userId)
  || typeof v.identity.ownerTenantKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(v.identity.ownerTenantKey)
  || typeof v.identity.providerClientId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.identity.providerClientId)
  || !safe(v.identity.observedAt)) throw invalid();
 return {version:1,fact:factInput(v.fact),recipient:recipientInput(v.recipient),identity:{userId:v.identity.userId,ownerTenantKey:v.identity.ownerTenantKey,providerClientId:v.identity.providerClientId,observedAt:v.identity.observedAt}};
}
export function publicationFact(c: Candidate): Fact {
 if (!c.publication) throw invalid();
 return {tournamentId:c.tournamentId,incarnationHash:c.incarnation,streamId:c.streamId,sequence:c.publication.sequence,messageId:c.messageId,authorUserId:c.actorUserId,
  factHash:digest('tournament-notification-fact:v1',[c.coreHash,c.publication])};
}
export type RecipientCursor = {version:1;factHash:string;snapshotHash:string;throughSequence:number;afterWitnessHash:string};
export const cursorBytes = (c: RecipientCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
export function cursorInput(value: string): RecipientCursor {
 try { if (!/^[A-Za-z0-9_-]{1,1800}$/.test(value)) throw invalid(); const bytes=Buffer.from(value,'base64url');
  if(bytes.toString('base64url')!==value)throw invalid();const c=JSON.parse(bytes.toString('utf8'));
  if(!object(c)||!keys(c,'afterWitnessHash,factHash,snapshotHash,throughSequence,version')||c.version!==1||![c.factHash,c.snapshotHash,c.afterWitnessHash].every(hash)||!safe(c.throughSequence))throw invalid();return c as RecipientCursor;
 }catch{throw invalid();}
}
