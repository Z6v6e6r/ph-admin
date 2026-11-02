import { BadRequestException } from '@nestjs/common';
import { ChatActor, ChatState, Witness, chatState, currentWitness, denied, hash, incarnation, keys, safe, unavailable, validWitness, witnessHash } from './tournament-chat.contract';
import { LocalOperation, digest, object, operations, uuid } from './tournament-local-operation.contract';
import { OrganizerState, organizerState } from './tournament-organizer.contract';

export const READ_VERSION = 'tournament-chat-read.v1';
export const READ_PENDING_LIMIT = 64;
export const READ_POSITION_LIMIT = 640; // Retained JOIN(512) + organizer(128) journals; never evict.
export type Position = { witness: Witness; baselineSequence: number; readThroughSequence: number };
export type ReadCommand = { contractVersion: 1; tournamentId: string; requestId: string; streamId: string; witnessHash: string; throughSequence: number };
export type ReadResult = { requestDocId: string; coreHash: string; actorUserId: string; correlationId: string;
  throughSequence: number; readThroughSequence: number; acceptedAt: string; audit: 'TOURNAMENT_CHAT_READ_ACCEPTED_V1' };
export type ReadState = { version: 1; tenantId: string; tenantKey: string; ownerTenantKey: string; tournamentId: string;
  incarnation: string; streamId: string; positions: Position[]; pendingCount: number; pending: ReadResult[];
  adoption: { actorUserId: string; correlationId: string; at: string; throughSequence: number; audit: 'TOURNAMENT_CHAT_READ_ADOPTED_V1' } };
