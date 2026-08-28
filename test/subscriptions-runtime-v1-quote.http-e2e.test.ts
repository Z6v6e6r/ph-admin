import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import {
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LkIdentityService } from '../src/lk-identity/lk-identity.service';
import { SubscriptionRuntimeV1QuoteService } from
  '../src/subscriptions/subscription-runtime-v1-quote.service';
import { SubscriptionTrustedShadowAdapterService } from
  '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { SubscriptionRuntimeV1Controller } from '../src/subscriptions/subscriptions.controller';

const TOKEN = 'runtime-v1-http-e2e-token-20260825';
const AUTHORIZATION = 'Bearer isolated-http-e2e-user';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const request = (overrides: Record<string, unknown> = {}) => ({
  action: 'JOIN_GAME',
  target: { kind: 'GAME', id: 'game:http-e2e', expectedRevision: 4 },
  preferredSubscriptionInstanceId: 'subscription_instance:http-e2e',
  paymentIntent: 'USE_SUBSCRIPTION',
  ...overrides
});

const shadow = (overrides: Record<string, unknown> = {}) => ({
  quoteKind: 'SHADOW',
  nonBinding: true,
  requiresReservationRecheck: true,
  eligible: true,
  blockers: [],
  subscriptionInstanceId: 'subscription_instance:http-e2e',
  policyVersion: 3,
  policyDigest: DIGEST,
  aggregateRevision: 7,
  evaluatedAt: '2026-08-25T10:00:00.000Z',
  usageUnits: 1,
  activeServices: 0,
  maxActiveServices: 3,
  dailyUsed: 0,
  dailyLimit: 1,
  benefit: {
    kind: 'FREE_ENTITLEMENT',
    ruleId: 'rule:http-e2e',
    stationRuleId: 'station-rule:http-e2e',
    basePriceMinor: 400_000,
    discountMinor: 400_000,
    surchargeMinor: 0,
    finalPriceMinor: 0,
    partialPriceCalculation: null,
    currency: 'RUB'
  },
  decision: null,
  ...overrides
});

let adapterCalls = 0;
let identityCalls = 0;
let adapterResult = shadow();

const adapter = {
  quote: async (authorization: string | undefined, token: string | undefined, dto: unknown) => {
    adapterCalls += 1;
    assert.equal(authorization, AUTHORIZATION);
    assert.equal(token, TOKEN);
    assert.deepEqual(dto, {
      subscriptionInstanceId: 'subscription_instance:http-e2e',
      action: 'JOIN_GAME',
      target: { targetId: 'game:http-e2e', snapshotRevision: 4 }
    });
    return adapterResult;
  }
};

const identity = {
  verifyTrustedBearer: async (authorization: string | undefined) => {
    identityCalls += 1;
    if (authorization !== AUTHORIZATION) {
      throw new UnauthorizedException({
        code: 'LK_IDENTITY_BEARER_REQUIRED',
        message: 'Bearer token is required'
      });
    }
    return { actor: { tenantKey: 'tenant:http-e2e' } };
  }
};

@Module({
  controllers: [SubscriptionRuntimeV1Controller],
  providers: [
    SubscriptionRuntimeV1QuoteService,
    { provide: SubscriptionTrustedShadowAdapterService, useValue: adapter },
    { provide: LkIdentityService, useValue: identity }
  ]
})
class SubscriptionRuntimeV1HttpE2eModule {}

interface HttpResult {
  response: Response;
  body: any;
}

async function postQuote(
  baseUrl: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}/api/internal/subscription-runtime/quote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: AUTHORIZATION,
      'x-subscriptions-integration-token': TOKEN,
      'x-correlation-id': 'correlation:http-e2e',
      'idempotency-key': 'idempotency:http-e2e',
      'x-subscription-runtime-contract-version': '1',
      ...headers
    },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function startApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(SubscriptionRuntimeV1HttpE2eModule, { logger: false });
  try {
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo | null;
    assert.ok(address && typeof address.port === 'number');
    return { app, baseUrl: `http://127.0.0.1:${address.port}` };
  } catch (error) {
    await app.close();
    throw error;
  }
}

