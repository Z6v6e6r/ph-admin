import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import type { ClientSession } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import {
  hashResidentIdempotencyKey,
  residentPeriodKey,
  residentRequestHash,
  residentStationScopeKey
} from './resident-service-crypto';
import {
  assertResidentServicesEnabled,
  requireResidentServicesIdempotencyKey,
  requireResidentServicesTenantId,
  requireResidentServicesTokenPepper,
  RESIDENT_SERVICES_ID_PATTERN
} from './resident-services.config';
import { ResidentContext, ResidentResidencyService, RESIDENT_SERVICES_CLOCK } from './resident-residency.service';
import { ResidentServicesRepository } from './resident-services.repository';
import {
  RESIDENT_SERVICE_KINDS,
  RESIDENT_SERVICE_LABELS,
  RESIDENT_SERVICE_LIMIT_PERIODS,
  RESIDENT_SERVICES_ERROR_CODES,
  RESIDENT_SERVICES_MAX_ITEM_QUANTITY,
  RESIDENT_SERVICES_MAX_LIMIT_QUANTITY,
  RESIDENT_SERVICES_MAX_RULES_PER_TYPE,
  ResidentBenefitStationScope,
  ResidentBenefitRuleView,
  ResidentServiceAvailabilityView,
  ResidentServiceItemCommand,
  ResidentServiceKind,
  ResidentServiceLimitPeriod,
  StoredResidentBenefitRule,
  StoredResidentIssuanceItem
} from './resident-services.types';

const SERVICE_PERMISSION = 'resident-services:issue';
const CONFIGURE_PERMISSION = 'resident-services:configure';
const READ_PERMISSION = 'resident-services:read';

export interface CreateBenefitRuleCommand {
  subscriptionTypeId: string;
  serviceKind: ResidentServiceKind;
  stationIds?: string[];
  limitPeriod: ResidentServiceLimitPeriod;
  limitQuantity: number;
  returnable: boolean;
  enabled?: boolean;
}

export interface UpdateBenefitRuleCommand {
  stationIds?: string[];
  limitPeriod?: ResidentServiceLimitPeriod;
  limitQuantity?: number;
  returnable?: boolean;
  enabled?: boolean;
  expectedRevision: number;
}

export interface ResidentRuleMutationResult {
  rule: ResidentBenefitRuleView;
  replayed: boolean;
}

@Injectable()
export class ResidentBenefitsService {
  constructor(
    private readonly repository: ResidentServicesRepository,
    private readonly residency: ResidentResidencyService,
    @Optional() @Inject(RESIDENT_SERVICES_CLOCK) private readonly clock?: () => Date
  ) {}

  async listRules(user: RequestUser | undefined): Promise<{ items: ResidentBenefitRuleView[] }> {
    assertResidentServicesEnabled();
    const tenantId = requireResidentServicesTenantId();
    this.repository.requireAvailable();
    this.assertStaffAccess(user, READ_PERMISSION);
    const types = new Map<string, string>();
    const rules = await this.repository.benefitRulesByTenant(tenantId);
    const scope = this.readStationScope(user, READ_PERMISSION);
    const visible = rules.filter((rule) =>
      rule.stationScope.kind === 'ALL_STATIONS'
      || scope === null
      || rule.stationScope.stationIds.some((stationId) => scope.includes(stationId))
    );
    const items: ResidentBenefitRuleView[] = [];
    for (const rule of visible) {
      let title = types.get(rule.subscriptionTypeId) ?? null;
      if (title === null) {
        const type = await this.repository.subscriptionTypeById(rule.subscriptionTypeId);
        title = type?.title ?? null;
        if (title !== null) types.set(rule.subscriptionTypeId, title);
      }
      items.push(this.ruleView(rule, title));
    }
    return { items };
  }

