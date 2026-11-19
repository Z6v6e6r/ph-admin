import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { AssignPlayerRatingDto } from './dto/assign-player-rating.dto';
import { randomUUID } from 'crypto';
import { Filter } from 'mongodb';
import { RequestUser } from '../common/rbac/request-user.interface';
import { ChangePlayerRatingDto } from './dto/change-player-rating.dto';
import { PlayerRatingRepository } from './player-ratings.repository';
import {
  normalizePlayerName,
  normalizePlayerPhone,
  normalizeRatingNumeric,
  PlayerRatingActor,
  PlayerRatingChangeResult,
  PlayerRatingEventDocument,
  PlayerRatingEventDto,
  PlayerRatingEventsResult,
  PlayerRatingProjectionOutboxDocument,
  PlayerRatingProjectionStatus,
  PlayerRatingSearchResult,
  PlayerRatingStateDocument,
  PlayerRatingStateDto,
  PadlHubPlayerLevelProjectionOutboxDocument,
  ratingNumericToGrade
} from './player-ratings.types';

import { isInPlayerLevelPilot, readPlayerLevelPilot } from './player-level-projection-pilot';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class PlayerRatingsService implements OnModuleDestroy {
  private readonly projectionPilot = readPlayerLevelPilot();
  private readonly padlHubProjectionEnabled =
    String(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED ?? '').trim().toLowerCase() ===
    'true';

  constructor(private readonly repository: PlayerRatingRepository) {}

  async onModuleDestroy(): Promise<void> {
    await this.repository.close();
  }

  async search(q: string | undefined, limit?: number, cursor?: string): Promise<PlayerRatingSearchResult> {
    const normalizedQuery = String(q ?? '').trim();
    if (!normalizedQuery) return { items: [], nextCursor: null };
    const cursorValue = this.decodeCursor(cursor);
    const nameSearch = normalizePlayerName(normalizedQuery);
    const phoneNorm = normalizePlayerPhone(normalizedQuery);
    const exact = [{ clientId: normalizedQuery }, ...(phoneNorm ? [{ phoneNorm }] : [])];
    const text = nameSearch ? { nameSearch: { $regex: `^${escapeRegex(nameSearch)}`, $options: 'i' } } : null;
    const base: Filter<PlayerRatingStateDocument> = {
      $or: text ? [...exact, text] : exact
    } as Filter<PlayerRatingStateDocument>;
    const filter = cursorValue ? this.withStateCursor(base, cursorValue) : base;
    const rows = await this.call(() => this.repository.searchStates(filter, this.clampLimit(limit) + 1));
    const hasMore = rows.length > this.clampLimit(limit);
    const page = rows.slice(0, this.clampLimit(limit));
    const items = await Promise.all(page.map((state) => this.toStateDto(state)));
    return {
      items,
      nextCursor: hasMore && page.length ? this.encodeCursor({ at: page[page.length - 1].lastEventAt, key: page[page.length - 1].playerKey }) : null
    };
  }

  async get(playerKey: string): Promise<PlayerRatingStateDto & { lastEvent?: PlayerRatingEventDto; projection: { status: PlayerRatingProjectionStatus } }> {
    const state = await this.findState(playerKey);
    const outbox = await this.call(() => this.repository.latestOutbox(state.playerKey));
    const lastEvent = await this.call(() => this.repository.eventById(state.lastEventId));
    return {
      ...(await this.toStateDto(state, outbox)),
      ...(lastEvent ? { lastEvent: await this.toEventDto(lastEvent, outbox) } : {}),
      projection: { status: this.projectionStatus(outbox) }
    };
  }

  async resolveCanonicalLevelByIdentity(input: {
    clientId?: string;
    phone: string;
  }): Promise<{
    playerKey: string;
    clientId?: string;
    levelLabel: string;
    ratingNumeric: number;
  } | null> {
    const clientId = String(input.clientId ?? '').trim() || undefined;
    const phoneNorm = normalizePlayerPhone(input.phone) ?? undefined;
    if (!clientId && !phoneNorm) {
      return null;
    }
    const states = await this.call(() => this.repository.statesByIdentity({
      clientId,
      phoneNorm
    }));
    if (states.length > 1) {
      throw new ConflictException({
        code: 'RATING_IDENTITY_CONFLICT',
        message: 'Canonical rating identity is inconsistent'
      });
    }
    const state = states[0];
    if (!state) {
      return null;
    }
    if (
      (clientId && state.clientId && state.clientId !== clientId)
      || (phoneNorm && state.phoneNorm && state.phoneNorm !== phoneNorm)
    ) {
      throw new ConflictException({
        code: 'RATING_IDENTITY_CONFLICT',
        message: 'Canonical rating identity is inconsistent'
      });
    }
    const normalizedRating = normalizeRatingNumeric(state.ratingNumeric);
    const expectedGrade = normalizedRating === null
      ? null
      : ratingNumericToGrade(normalizedRating);
    if (
      state.ownership !== 'CUP_CANONICAL'
      || normalizedRating === null
      || !expectedGrade
      || state.rating !== expectedGrade
    ) {
      throw new ConflictException({
        code: 'RATING_STATE_NOT_CANONICAL',
        message: 'Canonical rating state is invalid'
      });
    }
    return {
      playerKey: state.playerKey,
      ...(state.clientId ? { clientId: state.clientId } : {}),
      levelLabel: String(normalizedRating),
      ratingNumeric: normalizedRating
    };
  }

  async events(playerKey: string, input: { limit?: number; cursor?: string; eventType?: string; dateFrom?: string; dateTo?: string }): Promise<PlayerRatingEventsResult> {
    await this.findState(playerKey);
    const limit = this.clampLimit(input.limit);
    const cursor = this.decodeCursor(input.cursor);
    const filter: Filter<PlayerRatingEventDocument> = { 'player.key': playerKey };
    if (input.eventType) filter.eventType = String(input.eventType).trim();
    const occurredAt: Record<string, string> = {};
    if (input.dateFrom) occurredAt.$gte = this.parseDate(input.dateFrom, 'dateFrom');
    if (input.dateTo) occurredAt.$lte = this.parseDate(input.dateTo, 'dateTo');
    if (Object.keys(occurredAt).length) filter.occurredAt = occurredAt as never;
    const cursorFilter = cursor ? this.withEventCursor(filter, cursor) : filter;
    const rows = await this.call(() => this.repository.listEvents(cursorFilter, limit + 1));
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: await Promise.all(page.map((event) => this.toEventDto(event))),
      nextCursor: hasMore && page.length ? this.encodeCursor({ at: page[page.length - 1].occurredAt, id: page[page.length - 1].id }) : null
    };
  }

  async assign(dto: AssignPlayerRatingDto, identity: { clientId: string; displayName?: string | null; phone?: string | null }, user?: RequestUser): Promise<PlayerRatingChangeResult> {
    dto = { ...dto, idempotencyKey: String(dto.idempotencyKey || '').trim(), reason: String(dto.reason || '').trim() };
    if (dto.idempotencyKey.length < 12) throw new BadRequestException('idempotencyKey must contain at least 12 non-blank characters');
    const actor = this.actorFromUser(user), numeric = normalizeRatingNumeric(dto.ratingNumeric);
    if (String(dto.reason || '').trim().length < 10) throw new BadRequestException('reason must contain at least 10 non-blank characters');
    if (!identity || identity.clientId !== dto.clientId || numeric === null) throw new BadRequestException('Verified client identity and level are required');
    const existing = await this.call(() => this.repository.eventByIdempotencyKey(dto.idempotencyKey));
    if (existing) {
      if (existing.eventType !== 'RATING_INITIAL_ASSIGNED' || existing.player.clientId !== dto.clientId
        || existing.change.after !== numeric || existing.source.reason !== dto.reason.trim() || existing.actor.id !== actor.id) throw new ConflictException('Idempotency key belongs to another assignment');
      return this.resultFromExistingEvent(existing);
    }
    const now = new Date().toISOString(), eventId = 'rating_evt:' + randomUUID(), key = 'client:' + dto.clientId;
    const grade = ratingNumericToGrade(numeric)!;
    const event: PlayerRatingEventDocument = { id: eventId, schemaVersion: 1, eventType: 'RATING_INITIAL_ASSIGNED', idempotencyKey: dto.idempotencyKey,
      occurredAt: now, createdAt: now, player: { key, clientId: dto.clientId, name: identity.displayName || 'Игрок' },
      change: { before: null, delta: null, after: numeric, gradeBefore: null, gradeAfter: grade }, formula: { version: 'padel-rating-grade-v1' },
      source: { domain: 'CUP_ADMIN', reason: dto.reason.trim() }, actor, projectionIntent: { viva: 'NONE_CUP_ONLY' } };
    const project = this.shouldProject({ playerKey: key, clientId: dto.clientId });
    const nextState: PlayerRatingStateDocument = { schemaVersion: 1, playerKey: key, clientId: dto.clientId,
      ...(normalizePlayerPhone(identity.phone) ? { phoneNorm: normalizePlayerPhone(identity.phone) } : {}),
      name: event.player.name, nameSearch: normalizePlayerName(event.player.name), ratingNumeric: numeric, rating: grade,
      ownership: 'CUP_CANONICAL', source: 'CUP', createdAt: now, updatedAt: now,
      lastEventId: eventId, lastEventAt: now, lastEventType: event.eventType, lastSource: event.source.domain, lastChangedBy: actor,
      ...(project ? { padlHubProjectionRevision: 1 } : {}) };
    event.stateSnapshot = nextState;
    const padlHubOutbox = project ? this.padlHubProjectionOutbox(nextState, event) : undefined;
    try {
      const outcome = await this.call(() => this.repository.runAtomicInitialAssignment({ event, nextState,
        compatibility: this.compatibilityProjection(nextState), ...(padlHubOutbox ? { padlHubOutbox } : {}) }));
      if (outcome !== 'ok') throw new ConflictException('У игрока уже есть уровень или история. Откройте текущую карточку или восстановите состояние.');
    } catch (error) {
      if (this.repository.isDuplicateKey(error)) {
        const retry = await this.call(() => this.repository.eventByIdempotencyKey(dto.idempotencyKey));
        if (retry?.eventType === event.eventType && retry.player.clientId === dto.clientId && retry.change.after === numeric && retry.source.reason === dto.reason.trim() && retry.actor.id === actor.id) return this.resultFromExistingEvent(retry);
        throw new ConflictException('Первоначальное назначение изменилось одновременно');
      }
      throw error;
    }
    return { state: await this.toStateDto(nextState, null), event: await this.toEventDto(event, null), projection: { status: 'NOT_REQUIRED' } };
  }

  async change(playerKey: string, dto: ChangePlayerRatingDto, user?: RequestUser): Promise<PlayerRatingChangeResult> {
    const actor = this.actorFromUser(user);
    const nextNumeric = normalizeRatingNumeric(dto.ratingNumeric);
    if (nextNumeric === null) throw new BadRequestException('ratingNumeric must be between 1.00000 and 7.00000');
    const reason = String(dto.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException('reason must contain at least 10 characters');
    const idempotencyKey = String(dto.idempotencyKey ?? '').trim();
    if (idempotencyKey.length < 12) throw new BadRequestException('idempotencyKey must contain at least 12 non-blank characters');
    const gradeAlignment = dto.expectedPreviousGrade === undefined ? undefined : {
      previousGrade: dto.expectedPreviousGrade,
      previousEventId: dto.expectedLastEventId,
      clientId: dto.expectedClientId
    };
    if ((gradeAlignment && !gradeAlignment.clientId) || (!gradeAlignment && dto.expectedClientId !== undefined)) {
      throw new BadRequestException('Grade alignment requires both expectedPreviousGrade and expectedClientId');
    }
    const matchesRequest = (event: PlayerRatingEventDocument) =>
      event.player.key === playerKey && event.change.after === nextNumeric
      && event.source.reason === reason && event.actor.id === actor.id
      && event.source.gradeAlignment?.previousGrade === gradeAlignment?.previousGrade
      && event.source.gradeAlignment?.previousEventId === gradeAlignment?.previousEventId
      && event.source.gradeAlignment?.clientId === gradeAlignment?.clientId;
    const existing = await this.call(() => this.repository.eventByIdempotencyKey(idempotencyKey));
    if (existing) {
      if (!matchesRequest(existing)) throw new ConflictException('Idempotency key belongs to another change');
      return this.resultFromExistingEvent(existing);
    }

    const current = await this.findState(playerKey);
    if (current.lastEventId !== dto.expectedLastEventId) throw await this.conflict(playerKey);
    const before = normalizeRatingNumeric(current.ratingNumeric);
    if (before === null) throw new InternalServerErrorException('Stored canonical rating is invalid');
    const afterGrade = ratingNumericToGrade(nextNumeric);
    if (gradeAlignment && (
      current.ownership !== 'CUP_CANONICAL' || current.clientId !== gradeAlignment.clientId
      || current.ratingNumeric !== nextNumeric || current.rating !== gradeAlignment.previousGrade
      || current.rating === afterGrade
    )) throw await this.conflict(playerKey);
    const beforeGrade = gradeAlignment ? current.rating : ratingNumericToGrade(before);
    if (!afterGrade || !beforeGrade) throw new InternalServerErrorException('Rating grade formula rejected a valid rating');
    const now = new Date().toISOString();
    const eventId = `rating_evt:${randomUUID()}`;
    const event: PlayerRatingEventDocument = {
      id: eventId,
      schemaVersion: 1,
      eventType: 'RATING_MANUALLY_CHANGED',
      idempotencyKey,
      occurredAt: now,
      createdAt: now,
      player: { key: current.playerKey, clientId: current.clientId ?? null, phoneNorm: current.phoneNorm ?? null, name: current.name },
      change: { before, delta: Number((nextNumeric - before).toFixed(5)), after: nextNumeric, gradeBefore: beforeGrade, gradeAfter: afterGrade },
      formula: { version: 'padel-rating-grade-v1' },
      source: {
        domain: 'CUP_ADMIN', reason,
        ...(gradeAlignment?.clientId ? { gradeAlignment: { ...gradeAlignment, clientId: gradeAlignment.clientId } } : {})
      },
      actor,
      projectionIntent: { viva: 'NONE_CUP_ONLY' }
    };
    const project = this.shouldProject(current);
    const nextState: PlayerRatingStateDocument = {
      ...current,
      ratingNumeric: nextNumeric,
      rating: afterGrade,
      lastEventId: eventId,
      lastEventAt: now,
      lastEventType: event.eventType,
      lastSource: event.source.domain,
      lastChangedBy: actor,
      lastDelta: event.change.delta,
      updatedAt: now,
      ownership: 'CUP_CANONICAL',
      source: 'CUP',
      ...(project
        ? { padlHubProjectionRevision: (current.padlHubProjectionRevision ?? 0) + 1 }
        : {})
    };
    event.stateSnapshot = nextState;
    const padlHubOutbox = project
      ? this.padlHubProjectionOutbox(nextState, event)
      : undefined;
    try {
      const written = await this.call(() => this.repository.runAtomicChange({
        event,
        nextState,
        expectedLastEventId: dto.expectedLastEventId,
        compatibility: this.compatibilityProjection(nextState),
        ...(event.source.gradeAlignment ? { expectedGradeAlignment: event.source.gradeAlignment } : {}),
        ...(project ? { expectedProjectionRevision: current.padlHubProjectionRevision ?? 0 } : {}),
        ...(padlHubOutbox ? { padlHubOutbox } : {})
      }));
      if (written !== 'ok') {
        const concurrent = await this.call(() => this.repository.eventByIdempotencyKey(idempotencyKey));
        if (concurrent && matchesRequest(concurrent)) return this.resultFromExistingEvent(concurrent);
        throw await this.conflict(playerKey);
      }
    } catch (error) {
      if (this.repository.isDuplicateKey(error)) {
        const duplicated = await this.call(() => this.repository.eventByIdempotencyKey(idempotencyKey));
        if (duplicated) {
          if (!matchesRequest(duplicated)) throw new ConflictException('Idempotency key belongs to another change');
          return this.resultFromExistingEvent(duplicated);
        }
      }
      throw error;
    }
    return { state: await this.toStateDto(nextState, null), event: await this.toEventDto(event, null), projection: { status: 'NOT_REQUIRED' } };
  }

  async retryProjection(playerKey: string, user?: RequestUser): Promise<{ state: PlayerRatingStateDto; projection: { status: PlayerRatingProjectionStatus } }> {
    this.actorFromUser(user);
    throw new ConflictException({ code: 'VIVA_LEVEL_PROJECTION_RETIRED', message: 'Уровень хранится только в ЦУП' });
  }

  async retryPlayerLevelProjection(
    playerKey: string,
    user?: RequestUser
  ): Promise<{ status: 'PENDING' }> {
    const actor = this.actorFromUser(user);
    const current = await this.findState(playerKey);
    if (!isInPlayerLevelPilot(this.projectionPilot, current)) {
      throw new NotFoundException('No failed PadlHub player-level projection exists for this player');
    }
    const outbox = await this.call(() =>
      this.repository.retryPadlHubProjection(playerKey, actor, this.projectionPilot ? current : undefined)
    );
    if (!outbox) {
      throw new NotFoundException('No failed PadlHub player-level projection exists for this player');
    }
    return { status: 'PENDING' };
  }

  private async findState(playerKey: string): Promise<PlayerRatingStateDocument> {
    const normalized = String(playerKey ?? '').trim();
    if (!normalized) throw new NotFoundException('Player rating state not found');
    const state = await this.call(() => this.repository.stateByKey(normalized));
    if (!state) throw new NotFoundException('Player rating state not found');
    return state;
  }

  private shouldProject(state: Pick<PlayerRatingStateDocument, 'playerKey' | 'clientId'>): boolean {
    return this.padlHubProjectionEnabled && Boolean(state.clientId) && isInPlayerLevelPilot(this.projectionPilot, state);
  }

  private async resultFromExistingEvent(event: PlayerRatingEventDocument): Promise<PlayerRatingChangeResult> {
    const snapshot = event.stateSnapshot ?? await this.findState(event.player.key);
    const outbox = await this.call(() => this.repository.latestOutbox(event.player.key));
    return { state: await this.toStateDto(snapshot, outbox), event: await this.toEventDto(event, outbox), projection: { status: this.projectionStatus(outbox) } };
  }
  private async conflict(playerKey: string): Promise<ConflictException> {
    const state = await this.findState(playerKey);
    return new ConflictException({ code: 'RATING_STATE_CONFLICT', message: 'Уровень уже был изменён. Обновите карточку.', state: await this.toStateDto(state) });
  }
  private actorFromUser(user?: RequestUser): PlayerRatingActor {
    if (!user?.id) throw new UnauthorizedException('User context is missing');
    return { id: user.id, name: user.title || user.login || user.id, type: 'ADMIN' };
  }
  private async toStateDto(state: PlayerRatingStateDocument, knownOutbox?: PlayerRatingProjectionOutboxDocument | null): Promise<PlayerRatingStateDto> {
    const outbox = knownOutbox === undefined ? await this.call(() => this.repository.latestOutbox(state.playerKey)) : knownOutbox;
    return {
      playerKey: state.playerKey, ...(state.clientId ? { clientId: state.clientId } : {}), ...(state.phoneNorm ? { phoneNorm: state.phoneNorm } : {}),
      name: state.name, ratingNumeric: state.ratingNumeric, rating: state.rating, source: 'CUP', ownership: 'CUP_CANONICAL',
      lastEventId: state.lastEventId, lastEventAt: state.lastEventAt, lastEventType: state.lastEventType,
      lastActor: state.lastChangedBy, lastSource: state.lastSource, projectionStatus: this.projectionStatus(outbox),
      ...(state.vivaCabinetUrl || state.clientId ? { vivaCabinetUrl: state.vivaCabinetUrl || `https://cabinet.vivacrm.ru/clients/${encodeURIComponent(state.clientId as string)}` } : {}), bootstrappedFromViva: Boolean(state.bootstrappedFromViva)
    };
  }
  private async toEventDto(event: PlayerRatingEventDocument, knownOutbox?: PlayerRatingProjectionOutboxDocument | null): Promise<PlayerRatingEventDto> {
    const outbox = knownOutbox === undefined ? await this.call(() => this.repository.latestOutbox(event.player.key)) : knownOutbox;
    return { id: event.id, eventType: event.eventType, occurredAt: event.occurredAt, before: event.change.before, delta: event.change.delta, after: event.change.after, gradeBefore: event.change.gradeBefore, gradeAfter: event.change.gradeAfter, source: event.source, actor: event.actor, projectionStatus: this.projectionStatus(outbox) };
  }
  private projectionStatus(_outbox?: PlayerRatingProjectionOutboxDocument | null): PlayerRatingProjectionStatus {
    return 'NOT_REQUIRED';
  }
  private compatibilityProjection(state: PlayerRatingStateDocument): Record<string, unknown> {
    return { playerKey: state.playerKey, clientId: state.clientId, phoneNorm: state.phoneNorm, name: state.name, ratingNumeric: state.ratingNumeric, rating: state.rating, lastEventId: state.lastEventId, lastEventAt: state.lastEventAt, lastEventType: state.lastEventType, updatedAt: state.updatedAt, source: 'CUP_COMPATIBILITY_PROJECTION' };
  }
  private padlHubProjectionOutbox(
    state: PlayerRatingStateDocument,
    event: PlayerRatingEventDocument
  ): PadlHubPlayerLevelProjectionOutboxDocument {
    const now = event.occurredAt;
    const eventType = padlHubProjectionEventType(event.eventType);
    return {
      playerKey: state.playerKey,
      desiredRevision: state.padlHubProjectionRevision ?? 0,
      deliveredRevision: -1,
      desired: {
        schemaVersion: 1,
        sourceEventId: event.id,
        sourceRevision: state.padlHubProjectionRevision ?? 0,
        occurredAt: event.occurredAt,
        player: { externalClientId: state.clientId as string },
        sportCode: 'PADEL',
        level: { code: state.rating, numericValue: state.ratingNumeric },
        source: {
          eventType,
          formulaVersion: 'padel-rating-grade-v1'
        }
      },
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 20,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    };
  }
  private clampLimit(value?: number): number { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(n))) : DEFAULT_LIMIT; }
  private parseDate(value: string, field: string): string { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date`); return parsed.toISOString(); }
  private encodeCursor(value: Record<string, string>): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
  private decodeCursor(value?: string): { at: string; key?: string; id?: string } | null { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); return typeof parsed.at === 'string' && (typeof parsed.key === 'string' || typeof parsed.id === 'string') ? parsed : null; } catch { throw new BadRequestException('Invalid cursor'); } }
  private withStateCursor(base: Filter<PlayerRatingStateDocument>, cursor: { at: string; key?: string }): Filter<PlayerRatingStateDocument> { return { $and: [base, { $or: [{ lastEventAt: { $lt: cursor.at } }, { lastEventAt: cursor.at, playerKey: { $gt: cursor.key } }] }] } as Filter<PlayerRatingStateDocument>; }
  private withEventCursor(base: Filter<PlayerRatingEventDocument>, cursor: { at: string; id?: string }): Filter<PlayerRatingEventDocument> { return { $and: [base, { $or: [{ occurredAt: { $lt: cursor.at } }, { occurredAt: cursor.at, id: { $gt: cursor.id } }] }] } as Filter<PlayerRatingEventDocument>; }
  private async call<T>(fn: () => Promise<T>): Promise<T> { try { await this.repository.connect(); return await fn(); } catch (error) { if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException || error instanceof UnauthorizedException) throw error; if (String((error as Error)?.message ?? '').includes('Transaction numbers are only allowed') || String((error as Error)?.message ?? '').includes('replica set')) throw new ServiceUnavailableException('Rating change requires MongoDB transactions'); throw error; } }
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function padlHubProjectionEventType(
  value: string
): 'RATING_INITIAL_IMPORTED' | 'RATING_BOOTSTRAPPED_FROM_VIVA' | 'RATING_MANUALLY_CHANGED' {
  if (value === 'RATING_INITIAL_ASSIGNED') return 'RATING_MANUALLY_CHANGED';
  if (
    value === 'RATING_INITIAL_IMPORTED'
    || value === 'RATING_BOOTSTRAPPED_FROM_VIVA'
    || value === 'RATING_MANUALLY_CHANGED'
  ) {
    return value;
  }
  throw new InternalServerErrorException('Rating event type cannot be projected to PadlHub');
}
