import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ResidentBenefitsService } from '../src/resident-services/resident-benefits.service';
import { ResidentIssuancesService } from '../src/resident-services/resident-issuances.service';
import { ResidentPassesService } from '../src/resident-services/resident-passes.service';
import { ResidentResidencyService } from '../src/resident-services/resident-residency.service';
import {
  RESIDENT_SERVICES_ERROR_CODES as RESIDENT_SERVICE_ERRORS,
  StoredResidentBenefitRule,
  StoredResidentIssuance,
  StoredResidentJournalEvent,
  StoredResidentPass,
  StoredResidentReturn,
  StoredResidentServiceUsage
} from '../src/resident-services/resident-services.types';
import {
  HOME_STATION,
  INSTANCE_ID,
  OTHER_STATION,
  PROVIDER_CLIENT_ID,
  RESIDENT_INTEGRATION_TOKEN,
  RESIDENT_NOW,
  RESIDENT_TENANT,
  configureResidentServicesEnv,
  residentInstanceFixture,
  residentMappingFixture,
  residentPublicationFixture,
  residentStaff,
  residentSubscriptionTypeFixture
} from './helpers/resident-services-fixtures';

const CLIENT_AUTH = 'Bearer client-token';
const ISSUE_START = Date.parse(RESIDENT_NOW);

interface FakeState {
  passes: StoredResidentPass[];
  rules: StoredResidentBenefitRule[];
  usage: StoredResidentServiceUsage[];
  issuances: StoredResidentIssuance[];
  returns: StoredResidentReturn[];
  journal: StoredResidentJournalEvent[];
  instances: ReturnType<typeof residentInstanceFixture>[];
  publications: ReturnType<typeof residentPublicationFixture>[];
  mappings: ReturnType<typeof residentMappingFixture>[];
  types: ReturnType<typeof residentSubscriptionTypeFixture>[];
}

class FakeRepository {
  state: FakeState = {
    passes: [],
    rules: [],
    usage: [],
    issuances: [],
    returns: [],
    journal: [],
    instances: [residentInstanceFixture()],
    publications: [residentPublicationFixture()],
    mappings: [residentMappingFixture()],
    types: [residentSubscriptionTypeFixture()]
  };
  journalFailures = 0;
  usageConsumptions = 0;

