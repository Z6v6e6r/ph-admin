import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { RequestUser } from '../common/rbac/request-user.interface';
import { ResidentBenefitsService } from './resident-benefits.service';
import {
  hashResidentIdempotencyKey,
  hashResidentPassToken,
  isResidentPassToken,
  residentRequestHash
} from './resident-service-crypto';
import {
  assertResidentServicesEnabled,
  requireResidentServicesIdempotencyKey,
  requireResidentServicesTenantId,
  requireResidentServicesTokenPepper,
  residentServicesCorrelationId
} from './resident-services.config';
import { ResidentResidencyService, RESIDENT_SERVICES_CLOCK } from './resident-residency.service';
import { ResidentServicesRepository, isResidentDuplicateKeyError } from './resident-services.repository';
import {
  requireResidentStaff,
  requireResidentStation,
  residentStationScope
} from './resident-staff-access';
import {
  RESIDENT_SERVICE_LABELS,
  RESIDENT_SERVICES_ERROR_CODES,
  RESIDENT_SERVICES_JOURNAL_MAX_PAGE_SIZE,
  RESIDENT_SERVICES_JOURNAL_PAGE_SIZE,
  ResidentIssuanceView,
  ResidentJournalEntryView,
  ResidentJournalPage,
  ResidentReturnView,
  ResidentServiceItemCommand,
  StoredResidentIssuance,
  StoredResidentIssuanceItem,
  StoredResidentJournalEvent,
  StoredResidentReturn
} from './resident-services.types';

const ISSUE_PERMISSION = 'resident-services:issue';
const RETURN_PERMISSION = 'resident-services:return';
const READ_PERMISSION = 'resident-services:read';
const MAX_RETURN_ATTEMPTS = 3;

export interface ResidentIssuanceMutationResult {
  view: ResidentIssuanceView;
  replayed: boolean;
}

export interface ResidentReturnMutationResult {
  view: ResidentReturnView;
  replayed: boolean;
}

export interface ResidentJournalQueryInput {
  stationId?: string;
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}

interface JournalCursor {
  occurredAt: string;
  eventId: string;
}

@Injectable()
export class ResidentIssuancesService {
  constructor(
    private readonly repository: ResidentServicesRepository,
    private readonly residency: ResidentResidencyService,
    private readonly benefits: ResidentBenefitsService,
    @Optional() @Inject(RESIDENT_SERVICES_CLOCK) private readonly clock?: () => Date
  ) {}

