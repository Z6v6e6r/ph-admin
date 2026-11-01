import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../common/rbac/request-user.interface';
import { assertLocalOnly, uuid } from './tournament-local-operation.contract';
import { organizerCommand, organizerReplay, organizerRequestHash, organizerState, organizerView, ORGANIZER_OPERATION_LIMIT, ORGANIZER_CAS_BUDGET_MS, OrganizerReceipt } from './tournament-organizer.contract';
import { TournamentOrganizerLookupClient } from './tournament-organizer-lookup.client';
import { TournamentsPersistenceService } from './tournaments-persistence.service';
import { TournamentsService } from './tournaments.service';

@Injectable()
export class TournamentOrganizerService {
  constructor(private readonly persistence: TournamentsPersistenceService, private readonly tournaments: TournamentsService,
    private readonly lookupClient: TournamentOrganizerLookupClient) {}
  private async target(id: string, user: RequestUser | undefined) {
    if (typeof id !== 'string' || id.length > 200 || !id) throw new BadRequestException({ code: 'TOURNAMENT_ORGANIZER_INPUT_INVALID' });
    const row = await this.persistence.readOrganizerTarget(id);
    if (!row) throw new NotFoundException({ code: 'TOURNAMENT_ORGANIZER_NOT_FOUND' });
    this.tournaments.assertOrganizerTargetAccess(row, user);
    const c = this.lookupClient.config;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(c.expectedOwnerTenantKey) || !uuid(c.tenantId) || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(c.tenantKey)) throw new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_DISABLED' });
    const state = organizerState(row, c.tenantId, c.tenantKey);
    if ((state.ownerTenantKey !== null && state.ownerTenantKey !== c.expectedOwnerTenantKey)
      || (Object.prototype.hasOwnProperty.call(row, 'localParticipationTenantKey') && row.localParticipationTenantKey !== c.expectedOwnerTenantKey)) {
      throw new ForbiddenException({ code: 'TOURNAMENT_ORGANIZER_TENANT_MISMATCH' });
    }
    return { row, state, actorId: user!.id };
  }
  async read(id: string, user: RequestUser | undefined) {
    return organizerView((await this.target(id, user)).state);
  }
  async readOperation(id: string, operationId: string, user: RequestUser | undefined) {
    if (!uuid(operationId)) throw new BadRequestException({ code: 'TOURNAMENT_ORGANIZER_INPUT_INVALID' });
    const { state, actorId } = await this.target(id, user);
    const receipt = state.operations.find(r => r.command.operationId === operationId);
    if (receipt && receipt.actorId !== actorId) throw new ForbiddenException({ code: 'TOURNAMENT_ORGANIZER_FORBIDDEN' });
    return { ...organizerView(state, receipt), status: receipt ? 'CONFIRMED' : 'UNKNOWN' };
  }
  async preview(id: string, input: unknown, user: RequestUser | undefined, correlationId: string) {
    const command = organizerCommand(input);
    if (command.action !== 'ASSIGN' || !uuid(correlationId)) throw new BadRequestException({ code: 'TOURNAMENT_ORGANIZER_INPUT_INVALID' });
    const { row, state } = await this.target(id, user); assertLocalOnly(row);
    if (state.revision !== command.expectedRevision) throw new ConflictException({ code: 'TOURNAMENT_ORGANIZER_REVISION_CONFLICT' });
    const proof = await this.lookupClient.lookup({ contractVersion: 1, requestId: randomUUID(), assignmentOperationId: command.operationId,
      tournamentId: state.tournamentId, selectedUserId: command.selectedUserId!, expectedAssignmentRevision: state.revision }, correlationId);
    if (proof.ownerTenantKey !== this.lookupClient.config.expectedOwnerTenantKey) throw new ForbiddenException({ code: 'TOURNAMENT_ORGANIZER_TENANT_MISMATCH' });
    const fresh = await this.target(id, user);
    if (fresh.state.revision !== state.revision || String(fresh.row._id) !== String(row._id)) throw new ConflictException({ code: 'TOURNAMENT_ORGANIZER_REVISION_CONFLICT' });
    return { contractVersion: 1, tournamentId: state.tournamentId, revision: state.revision, profile: proof.profile };
  }
  async command(id: string, input: unknown, key: string | undefined, user: RequestUser | undefined, correlationId: string) {
    const command = organizerCommand(input);
    if (key !== command.operationId || !uuid(correlationId)) throw new BadRequestException({ code: 'TOURNAMENT_ORGANIZER_INPUT_INVALID' });
    const { row, state, actorId } = await this.target(id, user);
    const original = organizerReplay(state, command, actorId);
    if (original) return { ...organizerView(state, original), status: 'CONFIRMED' };
    // Revoke remains available on archived/type-changed adopted documents and when lookup is disabled.
    if (command.action === 'ASSIGN' || !Object.prototype.hasOwnProperty.call(row, 'tournamentOrganizerV1')) assertLocalOnly(row);
    if (state.revision === Number.MAX_SAFE_INTEGER) throw new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_CAPACITY' });
    const stale = state.revision !== command.expectedRevision;
    const selected = stale ? state.selectedUserId : command.selectedUserId;
    if (state.operations.length + 1 + (selected ? 1 : 0) > ORGANIZER_OPERATION_LIMIT) throw new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_CAPACITY' });
    let expiresAt: string | null = null;
    let ownerTenantKey = state.ownerTenantKey;
    if (command.action === 'REVOKE' && ownerTenantKey === null) throw new ConflictException({ code: 'TOURNAMENT_ORGANIZER_NOT_ASSIGNED' });
    if ((!stale || ownerTenantKey === null) && command.action === 'ASSIGN') {
      const proof = await this.lookupClient.lookup({ contractVersion: 1, requestId: randomUUID(), assignmentOperationId: command.operationId,
        tournamentId: state.tournamentId, selectedUserId: command.selectedUserId!, expectedAssignmentRevision: state.revision }, correlationId);
      expiresAt = proof.expiresAt;
      if (proof.ownerTenantKey !== this.lookupClient.config.expectedOwnerTenantKey || (ownerTenantKey !== null && ownerTenantKey !== proof.ownerTenantKey)) throw new ForbiddenException({ code: 'TOURNAMENT_ORGANIZER_TENANT_MISMATCH' });
      ownerTenantKey = proof.ownerTenantKey;
      if (proof.profile.userId !== command.selectedUserId || Date.parse(expiresAt) <= Date.now() + ORGANIZER_CAS_BUDGET_MS) throw new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_LOOKUP_EXPIRED' });
    }
    if (ownerTenantKey === null) throw new ServiceUnavailableException({ code: 'TOURNAMENT_ORGANIZER_STATE_INVALID' });
    const outcome = stale ? 'REJECTED' : command.action === 'ASSIGN' ? 'ASSIGNED' : 'REVOKED';
    const receipt: OrganizerReceipt = { command, actorId, requestHash: organizerRequestHash(state.tournamentId, command), correlationId,
      outcome, reason: stale ? 'REVISION_CONFLICT' : outcome as 'ASSIGNED' | 'REVOKED', resultingRevision: state.revision + (stale ? 0 : 1),
      resultingSelectedUserId: selected, committedAt: new Date().toISOString(), lookupExpiresAt: expiresAt, ownerTenantKey, audit: 'TOURNAMENT_ORGANIZER_ASSIGNMENT_V1' };
    const next = { ...state, ownerTenantKey, revision: receipt.resultingRevision, selectedUserId: selected, operations: [...state.operations, receipt] };
    // Validate the complete stored shape before writing. Expiry is independently fenced by Mongo $$NOW.
    organizerState({ ...row, tournamentOrganizerV1: next }, state.tenantId, state.tenantKey);
    let after: Record<string, any> | null = null;
    try { after = await this.persistence.commitOrganizerAssignment(row, next, expiresAt); } catch { /* Ambiguous acknowledgement: read only below. */ }
    if (after) {
      this.tournaments.assertOrganizerTargetAccess(after, user);
      const committed = organizerState(after, state.tenantId, state.tenantKey);
      const found = organizerReplay(committed, command, actorId);
      if (found) return { ...organizerView(committed, found), status: 'CONFIRMED' };
    }
    // Never retry a CAS using a new preimage/revision, and never infer no dispatch from absence.
    const recovered = await this.target(id, user);
    const found = organizerReplay(recovered.state, command, actorId);
    return { ...organizerView(recovered.state, found), status: found ? 'CONFIRMED' : 'UNKNOWN' };
  }
}