  async withTransaction<T>(work: (session: unknown) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(undefined);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  isAvailable(): boolean { return true; }
  requireAvailable(): void {}
  isFeatureEnabled(): boolean { return true; }

  async subscriptionTypeById(id: string): Promise<unknown> {
    return this.state.types.find((row) => row.subscriptionTypeId === id) ?? null;
  }

  async runtimeInstanceByProviderIdentity(input: {
    tenantId: string; providerClientId: string; clientSubscriptionId: string;
  }): Promise<unknown> {
    return this.state.instances.find((row) => row.tenantId === input.tenantId
      && row.providerClientId === input.providerClientId
      && row.clientSubscriptionId === input.clientSubscriptionId) ?? null;
  }

  async runtimeInstanceByTenantAndId(tenantId: string, id: string): Promise<unknown> {
    return this.state.instances.find(
      (row) => row.tenantId === tenantId && row.subscriptionInstanceId === id
    ) ?? null;
  }

  async providerMappingById(id: string): Promise<unknown> {
    return this.state.mappings.find((row) => row.mappingId === id) ?? null;
  }

  async policyPublicationHistoryByType(id: string): Promise<unknown[]> {
    return structuredClone(
      this.state.publications.filter((row) => row.subscriptionTypeId === id)
    );
  }

  async findPassByTokenHash(tokenHash: string): Promise<StoredResidentPass | null> {
    const found = this.state.passes.find((row) => row.tokenHash === tokenHash);
    return found ? structuredClone(found) : null;
  }

  async findPassById(passId: string): Promise<StoredResidentPass | null> {
    const found = this.state.passes.find((row) => row.passId === passId);
    return found ? structuredClone(found) : null;
  }

  async insertPass(pass: StoredResidentPass): Promise<void> {
    if (this.state.passes.some((row) => row.tokenHash === pass.tokenHash)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    this.state.passes.push(structuredClone(pass));
  }

  async consumePass(input: {
    passId: string; tenantId: string; expectedRevision: number; now: Date;
    consumedBy: string; consumedStationId: string; operationId: string;
  }): Promise<StoredResidentPass | null> {
    const pass = this.state.passes.find((row) => row.passId === input.passId
      && row.tenantId === input.tenantId
      && row.state === 'ACTIVE'
      && row.revision === input.expectedRevision
      && Date.parse(row.expiresAt) > input.now.getTime());
    if (!pass) return null;
    pass.state = 'CONSUMED';
    pass.consumedAt = input.now.toISOString();
    pass.consumedBy = input.consumedBy;
    pass.consumedStationId = input.consumedStationId;
    pass.consumedOperationId = input.operationId;
    pass.updatedAt = input.now.toISOString();
    pass.revision += 1;
    return structuredClone(pass);
  }

  async benefitRulesByTenant(tenantId: string): Promise<StoredResidentBenefitRule[]> {
    return structuredClone(this.state.rules.filter((row) => row.tenantId === tenantId));
  }

  async benefitRulesByType(
    tenantId: string,
    subscriptionTypeId: string
  ): Promise<StoredResidentBenefitRule[]> {
    return structuredClone(this.state.rules.filter((row) => row.tenantId === tenantId
      && row.subscriptionTypeId === subscriptionTypeId));
  }

  async benefitRuleById(tenantId: string, ruleId: string): Promise<StoredResidentBenefitRule | null> {
    const found = this.state.rules.find(
      (row) => row.tenantId === tenantId && row.ruleId === ruleId
    );
    return found ? structuredClone(found) : null;
  }

  async benefitRuleByIdempotency(
    tenantId: string,
    actorId: string,
    keyHash: string
  ): Promise<StoredResidentBenefitRule | null> {
    const found = this.state.rules.find((row) => row.tenantId === tenantId
      && row.idempotency?.actorId === actorId
      && row.idempotency?.keyHash === keyHash);
    return found ? structuredClone(found) : null;
  }

  async insertBenefitRule(rule: StoredResidentBenefitRule): Promise<void> {
    this.state.rules.push(structuredClone(rule));
  }

  async updateBenefitRule(input: {
    tenantId: string; ruleId: string; expectedRevision: number;
    rule: {
      stationScopeKey: string; stationScope: StoredResidentBenefitRule['stationScope'];
      limitPeriod: StoredResidentBenefitRule['limitPeriod']; limitQuantity: number;
      returnable: boolean; enabled: boolean; updatedBy: string; updatedAt: string;
    };
  }): Promise<StoredResidentBenefitRule | null> {
    const rule = this.state.rules.find((row) => row.tenantId === input.tenantId
      && row.ruleId === input.ruleId && row.revision === input.expectedRevision);
    if (!rule) return null;
    rule.stationScopeKey = input.rule.stationScopeKey;
    rule.stationScope = structuredClone(input.rule.stationScope);
    rule.limitPeriod = input.rule.limitPeriod;
    rule.limitQuantity = input.rule.limitQuantity;
    rule.returnable = input.rule.returnable;
    rule.enabled = input.rule.enabled;
    rule.updatedBy = input.rule.updatedBy;
    rule.updatedAt = input.rule.updatedAt;
    rule.revision += 1;
    return structuredClone(rule);
  }

  async usageFor(input: {
    tenantId: string; clientRefHash: string; serviceKind: string;
    limitPeriod: string; periodKey: string;
  }): Promise<StoredResidentServiceUsage | null> {
    const found = this.state.usage.find((row) => row.tenantId === input.tenantId
      && row.clientRefHash === input.clientRefHash
      && row.serviceKind === input.serviceKind
      && row.limitPeriod === input.limitPeriod
      && row.periodKey === input.periodKey);
    return found ? structuredClone(found) : null;
  }

  async consumeUsage(input: {
    tenantId: string; subscriptionInstanceId: string; clientRefHash: string;
    serviceKind: StoredResidentServiceUsage['serviceKind'];
    limitPeriod: StoredResidentServiceUsage['limitPeriod'];
    periodKey: string; quantity: number; limitQuantity: number; now: Date;
  }): Promise<{ used: number; remaining: number } | null> {
    this.usageConsumptions += 1;
    const found = this.state.usage.find((row) => row.tenantId === input.tenantId
      && row.clientRefHash === input.clientRefHash
      && row.serviceKind === input.serviceKind
      && row.limitPeriod === input.limitPeriod
      && row.periodKey === input.periodKey);
    if (!found) {
      if (input.quantity > input.limitQuantity) return null;
      this.state.usage.push({
        schemaVersion: 1,
        tenantId: input.tenantId,
        clientRefHash: input.clientRefHash,
        subscriptionInstanceId: input.subscriptionInstanceId,
        lastSubscriptionInstanceId: input.subscriptionInstanceId,
        serviceKind: input.serviceKind,
        limitPeriod: input.limitPeriod,
        periodKey: input.periodKey,
        used: input.quantity,
        revision: 1,
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      });
      return {
        used: input.quantity,
        remaining: input.limitQuantity - input.quantity
      };
    }
    if (found.used + input.quantity > input.limitQuantity) return null;
    found.used += input.quantity;
    found.lastSubscriptionInstanceId = input.subscriptionInstanceId;
    found.updatedAt = input.now.toISOString();
    found.revision += 1;
    return { used: found.used, remaining: input.limitQuantity - found.used };
  }

  async issuanceByIdempotency(
    tenantId: string,
    keyHash: string
  ): Promise<StoredResidentIssuance | null> {
    const found = this.state.issuances.find((row) => row.tenantId === tenantId
      && row.idempotency.keyHash === keyHash);
    return found ? structuredClone(found) : null;
  }

  async issuanceById(tenantId: string, issuanceId: string): Promise<StoredResidentIssuance | null> {
    const found = this.state.issuances.find(
      (row) => row.tenantId === tenantId && row.issuanceId === issuanceId
    );
    return found ? structuredClone(found) : null;
  }

  async insertIssuance(issuance: StoredResidentIssuance): Promise<void> {
    if (this.state.issuances.some((row) => row.tenantId === issuance.tenantId
      && row.idempotency.keyHash === issuance.idempotency.keyHash)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    this.state.issuances.push(structuredClone(issuance));
  }

  async updateIssuanceAfterReturn(input: {
    tenantId: string; issuanceId: string; expectedRevision: number;
    items: StoredResidentIssuance['items'];
    state: StoredResidentIssuance['state'];
    returnedAt: string; returnId: string;
  }): Promise<StoredResidentIssuance | null> {
    const issuance = this.state.issuances.find((row) => row.tenantId === input.tenantId
      && row.issuanceId === input.issuanceId
      && row.revision === input.expectedRevision);
    if (!issuance) return null;
    issuance.items = structuredClone(input.items);
    issuance.state = input.state;
    issuance.returnedAt = input.returnedAt;
    issuance.lastReturnId = input.returnId;
    issuance.updatedAt = input.returnedAt;
    issuance.revision += 1;
    return structuredClone(issuance);
  }

  async returnByIdempotency(
    tenantId: string,
    keyHash: string
  ): Promise<StoredResidentReturn | null> {
    const found = this.state.returns.find((row) => row.tenantId === tenantId
      && row.idempotency.keyHash === keyHash);
    return found ? structuredClone(found) : null;
  }

  async insertReturn(document: StoredResidentReturn): Promise<void> {
    if (this.state.returns.some((row) => row.tenantId === document.tenantId
      && row.idempotency.keyHash === document.idempotency.keyHash)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    this.state.returns.push(structuredClone(document));
  }

  async appendJournal(events: StoredResidentJournalEvent[]): Promise<void> {
    if (this.journalFailures > 0) {
      this.journalFailures -= 1;
      throw new Error('journal failure fixture');
    }
    this.state.journal.push(...structuredClone(events));
  }

  async listJournal(query: {
    tenantId: string; stationIds: string[] | null; stationId?: string;
    from?: string; to?: string; limit: number;
    cursor: { occurredAt: string; eventId: string } | null;
  }): Promise<{
    items: StoredResidentJournalEvent[];
    nextCursor: { occurredAt: string; eventId: string } | null;
  }> {
    let rows = this.state.journal
      .filter((row) => row.tenantId === query.tenantId)
      .filter((row) => query.stationId
        ? row.stationId === query.stationId
        : query.stationIds === null || query.stationIds.includes(row.stationId))
      .filter((row) => !query.from || row.occurredAt >= query.from)
      .filter((row) => !query.to || row.occurredAt <= query.to)
      .sort((left, right) => (
        left.occurredAt === right.occurredAt
          ? (left.eventId < right.eventId ? 1 : -1)
          : (left.occurredAt < right.occurredAt ? 1 : -1)
      ));
    if (query.cursor) {
      rows = rows.filter((row) => row.occurredAt < query.cursor!.occurredAt
        || (row.occurredAt === query.cursor!.occurredAt
          && row.eventId < query.cursor!.eventId));
    }
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return {
      items: structuredClone(page),
      nextCursor: hasMore && page.length > 0
        ? { occurredAt: page[page.length - 1].occurredAt, eventId: page[page.length - 1].eventId }
        : null
    };
  }
}

interface Harness {
  repository: FakeRepository;
  benefits: ResidentBenefitsService;
  passes: ResidentPassesService;
  issuances: ResidentIssuancesService;
  now(ms: number): void;
  clock(): Date;
}

function harness(): Harness {
  const repository = new FakeRepository();
  let nowMs = ISSUE_START;
  const clock = (): Date => new Date(nowMs);
  const identity = {
    verifyTrustedBearer: async (header: string | undefined): Promise<unknown> => {
      if (header !== CLIENT_AUTH) {
        throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Authentication is required' });
      }
      return {
        verified: true,
        actor: {
          tenantKey: RESIDENT_TENANT,
          clientId: PROVIDER_CLIENT_ID,
          issuer: 'issuer:lk',
          subject: 'subject:client'
        }
      };
    }
  };
  const residency = new ResidentResidencyService(
    repository as never,
    identity as never,
    clock
  );
  const benefits = new ResidentBenefitsService(repository as never, residency, clock);
  const passes = new ResidentPassesService(repository as never, residency, benefits, clock);
  const issuances = new ResidentIssuancesService(repository as never, residency, benefits, clock);
  return {
    repository,
    benefits,
    passes,
    issuances,
    now(ms: number): void { nowMs = ms; },
    clock
  };
}

async function rejects(
  work: () => Promise<unknown>,
  codes: string[],
  status?: number
): Promise<void> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof HttpException, 'expected HttpException, got ' + String(error));
    const body = error.getResponse() as { code?: string; message?: string; cause?: unknown };
    assert.ok(
      codes.includes(String(body.code)),
      'unexpected code ' + String(body.code) + ' expected ' + codes.join('|')
    );
    if (status !== undefined) assert.equal(error.getStatus(), status);
    return;
  }
  assert.fail('expected rejection');
}

async function expectThrow(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    return;
  }
  assert.fail('expected rejection');
}

