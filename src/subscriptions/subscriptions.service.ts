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
  BenefitCategory,
  ReleasePhase,
  ReleaseProgram,
  ReleaseProgramPage,
  SubscriptionCapabilities,
  SubscriptionAction,
  SubscriptionStationAccessRule,
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

const defaultSubscriptionCapabilities = (): SubscriptionCapabilities => ({
  lifecycle: {
    activationMode: 'PURCHASE',
    activationWindowDays: 0,
    fixedActivationAt: null,
    fixedActivationTimeZone: 'Europe/Moscow',
    gracePeriodDays: 0,
    allowBookingsAfterExpiry: false,
    freeze: {
      enabled: false,
      maxDaysPerYear: 0,
      maxPeriodsPerYear: 0,
      minDaysPerPeriod: 0,
      extendsValidity: true
    },
    adminExtension: { enabled: true, maxDays: 30, reasonRequired: true }
  },
  usage: {
    weeklyUsageLimit: null,
    monthlyUsageLimit: null,
    maxFutureBookings: null,
    minHoursBetweenUses: 0,
    guestPassesPerMonth: 0,
    earlyBookingAccessHours: 0,
    waitlistPriority: false,
    crossStationMode: 'ALLOWED',
    crossStationSurchargeMinor: 0,
    blackoutDates: []
  },
  cancellation: {
    freeCancellationHours: { GAME: 24, GROUP_TRAINING: 24, TOURNAMENT: 48 },
    lateCancellationUsageUnits: 1,
    noShowUsageUnits: 1,
    noShowBlockDays: 0,
    stationCancellationRestoresUsage: true,
    reschedulePolicy: 'REVALIDATE'
  },
  commerce: {
    renewalMode: 'MANUAL',
    renewalWindowDays: 30,
    priceLockEnabled: false,
    renewalDiscountPercent: 0,
    purchaseLimitPerClient: 1,
    reservationTtlMinutes: 15,
    waitlistWhenSoldOut: true,
    promoCodesAllowed: false,
    installmentsAllowed: false,
    upgradeDowngradeMode: 'DISABLED',
    terminationRefundMode: 'MANUAL',
    coolingOffDays: 0,
    giftable: false,
    transferable: false,
    familySeats: 1,
    corporateSeats: 1,
    maxConcurrentSubscriptions: 1,
    consumptionPriority: 'EXPIRING_FIRST'
  },
  engagement: {
    showSavings: true,
    showBreakEvenProgress: true,
    expirationReminderDays: [30, 14, 7, 1],
    referralEnabled: false,
    renewalBonusEnabled: false,
    personalizedRecommendationsEnabled: false
  },
  analytics: {
    trackRevenue: true,
    trackRefunds: true,
    trackBreakage: true,
    trackMargin: true,
    trackPeakLoad: true,
    trackChurn: true,
    trackCohorts: true,
    attributionTag: null
  }
});

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
    this.validateRawPolicyControls(dto);
    const normalized = this.normalizePolicy(dto);
    this.validatePolicy(normalized);
    const requestHash = this.requestHash('createSubscriptionPolicyVersion', {
      subscriptionTypeId: normalizedTypeId,
      policy: normalized
    });
    const preDailyUsagePolicyRequestHash = dto.dailyUsagePolicy === undefined
      ? this.requestHash('createSubscriptionPolicyVersion', {
        subscriptionTypeId: normalizedTypeId,
        policy: this.preDailyUsagePolicyShape(normalized)
      })
      : null;
    const hasV3PolicyInput = dto.activeServicesLimit !== undefined
      || dto.bookingWindow !== undefined
      || dto.dailyUsagePolicy !== undefined
      || dto.stationAccessRules !== undefined
      || dto.benefitRules.some((rule) => (
        rule.actions !== undefined
        || rule.productTypeIds !== undefined
        || rule.durationMinutes !== undefined
        || rule.partialPrice !== undefined
        || rule.category === 'ADD_ON_PRODUCT'
        || rule.kind === 'PARTIAL_PRICE_PERCENT_DISCOUNT'
      ));
    const previousRequestHash = hasV3PolicyInput
      ? null
      : this.requestHash('createSubscriptionPolicyVersion', {
        subscriptionTypeId: normalizedTypeId,
        policy: this.previousPolicyShape(normalized)
      });
    const legacyRequestHash = !hasV3PolicyInput
      && dto.capabilities === undefined
      && dto.providerBinding === undefined
      ? this.requestHash('createSubscriptionPolicyVersion', {
        subscriptionTypeId: normalizedTypeId,
        policy: this.legacyPolicyShape(normalized)
      })
      : null;
    const existing = await this.call(() =>
      this.repository.policyByIdempotency(actorId, command.idempotencyKey)
    );
    if (existing) {
      return this.replayPolicy(
        existing,
        [
          requestHash,
          ...(preDailyUsagePolicyRequestHash ? [preDailyUsagePolicyRequestHash] : []),
          ...(previousRequestHash ? [previousRequestHash] : []),
          ...(legacyRequestHash ? [legacyRequestHash] : [])
        ],
        this.publicPolicy(existing)
      );
    }
    const parent = await this.call(() => this.repository.subscriptionTypeById(normalizedTypeId));
    if (!parent) throw new NotFoundException('Subscription type not found');
    const buildRow = (version: number): StoredSubscriptionPolicyVersion => ({
      schemaVersion: 3,
      subscriptionTypeId: normalizedTypeId,
      version,
      revision: 1,
      status: 'DRAFT',
      ...normalized,
      createdAt: new Date().toISOString(),
      createdBy: actorId,
      idempotency: {
        actorId,
        key: command.idempotencyKey,
        requestHash,
        correlationId: command.correlationId
      }
    });
    if (parent.state === 'ACTIVE') {
      if (!Number.isSafeInteger(parent.currentPolicyVersion)
        || Number(parent.currentPolicyVersion) < 1) {
        throw this.conflict(
          'SUBSCRIPTIONS_POLICY_SUPERSESSION_PRECONDITION_CHANGED',
          'У активной подписки отсутствует текущая опубликованная версия'
        );
      }
      if (normalized.applyTo !== 'NEW_ONLY') {
        throw this.domainError(
          'SUBSCRIPTIONS_ACTIVE_INSTANCE_MIGRATION_UNSUPPORTED',
          'Изменение правил активных экземпляров пока не поддерживается; выберите NEW_ONLY'
        );
      }
      const currentPolicyVersion = Number(parent.currentPolicyVersion);
      const row = buildRow(currentPolicyVersion + 1);
      try {
        const result = await this.call(() => this.repository.insertSupersedingPolicyVersion({
          policy: row,
          expectedTypeRevision: parent.revision,
          expectedCurrentPolicyVersion: currentPolicyVersion
        }));
        if (result === 'DRAFT_EXISTS') {
          throw this.conflict(
            'SUBSCRIPTIONS_POLICY_DRAFT_ALREADY_EXISTS',
            'Для активной подписки уже существует новая черновая версия правил'
          );
        }
        if (result === 'SOURCE_CONFLICT') {
          throw this.conflict(
            'SUBSCRIPTIONS_POLICY_SUPERSESSION_PRECONDITION_CHANGED',
            'Текущая версия активной подписки изменилась, обновите данные и повторите'
          );
        }
      } catch (error) {
        if (!(error instanceof HttpException) && this.repository.isDuplicateKey(error)) {
          const raced = await this.call(() =>
            this.repository.policyByIdempotency(actorId, command.idempotencyKey)
          );
          if (raced) {
            return this.replayPolicy(
              raced,
              [requestHash, ...(previousRequestHash ? [previousRequestHash] : []), ...(legacyRequestHash ? [legacyRequestHash] : [])],
              this.publicPolicy(raced)
            );
          }
          throw this.conflict(
            'SUBSCRIPTIONS_POLICY_DRAFT_ALREADY_EXISTS',
            'Для активной подписки уже существует новая черновая версия правил'
          );
        }
        throw error;
      }
      return { item: this.publicPolicy(row), replayed: false, correlationId: command.correlationId };
    }
    if (parent.state !== 'DRAFT') {
      throw this.domainError('SUBSCRIPTION_TYPE_NOT_DRAFT', 'Новая версия правил доступна только для черновика');
    }

    for (let attempt = 0; attempt < POLICY_VERSION_INSERT_ATTEMPTS; attempt += 1) {
      const version = (await this.call(() => this.repository.latestPolicyVersion(normalizedTypeId))) + 1;
      const row = buildRow(version);
      try {
        await this.call(() => this.repository.insertPolicyVersion(row));
        return { item: this.publicPolicy(row), replayed: false, correlationId: command.correlationId };
      } catch (error) {
        if (!this.repository.isDuplicateKey(error)) throw error;
        const raced = await this.call(() =>
          this.repository.policyByIdempotency(actorId, command.idempotencyKey)
        );
        if (raced) {
          return this.replayPolicy(
            raced,
            [requestHash, ...(previousRequestHash ? [previousRequestHash] : []), ...(legacyRequestHash ? [legacyRequestHash] : [])],
            this.publicPolicy(raced)
          );
        }
      }
    }
    throw this.conflict(
      'SUBSCRIPTION_POLICY_VERSION_CONFLICT',
      'Не удалось выделить номер версии правил, повторите запрос'
    );
  }

  async listPolicyVersions(
    subscriptionTypeId: string,
    user?: RequestUser
  ): Promise<SubscriptionPolicyVersion[]> {
    this.requireFeatureEnabled();
    this.requireActor(user);
    const normalizedTypeId = String(subscriptionTypeId ?? '').trim();
    if (!normalizedTypeId) throw new NotFoundException('Subscription type not found');
    const parent = await this.call(() => this.repository.subscriptionTypeById(normalizedTypeId));
    if (!parent) throw new NotFoundException('Subscription type not found');
    const rows = await this.call(() => this.repository.listPolicyVersions(normalizedTypeId));
    return rows.map((row) => this.publicPolicy(row));
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
      modelVersion: 3,
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
      activeServicesLimit: dto.activeServicesLimit
        ? {
          enabled: dto.activeServicesLimit.enabled,
          max: dto.activeServicesLimit.enabled ? dto.activeServicesLimit.max ?? null : null,
          scope: dto.activeServicesLimit.scope
        }
        : {
          enabled: dto.maxActiveServices > 0,
          max: dto.maxActiveServices > 0 ? dto.maxActiveServices : null,
          scope: dto.activeServiceScope
        },
      bookingWindow: dto.bookingWindow
        ? {
          enabled: dto.bookingWindow.enabled,
          days: dto.bookingWindow.enabled ? dto.bookingWindow.days ?? null : null
        }
        : { enabled: true, days: dto.bookingWindowDays },
      dailyUsageLimit: dto.dailyUsageLimit,
      dailyUsagePolicy: dto.dailyUsagePolicy
        ? {
          actions: ([...new Set(dto.dailyUsagePolicy.actions)] as SubscriptionAction[]).sort(),
          limitExceeded: dto.dailyUsagePolicy.limitExceeded,
          percentage: dto.dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT'
            ? dto.dailyUsagePolicy.percentage ?? null
            : null
        }
        : {
          actions: [
            'CREATE_GAME' as const,
            'JOIN_GAME' as const,
            'BOOK_GROUP_TRAINING' as const,
            'BOOK_TOURNAMENT' as const,
            'PURCHASE_ADD_ON_PRODUCT' as const
          ],
          limitExceeded: 'BLOCK' as const,
          percentage: null
        },
      activeServiceScope: dto.activeServiceScope,
      usageUnitsByDuration: { ...dto.usageUnitsByDuration },
      stationAccessRules: (dto.stationAccessRules ?? [])
        .map((rule) => ({
          ruleId: rule.ruleId.trim(),
          enabled: rule.enabled,
          priority: rule.priority,
          selector: rule.selector.kind === 'STATION_LIST'
            ? {
              kind: 'STATION_LIST' as const,
              stationIds: this.uniqueStrings(rule.selector.stationIds)
            }
            : {
              kind: rule.selector.kind,
              stationIds: [] as []
            },
          surcharge: rule.surcharge.kind === 'FIXED'
            ? { kind: 'FIXED' as const, amountMinor: rule.surcharge.amountMinor }
            : { kind: 'NONE' as const, amountMinor: 0 }
        }))
        .sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId)),
      benefitRules: dto.benefitRules
        .map((rule) => ({
          ruleId: rule.ruleId.trim(),
          enabled: rule.enabled,
          category: rule.category,
          actions: this.normalizeBenefitActions(rule.category, rule.actions),
          externalEventTypeIds: this.uniqueStrings(rule.externalEventTypeIds),
          productTypeIds: this.uniqueStrings(rule.productTypeIds ?? []),
          durationMinutes: [...new Set(rule.durationMinutes === undefined ? [60, 90, 120] : rule.durationMinutes)]
            .sort((a, b) => a - b),
          stationIds: this.uniqueStrings(rule.stationIds),
          kind: rule.kind,
          valueMinor: rule.valueMinor ?? null,
          percentage: rule.percentage ?? null,
          partialPrice: rule.partialPrice
            ? { numerator: rule.partialPrice.numerator, denominator: rule.partialPrice.denominator }
            : null,
          priority: rule.priority
        }))
        .sort((a, b) => a.priority - b.priority || a.ruleId.localeCompare(b.ruleId)),
      ...(dto.providerBinding
        ? { providerBinding: this.normalizeProviderBinding(dto.providerBinding) }
        : {}),
      capabilities: this.normalizeCapabilities(dto.capabilities, dto.validityDays)
    };
  }

  private validateRawPolicyControls(dto: CreatePolicyVersionDto): void {
    if (dto.dailyUsagePolicy) {
      if (dto.dailyUsagePolicy.actions.length === 0) {
        throw this.domainError(
          'DAILY_USAGE_ACTIONS_REQUIRED',
          'Для дневного лимита выберите хотя бы одно действие'
        );
      }
      if (dto.dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT'
        && (dto.dailyUsagePolicy.percentage == null
          || !Number.isInteger(dto.dailyUsagePolicy.percentage)
          || dto.dailyUsagePolicy.percentage < 0
          || dto.dailyUsagePolicy.percentage > 100)) {
        throw this.domainError(
          'DAILY_USAGE_DISCOUNT_REQUIRED',
          'Для превышения дневного лимита укажите процент скидки'
        );
      }
      if (dto.dailyUsagePolicy.limitExceeded === 'BLOCK'
        && dto.dailyUsagePolicy.percentage != null) {
        throw this.domainError(
          'DAILY_USAGE_DISCOUNT_FORBIDDEN',
          'Процент скидки разрешён только для скидочного превышения дневного лимита'
        );
      }
    }
    if (dto.activeServicesLimit) {
      if (dto.activeServicesLimit.enabled && dto.activeServicesLimit.max == null) {
        throw this.domainError(
          'ACTIVE_SERVICE_LIMIT_REQUIRED',
          'Для включённого лимита укажите максимум активных услуг'
        );
      }
      if (!dto.activeServicesLimit.enabled && dto.activeServicesLimit.max != null) {
        throw this.domainError(
          'ACTIVE_SERVICE_LIMIT_FORBIDDEN',
          'Для отключённого лимита максимум должен быть пустым'
        );
      }
    }
    if (dto.bookingWindow) {
      if (dto.bookingWindow.enabled && dto.bookingWindow.days == null) {
        throw this.domainError(
          'BOOKING_WINDOW_REQUIRED',
          'Для включённого окна записи укажите количество дней'
        );
      }
      if (!dto.bookingWindow.enabled && dto.bookingWindow.days != null) {
        throw this.domainError(
          'BOOKING_WINDOW_FORBIDDEN',
          'Для отключённого окна записи количество дней должно быть пустым'
        );
      }
    }
    for (const rule of dto.stationAccessRules ?? []) {
      const stationIds = rule.selector.stationIds
        .map((stationId) => stationId.trim())
        .filter(Boolean);
      if (rule.selector.kind === 'STATION_LIST' && stationIds.length === 0) {
        throw this.domainError(
          'STATION_LIST_REQUIRED',
          'Для строки станций выберите хотя бы одну станцию'
        );
      }
      if (rule.selector.kind !== 'STATION_LIST' && stationIds.length > 0) {
        throw this.domainError(
          'STATION_LIST_FORBIDDEN',
          'Список станций разрешён только для типа STATION_LIST'
        );
      }
      if (rule.surcharge.kind === 'FIXED' && rule.surcharge.amountMinor <= 0) {
        throw this.domainError(
          'STATION_SURCHARGE_REQUIRED',
          'Для строки с доплатой укажите сумму больше нуля'
        );
      }
      if (rule.surcharge.kind === 'NONE' && rule.surcharge.amountMinor !== 0) {
        throw this.domainError(
          'STATION_SURCHARGE_FORBIDDEN',
          'Для строки без доплаты сумма должна быть нулевой'
        );
      }
    }
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
    if (!policy.activeServicesLimit || !policy.bookingWindow
      || !policy.dailyUsagePolicy || !policy.stationAccessRules) {
      throw this.domainError('RUNTIME_CONTROLS_REQUIRED', 'Не заполнены управляемые ограничения подписки');
    }
    if (policy.activeServicesLimit.enabled && !policy.activeServicesLimit.max) {
      throw this.domainError('ACTIVE_SERVICE_LIMIT_REQUIRED', 'Для включённого лимита укажите максимум активных услуг');
    }
    if (!policy.activeServicesLimit.enabled && policy.activeServicesLimit.max !== null) {
      throw this.domainError('ACTIVE_SERVICE_LIMIT_FORBIDDEN', 'Для отключённого лимита максимум должен быть пустым');
    }
    if (policy.bookingWindow.enabled && !policy.bookingWindow.days) {
      throw this.domainError('BOOKING_WINDOW_REQUIRED', 'Для включённого окна записи укажите количество дней');
    }
    if (!policy.bookingWindow.enabled && policy.bookingWindow.days !== null) {
      throw this.domainError('BOOKING_WINDOW_FORBIDDEN', 'Для отключённого окна записи количество дней должно быть пустым');
    }
    const supportedActions = new Set<SubscriptionAction>([
      'CREATE_GAME',
      'JOIN_GAME',
      'BOOK_GROUP_TRAINING',
      'BOOK_TOURNAMENT',
      'PURCHASE_ADD_ON_PRODUCT'
    ]);
    if (!policy.dailyUsagePolicy.actions.length
      || policy.dailyUsagePolicy.actions.some((action) => !supportedActions.has(action))) {
      throw this.domainError(
        'DAILY_USAGE_ACTIONS_INVALID',
        'Для дневного лимита указаны неподдерживаемые действия'
      );
    }
    if (policy.dailyUsagePolicy.limitExceeded === 'PERCENT_DISCOUNT'
      && (policy.dailyUsagePolicy.percentage === null
        || policy.dailyUsagePolicy.percentage < 0
        || policy.dailyUsagePolicy.percentage > 100)) {
      throw this.domainError(
        'DAILY_USAGE_DISCOUNT_INVALID',
        'Скидка после дневного лимита должна быть от 0 до 100 процентов'
      );
    }
    this.validateStationAccessRules(policy.stationAccessRules);
    const ruleIds = new Set<string>();
    for (const rule of policy.benefitRules) {
      if (!rule.ruleId || ruleIds.has(rule.ruleId)) {
        throw this.domainError('DUPLICATE_BENEFIT_RULE_ID', 'Идентификаторы правил льгот должны быть уникальны');
      }
      ruleIds.add(rule.ruleId);
      if (rule.enabled && rule.actions.length === 0) {
        throw this.domainError('BENEFIT_ACTIONS_REQUIRED', 'Для активной льготы выберите действие');
      }
      if (rule.enabled && !this.benefitActionsMatchCategory(rule.category, rule.actions)) {
        throw this.domainError('BENEFIT_ACTION_CATEGORY_MISMATCH', 'Действие льготы не соответствует категории');
      }
      if (rule.enabled && rule.category === 'ADD_ON_PRODUCT' && rule.productTypeIds.length === 0) {
        throw this.domainError('BENEFIT_PRODUCT_TYPES_REQUIRED', 'Для доппродукта выберите product type IDs');
      }
      if (rule.enabled && rule.externalEventTypeIds.length === 0) {
        throw this.domainError('BENEFIT_EVENT_TYPES_REQUIRED', 'Для активной льготы выберите типы событий');
      }
      if (rule.enabled && rule.durationMinutes.length === 0) {
        throw this.domainError('BENEFIT_DURATIONS_REQUIRED', 'Для активной льготы выберите длительности');
      }
      if (rule.enabled && rule.stationIds.length === 0) {
        throw this.domainError('BENEFIT_STATIONS_REQUIRED', 'Для активной льготы выберите станции');
      }
      if (rule.enabled) this.validateBenefitValue(rule);
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
    this.validateCapabilities(policy.capabilities, policy.validityDays, policy.effectiveAt);
  }

  private normalizeCapabilities(
    input: CreatePolicyVersionDto['capabilities'] | SubscriptionCapabilities | undefined,
    validityDays: number
  ): SubscriptionCapabilities {
    const defaults = defaultSubscriptionCapabilities();
    if (!input) {
      return {
        ...defaults,
        engagement: {
          ...defaults.engagement,
          expirationReminderDays: defaults.engagement.expirationReminderDays
            .filter((days) => days <= validityDays)
        }
      };
    }
    return {
      lifecycle: {
        activationMode: input.lifecycle.activationMode,
        activationWindowDays: input.lifecycle.activationWindowDays,
        fixedActivationAt: ['FIXED_DATE', 'FIRST_USE_OR_FIXED_DATE'].includes(input.lifecycle.activationMode)
          && input.lifecycle.fixedActivationAt
          ? new Date(input.lifecycle.fixedActivationAt).toISOString()
          : null,
        fixedActivationTimeZone: input.lifecycle.fixedActivationTimeZone || 'Europe/Moscow',
        gracePeriodDays: input.lifecycle.gracePeriodDays,
        allowBookingsAfterExpiry: input.lifecycle.allowBookingsAfterExpiry,
        freeze: input.lifecycle.freeze.enabled
          ? { ...input.lifecycle.freeze }
          : {
            enabled: false,
            maxDaysPerYear: 0,
            maxPeriodsPerYear: 0,
            minDaysPerPeriod: 0,
            extendsValidity: input.lifecycle.freeze.extendsValidity
          },
        adminExtension: { ...input.lifecycle.adminExtension }
      },
      usage: {
        weeklyUsageLimit: input.usage.weeklyUsageLimit ?? null,
        monthlyUsageLimit: input.usage.monthlyUsageLimit ?? null,
        maxFutureBookings: input.usage.maxFutureBookings ?? null,
        minHoursBetweenUses: input.usage.minHoursBetweenUses,
        guestPassesPerMonth: input.usage.guestPassesPerMonth,
        earlyBookingAccessHours: input.usage.earlyBookingAccessHours,
        waitlistPriority: input.usage.waitlistPriority,
        crossStationMode: input.usage.crossStationMode,
        crossStationSurchargeMinor: input.usage.crossStationMode === 'ALLOWED_WITH_SURCHARGE'
          ? input.usage.crossStationSurchargeMinor
          : 0,
        blackoutDates: this.uniqueStrings(input.usage.blackoutDates).sort()
      },
      cancellation: {
        freeCancellationHours: { ...input.cancellation.freeCancellationHours },
        lateCancellationUsageUnits: input.cancellation.lateCancellationUsageUnits,
        noShowUsageUnits: input.cancellation.noShowUsageUnits,
        noShowBlockDays: input.cancellation.noShowBlockDays,
        stationCancellationRestoresUsage: input.cancellation.stationCancellationRestoresUsage,
        reschedulePolicy: input.cancellation.reschedulePolicy
      },
      commerce: { ...input.commerce },
      engagement: {
        ...input.engagement,
        expirationReminderDays: [...new Set(input.engagement.expirationReminderDays)]
          .sort((a, b) => b - a)
      },
      analytics: {
        ...input.analytics,
        attributionTag: input.analytics.attributionTag?.trim() || null
      }
    };
  }

  private normalizeProviderBinding(
    input: NonNullable<CreatePolicyVersionDto['providerBinding'] | SubscriptionPolicyVersion['providerBinding']>
  ): NonNullable<SubscriptionPolicyVersion['providerBinding']> {
    const externalId = input.externalId.trim();
    if (!externalId) {
      throw this.domainError(
        'PROVIDER_PRODUCT_ID_REQUIRED',
        'Для привязки Viva укажите productId подписки'
      );
    }
    return {
      provider: 'VIVA' as const,
      externalId,
      referenceKind: 'PRODUCT_CANDIDATE' as const,
      evidenceState: 'UNVERIFIED' as const
    };
  }

  private validateCapabilities(
    capabilities: SubscriptionCapabilities,
    validityDays: number,
    effectiveAt: string
  ): void {
    const lifecycle = capabilities.lifecycle;
    if (lifecycle.activationMode === 'FIXED_DATE' && !lifecycle.fixedActivationAt) {
      throw this.domainError('FIXED_ACTIVATION_DATE_REQUIRED', 'Для фиксированной активации укажите дату');
    }
    if (lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE' && !lifecycle.fixedActivationAt) {
      throw this.domainError(
        'ACTIVATION_FALLBACK_DATE_REQUIRED',
        'Для активации при первой записи укажите предельную дату'
      );
    }
    if (!['FIXED_DATE', 'FIRST_USE_OR_FIXED_DATE'].includes(lifecycle.activationMode)
      && lifecycle.fixedActivationAt) {
      throw this.domainError(
        'FIXED_ACTIVATION_DATE_FORBIDDEN',
        'Дата активации разрешена только для фиксированного или комбинированного режима'
      );
    }
    if (lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE'
      && lifecycle.activationWindowDays !== 0) {
      throw this.domainError(
        'HYBRID_ACTIVATION_WINDOW_FORBIDDEN',
        'Для комбинированной активации используется фиксированная дата, а не окно в днях'
      );
    }
    if (lifecycle.activationMode === 'FIRST_USE_OR_FIXED_DATE'
      && lifecycle.fixedActivationAt
      && Date.parse(lifecycle.fixedActivationAt) < Date.parse(effectiveAt)) {
      throw this.domainError(
        'ACTIVATION_DATE_BEFORE_POLICY_EFFECTIVE_AT',
        'Предельная дата активации не может быть раньше вступления правил в силу'
      );
    }
    if (!lifecycle.freeze.enabled) {
      const freeze = lifecycle.freeze;
      if (freeze.maxDaysPerYear || freeze.maxPeriodsPerYear || freeze.minDaysPerPeriod) {
        throw this.domainError('FREEZE_LIMITS_FORBIDDEN', 'Для отключённой заморозки лимиты должны быть нулевыми');
      }
    } else if (
      lifecycle.freeze.maxDaysPerYear < 1
      || lifecycle.freeze.maxPeriodsPerYear < 1
      || lifecycle.freeze.minDaysPerPeriod < 1
      || lifecycle.freeze.minDaysPerPeriod > lifecycle.freeze.maxDaysPerYear
    ) {
      throw this.domainError('INVALID_FREEZE_LIMITS', 'Проверьте количество и длительность периодов заморозки');
    }
    if (
      capabilities.usage.crossStationMode === 'ALLOWED_WITH_SURCHARGE'
      && capabilities.usage.crossStationSurchargeMinor <= 0
    ) {
      throw this.domainError('CROSS_STATION_SURCHARGE_REQUIRED', 'Для посещения с доплатой укажите сумму');
    }
    if (
      capabilities.usage.crossStationMode !== 'ALLOWED_WITH_SURCHARGE'
      && capabilities.usage.crossStationSurchargeMinor !== 0
    ) {
      throw this.domainError('CROSS_STATION_SURCHARGE_FORBIDDEN', 'Доплата разрешена только для режима ALLOWED_WITH_SURCHARGE');
    }
    const reminders = capabilities.engagement.expirationReminderDays;
    if (reminders.some((days) => days > validityDays)) {
      throw this.domainError('EXPIRATION_REMINDER_OUTSIDE_VALIDITY', 'Напоминание не может быть позже срока подписки');
    }
    for (const date of capabilities.usage.blackoutDates) {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw this.domainError('INVALID_BLACKOUT_DATE', 'Blackout-даты должны быть календарными датами YYYY-MM-DD');
      }
    }
  }

  private normalizeBenefitActions(
    category: BenefitCategory,
    actions: SubscriptionAction[] | undefined
  ): SubscriptionAction[] {
    if (actions?.length) return [...new Set(actions)].sort();
    if (category === 'GAME') return ['JOIN_GAME'];
    if (category === 'GROUP_TRAINING') return ['BOOK_GROUP_TRAINING'];
    if (category === 'TOURNAMENT') return ['BOOK_TOURNAMENT'];
    return ['PURCHASE_ADD_ON_PRODUCT'];
  }

  private benefitActionsMatchCategory(
    category: BenefitCategory,
    actions: SubscriptionAction[]
  ): boolean {
    const allowed: Record<BenefitCategory, SubscriptionAction[]> = {
      GAME: ['CREATE_GAME', 'JOIN_GAME'],
      GROUP_TRAINING: ['BOOK_GROUP_TRAINING'],
      TOURNAMENT: ['BOOK_TOURNAMENT'],
      ADD_ON_PRODUCT: ['PURCHASE_ADD_ON_PRODUCT']
    };
    return actions.every((action) => allowed[category].includes(action));
  }

  private validateStationAccessRules(rules: SubscriptionStationAccessRule[]): void {
    const ids = new Set<string>();
    for (const rule of rules) {
      if (!rule.ruleId || ids.has(rule.ruleId)) {
        throw this.domainError('DUPLICATE_STATION_RULE_ID', 'Идентификаторы правил станций должны быть уникальны');
      }
      ids.add(rule.ruleId);
      if (rule.selector.kind === 'STATION_LIST' && rule.selector.stationIds.length === 0) {
        throw this.domainError('STATION_LIST_REQUIRED', 'Для строки станций выберите хотя бы одну станцию');
      }
      if (rule.selector.kind !== 'STATION_LIST' && rule.selector.stationIds.length > 0) {
        throw this.domainError('STATION_LIST_FORBIDDEN', 'Список станций разрешён только для типа STATION_LIST');
      }
      if (rule.surcharge.kind === 'FIXED' && rule.surcharge.amountMinor <= 0) {
        throw this.domainError('STATION_SURCHARGE_REQUIRED', 'Для строки с доплатой укажите сумму больше нуля');
      }
      if (rule.surcharge.kind === 'NONE' && rule.surcharge.amountMinor !== 0) {
        throw this.domainError('STATION_SURCHARGE_FORBIDDEN', 'Для строки без доплаты сумма должна быть нулевой');
      }
    }
    for (let left = 0; left < rules.length; left += 1) {
      for (let right = left + 1; right < rules.length; right += 1) {
        const a = rules[left];
        const b = rules[right];
        if (!a.enabled || !b.enabled || a.priority !== b.priority) continue;
        if (a.selector.kind === 'ALL_STATIONS' || b.selector.kind === 'ALL_STATIONS') {
          throw this.domainError('AMBIGUOUS_STATION_PRIORITY', 'Пересекающиеся правила станций должны иметь разный приоритет');
        }
        if (a.selector.kind === b.selector.kind && a.selector.kind === 'HOME_STATION') {
          throw this.domainError('AMBIGUOUS_STATION_PRIORITY', 'Домашняя станция не может иметь два правила одного приоритета');
        }
        if (a.selector.kind === 'HOME_STATION' || b.selector.kind === 'HOME_STATION') {
          throw this.domainError(
            'AMBIGUOUS_STATION_PRIORITY',
            'Домашнее правило и список станций должны иметь разный приоритет'
          );
        }
        if (
          a.selector.kind === 'STATION_LIST'
          && b.selector.kind === 'STATION_LIST'
          && this.intersects(a.selector.stationIds, b.selector.stationIds)
        ) {
          throw this.domainError('AMBIGUOUS_STATION_PRIORITY', 'Пересекающиеся списки станций должны иметь разный приоритет');
        }
      }
    }
  }

  private validateBenefitValue(rule: BenefitRule): void {
    const hasMoney = rule.valueMinor !== null;
    const hasPercentage = rule.percentage !== null;
    if (rule.kind === 'FIXED_PRICE' || rule.kind === 'FIXED_DISCOUNT') {
      if (!hasMoney || hasPercentage || rule.partialPrice) {
        throw this.domainError('INVALID_BENEFIT_VALUE', 'Денежная льгота требует только valueMinor');
      }
      return;
    }
    if (rule.kind === 'PERCENT_DISCOUNT') {
      if (!hasPercentage || hasMoney || Number(rule.percentage) <= 0 || rule.partialPrice) {
        throw this.domainError('INVALID_BENEFIT_VALUE', 'Процентная льгота требует только percentage больше нуля');
      }
      return;
    }
    if (rule.kind === 'PARTIAL_PRICE_PERCENT_DISCOUNT') {
      if (
        !hasPercentage
        || hasMoney
        || Number(rule.percentage) <= 0
        || !rule.partialPrice
        || rule.partialPrice.numerator >= rule.partialPrice.denominator
      ) {
        throw this.domainError(
          'INVALID_PARTIAL_PRICE_BENEFIT',
          'Частичная цена требует долю меньше единицы и скидку больше нуля'
        );
      }
      return;
    }
    if (hasMoney || hasPercentage || rule.partialPrice) {
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
    const {
      _id: _documentId,
      schemaVersion: _schemaVersion,
      idempotency: _idempotency,
      capabilities,
      providerBinding,
      modelVersion: _modelVersion,
      ...policy
    } = row as StoredSubscriptionPolicyVersion & { _id?: unknown };
    return {
      ...policy,
      modelVersion: row.modelVersion === 3 ? 3 : 2,
      activeServicesLimit: row.activeServicesLimit ?? {
        enabled: row.maxActiveServices > 0,
        max: row.maxActiveServices > 0 ? row.maxActiveServices : null,
        scope: row.activeServiceScope
      },
      bookingWindow: row.bookingWindow ?? {
        enabled: true,
        days: row.bookingWindowDays
      },
      dailyUsagePolicy: row.dailyUsagePolicy ?? {
        actions: [
          'CREATE_GAME',
          'JOIN_GAME',
          'BOOK_GROUP_TRAINING',
          'BOOK_TOURNAMENT',
          'PURCHASE_ADD_ON_PRODUCT'
        ],
        limitExceeded: 'BLOCK',
        percentage: null
      },
      stationAccessRules: row.stationAccessRules ?? [],
      benefitRules: (row.benefitRules ?? []).map((rule) => ({
        ...rule,
        actions: rule.actions ?? this.normalizeBenefitActions(rule.category, undefined),
        productTypeIds: rule.productTypeIds ?? [],
        durationMinutes: rule.durationMinutes ?? [],
        partialPrice: rule.partialPrice ?? null
      })),
      ...(providerBinding
        ? { providerBinding: this.normalizeProviderBinding(providerBinding) }
        : {}),
      capabilities: this.normalizeCapabilities(capabilities, row.validityDays)
    };
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

  private replayPolicy<TPublic>(
    row: StoredSubscriptionPolicyVersion,
    acceptedRequestHashes: string[],
    item: TPublic
  ): SubscriptionCreateResult<TPublic> {
    if (!acceptedRequestHashes.includes(row.idempotency.requestHash)) {
      throw this.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key уже использован для другого запроса');
    }
    return { item, replayed: true, correlationId: row.idempotency.correlationId };
  }

  private previousPolicyShape(
    policy: ReturnType<SubscriptionsService['normalizePolicy']>
  ): unknown {
    const {
      activeServicesLimit: _activeServicesLimit,
      bookingWindow: _bookingWindow,
      dailyUsagePolicy: _dailyUsagePolicy,
      stationAccessRules: _stationAccessRules,
      ...previous
    } = policy;
    return {
      ...previous,
      modelVersion: 2,
      benefitRules: previous.benefitRules.map((rule) => {
        const {
          actions: _actions,
          productTypeIds: _productTypeIds,
          durationMinutes: _durationMinutes,
          partialPrice: _partialPrice,
          ...previousRule
        } = rule;
        return previousRule;
      })
    };
  }

  private preDailyUsagePolicyShape(
    policy: ReturnType<SubscriptionsService['normalizePolicy']>
  ): unknown {
    const { dailyUsagePolicy: _dailyUsagePolicy, ...previous } = policy;
    return previous;
  }

  private legacyPolicyShape(
    policy: ReturnType<SubscriptionsService['normalizePolicy']>
  ): unknown {
    const {
      modelVersion: _modelVersion,
      capabilities: _capabilities,
      activeServicesLimit: _activeServicesLimit,
      bookingWindow: _bookingWindow,
      dailyUsagePolicy: _dailyUsagePolicy,
      stationAccessRules: _stationAccessRules,
      ...legacy
    } = policy;
    return {
      ...legacy,
      benefitRules: legacy.benefitRules.map((rule) => {
        const {
          actions: _actions,
          productTypeIds: _productTypeIds,
          durationMinutes: _durationMinutes,
          partialPrice: _partialPrice,
          ...legacyRule
        } = rule;
        return legacyRule;
      })
    };
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
