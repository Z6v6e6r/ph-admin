import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../src/common/rbac/permissions.decorator';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { SubscriptionsController } from '../src/subscriptions/subscriptions.controller';
import {
  SUBSCRIPTION_REQUIRED_INDEXES,
  subscriptionIndexMatches,
  SubscriptionsRepository
} from '../src/subscriptions/subscriptions.repository';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import {
  StoredReleaseProgram,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionType
} from '../src/subscriptions/subscriptions.types';

class InMemorySubscriptionsRepository {
  readonly types: StoredSubscriptionType[] = [];
  readonly policies: StoredSubscriptionPolicyVersion[] = [];
  readonly programs: StoredReleaseProgram[] = [];

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isDuplicateKey(error: unknown): boolean { return (error as Error)?.message === 'DUPLICATE_KEY'; }
  async subscriptionTypeById(id: string) { return this.types.find((row) => row.subscriptionTypeId === id) ?? null; }
  async subscriptionTypeByCodeNorm(code: string) { return this.types.find((row) => row.codeNorm === code) ?? null; }
  async subscriptionTypeByIdempotency(actorId: string, key: string) {
    return this.types.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async insertSubscriptionType(row: StoredSubscriptionType) {
    if (await this.subscriptionTypeByCodeNorm(row.codeNorm) || await this.subscriptionTypeByIdempotency(row.idempotency.actorId, row.idempotency.key)) throw new Error('DUPLICATE_KEY');
    this.types.push(structuredClone(row));
  }
  async listSubscriptionTypes(afterId: string | null, limit: number) {
    return this.types.filter((row) => !afterId || row.subscriptionTypeId > afterId).sort((a, b) => a.subscriptionTypeId.localeCompare(b.subscriptionTypeId)).slice(0, limit);
  }
  async policyByIdempotency(actorId: string, key: string) {
    return this.policies.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async latestPolicyVersion(typeId: string) {
    return Math.max(0, ...this.policies.filter((row) => row.subscriptionTypeId === typeId).map((row) => row.version));
  }
  async insertPolicyVersion(row: StoredSubscriptionPolicyVersion) {
    if (await this.policyByIdempotency(row.idempotency.actorId, row.idempotency.key) || this.policies.some((item) => item.subscriptionTypeId === row.subscriptionTypeId && item.version === row.version)) throw new Error('DUPLICATE_KEY');
    this.policies.push(structuredClone(row));
  }
  async releaseProgramByIdempotency(actorId: string, key: string) {
    return this.programs.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async insertReleaseProgram(row: StoredReleaseProgram) {
    if (await this.releaseProgramByIdempotency(row.idempotency.actorId, row.idempotency.key)) throw new Error('DUPLICATE_KEY');
    this.programs.push(structuredClone(row));
  }
  async listReleasePrograms(input: { stationIds: string[] | null; stationId?: string; afterId: string | null; limit: number }) {
    return this.programs
      .filter((row) => !input.stationId || row.stationId === input.stationId)
      .filter((row) => input.stationId || input.stationIds === null || input.stationIds.includes(row.stationId))
      .filter((row) => !input.afterId || row.releaseProgramId > input.afterId)
      .sort((a, b) => a.releaseProgramId.localeCompare(b.releaseProgramId))
      .slice(0, input.limit);
  }
}

const globalAdmin: RequestUser = {
  id: 'admin:global',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  permissionStationScopes: {
    'subscriptions:read': null,
    'subscriptions:catalog:write': null,
    'subscriptions:release:write': null
  },
  stationIds: [],
  connectorRoutes: []
};

const stationAdmin: RequestUser = {
  id: 'admin:station-a',
  roles: [Role.STATION_ADMIN],
  permissions: ['subscriptions:read', 'subscriptions:release:write'],
  permissionStationScopes: {
    'subscriptions:read': ['station-a'],
    'subscriptions:release:write': ['station-a'],
    'subscriptions:catalog:write': ['station-a']
  },
  stationIds: ['station-a'],
  connectorRoutes: []
};

const command = (suffix: string) => ({
  idempotencyKey: `subscription-test-${suffix.padEnd(16, 'x')}`,
  correlationId: `corr-${suffix.padEnd(8, 'x')}`
});

const policyDraft = () => ({
  effectiveAt: '2026-08-12T00:00:00.000Z',
  applyTo: 'ACTIVE_AND_NEW' as const,
  validityDays: 365,
  createGame: { enabled: true, durationsMinutes: [60, 90, 120] as Array<60 | 90 | 120> },
  joinGame: { enabled: true, minDurationMinutes: 60, maxDurationMinutes: 120 },
  maxActiveServices: 3,
  bookingWindowDays: 4,
  dailyUsageLimit: 1,
  activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY' as const,
  usageUnitsByDuration: { '60': 1, '90': 1, '120': 1 },
  benefitRules: []
});

async function expectException(action: () => Promise<unknown>, type: Function): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof (type as new (...args: never[]) => Error));
    return error;
  }
  assert.fail(`Expected ${type.name}`);
}

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  const repository = new InMemorySubscriptionsRepository();
  const service = new SubscriptionsService(repository as unknown as SubscriptionsRepository);

  const typeResult = await service.createType(
    { code: 'annual-boiler', title: 'Годовая — котельники', description: 'Управляемый черновик' },
    command('type-a'),
    globalAdmin
  );
  assert.equal(typeResult.item.state, 'DRAFT');
  assert.equal(typeResult.item.currentPolicyVersion, null);
  assert.equal(repository.types.length, 1);

  const replay = await service.createType(
    { code: 'annual-boiler', title: 'Годовая — котельники', description: 'Управляемый черновик' },
    command('type-a'),
    globalAdmin
  );
  assert.equal(replay.item.subscriptionTypeId, typeResult.item.subscriptionTypeId);
  assert.equal(replay.replayed, true);
  assert.equal(repository.types.length, 1);

  await expectException(
    () => service.createType(
      { code: 'annual-boiler-2', title: 'Другой payload' },
      command('type-a'),
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createType(
      { code: 'annual-boiler', title: 'Дубликат кода' },
      command('type-b'),
      globalAdmin
    ),
    ConflictException
  );
  await expectException(
    () => service.createType(
      { code: 'station-owned', title: 'Недопустимый station catalog' },
      command('type-c'),
      stationAdmin
    ),
    ForbiddenException
  );

  const policyOne = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    command('policy-a'),
    globalAdmin
  );
  const policyTwo = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    { ...policyDraft(), bookingWindowDays: 5 },
    command('policy-b'),
    globalAdmin
  );
  assert.deepEqual([policyOne.item.version, policyTwo.item.version], [1, 2]);
  assert.equal(policyOne.item.maxActiveServices, 3);
  assert.equal(policyOne.item.dailyUsageLimit, 1);
  const policyReplay = await service.createPolicyVersion(
    typeResult.item.subscriptionTypeId,
    policyDraft(),
    command('policy-a'),
    globalAdmin
  );
  assert.equal(policyReplay.item.version, 1);
  assert.equal(policyReplay.replayed, true);
  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), bookingWindowDays: 3 },
      command('policy-a'),
      globalAdmin
    ),
    ConflictException
  );

  await expectException(
    () => service.createPolicyVersion(
      typeResult.item.subscriptionTypeId,
      { ...policyDraft(), createGame: { enabled: false, durationsMinutes: [60] } },
      command('policy-invalid'),
      globalAdmin
    ),
    UnprocessableEntityException
  );

  const ladder = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [19800, 23800, 36000, 48000].map((rubles, index) => ({
        order: index + 1,
        mode: 'BULK' as const,
        totalQuantity: 50,
        price: { amountMinor: rubles * 100, currency: 'RUB' as const },
        activation: index === 0 ? 'MANUAL' as const : 'PREVIOUS_SOLD_OUT' as const
      }))
    },
    command('release-ladder'),
    stationAdmin
  );
  assert.equal(ladder.item.state, 'DRAFT');
  assert.deepEqual(ladder.item.phases.map((phase) => phase.price.amountMinor), [1980000, 2380000, 3600000, 4800000]);
  assert.ok(ladder.item.phases.every((phase) => Object.values(phase.counters).every((value) => value === 0)));
  const ladderReplay = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [19800, 23800, 36000, 48000].map((rubles, index) => ({
        order: index + 1,
        mode: 'BULK' as const,
        totalQuantity: 50,
        price: { amountMinor: rubles * 100, currency: 'RUB' as const },
        activation: index === 0 ? 'MANUAL' as const : 'PREVIOUS_SOLD_OUT' as const
      }))
    },
    command('release-ladder'),
    stationAdmin
  );
  assert.equal(ladderReplay.item.releaseProgramId, ladder.item.releaseProgramId);
  assert.equal(repository.programs.length, 1);

  const daily = await service.createReleaseProgram(
    {
      subscriptionTypeId: typeResult.item.subscriptionTypeId,
      stationId: 'station-a',
      timezone: 'Europe/Moscow',
      phases: [{
        order: 1,
        mode: 'DAILY_DROP',
        totalQuantity: 100,
        dailyDropQuantity: 7,
        dailyDropLocalTime: '09:00',
        price: { amountMinor: 1980000, currency: 'RUB' },
        activation: 'MANUAL'
      }]
    },
    command('release-daily'),
    stationAdmin
  );
  assert.equal(daily.item.phases[0].dailyDropQuantity, 7);

  await expectException(
    () => service.createReleaseProgram(
      {
        subscriptionTypeId: typeResult.item.subscriptionTypeId,
        stationId: 'station-b',
        timezone: 'Europe/Moscow',
        phases: [{ order: 1, mode: 'BULK', totalQuantity: 1, price: { amountMinor: 100, currency: 'RUB' }, activation: 'MANUAL' }]
      },
      command('release-forbidden'),
      stationAdmin
    ),
    ForbiddenException
  );

  const scopedPrograms = await service.listReleasePrograms(undefined, undefined, stationAdmin);
  assert.equal(scopedPrograms.items.length, 2);
  assert.ok(scopedPrograms.items.every((program) => program.stationId === 'station-a'));

  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.createType),
    ['subscriptions:catalog:write']
  );
  assert.deepEqual(
    Reflect.getMetadata(PERMISSIONS_KEY, SubscriptionsController.prototype.createReleaseProgram),
    ['subscriptions:release:write']
  );

  const expectedIndex = SUBSCRIPTION_REQUIRED_INDEXES.types[1];
  assert.equal(subscriptionIndexMatches({ ...expectedIndex }, expectedIndex), true);
  assert.equal(subscriptionIndexMatches({ ...expectedIndex, unique: false }, expectedIndex), false);
  assert.equal(subscriptionIndexMatches({ ...expectedIndex, key: { codeNorm: -1 } }, expectedIndex), false);
  let initializationCount = 0;
  const repositoryWithColdStart = Object.create(SubscriptionsRepository.prototype) as any;
  repositoryWithColdStart.initialize = async () => {
    initializationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    repositoryWithColdStart.db = {};
  };
  await Promise.all([
    repositoryWithColdStart.connect(),
    repositoryWithColdStart.connect(),
    repositoryWithColdStart.connect()
  ]);
  assert.equal(initializationCount, 1);

  const filter = new SubscriptionsExceptionFilter();
  const filterHeaders: Record<string, string> = {};
  let filterStatus = 0;
  let filterPayload: any = null;
  const response = {
    setHeader: (name: string, value: string) => { filterHeaders[name] = value; },
    status: (value: number) => { filterStatus = value; return response; },
    json: (value: unknown) => { filterPayload = value; return response; }
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-correlation-id': 'corr-auth-test' }, user: undefined }),
      getResponse: () => response
    })
  };
  filter.catch(new ForbiddenException('Forbidden resource'), host as never);
  assert.equal(filterStatus, 401);
  assert.equal(filterPayload.error.code, 'AUTH_REQUIRED');
  assert.equal(filterPayload.error.correlationId, 'corr-auth-test');
  assert.equal(filterPayload.error.retryable, false);
  assert.equal(filterHeaders['X-Correlation-Id'], 'corr-auth-test');
  console.log('subscriptions.service.test.ts: OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
