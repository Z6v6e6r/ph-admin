import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { getStationScopeForPermission, hasAdminPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { ChangePlayerRatingDto } from './dto/change-player-rating.dto';
import { PlayerRatingRepository } from './player-ratings.repository';
import {
  normalizePlayerName,
  normalizePlayerPhone,
  normalizeRatingNumeric,
  PlayerRatingActor,
  PlayerRatingAuditQuery,
  PlayerRatingAuditRow,
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
const MAX_EXPORT_ROWS = 5000;
const MANUAL_DOMAINS = ['ADMIN_MANUAL', 'CUP_ADMIN'];

const STATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Effective station scope of one rating permission from the staff session:
 * `null` covers every station, a non-empty list covers only those stations.
 * A grant whose station scope collapsed to nothing is a denial.
 */
export function requireRatingPermission(user: RequestUser | undefined, permission: string): string[] | null {
  if (!user?.id || user.authSource !== 'token') throw new UnauthorizedException('Staff token required');
  if (permission === 'player-ratings:write' && user.storedRightsConfirmed === false) {
    throw new ServiceUnavailableException({ code: 'STAFF_RIGHTS_UNCONFIRMED', message: 'Хранилище прав недоступно: изменение уровня временно невозможно.' });
  }
  if (!hasAdminPermission(user.permissions, permission)) throw new ForbiddenException(`Нет права ${permission}`);
  const scope = getStationScopeForPermission(user, permission);
  if (scope !== null && scope.length === 0) throw new ForbiddenException(`Право ${permission} не действует ни на одной станции`);
  return scope;
}

/**
 * The canonical level is shared by every station. A station-scoped writer changes it on behalf of
 * one station from its own scope, and the event records that station. A global writer may name
 * any station or none.
 */
export function resolveRatingWriteStation(user: RequestUser | undefined, requested?: unknown): string | undefined {
  const scope = requireRatingPermission(user, 'player-ratings:write');
  if (requested !== undefined && requested !== null && requested !== '') {
    if (typeof requested !== 'string' || !STATION_ID_PATTERN.test(requested)) throw new BadRequestException('Invalid stationId');
    if (scope !== null && !scope.includes(requested)) throw new ForbiddenException('Изменение уровня с этой станции не разрешено');
    return requested;
  }
  if (scope === null) return undefined;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException({ code: 'RATING_STATION_REQUIRED', message: 'Выберите станцию, от имени которой меняется уровень.' });
}

/** Journal stations visible to the viewer: `null` for all stations, otherwise the scope shared by both grants. */
export function ratingJournalScope(user: RequestUser | undefined): string[] | null {
  const audit = requireRatingPermission(user, 'audit:read');
  const ratings = requireRatingPermission(user, 'player-ratings:read');
  if (audit === null) return ratings;
  if (ratings === null) return audit;
  const shared = audit.filter(stationId => ratings.includes(stationId));
  if (!shared.length) throw new ForbiddenException('Права на журнал и уровни выданы для разных станций');
  return shared;
}

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

  async result(playerKey: string, eventId: string) {
    const event = await this.call(() => this.repository.eventById(eventId));
    if (!event || event.player.key !== playerKey) throw new NotFoundException('Rating event not found');
    const source = this.eventSource(event);
    if (!source.eventId || !source.resultRef) throw new NotFoundException('This event has no result reference');
    const game = source.kind === 'GAME'
      ? await this.call(() => this.repository.gameResult(source.eventId!, source.resultRef!.id, source.resultRef!.revision))
      : null;
    return {
      kind: source.kind,
      eventId: source.eventId,
      resultRef: source.resultRef,
      score: game?.score ?? null,
      tournamentRating: source.tournamentRatingSnapshot ?? null
    };
  }

  async audit(input: PlayerRatingAuditQuery, options: { export?: boolean; displayedIds?: string[]; stationScope?: string[] | null } = {}): Promise<{ items: PlayerRatingAuditRow[]; nextCursor: string | null }> {
    const { displayedIds } = options;
    const limit = options.export && !displayedIds ? MAX_EXPORT_ROWS : MAX_LIMIT;
    const allowedTypes = ['RATING_INITIAL_ASSIGNED', 'RATING_MANUALLY_CHANGED'];
    if (input.eventType && !allowedTypes.includes(input.eventType)) throw new BadRequestException('Invalid eventType');
    const filter: Filter<PlayerRatingEventDocument> = {
      eventType: input.eventType || { $in: allowedTypes },
      'actor.type': 'ADMIN',
      'source.domain': { $in: MANUAL_DOMAINS }
    };
    // Station-scoped viewers see only changes made from their stations; unattributed history stays global-only.
    if (options.stationScope) filter['actor.stationId'] = { $in: options.stationScope };
    for (const [field, value] of [['actor.id', input.actorId], ['player.key', input.playerKey]] as const) {
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || value.length > 200) throw new BadRequestException('Invalid journal filter');
      filter[field] = value.trim();
    }
    const from = input.dateFrom ? this.parseDate(input.dateFrom, 'dateFrom') : undefined;
    const to = input.dateTo ? this.parseDate(input.dateTo, 'dateTo') : undefined;
    if (from && to && from >= to) throw new BadRequestException('Invalid journal date range');
    if (from || to) filter.occurredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 512)) throw new BadRequestException('Invalid journal cursor');
    const cursor = this.decodeCursor(input.cursor);
    if (input.cursor && !cursor?.id) throw new BadRequestException('Invalid journal cursor');
    if (displayedIds) {
      if (!displayedIds.length || displayedIds.length > MAX_LIMIT || new Set(displayedIds).size !== displayedIds.length
        || displayedIds.some(id => !/^[a-zA-Z0-9:_-]{1,100}$/.test(id))) throw new BadRequestException('Invalid journal page');
      filter.id = { $in: displayedIds };
    }
    const rows = await this.call(() => this.repository.listEvents(cursor ? this.withEventCursor(filter, cursor) : filter, limit + 1));
    if (options.export && rows.length > limit) throw new BadRequestException('Уточните фильтры: выгрузка ограничена 5000 записями.');
    if (displayedIds && (rows.length !== displayedIds.length || rows.some((row, index) => row.id !== displayedIds[index]))) {
      throw new ConflictException('The exported page does not match the journal');
    }
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(event => ({
        id: event.id, occurredAt: event.occurredAt, eventType: event.eventType,
        actorId: event.actor.id, actorName: event.actor.name || event.actor.id, stationId: event.actor.stationId ?? null,
        playerKey: event.player.key, playerName: event.player.name,
        before: event.change.before, gradeBefore: event.change.gradeBefore,
        after: event.change.after, gradeAfter: event.change.gradeAfter, reason: event.source.reason ?? ''
      })),
      nextCursor: last && rows.length > limit ? this.encodeCursor({ at: last.occurredAt, id: last.id }) : null
    };
  }

  async assign(dto: AssignPlayerRatingDto, identity: { clientId: string; displayName?: string | null; phone?: string | null }, user?: RequestUser): Promise<PlayerRatingChangeResult> {
    const stationId = resolveRatingWriteStation(user, dto.stationId);
    dto = { ...dto, idempotencyKey: String(dto.idempotencyKey || '').trim(), reason: String(dto.reason || '').trim() };
    if (dto.idempotencyKey.length < 12) throw new BadRequestException('idempotencyKey must contain at least 12 non-blank characters');
    const actor = this.actorFromUser(user, stationId), numeric = normalizeRatingNumeric(dto.ratingNumeric);
    if (String(dto.reason || '').trim().length < 10) throw new BadRequestException('reason must contain at least 10 non-blank characters');
    if (!identity || identity.clientId !== dto.clientId || numeric === null) throw new BadRequestException('Verified client identity and level are required');
    const matchesRequest = (event: PlayerRatingEventDocument) =>
      event.eventType === 'RATING_INITIAL_ASSIGNED' && MANUAL_DOMAINS.includes(event.source.domain)
      && event.player.clientId === dto.clientId && event.change.after === numeric
      && event.source.reason === dto.reason && event.actor.id === actor.id
      && (event.actor.stationId ?? undefined) === actor.stationId;
    const existing = await this.call(() => this.repository.eventByIdempotencyKey(dto.idempotencyKey));
    if (existing) {
      if (!matchesRequest(existing)) throw new ConflictException('Idempotency key belongs to another assignment');
      return this.resultFromExistingEvent(existing);
    }
    const now = new Date().toISOString(), eventId = 'rating_evt:' + randomUUID(), key = 'client:' + dto.clientId;
    const grade = ratingNumericToGrade(numeric)!;
    const event: PlayerRatingEventDocument = { id: eventId, schemaVersion: 1, eventType: 'RATING_INITIAL_ASSIGNED', idempotencyKey: dto.idempotencyKey,
      occurredAt: now, createdAt: now, player: { key, clientId: dto.clientId, name: identity.displayName || 'Игрок' },
      change: { before: null, delta: null, after: numeric, gradeBefore: null, gradeAfter: grade }, formula: { version: 'padel-rating-grade-v1' },
      source: { domain: 'ADMIN_MANUAL', kind: 'ADMIN_MANUAL', reason: dto.reason.trim() }, actor, projectionIntent: { viva: 'NONE_CUP_ONLY' } };
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
      if (outcome !== 'ok') {
        const concurrent = await this.call(() => this.repository.eventByIdempotencyKey(dto.idempotencyKey));
        if (concurrent && matchesRequest(concurrent)) return this.resultFromExistingEvent(concurrent);
        throw new ConflictException('У игрока уже есть уровень или история. Откройте текущую карточку или восстановите состояние.');
      }
    } catch (error) {
      if (this.repository.isDuplicateKey(error)) {
        const retry = await this.call(() => this.repository.eventByIdempotencyKey(dto.idempotencyKey));
        if (retry && matchesRequest(retry)) return this.resultFromExistingEvent(retry);
        throw new ConflictException('Первоначальное назначение изменилось одновременно');
      }
      throw error;
    }
    return { state: await this.toStateDto(nextState, null), event: await this.toEventDto(event, null), projection: { status: 'NOT_REQUIRED' } };
  }

  async change(playerKey: string, dto: ChangePlayerRatingDto, user?: RequestUser): Promise<PlayerRatingChangeResult> {
    const actor = this.actorFromUser(user, resolveRatingWriteStation(user, dto.stationId));
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
      event.eventType === 'RATING_MANUALLY_CHANGED' && MANUAL_DOMAINS.includes(event.source.domain)
      && event.player.key === playerKey && event.change.after === nextNumeric
      && (event.source.expectedLastEventId === undefined || event.source.expectedLastEventId === dto.expectedLastEventId)
      && event.source.reason === reason && event.actor.id === actor.id
      && (event.actor.stationId ?? undefined) === actor.stationId
      && event.source.gradeAlignment?.previousGrade === gradeAlignment?.previousGrade
      && event.source.gradeAlignment?.previousEventId === gradeAlignment?.previousEventId
      && event.source.gradeAlignment?.clientId === gradeAlignment?.clientId;
    const existing = await this.call(() => this.repository.eventByIdempotencyKey(idempotencyKey));
    if (existing) {
      if (!matchesRequest(existing)) throw new ConflictException('Idempotency key belongs to another change');
      return this.resultFromExistingEvent(existing);
    }

    const current = await this.findState(playerKey);
    if (current.lastEventId !== dto.expectedLastEventId) {
      const concurrent = await this.call(() => this.repository.eventByIdempotencyKey(idempotencyKey));
      if (concurrent && matchesRequest(concurrent)) return this.resultFromExistingEvent(concurrent);
      throw await this.conflict(playerKey);
    }
    const before = normalizeRatingNumeric(current.ratingNumeric);
    if (current.ownership !== 'CUP_CANONICAL' || before === null) {
      throw new InternalServerErrorException('Stored canonical rating is invalid');
    }
    if (!current.clientId) {
      throw new ConflictException({ code: 'RATING_CLIENT_ID_REQUIRED', message: 'Для изменения уровня требуется подтверждённый clientId игрока.' });
    }
    const afterGrade = ratingNumericToGrade(nextNumeric);
    if (gradeAlignment && (
      current.ownership !== 'CUP_CANONICAL' || current.clientId !== gradeAlignment.clientId
      || current.ratingNumeric !== nextNumeric || current.rating !== gradeAlignment.previousGrade
      || current.rating === afterGrade
    )) throw await this.conflict(playerKey);
    const beforeGrade = current.rating;
    if (!afterGrade || !beforeGrade) throw new InternalServerErrorException('Rating grade formula rejected a valid rating');
    const now = new Date(Math.max(Date.now(), (Date.parse(current.lastEventAt) || 0) + 1)).toISOString();
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
        domain: 'ADMIN_MANUAL', kind: 'ADMIN_MANUAL', reason, expectedLastEventId: dto.expectedLastEventId,
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
  private actorFromUser(user?: RequestUser, stationId?: string): PlayerRatingActor {
    if (!user?.id) throw new UnauthorizedException('User context is missing');
    return { id: user.id, name: user.title || user.login || user.id, type: 'ADMIN', ...(stationId ? { stationId } : {}) };
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
    return { id: event.id, eventType: event.eventType, occurredAt: event.occurredAt, before: event.change.before, delta: event.change.delta, after: event.change.after, gradeBefore: event.change.gradeBefore, gradeAfter: event.change.gradeAfter, source: this.eventSource(event), actor: { id: event.actor.id, name: event.actor.name, type: event.actor.type, ...(event.actor.stationId ? { stationId: event.actor.stationId } : {}) }, projectionStatus: this.projectionStatus(outbox) };
  }
  private eventSource(event: PlayerRatingEventDocument): PlayerRatingEventDocument['source'] {
    const source = event.source;
    if (MANUAL_DOMAINS.includes(source.domain)) return { domain: 'ADMIN_MANUAL', kind: 'ADMIN_MANUAL', reason: source.reason };
    const kind = source.kind ?? (source.domain.startsWith('GAME_RESULT') ? 'GAME'
      : source.domain === 'TOURNAMENT' || source.domain === 'TOURNAMENT_BOOTSTRAP' ? 'TOURNAMENT' : undefined);
    const eventId = source.eventId ?? (kind === 'GAME' ? source.gameId
      : kind === 'TOURNAMENT' ? source.tournamentId ?? source.sourceId : undefined);
    const resultId = kind === 'GAME' ? source.correctionResultId ?? source.resultId : source.fprProtocolId ?? eventId;
    const revision = kind === 'GAME' ? source.correctionScoreRevision ?? source.scoreRevision ?? source.resultRevision
      : !source.compensationReason ? source.sourceRevision : undefined;
    const resultRef = source.resultRef ?? (resultId && revision !== undefined ? { id: resultId, revision } : undefined);
    return {
      domain: source.domain, kind, eventId, resultRef,
      reason: source.reason ?? source.compensationReason ?? source.applySemantics,
      tournamentRatingSnapshot: source.tournamentRatingSnapshot
    };
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
  private parseDate(value: string, field: string): string { const parsed = new Date(value); if (typeof value !== 'string' || Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be an ISO date`); return parsed.toISOString(); }
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
