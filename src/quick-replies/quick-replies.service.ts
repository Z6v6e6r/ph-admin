import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MessageAttachment,
  MessageAttachmentType
} from '../common/messages/message-attachment.types';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { CreateQuickReplyRuleDto } from './dto/create-quick-reply-rule.dto';
import { UpdateQuickReplyRuleDto } from './dto/update-quick-reply-rule.dto';
import { QuickRepliesPersistenceService } from './quick-replies-persistence.service';
import {
  QUICK_REPLY_UNASSIGNED_STATION_ID,
  QuickReplyMatchContext,
  QuickReplyMode,
  QuickReplyRule,
  QuickReplyTriggerType,
  QuickReplyUsageLog
} from './quick-replies.types';

@Injectable()
export class QuickRepliesService implements OnModuleInit, OnApplicationBootstrap {
  private readonly rules = new Map<string, QuickReplyRule>();
  private readonly usageLogsByRuleId = new Map<string, QuickReplyUsageLog[]>();

  constructor(private readonly persistence: QuickRepliesPersistenceService) {}

  async onModuleInit(): Promise<void> {
    await this.hydrateFromPersistence();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.hydrateFromPersistence();
  }

  async hydrateFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }

    const state = await this.persistence.loadState();
    this.rules.clear();
    this.usageLogsByRuleId.clear();

    for (const rule of state.rules) {
      this.rules.set(rule.id, this.normalizeLoadedRule(rule));
    }

    for (const usageLog of state.usageLogs) {
      const existing = this.usageLogsByRuleId.get(usageLog.ruleId) ?? [];
      existing.push(usageLog);
      this.usageLogsByRuleId.set(usageLog.ruleId, existing);
    }
  }

  listRules(user: RequestUser): QuickReplyRule[] {
    this.ensureSettingsReadAccess(user);
    return Array.from(this.rules.values())
      .map((rule) => this.cloneRule(rule))
      .sort((left, right) => {
        if (left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1;
        }
        const byUsage = (right.usageCount ?? 0) - (left.usageCount ?? 0);
        if (byUsage !== 0) {
          return byUsage;
        }
        return this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt);
      });
  }

  listUsageLogs(
    ruleId: string,
    user: RequestUser,
    limit = 100
  ): QuickReplyUsageLog[] {
    this.ensureSettingsReadAccess(user);
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new NotFoundException(`Quick reply rule with id ${ruleId} not found`);
    }

    const normalizedLimit = Math.min(
      Math.max(Math.floor(Number(limit || 100)), 1),
      500
    );
    return (this.usageLogsByRuleId.get(ruleId) ?? [])
      .slice()
      .sort((left, right) => this.toTimestamp(right.createdAt) - this.toTimestamp(left.createdAt))
      .slice(0, normalizedLimit);
  }

  createRule(dto: CreateQuickReplyRuleDto, user: RequestUser): QuickReplyRule {
    this.ensureSettingsManageAccess(user);
    const now = new Date().toISOString();
    const rule: QuickReplyRule = this.normalizeRuleConfig({
      id: randomUUID(),
      title: dto.title,
      triggerType: dto.triggerType,
      triggerPhrase: dto.triggerPhrase,
      triggerKeywords: dto.triggerKeywords,
      timeFrom: dto.timeFrom,
      timeTo: dto.timeTo,
      noClientReplyMinutes: dto.noClientReplyMinutes,
      stationIds: dto.stationIds ?? [],
      mode: dto.mode,
      responseText: dto.responseText,
      responseAttachments: this.normalizeMessageAttachments(dto.responseAttachments),
      isActive: dto.isActive ?? true,
      usageCount: 0,
      lastUsedAt: undefined,
      createdAt: now,
      updatedAt: now
    });
    this.rules.set(rule.id, rule);
    this.persistence.persistRule(rule);
    return this.cloneRule(rule);
  }

  updateRule(
    ruleId: string,
    dto: UpdateQuickReplyRuleDto,
    user: RequestUser
  ): QuickReplyRule {
    this.ensureSettingsManageAccess(user);
    const existing = this.rules.get(ruleId);
    if (!existing) {
      throw new NotFoundException(`Quick reply rule with id ${ruleId} not found`);
    }

    const updated: QuickReplyRule = this.normalizeRuleConfig({
      ...existing,
      title: dto.title ?? existing.title,
      triggerType: dto.triggerType ?? existing.triggerType,
      triggerPhrase:
        dto.triggerPhrase === undefined ? existing.triggerPhrase : dto.triggerPhrase,
      triggerKeywords:
        dto.triggerKeywords === undefined
          ? existing.triggerKeywords
          : dto.triggerKeywords,
      timeFrom: dto.timeFrom === undefined ? existing.timeFrom : dto.timeFrom,
      timeTo: dto.timeTo === undefined ? existing.timeTo : dto.timeTo,
      noClientReplyMinutes:
        dto.noClientReplyMinutes === undefined
          ? existing.noClientReplyMinutes
          : dto.noClientReplyMinutes,
      stationIds:
        dto.stationIds === undefined ? existing.stationIds : dto.stationIds,
      mode: dto.mode ?? existing.mode,
      responseText: dto.responseText ?? existing.responseText,
      responseAttachments:
        dto.responseAttachments === undefined
          ? this.normalizeMessageAttachments(existing.responseAttachments)
          : this.normalizeMessageAttachments(dto.responseAttachments),
      isActive: dto.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString()
    });

    this.rules.set(ruleId, updated);
    this.persistence.persistRule(updated);
    return this.cloneRule(updated);
  }

  findMatchingRules(
    context: QuickReplyMatchContext,
    mode?: QuickReplyMode
  ): QuickReplyRule[] {
    return Array.from(this.rules.values())
      .filter((rule) => rule.isActive)
      .filter((rule) => (mode ? rule.mode === mode : true))
      .filter((rule) => this.matchesStation(rule, context.stationId))
      .filter((rule) => this.matchesTrigger(rule, context))
      .sort((left, right) => {
        const bySpecificity =
          this.resolveTriggerSpecificity(left.triggerType) -
          this.resolveTriggerSpecificity(right.triggerType);
        if (bySpecificity !== 0) {
          return bySpecificity;
        }
        return this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt);
      })
      .map((rule) => this.cloneRule(rule));
  }

  registerUsage(
    ruleId: string | undefined,
    context: QuickReplyMatchContext,
    usedByUserId?: string
  ): QuickReplyUsageLog | undefined {
    const normalizedRuleId = String(ruleId ?? '').trim();
    if (!normalizedRuleId) {
      return undefined;
    }

    const existing = this.rules.get(normalizedRuleId);
    if (!existing) {
      return undefined;
    }

    const now = new Date().toISOString();
    const updatedRule: QuickReplyRule = {
      ...existing,
      usageCount: Math.max(0, Number(existing.usageCount || 0)) + 1,
      lastUsedAt: now,
      updatedAt: now
    };
    this.rules.set(existing.id, updatedRule);
    this.persistence.persistRule(updatedRule);

    const usageLog: QuickReplyUsageLog = {
      id: randomUUID(),
      ruleId: updatedRule.id,
      ruleTitle: updatedRule.title,
      sourceType: context.sourceType,
      dialogId: context.dialogId,
      connector: this.normalizeOptionalText(context.connector),
      stationId: this.normalizeOptionalText(context.stationId),
      clientRequestText: this.normalizeOptionalText(context.messageText),
      systemResponseText: this.normalizeOptionalText(updatedRule.responseText),
      usedByUserId: this.normalizeOptionalText(usedByUserId),
      mode: updatedRule.mode,
      createdAt: now
    };

    const logs = this.usageLogsByRuleId.get(updatedRule.id) ?? [];
    logs.unshift(usageLog);
    this.usageLogsByRuleId.set(updatedRule.id, logs.slice(0, 500));
    this.persistence.persistUsageLog(usageLog);

    return usageLog;
  }

  private normalizeLoadedRule(rule: QuickReplyRule): QuickReplyRule {
    return this.normalizeRuleConfig({
      ...rule,
      title: this.normalizeOptionalText(rule.title) ?? 'Быстрый ответ',
      responseText: this.normalizeOptionalText(rule.responseText) ?? 'Спасибо!',
      responseAttachments: this.normalizeMessageAttachments(rule.responseAttachments),
      stationIds: this.normalizeStationIds(rule.stationIds),
      mode:
        rule.mode === QuickReplyMode.AUTO_REPLY
          ? QuickReplyMode.AUTO_REPLY
          : QuickReplyMode.SUGGESTION,
      usageCount: Math.max(0, Number(rule.usageCount || 0)),
      isActive: rule.isActive !== false,
      createdAt: this.normalizeOptionalText(rule.createdAt) ?? new Date().toISOString(),
      updatedAt: this.normalizeOptionalText(rule.updatedAt) ?? new Date().toISOString()
    });
  }

  private normalizeRuleConfig(rule: QuickReplyRule): QuickReplyRule {
    const triggerType = rule.triggerType;
    const triggerPhrase = this.normalizeOptionalText(rule.triggerPhrase);
    const triggerKeywords = this.normalizeStationIds(rule.triggerKeywords);
    const timeFrom = this.normalizeOptionalText(rule.timeFrom);
    const timeTo = this.normalizeOptionalText(rule.timeTo);
    const noClientReplyMinutes = Number(rule.noClientReplyMinutes);

    if (
      (triggerType === QuickReplyTriggerType.EXACT_PHRASE ||
        triggerType === QuickReplyTriggerType.KEYWORD) &&
      !triggerPhrase
    ) {
      throw new BadRequestException('Для выбранного триггера нужна фраза или ключевое слово');
    }

    if (
      triggerType === QuickReplyTriggerType.KEYWORD_SET &&
      triggerKeywords.length === 0
    ) {
      throw new BadRequestException('Для набора ключевых слов укажите хотя бы одно слово');
    }

    if (triggerType === QuickReplyTriggerType.MESSAGE_TIME_RANGE) {
      if (!this.isValidTimeValue(timeFrom) || !this.isValidTimeValue(timeTo)) {
        throw new BadRequestException('Для временного триггера укажите timeFrom/timeTo в формате HH:MM');
      }
    }

    if (
      triggerType === QuickReplyTriggerType.CLIENT_NO_REPLY_FOR &&
      (!Number.isFinite(noClientReplyMinutes) || noClientReplyMinutes <= 0)
    ) {
      throw new BadRequestException('Для триггера ожидания укажите период в минутах');
    }

    return {
      id: rule.id,
      title: this.normalizeOptionalText(rule.title) ?? 'Быстрый ответ',
      triggerType,
      triggerPhrase,
      triggerKeywords: triggerKeywords.length > 0 ? triggerKeywords : undefined,
      timeFrom,
      timeTo,
      noClientReplyMinutes:
        Number.isFinite(noClientReplyMinutes) && noClientReplyMinutes > 0
          ? Math.floor(noClientReplyMinutes)
          : undefined,
      stationIds: this.normalizeStationIds(rule.stationIds),
      mode:
        rule.mode === QuickReplyMode.AUTO_REPLY
          ? QuickReplyMode.AUTO_REPLY
          : QuickReplyMode.SUGGESTION,
      responseText: this.normalizeOptionalText(rule.responseText) ?? 'Спасибо!',
      responseAttachments:
        this.normalizeMessageAttachments(rule.responseAttachments).length > 0
          ? this.normalizeMessageAttachments(rule.responseAttachments)
          : undefined,
      isActive: rule.isActive !== false,
      usageCount: Math.max(0, Number(rule.usageCount || 0)),
      lastUsedAt: this.normalizeOptionalText(rule.lastUsedAt),
      createdAt: this.normalizeOptionalText(rule.createdAt) ?? new Date().toISOString(),
      updatedAt: this.normalizeOptionalText(rule.updatedAt) ?? new Date().toISOString()
    };
  }

  private matchesStation(rule: QuickReplyRule, stationId?: string): boolean {
    if (!Array.isArray(rule.stationIds) || rule.stationIds.length === 0) {
      return true;
    }
    const normalizedStationId =
      this.normalizeOptionalText(stationId) ?? QUICK_REPLY_UNASSIGNED_STATION_ID;
    return rule.stationIds.includes(normalizedStationId);
  }

  private matchesTrigger(rule: QuickReplyRule, context: QuickReplyMatchContext): boolean {
    if (rule.triggerType === QuickReplyTriggerType.EXACT_PHRASE) {
      return this.normalizeMessageText(context.messageText) ===
        this.normalizeMessageText(rule.triggerPhrase);
    }

    if (rule.triggerType === QuickReplyTriggerType.KEYWORD) {
      const messageText = this.normalizeMessageText(context.messageText);
      const keyword = this.normalizeMessageText(rule.triggerPhrase);
      return Boolean(keyword && messageText.includes(keyword));
    }

    if (rule.triggerType === QuickReplyTriggerType.KEYWORD_SET) {
      const messageText = this.normalizeMessageText(context.messageText);
      const keywords = Array.isArray(rule.triggerKeywords) ? rule.triggerKeywords : [];
      return keywords.length > 0 && keywords.every((keyword) =>
        messageText.includes(this.normalizeMessageText(keyword))
      );
    }

    if (rule.triggerType === QuickReplyTriggerType.MESSAGE_TIME_RANGE) {
      return this.matchesTimeRange(rule, context.messageCreatedAt);
    }

    if (rule.triggerType === QuickReplyTriggerType.CLIENT_NO_REPLY_FOR) {
      const waitMinutes = Number(context.noClientReplyMinutes);
      const requiredMinutes = Number(rule.noClientReplyMinutes);
      return (
        Number.isFinite(waitMinutes) &&
        Number.isFinite(requiredMinutes) &&
        waitMinutes >= requiredMinutes
      );
    }

    if (rule.triggerType === QuickReplyTriggerType.FIRST_CLIENT_MESSAGE) {
      return context.isFirstClientMessage === true;
    }

    if (rule.triggerType === QuickReplyTriggerType.HAS_ATTACHMENT) {
      return context.hasAttachment === true;
    }

    return false;
  }

  private matchesTimeRange(rule: QuickReplyRule, messageCreatedAt?: string): boolean {
    const messageDate = new Date(String(messageCreatedAt ?? ''));
    if (Number.isNaN(messageDate.getTime())) {
      return false;
    }

    const fromMinutes = this.parseTimeMinutes(rule.timeFrom);
    const toMinutes = this.parseTimeMinutes(rule.timeTo);
    if (fromMinutes < 0 || toMinutes < 0) {
      return false;
    }

    const currentMinutes = messageDate.getHours() * 60 + messageDate.getMinutes();
    if (fromMinutes <= toMinutes) {
      return currentMinutes >= fromMinutes && currentMinutes <= toMinutes;
    }
    return currentMinutes >= fromMinutes || currentMinutes <= toMinutes;
  }

  private resolveTriggerSpecificity(triggerType: QuickReplyTriggerType): number {
    if (triggerType === QuickReplyTriggerType.EXACT_PHRASE) {
      return 1;
    }
    if (triggerType === QuickReplyTriggerType.KEYWORD_SET) {
      return 2;
    }
    if (triggerType === QuickReplyTriggerType.KEYWORD) {
      return 3;
    }
    if (triggerType === QuickReplyTriggerType.CLIENT_NO_REPLY_FOR) {
      return 4;
    }
    if (triggerType === QuickReplyTriggerType.FIRST_CLIENT_MESSAGE) {
      return 5;
    }
    if (triggerType === QuickReplyTriggerType.MESSAGE_TIME_RANGE) {
      return 6;
    }
    return 7;
  }

  private normalizeStationIds(stationIds?: string[]): string[] {
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return [];
    }
    return Array.from(
      new Set(
        stationIds
          .map((stationId) =>
            this.normalizeOptionalText(stationId) === QUICK_REPLY_UNASSIGNED_STATION_ID
              ? QUICK_REPLY_UNASSIGNED_STATION_ID
              : this.normalizeOptionalText(stationId)
          )
          .filter((stationId): stationId is string => Boolean(stationId))
      )
    );
  }

  private normalizeMessageText(value?: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private normalizeOptionalText(value?: string): string | undefined {
    const text = String(value ?? '').trim();
    return text ? text : undefined;
  }

  private isValidTimeValue(value?: string): value is string {
    if (!/^\d{2}:\d{2}$/.test(String(value ?? '').trim())) {
      return false;
    }
    return this.parseTimeMinutes(value) >= 0;
  }

  private parseTimeMinutes(value?: string): number {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return -1;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return -1;
    }
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return -1;
    }
    return hours * 60 + minutes;
  }

  private normalizeMessageAttachments(rawAttachments?: unknown[]): MessageAttachment[] {
    if (!Array.isArray(rawAttachments)) {
      return [];
    }

    const attachments: MessageAttachment[] = [];
    for (const rawAttachment of rawAttachments) {
      const source =
        rawAttachment && typeof rawAttachment === 'object' && !Array.isArray(rawAttachment)
          ? (rawAttachment as Record<string, unknown>)
          : undefined;
      if (!source) {
        continue;
      }

      const type = this.normalizeOptionalText(String(source['type'] ?? '').toUpperCase());
      const url = this.normalizeOptionalText(String(source['url'] ?? ''));
      if (type !== MessageAttachmentType.IMAGE || !url || !this.isSupportedAttachmentUrl(url)) {
        continue;
      }

      const rawSize = Number(source['size']);
      attachments.push({
        id: this.normalizeOptionalText(String(source['id'] ?? '')) ?? randomUUID(),
        type: MessageAttachmentType.IMAGE,
        url,
        name: this.normalizeOptionalText(String(source['name'] ?? '')),
        mimeType: this.normalizeOptionalText(String(source['mimeType'] ?? '')),
        size: Number.isFinite(rawSize) && rawSize >= 0 ? Math.floor(rawSize) : undefined
      });

      if (attachments.length >= 10) {
        break;
      }
    }

    return attachments;
  }

  private isSupportedAttachmentUrl(url: string): boolean {
    const normalizedUrl = String(url || '').trim();
    return (
      /^https?:\/\/\S+$/i.test(normalizedUrl) ||
      /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(normalizedUrl)
    );
  }

  private cloneRule(rule: QuickReplyRule): QuickReplyRule {
    return {
      ...rule,
      stationIds: Array.isArray(rule.stationIds) ? rule.stationIds.slice() : [],
      triggerKeywords: Array.isArray(rule.triggerKeywords)
        ? rule.triggerKeywords.slice()
        : undefined,
      responseAttachments: Array.isArray(rule.responseAttachments)
        ? rule.responseAttachments.map((attachment) => ({ ...attachment }))
        : undefined
    };
  }

  private ensureSettingsReadAccess(user: RequestUser): void {
    if (user.roles.some((role) => STAFF_ROLES.includes(role))) {
      return;
    }
    throw new ForbiddenException('Only staff can access quick replies');
  }

  private ensureSettingsManageAccess(user: RequestUser): void {
    if (user.roles.includes(Role.SUPER_ADMIN) || user.roles.includes(Role.MANAGER)) {
      return;
    }
    throw new ForbiddenException('Only super admin or manager can modify quick replies');
  }

  private toTimestamp(value?: string): number {
    if (!value) {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
