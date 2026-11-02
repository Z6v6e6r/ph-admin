import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { assertLocalOnly, digest, object, operations, publicTournamentId, uuid } from './tournament-local-operation.contract';
import { organizerState } from './tournament-organizer.contract';

export const CHAT_VERSION = 'tournament-chat.v1';
export const CHAT_PENDING_LIMIT = 64;
export const CHAT_CAS_MS = 5000;
export const CHAT_PATH = '/internal/tournaments/chat/v1';
export const keys = (x: Record<string, any>, names: string) => Object.keys(x).sort().join(',') === names;
export const safe = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
export const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const unavailable = () => new ServiceUnavailableException({ code: 'TOURNAMENT_CHAT_UNAVAILABLE' });
export const denied = () => new ForbiddenException({ code: 'TOURNAMENT_CHAT_FORBIDDEN' });
export const conflict = () => new ConflictException({ code: 'TOURNAMENT_CHAT_REQUEST_CONFLICT' });
const invalid = () => new BadRequestException({ code: 'TOURNAMENT_CHAT_INPUT_INVALID' });
export type ChatActor = { tenantId: string; tenantKey: string; userId: string; sessionId: string;
  ownerTenantKey: string; providerClientId: string; expiresAt: number; correlationId: string };
export type Witness = { kind: 'PARTICIPANT'; generation: string; actorHash: string } |
  { kind: 'ORGANIZER'; revision: number; selectedUserId: string };
export type ChatSend = { contractVersion: 1; tournamentId: string; requestId: string; text: string };
export type ChatRead = { contractVersion: 1; tournamentId: string; requestId: string };
export type ChatHistory = { contractVersion: 1; tournamentId: string; limit: number; cursor?: string };
export function sendInput(x: unknown): ChatSend {
  if (!object(x) || !keys(x, 'contractVersion,requestId,text,tournamentId') || x.contractVersion !== 1
    || !uuid(x.tournamentId) || !uuid(x.requestId) || typeof x.text !== 'string' || !x.text.trim()
    || x.text.length > 8000 || Buffer.byteLength(x.text) > 32000 || Buffer.from(x.text).toString('utf8') !== x.text || x.text.includes('\0')) throw invalid();
  return { contractVersion: 1, tournamentId: x.tournamentId, requestId: x.requestId, text: x.text };
}
export function readInput(x: unknown): ChatRead {
  if (!object(x) || !keys(x, 'contractVersion,requestId,tournamentId') || x.contractVersion !== 1
    || !uuid(x.tournamentId) || !uuid(x.requestId)) throw invalid();
  return { contractVersion: 1, tournamentId: x.tournamentId, requestId: x.requestId };
}
export function historyInput(x: unknown): ChatHistory {
  if (!object(x) || !keys(x, x.cursor === undefined ? 'contractVersion,limit,tournamentId' : 'contractVersion,cursor,limit,tournamentId')
    || x.contractVersion !== 1 || !uuid(x.tournamentId) || !safe(x.limit) || x.limit < 1 || x.limit > 50
    || (x.cursor !== undefined && (typeof x.cursor !== 'string' || x.cursor.length > 1800))) throw invalid();
  return { contractVersion: 1, tournamentId: x.tournamentId, limit: x.limit, ...(x.cursor === undefined ? {} : { cursor: x.cursor }) };
}
// Exact serialization shared with the LK2 signer. No request object/property-order dependency.
export const bodyBytes = (x: ChatSend | ChatRead | ChatHistory) => JSON.stringify(x);
export const requestHash = (x: ChatSend) => digest('tournament-chat-request:v1', x);
export const requestId = (a: ChatActor, x: ChatRead) => digest('tournament-chat-custody:v1', [a.tenantId, x.tournamentId, a.userId, x.requestId]);
export function incarnation(row: Record<string, any>): string {
  const id = row._id;
  const typed = id instanceof ObjectId ? ['objectId', id.toHexString()] : typeof id === 'string' && id.length > 0 && id.length <= 200 ? ['string', id] : null;
  if (!typed || typeof row.id !== 'string' || row.id.length > 200) throw unavailable();
  return digest('tournament-chat-incarnation:v1', [typed, row.id]);
}
export function currentWitness(row: Record<string, any>, a: Pick<ChatActor, 'tenantId' | 'tenantKey' | 'ownerTenantKey' | 'providerClientId' | 'userId'>, tournamentId: string, chosenKind?: Witness['kind']): Witness {
  assertLocalOnly(row);
  if (row.status === 'CANCELED' || publicTournamentId(row.id) !== tournamentId) throw denied();
  const list = operations(row, a.ownerTenantKey);
  const organizer = organizerState(row, a.tenantId, a.tenantKey);
  if (organizer.ownerTenantKey !== null && organizer.ownerTenantKey !== a.ownerTenantKey) throw denied();
  const actorHash = digest('tournament-local-actor:v1', [a.ownerTenantKey, a.providerClientId]);
  const joins = list.filter(o => o.actorHash === actorHash && o.outcome === 'REGISTERED'
    && !list.some(l => l.outcome === 'LEFT' && l.generation === o.generation));
  if (joins.length > 1) throw unavailable();
  if (joins.length === 1 && chosenKind !== 'ORGANIZER') {
    const join = joins[0];
    const matches = row.participants.filter((p: any) => p.id === join.generation || p.phone === join.phone);
    if (matches.length !== 1 || matches[0].id !== join.generation || matches[0].phone !== join.phone
      || matches[0].status !== 'REGISTERED' || matches[0].paymentStatus !== 'UNPAID') throw denied();
    return { kind: 'PARTICIPANT', generation: join.generation!, actorHash };
  }
  if (organizer.selectedUserId === a.userId) return { kind: 'ORGANIZER', revision: organizer.revision, selectedUserId: a.userId };
  throw denied();
}
export const witnessHash = (w: Witness) => digest('tournament-chat-witness:v1', w);
export function validWitness(w: unknown): w is Witness {
  return object(w) && (w.kind === 'PARTICIPANT'
    ? keys(w, 'actorHash,generation,kind') && uuid(w.generation) && hash(w.actorHash)
    : w.kind === 'ORGANIZER' && keys(w, 'kind,revision,selectedUserId') && safe(w.revision) && w.revision > 0 && uuid(w.selectedUserId));
}
export type Pending = { requestDocId: string; sequence: number; coreHash: string; acceptedAt: string;
  actorUserId: string; correlationId: string; audit: 'TOURNAMENT_CHAT_ACCEPTED_V1' };