async function createRules(h: Harness): Promise<void> {
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    limitPeriod: 'DAY',
    limitQuantity: 2,
    returnable: false
  }, 'towel-rule-idempotency-001', residentStaff() as never, 'corr:towel');
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'RACKET',
    limitPeriod: 'DAY',
    limitQuantity: 1,
    returnable: true
  }, 'racket-rule-idempotency-001', residentStaff() as never, 'corr:racket');
}

async function issuePass(h: Harness): Promise<string> {
  const pass = await h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:piter-1'
  });
  return pass.token;
}

async function main(): Promise<void> {
  const restore = configureResidentServicesEnv();
  try {
    await scenarioPassCreation();
    await scenarioResidencyFreshness();
    await scenarioPreview();
    await scenarioIssuanceAndReplay();
    await scenarioLimitsAcrossPasses();
    await scenarioExpiryAtConfirmation();
    await scenarioStaleEvidenceAtConfirmation();
    await scenarioMissingBenefitConfiguration();
    await scenarioStationPolicy();
    await scenarioReturns();
    await scenarioBenefitRules();
    await scenarioAtomicRollback();
    await scenarioJournal();
    await scenarioInvalidEvidence();
    await scenarioScopedRuleTakeover();
    await scenarioSubscriptionRenewal();
  } finally {
    restore();
  }
  console.log('resident-services.service: ok');
}

