import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import {
  SupportPersistedState,
  SupportPersistenceService
} from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import {
  SupportClientAuthStatus,
  SupportConnectorRoute,
  SupportDialog,
  SupportDialogStatus,
  SupportMessage,
  SupportMessageDirection,
  SupportMessageKind
} from '../src/support/support.types';

class InMemorySupportPersistence {
  constructor(private readonly state: SupportPersistedState) {}

  isEnabled(): boolean {
    return true;
  }

  async loadState(): Promise<SupportPersistedState> {
    return structuredClone(this.state);
  }

  persistClient(): void {}

  persistDialog(): void {}

  persistMessage(): void {}

  persistServiceMessage(): void {}

  persistResponseMetric(): void {}

  persistOutboxCommand(): void {}

  async findServiceMessages(): Promise<[]> {
    return [];
  }

  async getRuntimeDiagnostics(): Promise<never> {
    throw new Error('Not implemented for this test');
  }

  async findDialogIdsByPhone(): Promise<string[]> {
    return [];
  }
}

function createConnectorRegistry(): SupportConnectorRegistry {
  return {
    resolveRoute(rawRoute: unknown): SupportConnectorRoute | undefined {
      const normalized = String(rawRoute ?? '').trim().toUpperCase();
      return Object.values(SupportConnectorRoute).find((value) => value === normalized);
    },
    listEntries() {
      return [];
    },
    normalizeIncomingEvent() {
      return {};
    }
  } as unknown as SupportConnectorRegistry;
}

function createQuickRepliesStub() {
  return {
    registerUsage() {},
    listRules() {
      return [];
    },
    findMatchingRules() {
      return [];
    }
  };
}

function createDialog(): SupportDialog {
  return {
    id: 'dialog-1',
    clientId: 'client-1',
    stationId: 'station-1',
    stationName: 'Station 1',
    accessStationIds: ['station-1'],
    writeStationIds: ['station-1'],
    readOnlyStationIds: [],
    status: SupportDialogStatus.OPEN,
    authStatus: SupportClientAuthStatus.VERIFIED,
    currentPhone: '79990000000',
    phones: ['79990000000'],
    emails: [],
    connectors: [SupportConnectorRoute.LK_WEB_MESSENGER],
    lastInboundConnector: SupportConnectorRoute.LK_WEB_MESSENGER,
    lastReplyConnector: undefined,
    subject: 'Dialog',
    unreadCount: 0,
    hasUnreadMessages: false,
    hasNewMessages: false,
    isResolved: false,
    resolvedAt: undefined,
    resolvedByUserId: undefined,
    waitingForStaffSince: undefined,
    pendingClientMessageIds: [],
    responseTimeTotalMs: 0,
    responseCount: 0,
    averageFirstResponseMs: undefined,
    lastFirstResponseMs: undefined,
    lastMessageAt: '2026-04-09T10:02:00.000Z',
    lastRankingMessageAt: '2026-04-09T10:02:00.000Z',
    lastMessageText: 'three',
    lastMessageSenderRole: Role.CLIENT,
    lastClientMessageAt: '2026-04-09T10:02:00.000Z',
    lastStaffMessageAt: undefined,
    ai: undefined,
    settings: undefined,
    createdAt: '2026-04-09T10:00:00.000Z',
    updatedAt: '2026-04-09T10:02:00.000Z'
  };
}

function createMessage(id: string, createdAt: string): SupportMessage {
  return {
    id,
    dialogId: 'dialog-1',
    clientId: 'client-1',
    connector: SupportConnectorRoute.LK_WEB_MESSENGER,
    direction: SupportMessageDirection.INBOUND,
    kind: SupportMessageKind.TEXT,
    text: id,
    createdAt,
    senderId: 'client-1',
    senderRole: Role.CLIENT
  };
}

function createService(persistence: InMemorySupportPersistence): SupportService {
  return new SupportService(
    persistence as unknown as SupportPersistenceService,
    createConnectorRegistry(),
    createQuickRepliesStub() as never
  );
}

function createUser(): RequestUser {
  return {
    id: 'support-1',
    roles: [Role.SUPPORT],
    stationIds: ['station-1'],
    connectorRoutes: [SupportConnectorRoute.LK_WEB_MESSENGER]
  };
}

async function main(): Promise<void> {
  const previousRangeDays = process.env.SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS;
  const previousDialogs = process.env.SUPPORT_DIALOGS_EXPORT_MAX_DIALOGS;
  const previousMessages = process.env.SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES;

  try {
    const persistence = new InMemorySupportPersistence({
      clients: [
        {
          id: 'client-1',
          displayName: 'Client 1',
          authStatus: SupportClientAuthStatus.VERIFIED,
          unverifiedTextAttempts: 0,
          primaryPhone: '79990000000',
          phones: ['79990000000'],
          emails: [],
          identities: [],
          currentStationId: 'station-1',
          currentStationName: 'Station 1',
          createdAt: '2026-04-09T10:00:00.000Z',
          updatedAt: '2026-04-09T10:00:00.000Z'
        }
      ],
      dialogs: [createDialog()],
      messages: [
        createMessage('one', '2026-04-09T10:00:00.000Z'),
        createMessage('two', '2026-04-09T10:01:00.000Z'),
        createMessage('three', '2026-04-09T10:02:00.000Z')
      ],
      responseMetrics: [],
      outbox: []
    });
    const user = createUser();

    process.env.SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS = '1';
    process.env.SUPPORT_DIALOGS_EXPORT_MAX_DIALOGS = '10';
    process.env.SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES = '10';

    const rangeLimitedService = createService(persistence);
    await rangeLimitedService.hydrateFromPersistence();
    assert.throws(
      () => rangeLimitedService.getDialogsExport({ from: '2026-04-09', to: '2026-04-11' }, user),
      (error: unknown) =>
        error instanceof BadRequestException
        && String(error.message).includes('SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS')
    );

    process.env.SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS = '31';
    process.env.SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES = '2';

    const messageLimitedService = createService(persistence);
    await messageLimitedService.hydrateFromPersistence();
    assert.throws(
      () => messageLimitedService.getDialogsExport({ from: '2026-04-09', to: '2026-04-09' }, user),
      (error: unknown) =>
        error instanceof BadRequestException
        && String(error.message).includes('SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES')
    );

    console.log('Support dialogs export guard test passed');
  } finally {
    if (previousRangeDays === undefined) {
      delete process.env.SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS;
    } else {
      process.env.SUPPORT_DIALOGS_EXPORT_MAX_RANGE_DAYS = previousRangeDays;
    }
    if (previousDialogs === undefined) {
      delete process.env.SUPPORT_DIALOGS_EXPORT_MAX_DIALOGS;
    } else {
      process.env.SUPPORT_DIALOGS_EXPORT_MAX_DIALOGS = previousDialogs;
    }
    if (previousMessages === undefined) {
      delete process.env.SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES;
    } else {
      process.env.SUPPORT_DIALOGS_EXPORT_MAX_MESSAGES = previousMessages;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
