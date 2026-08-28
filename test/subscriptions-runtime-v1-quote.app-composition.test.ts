import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { MongoClient } from 'mongodb';
import { AuthService } from '../src/auth/auth.service';
import { LkIdentityService } from '../src/lk-identity/lk-identity.service';
import { SubscriptionRuntimeV1QuoteService } from
  '../src/subscriptions/subscription-runtime-v1-quote.service';
import { SubscriptionTrustedShadowAdapterService } from
  '../src/subscriptions/subscription-trusted-shadow-adapter.service';

const TOKEN = 'runtime-v1-app-composition-token-20260825';
const AUTHORIZATION = 'Bearer isolated-app-composition-user';
const DIGEST = `sha256:${'b'.repeat(64)}`;

const quoteRequest = (overrides: Record<string, unknown> = {}) => ({
  action: 'JOIN_GAME',
  target: { kind: 'GAME', id: 'game:app-composition', expectedRevision: 7 },
  preferredSubscriptionInstanceId: 'subscription_instance:app-composition',
  paymentIntent: 'USE_SUBSCRIPTION',
  ...overrides
});

const quoteResult = {
  quoteKind: 'SHADOW',
  nonBinding: true,
  requiresReservationRecheck: true,
  eligible: true,
  blockers: [],
  subscriptionInstanceId: 'subscription_instance:app-composition',
  policyVersion: 3,
  policyDigest: DIGEST,
  aggregateRevision: 9,
  evaluatedAt: '2026-08-25T10:00:00.000Z',
  usageUnits: 1,
  activeServices: 0,
  maxActiveServices: 3,
  dailyUsed: 0,
  dailyLimit: 1,
  benefit: {
    kind: 'FREE_ENTITLEMENT',
    ruleId: 'rule:app-composition',
    stationRuleId: 'station-rule:app-composition',
    basePriceMinor: 400_000,
    discountMinor: 400_000,
    surchargeMinor: 0,
    finalPriceMinor: 0,
    partialPriceCalculation: null,
    currency: 'RUB'
  },
  decision: null
};

interface HttpResult {
  response: Response;
  body: any;
}

function configureIsolatedEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key === 'MONGODB_URI' || key.endsWith('_MONGODB_URI')) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    ADMIN_AUTH_ENABLED: 'false',
    HTTP_METRICS_LOG_INTERVAL_MS: '0',
    PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false',
    TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
    TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
    VIVA_REFERENCE_CACHE_ENABLED: 'false',
    WEB_PUSH_ENABLED: 'false',
    SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
    SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED: 'true',
    SUBSCRIPTIONS_RUNTIME_V1_MODE: 'WARN',
    SUBSCRIPTIONS_RUNTIME_V1_QUOTE_TTL_SECONDS: '120',
    SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN: TOKEN,
    SUBSCRIPTIONS_RUNTIME_TENANT_ID: 'tenant:app-composition'
  });
}