const instant = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export const hasReadState = (row: Record<string, any>) => Object.prototype.hasOwnProperty.call(row, 'tournamentChatReadV1');
export function positionInput(x: unknown): { contractVersion: 1; tournamentId: string } {
  if (!object(x) || !keys(x, 'contractVersion,tournamentId') || x.contractVersion !== 1 || !uuid(x.tournamentId)) throw new BadRequestException({ code: 'TOURNAMENT_CHAT_INPUT_INVALID' });
  return { contractVersion: 1, tournamentId: x.tournamentId };
}
export function readCommandInput(x: unknown): ReadCommand {
  if (!object(x) || !keys(x, 'contractVersion,requestId,streamId,throughSequence,tournamentId,witnessHash')
    || x.contractVersion !== 1 || !uuid(x.tournamentId) || !uuid(x.requestId) || !uuid(x.streamId) || !hash(x.witnessHash) || !safe(x.throughSequence)) throw new BadRequestException({ code: 'TOURNAMENT_CHAT_INPUT_INVALID' });
  return { contractVersion: 1, tournamentId: x.tournamentId, requestId: x.requestId, streamId: x.streamId, witnessHash: x.witnessHash, throughSequence: x.throughSequence };
}
export function validReadResult(p: unknown): p is ReadResult {
  return object(p) && keys(p, 'acceptedAt,actorUserId,audit,coreHash,correlationId,readThroughSequence,requestDocId,throughSequence')
    && hash(p.requestDocId) && hash(p.coreHash) && uuid(p.actorUserId) && uuid(p.correlationId)
    && safe(p.throughSequence) && safe(p.readThroughSequence) && p.readThroughSequence >= p.throughSequence
    && instant(p.acceptedAt) && p.audit === 'TOURNAMENT_CHAT_READ_ACCEPTED_V1';
}
export function readState(row: Record<string, any>): ReadState | null {
  if (!hasReadState(row)) return null;
  const c = chatState(row), s = row.tournamentChatReadV1;
  if (!c || !object(s) || !keys(s, 'adoption,incarnation,ownerTenantKey,pending,pendingCount,positions,streamId,tenantId,tenantKey,tournamentId,version') || s.version !== 1
    || ['tenantId','tenantKey','ownerTenantKey','tournamentId','incarnation','streamId'].some(k => s[k] !== (c as any)[k])
    || !Array.isArray(s.positions) || s.positions.length > READ_POSITION_LIMIT || !Array.isArray(s.pending) || s.pending.length > READ_PENDING_LIMIT || s.pendingCount !== s.pending.length
    || !object(s.adoption) || !keys(s.adoption, 'actorUserId,at,audit,correlationId,throughSequence') || !uuid(s.adoption.actorUserId) || !uuid(s.adoption.correlationId)
    || !instant(s.adoption.at) || !safe(s.adoption.throughSequence) || s.adoption.throughSequence > c.publishedSequence || s.adoption.audit !== 'TOURNAMENT_CHAT_READ_ADOPTED_V1') throw unavailable();
  const seen = new Set<string>();
  for (const p of s.positions) {
    if (!object(p) || !keys(p, 'baselineSequence,readThroughSequence,witness') || !validWitness(p.witness)
      || !safe(p.baselineSequence) || !safe(p.readThroughSequence) || p.baselineSequence > p.readThroughSequence || p.readThroughSequence > c.publishedSequence) throw unavailable();
    const k = witnessHash(p.witness); if (seen.has(k)) throw unavailable(); seen.add(k);
  }
  const ids = new Set<string>();
  for (const p of s.pending) {
    if (!validReadResult(p) || p.readThroughSequence > c.publishedSequence || ids.has(p.requestDocId)) throw unavailable(); ids.add(p.requestDocId);
  }
  return s as ReadState;
}
export function exactPosition(s: ReadState, witness: Witness): Position {
  const found = s.positions.filter(p => witnessHash(p.witness) === witnessHash(witness));
  if (found.length !== 1) throw unavailable(); return found[0];
}
/** Pure full adoption plan only. Caller owns full raw CAS and separate setup authority for old streams. */
export function adoptReadState(row: Record<string, any>, c: ChatState, audit?: { actorUserId: string; correlationId: string }): ReadState {
  if (hasReadState(row) || (Object.prototype.hasOwnProperty.call(row, 'tournamentChatV1') && !audit)) throw unavailable();
  const adopter = audit ?? c.bootstrap;
  const list = operations(row, c.ownerTenantKey), positions: Position[] = [];
  for (const j of list.filter(o => o.outcome === 'REGISTERED' && !list.some(l => l.outcome === 'LEFT' && l.generation === o.generation))) {
    const matches = row.participants.filter((p: any) => p.id === j.generation || p.phone === j.phone);
    if (matches.length !== 1 || matches[0].id !== j.generation || matches[0].phone !== j.phone || matches[0].status !== 'REGISTERED' || matches[0].paymentStatus !== 'UNPAID'
      || positions.some(p => p.witness.kind === 'PARTICIPANT' && p.witness.actorHash === j.actorHash)) throw unavailable();
    positions.push({ witness: { kind: 'PARTICIPANT', generation: j.generation!, actorHash: j.actorHash }, baselineSequence: c.publishedSequence, readThroughSequence: c.publishedSequence });
  }
  const org = organizerState(row, c.tenantId, c.tenantKey);
  if (org.ownerTenantKey !== null && org.ownerTenantKey !== c.ownerTenantKey) throw unavailable();
  if (org.selectedUserId) positions.push({ witness: { kind: 'ORGANIZER', revision: org.revision, selectedUserId: org.selectedUserId }, baselineSequence: c.publishedSequence, readThroughSequence: c.publishedSequence });
  const s: ReadState = { version: 1, tenantId: c.tenantId, tenantKey: c.tenantKey, ownerTenantKey: c.ownerTenantKey, tournamentId: c.tournamentId,
    incarnation: c.incarnation, streamId: c.streamId, positions, pendingCount: 0, pending: [],
    adoption: { actorUserId: adopter.actorUserId, correlationId: adopter.correlationId, at: new Date().toISOString(), throughSequence: c.publishedSequence, audit: 'TOURNAMENT_CHAT_READ_ADOPTED_V1' } };
  readState({ ...row, tournamentChatV1: c, tournamentChatReadV1: s }); return s;
}
function addPosition(row: Record<string, any>, w: Witness): ReadState | undefined {
  if (!hasReadState(row)) return undefined; // Existing unadopted streams preserve enrollment behavior.
  const s = readState(row)!, c = chatState(row)!;
  if (s.positions.length >= READ_POSITION_LIMIT || s.positions.some(p => witnessHash(p.witness) === witnessHash(w))) throw unavailable();
  return { ...s, positions: [...s.positions, { witness: w, baselineSequence: c.publishedSequence, readThroughSequence: c.publishedSequence }] };
}
export function readJoinTransition(row: Record<string, any>, op: LocalOperation): ReadState | undefined {
  // Terminal removal NEVER parses read state or depends on its pending/position capacity.
  return op.outcome === 'REGISTERED' ? addPosition(row, { kind: 'PARTICIPANT', generation: op.generation!, actorHash: op.actorHash }) : undefined;
}
export function readOrganizerTransition(row: Record<string, any>, next: OrganizerState): ReadState | undefined {
  const last = next.operations[next.operations.length - 1];
  return last?.outcome === 'ASSIGNED' ? addPosition(row, { kind: 'ORGANIZER', revision: next.revision, selectedUserId: next.selectedUserId! }) : undefined;
}
export type ReadCandidate = { _id: string; recordKind: 'TOURNAMENT_CHAT_READ_V1'; tenantId: string; tenantKey: string; ownerTenantKey: string;
  tournamentId: string; incarnation: string; streamId: string; actorUserId: string; providerActorHash: string; request: ReadCommand;
  requestHash: string; witness: Witness; baselineSequence: number; createdAt: string; coreHash: string; result?: ReadResult };
