import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import {
  SupportConnectorNormalizationHelpers,
  SupportStationMappingMatch
} from './connectors/support-connector-adapter';
import { SupportConnectorRegistry } from './connectors/support-connector.registry';
import { IngestSupportEventDto } from './dto/ingest-support-event.dto';
import { ReplySupportDialogDto } from './dto/reply-support-dialog.dto';
import {
  SupportPersistenceRuntimeDiagnostics,
  SupportPersistenceService
} from './support-persistence.service';
import {
  SUPPORT_UNASSIGNED_STATION_ID,
  SUPPORT_UNASSIGNED_STATION_NAME,
  SupportAiInsight,
  SupportClientAuthStatus,
  SupportClientIdentity,
  SupportClientProfile,
  SupportConnectorAnalytics,
  SupportConnectorRoute,
  SupportConnectorSummary,
  SupportDailyAnalytics,
  SupportDialog,
  SupportDialogReactionAnalytics,
  SupportDialogStatus,
  SupportDialogSummary,
  SupportMessage,
  SupportMessageDirection,
  SupportMessageKind,
  SupportIngestEventResult,
  SupportOutboxCommand,
  SupportOutboxStatus,
  SupportPriority,
  SupportResponseMetric,
  SupportSenderRole,
  SupportSentiment,
  SupportStationAnalytics,
  SupportStationSummary,
  SupportTopic,
  SupportTopicAnalytics,
  SupportPriorityAnalytics
} from './support.types';

interface ResolveClientQuery {
  phone?: string;
  email?: string;
  connector?: SupportConnectorRoute;
  externalUserId?: string;
  externalChatId?: string;
  username?: string;
}

interface NormalizedIngestSupportEventDto extends IngestSupportEventDto {
  connector: SupportConnectorRoute;
  externalUserId?: string;
  externalChatId?: string;
  displayName?: string;
  username?: string;
  selectedStationId?: string;
  selectedStationName?: string;
  deliverToClient?: boolean;
}

interface SupportStationMapping {
  key: string;
  stationId: string;
  stationName: string;
}

interface SupportDialogFilters {
  connector?: SupportConnectorRoute;
  stationId?: string;
}

interface SupportMessagesListOptions {
  limit?: number;
  before?: string;
  includeService?: boolean;
}