async function scenarioPassCreation(): Promise<void> {
  const h = harness();
  const token = await issuePass(h);
  assert.match(token, /^rsp1_/);
  assert.equal(h.repository.state.passes.length, 1);
  const pass = h.repository.state.passes[0];
  assert.equal(pass.state, 'ACTIVE');
  assert.equal(pass.expiresAt, new Date(ISSUE_START + 120_000).toISOString());
  assert.ok(pass.expiresAtDate instanceof Date);
  assert.equal(pass.expiresAtDate.toISOString(), pass.expiresAt);
  assert.equal(pass.tenantId, RESIDENT_TENANT);
  assert.equal(pass.subscriptionInstanceId, INSTANCE_ID);
  assert.equal(JSON.stringify(pass).includes(token), false);
  assert.match(pass.tokenHash, /^[a-f0-9]{64}$/);

  // TTL never exceeds the confirmed residency term.
  h.repository.state.instances[0].activeTo = new Date(ISSUE_START + 30_000).toISOString();
  const shortToken = await issuePass(h);
  const shortPass = h.repository.state.passes.find((row) => row.tokenHash !== pass.tokenHash);
  assert.ok(shortPass);
  assert.equal(shortPass!.expiresAt, new Date(ISSUE_START + 30_000).toISOString());
  assert.ok(shortToken);

  // A foreign identity cannot obtain a pass for someone else's instance.
  await rejects(() => h.passes.createPass({
    authorization: 'Bearer other-token',
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:piter-1'
  }), ['AUTH_REQUIRED'], 401);

  // Missing integration token is forbidden.
  await rejects(() => h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: 'wrong-token',
    clientSubscriptionId: 'client_subscription:piter-1'
  }), ['RESIDENT_SERVICES_INTEGRATION_FORBIDDEN'], 403);

  // Unknown subscription shares one 404 with a foreign subscription.
  await rejects(() => h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:unknown'
  }), [RESIDENT_SERVICE_ERRORS.PASS_NOT_FOUND], 404);

  console.log('scenario pass creation: ok');
}

async function scenarioResidencyFreshness(): Promise<void> {
  const h = harness();
  h.repository.state.instances[0].reconciliation.asOf =
    new Date(ISSUE_START - 2 * 3600_000).toISOString();
  await rejects(() => issuePass(h), [RESIDENT_SERVICE_ERRORS.EVIDENCE_STALE], 503);

  h.repository.state.instances[0].reconciliation.asOf = new Date(ISSUE_START - 1000).toISOString();
  h.repository.state.mappings[0].verifiedAt = new Date(ISSUE_START - 2 * 3600_000).toISOString();
  await rejects(() => issuePass(h), [RESIDENT_SERVICE_ERRORS.MAPPING_STALE], 503);

  h.repository.state.mappings[0].verifiedAt = new Date(ISSUE_START - 1000).toISOString();
  h.repository.state.instances[0].state = 'FROZEN';
  h.repository.state.instances[0].frozenUntil = new Date(ISSUE_START + 86_400_000).toISOString();
  await rejects(() => issuePass(h), [RESIDENT_SERVICE_ERRORS.NOT_ACTIVE], 409);

  h.repository.state.instances[0].state = 'EXPIRED';
  h.repository.state.instances[0].frozenUntil = null;
  await rejects(() => issuePass(h), [RESIDENT_SERVICE_ERRORS.NOT_ACTIVE], 409);

  console.log('scenario residency freshness: ok');
}

