import * as assert from 'node:assert/strict';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { MessengerController } from '../src/messenger/messenger.controller';
import {
  MessengerPersistedState,
  MessengerPersistenceService
} from '../src/messenger/messenger-persistence.service';
import { MessengerService } from '../src/messenger/messenger.service';
import {
  ChatMessage,
  ChatThread,
  ConnectorRoute,
  MessageOrigin,
  ThreadStatus
} from '../src/messenger/messenger.types';

class InMemoryMessengerPersistence {
  private state: MessengerPersistedState;

  constructor(initialState: MessengerPersistedState) {
    this.state = structuredClone(initialState);
  }

  isEnabled(): boolean {
    return true;
  }

  async loadState(): Promise<MessengerPersistedState> {
    return structuredClone(this.state);
  }

  persistThread(thread: ChatThread): void {
    const threads = this.state.threads.filter((item) => item.id !== thread.id);
    threads.push(structuredClone(thread));
    this.state = {
      ...this.state,
      threads
    };
  }

  persistMessage(): void {}

  persistStation(): void {}

  persistConnector(): void {}

  persistAccessRule(): void {}

  persistResponseMetrics(): void {}

  persistAiConfig(): void {}

  persistAiInsight(): void {}

  persistAiSuggestion(): void {}
}

function createQuickRepliesStub() {
  return {
    listRules() {
      return [];
    },
    registerUsage() {}
  };
}

function createSupportServiceStub() {
  return {
    listDialogs() {
      return [];
    },
    async listDialogsByPhone() {
      return [];
    },
    async hydrateFromPersistence() {}
  };
}

function createResolvedPromoThread(): ChatThread {
  return {
    id: 'promo-thread-1',
    connector: ConnectorRoute.PROMO_WEB_MESSENGER,
    stationId: 'promo',
    stationName: 'promo',
    clientId: 'promo-client-1',
    subject: 'Промо диалог',
    status: ThreadStatus.OPEN,
    isResolved: true,
    resolvedAt: '2026-04-20T09:52:30.291Z',
    resolvedByUserId: 'AG',
    lastMessageAt: '2026-04-15T18:47:36.933Z',
    lastRankingMessageAt: '2026-04-15T18:47:36.933Z',
    lastStaffReadAt: '2026-04-15T18:47:36.933Z',
    createdAt: '2026-04-15T18:40:00.000Z',
    updatedAt: '2026-04-20T09:52:30.291Z'
  };
}

function createResolvedPromoMessage(): ChatMessage {
  return {
    id: 'promo-message-1',
    threadId: 'promo-thread-1',
    senderId: 'promo-client-1',
    senderRole: Role.CLIENT,
    origin: MessageOrigin.HUMAN,
    text: '79150986688',
    createdAt: '2026-04-15T18:47:36.933Z'
  };
}

function createResolvedRegularThread(): ChatThread {
  return {
    id: 'regular-thread-1',
    connector: ConnectorRoute.MAX_BOT,
    stationId: 'Yasenevo',
    stationName: 'Ясенево',
    clientId: 'client-1',
    subject: 'Обычный чат',
    status: ThreadStatus.OPEN,
    isResolved: true,
    resolvedAt: '2026-04-20T10:00:00.000Z',
    resolvedByUserId: 'AG',
    lastMessageAt: '2026-04-20T09:45:00.000Z',
    lastRankingMessageAt: '2026-04-20T09:45:00.000Z',
    lastStaffReadAt: '2026-04-20T09:45:00.000Z',
    createdAt: '2026-04-20T09:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z'
  };
}

function createResolvedRegularMessage(): ChatMessage {
  return {
    id: 'regular-message-1',
    threadId: 'regular-thread-1',
    senderId: 'client-1',
    senderRole: Role.CLIENT,
    origin: MessageOrigin.HUMAN,
    text: 'Добрый день',
    createdAt: '2026-04-20T09:45:00.000Z'
  };
}

function createService(
  persistence: InMemoryMessengerPersistence
): MessengerService {
  return new MessengerService(
    {} as never,
    createQuickRepliesStub() as never,
    persistence as unknown as MessengerPersistenceService
  );
}

function createUser(): RequestUser {
  return {
    id: 'super-admin-1',
    roles: [Role.SUPER_ADMIN],
    stationIds: [],
    connectorRoutes: [ConnectorRoute.PROMO_WEB_MESSENGER, ConnectorRoute.MAX_BOT]
  };
}

async function main(): Promise<void> {
  const persistence = new InMemoryMessengerPersistence({
    threads: [createResolvedPromoThread(), createResolvedRegularThread()],
    messages: [createResolvedPromoMessage(), createResolvedRegularMessage()],
    stations: [],
    connectors: [],
    accessRules: [],
    metrics: [],
    aiConfigs: [],
    aiInsights: [],
    aiSuggestions: []
  });
  const user = createUser();

  const service = createService(persistence);
  await (service as any).hydrateFromPersistence();

  const summaries = service.listDialogs(user);
  assert.equal(summaries.length, 2);
  assert.equal(
    summaries.find((item) => item.threadId === 'promo-thread-1')?.pendingClientMessagesCount,
    0
  );
  assert.equal(
    summaries.find((item) => item.threadId === 'regular-thread-1')?.pendingClientMessagesCount,
    0
  );

  const controller = new MessengerController(
    service,
    createSupportServiceStub() as never,
    {} as never,
    {} as never
  );
  const visible = await controller.listDialogs(user, {});

  assert.deepEqual(
    visible.map((item) => item.threadId),
    ['regular-thread-1']
  );

  console.log('Messenger promo dialog visibility test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
