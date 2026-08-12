import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { CreateReleaseProgramDto } from './dto/create-release-program.dto';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  BenefitRule,
  ReleasePhase,
  ReleaseProgram,
  ReleaseProgramPage,
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionType,
  SubscriptionCreateResult,
  SubscriptionPolicyVersion,
  SubscriptionType,
  SubscriptionTypePage
} from './subscriptions.types';

const PAGE_SIZE = 50;
const POLICY_VERSION_INSERT_ATTEMPTS = 5;

interface CommandHeaders {
  idempotencyKey: string | undefined;
  correlationId: string | undefined;
}

@Injectable()
export class SubscriptionsService implements OnModuleDestroy {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async onModuleDestroy(): Promise<void> {
    await this.repository.close();
  }

  async listTypes(
    stationId: string | undefined,
    cursor: string | undefined,
    user?: RequestUser
  ): Promise<SubscriptionTypePage> {
    this.requireFeatureEnabled();
    const normalizedStationId = String(stationId ?? '').trim();
    const scope = getStationScopeForPermission(user, 'subscriptions:read');
    if (normalizedStationId && scope !== null && !scope.includes(normalizedStationId)) {
      throw new ForbiddenException('Station is outside the subscription read scope');
    }
    const afterId = this.decodeCursor(cursor);
    const rows = await this.call(() => this.repository.listSubscriptionTypes(afterId, PAGE_SIZE + 1));
    const page = rows.slice(0, PAGE_SIZE);
    return {
      items: page.map((row) => this.publicType(row)),
      nextCursor: rows.length > PAGE_SIZE && page.length
        ? this.encodeCursor(page[page.length - 1].subscriptionTypeId)
        : null
    };
  }

  async createType(
    dto: CreateSubscriptionTypeDto,
    headers: CommandHeaders,
    user?: RequestUser
  ): Promise<SubscriptionCreateResult<SubscriptionType>> {
    this.requireFeatureEnabled();
    const actorId = this.requireGlobalCatalogWrite(user);
    const command = this.validateCommandHeaders(headers);
    const normalized = {
      code: dto.code.trim().toLowerCase(),
      title: dto.title.trim(),
      description: dto.description == null ? null : dto.description.trim() || null
    };
    const requestHash = this.requestHash('createSubscriptionType', normalized);
    const existing = await this.call(() =>
      this.repository.subscriptionTypeByIdempotency(actorId, command.idempotencyKey)
    );
    if (existing) return this.replay(existing, requestHash, this.publicType(existing));

    const duplicate = await this.call(() => this.repository.subscriptionTypeByCodeNorm(normalized.code));
    if (duplicate) throw this.conflict('SUBSCRIPTION_TYPE_CODE_EXISTS', 'Код подписки уже используется');

    const now = new Date().toISOString();
    const row: StoredSubscriptionType = {
      schemaVersion: 1,
      subscriptionTypeId: `subscription_type:${randomUUID()}`,
      code: normalized.code,
      codeNorm: normalized.code,
      title: normalized.title,
      description: normalized.description,
      state: 'DRAFT',
      currentPolicyVersion: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    };
    try {
      await this.call(() => this.repository.insertSubscriptionType(row));
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.call(() =>
        this.repository.subscriptionTypeByIdempotency(actorId, command.idempotencyKey)
      );
      if (raced) return this.replay(raced, requestHash, this.publicType(raced));
      throw this.conflict('SUBSCRIPTION_TYPE_CODE_EXISTS', 'Код подписки уже используется');
    }
    return { item: this.publicType(row), replayed: false, correlationId: command.correlationId };
  }