async function scenarioPreview(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  const before = structuredClone(h.repository.state);
  const preview = await h.passes.preview(token, HOME_STATION, residentStaff() as never);
  assert.equal(preview.resident.confirmed, true);
  assert.equal(preview.resident.subscriptionTypeTitle, 'Резидент Питер 12 месяцев');
  assert.equal(preview.issuable, true);
  assert.equal(preview.services.length, 2);
  const towel = preview.services.find((item) => item.serviceKind === 'TOWEL');
  const racket = preview.services.find((item) => item.serviceKind === 'RACKET');
  assert.equal(towel?.limitQuantity, 2);
  assert.equal(towel?.returnable, false);
  assert.equal(racket?.limitQuantity, 1);
  assert.equal(racket?.returnable, true);
  assert.deepEqual(h.repository.state, before, 'preview must not persist anything');

  await rejects(
    () => h.passes.preview(token, OTHER_STATION, residentStaff() as never),
    [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN],
    403
  );
  await rejects(
    () => h.passes.preview(token, HOME_STATION, residentStaff({
      permissions: ['resident-services:read']
    }) as never),
    ['FORBIDDEN'],
    403
  );
  await rejects(
    () => h.passes.preview('rsp1_invalid', HOME_STATION, residentStaff() as never),
    [RESIDENT_SERVICE_ERRORS.PASS_INVALID],
    400
  );

  h.now(ISSUE_START + 121_000);
  await rejects(
    () => h.passes.preview(token, HOME_STATION, residentStaff() as never),
    [RESIDENT_SERVICE_ERRORS.PASS_EXPIRED],
    409
  );
  console.log('scenario preview: ok');
}

async function scenarioIssuanceAndReplay(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  const result = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [
      { serviceKind: 'TOWEL', quantity: 1 },
      { serviceKind: 'RACKET', quantity: 1 }
    ],
    user: residentStaff() as never,
    idempotencyHeader: 'issuance-idempotency-0001',
    correlationHeader: 'corr:issuance-1'
  });
  assert.equal(result.replayed, false);
  assert.equal(result.view.state, 'ISSUED');
  assert.equal(result.view.items.length, 2);
  assert.equal(result.view.issuanceId, result.view.operationId);
  const issuanceId = result.view.issuanceId;
  assert.equal(h.repository.state.issuances.length, 1);
  assert.equal(h.repository.state.passes[0].state, 'CONSUMED');
  assert.equal(h.repository.state.usage.length, 2);
  assert.ok(h.repository.state.usage.every((row) => row.used === 1));
  assert.equal(h.repository.state.journal.length, 1);
  assert.equal(h.repository.state.journal[0].eventType, 'ISSUANCE_CONFIRMED');

  const replay = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [
      { serviceKind: 'RACKET', quantity: 1 },
      { serviceKind: 'TOWEL', quantity: 1 }
    ],
    user: residentStaff() as never,
    idempotencyHeader: 'issuance-idempotency-0001',
    correlationHeader: 'corr:issuance-2'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.issuanceId, issuanceId);
  assert.equal(h.repository.state.issuances.length, 1);
  assert.equal(h.repository.usageConsumptions, 2);

  await rejects(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'issuance-idempotency-0001',
    correlationHeader: 'corr:issuance-3'
  }), [RESIDENT_SERVICE_ERRORS.IDEMPOTENCY_CONFLICT], 409);

  await rejects(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'issuance-idempotency-0002',
    correlationHeader: 'corr:issuance-4'
  }), [RESIDENT_SERVICE_ERRORS.PASS_ALREADY_USED], 409);

  console.log('scenario issuance and replay: ok');
}

async function scenarioLimitsAcrossPasses(): Promise<void> {
  const h = harness();
  await createRules(h);
  const first = await issuePass(h);
  await h.issuances.confirm({
    token: first,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'limit-issuance-0001',
    correlationHeader: 'corr:limit-1'
  });
  const second = await issuePass(h);
  await rejects(() => h.issuances.confirm({
    token: second,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'limit-issuance-0002',
    correlationHeader: 'corr:limit-2'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_LIMIT_EXCEEDED], 409);
  assert.equal(h.repository.state.issuances.length, 1);
  assert.equal(h.repository.state.passes.find((row) => row.tokenHash
    && row.state === 'ACTIVE') !== undefined, true);

  // The second pass can still issue a towel because the limit is per service.
  const towel = await h.issuances.confirm({
    token: second,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'limit-issuance-0003',
    correlationHeader: 'corr:limit-3'
  });
  assert.equal(towel.view.items[0].serviceKind, 'TOWEL');
  const racketUsage = h.repository.state.usage.find((row) => row.serviceKind === 'RACKET');
  assert.equal(racketUsage?.used, 1);
  console.log('scenario limits across passes: ok');
}

async function scenarioExpiryAtConfirmation(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  h.now(ISSUE_START + 121_000);
  await rejects(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'expired-issuance-0001',
    correlationHeader: 'corr:expired'
  }), [RESIDENT_SERVICE_ERRORS.PASS_EXPIRED], 409);
  assert.equal(h.repository.state.passes[0].state, 'ACTIVE');
  assert.equal(h.repository.state.usage.length, 0);
  assert.equal(h.repository.state.issuances.length, 0);
  console.log('scenario expiry at confirmation: ok');
}