function restoreEnv(originalEnv: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function replaceMethod(
  target: object,
  key: PropertyKey,
  value: (...args: any[]) => any
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  assert.ok(descriptor, `Expected ${String(key)} method descriptor`);
  Object.defineProperty(target, key, { ...descriptor, value });
  return () => Object.defineProperty(target, key, descriptor);
}

async function startApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  try {
    app.use(json({ limit: '1mb' }));
    app.use(urlencoded({ extended: true, limit: '1mb' }));
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
    await app.close().catch(() => undefined);
    throw error;
  }
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
      'x-correlation-id': 'correlation:app-composition',
      'idempotency-key': 'idempotency:app-composition',
      'x-subscription-runtime-contract-version': '1',
      ...headers
    },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function run(): Promise<void> {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const restorers: Array<() => void> = [];
  let app: INestApplication | undefined;
  let mongoConnectAttempts = 0;
  let externalFetchAttempts = 0;
  let identityCalls = 0;
  let adapterCalls = 0;

  try {
    configureIsolatedEnvironment();

    globalThis.fetch = (async (input: any, init?: any) => {
      const rawUrl = input instanceof URL
        ? input.toString()
        : typeof input === 'string'
          ? input
          : String(input?.url ?? '');
      const target = new URL(rawUrl);
      if (!['127.0.0.1', '::1', 'localhost'].includes(target.hostname)) {
        externalFetchAttempts += 1;
        throw new Error('External fetch blocked by AppModule composition test');
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    restorers.push(replaceMethod(MongoClient.prototype, 'connect', async () => {
      mongoConnectAttempts += 1;
      throw new Error('Mongo connect blocked by AppModule composition test');
    }));
    restorers.push(replaceMethod(MongoClient, 'connect', async () => {
      mongoConnectAttempts += 1;
      throw new Error('Mongo static connect blocked by AppModule composition test');
    }));
    restorers.push(replaceMethod(
      LkIdentityService.prototype,
      'verifyTrustedBearer',
      async (authorization: string | undefined) => {
        identityCalls += 1;
        if (authorization !== AUTHORIZATION) {
          throw new UnauthorizedException({
            code: 'LK_IDENTITY_BEARER_REQUIRED',
            message: 'Bearer token is required'
          });
        }
        return { actor: { tenantKey: 'tenant:app-composition' } };
      }
    ));
    restorers.push(replaceMethod(
      SubscriptionTrustedShadowAdapterService.prototype,
      'quote',
      async (authorization: string | undefined, token: string | undefined, dto: unknown) => {
        adapterCalls += 1;
        assert.equal(authorization, AUTHORIZATION);
        assert.equal(token, TOKEN);
        assert.deepEqual(dto, {
          subscriptionInstanceId: 'subscription_instance:app-composition',
          action: 'JOIN_GAME',
          target: { targetId: 'game:app-composition', snapshotRevision: 7 }
        });
        return quoteResult;
      }
    ));

    const started = await startApp();
    app = started.app;
    assert.ok(app.get(SubscriptionRuntimeV1QuoteService));

    const auth = app.get(AuthService);
    const resolveUser = auth.resolveUserFromRequest.bind(auth);
    let authGuardCalls = 0;
    auth.resolveUserFromRequest = async (...args: Parameters<AuthService['resolveUserFromRequest']>) => {
      authGuardCalls += 1;
      return resolveUser(...args);
    };

    const eligible = await postQuote(started.baseUrl, quoteRequest());
    assert.equal(eligible.response.status, 200);
    assert.equal(eligible.response.headers.get('cache-control'), 'no-store');
    assert.equal(eligible.body.outcome, 'ENTITLEMENT_APPLIED');
    assert.equal(eligible.body.nonBinding, true);
    assert.equal(eligible.body.requiresReservationRecheck, true);
    assert.equal(eligible.body.price.finalPriceMinor, 0);
    assert.equal(authGuardCalls, 1);
    assert.equal(identityCalls, 1);
    assert.equal(adapterCalls, 1);

    const callsBeforeInvalidBody = { identityCalls, adapterCalls };
    const invalidBody = await postQuote(started.baseUrl, {
      ...quoteRequest(),
      browserPriceMinor: 1
    });
    assert.equal(invalidBody.response.status, 400);
    assert.equal(invalidBody.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual({ identityCalls, adapterCalls }, callsBeforeInvalidBody);
    assert.equal(authGuardCalls, 2);

    const callsBeforeWrongToken = { identityCalls, adapterCalls };
    const wrongToken = await postQuote(started.baseUrl, quoteRequest(), {
      'x-subscriptions-integration-token': 'wrong-app-composition-token-000000'
    });
    assert.equal(wrongToken.response.status, 403);
    assert.equal(wrongToken.body.error.code, 'FORBIDDEN');
    assert.deepEqual({ identityCalls, adapterCalls }, callsBeforeWrongToken);
    assert.equal(authGuardCalls, 3);

    const adapterCallsBeforeMissingBearer = adapterCalls;
    const missingBearer = await postQuote(started.baseUrl, quoteRequest(), { authorization: '' });
    assert.equal(missingBearer.response.status, 401);
    assert.equal(missingBearer.body.error.code, 'AUTH_REQUIRED');
    assert.equal(adapterCalls, adapterCallsBeforeMissingBearer);
    assert.equal(authGuardCalls, 4);

    assert.equal(identityCalls, 2);
    assert.equal(adapterCalls, 1);
    await app.close();
    app = undefined;
    assert.equal(mongoConnectAttempts, 0);
    assert.equal(externalFetchAttempts, 0);
    console.log('subscriptions runtime v1 quote AppModule composition tests: OK');
  } finally {
    let cleanupError: unknown;
    if (app) {
      try {
        await app.close();
      } catch (error) {
        cleanupError = error;
      }
    }
    for (const restore of restorers.reverse()) {
      try {
        restore();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      globalThis.fetch = originalFetch;
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      restoreEnv(originalEnv);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
