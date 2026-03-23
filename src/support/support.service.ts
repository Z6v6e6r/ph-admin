import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { IngestSupportEventDto } from './dto/ingest-support-event.dto';
import { ReplySupportDialogDto } from './dto/reply-support-dialog.dto';
import { SupportPersistenceService } from './support-persistence.service';
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
}

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly clients = new Map<string, SupportClientProfile>();
  private readonly dialogs = new Map<string, SupportDialog>();
  private readonly messages = new Map<string, SupportMessage[]>();
  private readonly responseMetrics = new Map<string, SupportResponseMetric[]>();
  private readonly outbox = new Map<string, SupportOutboxCommand>();

  constructor(private readonly persistence: SupportPersistenceService) {}

  async onModuleInit(): Promise<void> {
    await this.hydrateFromPersistence();
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

    for (const client of state.clients) {
      this.clients.set(client.id, client);
    }

    for (const dialog of state.dialogs) {
      this.dialogs.set(dialog.id, dialog);
      this.messages.set(dialog.id, []);
      this.responseMetrics.set(dialog.id, []);
    }

    for (const message of state.messages) {
      const existing = this.messages.get(message.dialogId) ?? [];
      existing.push(message);
      this.messages.set(message.dialogId, existing);
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

  ingestEvent(dto: IngestSupportEventDto): SupportIngestEventResult {
    const createdAt = this.resolveEventTimestamp(dto.timestamp);
    const normalizedPhone = this.normalizePhone(dto.phone);
    const normalizedEmail = this.normalizeEmail(dto.email);
    const client = this.resolveOrCreateClient(dto, normalizedPhone, normalizedEmail, createdAt);

    const selectedStationId = this.normalizeStationId(
      dto.selectedStationId ?? dto.stationId
    );
    const stationId =
      selectedStationId ??
      this.normalizeStationId(client.currentStationId) ??
      SUPPORT_UNASSIGNED_STATION_ID;
    const stationName =
      this.resolveStationName(
        dto.selectedStationName ?? dto.stationName,
        client.currentStationName,
        stationId
      ) ?? SUPPORT_UNASSIGNED_STATION_NAME;

    if (selectedStationId) {
      client.currentStationId = stationId;
      client.currentStationName = stationName;
      client.updatedAt = createdAt;
      this.persistClient(client);
    }

    const dialog = this.resolveDialog(client, stationId, stationName, dto.subject, createdAt);
    const kind = this.resolveMessageKind(dto, normalizedPhone, normalizedEmail);
    const direction = dto.direction ?? SupportMessageDirection.INBOUND;
    const senderRole: SupportSenderRole =
      direction === SupportMessageDirection.SYSTEM ? 'SYSTEM' : Role.CLIENT;

    const message = this.shouldCreateMessage(dto, kind, normalizedPhone, normalizedEmail)
      ? this.buildMessage(dto, {
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

    dialog.authStatus = client.authStatus;
    dialog.currentPhone = client.primaryPhone;
    dialog.phones = [...client.phones];
    dialog.emails = [...client.emails];
    dialog.connectors = this.mergeConnectors(dialog.connectors, [dto.connector]);
    dialog.lastInboundConnector =
      direction === SupportMessageDirection.INBOUND ? dto.connector : dialog.lastInboundConnector;
    dialog.subject = dialog.subject ?? this.buildDialogSubject(client, stationName);
    dialog.updatedAt = createdAt;

    if (message) {
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
    }

    this.persistDialog(dialog);

    return {
      client,
      dialog,
      message,
      requiredAction:
        client.authStatus !== SupportClientAuthStatus.VERIFIED
          ? 'REQUEST_CONTACT'
          : dialog.stationId === SUPPORT_UNASSIGNED_STATION_ID
            ? 'REQUEST_STATION'
            : undefined,
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
    return this.listAccessibleDialogs(user)
      .filter(
        (dialog) => dialog.stationId === stationId && dialog.connectors.includes(connector)
      )
      .map((dialog) => this.toDialogSummary(dialog, connector))
      .sort((left, right) => {
        if (left.unreadCount > 0 && right.unreadCount === 0) {
          return -1;
        }
        if (left.unreadCount === 0 && right.unreadCount > 0) {
          return 1;
        }
        return this.toTimestamp(right.lastMessageAt) - this.toTimestamp(left.lastMessageAt);
      });
  }

  listMessages(dialogId: string, user: RequestUser): SupportMessage[] {
    const dialog = this.getDialogOrThrow(dialogId);
    this.ensureDialogAccess(dialog, user);
    if (this.isStaff(user)) {
      dialog.unreadCount = 0;
      this.persistDialog(dialog);
    }
    return this.messages.get(dialog.id) ?? [];
  }

  replyToDialog(
    dialogId: string,
    dto: ReplySupportDialogDto,
    user: RequestUser
  ): { dialog: SupportDialog; message: SupportMessage; outbox?: SupportOutboxCommand } {
    const dialog = this.getDialogOrThrow(dialogId);
    this.ensureDialogAccess(dialog, user);
    this.ensureStaff(user);

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
      senderName: this.buildStaffLabel(senderRole)
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
          (identity) =>
            identity.connector === connector &&
            this.normalizeIdentityValue(identity.externalUserId) === normalizedExternalUserId
        );
      }
      if (connector && normalizedExternalChatId) {
        return client.identities.some(
          (identity) =>
            identity.connector === connector &&
            this.normalizeIdentityValue(identity.externalChatId) === normalizedExternalChatId
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
    dto: IngestSupportEventDto,
    normalizedPhone: string | undefined,
    normalizedEmail: string | undefined,
    createdAt: string
  ): SupportClientProfile {
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

    [byPhone, byEmail, byIdentity].forEach((client) => {
      if (client) {
        matchingIds.add(client.id);
      }
    });

    let client: SupportClientProfile;
    if (matchingIds.size === 0) {
      client = {
        id: randomUUID(),
        displayName: this.normalizeDisplayName(dto.displayName),
        authStatus: normalizedPhone
          ? SupportClientAuthStatus.VERIFIED
          : SupportClientAuthStatus.UNVERIFIED,
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
      client.displayName =
        this.normalizeDisplayName(dto.displayName) ?? client.displayName;
      client.updatedAt = createdAt;
    }

    if (normalizedPhone) {
      client.authStatus = SupportClientAuthStatus.VERIFIED;
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

    if (!client.displayName) {
      client.displayName = this.buildClientDisplayName(client, dto);
    }

    this.persistClient(client);
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
    this.clients.set(canonical.id, canonical);
    this.persistClient(canonical);
    return canonical;
  }

  private resolveDialog(
    client: SupportClientProfile,
    stationId: string,
    stationName: string,
    subject: string | undefined,
    createdAt: string
  ): SupportDialog {
    const existing = this.findOpenDialog(client.id, stationId);
    const unassigned =
      stationId !== SUPPORT_UNASSIGNED_STATION_ID
        ? this.findOpenDialog(client.id, SUPPORT_UNASSIGNED_STATION_ID)
        : undefined;

    if (existing && unassigned && existing.id !== unassigned.id) {
      const movedMessages = this.messages.get(unassigned.id) ?? [];
      const targetMessages = this.messages.get(existing.id) ?? [];
      const mergedMessages = [...targetMessages];
      for (const message of movedMessages) {
        const updatedMessage: SupportMessage = { ...message, dialogId: existing.id };
        mergedMessages.push(updatedMessage);
        this.persistence.persistMessage(updatedMessage);
      }
      mergedMessages.sort(
        (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
      );
      this.messages.set(existing.id, mergedMessages);
      this.messages.delete(unassigned.id);

      const movedMetrics = this.responseMetrics.get(unassigned.id) ?? [];
      const targetMetrics = this.responseMetrics.get(existing.id) ?? [];
      for (const metric of movedMetrics) {
        const updatedMetric: SupportResponseMetric = { ...metric, dialogId: existing.id };
        targetMetrics.push(updatedMetric);
        this.persistence.persistResponseMetric(updatedMetric);
      }
      targetMetrics.sort(
        (left, right) => this.toTimestamp(left.startedAt) - this.toTimestamp(right.startedAt)
      );
      this.responseMetrics.set(existing.id, targetMetrics);
      this.responseMetrics.delete(unassigned.id);

      for (const [commandId, command] of this.outbox.entries()) {
        if (command.dialogId !== unassigned.id) {
          continue;
        }
        const updatedCommand: SupportOutboxCommand = { ...command, dialogId: existing.id };
        this.outbox.set(commandId, updatedCommand);
        this.persistence.persistOutboxCommand(updatedCommand);
      }

      existing.unreadCount += unassigned.unreadCount;
      existing.pendingClientMessageIds = this.mergeIds(
        existing.pendingClientMessageIds,
        unassigned.pendingClientMessageIds
      );
      existing.waitingForStaffSince =
        this.toTimestamp(existing.waitingForStaffSince) > 0 &&
        this.toTimestamp(unassigned.waitingForStaffSince) > 0
          ? new Date(
              Math.min(
                this.toTimestamp(existing.waitingForStaffSince),
                this.toTimestamp(unassigned.waitingForStaffSince)
              )
            ).toISOString()
          : existing.waitingForStaffSince ?? unassigned.waitingForStaffSince;
      existing.responseTimeTotalMs += unassigned.responseTimeTotalMs;
      existing.responseCount += unassigned.responseCount;
      existing.averageFirstResponseMs =
        existing.responseCount > 0
          ? Math.round(existing.responseTimeTotalMs / existing.responseCount)
          : undefined;
      existing.lastFirstResponseMs = existing.lastFirstResponseMs ?? unassigned.lastFirstResponseMs;
      existing.lastMessageAt = this.maxDate([existing.lastMessageAt, unassigned.lastMessageAt]);
      existing.lastClientMessageAt = this.maxDate([
        existing.lastClientMessageAt,
        unassigned.lastClientMessageAt
      ]);
      existing.lastStaffMessageAt = this.maxDate([
        existing.lastStaffMessageAt,
        unassigned.lastStaffMessageAt
      ]);
      existing.connectors = this.mergeConnectors(existing.connectors, unassigned.connectors);
      existing.phones = this.mergeStrings(existing.phones, unassigned.phones);
      existing.emails = this.mergeStrings(existing.emails, unassigned.emails);
      existing.ai = existing.ai ?? unassigned.ai;
      this.dialogs.delete(unassigned.id);
      this.persistence.deleteDialog(unassigned.id);
    }

    if (existing) {
      existing.stationName = stationName;
      existing.subject = subject?.trim() || existing.subject;
      existing.authStatus = client.authStatus;
      existing.currentPhone = client.primaryPhone;
      existing.phones = [...client.phones];
      existing.emails = [...client.emails];
      existing.updatedAt = createdAt;
      return existing;
    }

    if (stationId !== SUPPORT_UNASSIGNED_STATION_ID) {
      if (unassigned) {
        unassigned.stationId = stationId;
        unassigned.stationName = stationName;
        unassigned.subject = subject?.trim() || unassigned.subject;
        unassigned.authStatus = client.authStatus;
        unassigned.currentPhone = client.primaryPhone;
        unassigned.phones = [...client.phones];
        unassigned.emails = [...client.emails];
        unassigned.updatedAt = createdAt;
        this.persistDialog(unassigned);
        return unassigned;
      }
    }

    const dialog: SupportDialog = {
      id: randomUUID(),
      clientId: client.id,
      stationId,
      stationName,
      status: SupportDialogStatus.OPEN,
      authStatus: client.authStatus,
      currentPhone: client.primaryPhone,
      phones: [...client.phones],
      emails: [...client.emails],
      connectors: [],
      lastInboundConnector: undefined,
      lastReplyConnector: undefined,
      subject: subject?.trim() || this.buildDialogSubject(client, stationName),
      unreadCount: 0,
      waitingForStaffSince: undefined,
      pendingClientMessageIds: [],
      responseTimeTotalMs: 0,
      responseCount: 0,
      averageFirstResponseMs: undefined,
      lastFirstResponseMs: undefined,
      lastMessageAt: undefined,
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
    dto: IngestSupportEventDto,
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
    return {
      id: randomUUID(),
      dialogId: context.dialog.id,
      clientId: context.client.id,
      connector: dto.connector,
      direction: context.direction,
      kind: context.kind,
      text: this.buildMessageText(context.kind, text, context.normalizedPhone, context.normalizedEmail, dto),
      createdAt: context.createdAt,
      senderId:
        context.direction === SupportMessageDirection.SYSTEM
          ? 'system'
          : dto.externalUserId?.trim() || context.client.id,
      senderRole: context.senderRole,
      senderName:
        this.normalizeDisplayName(dto.displayName) ??
        (context.senderRole === 'SYSTEM' ? 'Система' : context.client.displayName),
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
    existing.push(message);
    existing.sort(
      (left, right) => this.toTimestamp(left.createdAt) - this.toTimestamp(right.createdAt)
    );
    this.messages.set(dialog.id, existing);
    dialog.lastMessageAt = message.createdAt;
    dialog.updatedAt = message.createdAt;
    this.persistence.persistMessage(message);
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

    return {
      id: randomUUID(),
      dialogId: dialog.id,
      clientId: dialog.clientId,
      connector,
      text: message.text ?? '',
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
        phones: client.phones
      }
    };
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

  private toDialogSummary(
    dialog: SupportDialog,
    connector?: SupportConnectorRoute
  ): SupportDialogSummary {
    const client = this.clients.get(dialog.clientId);
    return {
      dialogId: dialog.id,
      connector: connector ?? dialog.lastInboundConnector ?? dialog.connectors[0] ?? SupportConnectorRoute.MAX_BOT,
      stationId: dialog.stationId,
      stationName: dialog.stationName,
      clientId: dialog.clientId,
      clientDisplayName: client?.displayName,
      authStatus: dialog.authStatus,
      primaryPhone: dialog.currentPhone,
      phones: [...dialog.phones],
      emails: [...dialog.emails],
      subject: dialog.subject,
      status: dialog.status,
      unreadCount: dialog.unreadCount,
      waitingForStaffSince: dialog.waitingForStaffSince,
      averageFirstResponseMs: dialog.averageFirstResponseMs,
      lastFirstResponseMs: dialog.lastFirstResponseMs,
      lastMessageAt: dialog.lastMessageAt,
      lastInboundConnector: dialog.lastInboundConnector,
      ai: dialog.ai
    };
  }

  private listAccessibleDialogs(user: RequestUser): SupportDialog[] {
    return Array.from(this.dialogs.values())
      .filter((dialog) => this.canAccessDialog(dialog, user))
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
    return user.stationIds.includes(dialog.stationId);
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
    this.clients.set(client.id, client);
    this.persistence.persistClient(client);
  }

  private persistDialog(dialog: SupportDialog): void {
    this.dialogs.set(dialog.id, dialog);
    this.persistence.persistDialog(dialog);
  }

  private findOpenDialog(clientId: string, stationId: string): SupportDialog | undefined {
    return Array.from(this.dialogs.values()).find(
      (dialog) =>
        dialog.clientId === clientId &&
        dialog.stationId === stationId &&
        dialog.status === SupportDialogStatus.OPEN
    );
  }

  private buildIdentity(
    dto: IngestSupportEventDto,
    createdAt: string
  ): SupportClientIdentity | undefined {
    const externalUserId = this.normalizeIdentityValue(dto.externalUserId);
    const externalChatId = this.normalizeIdentityValue(dto.externalChatId);
    if (!externalUserId && !externalChatId) {
      return undefined;
    }
    return {
      connector: dto.connector,
      externalUserId: externalUserId ?? externalChatId ?? '',
      externalChatId,
      externalThreadId: undefined,
      username: this.normalizeIdentityValue(dto.username),
      displayName: this.normalizeDisplayName(dto.displayName),
      linkedAt: createdAt,
      lastSeenAt: createdAt
    };
  }

  private upsertIdentity(
    identities: SupportClientIdentity[],
    nextIdentity: SupportClientIdentity
  ): SupportClientIdentity[] {
    const existingIndex = identities.findIndex(
      (identity) =>
        identity.connector === nextIdentity.connector &&
        identity.externalUserId === nextIdentity.externalUserId
    );
    if (existingIndex < 0) {
      return [...identities, nextIdentity];
    }

    const updated = [...identities];
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
    return Boolean(
      String(dto.text ?? '').trim() ||
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
    if (dto.kind) {
      return dto.kind;
    }
    if (dto.selectedStationId) {
      return SupportMessageKind.STATION_SELECTION;
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
    const text = String(dto.text ?? '').trim();
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
    return value || undefined;
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
    if (stationId === SUPPORT_UNASSIGNED_STATION_ID || !stationId) {
      return SUPPORT_UNASSIGNED_STATION_NAME;
    }
    return stationId;
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
    const label = client.displayName ?? client.primaryPhone ?? client.emails[0] ?? client.id;
    return `${stationName}: ${label}`;
  }

  private buildClientDisplayName(
    client: SupportClientProfile,
    dto: IngestSupportEventDto
  ): string {
    return (
      this.normalizeDisplayName(dto.displayName) ??
      client.primaryPhone ??
      client.emails[0] ??
      dto.username?.trim() ??
      `Клиент ${client.id.slice(0, 8)}`
    );
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