async function scenarioStaleEvidenceAtConfirmation(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  h.repository.state.instances[0].reconciliation.asOf =
    new Date(ISSUE_START - 2 * 3600_000).toISOString();
  await rejects(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'stale-issuance-0001',
    correlationHeader: 'corr:stale'
  }), [RESIDENT_SERVICE_ERRORS.EVIDENCE_STALE], 503);
  assert.equal(h.repository.state.passes[0].state, 'ACTIVE');
  assert.equal(h.repository.state.usage.length, 0);
  console.log('scenario stale evidence at confirmation: ok');
}

async function scenarioMissingBenefitConfiguration(): Promise<void> {
  const h = harness();
  const token = await issuePass(h);
  const preview = await h.passes.preview(token, HOME_STATION, residentStaff() as never);
  assert.equal(preview.resident.confirmed, true);
  assert.equal(preview.issuable, false);
  assert.ok(preview.services.every((item) => item.blocker === 'RESIDENT_SERVICE_NOT_CONFIGURED'));
  await rejects(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'unconfigured-issuance-0001',
    correlationHeader: 'corr:unconfigured'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_NOT_CONFIGURED], 409);
  assert.equal(h.repository.state.passes[0].state, 'ACTIVE');
  console.log('scenario missing benefit configuration: ok');
}

async function scenarioStationPolicy(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  await rejects(() => h.issuances.confirm({
    token,
    stationId: OTHER_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff({ stationIds: [HOME_STATION, OTHER_STATION] }) as never,
    idempotencyHeader: 'station-issuance-0001',
    correlationHeader: 'corr:station'
  }), [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);
  assert.equal(h.repository.state.passes[0].state, 'ACTIVE');
  console.log('scenario station policy: ok');
}

async function scenarioReturns(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  const issued = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [
      { serviceKind: 'TOWEL', quantity: 1 },
      { serviceKind: 'RACKET', quantity: 1 }
    ],
    user: residentStaff() as never,
    idempotencyHeader: 'return-issuance-0001',
    correlationHeader: 'corr:return-1'
  });
  await rejects(() => h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0001',
    correlationHeader: 'corr:return-towel'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_NOT_RETURNABLE], 409);

  const returned = await h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0002',
    correlationHeader: 'corr:return-racket'
  });
  assert.equal(returned.replayed, false);
  assert.equal(returned.view.issuanceState, 'RETURNED');
  assert.equal(returned.view.items[0].serviceKind, 'RACKET');
  assert.equal(h.repository.state.journal.length, 2);

  const replay = await h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0002',
    correlationHeader: 'corr:return-racket-2'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.returnId, returned.view.returnId);
  assert.equal(h.repository.state.returns.length, 1);

  await rejects(() => h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0003',
    correlationHeader: 'corr:return-racket-3'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_ALREADY_RETURNED], 409);

  // A return is accepted after the residency term is over.
  const racketRule = h.repository.state.rules.find((row) => row.serviceKind === 'RACKET');
  assert.ok(racketRule);
  await h.benefits.updateRule(racketRule!.ruleId, {
    limitQuantity: 2,
    expectedRevision: racketRule!.revision
  }, residentStaff() as never);
  const lateToken = await issuePass(h);
  const lateIssued = await h.issuances.confirm({
    token: lateToken,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-issuance-0002',
    correlationHeader: 'corr:return-2'
  });
  h.repository.state.instances[0].activeTo = new Date(ISSUE_START + 1000).toISOString();
  h.repository.state.instances[0].state = 'EXPIRED';
  h.now(ISSUE_START + 400 * 86_400_000);
  await rejects(() => h.issuances.returnItems({
    issuanceId: lateIssued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff({ stationIds: [OTHER_STATION] }) as never,
    idempotencyHeader: 'return-idempotency-0006',
    correlationHeader: 'corr:return-foreign-station'
  }), [RESIDENT_SERVICE_ERRORS.ISSUANCE_NOT_FOUND], 404);
  const lateReturn = await h.issuances.returnItems({
    issuanceId: lateIssued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0004',
    correlationHeader: 'corr:return-late'
  });
  assert.equal(lateReturn.view.issuanceState, 'RETURNED');

  await rejects(() => h.issuances.returnItems({
    issuanceId: lateIssued.view.issuanceId,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'return-idempotency-0005',
    correlationHeader: 'corr:return-missing'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_NOT_ISSUED], 409);

  console.log('scenario returns: ok');
}