  async createPolicyVersion(
    subscriptionTypeId: string,
    dto: CreatePolicyVersionDto,
    headers: CommandHeaders,
    user?: RequestUser
  ): Promise<SubscriptionCreateResult<SubscriptionPolicyVersion>> {
    this.requireFeatureEnabled();
    const actorId = this.requireGlobalCatalogWrite(user);
    const normalizedTypeId = String(subscriptionTypeId ?? '').trim();
    if (!normalizedTypeId) throw new NotFoundException('Subscription type not found');
    const command = this.validateCommandHeaders(headers);
    const normalized = this.normalizePolicy(dto);
    this.validatePolicy(normalized);
    const requestHash = this.requestHash('createSubscriptionPolicyVersion', {
      subscriptionTypeId: normalizedTypeId,
      policy: normalized
    });
    const existing = await this.call(() =>
      this.repository.policyByIdempotency(actorId, command.idempotencyKey)
    );
    if (existing) return this.replay(existing, requestHash, this.publicPolicy(existing));
    const parent = await this.call(() => this.repository.subscriptionTypeById(normalizedTypeId));
    if (!parent) throw new NotFoundException('Subscription type not found');
    if (parent.state !== 'DRAFT') {
      throw this.domainError('SUBSCRIPTION_TYPE_NOT_DRAFT', 'Новая версия правил доступна только для черновика');
    }

    for (let attempt = 0; attempt < POLICY_VERSION_INSERT_ATTEMPTS; attempt += 1) {
      const version = (await this.call(() => this.repository.latestPolicyVersion(normalizedTypeId))) + 1;
      const now = new Date().toISOString();
      const row: StoredSubscriptionPolicyVersion = {
        schemaVersion: 1,
        subscriptionTypeId: normalizedTypeId,
        version,
        revision: 1,
        status: 'DRAFT',
        ...normalized,
        createdAt: now,
        createdBy: actorId,
        idempotency: {
          actorId,
          key: command.idempotencyKey,
          requestHash,
          correlationId: command.correlationId
        }
      };
      try {
        await this.call(() => this.repository.insertPolicyVersion(row));
        return { item: this.publicPolicy(row), replayed: false, correlationId: command.correlationId };
      } catch (error) {
        if (!this.repository.isDuplicateKey(error)) throw error;
        const raced = await this.call(() =>
          this.repository.policyByIdempotency(actorId, command.idempotencyKey)
        );
        if (raced) return this.replay(raced, requestHash, this.publicPolicy(raced));
      }
    }
    throw this.conflict(
      'SUBSCRIPTION_POLICY_VERSION_CONFLICT',
      'Не удалось выделить номер версии правил, повторите запрос'
    );
  }

  async listReleasePrograms(
    stationId: string | undefined,
    cursor: string | undefined,
    user?: RequestUser
  ): Promise<ReleaseProgramPage> {
    this.requireFeatureEnabled();
    const scope = getStationScopeForPermission(user, 'subscriptions:read');
    const normalizedStationId = String(stationId ?? '').trim() || undefined;
    if (normalizedStationId && scope !== null && !scope.includes(normalizedStationId)) {
      throw new ForbiddenException('Station is outside the subscription read scope');
    }
    const afterId = this.decodeCursor(cursor);
    const rows = await this.call(() => this.repository.listReleasePrograms({
      stationIds: scope,
      stationId: normalizedStationId,
      afterId,
      limit: PAGE_SIZE + 1
    }));
    const page = rows.slice(0, PAGE_SIZE);
    return {
      items: page.map((row) => this.publicProgram(row)),
      nextCursor: rows.length > PAGE_SIZE && page.length
        ? this.encodeCursor(page[page.length - 1].releaseProgramId)
        : null
    };
  }

  async createReleaseProgram(
    dto: CreateReleaseProgramDto,
    headers: CommandHeaders,
    user?: RequestUser
  ): Promise<SubscriptionCreateResult<ReleaseProgram>> {
    this.requireFeatureEnabled();
    const actorId = this.requireActor(user);
    const scope = getStationScopeForPermission(user, 'subscriptions:release:write');
    const command = this.validateCommandHeaders(headers);
    const normalized = this.normalizeReleaseProgram(dto);
    if (scope !== null && !scope.includes(normalized.stationId)) {
      throw new ForbiddenException('Station is outside the subscription release scope');
    }
    this.validateReleaseProgram(normalized);
    const requestHash = this.requestHash('createSubscriptionReleaseProgram', normalized);
    const existing = await this.call(() =>
      this.repository.releaseProgramByIdempotency(actorId, command.idempotencyKey)
    );
    if (existing) return this.replay(existing, requestHash, this.publicProgram(existing));
    const parent = await this.call(() =>
      this.repository.subscriptionTypeById(normalized.subscriptionTypeId)
    );
    if (!parent) throw new NotFoundException('Subscription type not found');
    if (parent.state !== 'DRAFT') {
      throw this.domainError('SUBSCRIPTION_TYPE_NOT_DRAFT', 'Программу выпуска можно привязать только к черновику');
    }

    const now = new Date().toISOString();
    const row: StoredReleaseProgram = {
      schemaVersion: 1,
      releaseProgramId: `release_program:${randomUUID()}`,
      subscriptionTypeId: normalized.subscriptionTypeId,
      stationId: normalized.stationId,
      timezone: normalized.timezone,
      state: 'DRAFT',
      revision: 1,
      phases: normalized.phases.map((phase) => ({
        releasePhaseId: `release_phase:${randomUUID()}`,
        order: phase.order,
        mode: phase.mode,
        totalQuantity: phase.totalQuantity,
        dailyDropQuantity: phase.dailyDropQuantity ?? null,
        dailyDropLocalTime: phase.dailyDropLocalTime ?? null,
        price: { amountMinor: phase.price.amountMinor, currency: phase.price.currency },
        activation: phase.activation,
        scheduledAt: phase.scheduledAt ?? null,
        providerProductRef: phase.providerProductRef ?? null
      })),
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    };
    try {
      await this.call(() => this.repository.insertReleaseProgram(row));
    } catch (error) {
      if (!this.repository.isDuplicateKey(error)) throw error;
      const raced = await this.call(() =>
        this.repository.releaseProgramByIdempotency(actorId, command.idempotencyKey)
      );
      if (raced) return this.replay(raced, requestHash, this.publicProgram(raced));
      throw error;
    }
    return { item: this.publicProgram(row), replayed: false, correlationId: command.correlationId };
  }

