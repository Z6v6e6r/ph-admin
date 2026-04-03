import {
  OnApplicationBootstrap,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MessageAttachment,
  MessageAttachmentType
} from '../common/messages/message-attachment.types';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { QuickRepliesService } from '../quick-replies/quick-replies.service';
import {
  QuickReplyMode,
  QuickReplySourceType,
  QuickReplyTriggerType
} from '../quick-replies/quick-replies.types';
import { AiConnectorService } from './ai/ai-connector.service';
import { MessengerPersistenceService } from './messenger-persistence.service';
import { CreateAccessRuleDto } from './dto/create-access-rule.dto';
import { CreateConnectorConfigDto } from './dto/create-connector-config.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateStationDto } from './dto/create-station.dto';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateAccessRuleDto } from './dto/update-access-rule.dto';
import { UpdateConnectorConfigDto } from './dto/update-connector-config.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import {
  AiAssistMode,
  AiReplySuggestion,
  AiSuggestionStatus,
  ChatMessage,
  ChatThread,
  ConnectorRoute,
  ConnectorSummary,
  DialogAiInsight,
  MessageOrigin,
  MessengerAccessRule,
  MessengerConnectorConfig,
  MessengerSettingsSnapshot,
  MessengerStationConfig,
  StaffResponseMetric,
  StationDialogSummary,
  StationSummary,
  ThreadAiConfig,
  ThreadStatus
} from './messenger.types';

interface ThreadFilters {
  connector?: ConnectorRoute;
  stationId?: string;
}

interface ThreadMessagesListOptions {
  limit?: number;
  before?: string;
  includeService?: boolean;
}

interface PendingStaffResponse {
  clientMessageId: string;
  startedAt: string;
}

type MessageObserver = (thread: ChatThread, message: ChatMessage) => void | Promise<void>;