export type ChatState = { version: 1; tenantId: string; tenantKey: string; ownerTenantKey: string;
  tournamentId: string; incarnation: string; streamId: string; allocatedSequence: number; publishedSequence: number;
  pendingCount: number; pending: Pending[];
  bootstrap: { actorUserId: string; correlationId: string; at: string; audit: 'TOURNAMENT_CHAT_ADOPTED_V1' } };
const instant = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export function chatState(row: Record<string, any>): ChatState | null {
  if (!Object.prototype.hasOwnProperty.call(row, 'tournamentChatV1')) return null;
  const s = row.tournamentChatV1;
  if (!object(s) || !keys(s, 'allocatedSequence,bootstrap,incarnation,ownerTenantKey,pending,pendingCount,publishedSequence,streamId,tenantId,tenantKey,tournamentId,version')
    || s.version !== 1 || !uuid(s.tenantId) || !uuid(s.tournamentId) || !uuid(s.streamId)
    || typeof s.tenantKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(s.tenantKey)
    || typeof s.ownerTenantKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(s.ownerTenantKey)
    || s.incarnation !== incarnation(row) || s.tournamentId !== publicTournamentId(row.id)
    || !safe(s.allocatedSequence) || s.allocatedSequence >= Number.MAX_SAFE_INTEGER || !safe(s.publishedSequence) || s.allocatedSequence < s.publishedSequence
    || !Array.isArray(s.pending) || s.pending.length > CHAT_PENDING_LIMIT || s.pendingCount !== s.pending.length
    || s.allocatedSequence - s.publishedSequence !== s.pending.length
    || !object(s.bootstrap) || !keys(s.bootstrap, 'actorUserId,at,audit,correlationId') || !uuid(s.bootstrap.actorUserId)
    || !uuid(s.bootstrap.correlationId) || !instant(s.bootstrap.at) || s.bootstrap.audit !== 'TOURNAMENT_CHAT_ADOPTED_V1') throw unavailable();
  const ids = new Set<string>();
  for (let i = 0; i < s.pending.length; i++) {
    const p = s.pending[i];
    if (!object(p) || !keys(p, 'acceptedAt,actorUserId,audit,coreHash,correlationId,requestDocId,sequence')
      || !hash(p.requestDocId) || !hash(p.coreHash) || !uuid(p.actorUserId) || !uuid(p.correlationId)
      || p.sequence !== s.publishedSequence + i + 1 || !instant(p.acceptedAt) || p.audit !== 'TOURNAMENT_CHAT_ACCEPTED_V1'
      || ids.has(p.requestDocId)) throw unavailable();
    ids.add(p.requestDocId);
  }
  return s as ChatState;
}
export function newState(row: Record<string, any>, a: ChatActor, tournamentId: string): ChatState {
  return { version: 1, tenantId: a.tenantId, tenantKey: a.tenantKey, ownerTenantKey: a.ownerTenantKey, tournamentId,
    incarnation: incarnation(row), streamId: randomUUID(), allocatedSequence: 0, publishedSequence: 0,
    pendingCount: 0, pending: [], bootstrap: { actorUserId: a.userId, correlationId: a.correlationId,
      at: new Date().toISOString(), audit: 'TOURNAMENT_CHAT_ADOPTED_V1' } };
}
export function bindState(s: ChatState, a: ChatActor) {
  if (s.tenantId !== a.tenantId || s.tenantKey !== a.tenantKey || s.ownerTenantKey !== a.ownerTenantKey) throw denied();
}
export type Candidate = { _id: string; version: 1; tenantId: string; tenantKey: string; ownerTenantKey: string;
  tournamentId: string; incarnation: string; streamId: string; actorUserId: string; providerActorHash: string;
  request: ChatSend; requestHash: string; messageId: string; witness: Witness; createdAt: string; coreHash: string;
  publication?: Pending };
