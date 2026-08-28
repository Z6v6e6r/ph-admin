import * as assert from 'node:assert/strict';
import {
  ForbiddenException,
  ServiceUnavailableException,
  ValidationPipe
} from '@nestjs/common';
import { SubscriptionSaleReadinessDto } from '../src/subscriptions/dto/subscription-sale-readiness.dto';
import {
  LK_NODE_RED_ANNUAL_BOOKING_V1,
  publicationAdapterRuntimeCompatibility
} from '../src/subscriptions/subscription-publication-enforcement-adapter';
import { SubscriptionSaleReadinessService } from '../src/subscriptions/subscription-sale-readiness.service';
import { SubscriptionTrustedShadowController } from '../src/subscriptions/subscriptions.controller';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';

const TOKEN = 'sale-readiness-integration-token-2026';
const TENANT_ID = 'tenant:iSkq6G';
const PRODUCT_ID = '8bf334ba-3050-4017-b40a-7eef2db1eb16';
const STATION_ID = '1ea77cbf-bc36-49a1-96d6-f35c216a409b';
const CHECKED_AT = new Date('2026-08-24T10:00:00.000Z');
const COMPATIBILITY = publicationAdapterRuntimeCompatibility(LK_NODE_RED_ANNUAL_BOOKING_V1);

const dto = (): SubscriptionSaleReadinessDto => Object.assign(
  new SubscriptionSaleReadinessDto(),
  {
    provider: 'VIVA' as const,
    providerProductId: PRODUCT_ID,
    providerScopeKind: 'STATION' as const,
    providerScopeId: STATION_ID,
    requiredAdapterId: COMPATIBILITY.adapterId,
    requiredContractVersion: COMPATIBILITY.contractVersion,
    requiredCapabilityDigest: COMPATIBILITY.capabilityDigest
  }
);

const mapping = () => ({
  schemaVersion: 1 as const,
  mappingId: 'mapping:piter-annual',
  tenantId: TENANT_ID,
  provider: 'VIVA' as const,
  providerProductId: PRODUCT_ID,
  providerScope: { kind: 'STATION' as const, scopeId: STATION_ID },
  subscriptionTypeId: 'subscription-type:piter-annual',
  state: 'VERIFIED' as const,
  evidenceRef: 'evidence:provider-product-readback',
  verifiedAt: '2026-08-24T09:30:00.000Z',
  verifiedBy: 'admin:subscriptions',
  revision: 4,
  createdAt: '2026-08-23T10:00:00.000Z',
  createdBy: 'admin:subscriptions',
  updatedAt: '2026-08-24T09:30:00.000Z',
  updatedBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'mapping-piter-annual',
    requestHash: 'a'.repeat(64),
    correlationId: 'corr:mapping-piter-annual'
  }
});

const subscriptionType = () => ({
  schemaVersion: 1 as const,
  subscriptionTypeId: 'subscription-type:piter-annual',
  code: 'PITER_ANNUAL',
  codeNorm: 'piter_annual',
  title: 'Piter annual',
  description: null,
  state: 'ACTIVE' as const,
  currentPolicyVersion: 2,
  revision: 7,
  createdAt: '2026-08-23T10:00:00.000Z',
  updatedAt: '2026-08-24T09:00:00.000Z',
  createdBy: 'admin:subscriptions',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'type-piter-annual',
    requestHash: 'b'.repeat(64),
    correlationId: 'corr:type-piter-annual'
  }
});