function restoreEnv(originalEnv: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

async function run(): Promise<void> {
  const originalEnv = { ...process.env };
  let app: INestApplication | undefined;
  try {
    process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED = 'true';
    process.env.SUBSCRIPTIONS_RUNTIME_V1_MODE = 'WARN';
    process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_TTL_SECONDS = '120';
    process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN = TOKEN;
    process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:http-e2e';

    const started = await startApp();
    app = started.app;

    const eligible = await postQuote(started.baseUrl, request());
    assert.equal(eligible.response.status, 200);
    assert.equal(eligible.response.headers.get('cache-control'), 'no-store');
    assert.equal(eligible.response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(eligible.body.outcome, 'ENTITLEMENT_APPLIED');
    assert.equal(eligible.body.nonBinding, true);
    assert.equal(eligible.body.requiresReservationRecheck, true);
    assert.equal(eligible.body.serviceAllowed, true);
    assert.equal(eligible.body.price.finalPriceMinor, 0);
    assert.doesNotMatch(JSON.stringify(eligible.body), /isolated-http-e2e-user|runtime-v1-http-e2e-token/);

    adapterResult = shadow({
      eligible: false,
      blockers: [{ code: 'EVENT_ALREADY_STARTED', message: 'safe', details: null }]
    });
    const blocked = await postQuote(started.baseUrl, request({ paymentIntent: 'PAY_FULL_PRICE' }));
    assert.equal(blocked.response.status, 200);
    assert.equal(blocked.body.outcome, 'SERVICE_BLOCKED');
    assert.equal(blocked.body.serviceAllowed, false);
    assert.equal(blocked.body.price, null);
    assert.deepEqual(blocked.body.blockers, [{ code: 'SERVICE_UNAVAILABLE' }]);

    const callsBeforeInvalidBody = { adapterCalls, identityCalls };
    const invalidBody = await postQuote(started.baseUrl, {
      ...request(),
      browserPriceMinor: 1
    });
    assert.equal(invalidBody.response.status, 400);
    assert.equal(invalidBody.body.error.code, 'VALIDATION_ERROR');
    assert.ok(invalidBody.body.error.details.validationErrors.some(
      (item: string) => item.includes('browserPriceMinor')
    ));
    assert.deepEqual({ adapterCalls, identityCalls }, callsBeforeInvalidBody);

    const callsBeforeWrongToken = { adapterCalls, identityCalls };
    const wrongToken = await postQuote(started.baseUrl, request(), {
      'x-subscriptions-integration-token': 'wrong-runtime-v1-http-token-000000'
    });
    assert.equal(wrongToken.response.status, 403);
    assert.equal(wrongToken.body.error.code, 'FORBIDDEN');
    assert.equal(
      wrongToken.body.error.details.domainCode,
      'SUBSCRIPTIONS_RUNTIME_V1_INTEGRATION_FORBIDDEN'
    );
    assert.deepEqual({ adapterCalls, identityCalls }, callsBeforeWrongToken);

    const adapterCallsBeforeMissingBearer = adapterCalls;
    const missingBearer = await postQuote(started.baseUrl, request(), { authorization: '' });
    assert.equal(missingBearer.response.status, 401);
    assert.equal(missingBearer.body.error.code, 'AUTH_REQUIRED');
    assert.equal(
      missingBearer.body.error.details.domainCode,
      'LK_IDENTITY_BEARER_REQUIRED'
    );
    assert.equal(adapterCalls, adapterCallsBeforeMissingBearer);

    const callsBeforeWrongVersion = { adapterCalls, identityCalls };
    const wrongVersion = await postQuote(started.baseUrl, request(), {
      'x-subscription-runtime-contract-version': '2'
    });
    assert.equal(wrongVersion.response.status, 503);
    assert.equal(wrongVersion.body.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(
      wrongVersion.body.error.details.domainCode,
      'SUBSCRIPTIONS_RUNTIME_V1_HEADERS_INVALID'
    );
    assert.deepEqual({ adapterCalls, identityCalls }, callsBeforeWrongVersion);

    process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED = 'false';
    const callsBeforeDisabled = { adapterCalls, identityCalls };
    const disabled = await postQuote(started.baseUrl, request());
    assert.equal(disabled.response.status, 503);
    assert.equal(disabled.body.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(
      disabled.body.error.details.domainCode,
      'SUBSCRIPTIONS_RUNTIME_V1_QUOTE_DISABLED'
    );
    assert.deepEqual({ adapterCalls, identityCalls }, callsBeforeDisabled);

    assert.equal(adapterCalls, 2);
    assert.equal(identityCalls, 3);
    console.log('subscriptions runtime v1 quote HTTP e2e tests: OK');
  } finally {
    try {
      if (app) await app.close();
    } finally {
      restoreEnv(originalEnv);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