@Injectable()
export class SupportService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SupportService.name);
  private readonly clients = new Map<string, SupportClientProfile>();
  private readonly dialogs = new Map<string, SupportDialog>();
  private readonly messages = new Map<string, SupportMessage[]>();
  private readonly responseMetrics = new Map<string, SupportResponseMetric[]>();
  private readonly outbox = new Map<string, SupportOutboxCommand>();
  private readonly dialogsNeedingUnreadRebuild = new Set<string>();
  private readonly stationMappings = this.parseStationMappings();
  private readonly persistenceSyncIntervalMs = this.resolvePersistenceSyncIntervalMs();
  private persistenceSyncTimer?: ReturnType<typeof setInterval>;
  private isPersistenceSyncInProgress = false;
  private initialPersistenceSyncCompleted = false;
  private lastPersistenceSyncStartedAt?: string;
  private lastPersistenceSyncCompletedAt?: string;
  private lastPersistenceSyncDurationMs?: number;
  private lastPersistenceSyncError?: string;

  constructor(
    private readonly persistence: SupportPersistenceService,
    private readonly connectorRegistry: SupportConnectorRegistry
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureInitialPersistenceSync();
    this.ensurePersistenceSyncTimer();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureInitialPersistenceSync();
    this.ensurePersistenceSyncTimer();
  }

  onModuleDestroy(): void {
    if (!this.persistenceSyncTimer) {
      return;
    }
    clearInterval(this.persistenceSyncTimer);
    this.persistenceSyncTimer = undefined;
  }

  async hydrateFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }

    const state = await this.persistence.loadState();
    this.clients.clear();
    this.dialogs.clear();
    this.messages.clear();
    this.responseMetrics.clear();
    this.outbox.clear();
    this.dialogsNeedingUnreadRebuild.clear();

    for (const client of state.clients) {
      this.clients.set(client.id, this.normalizeLoadedClient(client));
    }

    for (const dialog of state.dialogs) {
      const normalizedDialog = this.normalizeLoadedDialog(dialog);
      this.dialogs.set(normalizedDialog.id, normalizedDialog);
      this.messages.set(normalizedDialog.id, []);
      this.responseMetrics.set(normalizedDialog.id, []);
    }

    for (const message of state.messages) {
      const normalizedMessage = this.normalizeLoadedMessage(
        message as unknown as Record<string, unknown>
      );
      if (!normalizedMessage) {
        continue;
      }

      this.ensureClientAndDialogFromMessage(
        normalizedMessage,
        message as unknown as Record<string, unknown>
      );

      const existing = this.messages.get(normalizedMessage.dialogId) ?? [];
      existing.push(normalizedMessage);
      this.messages.set(normalizedMessage.dialogId, existing);
    }

    for (const metric of state.responseMetrics) {
      const existing = this.responseMetrics.get(metric.dialogId) ?? [];
      existing.push(metric);
      this.responseMetrics.set(metric.dialogId, existing);
    }

    for (const command of state.outbox) {
      this.outbox.set(command.id, command);
    }

    for (const [dialogId, dialogMessages] of this.messages.entries()) {
      dialogMessages.sort(
        (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
      );
      this.messages.set(dialogId, dialogMessages);
    }

    for (const [dialogId, metrics] of this.responseMetrics.entries()) {
      metrics.sort(
        (left, right) => this.toTimestamp(left.startedAt) - this.toTimestamp(right.startedAt)
      );
      this.responseMetrics.set(dialogId, metrics);
    }

    this.rebuildDialogsFromLoadedMessages();
  }

  resolveClient(query: ResolveClientQuery): {
    client: SupportClientProfile | null;
    dialogs: SupportDialogSummary[];
  } {
    const client = this.findClientByQuery(query);
    if (!client) {
      return { client: null, dialogs: [] };
    }

    const dialogs = this.listDialogsForClient(client.id).map((dialog) =>
      this.toDialogSummary(dialog, dialog.lastInboundConnector ?? dialog.connectors[0])
    );
    return { client, dialogs };
  }

  async getRuntimeDiagnostics(user: RequestUser): Promise<{
    timestamp: string;
    inMemory: {
      clients: number;
      dialogs: number;
      messages: number;
      responseMetrics: number;
      outbox: number;
    };
    sync: {
      initialSyncCompleted: boolean;
      periodicSyncEnabled: boolean;
      intervalMs: number;
      inProgress: boolean;
      lastStartedAt?: string;
      lastCompletedAt?: string;
      lastDurationMs?: number;
      lastError?: string;
    };
    persistence: SupportPersistenceRuntimeDiagnostics;
    connectors: ReturnType<SupportConnectorRegistry['listEntries']>;
  }> {
    this.ensureStaff(user);
    const dialogs = Array.from(this.dialogs.values());
    const messagesCount = Array.from(this.messages.values()).reduce(
      (total, items) => total + items.length,
      0
    );
    const responseMetricsCount = Array.from(this.responseMetrics.values()).reduce(
      (total, items) => total + items.length,
      0
    );
    const persistence = await this.persistence.getRuntimeDiagnostics();
    return {
      timestamp: new Date().toISOString(),
      inMemory: {
        clients: this.clients.size,
        dialogs: dialogs.length,
        messages: messagesCount,
        responseMetrics: responseMetricsCount,
        outbox: this.outbox.size
      },
      sync: {
        initialSyncCompleted: this.initialPersistenceSyncCompleted,
        periodicSyncEnabled: this.persistenceSyncIntervalMs > 0,
        intervalMs: this.persistenceSyncIntervalMs,
        inProgress: this.isPersistenceSyncInProgress,
        lastStartedAt: this.lastPersistenceSyncStartedAt,
        lastCompletedAt: this.lastPersistenceSyncCompletedAt,
        lastDurationMs: this.lastPersistenceSyncDurationMs,
        lastError: this.lastPersistenceSyncError
      },
      persistence,
      connectors: this.connectorRegistry.listEntries()
    };
  }

  private reconcileState(): void {
    this.reconcileDuplicateClients();
    this.reconcileDuplicateDialogs();
  }

  private async syncFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled() || this.isPersistenceSyncInProgress) {
      return;
    }

    const startedAt = Date.now();
    this.lastPersistenceSyncStartedAt = new Date(startedAt).toISOString();
    this.isPersistenceSyncInProgress = true;
    try {
      await this.hydrateFromPersistence();
      this.reconcileState();
      const completedAt = Date.now();
      this.lastPersistenceSyncCompletedAt = new Date(completedAt).toISOString();
      this.lastPersistenceSyncDurationMs = Math.max(0, completedAt - startedAt);
      this.lastPersistenceSyncError = undefined;
    } catch (error) {
      this.lastPersistenceSyncError = String(error);
      throw error;
    } finally {
      this.isPersistenceSyncInProgress = false;
    }
  }

  private async ensureInitialPersistenceSync(): Promise<void> {
    if (this.initialPersistenceSyncCompleted) {
      return;
    }
    await this.syncFromPersistence();
    this.initialPersistenceSyncCompleted = true;
  }

  private ensurePersistenceSyncTimer(): void {
    if (
      this.persistenceSyncTimer ||
      !this.persistence.isEnabled() ||
      this.persistenceSyncIntervalMs <= 0
    ) {
      return;
    }

    this.logger.log(
      `Support persistence periodic sync enabled (intervalMs=${this.persistenceSyncIntervalMs}).`
    );
    this.persistenceSyncTimer = setInterval(() => {
      void this.syncFromPersistence();
    }, this.persistenceSyncIntervalMs);
  }

  private resolvePersistenceSyncIntervalMs(): number {
    const rawValue = Number(process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS ?? 0);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      return 0;
    }
    if (rawValue === 0) {
      return 0;
    }
    return Math.max(1000, Math.floor(rawValue));
  }

  ingestEvent(dto: IngestSupportEventDto): SupportIngestEventResult {
    const normalizedDto = this.normalizeIncomingEvent(dto);
    const createdAt = this.resolveEventTimestamp(normalizedDto.timestamp);
    const normalizedPhone = this.normalizePhone(normalizedDto.phone);
    const normalizedEmail = this.normalizeEmail(normalizedDto.email);
    const client = this.resolveOrCreateClient(
      normalizedDto,
      normalizedPhone,
      normalizedEmail,
      createdAt
    );

    const selectedStationId = this.normalizeStationId(
      normalizedDto.selectedStationId ?? normalizedDto.stationId
    );
    const connectorFallbackStationId =
      normalizedDto.connector === SupportConnectorRoute.LK_WEB_MESSENGER
        ? this.normalizeStationId(client.currentStationId)
        : undefined;
    const stationId =
      selectedStationId ??
      connectorFallbackStationId ??
      SUPPORT_UNASSIGNED_STATION_ID;
    const stationName =
      this.resolveStationName(
        normalizedDto.selectedStationName ?? normalizedDto.stationName,
        client.currentStationName,
        stationId
      ) ?? SUPPORT_UNASSIGNED_STATION_NAME;

    if (
      selectedStationId &&
      normalizedDto.connector === SupportConnectorRoute.LK_WEB_MESSENGER
    ) {
      client.currentStationId = stationId;
      client.currentStationName = stationName;
      client.updatedAt = createdAt;
      this.persistClient(client);
    }

    const dialog = this.resolveDialog(
      client,
      stationId,
      stationName,
      normalizedDto.subject,
      normalizedDto.connector,
      selectedStationId,
      createdAt
    );
    const kind = this.resolveMessageKind(normalizedDto, normalizedPhone, normalizedEmail);
    const direction = this.resolveIncomingDirection(normalizedDto, kind);
    const senderRole = this.resolveIncomingSenderRole(direction, kind);

    const message = this.shouldCreateMessage(normalizedDto, kind, normalizedPhone, normalizedEmail)
      ? this.buildMessage(normalizedDto, {
          dialog,
          client,
          createdAt,
          direction,
          kind,
          senderRole,
          normalizedPhone,
          normalizedEmail
        })
      : undefined;

    const contactReminderStage = this.updateContactReminderStage(
      client,
      direction,
      kind,
      createdAt
    );

    dialog.authStatus = client.authStatus;
    dialog.currentPhone = client.primaryPhone;
    dialog.phones = [...client.phones];
    dialog.emails = [...client.emails];
    dialog.connectors = this.mergeConnectors(dialog.connectors, [normalizedDto.connector]);
    dialog.lastInboundConnector =
      direction === SupportMessageDirection.INBOUND
        ? normalizedDto.connector
        : dialog.lastInboundConnector;
    dialog.subject =
      this.normalizeDialogSubject(dialog.subject) ?? this.buildDialogSubject(client, stationName);
    dialog.updatedAt = createdAt;

    let outbox: SupportOutboxCommand | undefined;
    let emittedMessage = message;
    const duplicateInboundMessage =
      message && direction === SupportMessageDirection.INBOUND
        ? this.findDuplicateInboundMessage(dialog.id, message)
        : undefined;
    if (duplicateInboundMessage) {
      emittedMessage = duplicateInboundMessage;
    }

    if (message && !duplicateInboundMessage) {
      this.appendMessage(dialog, message);
      if (direction === SupportMessageDirection.INBOUND) {
        dialog.unreadCount += 1;
        if (this.isActionableClientMessage(message)) {
          dialog.waitingForStaffSince = dialog.waitingForStaffSince ?? createdAt;
          dialog.pendingClientMessageIds = this.mergeIds(dialog.pendingClientMessageIds, [message.id]);
        }
        dialog.lastClientMessageAt = createdAt;
      } else if (direction === SupportMessageDirection.OUTBOUND) {
        dialog.lastStaffMessageAt = createdAt;
      }

      if (message.ai) {
        dialog.ai = message.ai;
      }

      if (
        this.shouldDeliverIncomingEventToClient(normalizedDto, direction) &&
        this.canReplyToDialog(dialog)
      ) {
        outbox = this.createOutboxCommand(dialog, message, normalizedDto.connector);
        if (outbox) {
          this.outbox.set(outbox.id, outbox);
          this.persistence.persistOutboxCommand(outbox);
          dialog.lastReplyConnector = normalizedDto.connector;
        }
      }
    }

    this.persistDialog(dialog);

    return {
      client,
      dialog,
      message: emittedMessage,
      outbox,
      requiredAction:
        client.authStatus !== SupportClientAuthStatus.VERIFIED
          ? 'REQUEST_CONTACT'
          : dialog.stationId === SUPPORT_UNASSIGNED_STATION_ID
            ? 'REQUEST_STATION'
            : undefined,
      contactReminderStage,
      canReplyToClient: this.canReplyToDialog(dialog)
    };
  }

  listConnectors(user: RequestUser): SupportConnectorSummary[] {
    const dialogs = this.listAccessibleDialogs(user);
    const byConnector = new Map<SupportConnectorRoute, SupportDialog[]>();

    for (const dialog of dialogs) {
      for (const connector of dialog.connectors) {
        const existing = byConnector.get(connector) ?? [];
        existing.push(dialog);
        byConnector.set(connector, existing);
      }
    }

    return Array.from(byConnector.entries())
      .map(([connector, connectorDialogs]) => {
        const stations = new Set(connectorDialogs.map((dialog) => dialog.stationId));
        return {
          connector,
          stationsCount: stations.size,
          dialogsCount: connectorDialogs.length,
          unreadMessagesCount: connectorDialogs.reduce(
            (sum, dialog) => sum + dialog.unreadCount,
            0
          ),
          unverifiedDialogsCount: connectorDialogs.filter(
            (dialog) => dialog.authStatus !== SupportClientAuthStatus.VERIFIED
          ).length
        };
      })
      .sort((left, right) => left.connector.localeCompare(right.connector));
  }

  listStationsByConnector(
    connector: SupportConnectorRoute,
    user: RequestUser
  ): SupportStationSummary[] {
    const dialogs = this.listAccessibleDialogs(user).filter((dialog) =>
      dialog.connectors.includes(connector)
    );
    const byStation = new Map<string, SupportDialog[]>();

    for (const dialog of dialogs) {
      const existing = byStation.get(dialog.stationId) ?? [];
      existing.push(dialog);
      byStation.set(dialog.stationId, existing);
    }

    return Array.from(byStation.entries())
      .map(([stationId, stationDialogs]) => ({
        connector,
        stationId,
        stationName: stationDialogs[0]?.stationName ?? this.resolveStationName(undefined, undefined, stationId),
        dialogsCount: stationDialogs.length,
        unreadDialogsCount: stationDialogs.filter((dialog) => dialog.unreadCount > 0).length,
        unreadMessagesCount: stationDialogs.reduce((sum, dialog) => sum + dialog.unreadCount, 0),
        unverifiedDialogsCount: stationDialogs.filter(
          (dialog) => dialog.authStatus !== SupportClientAuthStatus.VERIFIED
        ).length,
        lastMessageAt: this.maxDate(stationDialogs.map((dialog) => dialog.lastMessageAt))
      }))
      .sort((left, right) => left.stationId.localeCompare(right.stationId));
  }

  listDialogsByStation(
    connector: SupportConnectorRoute,
    stationId: string,
    user: RequestUser
  ): SupportDialogSummary[] {
    return this.listAccessibleDialogs(user, { connector, stationId })
      .map((dialog) => this.toDialogSummary(dialog, connector))
      .sort((left, right) => this.compareDialogSummaryRank(left, right));
  }

  listDialogs(user: RequestUser, filters: SupportDialogFilters = {}): SupportDialogSummary[] {
    return this.listAccessibleDialogs(user, filters)
      .map((dialog) => this.toDialogSummary(dialog, filters.connector, user))
      .sort((left, right) => this.compareDialogSummaryRank(left, right));
  }

  async listDialogsByPhone(
    phone: string,
    user: RequestUser,
    filters: SupportDialogFilters = {}
  ): Promise<SupportDialogSummary[]> {
    this.ensureStaff(user);
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      return [];
    }

    let dialogs: SupportDialog[] = [];
    if (this.persistence.isEnabled()) {
      const candidateIds = await this.persistence.findDialogIdsByPhone(normalizedPhone, {
        connector: filters.connector,
        stationId: filters.stationId,
        limit: 200
      });
      dialogs = candidateIds
        .map((dialogId) => this.dialogs.get(dialogId))
        .filter((dialog): dialog is SupportDialog => Boolean(dialog))
        .filter((dialog) => this.canAccessDialog(dialog, user));
    }

    if (dialogs.length === 0) {
      dialogs = this.listAccessibleDialogs(user, filters).filter((dialog) =>
        this.dialogMatchesPhone(dialog, normalizedPhone)
      );
    }

    const byId = new Map<string, SupportDialog>();
    for (const dialog of dialogs) {
      byId.set(dialog.id, dialog);
    }

    return Array.from(byId.values())
      .map((dialog) => this.toDialogSummary(dialog, filters.connector, user))
      .sort((left, right) => this.compareDialogSummaryRank(left, right));
  }

  async listMessages(
    dialogId: string,
    user: RequestUser,
    options: SupportMessagesListOptions = {}
  ): Promise<SupportMessage[]> {
    const dialog = this.getDialogOrThrow(dialogId);
    this.ensureDialogAccess(dialog, user);
    if (this.isStaff(user)) {
      dialog.unreadCount = 0;
      this.persistDialog(dialog);
    }

    const includeService = options.includeService === true;
    const beforeTs = this.toTimestamp(options.before);
    const limit = this.resolveMessagesLimit(options.limit);
    const source = this.messages.get(dialog.id) ?? [];
    const regularMessages = source
      .filter((message) => !this.isSystemDialogMessage(message))
      .filter((message) => (beforeTs > 0 ? this.toTimestamp(message.createdAt) < beforeTs : true));

    if (!includeService) {
      return regularMessages.length <= limit
        ? regularMessages
        : regularMessages.slice(regularMessages.length - limit);
    }

    const serviceMessages = await this.listServiceMessages(dialog.id, user, {
      limit: Math.max(limit * 2, limit),
      before: options.before
    });
    const merged = [...regularMessages, ...serviceMessages].sort(
      (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
    );

    return merged.length <= limit ? merged : merged.slice(merged.length - limit);
  }

  async listServiceMessages(
    dialogId: string,
    user: RequestUser,
    options: SupportMessagesListOptions = {}
  ): Promise<SupportMessage[]> {
    const dialog = this.getDialogOrThrow(dialogId);
    this.ensureDialogAccess(dialog, user);

    const limit = this.resolveMessagesLimit(options.limit);
    if (this.persistence.isEnabled()) {
      const persisted = await this.persistence.findServiceMessages(dialog.id, {
        limit,
        before: options.before
      });
      if (persisted.length > 0) {
        return persisted;
      }
    }

    const beforeTs = this.toTimestamp(options.before);
    const source = this.messages.get(dialog.id) ?? [];
    const filtered = source
      .filter((message) => this.isSystemDialogMessage(message))
      .filter((message) => (beforeTs > 0 ? this.toTimestamp(message.createdAt) < beforeTs : true));

    return filtered.length <= limit ? filtered : filtered.slice(filtered.length - limit);
  }

  replyToDialog(
    dialogId: string,
    dto: ReplySupportDialogDto,
    user: RequestUser
  ): { dialog: SupportDialog; message: SupportMessage; outbox?: SupportOutboxCommand } {
    const dialog = this.getDialogOrThrow(dialogId);
    this.ensureDialogAccess(dialog, user);
    this.ensureStaff(user);
    if (!this.isDialogActiveForUser(dialog, user)) {
      throw new ForbiddenException('Dialog is inactive for your station');
    }

    if (dialog.status === SupportDialogStatus.CLOSED) {
      throw new ForbiddenException('Dialog is closed');
    }

    const connector =
      dto.connector ??
      dialog.lastReplyConnector ??
      dialog.lastInboundConnector ??
      dialog.connectors[0] ??
      SupportConnectorRoute.MAX_BOT;
    const createdAt = new Date().toISOString();
    const senderRole = this.resolveSenderRole(user.roles);
    const message: SupportMessage = {
      id: randomUUID(),
      dialogId: dialog.id,
      clientId: dialog.clientId,
      connector,
      direction: SupportMessageDirection.OUTBOUND,
      kind: SupportMessageKind.TEXT,
      text: dto.text.trim(),
      createdAt,
      senderId: user.id,
      senderRole,
      senderName: this.buildStaffSenderName(user, senderRole),
      meta: this.buildStaffMessageMeta(user)
    };

    this.appendMessage(dialog, message);
    dialog.lastStaffMessageAt = createdAt;
    dialog.lastReplyConnector = connector;
    dialog.unreadCount = 0;

    let outbox: SupportOutboxCommand | undefined;
    const responseMetric = this.createResponseMetric(dialog, user.id, connector, createdAt);
    if (responseMetric) {
      this.storeResponseMetric(responseMetric);
      dialog.lastFirstResponseMs = responseMetric.responseTimeMs;
      dialog.responseTimeTotalMs += responseMetric.responseTimeMs;
      dialog.responseCount += 1;
      dialog.averageFirstResponseMs = Math.round(
        dialog.responseTimeTotalMs / dialog.responseCount
      );
    }
    dialog.waitingForStaffSince = undefined;
    dialog.pendingClientMessageIds = [];
    dialog.updatedAt = createdAt;
    this.persistDialog(dialog);

    outbox = this.createOutboxCommand(dialog, message, connector);
    if (outbox) {
      this.outbox.set(outbox.id, outbox);
      this.persistence.persistOutboxCommand(outbox);
    }

    return { dialog, message, outbox };
  }

  pullOutbox(
    connector: SupportConnectorRoute,
    limit = 20,
    leaseSec = 30
  ): SupportOutboxCommand[] {
    const now = Date.now();
    const leasedUntil = new Date(now + Math.max(5, leaseSec) * 1000).toISOString();

    const commands = Array.from(this.outbox.values())
      .filter((command) => command.connector === connector)
      .filter((command) => {
        if (command.status === SupportOutboxStatus.PENDING) {
          return true;
        }
        if (command.status === SupportOutboxStatus.LEASED) {
          return this.toTimestamp(command.leasedUntil) <= now;
        }
        return false;
      })
      .sort((left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt))
      .slice(0, Math.max(1, limit));

    for (const command of commands) {
      const updated: SupportOutboxCommand = {
        ...command,
        status: SupportOutboxStatus.LEASED,
        leasedUntil,
        attempts: command.attempts + 1
      };
      this.outbox.set(updated.id, updated);
      this.persistence.persistOutboxCommand(updated);
    }

    return commands.map((command) => this.outbox.get(command.id) ?? command);
  }

  ackOutbox(id: string): SupportOutboxCommand {
    const command = this.getOutboxOrThrow(id);
    const updated: SupportOutboxCommand = {
      ...command,
      status: SupportOutboxStatus.SENT,
      leasedUntil: undefined,
      lastError: undefined
    };
    this.outbox.set(updated.id, updated);
    this.persistence.persistOutboxCommand(updated);
    return updated;
  }

  failOutbox(id: string, error?: string, requeue = true): SupportOutboxCommand {
    const command = this.getOutboxOrThrow(id);
    const updated: SupportOutboxCommand = {
      ...command,
      status: requeue ? SupportOutboxStatus.PENDING : SupportOutboxStatus.FAILED,
      leasedUntil: undefined,
      lastError: String(error ?? '').trim() || undefined
    };
    this.outbox.set(updated.id, updated);
    this.persistence.persistOutboxCommand(updated);
    return updated;
  }

  getDailyAnalytics(date?: string, user?: RequestUser): SupportDailyAnalytics {
    if (user) {
      this.ensureStaff(user);
    }

    const dayStart = this.resolveAnalyticsStart(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const accessibleDialogs = user ? this.listAccessibleDialogs(user) : Array.from(this.dialogs.values());
    const accessibleDialogIds = new Set(accessibleDialogs.map((dialog) => dialog.id));
    const accessibleByDialog = new Map(accessibleDialogs.map((dialog) => [dialog.id, dialog]));
    const allMessages = Array.from(this.messages.values()).flat();
    const dayMessages = allMessages.filter((message) => {
      const createdTs = this.toTimestamp(message.createdAt);
      return (
        accessibleDialogIds.has(message.dialogId) &&
        createdTs >= dayStart.getTime() &&
        createdTs < dayEnd.getTime()
      );
    });

    const inboundMessages = dayMessages.filter(
      (message) => message.direction === SupportMessageDirection.INBOUND
    );
    const outboundMessages = dayMessages.filter(
      (message) => message.direction === SupportMessageDirection.OUTBOUND
    );

    const allMetrics = Array.from(this.responseMetrics.values()).flat().filter((metric) => {
      const startedTs = this.toTimestamp(metric.startedAt);
      return (
        accessibleDialogIds.has(metric.dialogId) &&
        startedTs >= dayStart.getTime() &&
        startedTs < dayEnd.getTime()
      );
    });

    const byStationMap = new Map<string, SupportStationAnalytics>();
    for (const message of inboundMessages) {
      const dialog = accessibleByDialog.get(message.dialogId);
      if (!dialog) {
        continue;
      }
      const existing = byStationMap.get(dialog.stationId) ?? {
        stationId: dialog.stationId,
        stationName: dialog.stationName,
        inboundMessagesCount: 0,
        dialogsCount: 0
      };
      existing.inboundMessagesCount += 1;
      byStationMap.set(dialog.stationId, existing);
    }

    const dialogIdsByStation = new Map<string, Set<string>>();
    for (const dialog of accessibleDialogs) {
      if (!dialogIdsByStation.has(dialog.stationId)) {
        dialogIdsByStation.set(dialog.stationId, new Set<string>());
      }
      dialogIdsByStation.get(dialog.stationId)?.add(dialog.id);
    }
    for (const [stationId, analytics] of byStationMap.entries()) {
      analytics.dialogsCount = dialogIdsByStation.get(stationId)?.size ?? 0;
      const metrics = allMetrics.filter((metric) => metric.stationId === stationId);
      analytics.averageFirstResponseMs = this.averageOf(metrics.map((metric) => metric.responseTimeMs));
      byStationMap.set(stationId, analytics);
    }

    const byTopic = this.countByEnum<SupportTopicAnalytics, SupportTopic>(
      inboundMessages,
      (message, counts) => {
        const topic = message.ai?.topic ?? accessibleByDialog.get(message.dialogId)?.ai?.topic;
        if (!topic) {
          return counts;
        }
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
        return counts;
      },
      (topic, messagesCount) => ({ topic, messagesCount }),
      Object.values(SupportTopic)
    );

    const byPriority = this.countByEnum<SupportPriorityAnalytics, SupportPriority>(
      inboundMessages,
      (message, counts) => {
        const priority =
          message.ai?.priority ?? accessibleByDialog.get(message.dialogId)?.ai?.priority;
        if (!priority) {
          return counts;
        }
        counts.set(priority, (counts.get(priority) ?? 0) + 1);
        return counts;
      },
      (priority, messagesCount) => ({ priority, messagesCount }),
      Object.values(SupportPriority)
    );

    const byConnector = this.countByEnum<SupportConnectorAnalytics, SupportConnectorRoute>(
      inboundMessages,
      (message, counts) => {
        counts.set(message.connector, (counts.get(message.connector) ?? 0) + 1);
        return counts;
      },
      (connector, messagesCount) => ({ connector, messagesCount }),
      Object.values(SupportConnectorRoute)
    );

    const byDialogMap = new Map<string, SupportDialogReactionAnalytics>();
    for (const metric of allMetrics) {
      const dialog = accessibleByDialog.get(metric.dialogId);
      if (!dialog) {
        continue;
      }
      const existing = byDialogMap.get(metric.dialogId) ?? {
        dialogId: metric.dialogId,
        stationId: dialog.stationId,
        stationName: dialog.stationName,
        clientId: dialog.clientId,
        primaryPhone: dialog.currentPhone,
        responseCount: 0
      };
      existing.responseCount += 1;
      existing.lastFirstResponseMs = metric.responseTimeMs;
      const total = (existing.averageFirstResponseMs ?? 0) * (existing.responseCount - 1);
      existing.averageFirstResponseMs = Math.round((total + metric.responseTimeMs) / existing.responseCount);
      byDialogMap.set(metric.dialogId, existing);
    }

    return {
      date: dayStart.toISOString().slice(0, 10),
      inboundMessagesCount: inboundMessages.length,
      outboundMessagesCount: outboundMessages.length,
      callsCount: inboundMessages.filter((message) => message.kind === SupportMessageKind.CALL).length,
      emailsCount: inboundMessages.filter((message) => message.kind === SupportMessageKind.EMAIL).length,
      unverifiedDialogsCount: accessibleDialogs.filter(
        (dialog) => dialog.authStatus !== SupportClientAuthStatus.VERIFIED
      ).length,
      averageFirstResponseMs: this.averageOf(allMetrics.map((metric) => metric.responseTimeMs)),
      byStation: Array.from(byStationMap.values()).sort((left, right) =>
        left.stationId.localeCompare(right.stationId)
      ),
      byTopic,
      byPriority,
      byConnector,
      byDialog: Array.from(byDialogMap.values()).sort((left, right) =>
        this.numberOrZero(right.lastFirstResponseMs) - this.numberOrZero(left.lastFirstResponseMs)
      )
    };
  }

  private listDialogsForClient(clientId: string): SupportDialog[] {
    return Array.from(this.dialogs.values())
      .filter((dialog) => dialog.clientId === clientId)
      .sort((left, right) => this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt));
  }

  private findClientByQuery(query: ResolveClientQuery): SupportClientProfile | null {
    const normalizedPhone = this.normalizePhone(query.phone);
    const normalizedEmail = this.normalizeEmail(query.email);
    const normalizedExternalUserId = this.normalizeIdentityValue(query.externalUserId);
    const normalizedExternalChatId = this.normalizeIdentityValue(query.externalChatId);
    const normalizedUsername = this.normalizeIdentityValue(query.username);
    const connector = query.connector;

    const matches = Array.from(this.clients.values()).filter((client) => {
      if (normalizedPhone && client.phones.includes(normalizedPhone)) {
        return true;
      }
      if (normalizedEmail && client.emails.includes(normalizedEmail)) {
        return true;
      }
      if (connector && normalizedExternalUserId) {
        return client.identities.some(
          (identity) => this.identityMatchesQuery(identity, connector, normalizedExternalUserId)
        );
      }
      if (connector && normalizedExternalChatId) {
        return client.identities.some(
          (identity) => this.identityMatchesQuery(identity, connector, undefined, normalizedExternalChatId)
        );
      }
      if (connector && normalizedUsername) {
        return client.identities.some(
          (identity) =>
            identity.connector === connector &&
            this.normalizeIdentityValue(identity.username) === normalizedUsername
        );
      }
      return false;
    });

    if (matches.length === 0) {
      return null;
    }
    matches.sort((left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt));
    return matches[0];
  }

  private resolveOrCreateClient(
    dto: NormalizedIngestSupportEventDto,
    normalizedPhone: string | undefined,
    normalizedEmail: string | undefined,
    createdAt: string
  ): SupportClientProfile {
    const resolvedDisplayName = this.resolveIncomingDisplayName(dto);
    const matchingIds = new Set<string>();

    const byPhone = normalizedPhone
      ? this.findClientByQuery({ phone: normalizedPhone })
      : null;
    const byEmail = normalizedEmail
      ? this.findClientByQuery({ email: normalizedEmail })
      : null;
    const byIdentity = this.findClientByQuery({
      connector: dto.connector,
      externalUserId: dto.externalUserId,
      externalChatId: dto.externalChatId
    });
    const byExternalUserId = dto.externalUserId
      ? this.findClientByQuery({
          connector: dto.connector,
          externalUserId: dto.externalUserId
        })
      : null;
    const byExternalChatId = dto.externalChatId
      ? this.findClientByQuery({
          connector: dto.connector,
          externalChatId: dto.externalChatId
        })
      : null;
    const byUsername = dto.username
      ? this.findClientByQuery({
          connector: dto.connector,
          username: dto.username
        })
      : null;

    [byPhone, byEmail, byIdentity, byExternalUserId, byExternalChatId, byUsername].forEach(
      (client) => {
        if (client) {
          matchingIds.add(client.id);
        }
      }
    );

    let client: SupportClientProfile;
    if (matchingIds.size === 0) {
      client = {
        id: randomUUID(),
        displayName: resolvedDisplayName,
        authStatus: normalizedPhone
          ? SupportClientAuthStatus.VERIFIED
          : SupportClientAuthStatus.UNVERIFIED,
        unverifiedTextAttempts: 0,
        primaryPhone: normalizedPhone,
        phones: normalizedPhone ? [normalizedPhone] : [],
        emails: normalizedEmail ? [normalizedEmail] : [],
        identities: [],
        currentStationId: undefined,
        currentStationName: undefined,
        createdAt,
        updatedAt: createdAt
      };
      this.clients.set(client.id, client);
    } else {
      client = this.mergeClients(Array.from(matchingIds.values()));
      client.displayName = resolvedDisplayName ?? client.displayName;
      client.updatedAt = createdAt;
    }

    client.unverifiedTextAttempts = client.unverifiedTextAttempts ?? 0;

    if (normalizedPhone) {
      client.authStatus = SupportClientAuthStatus.VERIFIED;
      client.unverifiedTextAttempts = 0;
      client.phones = this.mergeStrings(client.phones, [normalizedPhone]);
      client.primaryPhone = client.primaryPhone ?? normalizedPhone;
    }

    if (normalizedEmail) {
      client.emails = this.mergeStrings(client.emails, [normalizedEmail]);
    }

    const nextIdentity = this.buildIdentity(dto, createdAt);
    if (nextIdentity) {
      client.identities = this.upsertIdentity(client.identities, nextIdentity);
    }

    if (
      !resolvedDisplayName &&
      this.isReservedClientDisplayName(
        client.displayName,
        dto.selectedStationId ?? dto.stationId,
        dto.selectedStationName ?? dto.stationName,
        client.currentStationId,
        client.currentStationName
      )
    ) {
      client.displayName = undefined;
    }

    if (!client.displayName) {
      client.displayName = this.buildClientDisplayName(client, dto);
    }

    this.persistClient(client);
    this.collapseOpenDialogsForClient(client.id, dto.connector);
    return client;
  }

  private mergeClients(clientIds: string[]): SupportClientProfile {
    const sortedClients = clientIds
      .map((clientId) => this.clients.get(clientId))
      .filter((client): client is SupportClientProfile => Boolean(client))
      .sort((left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt));

    if (sortedClients.length === 0) {
      throw new NotFoundException('Support client not found');
    }
    if (sortedClients.length === 1) {
      return sortedClients[0];
    }

    const canonical = { ...sortedClients[0] };
    for (let index = 1; index < sortedClients.length; index += 1) {
      const current = sortedClients[index];
      canonical.displayName = canonical.displayName ?? current.displayName;
      canonical.primaryPhone = canonical.primaryPhone ?? current.primaryPhone;
      canonical.phones = this.mergeStrings(canonical.phones, current.phones);
      canonical.emails = this.mergeStrings(canonical.emails, current.emails);
      canonical.identities = this.upsertIdentities(canonical.identities, current.identities);
      canonical.currentStationId = canonical.currentStationId ?? current.currentStationId;
      canonical.currentStationName = canonical.currentStationName ?? current.currentStationName;
      canonical.unverifiedTextAttempts = Math.max(
        canonical.unverifiedTextAttempts ?? 0,
        current.unverifiedTextAttempts ?? 0
      );
      if (current.authStatus === SupportClientAuthStatus.VERIFIED) {
        canonical.authStatus = SupportClientAuthStatus.VERIFIED;
      }

      for (const dialog of this.dialogs.values()) {
        if (dialog.clientId !== current.id) {
          continue;
        }
        const updated: SupportDialog = {
          ...dialog,
          clientId: canonical.id,
          authStatus:
            canonical.authStatus === SupportClientAuthStatus.VERIFIED
              ? SupportClientAuthStatus.VERIFIED
              : dialog.authStatus,
          currentPhone: canonical.primaryPhone ?? dialog.currentPhone,
          phones: this.mergeStrings(dialog.phones, canonical.phones),
          emails: this.mergeStrings(dialog.emails, canonical.emails),
          updatedAt: new Date().toISOString()
        };
        this.dialogs.set(updated.id, updated);
        this.persistDialog(updated);
      }

      for (const [dialogId, dialogMessages] of this.messages.entries()) {
        const updatedMessages = dialogMessages.map((message) =>
          message.clientId === current.id ? { ...message, clientId: canonical.id } : message
        );
        this.messages.set(dialogId, updatedMessages);
        updatedMessages.forEach((message) => this.persistence.persistMessage(message));
      }

      for (const [commandId, command] of this.outbox.entries()) {
        if (command.clientId !== current.id) {
          continue;
        }
        const updatedCommand: SupportOutboxCommand = { ...command, clientId: canonical.id };
        this.outbox.set(commandId, updatedCommand);
        this.persistence.persistOutboxCommand(updatedCommand);
      }

      this.clients.delete(current.id);
      this.persistence.deleteClient(current.id);
    }

    canonical.updatedAt = new Date().toISOString();
    canonical.unverifiedTextAttempts = canonical.unverifiedTextAttempts ?? 0;
    this.clients.set(canonical.id, canonical);
    this.persistClient(canonical);
    this.collapseOpenDialogsForClient(canonical.id);
    return canonical;
  }

  private resolveDialog(
    client: SupportClientProfile,
    stationId: string,
    stationName: string,
    subject: string | undefined,
    connector: SupportConnectorRoute,
    explicitSelectedStationId: string | undefined,
    createdAt: string
  ): SupportDialog {
    const existing = this.collapseOpenDialogs(client.id, connector);
    const normalizedSubject =
      this.normalizeDialogSubject(subject) ?? this.buildDialogSubject(client, stationName);

    if (existing) {
      const hasResolvedStation = stationId !== SUPPORT_UNASSIGNED_STATION_ID;
      const shouldUpdateStation =
        Boolean(explicitSelectedStationId) ||
        (existing.stationId === SUPPORT_UNASSIGNED_STATION_ID && hasResolvedStation);

      if (shouldUpdateStation) {
        existing.stationId = stationId;
        existing.stationName = stationName;
        existing.accessStationIds = this.mergeStationAccessIds(existing.accessStationIds, [
          stationId
        ]);
      }
      existing.subject =
        this.normalizeDialogSubject(subject) ??
        this.normalizeDialogSubject(existing.subject) ??
        normalizedSubject;
      existing.authStatus = client.authStatus;
      existing.currentPhone = client.primaryPhone;
      existing.phones = [...client.phones];
      existing.emails = [...client.emails];
      existing.updatedAt = createdAt;
      this.persistDialog(existing);
      return existing;
    }

    const dialog: SupportDialog = {
      id: randomUUID(),
      clientId: client.id,
      stationId,
      stationName,
      accessStationIds: this.mergeStationAccessIds([], [stationId]),
      writeStationIds: [stationId],
      readOnlyStationIds: [],
      status: SupportDialogStatus.OPEN,
      authStatus: client.authStatus,
      currentPhone: client.primaryPhone,
      phones: [...client.phones],
      emails: [...client.emails],
      connectors: [],
      lastInboundConnector: undefined,
      lastReplyConnector: undefined,
      subject: normalizedSubject,
      unreadCount: 0,
      hasUnreadMessages: false,
      hasNewMessages: false,
      waitingForStaffSince: undefined,
      pendingClientMessageIds: [],
      responseTimeTotalMs: 0,
      responseCount: 0,
      averageFirstResponseMs: undefined,
      lastFirstResponseMs: undefined,
      lastMessageAt: undefined,
      lastRankingMessageAt: undefined,
      lastMessageText: undefined,
      lastMessageSenderRole: undefined,
      lastClientMessageAt: undefined,
      lastStaffMessageAt: undefined,
      ai: undefined,
      createdAt,
      updatedAt: createdAt
    };

    this.dialogs.set(dialog.id, dialog);
    this.messages.set(dialog.id, []);
    this.responseMetrics.set(dialog.id, []);
    this.persistDialog(dialog);
    return dialog;
  }

  private buildMessage(
    dto: NormalizedIngestSupportEventDto,
    context: {
      dialog: SupportDialog;
      client: SupportClientProfile;
      createdAt: string;
      direction: SupportMessageDirection;
      kind: SupportMessageKind;
      senderRole: SupportSenderRole;
      normalizedPhone?: string;
      normalizedEmail?: string;
    }
  ): SupportMessage {
    const text = String(dto.text ?? '').trim() || undefined;
    const ai = this.buildAiInsight(dto, text);
    const resolvedDisplayName = this.resolveIncomingDisplayName(dto);
    return {
      id: randomUUID(),
      dialogId: context.dialog.id,
      clientId: context.client.id,
      connector: dto.connector,
      direction: context.direction,
      kind: context.kind,
      text: this.buildMessageText(context.kind, text, context.normalizedPhone, context.normalizedEmail, dto),
      createdAt: context.createdAt,
      senderId: context.senderRole === 'SYSTEM' ? 'system' : dto.externalUserId?.trim() || context.client.id,
      senderRole: context.senderRole,
      senderName:
        context.senderRole === 'SYSTEM'
          ? 'Система'
          : resolvedDisplayName ?? context.client.displayName,
      externalUserId: this.normalizeIdentityValue(dto.externalUserId),
      externalChatId: this.normalizeIdentityValue(dto.externalChatId),
      externalMessageId: this.normalizeIdentityValue(dto.externalMessageId),
      phone: context.normalizedPhone,
      email: context.normalizedEmail,
      stationId: context.dialog.stationId,
      stationName: context.dialog.stationName,
      ai,
      meta: dto.meta
    };
  }

  private appendMessage(dialog: SupportDialog, message: SupportMessage): void {
    const existing = this.messages.get(dialog.id) ?? [];
    const messageTs = this.toTimestamp(message.createdAt);
    const currentLastMessageTs = this.toTimestamp(dialog.lastMessageAt);
    const currentLastRankingTs = this.toTimestamp(dialog.lastRankingMessageAt);
    const isSystemMessage = this.isSystemDialogMessage(message);

    if (!isSystemMessage) {
      if (existing.length === 0) {
        existing.push(message);
      } else {
        const lastMessage = existing[existing.length - 1];
        const lastMessageTs = this.toTimestamp(lastMessage.createdAt);

        if (messageTs >= lastMessageTs) {
          existing.push(message);
        } else {
          const insertIndex = this.findMessageInsertIndex(existing, messageTs);
          existing.splice(insertIndex, 0, message);
        }
      }
      this.messages.set(dialog.id, existing);
    }

    if (messageTs >= currentLastMessageTs) {
      dialog.lastMessageAt = message.createdAt;
      dialog.updatedAt = message.createdAt;
    }

    if (!isSystemMessage && messageTs >= currentLastRankingTs) {
      dialog.lastRankingMessageAt = message.createdAt;
      dialog.lastMessageText = this.formatDialogPreview(message);
      dialog.lastMessageSenderRole = message.senderRole;
    } else if (messageTs >= currentLastMessageTs && currentLastRankingTs <= 0) {
      dialog.lastMessageText = this.formatDialogPreview(message);
      dialog.lastMessageSenderRole = message.senderRole;
    }

    if (
      !isSystemMessage &&
      (dialog.lastMessageText === undefined || dialog.lastMessageSenderRole === undefined)
    ) {
      this.refreshDialogPreviewFromMessages(dialog, existing);
    }

    if (isSystemMessage) {
      this.persistence.persistServiceMessage(message);
      return;
    }
    this.persistence.persistMessage(message);
  }

  private findDuplicateInboundMessage(
    dialogId: string,
    message: SupportMessage
  ): SupportMessage | undefined {
    const existing = this.messages.get(dialogId) ?? [];
    if (existing.length === 0) {
      return undefined;
    }

    const incomingTs = this.toTimestamp(message.createdAt);
    const incomingText = String(message.text ?? '').trim();
    const incomingExternalUserId = this.normalizeIdentityValue(message.externalUserId);
    const incomingExternalChatId = this.normalizeIdentityValue(message.externalChatId);
    const incomingPhone = this.normalizePhone(message.phone);

    const recentMessages = existing.slice(-30).reverse();
    for (const candidate of recentMessages) {
      if (candidate.direction !== SupportMessageDirection.INBOUND) {
        continue;
      }
      if (candidate.connector !== message.connector || candidate.kind !== message.kind) {
        continue;
      }

      if (message.externalMessageId && candidate.externalMessageId) {
        if (message.externalMessageId === candidate.externalMessageId) {
          return candidate;
        }
        continue;
      }

      if (message.externalMessageId || candidate.externalMessageId) {
        continue;
      }

      const candidateTs = this.toTimestamp(candidate.createdAt);
      if (Math.abs(candidateTs - incomingTs) > 5000) {
        continue;
      }

      if (String(candidate.text ?? '').trim() !== incomingText) {
        continue;
      }

      const candidateExternalUserId = this.normalizeIdentityValue(candidate.externalUserId);
      const candidateExternalChatId = this.normalizeIdentityValue(candidate.externalChatId);
      const candidatePhone = this.normalizePhone(candidate.phone);

      if (
        candidateExternalUserId !== incomingExternalUserId ||
        candidateExternalChatId !== incomingExternalChatId ||
        candidatePhone !== incomingPhone
      ) {
        continue;
      }

      return candidate;
    }

    return undefined;
  }

  private findMessageInsertIndex(messages: SupportMessage[], createdAtTs: number): number {
    let low = 0;
    let high = messages.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const midTs = this.toTimestamp(messages[mid].createdAt);
      if (midTs <= createdAtTs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  private createResponseMetric(
    dialog: SupportDialog,
    respondedByUserId: string,
    connector: SupportConnectorRoute,
    respondedAt: string
  ): SupportResponseMetric | null {
    if (!dialog.waitingForStaffSince) {
      return null;
    }
    return {
      id: randomUUID(),
      dialogId: dialog.id,
      clientId: dialog.clientId,
      stationId: dialog.stationId,
      connector,
      startedAt: dialog.waitingForStaffSince,
      respondedAt,
      respondedByUserId,
      responseTimeMs: Math.max(
        0,
        this.toTimestamp(respondedAt) - this.toTimestamp(dialog.waitingForStaffSince)
      )
    };
  }

  private storeResponseMetric(metric: SupportResponseMetric): void {
    const existing = this.responseMetrics.get(metric.dialogId) ?? [];
    existing.push(metric);
    existing.sort(
      (left, right) => this.toTimestamp(left.startedAt) - this.toTimestamp(right.startedAt)
    );
    this.responseMetrics.set(metric.dialogId, existing);
    this.persistence.persistResponseMetric(metric);
  }

  private createOutboxCommand(
    dialog: SupportDialog,
    message: SupportMessage,
    connector: SupportConnectorRoute
  ): SupportOutboxCommand | undefined {
    const client = this.clients.get(dialog.clientId);
    if (!client) {
      return undefined;
    }

    const identity = this.pickIdentityForConnector(client, connector);
    if (
      connector !== SupportConnectorRoute.EMAIL &&
      connector !== SupportConnectorRoute.LK_WEB_MESSENGER &&
      !identity
    ) {
      return undefined;
    }

    if (connector === SupportConnectorRoute.EMAIL && client.emails.length === 0) {
      return undefined;
    }

    const outboundPayload = this.buildOutboundClientPayload(message, connector);

    return {
      id: randomUUID(),
      dialogId: dialog.id,
      clientId: dialog.clientId,
      connector,
      text: outboundPayload.text,
      format: outboundPayload.format,
      createdAt: message.createdAt,
      status: SupportOutboxStatus.PENDING,
      targetExternalUserId: identity?.externalUserId,
      targetExternalChatId: identity?.externalChatId,
      targetEmail: connector === SupportConnectorRoute.EMAIL ? client.emails[0] : undefined,
      targetPhone: client.primaryPhone,
      stationId: dialog.stationId,
      stationName: dialog.stationName,
      attempts: 0,
      meta: {
        dialogId: dialog.id,
        clientDisplayName: client.displayName,
        phones: client.phones,
        formattedText: outboundPayload.formattedText
      }
    };
  }

  private buildOutboundClientPayload(
    message: SupportMessage,
    connector: SupportConnectorRoute
  ): { text: string; format?: 'markdown'; formattedText?: string } {
    const text = this.normalizeClientOutboundText(message, connector);
    if (!text) {
      return { text: '' };
    }

    if (
      connector === SupportConnectorRoute.MAX_BOT &&
      message.senderRole !== 'SYSTEM'
    ) {
      const sender = String(message.senderName ?? '').trim();
      const senderLinkUrl = this.readSenderLinkUrl(message);
      if (sender) {
        const escapedSender = this.escapeMarkdown(sender);
        const formattedSender = senderLinkUrl
          ? `[**${escapedSender}**](${this.escapeMarkdownUrl(senderLinkUrl)})`
          : `**${escapedSender}**`;
        return {
          text: `${sender}:\n${text}`,
          format: 'markdown',
          formattedText: `${formattedSender}:\n${text}`
        };
      }
    }

    return { text };
  }

  private normalizeClientOutboundText(
    message: SupportMessage,
    connector: SupportConnectorRoute
  ): string {
    const text = String(message.text ?? '').trim();
    if (!text) {
      return '';
    }

    if (
      connector === SupportConnectorRoute.MAX_BOT &&
      message.senderRole === 'SYSTEM'
    ) {
      const stripped = text.replace(
        /^Служебное\s+сообщение(?:\s+Viva\s*CRM)?(?:\s*\([^)]*\))?\s*[:\-—]\s*/i,
        '',
      ).trim();
      return stripped || text;
    }

    return text;
  }

  private escapeMarkdown(value: string): string {
    return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, '\\$1');
  }

  private escapeMarkdownUrl(value: string): string {
    return String(value).replace(/([()\\])/g, '\\$1');
  }

  private readSenderLinkUrl(message: SupportMessage): string | undefined {
    const rawValue =
      message.meta && typeof message.meta['senderMaxPublicUrl'] === 'string'
        ? message.meta['senderMaxPublicUrl']
        : undefined;
    const normalized = String(rawValue ?? '').trim();
    if (!normalized) {
      return undefined;
    }
    if (!/^https?:\/\//i.test(normalized)) {
      return undefined;
    }
    return normalized;
  }

  private pickIdentityForConnector(
    client: SupportClientProfile,
    connector: SupportConnectorRoute
  ): SupportClientIdentity | undefined {
    const identities = client.identities
      .filter((identity) => identity.connector === connector)
      .sort((left, right) => this.toTimestamp(right.lastSeenAt) - this.toTimestamp(left.lastSeenAt));
    return identities[0];
  }

  private identityMatchesQuery(
    identity: SupportClientIdentity,
    connector: SupportConnectorRoute,
    externalUserId?: string,
    externalChatId?: string
  ): boolean {
    if (identity.connector !== connector) {
      return false;
    }

    const identityKeys = this.getIdentityKeys(identity);
    if (externalUserId && identityKeys.includes(externalUserId)) {
      return true;
    }
    if (externalChatId && identityKeys.includes(externalChatId)) {
      return true;
    }
    return false;
  }

  private getIdentityKeys(identity: SupportClientIdentity): string[] {
    return this.mergeStrings(
      [],
      [
        this.normalizeIdentityValue(identity.externalUserId),
        this.normalizeIdentityValue(identity.externalChatId)
      ].filter((value): value is string => Boolean(value))
    );
  }

  private identitiesOverlap(
    left: SupportClientIdentity,
    right: SupportClientIdentity
  ): boolean {
    if (left.connector !== right.connector) {
      return false;
    }

    const rightKeys = new Set(this.getIdentityKeys(right));
    return this.getIdentityKeys(left).some((value) => rightKeys.has(value));
  }

  private areClientsMergeable(
    left: SupportClientProfile,
    right: SupportClientProfile
  ): boolean {
    if (left.id === right.id) {
      return false;
    }

    if (left.phones.some((phone) => right.phones.includes(phone))) {
      return true;
    }
    if (left.emails.some((email) => right.emails.includes(email))) {
      return true;
    }

    return left.identities.some((leftIdentity) =>
      right.identities.some((rightIdentity) => this.identitiesOverlap(leftIdentity, rightIdentity))
    );
  }

  private reconcileDuplicateClients(): void {
    let merged = true;
    while (merged) {
      merged = false;
      const clients = Array.from(this.clients.values()).sort(
        (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
      );
      for (let leftIndex = 0; leftIndex < clients.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < clients.length; rightIndex += 1) {
          if (!this.areClientsMergeable(clients[leftIndex], clients[rightIndex])) {
            continue;
          }
          this.mergeClients([clients[leftIndex].id, clients[rightIndex].id]);
          merged = true;
          break;
        }
        if (merged) {
          break;
        }
      }
    }
  }

  private reconcileDuplicateDialogs(): void {
    const clientIds = Array.from(this.dialogs.values())
      .filter((dialog) => dialog.status === SupportDialogStatus.OPEN)
      .map((dialog) => dialog.clientId);
    for (const clientId of Array.from(new Set(clientIds))) {
      if (!clientId) {
        continue;
      }
      this.collapseOpenDialogsForClient(clientId);
    }
  }

  private mergeDialogInto(target: SupportDialog, source: SupportDialog): void {
    if (target.id === source.id) {
      return;
    }

    const movedMessages = this.messages.get(source.id) ?? [];
    const targetMessages = this.messages.get(target.id) ?? [];
    const mergedMessages = [...targetMessages];
    for (const message of movedMessages) {
      const updatedMessage: SupportMessage = { ...message, dialogId: target.id };
      mergedMessages.push(updatedMessage);
      this.persistence.persistMessage(updatedMessage);
    }
    mergedMessages.sort(
      (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
    );
    this.messages.set(target.id, mergedMessages);
    this.messages.delete(source.id);

    const movedMetrics = this.responseMetrics.get(source.id) ?? [];
    const targetMetrics = this.responseMetrics.get(target.id) ?? [];
    for (const metric of movedMetrics) {
      const updatedMetric: SupportResponseMetric = { ...metric, dialogId: target.id };
      targetMetrics.push(updatedMetric);
      this.persistence.persistResponseMetric(updatedMetric);
    }
    targetMetrics.sort(
      (left, right) => this.toTimestamp(left.startedAt) - this.toTimestamp(right.startedAt)
    );
    this.responseMetrics.set(target.id, targetMetrics);
    this.responseMetrics.delete(source.id);

    for (const [commandId, command] of this.outbox.entries()) {
      if (command.dialogId !== source.id) {
        continue;
      }
      const updatedCommand: SupportOutboxCommand = { ...command, dialogId: target.id };
      this.outbox.set(commandId, updatedCommand);
      this.persistence.persistOutboxCommand(updatedCommand);
    }

    target.unreadCount += source.unreadCount;
    target.pendingClientMessageIds = this.mergeIds(
      target.pendingClientMessageIds,
      source.pendingClientMessageIds
    );
    target.waitingForStaffSince =
      this.toTimestamp(target.waitingForStaffSince) > 0 &&
      this.toTimestamp(source.waitingForStaffSince) > 0
        ? new Date(
            Math.min(
              this.toTimestamp(target.waitingForStaffSince),
              this.toTimestamp(source.waitingForStaffSince)
            )
          ).toISOString()
        : target.waitingForStaffSince ?? source.waitingForStaffSince;
    target.responseTimeTotalMs += source.responseTimeTotalMs;
    target.responseCount += source.responseCount;
    target.averageFirstResponseMs =
      target.responseCount > 0
        ? Math.round(target.responseTimeTotalMs / target.responseCount)
        : undefined;
    target.lastFirstResponseMs = target.lastFirstResponseMs ?? source.lastFirstResponseMs;
    target.lastMessageAt = this.maxDate([target.lastMessageAt, source.lastMessageAt]);
    target.lastClientMessageAt = this.maxDate([
      target.lastClientMessageAt,
      source.lastClientMessageAt
    ]);
    target.lastStaffMessageAt = this.maxDate([
      target.lastStaffMessageAt,
      source.lastStaffMessageAt
    ]);
    target.connectors = this.mergeConnectors(target.connectors, source.connectors);
    target.accessStationIds = this.mergeStationAccessIds(target.accessStationIds, [
      target.stationId,
      source.stationId,
      ...(source.accessStationIds ?? [])
    ]);
    target.phones = this.mergeStrings(target.phones, source.phones);
    target.emails = this.mergeStrings(target.emails, source.emails);
    target.ai = target.ai ?? source.ai;
    target.updatedAt = this.maxDate([target.updatedAt, source.updatedAt]) ?? target.updatedAt;
    this.refreshDialogPreviewFromMessages(target, mergedMessages);

    this.persistDialog(target);
    this.dialogs.delete(source.id);
    this.persistence.deleteDialog(source.id);
  }

  private toDialogSummary(
    dialog: SupportDialog,
    connector?: SupportConnectorRoute,
    user?: RequestUser
  ): SupportDialogSummary {
    this.syncDialogMarkers(dialog);
    const client = this.clients.get(dialog.clientId);
    let lastRankingMessageAt = dialog.lastRankingMessageAt;
    let lastMessageText = dialog.lastMessageText;
    let lastMessageSenderRole = dialog.lastMessageSenderRole;
    const canWriteForUser = user ? this.isDialogWritableForUser(dialog, user) : true;

    if (lastMessageText === undefined || lastMessageSenderRole === undefined) {
      const dialogMessages = this.messages.get(dialog.id) ?? [];
      const lastMessage =
        dialogMessages.length > 0 ? dialogMessages[dialogMessages.length - 1] : undefined;
      const lastRankingMessage = this.findLastRankingMessage(dialogMessages);
      const previewMessage = lastRankingMessage ?? lastMessage;
      lastRankingMessageAt = lastRankingMessage?.createdAt;
      lastMessageText = this.formatDialogPreview(previewMessage);
      lastMessageSenderRole = previewMessage?.senderRole;
    }

    return {
      dialogId: dialog.id,
      connector: connector ?? dialog.lastInboundConnector ?? dialog.connectors[0] ?? SupportConnectorRoute.MAX_BOT,
      stationId: dialog.stationId,
      stationName: dialog.stationName,
      accessStationIds: this.getDialogAccessStationIds(dialog),
      writeStationIds: [...dialog.writeStationIds],
      readOnlyStationIds: [...dialog.readOnlyStationIds],
      isActiveForUser: canWriteForUser,
      isReadOnlyForUser: !canWriteForUser,
      currentStationId: client?.currentStationId,
      currentStationName: client?.currentStationName,
      clientId: dialog.clientId,
      clientDisplayName: this.buildSummaryClientDisplayName(client, dialog),
      authStatus: dialog.authStatus,
      primaryPhone: dialog.currentPhone,
      phones: [...dialog.phones],
      emails: [...dialog.emails],
      subject: this.buildSummaryDialogSubject(client, dialog),
      status: dialog.status,
      unreadCount: dialog.unreadCount,
      hasUnreadMessages: dialog.hasUnreadMessages,
      hasNewMessages: dialog.hasNewMessages,
      waitingForStaffSince: dialog.waitingForStaffSince,
      pendingClientMessagesCount: dialog.pendingClientMessageIds.length,
      averageFirstResponseMs: dialog.averageFirstResponseMs,
      lastFirstResponseMs: dialog.lastFirstResponseMs,
      lastMessageAt: dialog.lastMessageAt,
      lastRankingMessageAt,
      lastMessageText,
      lastMessageSenderRole,
      lastInboundConnector: dialog.lastInboundConnector,
      ai: dialog.ai
    };
  }

  private compareDialogSummaryRank(
    left: SupportDialogSummary,
    right: SupportDialogSummary
  ): number {
    const leftUnread = Number(left.unreadCount ?? 0);
    const rightUnread = Number(right.unreadCount ?? 0);
    if (leftUnread !== rightUnread) {
      return rightUnread - leftUnread;
    }

    const leftPending = Number(left.pendingClientMessagesCount ?? 0);
    const rightPending = Number(right.pendingClientMessagesCount ?? 0);
    if (leftPending !== rightPending) {
      return rightPending - leftPending;
    }

    const byRankingMessage =
      this.resolveDialogSummaryRankTimestamp(right) - this.resolveDialogSummaryRankTimestamp(left);
    if (byRankingMessage !== 0) {
      return byRankingMessage;
    }

    const byLastMessage = this.toTimestamp(right.lastMessageAt) - this.toTimestamp(left.lastMessageAt);
    if (byLastMessage !== 0) {
      return byLastMessage;
    }

    return left.dialogId.localeCompare(right.dialogId);
  }

  private resolveDialogSummaryRankTimestamp(dialog: SupportDialogSummary): number {
    const rankingTs = this.toTimestamp(dialog.lastRankingMessageAt);
    if (rankingTs > 0) {
      return rankingTs;
    }

    if (this.isSystemSenderRole(dialog.lastMessageSenderRole)) {
      return 0;
    }

    return this.toTimestamp(dialog.lastMessageAt);
  }

  private isSystemSenderRole(role?: SupportSenderRole): boolean {
    return role === 'SYSTEM';
  }

  private findLastRankingMessage(messages: SupportMessage[]): SupportMessage | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      if (!this.isSystemDialogMessage(message)) {
        return message;
      }
    }
    return undefined;
  }

  private isSystemDialogMessage(message: SupportMessage): boolean {
    return (
      message.direction === SupportMessageDirection.SYSTEM ||
      message.senderRole === 'SYSTEM' ||
      message.kind === SupportMessageKind.SYSTEM
    );
  }

  private formatDialogPreview(message?: SupportMessage): string | undefined {
    if (!message) {
      return undefined;
    }

    const text = String(message.text ?? '').trim();
    if (text) {
      return text;
    }

    switch (message.kind) {
      case SupportMessageKind.CONTACT:
        return message.phone ? `Контакт: ${message.phone}` : 'Передан контакт';
      case SupportMessageKind.STATION_SELECTION:
        return message.stationName || message.stationId
          ? `Станция: ${message.stationName ?? message.stationId}`
          : 'Выбрана станция';
      case SupportMessageKind.EMAIL:
        return message.email ? `Email: ${message.email}` : 'Email-сообщение';
      case SupportMessageKind.CALL:
        return 'Звонок';
      case SupportMessageKind.MEDIA:
        return 'Медиа';
      case SupportMessageKind.COMMAND:
        return 'Команда';
      case SupportMessageKind.SYSTEM:
        return 'Системное событие';
      default:
        return undefined;
    }
  }

  private normalizeLoadedClient(client: SupportClientProfile): SupportClientProfile {
    return {
      ...client,
      authStatus: this.normalizeLoadedAuthStatus(client.authStatus),
      unverifiedTextAttempts: client.unverifiedTextAttempts ?? 0,
      phones: Array.isArray(client.phones) ? client.phones : [],
      emails: Array.isArray(client.emails) ? client.emails : [],
      identities: Array.isArray(client.identities) ? client.identities : []
    };
  }

  private normalizeLoadedDialog(dialog: SupportDialog): SupportDialog {
    const rawDialog = dialog as unknown as Record<string, unknown>;
    const legacyChannels = this.readStringArray(rawDialog['channels']);
    const legacyPrimaryPhone = this.normalizePhone(this.readStringValue(rawDialog['primaryPhone']));
    const legacyPhones = this.readStringArray(rawDialog['phoneNumbers']).map((phone) =>
      this.normalizePhone(phone)
    );

    const normalizedConnectors = this.mergeConnectors(
      [],
      [
        dialog.lastInboundConnector,
        dialog.lastReplyConnector,
        ...legacyChannels,
        this.readStringValue(rawDialog['lastInboundChannel']),
        this.readStringValue(rawDialog['lastOutboundChannel']),
        this.readStringValue(rawDialog['lastChannel']),
        ...(dialog.connectors ?? [])
      ]
        .map((connector) => this.normalizeLoadedConnector(connector))
        .filter((connector): connector is SupportConnectorRoute => Boolean(connector))
    );
    const fallbackConnector = normalizedConnectors[0] ?? SupportConnectorRoute.LK_WEB_MESSENGER;
    const resolvedCurrentPhone = dialog.currentPhone ?? legacyPrimaryPhone;
    const resolvedPhones = this.mergeStrings(
      Array.isArray(dialog.phones) ? dialog.phones : [],
      [resolvedCurrentPhone, ...legacyPhones]
        .filter((phone): phone is string => Boolean(phone))
    );
    const resolvedEmails = this.mergeStrings(
      Array.isArray(dialog.emails) ? dialog.emails : [],
      this.readStringArray(rawDialog['emails'])
        .map((email) => this.normalizeEmail(email))
        .filter((email): email is string => Boolean(email))
    );
    const hasStoredUnreadCount =
      Object.prototype.hasOwnProperty.call(rawDialog, 'unreadCount') ||
      Object.prototype.hasOwnProperty.call(rawDialog, 'unreadClientMessages');
    const parsedUnreadCount = Number(
      dialog.unreadCount ?? rawDialog['unreadClientMessages']
    );
    const shouldRebuildUnreadCount =
      !hasStoredUnreadCount || !Number.isFinite(parsedUnreadCount);
    if (shouldRebuildUnreadCount) {
      this.dialogsNeedingUnreadRebuild.add(dialog.id);
    } else {
      this.dialogsNeedingUnreadRebuild.delete(dialog.id);
    }
    const resolvedUnreadCount = shouldRebuildUnreadCount
      ? 0
      : Math.max(0, parsedUnreadCount);
    const resolvedSubject =
      this.normalizeDialogSubject(dialog.subject) ??
      this.normalizeDialogSubject(this.readStringValue(rawDialog['displayName']));
    const resolvedLastRankingMessageAt =
      this.readStringValue(rawDialog['lastRankingMessageAt']) ?? dialog.lastRankingMessageAt;
    const resolvedLastMessageText =
      this.readStringValue(rawDialog['lastMessageText']) ?? dialog.lastMessageText;
    const resolvedLastMessageSenderRole =
      this.readStringValue(rawDialog['lastMessageSenderRole']) ?? dialog.lastMessageSenderRole;
    const resolvedPendingClientMessageIds = Array.isArray(dialog.pendingClientMessageIds)
      ? dialog.pendingClientMessageIds
      : [];
    const normalizedAccessStationIds = this.getDialogAccessStationIds(dialog);
    const writeStationIds = this.resolveDialogWriteStationIds(dialog);
    const readOnlyStationIds = this.resolveDialogReadOnlyStationIds(
      normalizedAccessStationIds,
      writeStationIds
    );

    return {
      ...dialog,
      status:
        dialog.status === SupportDialogStatus.CLOSED
          ? SupportDialogStatus.CLOSED
          : SupportDialogStatus.OPEN,
      authStatus: this.normalizeLoadedAuthStatus(dialog.authStatus),
      connectors: normalizedConnectors.length > 0 ? normalizedConnectors : [fallbackConnector],
      lastInboundConnector:
        this.normalizeLoadedConnector(dialog.lastInboundConnector) ?? fallbackConnector,
      lastReplyConnector:
        this.normalizeLoadedConnector(dialog.lastReplyConnector) ?? dialog.lastReplyConnector,
      currentPhone: resolvedCurrentPhone,
      phones: resolvedPhones,
      emails: resolvedEmails,
      subject: resolvedSubject,
      pendingClientMessageIds: resolvedPendingClientMessageIds,
      unreadCount: resolvedUnreadCount,
      hasUnreadMessages: resolvedUnreadCount > 0,
      hasNewMessages: resolvedPendingClientMessageIds.length > 0,
      lastRankingMessageAt: resolvedLastRankingMessageAt,
      lastMessageText: resolvedLastMessageText,
      lastMessageSenderRole:
        resolvedLastMessageSenderRole === 'SYSTEM' ||
        Object.values(Role).includes(resolvedLastMessageSenderRole as Role)
          ? (resolvedLastMessageSenderRole as SupportSenderRole)
          : undefined,
      accessStationIds: normalizedAccessStationIds,
      writeStationIds,
      readOnlyStationIds
    };
  }

  private rebuildDialogsFromLoadedMessages(): void {
    for (const dialog of this.dialogs.values()) {
      const dialogMessages = this.messages.get(dialog.id) ?? [];
      if (dialogMessages.length === 0) {
        continue;
      }

      dialogMessages.sort(
        (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
      );
      this.messages.set(dialog.id, dialogMessages);

      const lastMessage = dialogMessages[dialogMessages.length - 1];
      const lastInbound = [...dialogMessages]
        .reverse()
        .find((message) => message.direction === SupportMessageDirection.INBOUND);
      const lastOutbound = [...dialogMessages]
        .reverse()
        .find((message) => message.direction === SupportMessageDirection.OUTBOUND);

      dialog.connectors = this.mergeConnectors(
        dialog.connectors,
        dialogMessages.map((message) => message.connector)
      );
      dialog.lastInboundConnector =
        lastInbound?.connector ??
        dialog.lastInboundConnector ??
        dialog.connectors[0] ??
        SupportConnectorRoute.LK_WEB_MESSENGER;
      dialog.lastReplyConnector =
        dialog.lastReplyConnector ??
        lastOutbound?.connector ??
        dialog.connectors[0];
      dialog.lastMessageAt = lastMessage.createdAt;
      dialog.lastClientMessageAt = lastInbound?.createdAt ?? dialog.lastClientMessageAt;
      dialog.lastStaffMessageAt = lastOutbound?.createdAt ?? dialog.lastStaffMessageAt;
      dialog.updatedAt = this.maxDate([dialog.updatedAt, lastMessage.createdAt]) ?? dialog.updatedAt;
      this.refreshDialogPreviewFromMessages(dialog, dialogMessages);
      if (this.dialogsNeedingUnreadRebuild.has(dialog.id)) {
        dialog.unreadCount = dialogMessages.filter(
          (message) =>
            message.direction === SupportMessageDirection.INBOUND &&
            this.isActionableClientMessage(message)
        ).length;
        this.dialogsNeedingUnreadRebuild.delete(dialog.id);
        this.persistDialog(dialog);
      }

      const stationIdsFromMessages = dialogMessages.map((message) => message.stationId);
      dialog.accessStationIds = this.mergeStationAccessIds(dialog.accessStationIds, [
        dialog.stationId,
        ...stationIdsFromMessages
      ]);
      const client = this.clients.get(dialog.clientId);
      if (client) {
        dialog.authStatus = client.authStatus;
        dialog.currentPhone = client.primaryPhone ?? dialog.currentPhone;
        dialog.phones = this.mergeStrings(dialog.phones, client.phones);
        dialog.emails = this.mergeStrings(dialog.emails, client.emails);
        dialog.subject =
          this.normalizeDialogSubject(dialog.subject) ??
          this.selectDialogTitleCandidate(
            undefined,
            client.displayName,
            client.primaryPhone,
              client.emails[0]
          );
      }

      this.syncDialogMarkers(dialog);
      this.dialogs.set(dialog.id, dialog);
    }
  }

  private ensureClientAndDialogFromMessage(
    message: SupportMessage,
    rawMessage: Record<string, unknown>
  ): void {
    const rawClientSnapshot = this.readRecord(rawMessage['clientSnapshot']);
    const snapshotDisplayName = this.readStringValue(rawClientSnapshot?.['displayName']);
    const snapshotPhone = this.normalizePhone(this.readStringValue(rawClientSnapshot?.['primaryPhone']));
    const snapshotEmail = this.normalizeEmail(this.readStringValue(rawClientSnapshot?.['primaryEmail']));
    const rawAuthStatus = rawMessage['authStatus'] ?? rawClientSnapshot?.['authStatus'];
    const authStatus = this.normalizeLoadedAuthStatus(rawAuthStatus);

    const current = this.clients.get(message.clientId);
    const identity: SupportClientIdentity | undefined =
      message.externalUserId || message.externalChatId
        ? {
            connector: message.connector,
            externalUserId: message.externalUserId,
            externalChatId: message.externalChatId,
            externalThreadId: this.readStringValue(rawMessage['externalThreadId']),
            username: this.readStringValue(rawMessage['username']),
            displayName: message.senderName ?? snapshotDisplayName,
            linkedAt: message.createdAt,
            lastSeenAt: message.createdAt
          }
        : undefined;

    if (!current) {
      const client: SupportClientProfile = {
        id: message.clientId,
        displayName:
          snapshotDisplayName ??
          message.senderName ??
          message.externalUserId ??
          message.externalChatId ??
          `Клиент ${message.clientId.slice(0, 8)}`,
        authStatus,
        unverifiedTextAttempts: 0,
        primaryPhone: snapshotPhone ?? message.phone,
        phones: this.mergeStrings([], [snapshotPhone, message.phone].filter(Boolean) as string[]),
        emails: this.mergeStrings([], [snapshotEmail, message.email].filter(Boolean) as string[]),
        identities: identity ? [identity] : [],
        currentStationId: message.stationId,
        currentStationName: message.stationName,
        createdAt: message.createdAt,
        updatedAt: message.createdAt
      };
      this.clients.set(client.id, client);
    } else {
      current.authStatus =
        current.authStatus === SupportClientAuthStatus.VERIFIED || authStatus === SupportClientAuthStatus.VERIFIED
          ? SupportClientAuthStatus.VERIFIED
          : SupportClientAuthStatus.UNVERIFIED;
      current.displayName = current.displayName ?? snapshotDisplayName ?? message.senderName;
      current.primaryPhone = current.primaryPhone ?? snapshotPhone ?? message.phone;
      current.phones = this.mergeStrings(
        current.phones,
        [snapshotPhone, message.phone].filter(Boolean) as string[]
      );
      current.emails = this.mergeStrings(
        current.emails,
        [snapshotEmail, message.email].filter(Boolean) as string[]
      );
      if (identity) {
        current.identities = this.upsertIdentity(current.identities, identity);
      }
      current.currentStationId = current.currentStationId ?? message.stationId;
      current.currentStationName = current.currentStationName ?? message.stationName;
      current.updatedAt = this.maxDate([current.updatedAt, message.createdAt]) ?? current.updatedAt;
      this.clients.set(current.id, current);
    }

    const existingDialog = this.dialogs.get(message.dialogId);
    if (!existingDialog) {
      const stationId = this.normalizeStationId(message.stationId) ?? SUPPORT_UNASSIGNED_STATION_ID;
      const stationName = this.resolveStationName(
        message.stationName,
        undefined,
        stationId
      );
      const createdDialog: SupportDialog = {
        id: message.dialogId,
        clientId: message.clientId,
        stationId,
        stationName,
        accessStationIds: this.mergeStationAccessIds([], [stationId]),
        writeStationIds: [stationId],
        readOnlyStationIds: [],
        status: SupportDialogStatus.OPEN,
        authStatus,
        currentPhone: message.phone,
        phones: this.mergeStrings([], [message.phone].filter(Boolean) as string[]),
        emails: this.mergeStrings([], [message.email].filter(Boolean) as string[]),
        connectors: [message.connector],
        lastInboundConnector:
          message.direction === SupportMessageDirection.INBOUND ? message.connector : undefined,
        lastReplyConnector:
          message.direction === SupportMessageDirection.OUTBOUND ? message.connector : undefined,
        subject: this.selectDialogTitleCandidate(undefined, snapshotDisplayName, message.phone),
        unreadCount:
          message.direction === SupportMessageDirection.INBOUND &&
          this.isActionableClientMessage(message)
            ? 1
            : 0,
        hasUnreadMessages:
          message.direction === SupportMessageDirection.INBOUND &&
          this.isActionableClientMessage(message),
        hasNewMessages:
          message.direction === SupportMessageDirection.INBOUND &&
          this.isActionableClientMessage(message),
        waitingForStaffSince:
          message.direction === SupportMessageDirection.INBOUND &&
          this.isActionableClientMessage(message)
            ? message.createdAt
            : undefined,
        pendingClientMessageIds:
          message.direction === SupportMessageDirection.INBOUND &&
          this.isActionableClientMessage(message)
            ? [message.id]
            : [],
        responseTimeTotalMs: 0,
        responseCount: 0,
        averageFirstResponseMs: undefined,
        lastFirstResponseMs: undefined,
        lastMessageAt: message.createdAt,
        lastRankingMessageAt: this.isSystemDialogMessage(message) ? undefined : message.createdAt,
        lastMessageText: this.formatDialogPreview(message),
        lastMessageSenderRole: message.senderRole,
        lastClientMessageAt:
          message.direction === SupportMessageDirection.INBOUND ? message.createdAt : undefined,
        lastStaffMessageAt:
          message.direction === SupportMessageDirection.OUTBOUND ? message.createdAt : undefined,
        ai: message.ai,
        createdAt: message.createdAt,
        updatedAt: message.createdAt
      };
      this.dialogs.set(createdDialog.id, createdDialog);
      this.messages.set(createdDialog.id, this.messages.get(createdDialog.id) ?? []);
      this.responseMetrics.set(createdDialog.id, this.responseMetrics.get(createdDialog.id) ?? []);
      return;
    }

    existingDialog.connectors = this.mergeConnectors(existingDialog.connectors, [message.connector]);
    if (
      message.direction === SupportMessageDirection.INBOUND &&
      !existingDialog.lastInboundConnector
    ) {
      existingDialog.lastInboundConnector = message.connector;
    }
    if (
      message.direction === SupportMessageDirection.OUTBOUND &&
      !existingDialog.lastReplyConnector
    ) {
      existingDialog.lastReplyConnector = message.connector;
    }
    const normalizedExistingStationId = this.normalizeStationId(existingDialog.stationId);
    const normalizedMessageStationId = this.normalizeStationId(message.stationId);
    existingDialog.stationId =
      normalizedExistingStationId &&
      normalizedExistingStationId !== SUPPORT_UNASSIGNED_STATION_ID
        ? normalizedExistingStationId
        : normalizedMessageStationId ?? SUPPORT_UNASSIGNED_STATION_ID;
    existingDialog.stationName = this.resolveStationName(
      existingDialog.stationName,
      message.stationName,
      existingDialog.stationId
    );
    existingDialog.accessStationIds = this.mergeStationAccessIds(existingDialog.accessStationIds, [
      existingDialog.stationId,
      message.stationId
    ]);
    existingDialog.authStatus =
      existingDialog.authStatus === SupportClientAuthStatus.VERIFIED ||
      authStatus === SupportClientAuthStatus.VERIFIED
        ? SupportClientAuthStatus.VERIFIED
        : SupportClientAuthStatus.UNVERIFIED;
    existingDialog.currentPhone = existingDialog.currentPhone ?? message.phone;
    existingDialog.phones = this.mergeStrings(
      existingDialog.phones,
      [message.phone].filter(Boolean) as string[]
    );
    existingDialog.emails = this.mergeStrings(
      existingDialog.emails,
      [message.email].filter(Boolean) as string[]
    );
    existingDialog.subject =
      this.normalizeDialogSubject(existingDialog.subject) ??
      this.selectDialogTitleCandidate(undefined, snapshotDisplayName, message.phone);
    this.dialogs.set(existingDialog.id, existingDialog);
  }

  private refreshDialogPreviewFromMessages(
    dialog: SupportDialog,
    messages: SupportMessage[]
  ): void {
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
    const lastRankingMessage = this.findLastRankingMessage(messages);
    const previewMessage = lastRankingMessage ?? lastMessage;

    dialog.lastRankingMessageAt = lastRankingMessage?.createdAt;
    dialog.lastMessageText = this.formatDialogPreview(previewMessage);
    dialog.lastMessageSenderRole = previewMessage?.senderRole;
  }

  private normalizeLoadedMessage(
    rawMessage: Record<string, unknown>
  ): SupportMessage | null {
    const rawSender = this.readRecord(rawMessage['sender']);
    const rawIdRecord = this.readRecord(rawMessage['_id']);
    const normalizedId =
      this.readStringValue(rawMessage['id']) ??
      this.readStringValue(rawIdRecord?.['$oid']) ??
      randomUUID();
    const dialogId =
      this.readStringValue(rawMessage['dialogId']) ??
      this.readStringValue(rawMessage['threadId']) ??
      this.readStringValue(rawMessage['id']);
    if (!dialogId) {
      return null;
    }

    const createdAt =
      this.readStringValue(rawMessage['createdAt']) ??
      this.parseDateFromEpoch(rawMessage['createdTs']) ??
      new Date().toISOString();
    const connector =
      this.normalizeLoadedConnector(rawMessage['connector'] ?? rawMessage['channel']) ??
      SupportConnectorRoute.LK_WEB_MESSENGER;
    const direction = this.normalizeLoadedDirection(
      rawMessage['direction'],
      rawMessage['authorType']
    );
    const text =
      this.readStringValue(rawMessage['text']) ??
      this.readStringValue(rawMessage['textPreview']);
    const kind = this.normalizeLoadedKind(rawMessage['kind'], rawMessage['eventType'], text);
    const clientId =
      this.readStringValue(rawMessage['clientId']) ??
      this.readStringValue(rawMessage['channelUserId']) ??
      this.readStringValue(rawMessage['chatId']) ??
      `client:${dialogId}`;
    const externalUserId =
      this.readStringValue(rawMessage['externalUserId']) ??
      this.readStringValue(rawMessage['channelUserId']) ??
      this.readStringValue(rawSender?.['id']);
    const externalChatId =
      this.readStringValue(rawMessage['externalChatId']) ??
      this.readStringValue(rawMessage['chatId']);
    const senderName =
      this.readStringValue(rawMessage['senderName']) ??
      this.readStringValue(rawSender?.['name']);
    const senderRole = this.normalizeLoadedSenderRole(
      rawSender?.['role'] ?? rawMessage['authorType'],
      direction
    );
    const senderId =
      this.readStringValue(rawMessage['senderId']) ??
      this.readStringValue(rawSender?.['id']) ??
      (senderRole === 'SYSTEM' ? 'system' : clientId);
    const normalizedPhone = this.normalizePhone(this.readStringValue(rawMessage['phone']));
    const normalizedEmail = this.normalizeEmail(this.readStringValue(rawMessage['email']));
    const stationId =
      this.normalizeStationId(this.readStringValue(rawMessage['stationId'])) ??
      SUPPORT_UNASSIGNED_STATION_ID;
    const stationName = this.resolveStationName(
      this.readStringValue(rawMessage['stationName']),
      undefined,
      stationId
    );
    const ai = this.normalizeLoadedAi(rawMessage['ai'], text);
    const meta =
      this.readRecord(rawMessage['meta']) ??
      this.readRecord(rawMessage['metadata']);

    return {
      id: normalizedId,
      dialogId,
      clientId,
      connector,
      direction,
      kind,
      text,
      createdAt,
      senderId,
      senderRole,
      senderName,
      externalUserId,
      externalChatId,
      externalMessageId: this.readStringValue(rawMessage['externalMessageId']),
      phone: normalizedPhone,
      email: normalizedEmail,
      stationId,
      stationName,
      ai,
      meta
    };
  }

  private normalizeLoadedAuthStatus(rawStatus: unknown): SupportClientAuthStatus {
    const normalized = this.readStringValue(rawStatus)?.toUpperCase();
    if (!normalized) {
      return SupportClientAuthStatus.UNVERIFIED;
    }
    if (
      ['VERIFIED', 'AUTHORIZED', 'AUTHORISED', 'AUTHENTICATED', 'READY'].includes(
        normalized
      )
    ) {
      return SupportClientAuthStatus.VERIFIED;
    }
    return SupportClientAuthStatus.UNVERIFIED;
  }

  private normalizeLoadedConnector(rawConnector: unknown): SupportConnectorRoute | undefined {
    return this.connectorRegistry.resolveRoute(this.readStringValue(rawConnector));
  }

  private normalizeLoadedDirection(
    rawDirection: unknown,
    rawAuthorType: unknown
  ): SupportMessageDirection {
    const normalizedDirection = this.readStringValue(rawDirection)?.toUpperCase();
    if (
      normalizedDirection === SupportMessageDirection.INBOUND ||
      normalizedDirection === SupportMessageDirection.OUTBOUND ||
      normalizedDirection === SupportMessageDirection.SYSTEM
    ) {
      return normalizedDirection as SupportMessageDirection;
    }

    const normalizedAuthorType = this.readStringValue(rawAuthorType)?.toUpperCase();
    if (
      normalizedAuthorType &&
      ['STAFF', 'SUPPORT', 'ADMIN', 'MANAGER', 'OPERATOR', 'AGENT'].includes(normalizedAuthorType)
    ) {
      return SupportMessageDirection.OUTBOUND;
    }
    if (normalizedAuthorType && ['SYSTEM', 'BOT', 'SERVICE'].includes(normalizedAuthorType)) {
      return SupportMessageDirection.SYSTEM;
    }
    return SupportMessageDirection.INBOUND;
  }

  private normalizeLoadedKind(
    rawKind: unknown,
    rawEventType: unknown,
    text?: string
  ): SupportMessageKind {
    const normalizedKind = this.readStringValue(rawKind)?.toUpperCase();
    const normalizedEventType = this.readStringValue(rawEventType)?.toUpperCase();

    const directMatch = (normalizedKind ?? normalizedEventType) as SupportMessageKind | undefined;
    if (directMatch && Object.values(SupportMessageKind).includes(directMatch)) {
      return directMatch;
    }

    if (normalizedEventType && normalizedEventType.includes('CALL')) {
      return SupportMessageKind.CALL;
    }
    if (normalizedEventType && normalizedEventType.includes('EMAIL')) {
      return SupportMessageKind.EMAIL;
    }
    if (normalizedEventType && normalizedEventType.includes('MEDIA')) {
      return SupportMessageKind.MEDIA;
    }
    if (normalizedEventType && normalizedEventType.includes('SYSTEM')) {
      return SupportMessageKind.SYSTEM;
    }

    const normalizedText = String(text ?? '').trim();
    if (normalizedText.startsWith('/')) {
      return SupportMessageKind.COMMAND;
    }
    if (normalizedText) {
      return SupportMessageKind.TEXT;
    }
    return SupportMessageKind.SYSTEM;
  }

  private normalizeLoadedSenderRole(
    rawRole: unknown,
    direction: SupportMessageDirection
  ): SupportSenderRole {
    const normalizedRole = this.readStringValue(rawRole)?.toUpperCase();
    if (!normalizedRole) {
      return direction === SupportMessageDirection.INBOUND ? Role.CLIENT : Role.SUPPORT;
    }
    if (normalizedRole === 'SYSTEM' || normalizedRole === 'BOT' || normalizedRole === 'SERVICE') {
      return 'SYSTEM';
    }
    if (normalizedRole === Role.CLIENT) {
      return Role.CLIENT;
    }
    if (normalizedRole === Role.SUPER_ADMIN) {
      return Role.SUPER_ADMIN;
    }
    if (normalizedRole === Role.SUPPORT) {
      return Role.SUPPORT;
    }
    if (normalizedRole === Role.STATION_ADMIN) {
      return Role.STATION_ADMIN;
    }
    if (normalizedRole === Role.MANAGER) {
      return Role.MANAGER;
    }
    if (normalizedRole === Role.TOURNAMENT_MANAGER) {
      return Role.TOURNAMENT_MANAGER;
    }
    if (normalizedRole === Role.GAME_MANAGER) {
      return Role.GAME_MANAGER;
    }
    if (normalizedRole === 'STAFF' || normalizedRole === 'ADMIN' || normalizedRole === 'OPERATOR') {
      return Role.SUPPORT;
    }
    return direction === SupportMessageDirection.INBOUND ? Role.CLIENT : Role.SUPPORT;
  }

  private normalizeLoadedAi(rawAi: unknown, text?: string): SupportAiInsight | undefined {
    const aiRecord = this.readRecord(rawAi);
    if (!aiRecord) {
      return text ? this.buildAiInsight({} as IngestSupportEventDto, text) : undefined;
    }

    const topic = this.normalizeLoadedAiTopic(aiRecord['topic'], text);
    const sentiment = this.normalizeLoadedAiSentiment(aiRecord['sentiment']);
    const priority = this.normalizeLoadedAiPriority(aiRecord['priority']);
    const confidenceRaw = this.readNumberValue(aiRecord['confidence']);
    const confidence =
      typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0.7;
    const summary =
      this.readStringValue(aiRecord['summary']) ??
      this.buildAiSummary(topic, sentiment, priority);
    const tagsRaw = Array.isArray(aiRecord['topicTags'])
      ? aiRecord['topicTags']
      : Array.isArray(aiRecord['tags'])
        ? aiRecord['tags']
        : [];
    const tags = tagsRaw
      .map((value) => this.readStringValue(value))
      .filter((value): value is string => Boolean(value));

    return {
      topic,
      sentiment,
      priority,
      summary,
      confidence,
      tags
    };
  }

  private normalizeLoadedAiTopic(rawTopic: unknown, text?: string): SupportTopic {
    const normalized = this.readStringValue(rawTopic)
      ?.toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (normalized && (Object.values(SupportTopic) as string[]).includes(normalized)) {
      return normalized as SupportTopic;
    }

    if (normalized && normalized.includes('PAYMENT')) {
      return SupportTopic.PAYMENT;
    }
    if (normalized && normalized.includes('BOOK')) {
      return SupportTopic.BOOKING;
    }
    if (normalized && normalized.includes('TRAIN')) {
      return SupportTopic.TRAINING;
    }
    if (normalized && normalized.includes('TOURN')) {
      return SupportTopic.TOURNAMENT;
    }
    if (normalized && normalized.includes('GAME')) {
      return SupportTopic.GAME;
    }
    if (normalized && normalized.includes('COMPL')) {
      return SupportTopic.COMPLAINT;
    }
    if (normalized && normalized.includes('FEED')) {
      return SupportTopic.FEEDBACK;
    }
    if (normalized && (normalized.includes('TECH') || normalized.includes('ERROR'))) {
      return SupportTopic.TECHNICAL;
    }
    if (normalized && normalized.includes('CALL')) {
      return SupportTopic.CALLBACK;
    }

    if (text) {
      return this.detectTopic(text.toLowerCase());
    }
    return SupportTopic.GENERAL;
  }

  private normalizeLoadedAiSentiment(rawSentiment: unknown): SupportSentiment {
    const normalized = this.readStringValue(rawSentiment)?.toUpperCase();
    if (!normalized) {
      return SupportSentiment.NEUTRAL;
    }
    if (normalized === SupportSentiment.DISTRESSED) {
      return SupportSentiment.DISTRESSED;
    }
    if (normalized === SupportSentiment.POSITIVE) {
      return SupportSentiment.POSITIVE;
    }
    if (normalized === SupportSentiment.NEGATIVE) {
      return SupportSentiment.NEGATIVE;
    }
    return SupportSentiment.NEUTRAL;
  }

  private normalizeLoadedAiPriority(rawPriority: unknown): SupportPriority {
    const normalized = this.readStringValue(rawPriority)?.toUpperCase();
    if (!normalized) {
      return SupportPriority.MEDIUM;
    }
    if (normalized === SupportPriority.CRITICAL) {
      return SupportPriority.CRITICAL;
    }
    if (normalized === SupportPriority.IMPORTANT) {
      return SupportPriority.IMPORTANT;
    }
    if (normalized === SupportPriority.RECOMMENDATION) {
      return SupportPriority.RECOMMENDATION;
    }
    return SupportPriority.MEDIUM;
  }

  private parseDateFromEpoch(raw: unknown): string | undefined {
    const value = this.readNumberValue(raw);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return new Date(value).toISOString();
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readStringValue(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readStringValue(item))
      .filter((item): item is string => Boolean(item));
  }

  private readNumberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private getDialogAccessStationIds(
    dialog: Pick<SupportDialog, 'stationId' | 'stationName' | 'accessStationIds'>
  ): string[] {
    const aliases = this.resolveStationAccessAliases(dialog.stationId, dialog.stationName);
    return this.mergeStationAccessIds(dialog.accessStationIds ?? [], [dialog.stationId, ...aliases]);
  }

  private resolveDialogWriteStationIds(
    dialog: Pick<SupportDialog, 'stationId'>
  ): string[] {
    const stationId = this.normalizeStationId(dialog.stationId);
    return stationId ? [stationId] : [];
  }

  private resolveDialogReadOnlyStationIds(
    accessStationIds: string[],
    writeStationIds: string[]
  ): string[] {
    const writeSet = new Set(writeStationIds.map((stationId) => stationId.toLowerCase()));
    return accessStationIds.filter((stationId) => !writeSet.has(stationId.toLowerCase()));
  }

  private syncDialogMarkers(dialog: SupportDialog): void {
    const accessStationIds = this.getDialogAccessStationIds(dialog);
    const writeStationIds = this.resolveDialogWriteStationIds(dialog);
    const readOnlyStationIds = this.resolveDialogReadOnlyStationIds(
      accessStationIds,
      writeStationIds
    );

    dialog.accessStationIds = accessStationIds;
    dialog.writeStationIds = writeStationIds;
    dialog.readOnlyStationIds = readOnlyStationIds;
    dialog.hasUnreadMessages = dialog.unreadCount > 0;
    dialog.hasNewMessages = dialog.pendingClientMessageIds.length > 0;
  }

  private mergeStationAccessIds(existing: string[], values: Array<string | undefined>): string[] {
    return this.mergeStrings(
      existing,
      values
        .map((value) => this.normalizeStationId(value))
        .filter(
          (value): value is string =>
            Boolean(value) && value !== SUPPORT_UNASSIGNED_STATION_ID
        )
    );
  }

  private resolveStationAccessAliases(stationId?: string, stationName?: string): string[] {
    const normalizedStationId = this.normalizeStationId(stationId)?.toLowerCase();
    const normalizedStationName = this.normalizeDisplayName(stationName)?.toLowerCase();
    if (!normalizedStationId && !normalizedStationName) {
      return [];
    }

    const aliases: string[] = [];
    for (const mapping of this.stationMappings) {
      const mappingId = this.normalizeStationId(mapping.stationId)?.toLowerCase();
      const mappingName = this.normalizeDisplayName(mapping.stationName)?.toLowerCase();
      if (
        (normalizedStationId && mappingId && normalizedStationId === mappingId) ||
        (normalizedStationName && mappingName && normalizedStationName === mappingName)
      ) {
        aliases.push(mapping.key, mapping.stationId);
      }
    }

    return this.mergeStrings([], aliases);
  }

  private isDialogActiveForUser(dialog: SupportDialog, user: RequestUser): boolean {
    return this.isDialogWritableForUser(dialog, user);
  }

  private isDialogWritableForUser(dialog: SupportDialog, user: RequestUser): boolean {
    if (
      user.roles.includes(Role.SUPER_ADMIN) ||
      user.roles.includes(Role.SUPPORT) ||
      user.stationIds.length === 0
    ) {
      return true;
    }
    if (dialog.stationId === SUPPORT_UNASSIGNED_STATION_ID) {
      return true;
    }
    return user.stationIds.includes(dialog.stationId);
  }

  private listAccessibleDialogs(
    user: RequestUser,
    filters: SupportDialogFilters = {}
  ): SupportDialog[] {
    return Array.from(this.dialogs.values())
      .filter((dialog) => this.canAccessDialog(dialog, user))
      .filter((dialog) => (filters.stationId ? dialog.stationId === filters.stationId : true))
      .filter((dialog) =>
        filters.connector ? dialog.connectors.includes(filters.connector) : true
      )
      .sort((left, right) => this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt));
  }

  private canAccessDialog(dialog: SupportDialog, user: RequestUser): boolean {
    if (!this.isStaff(user)) {
      return false;
    }
    if (user.roles.includes(Role.SUPER_ADMIN)) {
      return true;
    }
    if (dialog.stationId === SUPPORT_UNASSIGNED_STATION_ID) {
      return user.roles.some((role) =>
        [Role.SUPPORT, Role.MANAGER, Role.STATION_ADMIN].includes(role)
      );
    }
    if (user.stationIds.length === 0) {
      return true;
    }
    if (user.stationIds.includes(dialog.stationId)) {
      return true;
    }
    const accessStationIds = this.getDialogAccessStationIds(dialog);
    return user.stationIds.some((stationId) => accessStationIds.includes(stationId));
  }

  private ensureDialogAccess(dialog: SupportDialog, user: RequestUser): void {
    if (this.canAccessDialog(dialog, user)) {
      return;
    }
    throw new ForbiddenException('Access to support dialog denied');
  }

  private ensureStaff(user: RequestUser): void {
    if (this.isStaff(user)) {
      return;
    }
    throw new ForbiddenException('Only staff can access support dialogs');
  }

  private isStaff(user: RequestUser): boolean {
    return user.roles.some((role) => STAFF_ROLES.includes(role));
  }

  private getDialogOrThrow(dialogId: string): SupportDialog {
    const dialog = this.dialogs.get(dialogId);
    if (!dialog) {
      throw new NotFoundException(`Support dialog ${dialogId} not found`);
    }
    return dialog;
  }

  private getOutboxOrThrow(id: string): SupportOutboxCommand {
    const command = this.outbox.get(id);
    if (!command) {
      throw new NotFoundException(`Support outbox command ${id} not found`);
    }
    return command;
  }

  private persistClient(client: SupportClientProfile): void {
    const normalized = this.normalizeLoadedClient(client);
    this.clients.set(normalized.id, normalized);
    this.persistence.persistClient(normalized);
  }

  private persistDialog(dialog: SupportDialog): void {
    this.syncDialogMarkers(dialog);
    this.dialogs.set(dialog.id, dialog);
    this.persistence.persistDialog(dialog);
  }

  private findOpenDialog(clientId: string): SupportDialog | undefined {
    return Array.from(this.dialogs.values()).find(
      (dialog) => dialog.clientId === clientId && dialog.status === SupportDialogStatus.OPEN
    );
  }

  private findOpenDialogs(clientId: string): SupportDialog[] {
    return Array.from(this.dialogs.values())
      .filter(
        (dialog) => dialog.clientId === clientId && dialog.status === SupportDialogStatus.OPEN
      )
      .sort((left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt));
  }

  private findOpenDialogsByConnector(
    clientId: string,
    connector: SupportConnectorRoute
  ): SupportDialog[] {
    return this.findOpenDialogs(clientId).filter(
      (dialog) => this.resolveDialogPrimaryConnector(dialog) === connector
    );
  }

  private collapseOpenDialogs(
    clientId: string,
    connector: SupportConnectorRoute
  ): SupportDialog | undefined {
    const duplicates = this.findOpenDialogsByConnector(clientId, connector);
    if (duplicates.length === 0) {
      return undefined;
    }

    const [canonical, ...rest] = duplicates;
    for (const dialog of rest) {
      this.mergeDialogInto(canonical, dialog);
    }
    return canonical;
  }

  private collapseOpenDialogsForClient(
    clientId: string,
    connector?: SupportConnectorRoute
  ): void {
    if (connector) {
      this.collapseOpenDialogs(clientId, connector);
      return;
    }

    const groupedByConnector = new Map<string, SupportDialog[]>();
    for (const dialog of this.findOpenDialogs(clientId)) {
      const key = this.resolveDialogPrimaryConnector(dialog) ?? '__unknown__';
      const bucket = groupedByConnector.get(key) ?? [];
      bucket.push(dialog);
      groupedByConnector.set(key, bucket);
    }

    for (const group of groupedByConnector.values()) {
      if (group.length < 2) {
        continue;
      }
      const [canonical, ...rest] = group;
      for (const dialog of rest) {
        this.mergeDialogInto(canonical, dialog);
      }
    }
  }

  private resolveDialogPrimaryConnector(
    dialog: SupportDialog
  ): SupportConnectorRoute | undefined {
    return (
      dialog.lastInboundConnector ??
      dialog.lastReplyConnector ??
      dialog.connectors[0]
    );
  }

  private updateContactReminderStage(
    client: SupportClientProfile,
    direction: SupportMessageDirection,
    kind: SupportMessageKind,
    createdAt: string
  ): 1 | 2 | undefined {
    const currentAttempts = client.unverifiedTextAttempts ?? 0;

    if (client.authStatus === SupportClientAuthStatus.VERIFIED) {
      if (currentAttempts !== 0) {
        client.unverifiedTextAttempts = 0;
        client.updatedAt = createdAt;
        this.persistClient(client);
      }
      return undefined;
    }

    if (direction !== SupportMessageDirection.INBOUND || kind !== SupportMessageKind.TEXT) {
      return undefined;
    }

    const nextAttempts = Math.min(currentAttempts + 1, 2);
    if (nextAttempts !== currentAttempts) {
      client.unverifiedTextAttempts = nextAttempts;
      client.updatedAt = createdAt;
      this.persistClient(client);
    }

    return nextAttempts === 1 ? 1 : 2;
  }

  private buildIdentity(
    dto: NormalizedIngestSupportEventDto,
    createdAt: string
  ): SupportClientIdentity | undefined {
    const externalUserId = this.normalizeIdentityValue(dto.externalUserId);
    const externalChatId = this.normalizeIdentityValue(dto.externalChatId);
    if (!externalUserId && !externalChatId) {
      return undefined;
    }
    return {
      connector: dto.connector,
      externalUserId,
      externalChatId,
      externalThreadId: undefined,
      username: this.normalizeIdentityValue(dto.username),
      displayName: this.resolveIncomingDisplayName(dto),
      linkedAt: createdAt,
      lastSeenAt: createdAt
    };
  }

  private upsertIdentity(
    identities: SupportClientIdentity[] | undefined,
    nextIdentity: SupportClientIdentity
  ): SupportClientIdentity[] {
    const currentIdentities = Array.isArray(identities) ? identities : [];
    const existingIndex = currentIdentities.findIndex(
      (identity) => this.identitiesOverlap(identity, nextIdentity)
    );
    if (existingIndex < 0) {
      return [...currentIdentities, nextIdentity];
    }

    const updated = [...currentIdentities];
    const existing = updated[existingIndex];
    updated[existingIndex] = {
      ...existing,
      externalChatId: nextIdentity.externalChatId ?? existing.externalChatId,
      username: nextIdentity.username ?? existing.username,
      displayName: nextIdentity.displayName ?? existing.displayName,
      lastSeenAt: nextIdentity.lastSeenAt
    };
    return updated;
  }

  private upsertIdentities(
    left: SupportClientIdentity[],
    right: SupportClientIdentity[]
  ): SupportClientIdentity[] {
    let merged = [...left];
    for (const identity of right) {
      merged = this.upsertIdentity(merged, identity);
    }
    return merged;
  }

  private buildAiInsight(
    dto: IngestSupportEventDto,
    text?: string
  ): SupportAiInsight | undefined {
    if (dto.ai) {
      return {
        topic: dto.ai.topic ?? SupportTopic.GENERAL,
        sentiment: dto.ai.sentiment ?? SupportSentiment.NEUTRAL,
        priority: dto.ai.priority ?? SupportPriority.MEDIUM,
        summary: dto.ai.summary?.trim() || this.buildAiSummary(SupportTopic.GENERAL, SupportSentiment.NEUTRAL, SupportPriority.MEDIUM),
        confidence: typeof dto.ai.confidence === 'number' ? dto.ai.confidence : 0.85,
        tags: Array.isArray(dto.ai.tags) ? dto.ai.tags.map((item) => String(item)) : []
      };
    }

    if (!text) {
      return undefined;
    }

    const normalized = text.toLowerCase();
    const topic = this.detectTopic(normalized);
    const sentiment = this.detectSentiment(normalized);
    const priority = this.detectPriority(normalized, topic, sentiment);
    return {
      topic,
      sentiment,
      priority,
      summary: this.buildAiSummary(topic, sentiment, priority),
      confidence: this.detectConfidence(normalized),
      tags: this.buildAiTags(topic, sentiment, priority)
    };
  }

  private detectTopic(text: string): SupportTopic {
    if (this.includesAny(text, ['оплат', 'платеж', 'чек', 'возврат', 'списан', 'invoice', 'refund'])) {
      return SupportTopic.PAYMENT;
    }
    if (this.includesAny(text, ['брон', 'корт', 'слот', 'запис', 'reserve', 'booking'])) {
      return SupportTopic.BOOKING;
    }
    if (this.includesAny(text, ['тренир', 'тренер', 'урок', 'coach', 'lesson'])) {
      return SupportTopic.TRAINING;
    }
    if (this.includesAny(text, ['турнир', 'сетка', 'лига', 'tournament'])) {
      return SupportTopic.TOURNAMENT;
    }
    if (this.includesAny(text, ['игр', 'матч', 'спарринг', 'game', 'match'])) {
      return SupportTopic.GAME;
    }
    if (this.includesAny(text, ['жалоб', 'ужас', 'плохо', 'безобраз', 'complaint'])) {
      return SupportTopic.COMPLAINT;
    }
    if (this.includesAny(text, ['пожелан', 'идея', 'предлож', 'feedback'])) {
      return SupportTopic.FEEDBACK;
    }
    if (this.includesAny(text, ['ошиб', 'не работает', 'баг', 'crash', 'error'])) {
      return SupportTopic.TECHNICAL;
    }
    if (this.includesAny(text, ['перезвон', 'позвон', 'call me', 'callback'])) {
      return SupportTopic.CALLBACK;
    }
    return SupportTopic.GENERAL;
  }

  private detectSentiment(text: string): SupportSentiment {
    if (this.includesAny(text, ['срочно', 'ужас', 'возмущ', 'злюсь', 'неприемлем', 'кошмар'])) {
      return SupportSentiment.DISTRESSED;
    }
    if (this.includesAny(text, ['плохо', 'не работает', 'проблема', 'жалоба', 'bad', 'angry'])) {
      return SupportSentiment.NEGATIVE;
    }
    if (this.includesAny(text, ['спасибо', 'супер', 'отлично', 'люблю', 'great', 'thanks'])) {
      return SupportSentiment.POSITIVE;
    }
    return SupportSentiment.NEUTRAL;
  }

  private detectPriority(
    text: string,
    topic: SupportTopic,
    sentiment: SupportSentiment
  ): SupportPriority {
    if (
      this.includesAny(text, ['срочно', 'немедленно', 'сейчас', 'asap', 'urgent']) ||
      sentiment === SupportSentiment.DISTRESSED
    ) {
      return SupportPriority.CRITICAL;
    }
    if (
      topic === SupportTopic.PAYMENT ||
      topic === SupportTopic.COMPLAINT ||
      this.includesAny(text, ['сегодня', 'важно', 'не могу', 'ошибка оплаты'])
    ) {
      return SupportPriority.IMPORTANT;
    }
    if (topic === SupportTopic.FEEDBACK || this.includesAny(text, ['было бы здорово', 'предлагаю', 'хотелось бы'])) {
      return SupportPriority.RECOMMENDATION;
    }
    return SupportPriority.MEDIUM;
  }

  private detectConfidence(text: string): number {
    if (text.length >= 180) {
      return 0.92;
    }
    if (text.length >= 80) {
      return 0.84;
    }
    return 0.72;
  }

  private buildAiTags(
    topic: SupportTopic,
    sentiment: SupportSentiment,
    priority: SupportPriority
  ): string[] {
    return [topic, sentiment, priority];
  }

  private buildAiSummary(
    topic: SupportTopic,
    sentiment: SupportSentiment,
    priority: SupportPriority
  ): string {
    return `Тема: ${topic}; тональность: ${sentiment}; приоритет: ${priority}`;
  }

  private shouldCreateMessage(
    dto: IngestSupportEventDto,
    kind: SupportMessageKind,
    phone?: string,
    email?: string
  ): boolean {
    const text = String(dto.text ?? '').trim();
    const normalizedEventType = String(dto.eventType ?? '')
      .trim()
      .toUpperCase();
    const isExplicitContactEvent = ['CONTACT', 'PHONE', 'PHONE_SHARED', 'CONTACT_SHARED'].includes(
      normalizedEventType
    );

    if (
      dto.connector === SupportConnectorRoute.LK_WEB_MESSENGER &&
      kind === SupportMessageKind.CONTACT &&
      !isExplicitContactEvent &&
      !text
    ) {
      return false;
    }

    return Boolean(
      text ||
        phone ||
        email ||
        dto.selectedStationId ||
        kind === SupportMessageKind.CALL ||
        kind === SupportMessageKind.EMAIL ||
        kind === SupportMessageKind.SYSTEM
    );
  }

  private resolveMessageKind(
    dto: IngestSupportEventDto,
    normalizedPhone?: string,
    normalizedEmail?: string
  ): SupportMessageKind {
    const text = String(dto.text ?? '').trim();
    const normalizedEventType = String(dto.eventType ?? '')
      .trim()
      .toUpperCase();

    if (dto.kind) {
      return dto.kind;
    }
    if (dto.selectedStationId) {
      return SupportMessageKind.STATION_SELECTION;
    }
    if (dto.connector === SupportConnectorRoute.LK_WEB_MESSENGER) {
      if (text.startsWith('/')) {
        return SupportMessageKind.COMMAND;
      }
      if (text) {
        return SupportMessageKind.TEXT;
      }
      if (
        normalizedPhone &&
        ['CONTACT', 'PHONE', 'PHONE_SHARED', 'CONTACT_SHARED'].includes(normalizedEventType)
      ) {
        return SupportMessageKind.CONTACT;
      }
    }
    if (normalizedPhone) {
      return SupportMessageKind.CONTACT;
    }
    if (dto.connector === SupportConnectorRoute.EMAIL || normalizedEmail) {
      return SupportMessageKind.EMAIL;
    }
    if (
      dto.connector === SupportConnectorRoute.PHONE_CALL ||
      dto.connector === SupportConnectorRoute.BITRIX
    ) {
      return SupportMessageKind.CALL;
    }
    if (text.startsWith('/')) {
      return SupportMessageKind.COMMAND;
    }
    if (text) {
      return SupportMessageKind.TEXT;
    }
    return SupportMessageKind.SYSTEM;
  }

  private buildMessageText(
    kind: SupportMessageKind,
    text: string | undefined,
    phone: string | undefined,
    email: string | undefined,
    dto: IngestSupportEventDto
  ): string | undefined {
    if (kind === SupportMessageKind.CONTACT && phone) {
      return `Клиент поделился номером: ${phone}`;
    }
    if (kind === SupportMessageKind.STATION_SELECTION && dto.selectedStationId) {
      return `Клиент выбрал станцию: ${dto.selectedStationName?.trim() || dto.selectedStationId}`;
    }
    if (kind === SupportMessageKind.CALL) {
      return text || `Зафиксирован звонок клиента${phone ? ` ${phone}` : ''}`;
    }
    if (kind === SupportMessageKind.EMAIL) {
      return text || `Получено email-обращение${email ? ` ${email}` : ''}`;
    }
    return text;
  }

  private isActionableClientMessage(message: SupportMessage): boolean {
    return [
      SupportMessageKind.TEXT,
      SupportMessageKind.MEDIA,
      SupportMessageKind.CALL,
      SupportMessageKind.EMAIL,
      SupportMessageKind.COMMAND
    ].includes(message.kind);
  }

  private canReplyToDialog(dialog: SupportDialog): boolean {
    return dialog.authStatus === SupportClientAuthStatus.VERIFIED;
  }

  private normalizePhone(raw?: string): string | undefined {
    const digits = String(raw ?? '').replace(/\D+/g, '');
    if (!digits) {
      return undefined;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('7')) {
      return digits;
    }
    return digits;
  }

  private resolveMessagesLimit(rawLimit?: number): number {
    if (!Number.isFinite(rawLimit) || Number(rawLimit) <= 0) {
      return 100;
    }
    return Math.min(Math.floor(Number(rawLimit)), 500);
  }

  private dialogMatchesPhone(dialog: SupportDialog, normalizedPhone: string): boolean {
    const candidates = this.mergeStrings(
      [],
      [
        dialog.currentPhone,
        ...(Array.isArray(dialog.phones) ? dialog.phones : [])
      ]
        .map((phone) => this.normalizePhone(phone))
        .filter((phone): phone is string => Boolean(phone))
    );

    if (candidates.includes(normalizedPhone)) {
      return true;
    }

    if (normalizedPhone.length >= 10) {
      return candidates.some((phone) => phone.endsWith(normalizedPhone.slice(-10)));
    }

    return false;
  }

  private normalizeEmail(raw?: string): string | undefined {
    const value = String(raw ?? '').trim().toLowerCase();
    return value || undefined;
  }

  private normalizeDisplayName(raw?: string): string | undefined {
    const value = String(raw ?? '').trim();
    return value || undefined;
  }

  private normalizeIdentityValue(raw?: string): string | undefined {
    const value = String(raw ?? '').trim();
    return value || undefined;
  }

  private normalizeStationId(raw?: string): string | undefined {
    const value = String(raw ?? '').trim();
    if (!value) {
      return undefined;
    }

    const normalizedValue = value.toLowerCase();
    const mapping = (this.stationMappings ?? []).find((item) => {
      const mappingKey = this.normalizeIdentityValue(item.key)?.toLowerCase();
      const mappingStationId = this.normalizeIdentityValue(item.stationId)?.toLowerCase();
      const mappingStationName = this.normalizeDisplayName(item.stationName)?.toLowerCase();
      return (
        (mappingKey && mappingKey === normalizedValue) ||
        (mappingStationId && mappingStationId === normalizedValue) ||
        (mappingStationName && mappingStationName === normalizedValue)
      );
    });

    return mapping?.stationId ?? value;
  }

  private resolveStationName(
    provided?: string,
    fallback?: string,
    stationId?: string
  ): string {
    const value = String(provided ?? fallback ?? '').trim();
    if (value) {
      return value;
    }
    const normalizedStationId = this.normalizeStationId(stationId);
    if (normalizedStationId === SUPPORT_UNASSIGNED_STATION_ID || !normalizedStationId) {
      return SUPPORT_UNASSIGNED_STATION_NAME;
    }
    const mapped = (this.stationMappings ?? []).find(
      (item) =>
        this.normalizeStationId(item.stationId)?.toLowerCase() ===
        normalizedStationId.toLowerCase()
    );
    return mapped?.stationName ?? normalizedStationId;
  }

  private resolveEventTimestamp(raw?: string): string {
    const value = String(raw ?? '').trim();
    if (!value) {
      return new Date().toISOString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  }

  private buildDialogSubject(client: SupportClientProfile, stationName: string): string {
    return (
      this.selectDialogTitleCandidate(
        undefined,
        client.displayName,
        client.primaryPhone,
        client.emails[0]
      ) ??
      stationName ??
      client.id
    );
  }

  private buildSummaryClientDisplayName(
    client: SupportClientProfile | undefined,
    dialog: SupportDialog
  ): string | undefined {
    return this.selectDialogTitleCandidate(
      undefined,
      client?.displayName,
      client?.primaryPhone,
      client?.emails[0]
    );
  }

  private buildSummaryDialogSubject(
    client: SupportClientProfile | undefined,
    dialog: SupportDialog
  ): string | undefined {
    return this.selectDialogTitleCandidate(
      dialog.subject,
      client?.displayName,
      client?.primaryPhone,
      client?.emails[0]
    );
  }

  private resolveIncomingDisplayName(dto: IngestSupportEventDto): string | undefined {
    const candidate = this.normalizeDisplayName(dto.displayName);
    if (!candidate) {
      return undefined;
    }

    if (
      this.isReservedClientDisplayName(
        candidate,
        dto.selectedStationId ?? dto.stationId,
        dto.selectedStationName ?? dto.stationName
      )
    ) {
      return undefined;
    }

    return candidate;
  }

  private buildClientDisplayName(
    client: SupportClientProfile,
    dto: IngestSupportEventDto
  ): string {
    return (
      this.resolveIncomingDisplayName(dto) ??
      client.primaryPhone ??
      client.emails[0] ??
      dto.username?.trim() ??
      `Клиент ${client.id.slice(0, 8)}`
    );
  }

  private selectDialogTitleCandidate(
    primary: string | undefined,
    fallbackName?: string,
    fallbackPhone?: string,
    fallbackEmail?: string
  ): string | undefined {
    const candidates = [primary, fallbackName, fallbackPhone, fallbackEmail];

    for (const candidate of candidates) {
      const normalized = this.normalizeDialogSubject(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private buildStaffLabel(role: Role): string {
    switch (role) {
      case Role.SUPER_ADMIN:
        return 'Суперадмин';
      case Role.SUPPORT:
        return 'Сотрудник поддержки';
      case Role.STATION_ADMIN:
        return 'Администратор станции';
      case Role.MANAGER:
        return 'Менеджер';
      case Role.TOURNAMENT_MANAGER:
        return 'Менеджер турниров';
      case Role.GAME_MANAGER:
        return 'Менеджер игр';
      default:
        return 'Сотрудник';
    }
  }

  private buildStaffSenderName(user: RequestUser, role: Role): string {
    const title = String(user?.title ?? '').trim();
    if (title) {
      return title;
    }
    const login = String(user?.login ?? '').trim();
    return login || this.buildStaffLabel(role);
  }

  private buildStaffMessageMeta(user: RequestUser): Record<string, unknown> | undefined {
    const senderMaxPublicUrl = String(user?.maxPublicUrl ?? '').trim();
    if (!senderMaxPublicUrl) {
      return undefined;
    }
    return {
      senderMaxPublicUrl
    };
  }

  private resolveSenderRole(roles: Role[]): Role {
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
    return Role.SUPPORT;
  }

  private resolveIncomingSenderRole(
    direction: SupportMessageDirection,
    kind: SupportMessageKind
  ): SupportSenderRole {
    if (
      direction === SupportMessageDirection.SYSTEM ||
      direction === SupportMessageDirection.OUTBOUND ||
      kind === SupportMessageKind.STATION_SELECTION
    ) {
      return 'SYSTEM';
    }
    return Role.CLIENT;
  }

  private resolveIncomingDirection(
    dto: NormalizedIngestSupportEventDto,
    kind: SupportMessageKind
  ): SupportMessageDirection {
    const explicitDirection = String(dto.direction ?? '')
      .trim()
      .toUpperCase();
    if (
      explicitDirection === SupportMessageDirection.INBOUND ||
      explicitDirection === SupportMessageDirection.OUTBOUND ||
      explicitDirection === SupportMessageDirection.SYSTEM
    ) {
      return explicitDirection as SupportMessageDirection;
    }

    const normalizedAuthorType = String(dto.authorType ?? '')
      .trim()
      .toUpperCase();
    if (
      normalizedAuthorType &&
      ['STAFF', 'SUPPORT', 'ADMIN', 'MANAGER', 'OPERATOR', 'AGENT'].includes(
        normalizedAuthorType
      )
    ) {
      return SupportMessageDirection.OUTBOUND;
    }
    if (
      normalizedAuthorType &&
      ['SYSTEM', 'BOT', 'SERVICE'].includes(normalizedAuthorType)
    ) {
      return SupportMessageDirection.SYSTEM;
    }

    const normalizedEventType = String(dto.eventType ?? '')
      .trim()
      .toUpperCase();
    if (
      normalizedEventType.includes('SYSTEM') ||
      normalizedEventType === 'OTP' ||
      normalizedEventType.startsWith('OTP_') ||
      normalizedEventType.endsWith('_OTP')
    ) {
      return SupportMessageDirection.SYSTEM;
    }

    if (
      kind === SupportMessageKind.SYSTEM ||
      Boolean(dto.deliverToClient) ||
      this.resolveSenderIsBot(dto) ||
      this.looksLikeServiceText(dto.text)
    ) {
      return SupportMessageDirection.SYSTEM;
    }

    return SupportMessageDirection.INBOUND;
  }

  private looksLikeServiceText(rawText?: string): boolean {
    const text = String(rawText ?? '')
      .trim()
      .toLowerCase();
    if (!text) {
      return false;
    }
    if (text.startsWith('служебное сообщение')) {
      return true;
    }
    return text.includes('viva crm') && text.includes('otp');
  }

  private isReservedClientDisplayName(
    value: string | undefined,
    stationId?: string,
    stationName?: string,
    currentStationId?: string,
    currentStationName?: string
  ): boolean {
    const normalizedValue = this.normalizeDisplayName(value)?.toLowerCase();
    if (!normalizedValue) {
      return false;
    }

    if (this.isTechnicalDialogTitle(normalizedValue)) {
      return true;
    }

    const reservedStationValues = [
      this.normalizeStationId(stationId),
      this.normalizeDisplayName(stationName),
      this.normalizeStationId(currentStationId),
      this.normalizeDisplayName(currentStationName),
      SUPPORT_UNASSIGNED_STATION_ID,
      SUPPORT_UNASSIGNED_STATION_NAME
    ]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.toLowerCase());

    return reservedStationValues.includes(normalizedValue);
  }

  private normalizeDialogSubject(raw?: string): string | undefined {
    const value = this.normalizeDisplayName(raw);
    if (!value) {
      return undefined;
    }
    if (this.isTechnicalDialogTitle(value)) {
      return undefined;
    }
    return value;
  }

  private isTechnicalDialogTitle(value?: string): boolean {
    const normalized = this.normalizeDisplayName(value)?.toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized === 'viva crm' || normalized === 'vivacrm';
  }

  private mergeStrings(left: string[], right: string[]): string[] {
    return Array.from(new Set([...left, ...right].filter((item) => item.length > 0)));
  }

  private mergeIds(left: string[], right: string[]): string[] {
    return Array.from(new Set([...left, ...right]));
  }

  private mergeConnectors(
    left: SupportConnectorRoute[],
    right: SupportConnectorRoute[]
  ): SupportConnectorRoute[] {
    return Array.from(new Set([...left, ...right]));
  }

  private normalizeIncomingEvent(dto: IngestSupportEventDto): NormalizedIngestSupportEventDto {
    const incomingMeta = dto.meta ?? dto.metadata;
    const connector = this.resolveIncomingConnector(dto);
    const selectedStation =
      this.resolveStationMappingFromAction(dto.action) ??
      this.resolveStationMappingFromAction(this.extractMetaPathString(incomingMeta, ['action'])) ??
      this.resolveStationMappingFromAction(
        this.extractMetaPathString(incomingMeta, ['data', 'action'])
      ) ??
      this.resolveStationMappingFromAction(
        this.extractMetaPathString(incomingMeta, ['data', 'payload', 'action'])
      );
    const baseNormalized: NormalizedIngestSupportEventDto = {
      ...dto,
      connector,
      meta: incomingMeta,
      externalUserId: this.normalizeIdentityValue(
        dto.externalUserId ?? dto.userId ?? dto.senderId ?? dto.channelUserId ?? dto.clientId
      ),
      externalChatId: this.normalizeIdentityValue(
        dto.externalChatId ?? dto.externalThreadId ?? dto.chatId
      ),
      displayName: this.normalizeDisplayName(dto.displayName ?? dto.clientName ?? dto.senderName),
      username: this.normalizeIdentityValue(dto.username),
      phone: this.normalizePhone(dto.phone ?? dto.primaryPhone),
      selectedStationId:
        this.normalizeStationId(dto.selectedStationId) ??
        selectedStation?.stationId,
      selectedStationName:
        this.normalizeDisplayName(dto.selectedStationName) ??
        selectedStation?.stationName,
      deliverToClient: this.resolveDeliverToClient(dto)
    };
    const connectorPatch = this.connectorRegistry.normalizeIncomingEvent(
      {
        ...dto,
        meta: incomingMeta,
        connector
      },
      this.buildConnectorNormalizationHelpers()
    );
    return {
      ...baseNormalized,
      ...connectorPatch
    };
  }

  private resolveIncomingConnector(dto: IngestSupportEventDto): SupportConnectorRoute {
    const incomingMeta = dto.meta ?? dto.metadata;
    const rawConnector = this.readStringValue(dto.connector);
    const rawChannel = this.readStringValue(dto.channel);
    const metaConnector = this.extractMetaPathString(incomingMeta, ['connector']);
    const metaChannel = this.extractMetaPathString(incomingMeta, ['channel']);

    const candidates = [rawConnector, rawChannel, metaConnector, metaChannel];
    for (const candidate of candidates) {
      const resolved = this.connectorRegistry.resolveRoute(candidate);
      if (resolved) {
        return resolved;
      }
    }

    throw new BadRequestException('connector is required');
  }

  private buildConnectorNormalizationHelpers(): SupportConnectorNormalizationHelpers {
    return {
      normalizeIdentityValue: (raw?: string) => this.normalizeIdentityValue(raw),
      normalizeDisplayName: (raw?: string) => this.normalizeDisplayName(raw),
      normalizeStationId: (raw?: string) => this.normalizeStationId(raw),
      extractMetaPathString: (
        meta: Record<string, unknown> | undefined,
        path: string[]
      ) => this.extractMetaPathString(meta, path),
      resolveSenderIsBot: (dto: IngestSupportEventDto) => this.resolveSenderIsBot(dto),
      resolveStationMappingFromAction: (action?: string): SupportStationMappingMatch | undefined => {
        const mapping = this.resolveStationMappingFromAction(action);
        if (!mapping) {
          return undefined;
        }
        return {
          stationId: mapping.stationId,
          stationName: mapping.stationName
        };
      },
      resolveDeliverToClient: (dto: IngestSupportEventDto) => this.resolveDeliverToClient(dto)
    };
  }

  private resolveDeliverToClient(dto: IngestSupportEventDto): boolean {
    if (typeof dto.deliverToClient === 'boolean') {
      return dto.deliverToClient;
    }

    const metaDeliverToClient = this.extractMetaPath(dto.meta, ['deliverToClient']);
    if (typeof metaDeliverToClient === 'boolean') {
      return metaDeliverToClient;
    }

    const source = this.extractMetaPathString(dto.meta, ['source'])?.toLowerCase();
    return source === 'viva_crm';
  }

  private shouldDeliverIncomingEventToClient(
    dto: NormalizedIngestSupportEventDto,
    direction: SupportMessageDirection
  ): boolean {
    return Boolean(dto.deliverToClient) && direction === SupportMessageDirection.SYSTEM;
  }

  private resolveSenderIsBot(dto: IngestSupportEventDto): boolean {
    if (typeof dto.senderIsBot === 'boolean') {
      return dto.senderIsBot;
    }
    const metaValue = this.extractMetaPath(dto.meta, ['data', 'sender', 'is_bot']);
    return metaValue === true;
  }

  private resolveStationMappingFromAction(action?: string): SupportStationMapping | undefined {
    const normalizedAction = this.normalizeIdentityValue(action)?.toLowerCase();
    if (!normalizedAction) {
      return undefined;
    }
    return this.stationMappings.find((mapping) => {
      const mappingKey = this.normalizeIdentityValue(mapping.key)?.toLowerCase();
      const mappingStationId = this.normalizeStationId(mapping.stationId)?.toLowerCase();
      const mappingStationName = this.normalizeDisplayName(mapping.stationName)?.toLowerCase();
      return (
        (mappingKey && mappingKey === normalizedAction) ||
        (mappingStationId && mappingStationId === normalizedAction) ||
        (mappingStationName && mappingStationName === normalizedAction)
      );
    });
  }

  private parseStationMappings(): SupportStationMapping[] {
    const raw = String(process.env.TELEGRAM_STATION_MAPPINGS ?? '').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<
          Partial<SupportStationMapping> & { callbackKey?: string }
        >;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .map((item) => ({
              key: String(item.key ?? item.callbackKey ?? '').trim().toLowerCase(),
              stationId: String(item.stationId ?? '').trim(),
              stationName: String(item.stationName ?? '').trim()
            }))
            .filter(
              (item) =>
                item.key.length > 0 &&
                item.stationId.length > 0 &&
                item.stationName.length > 0
            );
        }
      } catch (_error) {
        // ignore invalid env and fallback to defaults
      }
    }

    return [
      { key: 'yas', stationId: 'Yasenevo', stationName: 'Ясенево' },
      { key: 'nagat', stationId: 'Nagatinskaya', stationName: 'Нагатинская' },
      { key: 'nagat_p', stationId: 'NagatinskayaP', stationName: 'Нагатинская Премиум' },
      { key: 'tereh', stationId: 'Terehovo', stationName: 'Терехово' },
      { key: 'kuncev', stationId: 'Skolkovo', stationName: 'Сколково' },
      { key: 'sochi', stationId: 'Sochi', stationName: 'Сочи' },
      { key: 'seleger', stationId: 'seleger', stationName: 'Селигерская' },
      { key: 't-sbora', stationId: 'care_service', stationName: 'Точка сбора' }
    ];
  }

  private extractMetaPathString(
    meta: Record<string, unknown> | undefined,
    path: string[]
  ): string | undefined {
    const value = this.extractMetaPath(meta, path);
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    return undefined;
  }

  private extractMetaPath(
    meta: Record<string, unknown> | undefined,
    path: string[]
  ): unknown {
    let current: unknown = meta;
    for (const key of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  private includesAny(text: string, probes: string[]): boolean {
    return probes.some((probe) => text.includes(probe));
  }

  private averageOf(values: number[]): number | undefined {
    if (values.length === 0) {
      return undefined;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  private maxDate(values: Array<string | undefined>): string | undefined {
    const timestamps = values
      .map((value) => this.toTimestamp(value))
      .filter((value) => value > 0);
    if (timestamps.length === 0) {
      return undefined;
    }
    return new Date(Math.max(...timestamps)).toISOString();
  }

  private numberOrZero(value?: number): number {
    return typeof value === 'number' ? value : 0;
  }

  private toTimestamp(value?: string): number {
    if (!value) {
      return 0;
    }
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  private resolveAnalyticsStart(date?: string): Date {
    const value = String(date ?? '').trim();
    if (!value) {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    return parsed;
  }

  private countByEnum<TItem, TKey extends string>(
    items: SupportMessage[],
    reducer: (item: SupportMessage, counts: Map<TKey, number>) => Map<TKey, number>,
    mapper: (key: TKey, count: number) => TItem,
    order: TKey[]
  ): TItem[] {
    let counts = new Map<TKey, number>();
    for (const item of items) {
      counts = reducer(item, counts);
    }
    return order
      .filter((key) => counts.has(key))
      .map((key) => mapper(key, counts.get(key) ?? 0));
  }
}