const publication = () => ({
  schemaVersion: 3 as const,
  publicationId: 'publication:piter-annual-v2',
  subscriptionTypeId: 'subscription-type:piter-annual',
  policyVersion: 2,
  policyDigest: `sha256:${'c'.repeat(64)}`,
  mappingId: 'mapping:piter-annual',
  dictionaryRevision: 'dictionary:2026-08-24',
  runtimeProjection: {
    runtimeSchemaVersion: 1 as const,
    subscriptionTypeId: 'subscription-type:piter-annual',
    policyVersion: 2,
    status: 'PUBLISHED' as const,
    effectiveAt: '2026-08-24T09:00:00.000Z',
    timeZone: 'Europe/Moscow' as const,
    stationAccessRules: [{
      ruleId: 'station-rule:piter',
      enabled: true,
      priority: 1,
      selector: { kind: 'STATION_LIST' as const, stationIds: [STATION_ID] },
      surcharge: { kind: 'NONE' as const, amountMinor: 0 }
    }]
  },
  state: 'PUBLISHED' as const,
  effectiveAt: '2026-08-24T09:00:00.000Z',
  publishedAt: '2026-08-24T08:55:00.000Z',
  publishedBy: 'admin:subscriptions',
  supersededAt: null,
  supersededBy: null,
  impactPreviewRef: 'impact:piter-annual-v2',
  approvalAuditRef: 'audit:piter-annual-v2',
  idempotency: {
    actorId: 'admin:subscriptions',
    key: 'publication-piter-annual-v2',
    requestHash: 'd'.repeat(64),
    correlationId: 'corr:publication-piter-annual-v2'
  },
  runtimeCompatibility: { ...COMPATIBILITY }
});

const checkpoint = () => ({
  schemaVersion: 1 as const,
  checkpointId: 'checkpoint:piter-annual',
  tenantId: TENANT_ID,
  provider: 'VIVA' as const,
  providerProductId: PRODUCT_ID,
  providerScope: { kind: 'STATION' as const, scopeId: STATION_ID },
  binding: {
    mappingId: mapping().mappingId,
    mappingRevision: mapping().revision,
    subscriptionTypeId: publication().subscriptionTypeId,
    publicationId: publication().publicationId,
    policyVersion: publication().policyVersion,
    policyDigest: publication().policyDigest,
    releaseProgramId: 'release-program:piter-annual',
    releaseProgramRevision: 1,
    releasePhaseId: 'release-phase:piter-annual',
    runtimeCompatibility: { ...COMPATIBILITY }
  },
  producer: {
    producerId: 'VIVA_ANNUAL_SUBSCRIPTION_INSTANCE_PROJECTOR' as const,
    contractVersion: 1 as const,
    producerCapabilityDigest: `sha256:${'e'.repeat(64)}` as `sha256:${string}`,
    sourceContractDigest: `sha256:${'f'.repeat(64)}` as `sha256:${string}`
  },
  state: 'CURRENT' as const,
  coverage: {
    kind: 'CONSISTENT_FULL_SNAPSHOT' as const,
    snapshotId: 'snapshot:piter-annual-20260824',
    snapshotDigest: `sha256:${'1'.repeat(64)}` as `sha256:${string}`,
    coverageThrough: '2026-08-24T09:59:30.000Z',
    sourceItemCount: 1
  },
  reconciliation: {
    runId: 'run:piter-annual-20260824',
    mode: 'INITIAL_FULL' as const,
    startedAt: '2026-08-24T09:59:00.000Z',
    completedAt: '2026-08-24T09:59:30.000Z',
    sourceItemCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    replayedCount: 0,
    terminalCount: 0,
    failureCount: 0,
    sourceEvidenceRef: `provider_snapshot_evidence:sha256:${'2'.repeat(64)}`,
    resultEvidenceRef: `projection_result:sha256:${'3'.repeat(64)}`,
    reconciliationDigest: `sha256:${'4'.repeat(64)}` as `sha256:${string}`
  },
  failure: null,
  lease: null,
  revision: 1,
  createdAt: '2026-08-24T09:59:30.000Z',
  updatedAt: '2026-08-24T09:59:30.000Z'
});

class RepositoryStub {
  connectCalls = 0;
  mappingReads = 0;
  typeReads = 0;
  publicationReads = 0;
  checkpointReads = 0;
  lastMappingIdentity: unknown = null;
  firstMapping: any = mapping();
  secondMapping: any = this.firstMapping;
  firstType: any = subscriptionType();
  secondType: any = this.firstType;
  currentPublication: any = publication();
  currentCheckpoint: any = null;
  connectError: Error | null = null;

  async connectReadOnly(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectError) throw this.connectError;
  }

  async runtimeProviderMappingByProviderIdentity(identity: unknown) {
    this.lastMappingIdentity = identity;
    this.mappingReads += 1;
    return this.mappingReads === 1 ? this.firstMapping : this.secondMapping;
  }

  async subscriptionTypeById() {
    this.typeReads += 1;
    return this.typeReads === 1 ? this.firstType : this.secondType;
  }

  async runtimePolicyPublicationByVersion() {
    this.publicationReads += 1;
    return this.currentPublication;
  }

  async runtimeInstanceProjectorCheckpointByProviderIdentity() {
    this.checkpointReads += 1;
    return this.currentCheckpoint;
  }
}

