import * as assert from 'node:assert/strict';
import { Role } from '../src/common/rbac/role.enum';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import {
  SupportClientLookupQuery,
  SupportPersistedState,
  SupportPersistenceService
} from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import {
  SupportClientAuthStatus,
  SupportClientIdentity,
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

  persistClient(client: SupportPersistedState['clients'][number]): void {
    const clients = this.state.clients.filter((item) => item.id !== client.id);
    clients.push(structuredClone(client));
    this.state = {
      ...this.state,
      clients
    };
  }

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

  async findClients(query: SupportClientLookupQuery) {
    const phone = normalizePhone(query.phone);
    const email = normalizeEmail(query.email);
    const externalUserId = normalizeIdentity(query.externalUserId);
    const externalChatId = normalizeIdentity(query.externalChatId);
    const username = normalizeIdentity(query.username);
    const connector = query.connector;

    return this.state.clients.filter((client) => {
      if (phone && client.phones.includes(phone)) {
        return true;
      }
      if (email && client.emails.includes(email)) {
        return true;
      }
      if (!connector) {
        return false;
      }
      return client.identities.some((identity) =>
        matchesIdentity(identity, connector, externalUserId, externalChatId, username)
      );
    });
  }

  async findDialogsByClientId(clientId: string): Promise<SupportDialog[]> {
    return this.state.dialogs.filter((dialog) => dialog.clientId === clientId);
  }

  snapshot(): SupportPersistedState {
    return structuredClone(this.state);
  }
}

function normalizePhone(raw?: string): string | undefined {
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

function normalizeEmail(raw?: string): string | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value || undefined;
}

function normalizeIdentity(raw?: string): string | undefined {
  const value = String(raw ?? '').trim();
  return value || undefined;
}