async function scenarioBenefitRules(): Promise<void> {
  const h = harness();
  await createRules(h);
  const listed = await h.benefits.listRules(residentStaff() as never);
  assert.equal(listed.items.length, 2);
  assert.ok(listed.items.every((rule) => rule.subscriptionTypeTitle === 'Резидент Питер 12 месяцев'));

  await rejects(() => h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'RACKET',
    limitPeriod: 'DAY',
    limitQuantity: 1,
    returnable: true
  }, 'racket-rule-idempotency-002', residentStaff() as never, 'corr:duplicate'),
  [RESIDENT_SERVICE_ERRORS.BENEFIT_RULE_CONFLICT], 409);

  await rejects(() => h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    stationIds: [OTHER_STATION],
    limitPeriod: 'DAY',
    limitQuantity: 1,
    returnable: false
  }, 'scoped-rule-idempotency-001', residentStaff({
    permissionStationScopes: { 'resident-services:configure': [HOME_STATION] }
  }) as never, 'corr:scoped'),
  [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);

  await rejects(() => h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    limitPeriod: 'WEEK',
    limitQuantity: 1,
    returnable: false
  }, 'all-stations-rule-idempotency-001', residentStaff({
    permissionStationScopes: { 'resident-services:configure': [HOME_STATION] }
  }) as never, 'corr:all-stations'),
  [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);

  const rules = await h.benefits.listRules(residentStaff() as never);
  const racket = rules.items.find((rule) => rule.serviceKind === 'RACKET');
  assert.ok(racket);
  const updated = await h.benefits.updateRule(racket!.ruleId, {
    limitQuantity: 2,
    expectedRevision: racket!.revision
  }, residentStaff() as never);
  assert.equal(updated.limitQuantity, 2);
  await rejects(() => h.benefits.updateRule(racket!.ruleId, {
    limitQuantity: 3,
    expectedRevision: racket!.revision
  }, residentStaff() as never), [RESIDENT_SERVICE_ERRORS.BENEFIT_RULE_REVISION_CONFLICT], 409);

  console.log('scenario benefit rules: ok');
}

async function scenarioAtomicRollback(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  h.repository.journalFailures = 1;
  await expectThrow(() => h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'rollback-issuance-0001',
    correlationHeader: 'corr:rollback'
  }));
  assert.equal(h.repository.state.passes[0].state, 'ACTIVE');
  assert.equal(h.repository.state.usage.length, 0);
  assert.equal(h.repository.state.issuances.length, 0);
  const success = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'rollback-issuance-0002',
    correlationHeader: 'corr:rollback-2'
  });
  assert.equal(success.view.state, 'ISSUED');
  console.log('scenario atomic rollback: ok');
}

async function scenarioJournal(): Promise<void> {
  const h = harness();
  await createRules(h);
  const token = await issuePass(h);
  const issued = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'journal-issuance-0001',
    correlationHeader: 'corr:journal'
  });
  h.now(ISSUE_START + 1000);
  await h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'journal-return-0001',
    correlationHeader: 'corr:journal-return'
  });
  const page = await h.issuances.journal({ limit: '50' }, residentStaff() as never);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].eventType, 'ITEM_RETURNED');
  assert.equal(page.items[1].eventType, 'ISSUANCE_CONFIRMED');

  const details = await h.issuances.getIssuance(issued.view.issuanceId, residentStaff() as never);
  assert.equal(details.state, 'RETURNED');

  const scoped = await h.issuances.journal({ limit: '50' }, residentStaff({
    stationIds: [OTHER_STATION]
  }) as never);
  assert.equal(scoped.items.length, 0);

  await rejects(() => h.issuances.journal({ stationId: OTHER_STATION }, residentStaff({
    stationIds: [HOME_STATION]
  }) as never), [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);

  await rejects(() => h.issuances.getIssuance(issued.view.issuanceId, residentStaff({
    permissions: ['resident-services:issue']
  }) as never), ['FORBIDDEN'], 403);

  console.log('scenario journal: ok');
}

