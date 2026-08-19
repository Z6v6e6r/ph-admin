import * as assert from 'node:assert/strict';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import { SubscriptionProviderMappingPreviewDto } from '../src/subscriptions/dto/subscription-provider-mapping-preview.dto';
import { SubscriptionShadowQuoteAdapterDto } from '../src/subscriptions/dto/subscription-shadow-quote-adapter.dto';
import { SubscriptionProviderMappingPreviewService } from '../src/subscriptions/subscription-provider-mapping-preview.service';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import {
  computeSubscriptionClientRefHash,
  SubscriptionTrustedShadowAdapterService
} from '../src/subscriptions/subscription-trusted-shadow-adapter.service';

const ENV_NAMES = [
  'SUBSCRIPTIONS_ADMIN_ENABLED',
  'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED',
  'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED',
  'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
  'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER',
  'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID',
  'MONGODB_URI',
  'VIVA_ADMIN_API_BASE_URL',
  'VIVA_ADMIN_API_TOKEN'
] as const;

const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const restoreEnv = (): void => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

const quoteDto = (): SubscriptionShadowQuoteAdapterDto => ({
  subscriptionInstanceId: 'subscription_instance:synthetic-1',
  action: 'CREATE_GAME',
  target: {
    targetId: 'exercise:synthetic-1',
    stationId: 'station:yasenevo',
    category: 'GAME',
    externalEventTypeId: 'event_type:open-game',
    productTypeId: null,
    durationMinutes: 60,
    startsAt: '2026-08-20T06:00:00.000Z',
    basePriceMinor: 400000,
    currency: 'RUB',
    dictionaryRevision: 'dictionary:2026-08-19',
    evidenceRef: 'evidence:exercise-read',
    priceEvidenceRef: 'evidence:price-read',
    resolvedAt: '2026-08-19T09:59:50.000Z'
  }
});

class FixedClockAdapter extends SubscriptionTrustedShadowAdapterService {
  protected override now(): Date {
    return new Date('2026-08-19T10:00:00.000Z');
  }
}