function matchesIdentity(
  identity: SupportClientIdentity,
  connector: SupportConnectorRoute,
  externalUserId?: string,
  externalChatId?: string,
  username?: string
): boolean {
  if (identity.connector !== connector) {
    return false;
  }
  if (externalUserId && normalizeIdentity(identity.externalUserId) === externalUserId) {
    return true;
  }
  if (externalChatId && normalizeIdentity(identity.externalChatId) === externalChatId) {
    return true;
  }
  if (username && normalizeIdentity(identity.username) === username) {
    return true;
  }
  return false;
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

function createService(persistence: InMemorySupportPersistence): SupportService {
  return new SupportService(
    persistence as unknown as SupportPersistenceService,
    createConnectorRegistry(),
    createQuickRepliesStub() as never
  );
}

async function main(): Promise<void> {
  const previousSyncInterval = process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS;
  const persistedClient = {
    id: 'client-max-1',
    displayName: 'MAX User',
    authStatus: SupportClientAuthStatus.VERIFIED,
    unverifiedTextAttempts: 0,
    primaryPhone: '79990000000',
    phones: ['79990000000'],
    emails: [],
    identities: [
      {
        connector: SupportConnectorRoute.MAX_BOT,
        externalUserId: 'max-user-1',
        externalChatId: 'max-chat-1',
        username: 'maxuser',
        displayName: 'MAX User',
        linkedAt: '2026-06-09T10:00:00.000Z',
        lastSeenAt: '2026-06-09T10:05:00.000Z'
      }
    ],
    currentStationId: 'Nagatinskaya',
    currentStationName: 'Нагатинская',
    createdAt: '2026-06-09T10:00:00.000Z',
    updatedAt: '2026-06-09T10:05:00.000Z'
  };
  const persistedDialog: SupportDialog = {
    id: 'dialog-max-1',
    clientId: persistedClient.id,
    stationId: 'Nagatinskaya',
    stationName: 'Нагатинская',
    accessStationIds: ['Nagatinskaya'],
    writeStationIds: ['Nagatinskaya'],
    readOnlyStationIds: [],
    status: SupportDialogStatus.OPEN,
    authStatus: SupportClientAuthStatus.VERIFIED,
    currentPhone: '79990000000',
    phones: ['79990000000'],
    emails: [],
    connectors: [SupportConnectorRoute.MAX_BOT],
    lastInboundConnector: SupportConnectorRoute.MAX_BOT,
    lastReplyConnector: undefined,
    subject: 'MAX User',
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
    lastMessageAt: '2026-06-09T10:05:00.000Z',
    lastRankingMessageAt: '2026-06-09T10:05:00.000Z',
    lastMessageText: 'Нужна помощь',
    lastMessageSenderRole: Role.CLIENT,
    lastClientMessageAt: '2026-06-09T10:05:00.000Z',
    lastStaffMessageAt: undefined,
    ai: undefined,
    settings: undefined,
    createdAt: '2026-06-09T10:00:00.000Z',
    updatedAt: '2026-06-09T10:05:00.000Z'
  };

  const lookupPersistence = new InMemorySupportPersistence({
    clients: [persistedClient],
    dialogs: [persistedDialog],
    messages: [],
    responseMetrics: [],
    outbox: []
  });
  const lookupService = createService(lookupPersistence);

  const resolved = await lookupService.resolveClient({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'max-user-1',
    externalChatId: 'max-chat-1'
  });

  assert.ok(resolved.client);
  assert.equal(resolved.client?.id, 'client-max-1');
  assert.equal(resolved.client?.currentStationId, 'Nagatinskaya');
  assert.equal(resolved.dialogs.length, 1);
  assert.equal(resolved.dialogs[0]?.stationId, 'Nagatinskaya');

  const maxPersistence = new InMemorySupportPersistence({
    clients: [],
    dialogs: [],
    messages: [],
    responseMetrics: [],
    outbox: []
  });
  const maxService = createService(maxPersistence);

  await maxService.ingestEvent({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'max-user-2',
    externalChatId: 'max-chat-2',
    phone: '+7 (999) 111-22-33',
    direction: SupportMessageDirection.INBOUND,
    kind: SupportMessageKind.CONTACT,
    eventType: 'CONTACT'
  });

  const stationSelection = await maxService.ingestEvent({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'max-user-2',
    externalChatId: 'max-chat-2',
    direction: SupportMessageDirection.INBOUND,
    kind: SupportMessageKind.STATION_SELECTION,
    selectedStationId: 'nagat',
    selectedStationName: 'Нагатинская'
  });

  assert.equal(stationSelection.client.currentStationId, 'Nagatinskaya');
  assert.equal(stationSelection.client.currentStationName, 'Нагатинская');
  assert.equal(stationSelection.dialog.stationId, 'Nagatinskaya');

  const followUp = await maxService.ingestEvent({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'max-user-2',
    externalChatId: 'max-chat-2',
    direction: SupportMessageDirection.INBOUND,
    text: 'Нужна помощь'
  });

  assert.equal(followUp.client.currentStationId, 'Nagatinskaya');
  assert.equal(followUp.dialog.stationId, 'Nagatinskaya');
  assert.equal(followUp.requiredAction, undefined);

  const snapshot = maxPersistence.snapshot();
  const storedClient = snapshot.clients.find((client) => client.id === followUp.client.id);
  assert.equal(storedClient?.currentStationId, 'Nagatinskaya');

  const serviceDelivery = await maxService.ingestEvent({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'max-user-2',
    externalChatId: 'max-chat-2',
    phone: '+7 (999) 111-22-33',
    direction: SupportMessageDirection.SYSTEM,
    deliverToClient: true,
    text: 'Код авторизации: 8488',
    meta: {
      source: 'viva_crm'
    }
  });

  assert.equal(serviceDelivery.message?.text, 'Код авторизации: 8488');
  assert.equal(serviceDelivery.outbox?.text, 'Код авторизации: 8488');

  process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS = '0';
  const restartPersistence = new InMemorySupportPersistence({
    clients: [persistedClient],
    dialogs: [persistedDialog],
    messages: [],
    responseMetrics: [],
    outbox: []
  });
  const serviceAfterRestart = createService(restartPersistence);
  try {
    await serviceAfterRestart.onModuleInit();
    const postRestartServiceDelivery = await serviceAfterRestart.ingestEvent({
      connector: SupportConnectorRoute.MAX_BOT,
      phone: '+7 (999) 000-00-00',
      direction: SupportMessageDirection.SYSTEM,
      kind: SupportMessageKind.SYSTEM,
      deliverToClient: true,
      text: 'Код авторизации: 5555',
      meta: {
        source: 'viva_crm'
      }
    });

    assert.equal(postRestartServiceDelivery.client.id, persistedClient.id);
    assert.equal(postRestartServiceDelivery.message?.text, 'Код авторизации: 5555');
    assert.equal(postRestartServiceDelivery.outbox?.text, 'Код авторизации: 5555');
    assert.equal(postRestartServiceDelivery.outbox?.targetExternalUserId, 'max-user-1');
    assert.equal(postRestartServiceDelivery.outbox?.targetExternalChatId, 'max-chat-1');
  } finally {
    serviceAfterRestart.onModuleDestroy();
    if (previousSyncInterval === undefined) {
      delete process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS;
    } else {
      process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS = previousSyncInterval;
    }
  }

  console.log('Support client resolve and MAX station selection tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