export const coreHash = (c: Omit<Candidate, 'coreHash' | 'publication'>) => digest('tournament-chat-core:v1', c);
export function candidate(row: Record<string, any>, s: ChatState, a: ChatActor, x: ChatSend, w: Witness): Candidate {
  const core = { _id: requestId(a, x), version: 1 as const, tenantId: a.tenantId, tenantKey: a.tenantKey,
    ownerTenantKey: a.ownerTenantKey, tournamentId: x.tournamentId, incarnation: incarnation(row), streamId: s.streamId,
    actorUserId: a.userId, providerActorHash: digest('tournament-local-actor:v1', [a.ownerTenantKey, a.providerClientId]),
    request: x, requestHash: requestHash(x), messageId: randomUUID(), witness: w, createdAt: new Date().toISOString() };
  return { ...core, coreHash: coreHash(core) };
}
export function parseCandidate(x: any): Candidate {
  const expected = '_id,actorUserId,coreHash,createdAt,incarnation,messageId,ownerTenantKey,providerActorHash,' + (x?.publication === undefined ? '' : 'publication,') + 'request,requestHash,streamId,tenantId,tenantKey,tournamentId,version,witness';
  if (!object(x) || !keys(x, expected)) throw unavailable();
  const core = { ...x }; delete core.coreHash; delete core.publication;
  if (x.version !== 1 || !hash(x._id) || !hash(x.incarnation) || !hash(x.providerActorHash) || !uuid(x.messageId)
    || !uuid(x.actorUserId) || !uuid(x.streamId) || !uuid(x.tenantId) || !uuid(x.tournamentId)
    || typeof x.tenantKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(x.tenantKey)
    || typeof x.ownerTenantKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(x.ownerTenantKey)
    || !validWitness(x.witness) || !instant(x.createdAt) || x.coreHash !== coreHash(core as any)
    || JSON.stringify(sendInput(x.request)) !== JSON.stringify(x.request) || x.request.tournamentId !== x.tournamentId
    || x.requestHash !== requestHash(x.request)
    || x._id !== digest('tournament-chat-custody:v1', [x.tenantId, x.tournamentId, x.actorUserId, x.request.requestId])
    || (x.witness.kind === 'PARTICIPANT' ? x.witness.actorHash !== x.providerActorHash : x.witness.selectedUserId !== x.actorUserId)) throw unavailable();
  if (x.publication !== undefined) {
    const p = x.publication;
    if (!object(p) || !keys(p, 'acceptedAt,actorUserId,audit,coreHash,correlationId,requestDocId,sequence') || p.requestDocId !== x._id
      || p.coreHash !== x.coreHash || p.actorUserId !== x.actorUserId || !safe(p.sequence) || p.sequence < 1
      || !uuid(p.correlationId) || !instant(p.acceptedAt) || p.audit !== 'TOURNAMENT_CHAT_ACCEPTED_V1') throw unavailable();
  }
  return x as Candidate;
}
export type Cursor = { v: 1; tenantId: string; tournamentId: string; actorUserId: string; streamId: string;
  witnessHash: string; through: number; before: number };
export function cursorInput(raw: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
    const bytes = Buffer.from(raw, 'base64url'); if (bytes.toString('base64url') !== raw) throw invalid();
    const c = JSON.parse(bytes.toString('utf8'));
    if (!object(c) || !keys(c, 'actorUserId,before,streamId,tenantId,through,tournamentId,v,witnessHash') || c.v !== 1
      || ![c.tenantId,c.tournamentId,c.actorUserId,c.streamId].every(uuid) || !hash(c.witnessHash)
      || !safe(c.through) || !safe(c.before) || c.before < 1 || c.before > c.through + 1) throw invalid();
    return c as Cursor;
  } catch { throw invalid(); }
}
export const cursorBytes = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