@Injectable()
export class MessengerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly threads = new Map<string, ChatThread>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly pendingStaffResponses = new Map<string, PendingStaffResponse[]>();
  private readonly responseMetrics = new Map<string, StaffResponseMetric[]>();
  private readonly aiConfigs = new Map<string, ThreadAiConfig>();
  private readonly aiInsights = new Map<string, DialogAiInsight>();
  private readonly aiSuggestions = new Map<string, AiReplySuggestion[]>();
  private readonly stationConfigs = new Map<string, MessengerStationConfig>();
  private readonly connectorConfigs = new Map<string, MessengerConnectorConfig>();
  private readonly accessRules = new Map<string, MessengerAccessRule>();
  private readonly messageObservers: MessageObserver[] = [];
  private readonly noReplyQuickReplySignatures = new Set<string>();
  private noReplyQuickReplyTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly aiConnector: AiConnectorService,
    private readonly quickReplies: QuickRepliesService,
    private readonly persistence: MessengerPersistenceService
  ) {
    this.bootstrapSettingsDefaults();
  }

  async onModuleInit(): Promise<void> {
    await this.hydrateFromPersistence();
    this.ensureNoReplyQuickReplyTimer();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.hydrateFromPersistence();
    this.ensureNoReplyQuickReplyTimer();
  }

  onModuleDestroy(): void {
    if (!this.noReplyQuickReplyTimer) {
      return;
    }
    clearInterval(this.noReplyQuickReplyTimer);
    this.noReplyQuickReplyTimer = undefined;
  }

  registerMessageObserver(observer: MessageObserver): void {
    this.messageObservers.push(observer);
  }

  private async hydrateFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }

    const state = await this.persistence.loadState();

    if (state.stations.length > 0) {
      this.stationConfigs.clear();
      for (const station of state.stations) {
        this.stationConfigs.set(station.stationId, station);
      }
    }

    if (state.connectors.length > 0) {
      this.connectorConfigs.clear();
      for (const connector of state.connectors) {
        this.connectorConfigs.set(connector.id, this.normalizeLoadedConnectorConfig(connector));
      }
    } else {
      for (const connector of this.connectorConfigs.values()) {
        this.persistence.persistConnector(connector);
      }
    }

    if (state.accessRules.length > 0) {
      this.accessRules.clear();
      for (const rule of state.accessRules) {
        this.accessRules.set(rule.id, rule);
      }
    } else {
      for (const rule of this.accessRules.values()) {
        this.persistence.persistAccessRule(rule);
      }
    }

    if (state.threads.length > 0) {
      this.threads.clear();
      this.messages.clear();
      this.pendingStaffResponses.clear();
      this.responseMetrics.clear();
      this.aiConfigs.clear();
      this.aiInsights.clear();
      this.aiSuggestions.clear();

      for (const thread of state.threads) {
        const normalizedThread: ChatThread = {
          ...thread,
          isResolved: thread.isResolved === true,
          resolvedAt: thread.isResolved === true ? thread.resolvedAt : undefined,
          resolvedByUserId: thread.isResolved === true
            ? thread.resolvedByUserId
            : undefined
        };
        this.threads.set(normalizedThread.id, normalizedThread);
        this.messages.set(thread.id, []);
        this.pendingStaffResponses.set(thread.id, []);
        this.responseMetrics.set(thread.id, []);
        this.aiSuggestions.set(thread.id, []);
      }

      for (const message of state.messages) {
        const existing = this.messages.get(message.threadId) ?? [];
        existing.push(message);
        this.messages.set(message.threadId, existing);
      }

      for (const thread of state.threads) {
        this.pendingStaffResponses.set(
          thread.id,
          this.rebuildPendingResponsesForThread(thread.id)
        );
      }

      for (const [threadId, threadMessages] of this.messages.entries()) {
        threadMessages.sort(
          (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
        );
        this.messages.set(threadId, threadMessages);
      }

      for (const metricEntry of state.metrics) {
        this.responseMetrics.set(metricEntry.threadId, metricEntry.metrics ?? []);
      }

      for (const configEntry of state.aiConfigs) {
        this.aiConfigs.set(configEntry.threadId, configEntry.config);
      }

      for (const insightEntry of state.aiInsights) {
        this.aiInsights.set(insightEntry.threadId, insightEntry.insight);
      }

      for (const suggestion of state.aiSuggestions) {
        const existing = this.aiSuggestions.get(suggestion.threadId) ?? [];
        existing.push(suggestion);
        this.aiSuggestions.set(suggestion.threadId, existing);
      }

      for (const [threadId, threadSuggestions] of this.aiSuggestions.entries()) {
        threadSuggestions.sort(
          (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
        );
        this.aiSuggestions.set(threadId, threadSuggestions);
      }
    }
  }

  createThread(dto: CreateThreadDto, user: RequestUser): ChatThread {
    const clientId = this.resolveClientId(dto, user);
    const station = this.ensureStationConfig(dto.stationId, dto.stationName);
    this.ensureConnectorConfig(dto.connector);
    this.ensureThreadCreateAccess(dto.stationId, dto.connector, user);
    const initialAiMode = this.resolveInitialAiMode(dto.aiMode, user);

    const now = new Date().toISOString();
    const thread: ChatThread = {
      id: randomUUID(),
      connector: dto.connector,
      stationId: dto.stationId,
      stationName: station.stationName,
      clientId,
      subject: dto.subject,
      assignedSupportId: dto.assignedSupportId,
      status: ThreadStatus.OPEN,
      isResolved: false,
      createdAt: now,
      updatedAt: now
    };

    this.threads.set(thread.id, thread);
    this.messages.set(thread.id, []);
    this.pendingStaffResponses.set(thread.id, []);
    this.responseMetrics.set(thread.id, []);
    this.aiSuggestions.set(thread.id, []);
    this.aiConfigs.set(thread.id, {
      mode: initialAiMode,
      updatedAt: now,
      updatedBy: user.id
    });
    const initialInsight = this.aiConnector.analyzeDialog(thread.id, []);
    this.aiInsights.set(thread.id, initialInsight);
    this.persistence.persistThread(thread);
    this.persistence.persistAiConfig(thread.id, {
      mode: initialAiMode,
      updatedAt: now,
      updatedBy: user.id
    });
    this.persistence.persistAiInsight(thread.id, initialInsight);

    return thread;
  }

  listThreads(user: RequestUser, filters: ThreadFilters = {}): ChatThread[] {
    return this.getFilteredAccessibleThreads(user, filters);
  }

  getThreadById(threadId: string, user: RequestUser): ChatThread {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    return thread;
  }

  listMessages(
    threadId: string,
    user: RequestUser,
    options: ThreadMessagesListOptions = {}
  ): ChatMessage[] {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.markThreadRead(thread, user);

    const includeService = options.includeService === true;
    const beforeTs = this.toTimestamp(options.before);
    const limit = this.resolveMessagesLimit(options.limit);
    const source = this.messages.get(threadId) ?? [];
    const filtered = source
      .filter((message) =>
        includeService
          ? true
          : !this.isSystemThreadMessage(message) ||
            this.isQuickReplyAutoResponseThreadMessage(message)
      )
      .filter((message) => (beforeTs > 0 ? this.toTimestamp(message.createdAt) < beforeTs : true));

    return filtered.length <= limit ? filtered : filtered.slice(filtered.length - limit);
  }

  sendMessage(
    threadId: string,
    dto: CreateMessageDto,
    user: RequestUser
  ): ChatMessage {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    if (
      this.isStaff(user) &&
      !this.hasStaffAccess(user, thread.stationId, thread.connector, 'write')
    ) {
      throw new ForbiddenException('Staff cannot send message in this connector/station');
    }

    if (thread.status === ThreadStatus.CLOSED) {
      throw new ForbiddenException('Thread is closed');
    }

    const senderRole = this.resolveSenderRole(user.roles);
    const createdAt = new Date().toISOString();
    const text = String(dto.text ?? '').trim();
    const attachments = this.normalizeMessageAttachments(dto.attachments);
    const lastClientMessage = this.isStaffRole(senderRole)
      ? this.getLatestClientMessage(threadId)
      : null;
    this.ensureMessageHasBody(text, attachments);
    const message: ChatMessage = {
      id: randomUUID(),
      threadId,
      senderId: user.id,
      senderRole,
      senderName: this.buildStaffSenderName(user, senderRole),
      origin: MessageOrigin.HUMAN,
      text: text || '',
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt
    };

    this.appendMessage(thread, message);

    if (this.isStaffRole(senderRole)) {
      thread.lastStaffReadAt = createdAt;
      this.registerStaffResponseMetrics(thread, message, user.id);
    } else {
      thread.lastClientReadAt = createdAt;
      thread.isResolved = false;
      thread.resolvedAt = undefined;
      thread.resolvedByUserId = undefined;
      this.registerPendingClientResponse(thread, message);
    }

    this.analyzeDialog(thread.id);

    if (!this.isStaffRole(senderRole)) {
      this.handleAiAssistantOnClientMessage(thread, message);
      this.handleQuickReplyAutoRules(thread, message);
    } else if (dto.quickReplyRuleId) {
      this.quickReplies.registerUsage(
        dto.quickReplyRuleId,
        this.buildQuickReplyMatchContext(thread, lastClientMessage, message.createdAt),
        user.id
      );
    }

    this.threads.set(thread.id, thread);
    return message;
  }

  closeThread(threadId: string, user: RequestUser): ChatThread {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);

    if (!this.isStaff(user)) {
      throw new ForbiddenException('Only staff can close a thread');
    }
    if (!this.hasStaffAccess(user, thread.stationId, thread.connector, 'write')) {
      throw new ForbiddenException('Staff cannot close thread in this connector/station');
    }

    const updated: ChatThread = {
      ...thread,
      status: ThreadStatus.CLOSED,
      updatedAt: new Date().toISOString()
    };

    this.threads.set(threadId, updated);
    this.persistence.persistThread(updated);
    return updated;
  }

  setThreadResolution(
    threadId: string,
    resolved: boolean,
    user: RequestUser
  ): StationDialogSummary {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    if (!this.hasStaffAccess(user, thread.stationId, thread.connector, 'write')) {
      throw new ForbiddenException('Staff cannot update thread resolution');
    }

    const now = new Date().toISOString();
    thread.isResolved = resolved;
    thread.resolvedAt = resolved ? now : undefined;
    thread.resolvedByUserId = resolved ? user.id : undefined;
    thread.updatedAt = now;
    if (resolved) {
      this.pendingStaffResponses.set(thread.id, []);
    }

    this.threads.set(thread.id, thread);
    this.persistence.persistThread(thread);
    return this.buildDialogSummary(thread, user);
  }

  listConnectors(user: RequestUser): ConnectorSummary[] {
    const visibleThreads = this.getFilteredAccessibleThreads(user);
    const byConnector = new Map<ConnectorRoute, ChatThread[]>();

    for (const thread of visibleThreads) {
      const existing = byConnector.get(thread.connector) ?? [];
      existing.push(thread);
      byConnector.set(thread.connector, existing);
    }

    for (const connector of this.listConfiguredRoutesForUser(user)) {
      if (!byConnector.has(connector)) {
        byConnector.set(connector, []);
      }
    }

    return Array.from(byConnector.entries())
      .map(([connector, threads]) => {
        const stationIds = new Set(
          this.listAccessibleConfiguredStationIds(connector, user)
        );
        for (const thread of threads) {
          stationIds.add(thread.stationId);
        }
        const unreadMessagesCount = threads.reduce(
          (sum, thread) => sum + this.countUnreadMessagesForUser(thread, user),
          0
        );

        return {
          connector,
          stationsCount: stationIds.size,
          dialogsCount: threads.length,
          unreadMessagesCount
        };
      })
      .sort((left, right) => left.connector.localeCompare(right.connector));
  }

  listStationsByConnector(
    connector: ConnectorRoute,
    user: RequestUser
  ): StationSummary[] {
    const visibleThreads = this.getFilteredAccessibleThreads(user, { connector });
    const byStation = new Map<string, ChatThread[]>();

    for (const thread of visibleThreads) {
      const existing = byStation.get(thread.stationId) ?? [];
      existing.push(thread);
      byStation.set(thread.stationId, existing);
    }

    for (const stationId of this.listAccessibleConfiguredStationIds(connector, user)) {
      if (!byStation.has(stationId)) {
        byStation.set(stationId, []);
      }
    }

    return Array.from(byStation.entries())
      .map(([stationId, threads]) => {
        const unreadByThread = threads.map((thread) =>
          this.countUnreadMessagesForUser(thread, user)
        );
        const unreadMessagesCount = unreadByThread.reduce((sum, value) => sum + value, 0);
        const unreadDialogsCount = unreadByThread.filter((value) => value > 0).length;
        const stationName =
          threads.find((thread) => thread.stationName)?.stationName ??
          this.stationConfigs.get(stationId)?.stationName;
        const lastMessageAt = this.maxDate(
          threads.map((thread) => thread.lastMessageAt ?? thread.updatedAt)
        );

        return {
          connector,
          stationId,
          stationName,
          dialogsCount: threads.length,
          unreadDialogsCount,
          unreadMessagesCount,
          lastMessageAt
        };
      })
      .sort((left, right) => left.stationId.localeCompare(right.stationId));
  }

  listDialogsByStation(
    connector: ConnectorRoute,
    stationId: string,
    user: RequestUser
  ): StationDialogSummary[] {
    return this.listDialogs(user, { connector, stationId });
  }

  listDialogs(user: RequestUser, filters: ThreadFilters = {}): StationDialogSummary[] {
    return this.getFilteredAccessibleThreads(user, filters).map((thread) =>
      this.buildDialogSummary(thread, user)
    );
  }

  getSettings(user: RequestUser): MessengerSettingsSnapshot {
    this.ensureSettingsReadAccess(user);
    return {
      stations: this.listStationConfigs(user),
      connectors: this.listConnectorConfigs(user),
      accessRules: this.listAccessRules(user),
      quickReplies: this.quickReplies.listRules(user)
    };
  }

  listStationConfigs(user: RequestUser): MessengerStationConfig[] {
    this.ensureSettingsReadAccess(user);
    return Array.from(this.stationConfigs.values()).sort((left, right) =>
      left.stationId.localeCompare(right.stationId)
    );
  }

  createStationConfig(
    dto: CreateStationDto,
    user: RequestUser
  ): MessengerStationConfig {
    this.ensureSettingsManageAccess(user);
    const stationId = dto.stationId.trim();
    if (this.stationConfigs.has(stationId)) {
      throw new BadRequestException(`Station with id ${stationId} already exists`);
    }

    const now = new Date().toISOString();
    const station: MessengerStationConfig = {
      stationId,
      stationName: dto.stationName?.trim() || stationId,
      isActive: dto.isActive ?? true,
      createdAt: now,
      updatedAt: now
    };
    this.stationConfigs.set(stationId, station);
    this.persistence.persistStation(station);
    return station;
  }

  updateStationConfig(
    stationId: string,
    dto: UpdateStationDto,
    user: RequestUser
  ): MessengerStationConfig {
    this.ensureSettingsManageAccess(user);
    const existing = this.stationConfigs.get(stationId);
    if (!existing) {
      throw new NotFoundException(`Station with id ${stationId} not found`);
    }

    const updated: MessengerStationConfig = {
      ...existing,
      stationName: dto.stationName?.trim() || existing.stationName,
      isActive: dto.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString()
    };

    this.stationConfigs.set(stationId, updated);
    this.persistence.persistStation(updated);
    return updated;
  }

  listConnectorConfigs(user: RequestUser): MessengerConnectorConfig[] {
    this.ensureSettingsReadAccess(user);
    return Array.from(this.connectorConfigs.values())
      .filter((config) => this.isConnectorAllowedForUser(user, config.route))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  createConnectorConfig(
    dto: CreateConnectorConfigDto,
    user: RequestUser
  ): MessengerConnectorConfig {
    this.ensureSettingsManageAccess(user);
    this.ensureUserCanManageConnectorRoute(dto.route, user);
    this.ensureConnectorConfig(dto.route);
    const stationIds = this.normalizeStationIds(dto.stationIds);
    this.ensureConfiguredStationsExist(stationIds);

    const now = new Date().toISOString();
    const connector: MessengerConnectorConfig = {
      id: randomUUID(),
      name: dto.name.trim(),
      route: dto.route,
      stationIds,
      config: this.normalizeConnectorRuntimeConfig(dto.route, dto.config),
      isActive: dto.isActive ?? true,
      createdAt: now,
      updatedAt: now
    };

    this.connectorConfigs.set(connector.id, connector);
    this.persistence.persistConnector(connector);
    return connector;
  }

  updateConnectorConfig(
    connectorId: string,
    dto: UpdateConnectorConfigDto,
    user: RequestUser
  ): MessengerConnectorConfig {
    this.ensureSettingsManageAccess(user);
    const existing = this.connectorConfigs.get(connectorId);
    if (!existing) {
      throw new NotFoundException(`Connector config with id ${connectorId} not found`);
    }
    this.ensureUserCanManageConnectorRoute(existing.route, user);

    const stationIds =
      dto.stationIds === undefined
        ? existing.stationIds
        : this.normalizeStationIds(dto.stationIds);
    this.ensureConfiguredStationsExist(stationIds);

    const updated: MessengerConnectorConfig = {
      ...existing,
      name: dto.name?.trim() || existing.name,
      stationIds,
      config:
        dto.config === undefined
          ? this.normalizeConnectorRuntimeConfig(existing.route, existing.config)
          : this.normalizeConnectorRuntimeConfig(existing.route, dto.config),
      isActive: dto.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString()
    };

    this.connectorConfigs.set(connectorId, updated);
    this.persistence.persistConnector(updated);
    return updated;
  }

  listAccessRules(user: RequestUser): MessengerAccessRule[] {
    this.ensureSettingsReadAccess(user);
    return Array.from(this.accessRules.values()).sort((left, right) => {
      if (left.role === right.role) {
        return left.id.localeCompare(right.id);
      }
      return left.role.localeCompare(right.role);
    }).filter((rule) => this.canViewAccessRule(user, rule));
  }

  createAccessRule(dto: CreateAccessRuleDto, user: RequestUser): MessengerAccessRule {
    this.ensureSettingsManageAccess(user);
    const stationIds = this.normalizeStationIds(dto.stationIds);
    this.ensureConfiguredStationsExist(stationIds);
    const connectorRoutes = this.normalizeConnectorRoutes(dto.connectorRoutes);
    this.ensureUserCanManageAccessRuleRoutes(connectorRoutes, user);
    const canRead = dto.canRead ?? true;
    const canWrite = dto.canWrite ?? false;
    this.ensureNonEmptyRule(canRead, canWrite);

    const now = new Date().toISOString();
    const rule: MessengerAccessRule = {
      id: randomUUID(),
      role: dto.role,
      stationIds,
      connectorRoutes,
      canRead,
      canWrite,
      createdAt: now,
      updatedAt: now
    };

    this.accessRules.set(rule.id, rule);
    this.persistence.persistAccessRule(rule);
    return rule;
  }

  updateAccessRule(
    ruleId: string,
    dto: UpdateAccessRuleDto,
    user: RequestUser
  ): MessengerAccessRule {
    this.ensureSettingsManageAccess(user);
    const existing = this.accessRules.get(ruleId);
    if (!existing) {
      throw new NotFoundException(`Access rule with id ${ruleId} not found`);
    }

    const stationIds =
      dto.stationIds === undefined
        ? existing.stationIds
        : this.normalizeStationIds(dto.stationIds);
    this.ensureConfiguredStationsExist(stationIds);
    const connectorRoutes =
      dto.connectorRoutes === undefined
        ? existing.connectorRoutes
        : this.normalizeConnectorRoutes(dto.connectorRoutes);
    this.ensureUserCanManageAccessRuleRoutes(connectorRoutes, user);
    const canRead = dto.canRead ?? existing.canRead;
    const canWrite = dto.canWrite ?? existing.canWrite;
    this.ensureNonEmptyRule(canRead, canWrite);

    const updated: MessengerAccessRule = {
      ...existing,
      role: dto.role ?? existing.role,
      stationIds,
      connectorRoutes,
      canRead,
      canWrite,
      updatedAt: new Date().toISOString()
    };

    this.accessRules.set(ruleId, updated);
    this.persistence.persistAccessRule(updated);
    return updated;
  }

  listResponseMetrics(threadId: string, user: RequestUser): StaffResponseMetric[] {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    return this.responseMetrics.get(threadId) ?? [];
  }

  getAiInsight(threadId: string, user: RequestUser): DialogAiInsight {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    return this.aiInsights.get(threadId) ?? this.analyzeDialog(threadId);
  }

  analyzeAiInsight(threadId: string, user: RequestUser): DialogAiInsight {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    return this.analyzeDialog(threadId);
  }

  listAiSuggestions(threadId: string, user: RequestUser): AiReplySuggestion[] {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    return this.aiSuggestions.get(threadId) ?? [];
  }

  generateAiSuggestion(threadId: string, user: RequestUser): AiReplySuggestion {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    const clientMessage = this.getLatestClientMessage(threadId);
    if (!clientMessage) {
      throw new BadRequestException('No client message found for suggestion');
    }

    const insight = this.analyzeDialog(threadId);
    const suggestion = this.buildSuggestion(thread, clientMessage, insight);
    this.storeSuggestion(threadId, suggestion);

    return suggestion;
  }

  setAiMode(
    threadId: string,
    mode: AiAssistMode,
    user: RequestUser
  ): ThreadAiConfig {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    const config: ThreadAiConfig = {
      mode,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id
    };

    this.aiConfigs.set(threadId, config);
    this.persistence.persistAiConfig(threadId, config);
    return config;
  }

  getAiMode(threadId: string, user: RequestUser): ThreadAiConfig {
    const thread = this.getThreadOrThrow(threadId);
    this.ensureThreadAccess(thread, user);
    this.ensureStaffAccess(user);

    return this.getThreadAiConfig(threadId);
  }

  private getThreadOrThrow(threadId: string): ChatThread {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new NotFoundException(`Thread with id ${threadId} not found`);
    }
    return thread;
  }

  private ensureThreadAccess(thread: ChatThread, user: RequestUser): void {
    if (this.canAccessThread(thread, user)) {
      return;
    }

    throw new ForbiddenException('Access to thread denied');
  }

  private ensureStaffAccess(user: RequestUser): void {
    if (!this.isStaff(user)) {
      throw new ForbiddenException('Only staff can access this resource');
    }
  }

  private isStaff(user: RequestUser): boolean {
    return user.roles.some((role) => STAFF_ROLES.includes(role));
  }

  private isSuperAdmin(user: RequestUser): boolean {
    return user.roles.includes(Role.SUPER_ADMIN);
  }

  private isStaffRole(role: Role): boolean {
    return STAFF_ROLES.includes(role);
  }

  private resolveSenderRole(roles: Role[]): Role {
    if (roles.length === 0) {
      throw new ForbiddenException('User must have at least one role');
    }

    const priority: Role[] = [
      Role.SUPER_ADMIN,
      Role.SUPPORT,
      Role.STATION_ADMIN,
      Role.MANAGER,
      Role.TOURNAMENT_MANAGER,
      Role.GAME_MANAGER,
      Role.CLIENT
    ];

    for (const role of priority) {
      if (roles.includes(role)) {
        return role;
      }
    }

    return roles[0];
  }

  private buildStaffSenderName(user: RequestUser, role: Role): string {
    const title = String(user?.title ?? '').trim();
    if (title) {
      return title;
    }
    const login = String(user?.login ?? '').trim();
    return login || this.formatRoleLabel(role);
  }

  private formatRoleLabel(role: Role): string {
    switch (role) {
      case Role.SUPER_ADMIN:
        return 'Суперадмин';
      case Role.SUPPORT:
        return 'Сотрудник поддержки';
      case Role.STATION_ADMIN:
        return 'Администратор станции';
      case Role.MANAGER:
        return 'Управляющий';
      case Role.TOURNAMENT_MANAGER:
        return 'Менеджер турниров';
      case Role.GAME_MANAGER:
        return 'Менеджер игр';
      default:
        return 'Сотрудник';
    }
  }

  private resolveClientId(dto: CreateThreadDto, user: RequestUser): string {
    if (user.roles.includes(Role.CLIENT)) {
      if (dto.clientId && dto.clientId !== user.id) {
        throw new ForbiddenException('Client cannot create a thread for another client');
      }
      return dto.clientId ?? user.id;
    }

    if (!dto.clientId) {
      throw new BadRequestException('clientId is required for non-client creators');
    }

    return dto.clientId;
  }

  private resolveInitialAiMode(
    requestedMode: AiAssistMode | undefined,
    user: RequestUser
  ): AiAssistMode {
    if (!requestedMode) {
      return AiAssistMode.SUGGEST;
    }

    if (user.roles.includes(Role.CLIENT)) {
      return AiAssistMode.SUGGEST;
    }

    return requestedMode;
  }

  private ensureThreadCreateAccess(
    stationId: string,
    connector: ConnectorRoute,
    user: RequestUser
  ): void {
    if (!this.isStationActive(stationId)) {
      throw new ForbiddenException(`Station ${stationId} is inactive`);
    }
    if (!this.isConnectorEnabledForStation(connector, stationId)) {
      throw new ForbiddenException(
        `Connector ${connector} is disabled for station ${stationId}`
      );
    }

    if (user.roles.includes(Role.CLIENT)) {
      return;
    }

    if (!this.isStaff(user)) {
      throw new ForbiddenException('Only staff or client can create thread');
    }

    if (!this.isConnectorAllowedForUser(user, connector)) {
      throw new ForbiddenException('Staff cannot create thread outside assigned connectors');
    }

    if (this.isSuperAdmin(user)) {
      return;
    }

    if (user.stationIds.length === 0) {
      if (!this.hasStaffAccess(user, stationId, connector, 'write')) {
        throw new ForbiddenException(
          'Staff cannot create thread in this connector/station by access rules'
        );
      }
      return;
    }

    if (!user.stationIds.includes(stationId)) {
      throw new ForbiddenException('Staff cannot create thread outside assigned stations');
    }

    if (!this.hasStaffAccess(user, stationId, connector, 'write')) {
      throw new ForbiddenException(
        'Staff cannot create thread in this connector/station by access rules'
      );
    }
  }

  private getFilteredAccessibleThreads(
    user: RequestUser,
    filters: ThreadFilters = {}
  ): ChatThread[] {
    const filtered = Array.from(this.threads.values())
      .filter((thread) =>
        filters.connector ? thread.connector === filters.connector : true
      )
      .filter((thread) => (filters.stationId ? thread.stationId === filters.stationId : true))
      .filter((thread) => this.canAccessThread(thread, user));

    const unreadByThreadId = new Map<string, number>();
    const pendingByThreadId = new Map<string, number>();

    for (const thread of filtered) {
      unreadByThreadId.set(thread.id, this.countUnreadMessagesForUser(thread, user));
      pendingByThreadId.set(thread.id, this.countPendingClientMessages(thread.id));
    }

    return filtered.sort((left, right) => {
      const leftUnread = unreadByThreadId.get(left.id) ?? 0;
      const rightUnread = unreadByThreadId.get(right.id) ?? 0;
      if (leftUnread !== rightUnread) {
        return rightUnread - leftUnread;
      }

      const leftPending = pendingByThreadId.get(left.id) ?? 0;
      const rightPending = pendingByThreadId.get(right.id) ?? 0;
      if (leftPending !== rightPending) {
        return rightPending - leftPending;
      }

      const byRanking =
        this.toTimestamp(right.lastRankingMessageAt ?? right.lastMessageAt ?? right.updatedAt) -
        this.toTimestamp(left.lastRankingMessageAt ?? left.lastMessageAt ?? left.updatedAt);
      if (byRanking !== 0) {
        return byRanking;
      }

      const byLastMessage =
        this.toTimestamp(right.lastMessageAt ?? right.updatedAt) -
        this.toTimestamp(left.lastMessageAt ?? left.updatedAt);
      if (byLastMessage !== 0) {
        return byLastMessage;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private buildDialogSummary(
    thread: ChatThread,
    user: RequestUser
  ): StationDialogSummary {
    const responseStats = this.getThreadResponseStats(thread.id);
    const insight = this.aiInsights.get(thread.id);
    const lastMessage = this.getLatestDialogPreviewMessage(thread.id);

    return {
      threadId: thread.id,
      connector: thread.connector,
      stationId: thread.stationId,
      stationName: thread.stationName,
      clientId: thread.clientId,
      subject: thread.subject,
      status: thread.status,
      isResolved: thread.isResolved === true,
      resolvedAt: thread.isResolved === true ? thread.resolvedAt : undefined,
      resolvedByUserId: thread.isResolved === true ? thread.resolvedByUserId : undefined,
      lastMessageAt: thread.lastMessageAt,
      lastRankingMessageAt: thread.lastRankingMessageAt,
      unreadMessagesCount: this.countUnreadMessagesForUser(thread, user),
      pendingClientMessagesCount: this.countPendingClientMessages(thread.id),
      lastMessageText: this.formatMessagePreview(lastMessage),
      lastMessageSenderRole: lastMessage?.senderRole,
      averageStaffResponseTimeMs: responseStats.averageResponseTimeMs,
      lastStaffResponseTimeMs: responseStats.lastResponseTimeMs,
      aiTopic: insight?.topic,
      aiUrgency: insight?.urgency,
      aiQualityScore: insight?.qualityScore
    };
  }

  private canAccessThread(thread: ChatThread, user: RequestUser): boolean {
    if (user.roles.includes(Role.CLIENT)) {
      return thread.clientId === user.id && this.isConnectorAllowedForUser(user, thread.connector);
    }

    if (!this.isStaff(user)) {
      return false;
    }

    if (!this.isConnectorAllowedForUser(user, thread.connector)) {
      return false;
    }

    if (this.isSuperAdmin(user)) {
      return true;
    }

    if (user.stationIds.length > 0) {
      if (!user.stationIds.includes(thread.stationId)) {
        return false;
      }
    }

    if (!this.isStationActive(thread.stationId)) {
      return false;
    }

    if (!this.isConnectorEnabledForStation(thread.connector, thread.stationId)) {
      return false;
    }

    return this.hasStaffAccess(user, thread.stationId, thread.connector, 'read');
  }

  private ensureSettingsReadAccess(user: RequestUser): void {
    if (!this.isStaff(user)) {
      throw new ForbiddenException('Only staff can access messenger settings');
    }
  }

  private ensureSettingsManageAccess(user: RequestUser): void {
    if (this.isSuperAdmin(user) || user.roles.includes(Role.MANAGER)) {
      return;
    }
    throw new ForbiddenException('Only super admin or manager can modify settings');
  }

  private ensureStationConfig(
    stationIdRaw: string,
    stationNameRaw?: string
  ): MessengerStationConfig {
    const stationId = stationIdRaw.trim();
    const normalizedIncomingStationName = this.normalizeIncomingStationName(
      stationNameRaw,
      stationId
    );
    const existing = this.stationConfigs.get(stationId);
    if (existing) {
      if (
        normalizedIncomingStationName &&
        this.shouldRefreshStationNameFromInbound(existing, normalizedIncomingStationName)
      ) {
        const updated: MessengerStationConfig = {
          ...existing,
          stationName: normalizedIncomingStationName,
          updatedAt: new Date().toISOString()
        };
        this.stationConfigs.set(stationId, updated);
        this.persistence.persistStation(updated);
        return updated;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const created: MessengerStationConfig = {
      stationId,
      stationName: normalizedIncomingStationName ?? stationId,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    this.stationConfigs.set(stationId, created);
    this.persistence.persistStation(created);
    return created;
  }

  private normalizeIncomingStationName(
    stationNameRaw: string | undefined,
    stationId: string
  ): string | undefined {
    const stationName = String(stationNameRaw ?? '').trim();
    if (!stationName) {
      return undefined;
    }
    if (stationName.toLowerCase() === stationId.toLowerCase()) {
      return undefined;
    }
    if (this.isUuidLike(stationName)) {
      return undefined;
    }
    return stationName;
  }

  private shouldRefreshStationNameFromInbound(
    existing: MessengerStationConfig,
    incomingStationName: string
  ): boolean {
    const existingStationName = String(existing.stationName ?? '').trim();
    if (!existingStationName) {
      return true;
    }
    if (existingStationName === incomingStationName) {
      return false;
    }

    const normalizedExistingStationName = existingStationName.toLowerCase();
    const normalizedStationId = String(existing.stationId ?? '')
      .trim()
      .toLowerCase();

    return (
      normalizedExistingStationName === normalizedStationId ||
      this.isUuidLike(existingStationName)
    );
  }

  private isUuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value).trim()
    );
  }

  private ensureConnectorConfig(route: ConnectorRoute): void {
    const hasRouteConfig = Array.from(this.connectorConfigs.values()).some(
      (config) => config.route === route
    );
    if (hasRouteConfig) {
      return;
    }

    const now = new Date().toISOString();
    const id = this.defaultConnectorId(route);
    this.connectorConfigs.set(id, {
      id,
      name: route,
      route,
      stationIds: [],
      config: this.normalizeConnectorRuntimeConfig(route),
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    this.persistence.persistConnector(this.connectorConfigs.get(id)!);
  }

  private defaultConnectorId(route: ConnectorRoute): string {
    return `default-${route.toLowerCase()}`;
  }

  private hasStaffAccess(
    user: RequestUser,
    stationId: string,
    connector: ConnectorRoute,
    operation: 'read' | 'write'
  ): boolean {
    if (!this.isStaff(user)) {
      return false;
    }
    if (!this.isConnectorAllowedForUser(user, connector)) {
      return false;
    }
    if (this.isSuperAdmin(user)) {
      return true;
    }

    const roles = user.roles.filter((role) => STAFF_ROLES.includes(role));
    if (roles.length === 0) {
      return false;
    }

    for (const role of roles) {
      const matchingRules = Array.from(this.accessRules.values()).filter(
        (rule) =>
          rule.role === role &&
          (rule.stationIds.length === 0 || rule.stationIds.includes(stationId)) &&
          (rule.connectorRoutes.length === 0 || rule.connectorRoutes.includes(connector))
      );

      if (operation === 'read') {
        if (matchingRules.some((rule) => rule.canRead || rule.canWrite)) {
          return true;
        }
        continue;
      }

      if (matchingRules.some((rule) => rule.canWrite)) {
        return true;
      }
    }

    return false;
  }

  private isStationActive(stationId: string): boolean {
    const station = this.stationConfigs.get(stationId);
    if (!station) {
      return true;
    }
    return station.isActive;
  }

  private isConnectorEnabledForStation(
    connector: ConnectorRoute,
    stationId: string
  ): boolean {
    const routeConfigs = Array.from(this.connectorConfigs.values()).filter(
      (config) => config.route === connector
    );
    if (routeConfigs.length === 0) {
      return true;
    }

    const activeRouteConfigs = routeConfigs.filter((config) => config.isActive);
    if (activeRouteConfigs.length === 0) {
      return false;
    }

    for (const config of activeRouteConfigs) {
      if (config.stationIds.length === 0 || config.stationIds.includes(stationId)) {
        return true;
      }
    }

    return false;
  }

  private listConfiguredRoutesForUser(user: RequestUser): ConnectorRoute[] {
    if (!this.isStaff(user)) {
      return [];
    }

    const routes = new Set<ConnectorRoute>();
    const configuredRoutes = Array.from(this.connectorConfigs.values())
      .filter((config) => config.isActive)
      .map((config) => config.route);

    for (const route of configuredRoutes) {
      if (!this.isConnectorAllowedForUser(user, route)) {
        continue;
      }

      if (this.isSuperAdmin(user)) {
        routes.add(route);
        continue;
      }

      if (this.listAccessibleConfiguredStationIds(route, user).length > 0) {
        routes.add(route);
      }
    }

    return Array.from(routes.values()).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  private listAccessibleConfiguredStationIds(
    route: ConnectorRoute,
    user: RequestUser
  ): string[] {
    if (!this.isStaff(user)) {
      return [];
    }
    if (!this.isConnectorAllowedForUser(user, route)) {
      return [];
    }

    const routeConfigs = Array.from(this.connectorConfigs.values()).filter(
      (config) => config.route === route && config.isActive
    );
    if (routeConfigs.length === 0) {
      return [];
    }

    const allActiveStations = Array.from(this.stationConfigs.values())
      .filter((station) => station.isActive)
      .map((station) => station.stationId);

    const stationIds = new Set<string>();
    for (const config of routeConfigs) {
      if (config.stationIds.length === 0) {
        for (const stationId of allActiveStations) {
          stationIds.add(stationId);
        }
        continue;
      }

      for (const stationId of config.stationIds) {
        if (this.isStationActive(stationId)) {
          stationIds.add(stationId);
        }
      }
    }

    const filtered = Array.from(stationIds.values()).filter((stationId) => {
      if (user.stationIds.length > 0 && !user.stationIds.includes(stationId)) {
        return false;
      }
      return this.hasStaffAccess(user, stationId, route, 'read');
    });

    return filtered.sort((left, right) => left.localeCompare(right));
  }

  private normalizeStationIds(stationIds?: string[]): string[] {
    if (!stationIds || stationIds.length === 0) {
      return [];
    }
    return Array.from(
      new Set(
        stationIds
          .map((stationId) => stationId.trim())
          .filter((stationId) => stationId.length > 0)
      )
    );
  }

  private normalizeConnectorRoutes(routes?: ConnectorRoute[]): ConnectorRoute[] {
    if (!routes || routes.length === 0) {
      return [];
    }
    return Array.from(new Set(routes));
  }

  private ensureConfiguredStationsExist(stationIds: string[]): void {
    for (const stationId of stationIds) {
      if (!this.stationConfigs.has(stationId)) {
        throw new BadRequestException(
          `Station ${stationId} is not configured. Add station first.`
        );
      }
    }
  }

  private getUserConnectorRoutes(user?: RequestUser): string[] {
    if (!user || !Array.isArray(user.connectorRoutes) || user.connectorRoutes.length === 0) {
      return [];
    }

    return Array.from(
      new Set(
        user.connectorRoutes
          .map((route) => String(route ?? '').trim().toUpperCase())
          .filter((route) => route.length > 0)
      )
    );
  }

  private isConnectorAllowedForUser(
    user: RequestUser,
    connector: ConnectorRoute | string
  ): boolean {
    const allowedRoutes = this.getUserConnectorRoutes(user);
    if (allowedRoutes.length === 0) {
      return true;
    }

    return allowedRoutes.includes(String(connector).trim().toUpperCase());
  }

  private ensureUserCanManageConnectorRoute(
    route: ConnectorRoute,
    user: RequestUser
  ): void {
    if (this.isConnectorAllowedForUser(user, route)) {
      return;
    }

    throw new ForbiddenException('Connector settings access denied for this route');
  }

  private ensureUserCanManageAccessRuleRoutes(
    connectorRoutes: ConnectorRoute[],
    user: RequestUser
  ): void {
    const allowedRoutes = this.getUserConnectorRoutes(user);
    if (allowedRoutes.length === 0) {
      return;
    }

    if (connectorRoutes.length === 0) {
      throw new ForbiddenException(
        'Restricted user cannot manage access rules for all connectors'
      );
    }

    if (connectorRoutes.every((route) => this.isConnectorAllowedForUser(user, route))) {
      return;
    }

    throw new ForbiddenException('Access rule contains connectors outside assigned scope');
  }

  private canViewAccessRule(user: RequestUser, rule: MessengerAccessRule): boolean {
    const allowedRoutes = this.getUserConnectorRoutes(user);
    if (allowedRoutes.length === 0) {
      return true;
    }

    if (rule.connectorRoutes.length === 0) {
      return true;
    }

    return rule.connectorRoutes.some((route) => this.isConnectorAllowedForUser(user, route));
  }

  private ensureNonEmptyRule(canRead: boolean, canWrite: boolean): void {
    if (canRead || canWrite) {
      return;
    }
    throw new BadRequestException(
      'At least one permission must be enabled: canRead or canWrite'
    );
  }

  private bootstrapSettingsDefaults(): void {
    const now = new Date().toISOString();
    for (const route of Object.values(ConnectorRoute)) {
      const id = this.defaultConnectorId(route);
      this.connectorConfigs.set(id, {
        id,
        name: route,
        route,
        stationIds: [],
        config: this.normalizeConnectorRuntimeConfig(route),
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
    }

    const defaults: Array<{
      role: Role;
      canRead: boolean;
      canWrite: boolean;
    }> = [
      { role: Role.SUPER_ADMIN, canRead: true, canWrite: true },
      { role: Role.MANAGER, canRead: true, canWrite: true },
      { role: Role.STATION_ADMIN, canRead: true, canWrite: true },
      { role: Role.SUPPORT, canRead: true, canWrite: true },
      { role: Role.TOURNAMENT_MANAGER, canRead: true, canWrite: false },
      { role: Role.GAME_MANAGER, canRead: true, canWrite: false }
    ];

    for (const item of defaults) {
      const ruleId = `default-rule-${item.role.toLowerCase()}`;
      this.accessRules.set(ruleId, {
        id: ruleId,
        role: item.role,
        stationIds: [],
        connectorRoutes: [],
        canRead: item.canRead,
        canWrite: item.canWrite,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  private markThreadRead(thread: ChatThread, user: RequestUser): void {
    const now = new Date().toISOString();
    if (this.isStaff(user)) {
      thread.lastStaffReadAt = now;
      this.threads.set(thread.id, thread);
      this.persistence.persistThread(thread);
      return;
    }

    if (user.roles.includes(Role.CLIENT)) {
      thread.lastClientReadAt = now;
      this.threads.set(thread.id, thread);
      this.persistence.persistThread(thread);
    }
  }

  private normalizeLoadedConnectorConfig(
    connector: MessengerConnectorConfig
  ): MessengerConnectorConfig {
    return {
      ...connector,
      stationIds: this.normalizeStationIds(connector.stationIds),
      config: this.normalizeConnectorRuntimeConfig(connector.route, connector.config)
    };
  }

  private normalizeConnectorRuntimeConfig(
    route: ConnectorRoute,
    rawConfig?: Record<string, unknown>
  ): Record<string, string | number | boolean | string[]> {
    const defaults = this.defaultConnectorRuntimeConfig(route);
    const source =
      rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? rawConfig
        : {};
    const normalized: Record<string, string | number | boolean | string[]> = {
      ...defaults
    };

    for (const [key, value] of Object.entries(source)) {
      const normalizedValue = this.normalizeConnectorRuntimeConfigValue(value);
      if (normalizedValue === undefined) {
        continue;
      }
      normalized[key] = normalizedValue;
    }

    return normalized;
  }

  private defaultConnectorRuntimeConfig(
    route: ConnectorRoute
  ): Record<string, string | number | boolean | string[]> {
    if (
      route === ConnectorRoute.MAX_BOT ||
      route === ConnectorRoute.MAX_ACADEMY_BOT
    ) {
      return {
        inboundEnabled: true,
        outboxEnabled: true,
        outboxPollIntervalMs: 5000,
        outboxPullLimit: 20,
        outboxLeaseSec: 30,
        requireIntegrationToken: true,
        normalizeStationAlias: true,
        allowedMessageKinds: ['TEXT', 'CONTACT', 'STATION_SELECTION', 'COMMAND', 'SYSTEM']
      };
    }

    if (
      route === ConnectorRoute.LK_WEB_MESSENGER ||
      route === ConnectorRoute.LK_ACADEMY_WEB_MESSENGER ||
      route === ConnectorRoute.PROMO_WEB_MESSENGER
    ) {
      const isAcademyRoute = route === ConnectorRoute.LK_ACADEMY_WEB_MESSENGER;
      const isPromoRoute = route === ConnectorRoute.PROMO_WEB_MESSENGER;
      return {
        inboundEnabled: true,
        widgetEnabled: true,
        ingestPath: isAcademyRoute
          ? '/lk-academy/support/dialogs/events'
          : isPromoRoute
            ? '/promo/support/dialogs/events'
            : '/lk/support/dialogs/events',
        sourceTag: isAcademyRoute
          ? 'lk_academy_support_widget'
          : isPromoRoute
            ? 'promo_support_widget'
            : 'lk_support_widget',
        syncFromMongoEnabled: true,
        syncIntervalMs: 5000,
        mapAuthorizedAsVerified: true,
        resolveStationAliasByName: true
      };
    }

    return {
      inboundEnabled: true,
      outboxEnabled: true
    };
  }

  private normalizeConnectorRuntimeConfigValue(
    value: unknown
  ): string | number | boolean | string[] | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item.trim();
          }
          if (typeof item === 'number' || typeof item === 'boolean') {
            return String(item);
          }
          return '';
        })
        .filter((item) => item.length > 0);
    }
    return undefined;
  }

  private countUnreadMessagesForUser(thread: ChatThread, user: RequestUser): number {
    const threadMessages = this.messages.get(thread.id) ?? [];
    if (threadMessages.length === 0) {
      return 0;
    }

    if (this.isStaff(user)) {
      const staffReadTs = this.toTimestamp(thread.lastStaffReadAt);
      return threadMessages.filter((message) => {
        const createdTs = this.toTimestamp(message.createdAt);
        return !this.isStaffRole(message.senderRole) && createdTs > staffReadTs;
      }).length;
    }

    if (user.roles.includes(Role.CLIENT)) {
      const clientReadTs = this.toTimestamp(thread.lastClientReadAt);
      return threadMessages.filter((message) => {
        const createdTs = this.toTimestamp(message.createdAt);
        return this.isStaffRole(message.senderRole) && createdTs > clientReadTs;
      }).length;
    }

    return 0;
  }

  private countPendingClientMessages(threadId: string): number {
    return (this.pendingStaffResponses.get(threadId) ?? []).length;
  }

  private isSystemThreadMessage(message: ChatMessage): boolean {
    const direction = String(message.direction ?? '').trim().toUpperCase();
    const role = String(message.senderRoleRaw ?? message.senderRole ?? '').trim().toUpperCase();
    return direction === 'SYSTEM' || role === 'SYSTEM';
  }

  private isQuickReplyAutoResponseThreadMessage(message: ChatMessage): boolean {
    return String(message.senderName ?? '')
      .toLowerCase()
      .includes('автоответ');
  }

  private buildQuickReplyAutoResponseSenderName(ruleTitle?: string): string {
    const normalizedTitle = String(ruleTitle ?? '').trim();
    return normalizedTitle
      ? `Система · Автоответ · ${normalizedTitle}`
      : 'Система · Автоответ';
  }

  private resolveMessagesLimit(rawLimit?: number): number {
    if (!Number.isFinite(rawLimit) || Number(rawLimit) <= 0) {
      return 100;
    }
    return Math.min(Math.floor(Number(rawLimit)), 500);
  }

  private registerPendingClientResponse(thread: ChatThread, message: ChatMessage): void {
    const pending = this.pendingStaffResponses.get(thread.id) ?? [];
    pending.push({
      clientMessageId: message.id,
      startedAt: message.createdAt
    });
    this.pendingStaffResponses.set(thread.id, pending);
  }

  private removePendingClientResponse(threadId: string, clientMessageId: string): void {
    const pending = this.pendingStaffResponses.get(threadId) ?? [];
    this.pendingStaffResponses.set(
      threadId,
      pending.filter((item) => item.clientMessageId !== clientMessageId)
    );
  }

  private registerStaffResponseMetrics(
    thread: ChatThread,
    staffMessage: ChatMessage,
    staffUserId: string
  ): void {
    const pending = this.pendingStaffResponses.get(thread.id) ?? [];
    if (pending.length === 0) {
      return;
    }

    const respondedAtMs = this.toTimestamp(staffMessage.createdAt);
    const metrics = this.responseMetrics.get(thread.id) ?? [];

    for (const pendingResponse of pending) {
      const startedAtMs = this.toTimestamp(pendingResponse.startedAt);
      metrics.push({
        threadId: thread.id,
        connector: thread.connector,
        stationId: thread.stationId,
        clientMessageId: pendingResponse.clientMessageId,
        respondedByUserId: staffUserId,
        startedAt: pendingResponse.startedAt,
        respondedAt: staffMessage.createdAt,
        responseTimeMs: Math.max(0, respondedAtMs - startedAtMs)
      });
    }

    this.pendingStaffResponses.set(thread.id, []);
    this.responseMetrics.set(thread.id, metrics);
    this.persistence.persistResponseMetrics(thread.id, metrics);
  }

  private rebuildPendingResponsesForThread(threadId: string): PendingStaffResponse[] {
    const threadMessages = this.messages.get(threadId) ?? [];
    const pending: PendingStaffResponse[] = [];

    for (const message of threadMessages) {
      if (this.isStaffRole(message.senderRole)) {
        pending.length = 0;
        continue;
      }

      pending.push({
        clientMessageId: message.id,
        startedAt: message.createdAt
      });
    }

    return pending;
  }

  private getThreadResponseStats(threadId: string): {
    averageResponseTimeMs?: number;
    lastResponseTimeMs?: number;
  } {
    const metrics = this.responseMetrics.get(threadId) ?? [];
    if (metrics.length === 0) {
      return {};
    }

    const total = metrics.reduce((sum, metric) => sum + metric.responseTimeMs, 0);
    return {
      averageResponseTimeMs: Math.round(total / metrics.length),
      lastResponseTimeMs: metrics[metrics.length - 1].responseTimeMs
    };
  }

  private appendMessage(thread: ChatThread, message: ChatMessage): void {
    const existing = this.messages.get(thread.id) ?? [];
    existing.push(message);
    this.messages.set(thread.id, existing);

    thread.lastMessageAt = message.createdAt;
    if (!this.isSystemThreadMessage(message)) {
      thread.lastRankingMessageAt = message.createdAt;
    }
    thread.updatedAt = message.createdAt;
    this.threads.set(thread.id, thread);
    this.persistence.persistThread(thread);
    this.persistence.persistMessage(message);
    this.notifyMessageObservers(thread, message);
  }

  private notifyMessageObservers(thread: ChatThread, message: ChatMessage): void {
    for (const observer of this.messageObservers) {
      Promise.resolve(observer(thread, message)).catch((error: unknown) => {
        if (console && console.error) {
          console.error('[MessengerService] message observer failed', error);
        }
      });
    }
  }

  private analyzeDialog(threadId: string): DialogAiInsight {
    const threadMessages = this.messages.get(threadId) ?? [];
    const insight = this.aiConnector.analyzeDialog(threadId, threadMessages);
    this.aiInsights.set(threadId, insight);
    this.persistence.persistAiInsight(threadId, insight);
    return insight;
  }

  private getLatestClientMessage(threadId: string): ChatMessage | null {
    const threadMessages = this.messages.get(threadId) ?? [];
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      const candidate = threadMessages[index];
      if (!this.isStaffRole(candidate.senderRole)) {
        return candidate;
      }
    }
    return null;
  }

  private getThreadAiConfig(threadId: string): ThreadAiConfig {
    const existing = this.aiConfigs.get(threadId);
    if (existing) {
      return existing;
    }

    const fallback: ThreadAiConfig = {
      mode: AiAssistMode.SUGGEST,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system'
    };
    this.aiConfigs.set(threadId, fallback);
    this.persistence.persistAiConfig(threadId, fallback);
    return fallback;
  }

  private storeSuggestion(threadId: string, suggestion: AiReplySuggestion): void {
    const existing = this.aiSuggestions.get(threadId) ?? [];
    existing.push(suggestion);
    this.aiSuggestions.set(threadId, existing);
    this.persistence.persistAiSuggestion(suggestion);
  }

  private buildSuggestion(
    thread: ChatThread,
    clientMessage: ChatMessage,
    insight: DialogAiInsight
  ): AiReplySuggestion {
    return {
      id: randomUUID(),
      threadId: thread.id,
      basedOnClientMessageId: clientMessage.id,
      text: this.aiConnector.buildSuggestion(insight, clientMessage.text),
      status: AiSuggestionStatus.PENDING_STAFF,
      createdAt: new Date().toISOString()
    };
  }

  private handleAiAssistantOnClientMessage(
    thread: ChatThread,
    clientMessage: ChatMessage
  ): void {
    const config = this.getThreadAiConfig(thread.id);
    if (config.mode === AiAssistMode.DISABLED) {
      return;
    }

    const insight = this.aiInsights.get(thread.id) ?? this.analyzeDialog(thread.id);
    const suggestion = this.buildSuggestion(thread, clientMessage, insight);

    if (config.mode === AiAssistMode.AUTO_REPLY && this.aiConnector.canAutoReply(insight)) {
      const sentAt = new Date().toISOString();
      const aiMessage: ChatMessage = {
        id: randomUUID(),
        threadId: thread.id,
        senderId: 'ai-assistant',
        senderRole: Role.SUPPORT,
        origin: MessageOrigin.AI,
        text: suggestion.text,
        createdAt: sentAt
      };

      this.appendMessage(thread, aiMessage);
      suggestion.status = AiSuggestionStatus.SENT_TO_CLIENT;
      suggestion.sentAt = sentAt;
      this.removePendingClientResponse(thread.id, clientMessage.id);
    }

    this.storeSuggestion(thread.id, suggestion);
  }

  private handleQuickReplyAutoRules(
    thread: ChatThread,
    clientMessage: ChatMessage
  ): void {
    const [rule] = this.quickReplies.findMatchingRules(
      this.buildQuickReplyMatchContext(thread, clientMessage, clientMessage.createdAt),
      QuickReplyMode.AUTO_REPLY
    );
    if (!rule) {
      return;
    }

    const sentAt = new Date().toISOString();
    const systemMessage: ChatMessage = {
      id: randomUUID(),
      threadId: thread.id,
      senderId: 'system',
      senderRole: Role.SUPPORT,
      senderRoleRaw: 'SYSTEM',
      senderName: this.buildQuickReplyAutoResponseSenderName(rule.title),
      origin: MessageOrigin.HUMAN,
      direction: 'SYSTEM',
      text: rule.responseText,
      attachments:
        this.normalizeMessageAttachments(rule.responseAttachments).length > 0
          ? this.normalizeMessageAttachments(rule.responseAttachments)
          : undefined,
      createdAt: sentAt
    };

    this.appendMessage(thread, systemMessage);
    this.quickReplies.registerUsage(
      rule.id,
      this.buildQuickReplyMatchContext(thread, clientMessage, clientMessage.createdAt)
    );
  }

  private ensureNoReplyQuickReplyTimer(): void {
    if (this.noReplyQuickReplyTimer) {
      return;
    }
    this.noReplyQuickReplyTimer = setInterval(() => {
      this.sweepNoReplyQuickReplies();
    }, 30000);
  }

  private sweepNoReplyQuickReplies(): void {
    for (const thread of this.threads.values()) {
      if (thread.status !== ThreadStatus.OPEN) {
        continue;
      }

      const staffMessage = this.getLatestAwaitingClientStaffMessage(thread.id);
      if (!staffMessage) {
        continue;
      }

      const context = this.buildQuickReplyMatchContext(
        thread,
        this.getLatestClientMessage(thread.id),
        staffMessage.createdAt
      );
      const rule = this.quickReplies.findMatchingRules(
        context,
        QuickReplyMode.AUTO_REPLY
      ).find(
        (candidate) =>
          candidate.triggerType === QuickReplyTriggerType.CLIENT_NO_REPLY_FOR
      );
      if (!rule) {
        continue;
      }

      const signature = `${thread.id}:${staffMessage.id}:${rule.id}`;
      if (this.noReplyQuickReplySignatures.has(signature)) {
        continue;
      }
      this.noReplyQuickReplySignatures.add(signature);
      if (this.noReplyQuickReplySignatures.size > 5000) {
        this.noReplyQuickReplySignatures.clear();
        this.noReplyQuickReplySignatures.add(signature);
      }

      const sentAt = new Date().toISOString();
      this.appendMessage(thread, {
        id: randomUUID(),
        threadId: thread.id,
        senderId: 'system',
        senderRole: Role.SUPPORT,
        senderRoleRaw: 'SYSTEM',
        senderName: this.buildQuickReplyAutoResponseSenderName(rule.title),
        origin: MessageOrigin.HUMAN,
        direction: 'SYSTEM',
        text: rule.responseText,
        attachments:
          this.normalizeMessageAttachments(rule.responseAttachments).length > 0
            ? this.normalizeMessageAttachments(rule.responseAttachments)
            : undefined,
        createdAt: sentAt
      });
      this.quickReplies.registerUsage(rule.id, context);
    }
  }

  private buildQuickReplyMatchContext(
    thread: ChatThread,
    clientMessage: ChatMessage | null,
    messageCreatedAt?: string
  ) {
    return {
      sourceType: QuickReplySourceType.MESSENGER,
      dialogId: thread.id,
      connector: thread.connector,
      stationId: thread.stationId,
      messageText: clientMessage?.text,
      messageCreatedAt: messageCreatedAt ?? clientMessage?.createdAt,
      hasAttachment: this.normalizeMessageAttachments(clientMessage?.attachments).length > 0,
      isFirstClientMessage: this.isFirstClientMessage(thread.id, clientMessage?.id),
      noClientReplyMinutes: this.resolveNoClientReplyMinutes(thread.id)
    };
  }

  private isFirstClientMessage(threadId: string, messageId?: string): boolean {
    if (!messageId) {
      return false;
    }
    const threadMessages = this.messages.get(threadId) ?? [];
    for (const message of threadMessages) {
      if (this.isStaffRole(message.senderRole) || this.isSystemThreadMessage(message)) {
        continue;
      }
      return message.id === messageId;
    }
    return false;
  }

  private resolveNoClientReplyMinutes(threadId: string): number | undefined {
    const threadMessages = (this.messages.get(threadId) ?? []).filter(
      (message) => !this.isSystemThreadMessage(message)
    );
    const lastMessage = threadMessages[threadMessages.length - 1];
    if (!lastMessage || !this.isStaffRole(lastMessage.senderRole)) {
      return undefined;
    }
    const elapsedMs = Date.now() - this.toTimestamp(lastMessage.createdAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return undefined;
    }
    return Math.floor(elapsedMs / 60000);
  }

  private getLatestAwaitingClientStaffMessage(threadId: string): ChatMessage | null {
    const threadMessages = this.messages.get(threadId) ?? [];
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      const candidate = threadMessages[index];
      if (this.isSystemThreadMessage(candidate)) {
        continue;
      }
      return this.isStaffRole(candidate.senderRole) ? candidate : null;
    }
    return null;
  }

  private getLatestDialogPreviewMessage(threadId: string): ChatMessage | undefined {
    const threadMessages = this.messages.get(threadId) ?? [];
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      const candidate = threadMessages[index];
      if (!this.isSystemThreadMessage(candidate)) {
        return candidate;
      }
    }
    return threadMessages[threadMessages.length - 1];
  }

  private ensureMessageHasBody(text?: string, attachments: MessageAttachment[] = []): void {
    if (String(text ?? '').trim() || attachments.length > 0) {
      return;
    }
    throw new BadRequestException('text or attachments are required');
  }

  private formatMessagePreview(message?: ChatMessage): string | undefined {
    if (!message) {
      return undefined;
    }

    const text = String(message.text ?? '').trim();
    if (text) {
      return text;
    }

    const attachments = this.normalizeMessageAttachments(message.attachments);
    if (attachments.length === 0) {
      return undefined;
    }

    const first = attachments[0];
    const label = first.name ? `Фото: ${first.name}` : 'Фото';
    return attachments.length > 1 ? `${label} (+${attachments.length - 1})` : label;
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

      const type = this.readStringValue(source['type'])?.toUpperCase();
      const url = this.readStringValue(source['url']);
      if (type !== MessageAttachmentType.IMAGE || !url || !this.isSupportedAttachmentUrl(url)) {
        continue;
      }

      const rawSize = Number(source['size']);
      attachments.push({
        id: this.readStringValue(source['id']) ?? randomUUID(),
        type: MessageAttachmentType.IMAGE,
        url,
        name: this.readStringValue(source['name']),
        mimeType: this.readStringValue(source['mimeType']),
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

  private readStringValue(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
  }

  private toTimestamp(value?: string): number {
    if (!value) {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private maxDate(values: Array<string | undefined>): string | undefined {
    let maxValue: string | undefined;
    let maxTs = 0;

    for (const value of values) {
      const ts = this.toTimestamp(value);
      if (ts > maxTs) {
        maxTs = ts;
        maxValue = value;
      }
    }

    return maxValue;
  }
}
