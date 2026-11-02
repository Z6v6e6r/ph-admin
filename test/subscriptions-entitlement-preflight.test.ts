import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, ServiceUnavailableException,
  UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AdminAuditInterceptor } from '../src/common/observability/admin-audit.interceptor';
import { SKIP_ADMIN_MUTATION_AUDIT_KEY } from '../src/common/observability/admin-audit.decorator';
import { PreflightSubscriptionEntitlementDto } from '../src/subscriptions/dto/subscription-entitlement-lifecycle.dto';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { SubscriptionCanonicalTargetResolverService } from '../src/subscriptions/subscription-canonical-target-resolver.service';
import { SubscriptionShadowQuoteService } from '../src/subscriptions/subscription-shadow-quote.service';
import { SubscriptionTrustedShadowAdapterService, computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import { SubscriptionTrustedShadowController } from '../src/subscriptions/subscriptions.controller';
import { aggregateFixture, quoteFixture, NOW, POLICY_DIGEST } from './helpers/subscription-entitlement-fixtures';

const TOKEN = 'synthetic-preflight-integration-token-only';
const TENANT = 'tenant:piter';
const PEPPER = 'synthetic-preflight-hash-pepper-only-32';
const CLIENT = 'client:preflight';
const HASH = computeSubscriptionClientRefHash({ pepper: PEPPER, tenantId: TENANT, providerClientId: CLIENT });
const dto = { subscriptionInstanceId: 'subscription:annual-1', action: 'JOIN_GAME' as const,
  target: { targetId: 'exercise:game-1' } };
const denied = new Proxy({}, { get: (_object, key) => { throw new Error(`Unexpected dependency access: ${String(key)}`); } });
class FixedResolver extends SubscriptionCanonicalTargetResolverService {
  protected override now(): Date { return new Date(NOW); }
}

function fixture() {
  let tenant = TENANT;
  let client = CLIENT;
  let connections = 0;
  let reads = 0;
  let quotes = 0;
  let snapshot: any = { schemaVersion: 1, snapshotId: 'snapshot:target-1', tenantId: TENANT,
    targetId: dto.target.targetId, action: dto.action, state: 'ACTIVE', revision: 1,
    stationId: 'station:piter', category: 'GAME', externalEventTypeId: 'event:open-game', productTypeId: null,
    durationMinutes: 60, startsAt: '2026-09-01T09:00:00.000Z', basePriceMinor: 150000, currency: 'RUB',
    dictionaryRevision: 'dictionary:1', evidenceRef: 'evidence:target-1', priceEvidenceRef: 'evidence:price-1',
    sourceKind: 'CANONICAL_TARGET_PROJECTION', observedAt: NOW, expiresAt: '2026-08-31T10:01:00.000Z', createdAt: NOW };
  let quote = quoteFixture(aggregateFixture());
  quote.decision!.action = 'JOIN_GAME';
  const repository = new Proxy({
    connectReadOnly: async () => { connections += 1; },
    runtimeLatestCanonicalTargetSnapshot: async (ref: any) => {
      reads += 1;
      return snapshot && ref.tenantId === snapshot.tenantId && ref.targetId === snapshot.targetId
        && ref.action === snapshot.action ? structuredClone(snapshot) : null;
    },
    runtimeCanonicalTargetSnapshot: async (ref: any) => {
      reads += 1;
      return snapshot && ref.tenantId === snapshot.tenantId && ref.targetId === snapshot.targetId
        && ref.action === snapshot.action && ref.revision === snapshot.revision ? structuredClone(snapshot) : null;
    }
  }, { get: (object, key) => {
    if (!(key in object)) throw new Error(`Forbidden repository operation: ${String(key)}`);
    return object[key as keyof typeof object];
  } });
  const adapter = new SubscriptionTrustedShadowAdapterService({ verifyTrustedBearer: async (bearer: string) => {
    if (bearer !== 'Bearer valid-fixture') throw new UnauthorizedException('Verified bearer required');
    return { actor: { tenantKey: tenant, clientId: client, issuer: 'fixture', subject: 'fixture' } };
  } } as never, denied as never, new FixedResolver(repository as never));
  const directQuote = { quote: async (request: any) => {
    quotes += 1;
    if (request.identity.clientRefHash !== HASH || request.subscriptionInstanceId !== dto.subscriptionInstanceId) {
      return { ...quote, eligible: false, decision: null,
        blockers: [{ code: 'SUBSCRIPTION_OWNERSHIP_NOT_CONFIRMED', message: 'fixture ownership', details: {} }] };
    }
    return structuredClone(quote);
  } };
  const service = new SubscriptionEntitlementLifecycleService(adapter, directQuote as never, repository as never);
  return { service, adapter, repository, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; },
    get quote() { return quote; }, set quote(value) { quote = value; }, get connections() { return connections; },
    get reads() { return reads; }, get quotes() { return quotes; }, set tenant(value: string) { tenant = value; },
    set client(value: string) { client = value; } };
}