  async createRule(
    command: CreateBenefitRuleCommand,
    idempotencyHeader: string | undefined,
    user: RequestUser | undefined,
    correlationId: string
  ): Promise<ResidentRuleMutationResult> {
    assertResidentServicesEnabled();
    const tenantId = requireResidentServicesTenantId();
    this.repository.requireAvailable();
    const actorId = this.requireStaff(user, CONFIGURE_PERMISSION);
    const idempotencyKey = requireResidentServicesIdempotencyKey(idempotencyHeader);
    const pepper = requireResidentServicesTokenPepper();
    const stationScope = this.normalizeScope(command.stationIds);
    this.assertCanConfigure(user, stationScope);
    const enabled = command.enabled !== false;
    this.validateRuleFields(command.limitPeriod, command.limitQuantity, command.returnable);
    await this.requireSubscriptionType(command.subscriptionTypeId);
    const stationScopeKey = residentStationScopeKey(stationScope.stationIds);
    const requestHash = residentRequestHash([
      'benefit-rule-create:v1',
      tenantId,
      actorId,
      command.subscriptionTypeId,
      command.serviceKind,
      stationScopeKey,
      command.limitPeriod,
      String(command.limitQuantity),
      String(command.returnable),
      String(enabled)
    ]);
    const keyHash = hashResidentIdempotencyKey({ pepper, tenantId, actorId, key: idempotencyKey });
    const existing = await this.repository.benefitRuleByIdempotency(tenantId, actorId, keyHash);
    if (existing) {
      if (existing.idempotency?.requestHash !== requestHash) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          message: 'Idempotency-Key was already used with another benefit rule intent'
        });
      }
      return { rule: this.ruleView(existing, null), replayed: true };
    }
    const sameScope = await this.repository.benefitRulesByType(
      tenantId,
      command.subscriptionTypeId
    );
    if (sameScope.length >= RESIDENT_SERVICES_MAX_RULES_PER_TYPE) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Too many resident benefit rules for this subscription type'
      });
    }
    if (sameScope.some((rule) =>
      rule.serviceKind === command.serviceKind && rule.stationScopeKey === stationScopeKey
    )) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_CONFLICT,
        message: 'Resident benefit rule already exists for this scope'
      });
    }
    const now = this.now().toISOString();
    const rule: StoredResidentBenefitRule = {
      schemaVersion: 1,
      ruleId: 'resident_benefit_rule:' + randomUUID(),
      tenantId,
      subscriptionTypeId: command.subscriptionTypeId,
      serviceKind: command.serviceKind,
      stationScopeKey,
      stationScope,
      limitPeriod: command.limitPeriod,
      limitQuantity: command.limitQuantity,
      returnable: command.returnable,
      enabled,
      revision: 1,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
      idempotency: { actorId, keyHash, requestHash, correlationId }
    };
    await this.repository.insertBenefitRule(rule);
    return { rule: this.ruleView(rule, await this.titleOf(rule.subscriptionTypeId)), replayed: false };
  }

  async updateRule(
    ruleId: string,
    command: UpdateBenefitRuleCommand,
    user: RequestUser | undefined
  ): Promise<ResidentBenefitRuleView> {
    assertResidentServicesEnabled();
    const tenantId = requireResidentServicesTenantId();
    this.repository.requireAvailable();
    const actorId = this.requireStaff(user, CONFIGURE_PERMISSION);
    const rule = await this.repository.benefitRuleById(tenantId, ruleId);
    if (!rule) {
      throw new NotFoundException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_NOT_FOUND,
        message: 'Resident benefit rule was not found'
      });
    }
    const scope = command.stationIds === undefined
      ? rule.stationScope
      : this.normalizeScope(command.stationIds);
    this.assertCanConfigure(user, scope);
    const limitPeriod = command.limitPeriod ?? rule.limitPeriod;
    const limitQuantity = command.limitQuantity ?? rule.limitQuantity;
    const returnable = command.returnable ?? rule.returnable;
    const enabled = command.enabled ?? rule.enabled;
    this.validateRuleFields(limitPeriod, limitQuantity, returnable);
    const stationScopeKey = residentStationScopeKey(scope.stationIds);
    const siblings = await this.repository.benefitRulesByType(
      tenantId,
      rule.subscriptionTypeId
    );
    if (siblings.some((row) =>
      row.ruleId !== rule.ruleId
      && row.serviceKind === rule.serviceKind
      && row.stationScopeKey === stationScopeKey
    )) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_CONFLICT,
        message: 'Resident benefit rule already exists for this scope'
      });
    }
    const updated = await this.repository.updateBenefitRule({
      tenantId,
      ruleId,
      expectedRevision: command.expectedRevision,
      rule: {
        stationScopeKey,
        stationScope: scope,
        limitPeriod,
        limitQuantity,
        returnable,
        enabled,
        updatedBy: actorId,
        updatedAt: this.now().toISOString()
      }
    });
    if (!updated) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_REVISION_CONFLICT,
        message: 'Resident benefit rule revision conflict'
      });
    }
    return this.ruleView(updated, await this.titleOf(updated.subscriptionTypeId));
  }

  async availability(
    context: ResidentContext,
    stationId: string
  ): Promise<ResidentServiceAvailabilityView[]> {
    const now = this.now();
    const items: ResidentServiceAvailabilityView[] = [];
    for (const serviceKind of RESIDENT_SERVICE_KINDS) {
      let rule: StoredResidentBenefitRule | null = null;
      let blocker: string | null = null;
      try {
        rule = await this.resolveRule(context, serviceKind, stationId);
      } catch {
        blocker = RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_CONFLICT;
      }
      if (!rule) {
        items.push({
          serviceKind,
          label: RESIDENT_SERVICE_LABELS[serviceKind],
          returnable: false,
          limitPeriod: null,
          limitQuantity: null,
          used: 0,
          remaining: 0,
          available: false,
          blocker: blocker ?? RESIDENT_SERVICES_ERROR_CODES.SERVICE_NOT_CONFIGURED
        });
        continue;
      }
      const periodKey = residentPeriodKey(rule.limitPeriod, now);
      const usage = await this.repository.usageFor({
        tenantId: context.tenantId,
        clientRefHash: context.clientRefHash,
        serviceKind,
        limitPeriod: rule.limitPeriod,
        periodKey
      });
      const used = usage?.used ?? 0;
      const remaining = Math.max(0, rule.limitQuantity - used);
      items.push({
        serviceKind,
        label: RESIDENT_SERVICE_LABELS[serviceKind],
        returnable: rule.returnable,
        limitPeriod: rule.limitPeriod,
        limitQuantity: rule.limitQuantity,
        used,
        remaining,
        available: rule.enabled && remaining > 0,
        blocker: rule.enabled && remaining > 0
          ? null
          : RESIDENT_SERVICES_ERROR_CODES.SERVICE_LIMIT_EXCEEDED
      });
    }
    return items;
  }

  async resolveRule(
    context: ResidentContext,
    serviceKind: ResidentServiceKind,
    stationId: string,
    session?: ClientSession
  ): Promise<StoredResidentBenefitRule | null> {
    const rules = await this.repository.benefitRulesByType(
      context.tenantId,
      context.instance.subscriptionTypeId,
      session
    );
    const matches = rules.filter((rule) => (
      rule.enabled
      && rule.serviceKind === serviceKind
      && (rule.stationScope.kind === 'ALL_STATIONS'
        || rule.stationScope.stationIds.includes(stationId))
    ));
    if (matches.length === 0) return null;
    const stationSpecific = matches.filter((rule) => rule.stationScope.kind === 'STATION_LIST');
    const candidates = stationSpecific.length > 0 ? stationSpecific : matches;
    if (candidates.length !== 1) {
      throw new ConflictException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_CONFLICT,
        message: 'Resident benefit rule is ambiguous for this station'
      });
    }
    return candidates[0];
  }

  async consumeForIssuance(input: {
    context: ResidentContext;
    stationId: string;
    items: ResidentServiceItemCommand[];
    now: Date;
    session: ClientSession;
  }): Promise<StoredResidentIssuanceItem[]> {
    const normalized = this.normalizeItems(input.items);
    const decisions: StoredResidentIssuanceItem[] = [];
    for (const item of normalized) {
      const rule = await this.resolveRule(
        input.context,
        item.serviceKind,
        input.stationId,
        input.session
      );
      if (!rule) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_NOT_CONFIGURED,
          message: 'Resident service benefit is not configured',
          cause: { serviceKind: item.serviceKind }
        });
      }
      const periodKey = residentPeriodKey(rule.limitPeriod, input.now);
      const usage = await this.repository.usageFor({
        tenantId: input.context.tenantId,
        clientRefHash: input.context.clientRefHash,
        serviceKind: item.serviceKind,
        limitPeriod: rule.limitPeriod,
        periodKey,
        session: input.session
      });
      const used = usage?.used ?? 0;
      if (used + item.quantity > rule.limitQuantity) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_LIMIT_EXCEEDED,
          message: 'Resident service limit is exhausted',
          cause: {
            serviceKind: item.serviceKind,
            limitPeriod: rule.limitPeriod,
            limitQuantity: rule.limitQuantity,
            used
          }
        });
      }
      const consumed = await this.repository.consumeUsage({
        tenantId: input.context.tenantId,
        subscriptionInstanceId: input.context.instance.subscriptionInstanceId,
        clientRefHash: input.context.clientRefHash,
        serviceKind: item.serviceKind,
        limitPeriod: rule.limitPeriod,
        periodKey,
        quantity: item.quantity,
        limitQuantity: rule.limitQuantity,
        now: input.now,
        session: input.session
      });
      if (!consumed) {
        throw new ConflictException({
          code: RESIDENT_SERVICES_ERROR_CODES.SERVICE_LIMIT_EXCEEDED,
          message: 'Resident service limit is exhausted',
          cause: {
            serviceKind: item.serviceKind,
            limitPeriod: rule.limitPeriod,
            limitQuantity: rule.limitQuantity,
            used
          }
        });
      }
      decisions.push({
        serviceKind: item.serviceKind,
        quantity: item.quantity,
        returnable: rule.returnable,
        returnedQuantity: 0,
        benefitRuleId: rule.ruleId,
        limitPeriod: rule.limitPeriod,
        limitPeriodKey: periodKey,
        limitQuantity: rule.limitQuantity,
        remainingAfter: consumed.remaining
      });
    }
    return decisions;
  }

  normalizeItems(items: ResidentServiceItemCommand[]): ResidentServiceItemCommand[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
        message: 'At least one resident service item is required'
      });
    }
    const seen = new Set<ResidentServiceKind>();
    const normalized: ResidentServiceItemCommand[] = [];
    for (const item of items) {
      if (!item || !RESIDENT_SERVICE_KINDS.includes(item.serviceKind)) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Resident service kind is invalid'
        });
      }
      if (seen.has(item.serviceKind)) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Duplicate resident service kind in one operation'
        });
      }
      seen.add(item.serviceKind);
      if (!Number.isSafeInteger(item.quantity)
        || item.quantity < 1
        || item.quantity > RESIDENT_SERVICES_MAX_ITEM_QUANTITY) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID,
          message: 'Resident service quantity is invalid'
        });
      }
      normalized.push({ serviceKind: item.serviceKind, quantity: item.quantity });
    }
    return normalized.sort((left, right) => (
      left.serviceKind === right.serviceKind ? 0 : left.serviceKind === 'TOWEL' ? -1 : 1
    ));
  }

  private normalizeScope(stationIds: string[] | undefined): ResidentBenefitStationScope {
    if (stationIds === undefined || stationIds.length === 0) {
      return { kind: 'ALL_STATIONS', stationIds: [] };
    }
    const normalized = [...new Set(stationIds.map((item) => String(item).trim()))];
    if (normalized.length !== stationIds.length) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Resident benefit station list contains duplicates'
      });
    }
    for (const stationId of normalized) {
      if (!RESIDENT_SERVICES_ID_PATTERN.test(stationId)) {
        throw new BadRequestException({
          code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
          message: 'Resident benefit station id is invalid'
        });
      }
    }
    return { kind: 'STATION_LIST', stationIds: normalized };
  }

  private validateRuleFields(
    limitPeriod: ResidentServiceLimitPeriod,
    limitQuantity: number,
    returnable: boolean
  ): void {
    if (!RESIDENT_SERVICE_LIMIT_PERIODS.includes(limitPeriod)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Resident benefit limit period is invalid'
      });
    }
    if (!Number.isSafeInteger(limitQuantity)
      || limitQuantity < 1
      || limitQuantity > RESIDENT_SERVICES_MAX_LIMIT_QUANTITY) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Resident benefit limit quantity is invalid'
      });
    }
    if (typeof returnable !== 'boolean') {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Resident benefit returnable flag is invalid'
      });
    }
  }

  private assertCanConfigure(
    user: RequestUser | undefined,
    scope: ResidentBenefitStationScope
  ): void {
    this.requireStaff(user, CONFIGURE_PERMISSION);
    const stationScope = this.readStationScope(user, CONFIGURE_PERMISSION);
    if (stationScope === null) return;
    if (scope.kind === 'ALL_STATIONS') {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
        message: 'All-station benefit rules require global station access'
      });
    }
    const forbidden = scope.stationIds.filter((stationId) => !stationScope.includes(stationId));
    if (forbidden.length > 0) {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
        message: 'Resident benefit stations are outside the allowed scope'
      });
    }
  }

  private assertStaffAccess(user: RequestUser | undefined, permission: string): void {
    this.requireStaff(user, permission);
  }

  private requireStaff(user: RequestUser | undefined, permission: string): string {
    if (!user || user.id === 'anonymous') {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
        message: 'Staff authorization is required'
      });
    }
    if (!(user.permissions?.includes('*') || user.permissions?.includes(permission))) {
      throw new ForbiddenException({
        code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
        message: 'Resident services permission is required'
      });
    }
    return user.id;
  }

  private readStationScope(
    user: RequestUser | undefined,
    permission: string
  ): string[] | null {
    return getStationScopeForPermission(user, permission);
  }

  private async requireSubscriptionType(subscriptionTypeId: string): Promise<void> {
    if (!RESIDENT_SERVICES_ID_PATTERN.test(subscriptionTypeId)) {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Subscription type id is invalid'
      });
    }
    const type = await this.repository.subscriptionTypeById(subscriptionTypeId);
    if (!type || type.state === 'ARCHIVED') {
      throw new BadRequestException({
        code: RESIDENT_SERVICES_ERROR_CODES.BENEFIT_RULE_INVALID,
        message: 'Subscription type was not found or is archived'
      });
    }
  }

  private async titleOf(subscriptionTypeId: string): Promise<string | null> {
    const type = await this.repository.subscriptionTypeById(subscriptionTypeId);
    return type?.title ?? null;
  }

  private ruleView(
    rule: StoredResidentBenefitRule,
    subscriptionTypeTitle: string | null
  ): ResidentBenefitRuleView {
    return {
      ruleId: rule.ruleId,
      subscriptionTypeId: rule.subscriptionTypeId,
      subscriptionTypeTitle,
      serviceKind: rule.serviceKind,
      stationScope: rule.stationScope,
      limitPeriod: rule.limitPeriod,
      limitQuantity: rule.limitQuantity,
      returnable: rule.returnable,
      enabled: rule.enabled,
      revision: rule.revision,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    };
  }

  protected now(): Date {
    return this.clock ? this.clock() : new Date();
  }
}