async function scenarioSubscriptionRenewal(): Promise<void> {
  const h = harness();
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'RACKET',
    limitPeriod: 'SUBSCRIPTION',
    limitQuantity: 1,
    returnable: true
  }, 'subscription-period-rule-0001', residentStaff() as never, 'corr:subscription-period');
  const first = await issuePass(h);
  await h.issuances.confirm({
    token: first,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'subscription-period-issuance-0001',
    correlationHeader: 'corr:subscription-period-1'
  });
  const second = await issuePass(h);
  await rejects(() => h.issuances.confirm({
    token: second,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'subscription-period-issuance-0002',
    correlationHeader: 'corr:subscription-period-2'
  }), [RESIDENT_SERVICE_ERRORS.SERVICE_LIMIT_EXCEEDED], 409);

  // Renewal into a new subscription instance starts a new SUBSCRIPTION period.
  const renewal = structuredClone(h.repository.state.instances[0]);
  renewal.subscriptionInstanceId = 'subscription_instance:piter-2';
  renewal.clientSubscriptionId = 'client_subscription:piter-2';
  renewal.revision = 4;
  h.repository.state.instances.push(renewal);
  const renewed = await h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:piter-2'
  });
  const issued = await h.issuances.confirm({
    token: renewed.token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'subscription-period-issuance-0003',
    correlationHeader: 'corr:subscription-period-3'
  });
  assert.equal(issued.view.state, 'ISSUED');
  const periods = h.repository.state.usage
    .filter((row) => row.serviceKind === 'RACKET')
    .map((row) => row.periodKey);
  assert.deepEqual(periods.sort(), [
    'subscription_instance:piter-1',
    'subscription_instance:piter-2'
  ]);
  console.log('scenario subscription renewal: ok');
}

async function scenarioInvalidEvidence(): Promise<void> {
  const h = harness();
  h.repository.state.instances[0] = Object.assign({}, h.repository.state.instances[0], {
    schemaVersion: 2
  });
  await rejects(() => issuePass(h), [RESIDENT_SERVICE_ERRORS.EVIDENCE_INVALID], 503);

  const mapping = harness();
  mapping.repository.state.mappings[0].tenantId = 'other-tenant';
  await rejects(() => issuePass(mapping), [RESIDENT_SERVICE_ERRORS.MAPPING_NOT_CURRENT], 503);

  const policy = harness();
  policy.repository.state.publications[0].policyDigest = 'sha256:' + 'b'.repeat(64);
  await rejects(() => issuePass(policy), [RESIDENT_SERVICE_ERRORS.POLICY_NOT_CURRENT], 503);
  console.log('scenario invalid evidence: ok');
}

async function scenarioScopedRuleTakeover(): Promise<void> {
  const h = harness();
  await createRules(h);
  const scopedActor = residentStaff({
    permissionStationScopes: { 'resident-services:configure': [HOME_STATION] }
  });
  const globalRule = h.repository.state.rules.find((row) => row.serviceKind === 'TOWEL');
  assert.ok(globalRule);
  await rejects(() => h.benefits.updateRule(globalRule!.ruleId, {
    stationIds: [HOME_STATION],
    expectedRevision: globalRule!.revision
  }, scopedActor as never), [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);
  assert.equal(h.repository.state.rules.find(
    (row) => row.ruleId === globalRule!.ruleId
  )?.stationScope.kind, 'ALL_STATIONS');

  // A station-scoped admin cannot retarget a rule that belongs to another station.
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    stationIds: [HOME_STATION],
    limitPeriod: 'MONTH',
    limitQuantity: 4,
    returnable: false
  }, 'scoped-month-rule-0001', residentStaff() as never, 'corr:scoped-month');
  const homeRule = h.repository.state.rules.find(
    (row) => row.stationScope.kind === 'STATION_LIST'
  );
  assert.ok(homeRule);
  await rejects(() => h.benefits.updateRule(homeRule!.ruleId, {
    limitQuantity: 10,
    expectedRevision: homeRule!.revision
  }, residentStaff({
    permissionStationScopes: { 'resident-services:configure': [OTHER_STATION] }
  }) as never), [RESIDENT_SERVICE_ERRORS.STATION_FORBIDDEN], 403);

  // Overlapping station lists would create an ambiguous runtime rule.
  await rejects(() => h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    stationIds: [HOME_STATION, OTHER_STATION],
    limitPeriod: 'WEEK',
    limitQuantity: 1,
    returnable: false
  }, 'overlapping-rule-0001', residentStaff() as never, 'corr:overlap'),
  [RESIDENT_SERVICE_ERRORS.BENEFIT_RULE_CONFLICT], 409);

  // A duplicate-key race is reported as a conflict, never as an internal error.
  const originalInsert = h.repository.insertBenefitRule.bind(h.repository);
  h.repository.insertBenefitRule = async () => {
    throw Object.assign(new Error('duplicate'), { code: 11000 });
  };
  try {
    await rejects(() => h.benefits.createRule({
      subscriptionTypeId: 'subscription_type:piter-friendship-12m',
      serviceKind: 'RACKET',
      stationIds: [HOME_STATION],
      limitPeriod: 'WEEK',
      limitQuantity: 1,
      returnable: true
    }, 'duplicate-race-rule-0001', residentStaff() as never, 'corr:duplicate-race'),
    [RESIDENT_SERVICE_ERRORS.BENEFIT_RULE_CONFLICT], 409);
  } finally {
    h.repository.insertBenefitRule = originalInsert;
  }
  console.log('scenario scoped rule takeover: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});