function publicFailure(error: HttpException): { status: number; payload: any } {
  let status = 0;
  let payload: any;
  const response = { setHeader: () => undefined,
    status: (value: number) => { status = value; return response; },
    json: (value: unknown) => { payload = value; } };
  new SubscriptionsExceptionFilter().catch(error, { switchToHttp: () => ({
    getRequest: () => ({ headers: { 'x-correlation-id': 'preflight-correlation' }, user: undefined }),
    getResponse: () => response
  }) } as never);
  return { status, payload };
}

export async function runEntitlementPreflightTests(): Promise<void> {
  const settings = { SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true',
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true', SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED: 'true',
    SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED: 'true', SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED: 'true',
    SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS: '60', SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN: TOKEN,
    SUBSCRIPTIONS_RUNTIME_TENANT_ID: TENANT, SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: PEPPER,
    SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT: 'true', SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: '' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try {
    const f = fixture();
    const read = (body = dto) => f.service.preflight('Bearer valid-fixture', TOKEN, body);
    const before = JSON.stringify({ snapshot: f.snapshot, quote: f.quote });
    const expected = { schemaVersion: 1, nonBinding: true, ...dto, expectations: { schemaVersion: 1,
      policyVersion: 3, policyDigest: POLICY_DIGEST,
      targetSnapshot: { snapshotId: 'snapshot:target-1', revision: 1, evidenceRef: 'evidence:target-1' } } };
    assert.deepEqual(await read(), expected);
    assert.equal(f.connections, 3); // resolver latest + exact read, then direct quote connection
    assert.equal(f.quotes, 1);
    assert.equal(JSON.stringify({ snapshot: f.snapshot, quote: f.quote }), before);
    assert.doesNotMatch(JSON.stringify(expected), /usageRef|expiresAt|clientRefHash|provider|price|stationId|observedAt/i);
    f.snapshot.revision = 2; f.snapshot.snapshotId = 'snapshot:target-2'; f.snapshot.evidenceRef = 'evidence:target-2';
    const changed = await read();
    assert.deepEqual(changed.expectations.targetSnapshot,
      { snapshotId: 'snapshot:target-2', revision: 2, evidenceRef: 'evidence:target-2' });

    for (const patch of [null, { state: 'REVOKED' }, { observedAt: '2026-08-31T09:58:00.000Z' },
      { observedAt: '2026-08-31T10:00:01.000Z' }, { expiresAt: NOW }, { tenantId: 'tenant:other' }]) {
      const g = fixture(); g.snapshot = patch === null ? null : { ...g.snapshot, ...patch };
      await assert.rejects(g.service.preflight('Bearer valid-fixture', TOKEN, dto), ServiceUnavailableException);
      assert.equal(g.quotes, 0);
    }
    for (const patch of [{ snapshotId: undefined }, { revision: undefined }, { evidenceRef: undefined },
      { snapshotId: 'bad id' }, { revision: 1.5 }]) {
      const g = fixture(); g.snapshot = { ...g.snapshot, ...patch };
      await assert.rejects(g.service.preflight('Bearer valid-fixture', TOKEN, dto), ServiceUnavailableException);
    }
    for (const patch of [{ policyVersion: null }, { policyDigest: null }, { policyDigest: 'bad' },
      { decision: null }, { subscriptionInstanceId: 'subscription:foreign' }]) {
      const g = fixture(); g.quote = { ...g.quote, ...patch };
      await assert.rejects(g.service.preflight('Bearer valid-fixture', TOKEN, dto), ServiceUnavailableException);
    }
    const blocked = fixture();
    blocked.quote = { ...blocked.quote, eligible: false, decision: null,
      blockers: [{ code: 'ACTIVE_SERVICES_LIMIT_REACHED', message: 'limit', details: {} }] };
    await assert.rejects(blocked.service.preflight('Bearer valid-fixture', TOKEN, dto), ConflictException);
    const blockedEnvelope = publicFailure(await blocked.service.preflight('Bearer valid-fixture', TOKEN, dto).catch(error => error));
    assert.equal(blockedEnvelope.status, 409);
    assert.equal(blockedEnvelope.payload.error.code, 'POLICY_VERSION_CONFLICT');
    assert.equal(blockedEnvelope.payload.error.details.domainCode, 'SUBSCRIPTION_ENTITLEMENT_BLOCKED');
    assert.doesNotMatch(JSON.stringify(blockedEnvelope), /policyDigest|clientRefHash|evidenceRef|snapshotId/);
    blocked.quote.activeServicesLimitExceeded = 'FULL_PRICE_WITHOUT_SUBSCRIPTION';
    assert.deepEqual(await blocked.service.preflight('Bearer valid-fixture', TOKEN, dto), expected);
    blocked.quote.blockers.push({ code: 'SUBSCRIPTION_OWNERSHIP_NOT_CONFIRMED', message: 'owner', details: {} });
    await assert.rejects(blocked.service.preflight('Bearer valid-fixture', TOKEN, dto), ConflictException);

    for (const key of ['SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED',
      'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED', 'SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED'] as const) {
      const g = fixture(); process.env[key] = 'false';
      await assert.rejects(g.service.preflight('Bearer valid-fixture', TOKEN, dto), ServiceUnavailableException);
      assert.equal(g.quotes, 0); assert.equal(g.reads, 0);
      process.env[key] = 'true';
    }
    const quoteDisabled = fixture();
    const actualQuote = new SubscriptionShadowQuoteService(denied as never);
    for (const key of ['SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED', 'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED']) {
      process.env[key] = 'false';
      await assert.rejects(new SubscriptionEntitlementLifecycleService(quoteDisabled.adapter, actualQuote,
        quoteDisabled.repository as never).preflight('Bearer valid-fixture', TOKEN, dto));
      process.env[key] = 'true';
    }
    for (const token of [undefined, 'invalid-fixture']) {
      const g = fixture();
      await assert.rejects(g.service.preflight('Bearer valid-fixture', token, dto), ForbiddenException);
      const failure = publicFailure(await g.service.preflight('Bearer valid-fixture', token, dto).catch(error => error));
      assert.equal(failure.status, 401);
      assert.equal(failure.payload.error.code, 'AUTH_REQUIRED');
      assert.equal(g.connections, 0); assert.equal(g.quotes, 0);
    }
    for (const bearer of [undefined, 'Bearer invalid']) {
      const g = fixture();
      await assert.rejects(g.service.preflight(bearer, TOKEN, dto), UnauthorizedException);
      assert.equal(g.connections, 0);
    }
    const foreign = fixture(); foreign.tenant = 'tenant:other';
    await assert.rejects(foreign.service.preflight('Bearer valid-fixture', TOKEN, dto), ForbiddenException);
    assert.equal(foreign.connections, 0);
    foreign.tenant = TENANT; foreign.client = 'client:other';
    await assert.rejects(foreign.service.preflight('Bearer valid-fixture', TOKEN, dto), ConflictException);
    await assert.rejects(read({ ...dto, subscriptionInstanceId: 'subscription:foreign' }), ConflictException);

    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: PreflightSubscriptionEntitlementDto };
    assert.deepEqual(JSON.parse(JSON.stringify(await pipe.transform(dto, metadata))), dto);
    for (const body of [null, [], {}, { ...dto, action: 'CREATE_GAME' }, { ...dto, subscriptionInstanceId: null },
      { ...dto, target: [] }, { ...dto, target: { targetId: 'exercise:game-1\n' } },
      { ...dto, expectations: expected.expectations }, { ...dto, policyVersion: 3 }, { ...dto, usageRef: 'booking:x' },
      { ...dto, tenantId: TENANT }, { ...dto, target: { ...dto.target, snapshotRevision: 1 } }]) {
      await assert.rejects(pipe.transform(body, metadata), BadRequestException);
      await assert.rejects(f.service.preflight('Bearer valid-fixture', TOKEN, body as any), BadRequestException);
    }
    const invalidEnvelope = publicFailure(await pipe.transform({ ...dto, expectations: {} }, metadata).catch(error => error));
    assert.equal(invalidEnvelope.status, 400);
    assert.equal(invalidEnvelope.payload.error.code, 'VALIDATION_ERROR');
    const unavailable = fixture(); unavailable.quote.policyDigest = null;
    const unavailableEnvelope = publicFailure(await unavailable.service.preflight('Bearer valid-fixture', TOKEN, dto).catch(error => error));
    assert.equal(unavailableEnvelope.status, 503);
    assert.equal(unavailableEnvelope.payload.error.code, 'UPSTREAM_UNAVAILABLE');
    const handler = SubscriptionTrustedShadowController.prototype.preflightEntitlement;
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'entitlements/preflight');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
    assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
    assert.equal(Reflect.getMetadata(SKIP_ADMIN_MUTATION_AUDIT_KEY, handler), true);
    assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler).map((header: any) => [header.name, header.value]).sort(),
      [['Cache-Control', 'no-store'], ['Referrer-Policy', 'no-referrer']]);
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, SubscriptionTrustedShadowController, 'preflightEntitlement')) as any[];
    assert.deepEqual(args.filter(arg => typeof arg.data === 'string').map(arg => arg.data).sort(),
      ['authorization', 'x-correlation-id', 'x-subscriptions-integration-token']);
    const clean = fixture();
    const controller = new SubscriptionTrustedShadowController(denied as never, clean.service, denied as never,
      denied as never, denied as never, denied as never, denied as never, denied as never);
    assert.deepEqual(await controller.preflightEntitlement('Bearer valid-fixture', TOKEN, 'preflight-correlation', dto), expected);
    let audits = 0;
    const interceptor = new AdminAuditInterceptor({ appendAudit: async () => { audits += 1; } } as never, new Reflector());
    await lastValueFrom(interceptor.intercept({ getType: () => 'http', getHandler: () => handler,
      getClass: () => SubscriptionTrustedShadowController } as never, { handle: () => of(expected) }));
    assert.equal(audits, 0);
    console.log('entitlement preflight DTO/auth/controller/read-only tests: OK; synthetic identity/quote, no DB/provider');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
