import { Injectable } from '@nestjs/common';
import { TournamentChatPersistence } from './tournament-chat.persistence';
import { bindState, candidate, Candidate, CHAT_CAS_MS, CHAT_PENDING_LIMIT, CHAT_VERSION, ChatActor, ChatHistory, ChatRead, ChatSend,
  ChatState, chatState, conflict, currentWitness, cursorBytes, cursorInput, denied, incarnation, newState, Pending,
  requestHash, requestId, unavailable, witnessHash } from './tournament-chat.contract';
import { digest } from './tournament-local-operation.contract';

@Injectable()
export class TournamentChatService {
  readonly metrics = { accepted: 0, published: 0, unknown: 0, recoveryFailed: 0 };
  constructor(private readonly store: TournamentChatPersistence) {}
  private fresh(a: ChatActor, budget = 0) { if (a.expiresAt <= Date.now() + budget) throw denied(); }
  private async target(a: ChatActor, tournamentId: string) {
    this.fresh(a);
    const row = await this.store.readTarget(tournamentId); if (!row) throw denied();
    const witness = currentWitness(row, a, tournamentId), state = chatState(row);
    if (state) bindState(state, a);
    this.fresh(a); return { row, state, witness };
  }
  private original(c: Candidate, a: ChatActor, x: ChatRead, row: Record<string, any>, state: ChatState | null) {
    if (c._id !== requestId(a, x) || c.actorUserId !== a.userId || c.tenantId !== a.tenantId
      || c.tenantKey !== a.tenantKey || c.ownerTenantKey !== a.ownerTenantKey || c.tournamentId !== x.tournamentId
      || c.request.requestId !== x.requestId || c.incarnation !== incarnation(row) || !state || c.streamId !== state.streamId
      || c.providerActorHash !== digest('tournament-local-actor:v1', [a.ownerTenantKey, a.providerClientId])) throw conflict();
  }
  private unknown(x: ChatRead) { this.metrics.unknown++; return { contractVersion: CHAT_VERSION, tournamentId: x.tournamentId, requestId: x.requestId, status: 'UNKNOWN' as const }; }
  private confirmed(c: Candidate) {
    return { contractVersion: CHAT_VERSION, tournamentId: c.tournamentId, requestId: c.request.requestId,
      status: 'CONFIRMED' as const, requestHash: c.requestHash, streamId: c.streamId, messageId: c.messageId, sequence: c.publication!.sequence };
  }
  async send(a: ChatActor, x: ChatSend) {
    await this.store.ready();
    // Original custody lookup always precedes generating a stream, message UUID or witness.
    let c = await this.store.readRequest(requestId(a, x));
    let t = await this.target(a, x.tournamentId);
    if (c) {
      this.original(c, a, x, t.row, t.state);
      if (c.requestHash !== requestHash(x)) throw conflict();
    } else {
      if (!t.state) {
        this.fresh(a, CHAT_CAS_MS);
        const expectedIncarnation = incarnation(t.row);
        try { await this.store.cas(t.row, newState(t.row, a, x.tournamentId), a.expiresAt); } catch { /* Adoption ACK may be lost. */ }
        t = await this.target(a, x.tournamentId);
        if (!t.state || incarnation(t.row) !== expectedIncarnation) throw unavailable();
      }
      if (t.state!.pendingCount >= CHAT_PENDING_LIMIT) throw unavailable();
      this.fresh(a, CHAT_CAS_MS);
      c = await this.store.insertCandidate(candidate(t.row, t.state!, a, x, t.witness));
      this.original(c, a, x, t.row, t.state);
      if (c.requestHash !== requestHash(x)) throw conflict();
    }
    // Re-read after candidate insertion. No stale pre-insert ACL can accept the message.
    t = await this.target(a, x.tournamentId);
    // Publication is written before pending removal. Read the immutable candidate AFTER this
    // captured raw preimage: a removed intent must not be reaccepted from an earlier candidate.
    const freshCandidate = await this.store.readRequest(c._id);
    if (!freshCandidate || freshCandidate.coreHash !== c.coreHash) throw unavailable();
    c = freshCandidate;
    this.original(c, a, x, t.row, t.state);
    const state = t.state!;
    const accepted = state.pending.find(p => p.requestDocId === c!._id);
    if (accepted && accepted.coreHash !== c.coreHash) throw unavailable();
    if (!accepted && !c.publication) {
      const chosen = currentWitness(t.row, a, x.tournamentId, c.witness.kind);
      if (witnessHash(chosen) !== witnessHash(c.witness)) throw denied();
      if (state.pendingCount >= CHAT_PENDING_LIMIT || state.allocatedSequence >= Number.MAX_SAFE_INTEGER - 1) throw unavailable();
      const p: Pending = { requestDocId: c._id, coreHash: c.coreHash, actorUserId: a.userId, correlationId: a.correlationId,
        sequence: state.allocatedSequence + 1, acceptedAt: new Date().toISOString(), audit: 'TOURNAMENT_CHAT_ACCEPTED_V1' };
      const next = { ...state, allocatedSequence: p.sequence, pendingCount: state.pendingCount + 1, pending: [...state.pending, p] };
      chatState({ ...t.row, tournamentChatV1: next }); this.fresh(a, CHAT_CAS_MS);
      try { if (await this.store.cas(t.row, next, a.expiresAt)) this.metrics.accepted++; } catch { /* Recover from durable state only. */ }
    }
    // POST may finish already accepted work. Failure is UNKNOWN; GET never invokes this path.
    try { await this.recoverOne(x.tournamentId); } catch { this.metrics.recoveryFailed++; }
    return this.status(a, x);
  }
  async status(a: ChatActor, x: ChatRead) {
    await this.store.ready();
    const before = await this.target(a, x.tournamentId);
    const c = await this.store.readRequest(requestId(a, x));
    const after = await this.target(a, x.tournamentId);
    if (incarnation(before.row) !== incarnation(after.row)) throw denied();
    if (!c) return this.unknown(x);
    this.original(c, a, x, after.row, after.state);
    if (!c.publication || c.publication.sequence > after.state!.publishedSequence) return this.unknown(x);
    return this.confirmed(c);
  }
  async history(a: ChatActor, x: ChatHistory) {
    await this.store.ready();
    const before = await this.target(a, x.tournamentId), state = before.state;
    if (!state) {
      if (x.cursor) throw conflict();
      return { contractVersion: CHAT_VERSION, tournamentId: x.tournamentId, streamId: null,
        throughSequence: 0, messages: [], nextCursor: null, hasMore: false };
    }
    const c = x.cursor ? cursorInput(x.cursor) : { v: 1 as const, tenantId: a.tenantId, tournamentId: x.tournamentId,
      actorUserId: a.userId, streamId: state.streamId, witnessHash: witnessHash(before.witness),
      through: state.publishedSequence, before: state.publishedSequence + 1 };
    if (c.tenantId !== a.tenantId || c.tournamentId !== x.tournamentId || c.actorUserId !== a.userId
      || c.streamId !== state.streamId || c.witnessHash !== witnessHash(before.witness) || c.through > state.publishedSequence) throw conflict();
    const docs = await this.store.history(state, c.through, c.before, x.limit);
    let previous = Math.min(c.before, c.through + 1);
    for (const d of docs) {
      if (d.tenantId !== a.tenantId || d.tournamentId !== x.tournamentId || d.streamId !== state.streamId || d.incarnation !== state.incarnation
        || !d.publication || d.publication.sequence > c.through || d.publication.sequence !== previous - 1) throw unavailable();
      previous = d.publication.sequence;
    }
    if (docs.length <= x.limit && previous !== 1) throw unavailable();
    const after = await this.target(a, x.tournamentId);
    if (!after.state || after.state.streamId !== state.streamId || incarnation(after.row) !== incarnation(before.row)
      || witnessHash(after.witness) !== c.witnessHash || after.state.publishedSequence < c.through) throw denied();
    const hasMore = docs.length > x.limit, kept = docs.slice(0, x.limit);
    return { contractVersion: CHAT_VERSION, tournamentId: x.tournamentId, streamId: state.streamId, throughSequence: c.through,
      messages: kept.map(d => ({ messageId: d.messageId, authorUserId: d.actorUserId, text: d.request.text,
        sequence: d.publication!.sequence, acceptedAt: d.publication!.acceptedAt })), hasMore,
      nextCursor: hasMore ? cursorBytes({ ...c, before: kept[kept.length - 1].publication!.sequence }) : null };
  }
  /** One oldest accepted intent per call, no actor credential and no fresh acceptance. */
  async recoverOne(tournamentId: string): Promise<boolean> {
    await this.store.ready();
    const row = await this.store.readTarget(tournamentId); if (!row) throw unavailable();
    const state = chatState(row); if (!state || !state.pending.length) return false;
    const p = state.pending[0], c = await this.store.readRequest(p.requestDocId);
    if (!c || c.coreHash !== p.coreHash || c.actorUserId !== p.actorUserId || c.streamId !== state.streamId
      || c.incarnation !== state.incarnation || c.tenantId !== state.tenantId || c.tournamentId !== state.tournamentId) throw unavailable();
    await this.store.publish(c, p);
    // Full-root CAS competes safely with leave/revoke and newer accepted sends. A miss keeps custody.
    const next = { ...state, publishedSequence: p.sequence, pendingCount: state.pendingCount - 1, pending: state.pending.slice(1) };
    chatState({ ...row, tournamentChatV1: next });
    try { await this.store.cas(row, next); } catch { /* Frontier ACK may be lost. */ }
    const after = await this.store.readTarget(tournamentId), final = after && chatState(after);
    if (!final || final.streamId !== state.streamId || final.incarnation !== state.incarnation || final.publishedSequence < p.sequence) return false;
    this.metrics.published++; return true;
  }
  async recoveryTick(): Promise<{ recovered: number; failed: number }> {
    await this.store.ready();
    const rows = await this.store.pendingTargets(); let recovered = 0, failed = 0;
    for (const row of rows) {
      try { const s = chatState(row); if (!s) throw unavailable(); if (await this.recoverOne(s.tournamentId)) recovered++; }
      catch { failed++; this.metrics.recoveryFailed++; }
    }
    return { recovered, failed };
  }
}