  private requireGlobalCatalogWrite(user?: RequestUser): string {
    const actorId = this.requireActor(user);
    if (getStationScopeForPermission(user, 'subscriptions:catalog:write') !== null) {
      throw new ForbiddenException('Subscription catalog changes require global station scope');
    }
    return actorId;
  }

  private requireFeatureEnabled(): void {
    const enabled = String(process.env.SUBSCRIPTIONS_ADMIN_ENABLED ?? '').trim().toLowerCase();
    if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ADMIN_DISABLED',
        message: 'Subscription administration is disabled'
      });
    }
  }

  private requireActor(user?: RequestUser): string {
    const actorId = String(user?.id ?? '').trim();
    if (!actorId) throw new UnauthorizedException('User context is missing');
    return actorId;
  }

  private validateCommandHeaders(headers: CommandHeaders): { idempotencyKey: string; correlationId: string } {
    const idempotencyKey = String(headers.idempotencyKey ?? '');
    const correlationId = String(headers.correlationId ?? '');
    if (
      idempotencyKey !== idempotencyKey.trim()
      || idempotencyKey.length < 16
      || idempotencyKey.length > 128
    ) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must contain 16..128 characters without surrounding spaces'
      });
    }
    if (
      correlationId !== correlationId.trim()
      || correlationId.length < 8
      || correlationId.length > 128
    ) {
      throw new BadRequestException({
        code: 'INVALID_CORRELATION_ID',
        message: 'X-Correlation-Id must contain 8..128 characters without surrounding spaces'
      });
    }
    return { idempotencyKey, correlationId };
  }

  private normalizePolicy(dto: CreatePolicyVersionDto): Omit<SubscriptionPolicyVersion, 'subscriptionTypeId' | 'version' | 'revision' | 'status' | 'createdAt' | 'createdBy'> {
    return {
      effectiveAt: new Date(dto.effectiveAt).toISOString(),
      applyTo: dto.applyTo,
      validityDays: dto.validityDays,
      createGame: {
        enabled: dto.createGame.enabled,
        durationsMinutes: [...new Set(dto.createGame.durationsMinutes)].sort((a, b) => a - b)
      },
      joinGame: {
        enabled: dto.joinGame.enabled,
        minDurationMinutes: dto.joinGame.minDurationMinutes,
        maxDurationMinutes: dto.joinGame.maxDurationMinutes
      },
      maxActiveServices: dto.maxActiveServices,
      bookingWindowDays: dto.bookingWindowDays,
      dailyUsageLimit: dto.dailyUsageLimit,
      activeServiceScope: dto.activeServiceScope,
      usageUnitsByDuration: { ...dto.usageUnitsByDuration },
      benefitRules: dto.benefitRules
        .map((rule) => ({
          ruleId: rule.ruleId.trim(),
          enabled: rule.enabled,
          category: rule.category,
          externalEventTypeIds: this.uniqueStrings(rule.externalEventTypeIds),
          stationIds: this.uniqueStrings(rule.stationIds),
          kind: rule.kind,
          valueMinor: rule.valueMinor ?? null,
          percentage: rule.percentage ?? null,
          priority: rule.priority
        }))
        .sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId))
    };
  }

  private validatePolicy(policy: ReturnType<SubscriptionsService['normalizePolicy']>): void {
    const durations = policy.createGame.durationsMinutes;
    if (policy.createGame.enabled && durations.length === 0) {
      throw this.domainError('CREATE_GAME_DURATIONS_REQUIRED', 'Для создания игр выберите длительность');
    }
    if (!policy.createGame.enabled && durations.length > 0) {
      throw this.domainError('CREATE_GAME_DURATIONS_FORBIDDEN', 'Отключённое создание игр не должно содержать длительности');
    }
    const allowed = new Set([60, 90, 120]);
    if (
      !allowed.has(policy.joinGame.minDurationMinutes)
      || !allowed.has(policy.joinGame.maxDurationMinutes)
      || policy.joinGame.minDurationMinutes > policy.joinGame.maxDurationMinutes
    ) {
      throw this.domainError('INVALID_JOIN_GAME_DURATION', 'Диапазон присоединения должен использовать 60, 90 или 120 минут');
    }
    const ruleIds = new Set<string>();
    for (const rule of policy.benefitRules) {
      if (!rule.ruleId || ruleIds.has(rule.ruleId)) {
        throw this.domainError('DUPLICATE_BENEFIT_RULE_ID', 'Идентификаторы правил льгот должны быть уникальны');
      }
      ruleIds.add(rule.ruleId);
      if (rule.enabled && rule.externalEventTypeIds.length === 0) {
        throw this.domainError('BENEFIT_EVENT_TYPES_REQUIRED', 'Для активной льготы выберите типы событий');
      }
      this.validateBenefitValue(rule);
    }
    for (let left = 0; left < policy.benefitRules.length; left += 1) {
      for (let right = left + 1; right < policy.benefitRules.length; right += 1) {
        const a = policy.benefitRules[left];
        const b = policy.benefitRules[right];
        if (!a.enabled || !b.enabled || a.priority !== b.priority || a.category !== b.category) continue;
        if (
          this.intersects(a.stationIds, b.stationIds)
          && this.intersects(a.externalEventTypeIds, b.externalEventTypeIds)
        ) {
          throw this.domainError('AMBIGUOUS_BENEFIT_PRIORITY', 'Пересекающиеся льготы должны иметь разный приоритет');
        }
      }
    }
  }

  private validateBenefitValue(rule: BenefitRule): void {
    const hasMoney = rule.valueMinor !== null;
    const hasPercentage = rule.percentage !== null;
    if (rule.kind === 'FIXED_PRICE' || rule.kind === 'FIXED_DISCOUNT') {
      if (!hasMoney || hasPercentage) {
        throw this.domainError('INVALID_BENEFIT_VALUE', 'Денежная льгота требует только valueMinor');
      }
      return;
    }
    if (rule.kind === 'PERCENT_DISCOUNT') {
      if (!hasPercentage || hasMoney || Number(rule.percentage) <= 0) {
        throw this.domainError('INVALID_BENEFIT_VALUE', 'Процентная льгота требует только percentage больше нуля');
      }
      return;
    }
    if (hasMoney || hasPercentage) {
      throw this.domainError('INVALID_BENEFIT_VALUE', 'Для выбранного типа льготы value не используется');
    }
  }

  private normalizeReleaseProgram(dto: CreateReleaseProgramDto): CreateReleaseProgramDto {
    return {
      subscriptionTypeId: dto.subscriptionTypeId.trim(),
      stationId: dto.stationId.trim(),
      timezone: dto.timezone.trim(),
      phases: dto.phases
        .map((phase) => ({
          order: phase.order,
          mode: phase.mode,
          totalQuantity: phase.totalQuantity,
          dailyDropQuantity: phase.dailyDropQuantity ?? null,
          dailyDropLocalTime: phase.dailyDropLocalTime?.trim() || null,
          price: { amountMinor: phase.price.amountMinor, currency: phase.price.currency },
          activation: phase.activation,
          scheduledAt: phase.scheduledAt ? new Date(phase.scheduledAt).toISOString() : null,
          providerProductRef: phase.providerProductRef?.trim() || null
        }))
        .sort((a, b) => a.order - b.order)
    };
  }

  private validateReleaseProgram(program: CreateReleaseProgramDto): void {
    if (!program.subscriptionTypeId || !program.stationId) {
      throw this.domainError('RELEASE_PROGRAM_TARGET_REQUIRED', 'Укажите подписку и станцию');
    }
    try {
      new Intl.DateTimeFormat('ru-RU', { timeZone: program.timezone }).format();
    } catch {
      throw this.domainError('INVALID_TIMEZONE', 'Укажите корректную IANA timezone');
    }
    program.phases.forEach((phase, index) => {
      if (phase.order !== index + 1) {
        throw this.domainError('INVALID_RELEASE_PHASE_ORDER', 'Порядок фаз должен быть непрерывным от 1');
      }
      if (phase.providerProductRef) {
        throw this.domainError(
          'PROVIDER_EVIDENCE_REQUIRED',
          'providerProductRef запрещён до подтверждения контракта провайдера'
        );
      }
      if (phase.mode === 'DAILY_DROP') {
        if (
          !phase.dailyDropQuantity
          || phase.dailyDropQuantity > phase.totalQuantity
          || !phase.dailyDropLocalTime
        ) {
          throw this.domainError('INVALID_DAILY_DROP', 'Ежедневный выпуск требует количества, времени и лимита не больше фазы');
        }
      } else if (phase.dailyDropQuantity !== null || phase.dailyDropLocalTime !== null) {
        throw this.domainError('DAILY_DROP_FIELDS_FORBIDDEN', 'Поля ежедневного выпуска разрешены только для DAILY_DROP');
      }
      if (phase.activation === 'SCHEDULED' && !phase.scheduledAt) {
        throw this.domainError('RELEASE_SCHEDULE_REQUIRED', 'Для плановой активации укажите scheduledAt');
      }
      if (phase.activation !== 'SCHEDULED' && phase.scheduledAt !== null) {
        throw this.domainError('RELEASE_SCHEDULE_FORBIDDEN', 'scheduledAt разрешён только для плановой активации');
      }
      if (index === 0 && phase.activation === 'PREVIOUS_SOLD_OUT') {
        throw this.domainError('INVALID_FIRST_PHASE_ACTIVATION', 'Первая фаза не может ждать распродажи предыдущей');
      }
      if (phase.mode === 'MANUAL' && phase.activation !== 'MANUAL') {
        throw this.domainError('INVALID_MANUAL_PHASE', 'Ручная фаза должна иметь ручную активацию');
      }
    });
  }

  private publicType(row: StoredSubscriptionType): SubscriptionType {
    return {
      subscriptionTypeId: row.subscriptionTypeId,
      code: row.code,
      title: row.title,
      description: row.description,
      state: row.state,
      currentPolicyVersion: row.currentPolicyVersion,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private publicPolicy(row: StoredSubscriptionPolicyVersion): SubscriptionPolicyVersion {
    const { schemaVersion: _schemaVersion, idempotency: _idempotency, ...policy } = row;
    return policy;
  }

  private publicProgram(row: StoredReleaseProgram): ReleaseProgram {
    return {
      releaseProgramId: row.releaseProgramId,
      subscriptionTypeId: row.subscriptionTypeId,
      stationId: row.stationId,
      timezone: row.timezone,
      state: row.state,
      revision: row.revision,
      phases: row.phases.map((phase): ReleasePhase => ({
        ...phase,
        counters: { available: 0, reserved: 0, sold: 0, refunded: 0 },
        nextReleaseAt: null
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy
    };
  }

  private replay<TRow extends { idempotency: { requestHash: string; correlationId: string } }, TPublic>(
    row: TRow,
    requestHash: string,
    item: TPublic
  ): SubscriptionCreateResult<TPublic> {
    if (row.idempotency.requestHash !== requestHash) {
      throw this.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key уже использован для другого запроса');
    }
    return { item, replayed: true, correlationId: row.idempotency.correlationId };
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  }

  private intersects(left: string[], right: string[]): boolean {
    const values = new Set(left);
    return right.some((value) => values.has(value));
  }

  private requestHash(operation: string, payload: unknown): string {
    return createHash('sha256').update(`${operation}:${stableStringify(payload)}`).digest('hex');
  }

  private encodeCursor(id: string): string {
    return Buffer.from(JSON.stringify({ id })).toString('base64url');
  }

  private decodeCursor(cursor: string | undefined): string | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: unknown };
      if (typeof parsed.id !== 'string' || !parsed.id) throw new Error('invalid');
      return parsed.id;
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid cursor' });
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private domainError(code: string, message: string): UnprocessableEntityException {
    return new UnprocessableEntityException({ code, message });
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      await this.repository.connect();
      return await action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = String((error as Error)?.message ?? error);
      if (
        message.includes('SUBSCRIPTIONS_MONGODB_')
        || message.includes('SUBSCRIPTIONS_INDEXES_NOT_READY')
        || message.includes('Mongo')
        || message.includes('ECONN')
        || message.includes('server selection')
      ) {
        throw new ServiceUnavailableException({
          code: 'SUBSCRIPTIONS_CONTROL_PLANE_UNAVAILABLE',
          message: 'Subscription storage is not ready'
        });
      }
      throw error;
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