async function testTrustedAdapter(): Promise<void> {
  let identityCalls = 0;
  let quoteCalls = 0;
  let capturedRequest: any;
  const identity = {
    verifyTrustedBearer: async () => {
      identityCalls += 1;
      return {
        ok: true,
        actor: {
          issuer: 'https://identity.invalid/realms/prod',
          subject: 'subject:synthetic-1',
          clientId: 'provider_client:synthetic-1',
          phoneNorm: '70000000000',
          tenantKey: 'iSkq6G',
          authorizedParty: 'lk',
          verified: true,
          source: 'cup-keycloak-jwt'
        },
        token: { expiresAt: '2026-08-19T11:00:00.000Z' }
      };
    }
  } as any;
  const shadowQuote = {
    quote: async (request: unknown) => {
      quoteCalls += 1;
      capturedRequest = request;
      return {
        quoteKind: 'SHADOW',
        nonBinding: true,
        requiresReservationRecheck: true,
        eligible: false,
        blockers: [],
        subscriptionInstanceId: 'subscription_instance:synthetic-1',
        policyVersion: null,
        policyDigest: null,
        aggregateRevision: null,
        evaluatedAt: '2026-08-19T10:00:00.000Z',
        usageUnits: null,
        activeServices: null,
        maxActiveServices: null,
        dailyUsed: null,
        dailyLimit: null,
        benefit: null,
        decision: null
      };
    }
  } as any;
  const adapter = new FixedClockAdapter(identity, shadowQuote);

  delete process.env.SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED;
  await assert.rejects(adapter.quote('Bearer token', 'x'.repeat(32), quoteDto()), (error) => (
    error instanceof ServiceUnavailableException
  ));
  assert.equal(identityCalls, 0);
  assert.equal(quoteCalls, 0);

  process.env.SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN = 'integration-token-'.repeat(3);
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'iSkq6G';
  process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = 'runtime-hash-pepper-'.repeat(3);
  await assert.rejects(adapter.quote('Bearer token', 'wrong-token', quoteDto()), (error) => (
    error instanceof ForbiddenException
  ));
  assert.equal(identityCalls, 0);

  const result = await adapter.quote(
    'Bearer token',
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN,
    quoteDto()
  );
  assert.equal(result.quoteKind, 'SHADOW');
  assert.equal(identityCalls, 1);
  assert.equal(quoteCalls, 1);
  assert.equal(capturedRequest.identity.resolutionSource, 'LK_IDENTITY');
  assert.equal(capturedRequest.identity.tenantId, 'iSkq6G');
  assert.match(capturedRequest.identity.clientRefHash, /^[a-f0-9]{64}$/);
  assert.match(capturedRequest.identity.evidenceRef, /^evidence:lk-identity:[a-f0-9]{64}$/);
  assert.equal(capturedRequest.target.resolutionSource, 'SERVER');
  assert.equal(capturedRequest.target.basePriceMinor, 400000);
  assert.doesNotMatch(JSON.stringify(capturedRequest), /provider_client:synthetic-1|70000000000/);
  assert.equal(
    capturedRequest.identity.clientRefHash,
    computeSubscriptionClientRefHash({
      pepper: process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER,
      tenantId: 'iSkq6G',
      providerClientId: 'provider_client:synthetic-1'
    })
  );

  identity.verifyTrustedBearer = async () => ({
    ok: true,
    actor: {
      issuer: 'https://identity.invalid/realms/prod',
      subject: 'subject:synthetic-1',
      clientId: 'provider_client:synthetic-1',
      phoneNorm: '70000000000',
      tenantKey: 'wrong-tenant',
      authorizedParty: 'lk',
      verified: true,
      source: 'cup-keycloak-jwt'
    },
    token: { expiresAt: '2026-08-19T11:00:00.000Z' }
  }) as any;
  await assert.rejects(adapter.quote(
    'Bearer token',
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN,
    quoteDto()
  ), (error) => error instanceof ForbiddenException);

  identity.verifyTrustedBearer = async () => ({
    ok: true,
    actor: {
      issuer: 'https://identity.invalid/realms/prod',
      subject: 'subject:synthetic-1',
      phoneNorm: '70000000000',
      tenantKey: 'iSkq6G',
      authorizedParty: 'lk',
      verified: true,
      source: 'cup-keycloak-jwt'
    },
    token: { expiresAt: '2026-08-19T11:00:00.000Z' }
  }) as any;
  await assert.rejects(adapter.quote(
    'Bearer token',
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN,
    quoteDto()
  ), (error) => error instanceof UnauthorizedException);

  const invalidDto = plainToInstance(SubscriptionShadowQuoteAdapterDto, {
    ...quoteDto(),
    identity: { clientRefHash: 'browser-controlled' }
  });
  const validationErrors = await validate(invalidDto, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(validationErrors.some((error) => error.property === 'identity'));
  const unsafePriceDto = plainToInstance(SubscriptionShadowQuoteAdapterDto, {
    ...quoteDto(),
    target: { ...quoteDto().target, basePriceMinor: Number.MAX_SAFE_INTEGER + 1 }
  });
  const unsafePriceErrors = await validate(unsafePriceDto);
  assert.ok(unsafePriceErrors.some((error) => error.property === 'target'));
}

async function testProviderMappingPreview(): Promise<void> {
  let connectCalls = 0;
  let policyReads = 0;
  let vivaReads = 0;
  let writeCalls = 0;
  const policy: any = {
    subscriptionTypeId: 'subscription_type:friendship-12m',
    version: 3,
    status: 'DRAFT',
    providerBinding: {
      provider: 'VIVA',
      externalId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      referenceKind: 'PRODUCT_CANDIDATE',
      evidenceState: 'UNVERIFIED'
    }
  };
  const repository = {
    connectReadOnly: async () => { connectCalls += 1; },
    policyVersionByNumber: async () => { policyReads += 1; return policy; },
    insertRuntimeProviderMapping: async () => { writeCalls += 1; }
  } as any;
  const viva = {
    inspectSubscriptionProduct: async (input: any) => {
      vivaReads += 1;
      assert.deepEqual(input, {
        productId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
        clientId: 'provider_client:synthetic-1',
        studioId: 'studio:yasenevo'
      });
      return {
        provider: 'VIVA',
        providerProductId: input.productId,
        name: 'Дружба 12 месяцев',
        type: 'SUBSCRIPTION',
        providerReportedCost: 56000,
        costUnit: 'UNVERIFIED',
        observedAt: '2026-08-19T10:00:00.000Z',
        evidenceRef: `evidence:viva-product:${'a'.repeat(64)}`
      };
    }
  } as any;
  const service = new SubscriptionProviderMappingPreviewService(repository, viva);
  const dto: SubscriptionProviderMappingPreviewDto = {
    canonicalStationId: 'station:yasenevo',
    providerStudioId: 'studio:yasenevo'
  };
  const user = {
    id: 'admin:subscriptions',
    roles: [],
    stationIds: ['station:yasenevo'],
    connectorRoutes: [],
    permissionStationScopes: { 'subscriptions:catalog:write': ['station:yasenevo'] }
  } as any;

  const clientSelectingDto = plainToInstance(SubscriptionProviderMappingPreviewDto, {
    ...dto,
    providerClientId: 'provider_client:browser-selected'
  });
  const clientSelectingErrors = await validate(clientSelectingDto, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  assert.ok(clientSelectingErrors.some((error) => error.property === 'providerClientId'));

  delete process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED;
  await assert.rejects(service.preview(
    policy.subscriptionTypeId,
    '3',
    dto,
    user
  ), (error) => error instanceof ServiceUnavailableException);
  assert.equal(connectCalls, 0);

  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED = 'true';
  await assert.rejects(service.preview(
    policy.subscriptionTypeId,
    '3',
    dto,
    user
  ), (error) => error instanceof ServiceUnavailableException);
  assert.equal(connectCalls, 0);
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID = 'provider_client:synthetic-1';
  const preview = await service.preview(policy.subscriptionTypeId, '3', dto, user);
  assert.equal(preview.evidenceState, 'EVIDENCE_ONLY');
  assert.equal(preview.persisted, false);
  assert.equal(preview.verified, false);
  assert.deepEqual(preview.blockers.map((item) => item.code), [
    'RUNTIME_MAPPING_NOT_PERSISTED',
    'CANONICAL_STUDIO_STATION_MAPPING_UNVERIFIED',
    'POLICY_NOT_PUBLISHED'
  ]);
  assert.equal(connectCalls, 1);
  assert.equal(policyReads, 1);
  assert.equal(vivaReads, 1);
  assert.equal(writeCalls, 0);
  assert.doesNotMatch(JSON.stringify(preview), /provider_client:synthetic-1/);

  await assert.rejects(service.preview(policy.subscriptionTypeId, '3', {
    ...dto,
    canonicalStationId: 'station:other'
  }, user), (error) => error instanceof ForbiddenException);
  assert.equal(connectCalls, 1);

  policy.providerBinding = undefined;
  await assert.rejects(service.preview(
    policy.subscriptionTypeId,
    '3',
    dto,
    user
  ), (error) => error instanceof BadRequestException);
  assert.equal(vivaReads, 1);
  assert.equal(writeCalls, 0);
}

async function testVivaProductInspection(): Promise<void> {
  process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED = 'true';
  process.env.MONGODB_URI = '';
  process.env.VIVA_ADMIN_API_BASE_URL = 'https://viva.invalid';
  process.env.VIVA_ADMIN_API_TOKEN = 'synthetic-viva-token-'.repeat(2);
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls += 1;
    const url = String(input);
    assert.match(url, /\/api\/v1\/products\/subscriptions\/d60f36c5-/);
    assert.match(url, /clientId=provider_client%3Asynthetic-1/);
    assert.match(url, /studioId=studio%3Ayasenevo/);
    assert.equal(init?.method, undefined);
    return new Response(JSON.stringify({
      id: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      name: 'Дружба 12 месяцев',
      type: 'SUBSCRIPTION',
      cost: 56000,
      clientSubscriptionId: 'must-not-leak'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  try {
    const viva = new VivaAdminService();
    const evidence = await viva.inspectSubscriptionProduct({
      productId: 'd60f36c5-1bc5-467e-ad78-05a175d2cf74',
      clientId: 'provider_client:synthetic-1',
      studioId: 'studio:yasenevo'
    });
    assert.equal(fetchCalls, 1);
    assert.equal(evidence.providerProductId, 'd60f36c5-1bc5-467e-ad78-05a175d2cf74');
    assert.equal(evidence.providerReportedCost, 56000);
    assert.equal(evidence.costUnit, 'UNVERIFIED');
    assert.match(evidence.evidenceRef, /^evidence:viva-product:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(evidence), /clientSubscriptionId|must-not-leak/);
  } finally {
    global.fetch = previousFetch;
  }
}

function testIntegrationTokenErrorEnvelope(): void {
  const filter = new SubscriptionsExceptionFilter();
  let status = 0;
  let payload: any;
  const response = {
    setHeader: () => undefined,
    status(value: number) { status = value; return this; },
    json(value: unknown) { payload = value; return this; }
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-correlation-id': 'shadow-adapter-correlation' },
        user: undefined
      }),
      getResponse: () => response
    })
  };
  filter.catch(new ForbiddenException({
    code: 'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_FORBIDDEN',
    message: 'Trusted subscription shadow adapter access is forbidden'
  }), host as never);
  assert.equal(status, 403);
  assert.equal(payload.error.code, 'FORBIDDEN');
  assert.equal(
    payload.error.details.domainCode,
    'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_FORBIDDEN'
  );
}

async function run(): Promise<void> {
  try {
    await testTrustedAdapter();
    await testProviderMappingPreview();
    await testVivaProductInspection();
    testIntegrationTokenErrorEnvelope();
    console.log('subscriptions trusted shadow adapter tests: OK');
  } finally {
    restoreEnv();
  }
}

run().catch((error) => {
  restoreEnv();
  console.error(error);
  process.exit(1);
});
