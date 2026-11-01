import { Injectable } from '@nestjs/common';
import { Document } from 'mongodb';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { Candidate, CHAT_CAS_MS, ChatState, Pending, parseCandidate, unavailable } from './tournament-chat.contract';

// Source declarations only. Application startup and requests NEVER create these indexes.
export const CHAT_INDEXES = {
  requests: [
    { name: 'tournament_chat_sequence_v1', key: { tenantId: 1, tournamentId: 1, streamId: 1, 'publication.sequence': -1 },
      unique: true, partialFilterExpression: { 'publication.sequence': { $type: 'number' } }, collation: { locale: 'simple' } }
  ],
  tournaments: [
    { name: 'tournament_chat_pending_v1', key: { 'tournamentChatV1.pendingCount': 1, _id: 1 }, collation: { locale: 'simple' } }
  ]
} as const;
const read = { readPreference: 'primary' as const, readConcern: { level: 'majority' as const }, maxTimeMS: 2000 };
const write = { writeConcern: { w: 'majority' as const, j: true, wtimeoutMS: CHAT_CAS_MS }, maxTimeMS: CHAT_CAS_MS };
function matchesIndex(actual: any, wanted: any): boolean {
  return actual.name === wanted.name && JSON.stringify(actual.key) === JSON.stringify(wanted.key)
    && !!actual.unique === !!wanted.unique && !actual.sparse && !actual.hidden && actual.expireAfterSeconds === undefined
    && JSON.stringify(actual.partialFilterExpression) === JSON.stringify(wanted.partialFilterExpression)
    && (!actual.collation || actual.collation.locale === 'simple');
}
@Injectable()
export class TournamentChatPersistence {
  constructor(private readonly tournaments: TournamentsPersistenceService) {}
  async ready() {
    const c = await this.tournaments.tournamentChatCollections();
    for (const [name, wanted] of [[c.requests.collectionName, CHAT_INDEXES.requests], [c.tournaments.collectionName, CHAT_INDEXES.tournaments]] as const) {
      const metadata = await c.db.listCollections({ name }, { nameOnly: false, maxTimeMS: 2000 }).toArray();
      if (metadata.length !== 1 || metadata[0].type !== 'collection' || metadata[0].options?.capped
        || (metadata[0].options?.collation && metadata[0].options.collation.locale !== 'simple')) throw unavailable();
      const indexes = await c.db.collection(name).listIndexes({ maxTimeMS: 2000 }).toArray();
      if (indexes.some(i => i.expireAfterSeconds !== undefined) || !indexes.some(i => i.name === '_id_' && JSON.stringify(i.key) === '{"_id":1}')
        || !wanted.every(w => indexes.some(i => matchesIndex(i, w)))) throw unavailable();
    }
  }
  readTarget(tournamentId: string) { return this.tournaments.readLocalParticipationTarget(tournamentId); }
  async readRequest(id: string): Promise<Candidate | null> {
    const { requests } = await this.tournaments.tournamentChatCollections();
    const doc = await requests.findOne({ _id: id } as Document, read);
    return doc ? parseCandidate(doc) : null;
  }
  async insertCandidate(c: Candidate): Promise<Candidate> {
    const { requests } = await this.tournaments.tournamentChatCollections();
    try { await requests.insertOne(c as unknown as Document, write); } catch { /* Read exact original after duplicate or lost ACK. */ }
    const stored = await this.readRequest(c._id); if (!stored) throw unavailable(); return stored;
  }
  async cas(row: Record<string, any>, state: ChatState, expiresAt?: number): Promise<Record<string, any> | null> {
    const { tournaments } = await this.tournaments.tournamentChatCollections();
    return tournaments.findOneAndUpdate({ _id: row._id, $expr: { $and: [
      { $eq: ['$$ROOT', { $literal: row }] },
      ...(expiresAt === undefined ? [] : [{ $lt: ['$$NOW', new Date(expiresAt - CHAT_CAS_MS)] }])
    ] } }, { $set: { tournamentChatV1: state } }, { ...write, returnDocument: 'after' });
  }
  async publish(c: Candidate, p: Pending): Promise<Candidate> {
    if (c.publication) {
      if (JSON.stringify(c.publication) !== JSON.stringify(p)) throw unavailable();
      return c;
    }
    const { requests } = await this.tournaments.tournamentChatCollections();
    try {
      await requests.updateOne({ _id: c._id, $expr: { $eq: ['$$ROOT', { $literal: c }] } } as Document,
        { $set: { publication: p } }, write);
    } catch { /* Exact majority readback, never infer publication from the attempted update. */ }
    const after = await this.readRequest(c._id);
    if (!after || after.coreHash !== c.coreHash || JSON.stringify(after.publication) !== JSON.stringify(p)) throw unavailable();
    return after;
  }
  async history(s: ChatState, through: number, before: number, limit: number): Promise<Candidate[]> {
    const { requests } = await this.tournaments.tournamentChatCollections();
    const docs = await requests.find({ tenantId: s.tenantId, tournamentId: s.tournamentId, streamId: s.streamId,
      'publication.sequence': { $type: 'number', $lte: through, $lt: before } }, read)
      .hint('tournament_chat_sequence_v1').collation({ locale: 'simple' }).sort({ 'publication.sequence': -1 }).limit(limit + 1).toArray();
    return docs.map(parseCandidate);
  }
  async pendingTargets(): Promise<Record<string, any>[]> {
    const { tournaments } = await this.tournaments.tournamentChatCollections();
    return tournaments.find({ 'tournamentChatV1.pendingCount': { $gt: 0 } }, read)
      .hint('tournament_chat_pending_v1').collation({ locale: 'simple' })
      .sort({ 'tournamentChatV1.pendingCount': 1, _id: 1 }).limit(4).toArray();
  }
}
