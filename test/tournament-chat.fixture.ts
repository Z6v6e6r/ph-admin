import { ReadCandidate, ReadState, ReadResult, adoptReadState, parseReadCandidate } from '../src/tournaments/tournament-chat-read.contract';
import { randomUUID } from 'node:crypto';
import { ChatActor, Candidate, ChatState, ChatSend, Pending, requestId, parseCandidate } from '../src/tournaments/tournament-chat.contract';
import { commandIdentity, digest, LocalOperation, publicTournamentId } from '../src/tournaments/tournament-local-operation.contract';
import { organizerRequestHash, OrganizerCommand } from '../src/tournaments/tournament-organizer.contract';
import { TournamentChatPersistence } from '../src/tournaments/tournament-chat.persistence';
import { TournamentChatService } from '../src/tournaments/tournament-chat.service';
export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function actor(): ChatActor { return { tenantId: randomUUID(), tenantKey: 'synthetic', userId: randomUUID(), sessionId: randomUUID(),
  ownerTenantKey: 'provider-synthetic', providerClientId: 'synthetic-client', expiresAt: Date.now() + 30000, correlationId: randomUUID() }; }
export function raw(a: ChatActor, id = 'synthetic-' + randomUUID()): Record<string, any> {
  const command = { schemaVersion: 1 as const, action: 'JOIN' as const, tournamentId: publicTournamentId(id), date: '2026-11-01' };
  const identity = commandIdentity(a.ownerTenantKey, a.providerClientId, 'synthetic-join-key', command);
  const op: LocalOperation = { ...identity, schemaVersion: 1, tenantKey: a.ownerTenantKey, phone: '12025550101', command,
    outcome: 'REGISTERED', reason: 'REGISTERED', generation: identity.operationId, committedAt: new Date().toISOString(),
    mappingHash: 'a'.repeat(64), eligibility: { gender: 'MIXED', playerGender: null, levelLabel: null, accessLevels: [], ruleUpdatedAt: '2026-11-01T00:00:00.000Z' }, audit: 'TOURNAMENT_LOCAL_OPERATION_V1' };
  return { _id: 'synthetic-object-' + randomUUID(), id, slug: id, name: 'Synthetic', source: 'CUSTOM', studioId: 'synthetic-station',
    archived: false, isPublic: true, status: 'REGISTRATION', gender: 'MIXED', accessLevels: [], maxPlayers: 4,
    participants: [{ id: op.generation, phone: op.phone, name: 'Synthetic', status: 'REGISTERED', paymentStatus: 'UNPAID' }], waitlist: [],
    updatedAt: '2026-11-01T00:00:00.000Z', details: { booking: { enabled: false, paymentRequired: false, acceptedSubscriptions: [], purchaseOptions: [] } },
    localParticipationTenantKey: a.ownerTenantKey, localParticipationOperations: [op] };
}
export function leave(row: Record<string, any>, a: ChatActor) {
  const join = row.localParticipationOperations.find((o: LocalOperation) => o.outcome === 'REGISTERED' && !row.localParticipationOperations.some((l: LocalOperation) => l.outcome === 'LEFT' && l.generation === o.generation));
  const command = { schemaVersion: 1 as const, action: 'LEAVE' as const, tournamentId: publicTournamentId(row.id), date: join.command.date, originalJoinOperationId: join.generation };
  const id = commandIdentity(a.ownerTenantKey, a.providerClientId, 'synthetic-leave-' + randomUUID(), command);
  row.localParticipationOperations.push({ ...copy(join), ...id, command, outcome: 'LEFT', reason: 'LEFT', generation: join.generation }); row.participants = [];
}
export function rejoin(row: Record<string, any>, a: ChatActor) {
  const join = copy(row.localParticipationOperations[0]); const id = commandIdentity(a.ownerTenantKey, a.providerClientId, 'new-join-' + randomUUID(), join.command);
  Object.assign(join, id, { generation: id.operationId }); row.localParticipationOperations.push(join);
  row.participants = [{ id: id.operationId, phone: join.phone, name: 'Synthetic', status: 'REGISTERED', paymentStatus: 'UNPAID' }];
}
export function organizer(row: Record<string, any>, a: ChatActor, selected: string | null = a.userId) {
  const s = row.tournamentOrganizerV1 ?? { contractVersion: 1, tenantId: a.tenantId, tenantKey: a.tenantKey,
    ownerTenantKey: a.ownerTenantKey, tournamentId: publicTournamentId(row.id), revision: 0, selectedUserId: null, operations: [] };
  const command: OrganizerCommand = { contractVersion: 1, operationId: randomUUID(), action: selected ? 'ASSIGN' : 'REVOKE', selectedUserId: selected, expectedRevision: s.revision };
  const outcome = selected ? 'ASSIGNED' : 'REVOKED';
  s.operations.push({ command, actorId: 'synthetic-staff', requestHash: organizerRequestHash(s.tournamentId, command), correlationId: randomUUID(),
    outcome, reason: outcome, resultingRevision: s.revision + 1, resultingSelectedUserId: selected, committedAt: new Date().toISOString(),
    lookupExpiresAt: selected ? new Date(Date.now() + 30000).toISOString() : null, ownerTenantKey: a.ownerTenantKey, audit: 'TOURNAMENT_ORGANIZER_ASSIGNMENT_V1' });
  s.revision++; s.selectedUserId = selected; row.tournamentOrganizerV1 = s;
}
export class MemoryStore {
  row: Record<string, any>; docs = new Map<string, Candidate>(); writes = 0; readyCalls = 0;
  beforeCas?: (state: ChatState) => void; afterInsert?: () => void; beforePublish?: () => void; afterHistory?: () => void;
  lostCasAck = false; lostInsert = false; failPublish = false; lostPublishAck = false;
  constructor(row: Record<string, any>) { this.row = copy(row); }
  async ready() { this.readyCalls++; }
  async readTarget(id: string) { return id === publicTournamentId(this.row.id) ? copy(this.row) : null; }
  async readRequest(id: string) { const x = this.docs.get(id); return x ? parseCandidate(copy(x)) : null; }
  async insertCandidate(c: Candidate) { if (this.lostInsert) throw Error('synthetic-insert-failure'); if (!this.docs.has(c._id)) { this.docs.set(c._id, copy(c)); this.writes++; } this.afterInsert?.(); return (await this.readRequest(c._id))!; }
  async cas(before: Record<string, any>, s: ChatState, expiry?: number) {
    this.beforeCas?.(s);
    if (JSON.stringify(before) !== JSON.stringify(this.row) || (expiry !== undefined && expiry - 5000 <= Date.now())) return null;
    if (!Object.prototype.hasOwnProperty.call(before, 'tournamentChatV1')) this.row.tournamentChatReadV1 = adoptReadState(before, s);
    this.row.tournamentChatV1 = copy(s); this.writes++; if (this.lostCasAck) throw Error('synthetic-lost-ack'); return copy(this.row);
  }
  async publish(c: Candidate, p: Pending) { this.beforePublish?.(); if (this.failPublish) throw Error('synthetic-publish-failure');
    const doc = this.docs.get(c._id)!; if (doc.publication && JSON.stringify(doc.publication) !== JSON.stringify(p)) throw Error('synthetic-conflict');
    if (!doc.publication) { doc.publication = copy(p); this.writes++; } if (this.lostPublishAck) throw Error('synthetic-publish-lost-ack'); return copy(doc); }
  async history(s: ChatState, through: number, before: number, limit: number) { const result = [...this.docs.values()].filter(c => c.streamId === s.streamId && c.publication && c.publication.sequence <= through && c.publication.sequence < before).sort((a,b) => b.publication!.sequence - a.publication!.sequence).slice(0,limit+1).map(copy); this.afterHistory?.(); return result; }
  readDocs = new Map<string, ReadCandidate>(); failReadFinish = false; beforeReadCas?: () => void; afterReadInsert?: () => void;
  async readyReads() { await this.ready(); }
  async readReadRequest(id: string) { const d = this.readDocs.get(id); return d ? parseReadCandidate(copy(d)) : null; }
  async insertReadCandidate(c: ReadCandidate) { if (!this.readDocs.has(c._id)) { this.readDocs.set(c._id, copy(c)); this.writes++; } this.afterReadInsert?.(); return (await this.readReadRequest(c._id))!; }
  async casRead(before: Record<string, any>, s: ReadState, expiry?: number) {
    this.beforeReadCas?.();
    if (JSON.stringify(before) !== JSON.stringify(this.row) || (expiry !== undefined && expiry - 5000 <= Date.now())) return null;
    this.row.tournamentChatReadV1 = copy(s); this.writes++; return copy(this.row);
  }
  async finishRead(c: ReadCandidate, p: ReadResult) { if (this.failReadFinish) throw Error('synthetic-read-failure');
    const d = this.readDocs.get(c._id)!; if (d.result && JSON.stringify(d.result) !== JSON.stringify(p)) throw Error('synthetic-conflict');
    if (!d.result) { d.result = copy(p); this.writes++; } return copy(d); }
  async pendingReadTargets() { return this.row.tournamentChatReadV1?.pendingCount ? [copy(this.row)] : []; }
  async pendingTargets() { return this.row.tournamentChatV1?.pendingCount ? [copy(this.row)] : []; }
}
export function fixture() { const a = actor(), store = new MemoryStore(raw(a)), service = new TournamentChatService(store as unknown as TournamentChatPersistence);
  const input = (text = 'Synthetic message'): ChatSend => ({ contractVersion: 1, tournamentId: publicTournamentId(store.row.id), requestId: randomUUID(), text });
  return { a, store, service, input, id: (x: ChatSend) => requestId(a,x) };
}