class FixedClockService extends SubscriptionSaleReadinessService {
  protected now(): Date {
    return CHECKED_AT;
  }
}

const service = (repository = new RepositoryStub()) => ({
  repository,
  service: new FixedClockService(repository as any)
});

const blockerCodes = (result: Awaited<ReturnType<FixedClockService['check']>>) =>
  result.blockers.map((item) => item.code);

const exceptionCode = (error: unknown): string | undefined => {
  if (!(error instanceof ServiceUnavailableException)
    && !(error instanceof ForbiddenException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' && body && 'code' in body
    ? String((body as { code: unknown }).code)
    : undefined;
};

function configure(): void {
  process.env.SUBSCRIPTIONS_SALE_READINESS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN = TOKEN;
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = TENANT_ID;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = '3600';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'false';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED = 'false';
}

async function verifyDtoBoundary(): Promise<void> {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata = { type: 'body' as const, metatype: SubscriptionSaleReadinessDto, data: '' };
  await pipe.transform({ ...dto() }, metadata);
  await assert.rejects(() => pipe.transform({ ...dto(), tenantId: TENANT_ID }, metadata));
  await assert.rejects(() => pipe.transform({ ...dto(), providerScopeKind: 'STUDIO' }, metadata));
  await assert.rejects(() => pipe.transform({ ...dto(), providerScopeId: 'x' }, metadata));
  await assert.rejects(() => pipe.transform({
    ...dto(), providerScopeKind: 'STATION_SET', providerScopeId: 'station-set:not-a-digest'
  }, metadata));
  await assert.rejects(() => pipe.transform({ ...dto(), requiredContractVersion: 0 }, metadata));
  await assert.rejects(() => pipe.transform({
    ...dto(), requiredCapabilityDigest: `sha256:${'A'.repeat(64)}`
  }, metadata));
}

async function verifyConfigurationAndAuth(): Promise<void> {
  configure();
  const disabled = service();
  process.env.SUBSCRIPTIONS_SALE_READINESS_ENABLED = 'false';
  await assert.rejects(
    () => disabled.service.check(TOKEN, dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_READINESS_DISABLED'
  );
  assert.equal(disabled.repository.connectCalls, 0);

  configure();
  const shortToken = service();
  process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN = 'short';
  await assert.rejects(
    () => shortToken.service.check('short', dto()),
    (error) => exceptionCode(error)
      === 'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_NOT_CONFIGURED'
  );
  assert.equal(shortToken.repository.connectCalls, 0);

  configure();
  const wrongToken = service();
  await assert.rejects(
    () => wrongToken.service.check(`${TOKEN}-wrong`, dto()),
    (error) => error instanceof ForbiddenException
      && exceptionCode(error) === 'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_FORBIDDEN'
  );
  assert.equal(wrongToken.repository.connectCalls, 0);

  configure();
  const invalidTenant = service();
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'x';
  await assert.rejects(
    () => invalidTenant.service.check(TOKEN, dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_READINESS_TENANT_ID_INVALID'
  );
  assert.equal(invalidTenant.repository.connectCalls, 0);

  configure();
  const invalidStaleness = service();
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS = '29';
  await assert.rejects(
    () => invalidStaleness.service.check(TOKEN, dto()),
    (error) => exceptionCode(error)
      === 'SUBSCRIPTIONS_SALE_READINESS_STALENESS_CONFIG_INVALID'
  );
  assert.equal(invalidStaleness.repository.connectCalls, 0);
}

async function verifyCompatibilityAndExactLookup(): Promise<void> {
  configure();
  const unsupported = service();
  const result = await unsupported.service.check(TOKEN, Object.assign(dto(), {
    requiredAdapterId: 'unsupported-adapter'
  }));
  assert.deepEqual(blockerCodes(result), [
    'SUBSCRIPTIONS_SALE_READINESS_REQUIRED_COMPATIBILITY_UNSUPPORTED',
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);
  assert.equal(unsupported.repository.connectCalls, 0);

  const missing = service();
  missing.repository.firstMapping = null;
  const missingResult = await missing.service.check(TOKEN, dto());
  assert.deepEqual(blockerCodes(missingResult), [
    'SUBSCRIPTIONS_SALE_READINESS_MAPPING_NOT_FOUND',
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);
  assert.deepEqual(missing.repository.lastMappingIdentity, {
    tenantId: TENANT_ID,
    provider: 'VIVA',
    providerProductId: PRODUCT_ID,
    providerScopeKind: 'STATION',
    providerScopeId: STATION_ID
  });
  assert.equal(missing.repository.typeReads, 0);
  assert.equal(missing.repository.publicationReads, 0);
}

async function verifyMappingAndTypeBlockers(): Promise<void> {
  configure();
  const mappingNotReady = service();
  mappingNotReady.repository.firstMapping = {
    ...mapping(),
    state: 'DRAFT',
    verifiedAt: null
  };
  mappingNotReady.repository.secondMapping = mappingNotReady.repository.firstMapping;
  const mappingResult = await mappingNotReady.service.check(TOKEN, dto());
  assert.deepEqual(blockerCodes(mappingResult).slice(0, 2), [
    'SUBSCRIPTIONS_SALE_READINESS_MAPPING_NOT_VERIFIED',
    'SUBSCRIPTIONS_SALE_READINESS_MAPPING_STALE'
  ]);

  const futureMapping = service();
  futureMapping.repository.firstMapping = {
    ...mapping(),
    verifiedAt: '2026-08-24T10:00:01.000Z'
  };
  futureMapping.repository.secondMapping = futureMapping.repository.firstMapping;
  assert.ok(blockerCodes(await futureMapping.service.check(TOKEN, dto()))
    .includes('SUBSCRIPTIONS_SALE_READINESS_MAPPING_STALE'));

  for (const badType of [
    null,
    { ...subscriptionType(), state: 'DRAFT' as const },
    { ...subscriptionType(), currentPolicyVersion: null },
    { ...subscriptionType(), currentPolicyVersion: 0 }
  ]) {
    const notCurrent = service();
    notCurrent.repository.firstType = badType;
    notCurrent.repository.secondType = badType;
    const result = await notCurrent.service.check(TOKEN, dto());
    assert.ok(blockerCodes(result)
      .includes('SUBSCRIPTIONS_SALE_READINESS_SUBSCRIPTION_TYPE_NOT_CURRENT'));
    assert.equal(notCurrent.repository.publicationReads, 0);
  }
}

async function verifyPublicationBlockers(): Promise<void> {
  configure();
  const missing = service();
  missing.repository.currentPublication = null;
  assert.deepEqual(blockerCodes(await missing.service.check(TOKEN, dto())), [
    'SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_FOUND',
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);

  const invalid = service();
  invalid.repository.currentPublication = {
    ...publication(),
    schemaVersion: 2,
    state: 'SUPERSEDED',
    effectiveAt: '2026-08-24T10:00:01.000Z',
    mappingId: 'mapping:other',
    runtimeCompatibility: undefined,
    runtimeProjection: {
      ...publication().runtimeProjection,
      stationAccessRules: [{
        ...publication().runtimeProjection.stationAccessRules[0],
        selector: { kind: 'STATION_LIST' as const, stationIds: ['station:other'] }
      }]
    }
  } as any;
  assert.deepEqual(blockerCodes(await invalid.service.check(TOKEN, dto())), [
    'SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_PUBLISHED',
    'SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_EFFECTIVE',
    'SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_LINK_MISMATCH',
    'SUBSCRIPTIONS_SALE_READINESS_PROVIDER_SCOPE_MISMATCH',
    'SUBSCRIPTIONS_SALE_READINESS_RUNTIME_COMPATIBILITY_UNATTESTED',
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);

  const incompatible = service();
  incompatible.repository.currentPublication = {
    ...publication(),
    runtimeCompatibility: { ...COMPATIBILITY, contractVersion: 2 }
  };
  assert.ok(blockerCodes(await incompatible.service.check(TOKEN, dto()))
    .includes('SUBSCRIPTIONS_SALE_READINESS_RUNTIME_COMPATIBILITY_MISMATCH'));
}

async function verifyFailClosedAndDrift(): Promise<void> {
  configure();
  const exact = service();
  const exactResult = await exact.service.check(TOKEN, dto());
  assert.equal(exactResult.ready, false);
  assert.deepEqual(blockerCodes(exactResult), [
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);
  assert.deepEqual(exactResult.providerScope, { kind: 'STATION', scopeId: STATION_ID });
  const serialized = JSON.stringify(exactResult);
  assert.doesNotMatch(serialized, /integration-token|evidenceRef|approvalAuditRef|providerClientId/);
  assert.equal(serialized.includes(TOKEN), false);

  configure();
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'true';
  const contractsOnly = service();
  contractsOnly.repository.currentCheckpoint = checkpoint();
  const contractsOnlyResult = await contractsOnly.service.check(TOKEN, dto());
  assert.equal(contractsOnlyResult.ready, false);
  assert.ok(blockerCodes(contractsOnlyResult)
    .includes('SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'));

  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED = 'true';
  const current = service();
  current.repository.currentCheckpoint = checkpoint();
  const currentResult = await current.service.check(TOKEN, dto());
  assert.equal(currentResult.ready, true);
  assert.deepEqual(currentResult.blockers, []);
  assert.deepEqual(currentResult.instanceProjector, {
    status: 'CURRENT',
    checkpointAsOf: '2026-08-24T09:59:30.000Z'
  });

  const drift = service();
  drift.repository.secondMapping = { ...mapping(), revision: 5 };
  drift.repository.secondType = { ...subscriptionType(), currentPolicyVersion: 3 };
  assert.ok(blockerCodes(await drift.service.check(TOKEN, dto()))
    .includes('SUBSCRIPTIONS_SALE_READINESS_EVIDENCE_CHANGED'));

  const disabledRuntime = service();
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED = 'false';
  assert.deepEqual(blockerCodes(await disabledRuntime.service.check(TOKEN, dto())), [
    'SUBSCRIPTIONS_SALE_READINESS_RUNTIME_CONTEXT_DISABLED',
    'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE'
  ]);

  configure();
  const unavailable = service();
  unavailable.repository.connectError = new Error('Mongo unavailable');
  await assert.rejects(
    () => unavailable.service.check(TOKEN, dto()),
    (error) => exceptionCode(error) === 'SUBSCRIPTIONS_SALE_READINESS_STORAGE_UNAVAILABLE'
  );
}

async function verifyControllerAndFilter(): Promise<void> {
  configure();
  const checked = service();
  const controller = new SubscriptionTrustedShadowController(
    {} as any,
    {} as any,
    {} as any,
    checked.service
  );
  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string) => headers.set(name, value)
  } as any;
  await controller.saleReadiness(TOKEN, 'corr:valid-2026', dto(), response);
  assert.equal(headers.get('X-Correlation-Id'), 'corr:valid-2026');
  await controller.saleReadiness(TOKEN, 'contains space', dto(), response);
  assert.match(String(headers.get('X-Correlation-Id')), /^corr:[0-9a-f-]{36}$/);

  const filter = new SubscriptionsExceptionFilter();
  let status = 0;
  let body: unknown;
  const filterHeaders = new Map<string, string>();
  const filterResponse = {
    setHeader: (name: string, value: string) => filterHeaders.set(name, value),
    status: (value: number) => {
      status = value;
      return { json: (valueBody: unknown) => { body = valueBody; } };
    }
  };
  filter.catch(
    new ForbiddenException({
      code: 'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_FORBIDDEN',
      message: 'forbidden'
    }),
    {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, user: undefined }),
        getResponse: () => filterResponse
      })
    } as any
  );
  assert.equal(status, 403);
  assert.equal((body as any).error.code, 'FORBIDDEN');
  assert.equal((body as any).error.details.domainCode,
    'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_FORBIDDEN');
  assert.equal(filterHeaders.get('Cache-Control'), 'no-store');
  assert.equal(filterHeaders.get('Referrer-Policy'), 'no-referrer');
}

async function main(): Promise<void> {
  await verifyDtoBoundary();
  await verifyConfigurationAndAuth();
  await verifyCompatibilityAndExactLookup();
  await verifyMappingAndTypeBlockers();
  await verifyPublicationBlockers();
  await verifyFailClosedAndDrift();
  await verifyControllerAndFilter();
  console.log('subscriptions sale readiness tests: OK');
}

void main();
