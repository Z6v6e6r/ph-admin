import * as assert from 'node:assert/strict';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import {
  SupportPersistedState,
  SupportPersistenceService
} from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import {
  SupportConnectorRoute,
  SupportOutboxCommand,
  SupportOutboxStatus
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

  persistOutboxCommand(command: SupportOutboxCommand): void {
    const outbox = this.state.outbox.filter((item) => item.id !== command.id);
    outbox.push(structuredClone(command));
    this.state = {
      ...this.state,
      outbox
    };
  }

  async findServiceMessages(): Promise<[]> {
    return [];
  }

  async getRuntimeDiagnostics(): Promise<never> {
    throw new Error('Not implemented for this test');
  }

  async findDialogIdsByPhone(): Promise<string[]> {
    return [];
  }

  snapshot(): SupportPersistedState {
    return structuredClone(this.state);
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

function createOutboxCommand(
  id: string,
  attempts: number,
  status: SupportOutboxStatus
): SupportOutboxCommand {
  return {
    id,
    dialogId: `dialog-${id}`,
    clientId: `client-${id}`,
    connector: SupportConnectorRoute.MAX_BOT,
    text: `payload-${id}`,
    createdAt: '2026-06-04T10:00:00.000Z',
    status,
    attempts,
    targetExternalChatId: `chat-${id}`,
    targetExternalUserId: `user-${id}`
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
  const previousMaxAttempts = process.env.SUPPORT_OUTBOX_MAX_ATTEMPTS;
  process.env.SUPPORT_OUTBOX_MAX_ATTEMPTS = '3';

  try {
    const persistence = new InMemorySupportPersistence({
      clients: [],
      dialogs: [],
      messages: [],
      responseMetrics: [],
      outbox: [
        createOutboxCommand('stuck', 3, SupportOutboxStatus.PENDING),
        createOutboxCommand('healthy', 2, SupportOutboxStatus.PENDING)
      ]
    });

    const service = createService(persistence);
    await service.hydrateFromPersistence();

    const leased = service.pullOutbox(SupportConnectorRoute.MAX_BOT, 10, 30);

    assert.equal(leased.length, 1);
    assert.equal(leased[0].id, 'healthy');
    assert.equal(leased[0].status, SupportOutboxStatus.LEASED);
    assert.equal(leased[0].attempts, 3);

    const snapshot = persistence.snapshot();
    const stuck = snapshot.outbox.find((command) => command.id === 'stuck');
    const healthy = snapshot.outbox.find((command) => command.id === 'healthy');

    assert.ok(stuck);
    assert.equal(stuck?.status, SupportOutboxStatus.FAILED);
    assert.match(stuck?.lastError ?? '', /Exceeded max delivery attempts \(3\)/);

    assert.ok(healthy);
    assert.equal(healthy?.status, SupportOutboxStatus.LEASED);
    assert.equal(healthy?.attempts, 3);

    console.log('Support outbox max attempts test passed');
  } finally {
    if (previousMaxAttempts === undefined) {
      delete process.env.SUPPORT_OUTBOX_MAX_ATTEMPTS;
    } else {
      process.env.SUPPORT_OUTBOX_MAX_ATTEMPTS = previousMaxAttempts;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
