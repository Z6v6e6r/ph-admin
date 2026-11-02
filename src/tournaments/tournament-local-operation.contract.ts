import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const LOCAL_OPERATION_LIMIT = 512;
export type LocalCommand = { schemaVersion: 1; action: 'JOIN' | 'LEAVE'; tournamentId: string; date: string; originalJoinOperationId?: string };
export type LocalOperation = {
  schemaVersion: 1; tenantKey: string; actorHash: string; phone: string; keyHash: string;
  requestHash: string; operationId: string; command: LocalCommand; outcome: 'REGISTERED' | 'LEFT' | 'REJECTED';
  reason: 'REGISTERED' | 'LEFT' | 'FULL' | 'MEMBERSHIP_EXISTS' | 'GENERATION_NOT_CURRENT';
  generation: string | null; committedAt: string; mappingHash: string; eligibility: { gender: string; playerGender: string | null; levelLabel: string | null; accessLevels: string[]; ruleUpdatedAt: string }; audit: 'TOURNAMENT_LOCAL_OPERATION_V1';
};
export const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) && v.length === 36;
export const digest = (domain: string, value: unknown): string => createHash('sha256').update(domain + '\0').update(JSON.stringify(value)).digest('hex');
export function publicTournamentId(id: string): string {
  const b = createHash('sha256').update('phub-public-tournament-v1:' + id).digest().subarray(0, 16);
  b[6] = (b[6]! & 15) | 64; b[8] = (b[8]! & 63) | 128;
  const s = b.toString('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export function commandInput(v: unknown): LocalCommand {
  if (!object(v) || v.schemaVersion !== 1 || !['JOIN','LEAVE'].includes(v.action)
    || Object.keys(v).sort().join(',') !== (v.action === 'JOIN' ? 'action,date,schemaVersion,tournamentId' : 'action,date,originalJoinOperationId,schemaVersion,tournamentId')
    || !uuid(v.tournamentId) || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date.length !== 10
    || !Number.isFinite(Date.parse(v.date + 'T00:00:00Z')) || new Date(v.date + 'T00:00:00Z').toISOString().slice(0,10) !== v.date
    || (v.action === 'LEAVE' && !uuid(v.originalJoinOperationId))) throw new BadRequestException({ code: 'TOURNAMENT_LOCAL_INPUT_INVALID' });
  return { schemaVersion: 1, action: v.action, tournamentId: v.tournamentId, date: v.date,
    ...(v.action === 'LEAVE' ? { originalJoinOperationId: v.originalJoinOperationId } : {}) };
}
export function commandIdentity(tenant: string, clientId: string, key: unknown, command: LocalCommand) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key) || /[\r\n]/.test(key)) throw new BadRequestException({ code: 'TOURNAMENT_LOCAL_KEY_INVALID' });
  const actorHash = digest('tournament-local-actor:v1', [tenant, clientId]);
  const keyHash = digest('tournament-local-key:v1', [tenant, actorHash, command.tournamentId, key]);
  const h = digest('tournament-local-operation:v1', keyHash);
  const operationId = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
  return { actorHash, keyHash, operationId, requestHash: digest('tournament-local-request:v1', command) };
}
const absent = (v: unknown) => v === undefined || v === null;
const empty = (v: unknown) => Array.isArray(v) && v.length === 0;
/** Strict raw-document subset: presentation defaults never establish payment or provider authority. */
export function assertLocalOnly(row: Record<string, any>): void {
  const d = row.details, b = object(d) ? d.booking : undefined;
  if (row.source !== 'CUSTOM' || row.archived !== false || row.isPublic !== true
    || !absent(row.sourceTournamentId) || !absent(row.exerciseId) || !absent(row.sourceTournamentSnapshot)
    || !object(d) || !object(b) || !absent(d.joinFlow) || !absent(d.sourceTournamentSnapshot)
    || b.enabled !== false || b.paymentRequired !== false
    || !empty(b.acceptedSubscriptions) || !empty(b.purchaseOptions)
    || Object.keys(b).some(k => !['enabled','paymentRequired','acceptedSubscriptions','purchaseOptions'].includes(k))
    || !absent(row.pricePopover) || !absent(row.summerSubscriptionOffer) || row.hasFriendlySubscriptionTag === true
    || (object(row.skin) && !absent(row.skin.priceLabel))
    || !Array.isArray(row.participants) || !Array.isArray(row.waitlist)
    || [...row.participants, ...row.waitlist].some(p => !object(p) || typeof p.phone !== 'string' || !uuid(p.id) || p.paymentStatus !== 'UNPAID' || p.paidAt != null)
    || !Number.isInteger(row.maxPlayers) || row.maxPlayers < 2 || row.maxPlayers > 512
    || !['PLANNED','REGISTRATION','RUNNING','FINISHED','CANCELED'].includes(row.status)
    || !['MALE','FEMALE','MIXED'].includes(row.gender) || !Array.isArray(row.accessLevels)
    || row.accessLevels.some((x: unknown) => typeof x !== 'string')
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) {
    throw new ConflictException({ code: 'TOURNAMENT_LOCAL_UNSUPPORTED' });
  }
}
export function operations(row: Record<string, any>, tenant: string): LocalOperation[] {
  if (!Object.prototype.hasOwnProperty.call(row, 'localParticipationOperations')) {
    if (row.localParticipationTenantKey !== undefined) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
    return [];
  }
  const list = row.localParticipationOperations;
  if (row.localParticipationTenantKey !== tenant || !Array.isArray(list) || list.length < 1 || list.length > LOCAL_OPERATION_LIMIT) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
  const ids = new Set(); const keys = new Set();
  for (const x of list) {
    if (!object(x) || Object.keys(x).sort().join(',') !== 'actorHash,audit,command,committedAt,eligibility,generation,keyHash,mappingHash,operationId,outcome,phone,reason,requestHash,schemaVersion,tenantKey' || x.schemaVersion !== 1 || x.tenantKey !== tenant || !uuid(x.operationId)
      || ![x.actorHash,x.keyHash,x.requestHash,x.mappingHash].every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))
      || !object(x.eligibility) || Object.keys(x.eligibility).sort().join(',') !== 'accessLevels,gender,levelLabel,playerGender,ruleUpdatedAt'
      || !Array.isArray(x.eligibility.accessLevels) || x.eligibility.accessLevels.some((v: unknown) => typeof v !== 'string')
      || !['MALE','FEMALE','MIXED'].includes(x.eligibility.gender)
      || (x.eligibility.gender === 'MIXED' ? x.eligibility.playerGender !== null : x.eligibility.playerGender !== x.eligibility.gender)
      || (x.eligibility.levelLabel !== null && typeof x.eligibility.levelLabel !== 'string')
      || typeof x.eligibility.ruleUpdatedAt !== 'string' || !Number.isFinite(Date.parse(x.eligibility.ruleUpdatedAt))
      || typeof x.phone !== 'string' || !/^\d{10,15}$/.test(x.phone)
      || !['REGISTERED','LEFT','REJECTED'].includes(x.outcome)
      || !['REGISTERED','LEFT','FULL','MEMBERSHIP_EXISTS','GENERATION_NOT_CURRENT'].includes(x.reason)
      || (x.generation !== null && !uuid(x.generation)) || x.audit !== 'TOURNAMENT_LOCAL_OPERATION_V1'
      || typeof x.committedAt !== 'string' || !Number.isFinite(Date.parse(x.committedAt)) || Date.parse(x.committedAt) > Date.now()
      || ids.has(x.operationId) || keys.has(x.keyHash)) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
    let command: LocalCommand;
    try { command = commandInput(x.command); } catch { throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' }); }
    if (x.requestHash !== digest('tournament-local-request:v1', command) || command.tournamentId !== publicTournamentId(row.id)
      || (x.outcome === 'REGISTERED' && (command.action !== 'JOIN' || x.reason !== 'REGISTERED' || x.generation !== x.operationId))
      || (x.outcome === 'LEFT' && (command.action !== 'LEAVE' || x.reason !== 'LEFT' || x.generation !== command.originalJoinOperationId))
      || (x.outcome === 'REJECTED' && (['REGISTERED','LEFT'].includes(x.reason) || x.generation !== null))) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
    const h = digest('tournament-local-operation:v1', x.keyHash);
    const expectedId = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
    if (x.operationId !== expectedId) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
    if (x.outcome === 'LEFT') {
      const original = list.find((candidate: any) => candidate.operationId === x.generation);
      if (!original || original.outcome !== 'REGISTERED' || original.actorHash !== x.actorHash || original.phone !== x.phone
        || original.command.date !== command.date || Date.parse(original.committedAt) > Date.parse(x.committedAt)
        || list.filter((candidate: any) => candidate.outcome === 'LEFT' && candidate.generation === x.generation).length !== 1) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
    }
    ids.add(x.operationId); keys.add(x.keyHash);
  }
  const active = list.filter((x: any) => x.outcome === 'REGISTERED'
    && !list.some((left: any) => left.outcome === 'LEFT' && left.generation === x.generation)).length;
  if (list.length + active > LOCAL_OPERATION_LIMIT) throw new ServiceUnavailableException({ code: 'TOURNAMENT_LOCAL_STATE_INVALID' });
  return list as LocalOperation[];
}
export function operationView(row: Record<string, any>, op: LocalOperation) {
  const original = op.command.action === 'JOIN' ? op.operationId : op.command.originalJoinOperationId;
  const roster = Array.isArray(row.participants) ? row.participants : [];
  const matching = roster.filter((p: any) => p.id === original || p.phone === op.phone);
  const current = matching.length === 1 && matching[0].id === original && matching[0].phone === op.phone
    && matching[0].status === 'REGISTERED' && matching[0].paymentStatus === 'UNPAID';
  const safe = row.archived === false && ['PLANNED','REGISTRATION','RUNNING'].includes(row.status);
  return { schemaVersion: 1 as const, tournamentId: op.command.tournamentId,
    operation: { operationId: op.operationId, action: op.command.action, outcome: op.outcome, reason: op.reason,
      generation: op.generation, committedAt: op.committedAt },
    registration: { status: safe && current ? 'REGISTERED' : matching.length === 0 && Array.isArray(row.participants) ? 'NOT_REGISTERED_BY_OPERATION' : 'UNKNOWN', asOf: new Date().toISOString() } };
}
