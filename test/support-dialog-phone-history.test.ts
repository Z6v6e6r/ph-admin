import * as assert from 'node:assert/strict';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import {
  SupportPersistedState,
  SupportPersistenceService
} from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import {
  SUPPORT_UNASSIGNED_STATION_NAME,
  SupportClientAuthStatus,
  SupportConnectorRoute,
  SupportDialog,
  SupportDialogStatus,
  SupportMessageDirection,
  SupportMessageKind
} from '../src/support/support.types';

class InMemorySupportPersistence {
  private state: SupportPersistedState;

  constructor(initialState: SupportPersistedState) {
    this.state = structuredClone(initialState);
  }

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

  async findDialogIdsByPhone(phone: string): Promise<string[]> {
    if (phone !== '79954219839') {
      return [];
    }
    return ['dialog-empty', 'dialog-history'];
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
    }
  };
}

function createDialog(
  id: string,
  createdAt: string,
  updatedAt: string,
  lastMessageText: string
): SupportDialog {
  return {
    id,
    clientId: 'client-1',
    stationId: 'yasenevo',
    stationName: 'Ясенево',
    accessStationIds: ['yasenevo'],
    writeStationIds: ['yasenevo'],
    readOnlyStationIds: [],
    status: SupportDialogStatus.OPEN,
    authStatus: SupportClientAuthStatus.VERIFIED,
    currentPhone: '79954219839',
    phones: ['79954219839'],
    emails: [],
    connectors: [SupportConnectorRoute.LK_WEB_MESSENGER],
    lastInboundConnector: SupportConnectorRoute.LK_WEB_MESSENGER,
    lastReplyConnector: undefined,
    subject: 'Клиент 79954219839',
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
    lastMessageAt: updatedAt,
    lastRankingMessageAt: updatedAt,
    lastMessageText,
    lastMessageSenderRole: Role.CLIENT,
    lastClientMessageAt: updatedAt,
    lastStaffMessageAt: undefined,
    ai: undefined,
    settings: undefined,
    createdAt,
    updatedAt
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
    stationIds: ['yasenevo'],
    connectorRoutes: [SupportConnectorRoute.LK_WEB_MESSENGER]
  };
}

async function main(): Promise<void> {
  const persistence = new InMemorySupportPersistence({
    clients: [
      {
        id: 'client-1',
        displayName: 'Client 79954219839',
        authStatus: SupportClientAuthStatus.VERIFIED,
        unverifiedTextAttempts: 0,
        primaryPhone: '79954219839',
        phones: ['79954219839'],
        emails: [],
        identities: [],
        currentStationId: 'yasenevo',
        currentStationName: SUPPORT_UNASSIGNED_STATION_NAME,
        createdAt: '2026-06-05T10:00:00.000Z',
        updatedAt: '2026-06-05T10:00:00.000Z'
      }
    ],
    dialogs: [
      createDialog(
        'dialog-history',
        '2026-06-05T10:00:00.000Z',
        '2026-06-05T10:01:00.000Z',
        'Добрый день, я отменил бронь'
      ),
      createDialog(
        'dialog-empty',
        '2026-06-05T11:00:00.000Z',
        '2026-06-05T11:06:00.000Z',
        'Добрый день, я отменил бронь, мне же вернут деньги?'
      )
    ],
    messages: [
      {
        id: 'message-1',
        dialogId: 'dialog-history',
        clientId: 'client-1',
        connector: SupportConnectorRoute.LK_WEB_MESSENGER,
        direction: SupportMessageDirection.INBOUND,
        kind: SupportMessageKind.TEXT,
        text: 'Добрый день, я отменил бронь, мне же вернут деньги?',
        createdAt: '2026-06-05T11:06:00.000Z',
        senderId: 'client-1',
        senderRole: Role.CLIENT,
        senderName: 'Клиент',
        phone: '79954219839',
        email: undefined,
        stationId: 'yasenevo',
        stationName: 'Ясенево',
        ai: undefined
      }
    ],
    responseMetrics: [],
    outbox: []
  });
  const user = createUser();

  const service = createService(persistence);
  await service.hydrateFromPersistence();
  const messages = await service.listMessages('dialog-empty', user);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.dialogId, 'dialog-history');
  assert.equal(
    messages[0]?.text,
    'Добрый день, я отменил бронь, мне же вернут деньги?'
  );

  console.log('Support dialog phone history test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
