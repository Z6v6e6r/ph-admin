// The DTO decorators need the metadata polyfill before the module is imported.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { IngestSupportEventDto } from '../src/support/dto/ingest-support-event.dto';
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
  SupportDialogScope,
  SupportDialogStatus,
  SupportMessageDirection,
  SupportMessageKind
} from '../src/support/support.types';

const createdAt = '2026-09-24T10:00:00.000Z';

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
    this.state = { ...this.state, dialogs };
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

  async findClients(): Promise<[]> {
    return [];
  }

  async findDialogsByClientId(): Promise<[]> {
    return [];
  }

  dialogs(): SupportDialog[] {
    return structuredClone(this.state.dialogs);
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

function createService(persistence: InMemorySupportPersistence): SupportService {
  return new SupportService(
    persistence as unknown as SupportPersistenceService,
    createConnectorRegistry(),
    createQuickRepliesStub() as never
  );
}

function emptyState(): SupportPersistedState {
  return { clients: [], dialogs: [], messages: [], responseMetrics: [], outbox: [] };
}

function event(overrides: Partial<IngestSupportEventDto> = {}): IngestSupportEventDto {
  return {
    connector: 'LK_WEB_MESSENGER',
    direction: SupportMessageDirection.INBOUND,
    authorType: 'CLIENT',
    eventType: 'MESSAGE',
    kind: SupportMessageKind.TEXT,
    phone: '79990000001',
    text: 'Здравствуйте',
    stationId: 'Yasenevo',
    stationName: 'Ясенево',
    ...overrides
  };
}

/** The access pattern the existing support tests already prove works. */
function dialogFixture(overrides: Partial<SupportDialog> = {}): SupportDialog {
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
    lastMessageAt: createdAt,
    lastRankingMessageAt: createdAt,
    lastMessageText: 'Нужна помощь',
    lastMessageSenderRole: Role.CLIENT,
    lastClientMessageAt: createdAt,
    lastStaffMessageAt: undefined,
    ai: undefined,
    settings: undefined,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function clientProfile() {
  return {
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
    createdAt,
    updatedAt: createdAt
  };
}

function createUser(): RequestUser {
  return {
    id: 'support-1',
    roles: [Role.SUPPORT],
    stationIds: ['promo'],
    connectorRoutes: [SupportConnectorRoute.PROMO_WEB_MESSENGER]
  };
}

async function verifyContract(): Promise<void> {
  const accepted = plainToInstance(IngestSupportEventDto, {
    connector: 'LK_WEB_MESSENGER',
    dialogScope: SupportDialogScope.STATION
  });
  const acceptedErrors = await validate(accepted, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.deepEqual(acceptedErrors, [], 'a declared dialog scope must validate');
  assert.equal(accepted.dialogScope, SupportDialogScope.STATION);

  const invalidScope = plainToInstance(IngestSupportEventDto, {
    connector: 'LK_WEB_MESSENGER',
    dialogScope: 'PER_STATION'
  });
  const invalidErrors = await validate(invalidScope, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(
    invalidErrors.some((error) => error.property === 'dialogScope'),
    'an unknown scope value must be refused'
  );

  const unknownProperty = plainToInstance(IngestSupportEventDto, {
    connector: 'LK_WEB_MESSENGER',
    dialogScopeUnknown: true
  });
  const unknownErrors = await validate(unknownProperty, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(
    unknownErrors.some((error) =>
      Object.values(error.constraints ?? {}).some((message) =>
        message.includes('dialogScopeUnknown')
      )
    ),
    'an undeclared property must still be refused'
  );
}

async function verifyResolutionIsUnchanged(): Promise<void> {
  const persistence = new InMemorySupportPersistence(emptyState());
  const service = createService(persistence);
  await service.hydrateFromPersistence();

  const first = await service.ingestEvent(event());
  assert.equal(
    first.dialog.dialogScope,
    SupportDialogScope.CLIENT,
    'an event without a scope stays client-scoped'
  );

  const second = await service.ingestEvent(
    event({ stationId: 'Nagatinskaya', stationName: 'Нагатинская', text: 'И ещё' })
  );
  assert.equal(
    second.dialog.id,
    first.dialog.id,
    'resolution still keeps one dialog per client and connector'
  );
  assert.equal(persistence.dialogs().length, 1);
}

async function verifyScopeIsStored(): Promise<void> {
  const persistence = new InMemorySupportPersistence(emptyState());
  const service = createService(persistence);
  await service.hydrateFromPersistence();

  const result = await service.ingestEvent(event({ dialogScope: SupportDialogScope.STATION }));
  assert.equal(result.dialog.dialogScope, SupportDialogScope.STATION);
  const stored = persistence.dialogs().find((dialog) => dialog.id === result.dialog.id);
  assert.equal(
    stored?.dialogScope,
    SupportDialogScope.STATION,
    'the declared scope must survive persistence'
  );
}

async function verifySummaryDefaults(): Promise<void> {
  const persistence = new InMemorySupportPersistence({
    ...emptyState(),
    clients: [clientProfile()],
    dialogs: [
      dialogFixture(),
      dialogFixture({ id: 'dialog-promo-2', dialogScope: SupportDialogScope.STATION })
    ]
  });
  const service = createService(persistence);
  await service.hydrateFromPersistence();
  const user = createUser();

  assert.equal(
    service.getDialogSummary('dialog-promo-1', user).dialogScope,
    SupportDialogScope.CLIENT,
    'a legacy row without the field reads as client-scoped'
  );
  assert.equal(
    service.getDialogSummary('dialog-promo-2', user).dialogScope,
    SupportDialogScope.STATION,
    'a stored station scope is reported on the summary'
  );
}

async function main(): Promise<void> {
  await verifyContract();
  await verifyResolutionIsUnchanged();
  await verifyScopeIsStored();
  await verifySummaryDefaults();
  console.log('Support dialog scope expand test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
