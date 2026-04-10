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
  SupportDialogStatus
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

  persistDialog(dialog: SupportDialog): void {
    const dialogs = this.state.dialogs.filter((item) => item.id !== dialog.id);
    dialogs.push(structuredClone(dialog));
    this.state = {
      ...this.state,
      dialogs
    };
  }

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
    }
  };
}

function createDialog(): SupportDialog {
  const createdAt = '2026-04-09T10:00:00.000Z';
  return {
    id: 'dialog-promo-1',
    clientId: 'client-1',
    stationId: 'promo',
    stationName: 'promo',
    accessStationIds: ['promo'],
    writeStationIds: ['promo'],
    readOnlyStationIds: [],
    status: SupportDialogStatus.OPEN,
    authStatus: SupportClientAuthStatus.VERIFIED,
    currentPhone: '79170000000',
    phones: ['79170000000'],
    emails: [],
    connectors: [SupportConnectorRoute.PROMO_WEB_MESSENGER],
    lastInboundConnector: SupportConnectorRoute.PROMO_WEB_MESSENGER,
    lastReplyConnector: undefined,
    subject: 'Диалог promo',
    unreadCount: 2,
    hasUnreadMessages: true,
    hasNewMessages: true,
    isResolved: false,
    resolvedAt: undefined,
    resolvedByUserId: undefined,
    waitingForStaffSince: createdAt,
    pendingClientMessageIds: ['m-1', 'm-2'],
    responseTimeTotalMs: 0,
    responseCount: 0,
    averageFirstResponseMs: undefined,
    lastFirstResponseMs: undefined,
    lastMessageAt: createdAt,
    lastRankingMessageAt: createdAt,
    lastMessageText: 'Нужна помощь',
    lastMessageSenderRole: Role.CLIENT,
    lastClientMessageAt: createdAt,
    lastStaffMessageAt: undefined,
    ai: undefined,
    settings: undefined,
    createdAt,
    updatedAt: createdAt
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
    stationIds: ['promo'],
    connectorRoutes: [SupportConnectorRoute.PROMO_WEB_MESSENGER]
  };
}

async function main(): Promise<void> {
  const persistence = new InMemorySupportPersistence({
    clients: [
      {
        id: 'client-1',
        displayName: 'Promo User',
        authStatus: SupportClientAuthStatus.VERIFIED,
        unverifiedTextAttempts: 0,
        primaryPhone: '79170000000',
        phones: ['79170000000'],
        emails: [],
        identities: [],
        currentStationId: 'promo',
        currentStationName: SUPPORT_UNASSIGNED_STATION_NAME,
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T10:00:00.000Z'
      }
    ],
    dialogs: [createDialog()],
    messages: [],
    responseMetrics: [],
    outbox: []
  });
  const user = createUser();

  const serviceBeforeRestart = createService(persistence);
  await serviceBeforeRestart.hydrateFromPersistence();
  const updated = serviceBeforeRestart.setDialogResolution('dialog-promo-1', true, user);

  assert.equal(updated.isResolved, true);
  assert.equal(updated.unreadCount, 0);
  assert.equal(updated.hasUnreadMessages, false);
  assert.equal(updated.pendingClientMessagesCount, 0);

  const serviceAfterRestart = createService(persistence);
  await serviceAfterRestart.hydrateFromPersistence();
  const reloaded = serviceAfterRestart.getDialogSummary('dialog-promo-1', user);

  assert.equal(reloaded.isResolved, true);
  assert.equal(reloaded.unreadCount, 0);
  assert.equal(reloaded.hasUnreadMessages, false);
  assert.equal(reloaded.pendingClientMessagesCount, 0);

  console.log('Support dialog resolution persistence test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
