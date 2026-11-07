import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { digest, object, publicTournamentId, uuid } from './tournament-local-operation.contract';

export const ORGANIZER_OPERATION_LIMIT = 128;
export const ORGANIZER_CAS_BUDGET_MS = 5000;
export type OrganizerCommand = { contractVersion: 1; operationId: string; action: 'ASSIGN' | 'REVOKE'; selectedUserId: string | null; expectedRevision: number };
export type OrganizerReceipt = {
  command: OrganizerCommand; actorId: string; requestHash: string; correlationId: string;
  outcome: 'ASSIGNED' | 'REVOKED' | 'REJECTED'; reason: 'ASSIGNED' | 'REVOKED' | 'REVISION_CONFLICT';
  resultingRevision: number; resultingSelectedUserId: string | null; committedAt: string;
  lookupExpiresAt: string | null; ownerTenantKey: string; audit: 'TOURNAMENT_ORGANIZER_ASSIGNMENT_V1';
};
export type OrganizerState = { contractVersion: 1; tenantId: string; tenantKey: string; tournamentId: string;
  ownerTenantKey: string | null; revision: number; selectedUserId: string | null; operations: OrganizerReceipt[] };
const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(',') === expected;
export function organizerCommand(v: unknown): OrganizerCommand {
  if (!object(v) || !keys(v, 'action,contractVersion,expectedRevision,operationId,selectedUserId') || v.contractVersion !== 1
    || !uuid(v.operationId) || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0
    || (v.action === 'ASSIGN' ? !uuid(v.selectedUserId) : v.action !== 'REVOKE' || v.selectedUserId !== null)) throw new BadRequestException({ code: 'TOURNAMENT_ORGANIZER_INPUT_INVALID' });
  return { contractVersion: 1, operationId: v.operationId, action: v.action, selectedUserId: v.selectedUserId, expectedRevision: v.expectedRevision };
}
export const organizerRequestHash = (tournamentId: string, command: OrganizerCommand) => digest('tournament-organizer-command:v1', [tournamentId, command]);
const invalid = () => new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_STATE_INVALID' });
export function organizerState(row: Record<string, any>, tenantId: string, tenantKey: string): OrganizerState {
  if (typeof row.id !== 'string' || !row.id || row.id.length > 200) throw invalid();
  const tournamentId = publicTournamentId(row.id);
  if (!Object.prototype.hasOwnProperty.call(row, 'tournamentOrganizerV1')) return { contractVersion: 1, tenantId, tenantKey, tournamentId, ownerTenantKey: null, revision: 0, selectedUserId: null, operations: [] };
  const s = row.tournamentOrganizerV1;
  if (!object(s) || !keys(s, 'contractVersion,operations,ownerTenantKey,revision,selectedUserId,tenantId,tenantKey,tournamentId') || s.contractVersion !== 1
    || typeof s.ownerTenantKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(s.ownerTenantKey)
    || s.tenantId !== tenantId || s.tenantKey !== tenantKey || s.tournamentId !== tournamentId
    || !Array.isArray(s.operations) || s.operations.length < 1 || s.operations.length > ORGANIZER_OPERATION_LIMIT) throw invalid();
  let revision = 0, selected: string | null = null;
  const ids = new Set<string>();
  for (const r of s.operations) {
    if (!object(r) || !keys(r, 'actorId,audit,command,committedAt,correlationId,lookupExpiresAt,outcome,ownerTenantKey,reason,requestHash,resultingRevision,resultingSelectedUserId')
      || typeof r.actorId !== 'string' || !r.actorId || r.actorId.length > 200 || !uuid(r.correlationId)
      || r.ownerTenantKey !== s.ownerTenantKey || r.audit !== 'TOURNAMENT_ORGANIZER_ASSIGNMENT_V1' || typeof r.committedAt !== 'string' || !Number.isFinite(Date.parse(r.committedAt))) throw invalid();
    if (r.lookupExpiresAt !== null && (typeof r.lookupExpiresAt !== 'string' || !Number.isFinite(Date.parse(r.lookupExpiresAt)) || Date.parse(r.lookupExpiresAt) <= Date.parse(r.committedAt))) throw invalid();
    let command: OrganizerCommand;
    try { command = organizerCommand(r.command); } catch { throw invalid(); }
    if (ids.has(command.operationId) || r.requestHash !== organizerRequestHash(tournamentId, command)) throw invalid();
    ids.add(command.operationId);
    if (r.outcome === 'REJECTED') {
      if (r.reason !== 'REVISION_CONFLICT' || command.expectedRevision === revision) throw invalid();
    } else {
      if (command.expectedRevision !== revision || revision === Number.MAX_SAFE_INTEGER) throw invalid();
      if (command.action === 'ASSIGN') {
        if (r.outcome !== 'ASSIGNED' || r.reason !== 'ASSIGNED' || typeof r.lookupExpiresAt !== 'string'
          || !Number.isFinite(Date.parse(r.lookupExpiresAt)) || Date.parse(r.lookupExpiresAt) <= Date.parse(r.committedAt)) throw invalid();
        selected = command.selectedUserId;
      } else {
        if (r.outcome !== 'REVOKED' || r.reason !== 'REVOKED' || r.lookupExpiresAt !== null) throw invalid();
        selected = null;
      }
      revision++;
    }
    if (r.resultingRevision !== revision || r.resultingSelectedUserId !== selected) throw invalid();
  }
  if (s.revision !== revision || s.selectedUserId !== selected || s.operations.length + (selected ? 1 : 0) > ORGANIZER_OPERATION_LIMIT) throw invalid();
  return s as OrganizerState;
}
export function organizerReplay(state: OrganizerState, command: OrganizerCommand, actorId: string): OrganizerReceipt | undefined {
  const receipt = state.operations.find(r => r.command.operationId === command.operationId);
  if (receipt && (receipt.actorId !== actorId || receipt.requestHash !== organizerRequestHash(state.tournamentId, command))) throw new ConflictException({ code: 'TOURNAMENT_ORGANIZER_OPERATION_CONFLICT' });
  return receipt;
}
export const organizerView = (state: OrganizerState, receipt?: OrganizerReceipt) => ({ contractVersion: 1,
  tournamentId: state.tournamentId, tenantId: state.tenantId,
  current: { revision: state.revision, selectedUserId: state.selectedUserId },
  ...(receipt ? { operation: { operationId: receipt.command.operationId, action: receipt.command.action,
    expectedRevision: receipt.command.expectedRevision, requestedSelectedUserId: receipt.command.selectedUserId,
    outcome: receipt.outcome, reason: receipt.reason, resultingRevision: receipt.resultingRevision,
    resultingSelectedUserId: receipt.resultingSelectedUserId, committedAt: receipt.committedAt } } : {}) });