  async confirm(input: {
    token: string;
    stationId: string | undefined;
    items: ResidentServiceItemCommand[];
    user: RequestUser | undefined;
    idempotencyHeader: string | undefined;
    correlationHeader: string | undefined;
  }): Promise<ResidentIssuanceMutationResult> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    const pepper = requireResidentServicesTokenPepper();
    const actorId = requireResidentStaff(input.user, ISSUE_PERMISSION);
    const stationId = requireResidentStation(input.user, ISSUE_PERMISSION, input.stationId);
    const idempotencyKey = requireResidentServicesIdempotencyKey(input.idempotencyHeader);
    const correlationId = residentServicesCorrelationId(input.correlationHeader);
    const items = this.benefits.normalizeItems(input.items);
    if (!isResidentPassToken(input.token)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.PASS_INVALID,
        message: 'Resident pass token is invalid'
      });
    }
    const tokenHash = hashResidentPassToken(pepper, input.token);
    const keyHash = hashResidentIdempotencyKey({
      pepper,
      tenantId,
      actorId,
      key: idempotencyKey
    });
    const requestHash = this.issuanceRequestHash({
      tenantId,
      actorId,
      stationId,
      tokenHash,
      items
    });
    const existing = await this.repository.issuanceByIdempotency(tenantId, keyHash);
    if (existing) {
      return this.replayIssuance(existing, requestHash);
    }
    // Retained across Mongo transaction retries: MANUAL_PER_ISSUANCE usage is
    // scoped to this explicit staff-confirmed operation, never a calendar or
    // subscription aggregate.
    const issuanceId = 'resident_issuance:' + randomUUID();
    try {
      const outcome = await this.repository.withTransaction(async (session) => {
        // Recompute the clock on every transaction attempt so a retried command
        // cannot treat an expired pass as still valid.
        const now = this.now();
        const replay = await this.repository.issuanceByIdempotency(tenantId, keyHash, session);
        if (replay) return { document: replay, replayed: true };
        const pass = await this.repository.findPassByTokenHash(tokenHash, session);
        if (!pass || pass.tenantId !== tenantId) {
          throw new NotFoundException({
            code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
            message: 'Resident pass was not found'
          });
        }
        if (pass.state === 'CONSUMED') {
          throw new ConflictException({
            code: RESIDENT_SERVICES_ERROR_CODES.PASS_ALREADY_USED,
            message: 'Resident pass was already used'
          });
        }
        if (Date.parse(pass.expiresAt) <= now.getTime()) {
          throw new ConflictException({
            code: RESIDENT_SERVICES_ERROR_CODES.PASS_EXPIRED,
            message: 'Resident pass has expired'
          });
        }
        const context = await this.residency.resolveByInstance(
          tenantId,
          pass.subscriptionInstanceId,
          session
        );
        if (pass.clientRefHash !== context.clientRefHash) {
          throw new NotFoundException({
            code: RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND,
            message: 'Resident pass was not found'
          });
        }
        if (!this.residency.stationAllowed(context, stationId)) {
          throw new ForbiddenException({
            code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
            message: 'Resident subscription does not allow this station'
          });
        }
        const decisions = await this.benefits.consumeForIssuance({
          context,
          stationId,
          items,
          now,
          issuanceId,
          session
        });
        const consumed = await this.repository.consumePass({
          passId: pass.passId,
          tenantId,
          expectedRevision: pass.revision,
          now,
          consumedBy: actorId,
          consumedStationId: stationId,
          operationId: issuanceId,
          session
        });
        if (!consumed) {
          const reread = await this.repository.findPassById(pass.passId, session);
          if (reread?.state === 'CONSUMED') {
            throw new ConflictException({
              code: RESIDENT_SERVICES_ERROR_CODES.PASS_ALREADY_USED,
              message: 'Resident pass was already used'
            });
          }
          throw new ConflictException({
            code: RESIDENT_SERVICES_ERROR_CODES.PASS_EXPIRED,
            message: 'Resident pass has expired'
          });
        }
        const issuedAt = now.toISOString();
        const document: StoredResidentIssuance = {
          schemaVersion: 1,
          issuanceId,
          tenantId,
          subscriptionInstanceId: context.instance.subscriptionInstanceId,
          clientRefHash: context.clientRefHash,
          passId: pass.passId,
          stationId,
          actorId,
          state: 'ISSUED',
          items: decisions,
          residency: {
            subscriptionTypeId: context.instance.subscriptionTypeId,
            subscriptionTypeTitle: context.subscriptionType.title,
            activeFrom: context.instance.activeFrom!,
            activeTo: context.instance.activeTo!,
            policyVersion: context.instance.policyVersion,
            policyDigest: context.instance.policyDigest,
            evidenceAsOf: context.evidenceAsOf
          },
          idempotency: { keyHash, requestHash },
          correlationId,
          issuedAt,
          createdAt: issuedAt,
          updatedAt: issuedAt,
          revision: 1,
          returnedAt: null,
          lastReturnId: null
        };
        await this.repository.insertIssuance(document, session);
        await this.repository.appendJournal([
          this.journalEvent({
            tenantId,
            eventType: 'ISSUANCE_CONFIRMED',
            issuanceId,
            returnId: null,
            passId: pass.passId,
            stationId,
            actorId,
            subscriptionInstanceId: context.instance.subscriptionInstanceId,
            items: decisions.map((item) => ({
              serviceKind: item.serviceKind,
              quantity: item.quantity
            })),
            occurredAt: issuedAt,
            correlationId
          })
        ], session);
        return { document, replayed: false };
      });
      const replayCheck = this.replayIssuance(outcome.document, requestHash);
      return { view: replayCheck.view, replayed: outcome.replayed };
    } catch (error) {
      if (isResidentDuplicateKeyError(error)) {
        const duplicate = await this.repository.issuanceByIdempotency(tenantId, keyHash);
        if (duplicate) return this.replayIssuance(duplicate, requestHash);
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.RETRY_CONFLICT,
          message: 'Resident service issuance conflicted; retry the request'
        });
      }
      throw error;
    }
  }

  async returnItems(input: {
    issuanceId: string;
    items: ResidentServiceItemCommand[];
    user: RequestUser | undefined;
    idempotencyHeader: string | undefined;
    correlationHeader: string | undefined;
  }): Promise<ResidentReturnMutationResult> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    const pepper = requireResidentServicesTokenPepper();
    const actorId = requireResidentStaff(input.user, RETURN_PERMISSION);
    const idempotencyKey = requireResidentServicesIdempotencyKey(input.idempotencyHeader);
    const correlationId = residentServicesCorrelationId(input.correlationHeader);
    const items = this.normalizeReturnItems(input.items);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(input.issuanceId)) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
        message: 'Resident service issuance was not found'
      });
    }
    const keyHash = hashResidentIdempotencyKey({
      pepper,
      tenantId,
      actorId,
      key: idempotencyKey
    });
    const requestHash = residentRequestHash([
      'resident-return:v1',
      tenantId,
      actorId,
      input.issuanceId,
      ...items.map((item) => item.serviceKind + ':' + item.quantity)
    ]);
    const existing = await this.repository.returnByIdempotency(tenantId, keyHash);
    if (existing) {
      return this.replayReturn(existing, requestHash);
    }
    for (let attempt = 0; attempt < MAX_RETURN_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.repository.withTransaction(async (session) => {
          const replay = await this.repository.returnByIdempotency(tenantId, keyHash, session);
          if (replay) {
            return { returnDocument: replay, issuance: null };
          }
          const issuance = await this.repository.issuanceById(
            tenantId,
            input.issuanceId,
            session
          );
          if (!issuance) {
            throw new NotFoundException({
              code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
              message: 'Resident service issuance was not found'
            });
          }
          const returnScope = residentStationScope(input.user, RETURN_PERMISSION);
          if (returnScope !== null && (returnScope.length === 0
            || !returnScope.includes(issuance.stationId))) {
            throw new NotFoundException({
              code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
              message: 'Resident service issuance was not found'
            });
          }
          const nextItems = this.applyReturn(issuance, items);
          const returnedAt = this.now().toISOString();
          const returnId = 'resident_return:' + randomUUID();
          const returnable = nextItems.filter((item) => item.returnable);
          const state = returnable.length > 0
            && returnable.every((item) => item.returnedQuantity === item.quantity)
            ? 'RETURNED'
            : 'PARTIALLY_RETURNED';
          const updated = await this.repository.updateIssuanceAfterReturn({
            tenantId,
            issuanceId: issuance.issuanceId,
            expectedRevision: issuance.revision,
            items: nextItems,
            state,
            returnedAt,
            returnId,
            session
          });
          if (!updated) {
            throw new ConflictException({
              code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_REVISION_CONFLICT,
              message: 'Resident service issuance revision conflict'
            });
          }
          const returnDocument: StoredResidentReturn = {
            schemaVersion: 1,
            returnId,
            tenantId,
            issuanceId: issuance.issuanceId,
            idempotency: { keyHash, requestHash },
            correlationId,
            actorId,
            stationId: issuance.stationId,
            items,
            issuanceState: updated.state,
            issuanceItems: updated.items,
            returnedAt,
            createdAt: returnedAt
          };
          await this.repository.insertReturn(returnDocument, session);
          await this.repository.appendJournal([
            this.journalEvent({
              tenantId,
              eventType: 'ITEM_RETURNED',
              issuanceId: issuance.issuanceId,
              returnId,
              passId: null,
              stationId: issuance.stationId,
              actorId,
              subscriptionInstanceId: issuance.subscriptionInstanceId,
              items,
              occurredAt: returnedAt,
              correlationId
            })
          ], session);
          return { returnDocument, issuance: updated };
        });
        if (result.issuance === null) {
          return this.replayReturn(result.returnDocument, requestHash);
        }
        return {
          view: this.returnView(result.returnDocument),
          replayed: false
        };
      } catch (error) {
        if (isResidentDuplicateKeyError(error)) {
          const duplicate = await this.repository.returnByIdempotency(tenantId, keyHash);
          if (duplicate) return this.replayReturn(duplicate, requestHash);
          throw new ConflictException({
            code: RESIDENT_SERVICES_ERROR_CODES.RETRY_CONFLICT,
            message: 'Resident service return conflicted; retry the request'
          });
        }
        if (error instanceof ConflictException) {
          const body = error.getResponse() as { code?: string };
          if (body.code === RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_REVISION_CONFLICT
            && attempt < MAX_RETURN_ATTEMPTS - 1) {
            continue;
          }
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_REVISION_CONFLICT,
      message: 'Resident service issuance revision conflict'
    });
  }

  async journal(
    query: ResidentJournalQueryInput,
    user: RequestUser | undefined
  ): Promise<ResidentJournalPage> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    requireResidentStaff(user, READ_PERMISSION);
    const scope = residentStationScope(user, READ_PERMISSION);
    let stationId: string | undefined;
    if (query.stationId !== undefined) {
      stationId = String(query.stationId).trim();
      if (!stationId) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Journal station filter is invalid'
        });
      }
      if (scope !== null && !scope.includes(stationId)) {
        throw new ForbiddenException({
          code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
          message: 'Station is outside the allowed scope'
        });
      }
    }
    const from = this.parseInstant(query.from, 'from');
    const to = this.parseInstant(query.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'Journal period is inverted'
      });
    }
    const limit = this.parseLimit(query.limit);
    const cursor = this.parseCursor(query.cursor);
    const page = await this.repository.listJournal({
      tenantId,
      stationIds: stationId === undefined && scope !== null ? scope : null,
      stationId,
      from: from ?? undefined,
      to: to ?? undefined,
      limit,
      cursor
    });
    return {
      items: page.items.map((event) => this.journalView(event)),
      nextCursor: page.nextCursor ? this.encodeCursor(page.nextCursor) : null
    };
  }

  async getIssuance(
    issuanceId: string,
    user: RequestUser | undefined
  ): Promise<ResidentIssuanceView> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    requireResidentStaff(user, READ_PERMISSION);
    const issuance = await this.repository.issuanceById(tenantId, issuanceId);
    if (!issuance) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
        message: 'Resident service issuance was not found'
      });
    }
    const scope = residentStationScope(user, READ_PERMISSION);
    if (scope !== null && !scope.includes(issuance.stationId)) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
        message: 'Resident service issuance was not found'
      });
    }
    return this.issuanceView(issuance);
  }

  /**
   * Read-only recovery of an issuance attempt whose response was lost (for
   * example a full page reload after a timeout). The key hash is scoped to the
   * calling staff actor, so only the actor that sent the original command can
   * resolve it. It never creates, replays or changes an issuance; absence means
   * "not committed yet", not a permission to issue again.
   */
  async issuanceAttempt(
    idempotencyHeader: string | undefined,
    user: RequestUser | undefined
  ): Promise<ResidentIssuanceView> {
    assertResidentServicesEnabled();
    this.repository.requireAvailable();
    const tenantId = requireResidentServicesTenantId();
    const pepper = requireResidentServicesTokenPepper();
    const actorId = requireResidentStaff(user, ISSUE_PERMISSION);
    const key = requireResidentServicesIdempotencyKey(idempotencyHeader);
    const keyHash = hashResidentIdempotencyKey({ pepper, tenantId, actorId, key });
    const issuance = await this.repository.issuanceByIdempotency(tenantId, keyHash);
    const scope = residentStationScope(user, ISSUE_PERMISSION);
    if (!issuance || (scope !== null && !scope.includes(issuance.stationId))) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND,
        message: 'Resident service issuance was not found'
      });
    }
    return this.issuanceView(issuance);
  }

  private replayIssuance(
    issuance: StoredResidentIssuance,
    requestHash: string
  ): ResidentIssuanceMutationResult {
    if (issuance.idempotency.requestHash !== requestHash) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key was already used with another issuance intent'
      });
    }
    return { view: this.issuanceView(issuance), replayed: true };
  }

  private replayReturn(
    returnDocument: StoredResidentReturn,
    requestHash: string
  ): ResidentReturnMutationResult {
    if (returnDocument.idempotency.requestHash !== requestHash) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency-Key was already used with another return intent'
      });
    }
    return { view: this.returnView(returnDocument), replayed: true };
  }

  private issuanceRequestHash(input: {
    tenantId: string;
    actorId: string;
    stationId: string;
    tokenHash: string;
    items: ResidentServiceItemCommand[];
  }): string {
    return residentRequestHash([
      'resident-issuance:v1',
      input.tenantId,
      input.actorId,
      input.stationId,
      input.tokenHash,
      ...input.items.map((item) => item.serviceKind + ':' + item.quantity)
    ]);
  }

  private normalizeReturnItems(items: ResidentServiceItemCommand[]): ResidentServiceItemCommand[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'At least one returnable item is required'
      });
    }
    const seen = new Set<string>();
    const normalized: ResidentServiceItemCommand[] = [];
    for (const item of items) {
      if (!item || (item.serviceKind !== 'RACKET' && item.serviceKind !== 'TOWEL')) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Returned service kind is invalid'
        });
      }
      if (seen.has(item.serviceKind)) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Duplicate returned service kind in one operation'
        });
      }
      seen.add(item.serviceKind);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Returned quantity is invalid'
        });
      }
      normalized.push({ serviceKind: item.serviceKind, quantity: item.quantity });
    }
    return normalized.sort((left, right) => (
      left.serviceKind === right.serviceKind ? 0 : left.serviceKind === 'TOWEL' ? -1 : 1
    ));
  }

  private applyReturn(
    issuance: StoredResidentIssuance,
    items: ResidentServiceItemCommand[]
  ): StoredResidentIssuanceItem[] {
    const next = issuance.items.map((item) => ({ ...item }));
    for (const command of items) {
      const item = next.find((candidate) => candidate.serviceKind === command.serviceKind);
      if (!item) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_NOT_ISSUED,
          message: 'Resident service was not issued by this operation'
        });
      }
      if (!item.returnable) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_NOT_RETURNABLE,
          message: 'Resident service is not returnable'
        });
      }
      if (item.returnedQuantity + command.quantity > item.quantity) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_ALREADY_RETURNED,
          message: 'Resident service was already returned'
        });
      }
      item.returnedQuantity += command.quantity;
    }
    return next;
  }

  private issuanceView(issuance: StoredResidentIssuance): ResidentIssuanceView {
    return {
      schemaVersion: 1,
      issuanceId: issuance.issuanceId,
      operationId: issuance.issuanceId,
      state: issuance.state,
      stationId: issuance.stationId,
      subscriptionInstanceId: issuance.subscriptionInstanceId,
      issuedAt: issuance.issuedAt,
      returnedAt: issuance.returnedAt,
      resident: {
        subscriptionTypeId: issuance.residency.subscriptionTypeId,
        subscriptionTypeTitle: issuance.residency.subscriptionTypeTitle,
        activeFrom: issuance.residency.activeFrom,
        activeTo: issuance.residency.activeTo
      },
      items: issuance.items.map((item) => ({
        serviceKind: item.serviceKind,
        label: RESIDENT_SERVICE_LABELS[item.serviceKind],
        quantity: item.quantity,
        returnable: item.returnable,
        returnedQuantity: item.returnedQuantity,
        limitPeriod: item.limitPeriod,
        limitQuantity: item.limitQuantity,
        remainingAfter: item.remainingAfter
      }))
    };
  }

  private returnView(returnDocument: StoredResidentReturn): ResidentReturnView {
    return {
      schemaVersion: 1,
      returnId: returnDocument.returnId,
      issuanceId: returnDocument.issuanceId,
      stationId: returnDocument.stationId,
      returnedAt: returnDocument.returnedAt,
      items: returnDocument.items.map((item) => ({
        serviceKind: item.serviceKind,
        label: RESIDENT_SERVICE_LABELS[item.serviceKind],
        quantity: item.quantity
      })),
      issuanceState: returnDocument.issuanceState,
      issuanceItems: returnDocument.issuanceItems.map((item) => ({
        serviceKind: item.serviceKind,
        label: RESIDENT_SERVICE_LABELS[item.serviceKind],
        quantity: item.quantity,
        returnable: item.returnable,
        returnedQuantity: item.returnedQuantity,
        limitPeriod: item.limitPeriod,
        limitQuantity: item.limitQuantity,
        remainingAfter: item.remainingAfter
      }))
    };
  }

  private journalView(event: StoredResidentJournalEvent): ResidentJournalEntryView {
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      issuanceId: event.issuanceId,
      returnId: event.returnId,
      stationId: event.stationId,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      items: event.items.map((item) => ({
        serviceKind: item.serviceKind,
        label: RESIDENT_SERVICE_LABELS[item.serviceKind],
        quantity: item.quantity
      }))
    };
  }

  private journalEvent(input: {
    tenantId: string;
    eventType: StoredResidentJournalEvent['eventType'];
    issuanceId: string;
    returnId: string | null;
    passId: string | null;
    stationId: string;
    actorId: string;
    subscriptionInstanceId: string;
    items: Array<{ serviceKind: 'TOWEL' | 'RACKET'; quantity: number }>;
    occurredAt: string;
    correlationId: string;
  }): StoredResidentJournalEvent {
    return {
      schemaVersion: 1,
      eventId: 'resident_journal:' + randomUUID(),
      tenantId: input.tenantId,
      eventType: input.eventType,
      issuanceId: input.issuanceId,
      returnId: input.returnId,
      passId: input.passId,
      stationId: input.stationId,
      actorId: input.actorId,
      subscriptionInstanceId: input.subscriptionInstanceId,
      items: input.items,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId
    };
  }

  private parseInstant(value: string | undefined, field: string): string | null {
    if (value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized || normalized !== String(value)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'Journal ' + field + ' is invalid'
      });
    }
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'Journal ' + field + ' is invalid'
      });
    }
    return new Date(parsed).toISOString();
  }

  private parseLimit(value: string | undefined): number {
    if (value === undefined) return RESIDENT_SERVICES_JOURNAL_PAGE_SIZE;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > RESIDENT_SERVICES_JOURNAL_MAX_PAGE_SIZE) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'Journal limit is invalid'
      });
    }
    return parsed;
  }

  private parseCursor(value: string | undefined): JournalCursor | null {
    if (value === undefined) return null;
    try {
      const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
      if (!decoded || typeof decoded !== 'object') throw new Error('cursor');
      const cursor = decoded as { occurredAt?: unknown; eventId?: unknown };
      if (typeof cursor.occurredAt !== 'string' || typeof cursor.eventId !== 'string') {
        throw new Error('cursor');
      }
      if (!Number.isFinite(Date.parse(cursor.occurredAt))) throw new Error('cursor');
      return { occurredAt: cursor.occurredAt, eventId: cursor.eventId };
    } catch {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'Journal cursor is invalid'
      });
    }
  }

  private encodeCursor(cursor: JournalCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  protected now(): Date {
    return this.clock ? this.clock() : new Date();
  }
}