export const readRequestHash = (x: ReadCommand) => digest('tournament-chat-read-request:v1', x);
export const readRequestId = (a: ChatActor, x: { tournamentId: string; requestId: string }) => digest('tournament-chat-read-custody:v1', [a.tenantId, x.tournamentId, a.userId, x.requestId]);
export const readCoreHash = (x: Omit<ReadCandidate, 'coreHash' | 'result'>) => digest('tournament-chat-read-core:v1', x);
export function readCandidate(row: Record<string, any>, s: ReadState, a: ChatActor, x: ReadCommand, p: Position): ReadCandidate {
  const core = { _id: readRequestId(a, x), recordKind: 'TOURNAMENT_CHAT_READ_V1' as const, tenantId: a.tenantId, tenantKey: a.tenantKey,
    ownerTenantKey: a.ownerTenantKey, tournamentId: x.tournamentId, incarnation: incarnation(row), streamId: s.streamId, actorUserId: a.userId,
    providerActorHash: digest('tournament-local-actor:v1', [a.ownerTenantKey, a.providerClientId]), request: x, requestHash: readRequestHash(x),
    witness: p.witness, baselineSequence: p.baselineSequence, createdAt: new Date().toISOString() };
  return { ...core, coreHash: readCoreHash(core) };
}
export function parseReadCandidate(x: any): ReadCandidate {
  if (!object(x) || !keys(x, '_id,actorUserId,baselineSequence,coreHash,createdAt,incarnation,ownerTenantKey,providerActorHash,recordKind,request,requestHash,' + (x.result === undefined ? '' : 'result,') + 'streamId,tenantId,tenantKey,tournamentId,witness')) throw unavailable();
  const core = { ...x }; delete core.coreHash; delete core.result;
  if (x.recordKind !== 'TOURNAMENT_CHAT_READ_V1' || !hash(x._id) || !hash(x.incarnation) || !hash(x.providerActorHash) || !uuid(x.actorUserId)
    || !uuid(x.tenantId) || !uuid(x.tournamentId) || !uuid(x.streamId) || typeof x.tenantKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(x.tenantKey)
    || typeof x.ownerTenantKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(x.ownerTenantKey) || !validWitness(x.witness) || !safe(x.baselineSequence) || !instant(x.createdAt)
    || x.coreHash !== readCoreHash(core as any) || JSON.stringify(readCommandInput(x.request)) !== JSON.stringify(x.request)
    || x.request.tournamentId !== x.tournamentId || x.request.streamId !== x.streamId || x.request.witnessHash !== witnessHash(x.witness)
    || x.request.throughSequence < x.baselineSequence || x.requestHash !== readRequestHash(x.request)
    || x._id !== digest('tournament-chat-read-custody:v1', [x.tenantId, x.tournamentId, x.actorUserId, x.request.requestId])
    || (x.witness.kind === 'PARTICIPANT' ? x.witness.actorHash !== x.providerActorHash : x.witness.selectedUserId !== x.actorUserId)
    || (x.result !== undefined && (!validReadResult(x.result) || x.result.requestDocId !== x._id || x.result.coreHash !== x.coreHash || x.result.actorUserId !== x.actorUserId || x.result.throughSequence !== x.request.throughSequence))) throw unavailable();
  return x as ReadCandidate;
}
export function assertReadWitness(row: Record<string, any>, a: ChatActor, tournamentId: string, original: Witness) {
  const w = currentWitness(row, a, tournamentId, original.kind);
  if (witnessHash(w) !== witnessHash(original)) throw denied();
}
