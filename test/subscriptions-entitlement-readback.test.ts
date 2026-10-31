import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException,
  ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { AdminAuditInterceptor } from '../src/common/observability/admin-audit.interceptor';
import { SKIP_ADMIN_MUTATION_AUDIT_KEY } from '../src/common/observability/admin-audit.decorator';
import { ReadbackSubscriptionEntitlementDto } from '../src/subscriptions/dto/subscription-entitlement-lifecycle.dto';
import { SubscriptionEntitlementLifecycleService } from '../src/subscriptions/subscription-entitlement-lifecycle.service';
import { SubscriptionTrustedShadowAdapterService, computeSubscriptionClientRefHash } from '../src/subscriptions/subscription-trusted-shadow-adapter.service';
import { SubscriptionTrustedShadowController } from '../src/subscriptions/subscriptions.controller';
import { SubscriptionsExceptionFilter } from '../src/subscriptions/subscriptions-exception.filter';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import { StoredSubscriptionRuntimeOperation } from '../src/subscriptions/subscriptions.types';
import { aggregateFixture, quoteFixture, NOW } from './helpers/subscription-entitlement-fixtures';

const TOKEN = 'synthetic-readback-integration-token-only';
const PEPPER = 'synthetic-readback-hash-pepper-only-32';
const TENANT = 'tenant:piter';
const CLIENT = 'client:readback';
const HASH = computeSubscriptionClientRefHash({ pepper: PEPPER, tenantId: TENANT, providerClientId: CLIENT });
const dto = { operationId: 'booking:readback-1', subscriptionInstanceId: 'subscription:annual-1' };
const denied = new Proxy({}, { get: (_target, key) => { throw new Error(`Unexpected dependency access: ${String(key)}`); } });

function operationFixture(): StoredSubscriptionRuntimeOperation {
  return { schemaVersion: 1, ...dto, revision: 3, tenantId: TENANT, kind: 'BOOKING', state: 'FAILED',
    actor: { type: 'CLIENT', actorId: HASH }, idempotency: { keyHash: 'a'.repeat(64), requestHash: 'b'.repeat(64) },
    correlationId: 'correlation:readback', decision: quoteFixture(aggregateFixture()).decision,
    providerCorrelationId: null, providerEvidenceRefs: [], attempts: 0, nextAttemptAt: null,
    compensationState: 'APPLIED', lastReconciledAt: NOW, lastReconciliationResult: 'PROVIDER_REJECTED',
    createdAt: NOW, updatedAt: NOW, terminalAt: NOW };
}

function fixture() {
  let row: StoredSubscriptionRuntimeOperation | null = operationFixture();
  let identityTenant = TENANT;
  let identityClient = CLIENT;
  const calls: { filter: unknown; options: unknown }[] = [];
  let connections = 0;
  const repository = new SubscriptionsRepository();
  const collection = { findOne: async (filter: Record<string, unknown>, options: unknown) => {
    calls.push({ filter, options });
    if (!row) return null;
    const stored = row as unknown as Record<string, unknown>;
    const matches = Object.entries(filter).every(([key, value]) => key.split('.').reduce<unknown>(
      (current, field) => (current as Record<string, unknown> | undefined)?.[field], stored) === value);
    return matches ? structuredClone(row) : null;
  } };
  Object.assign(repository, { db: { collection: (name: string) => {
    assert.equal(name, 'subscription_operations'); return collection;
  } }, ensureIndexes: () => { throw new Error('No index writes permitted'); } });
  const connectReadOnly = repository.connectReadOnly.bind(repository);
  repository.connectReadOnly = async () => { connections += 1; await connectReadOnly(); };
  repository.connect = async () => { throw new Error('Default connection forbidden'); };
  const adapter = new SubscriptionTrustedShadowAdapterService({ verifyTrustedBearer: async (bearer: string | undefined) => {
    if (bearer !== 'Bearer valid-fixture') throw new UnauthorizedException('Verified bearer required');
    return { actor: { tenantKey: identityTenant, clientId: identityClient, issuer: 'fixture', subject: 'fixture' } };
  } } as never, denied as never, denied as never);
  const service = new SubscriptionEntitlementLifecycleService(adapter, denied as never, repository);
  return { repository, service, calls, get connections() { return connections; },
    get row() { return row; }, set row(value) { row = value; },
    set tenant(value: string) { identityTenant = value; }, set client(value: string) { identityClient = value; } };
}

function envelope(error: HttpException): { status: number; payload: any; headers: Record<string, string> } {
  let status = 0; let payload: any;
  const headers: Record<string, string> = {};
  const response = { setHeader: (key: string, value: string) => { headers[key] = value; },
    status: (value: number) => { status = value; return response; }, json: (value: unknown) => { payload = value; } };
  new SubscriptionsExceptionFilter().catch(error, { switchToHttp: () => ({
    getRequest: () => ({ headers: { 'x-correlation-id': 'readback-correlation' }, user: undefined }),
    getResponse: () => response
  }) } as never);
  return { status, payload, headers };
}

export async function runEntitlementReadbackTests(): Promise<void> {
  const settings = { SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED: 'true',
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true', SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED: 'true',
    SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN: TOKEN, SUBSCRIPTIONS_RUNTIME_TENANT_ID: TENANT,
    SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: PEPPER, SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT: 'true',
    SUBSCRIPTIONS_OWNER_EVIDENCE_SECRET: '' };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try {
    const f = fixture();
    const read = (body = dto) => f.service.readback('Bearer valid-fixture', TOKEN, body);
    const initial = structuredClone(f.row);
    const success = await read();
    assert.deepEqual(success, { schemaVersion: 1, ...dto, operationState: 'FAILED',
      compensationState: 'APPLIED', releaseReason: 'PROVIDER_REJECTED', providerBookingId: null });
    assert.deepEqual(f.row, initial);
    assert.equal(f.connections, 1);
    assert.deepEqual(f.calls, [{ filter: { ...dto, tenantId: TENANT, 'actor.type': 'CLIENT',
      'actor.actorId': HASH, kind: 'BOOKING' }, options: { projection: { _id: 0 },
      readPreference: 'primary', readConcern: { level: 'majority' } } }]);
    // No owner key exists: a signing/verification/mutation call would fail this successful read.
    for (const patch of [
      { state: 'RESERVED', compensationState: 'NONE', lastReconciliationResult: 'ENTITLEMENT_RESERVED', terminalAt: null },
      { state: 'CONFIRMED', compensationState: 'NONE', lastReconciliationResult: 'BOOKING_CONFIRMED',
        providerCorrelationId: 'booking:provider-1', providerEvidenceRefs: ['viva:booking:provider-1'], terminalAt: NOW },
      { compensationState: 'PENDING' }, { lastReconciliationResult: 'unrelated-reconcile' },
      { lastReconciliationResult: 'BOOKING_CANCELLED', providerCorrelationId: 'booking:provider-1' }
    ] as const) {
      f.row = { ...operationFixture(), ...patch, providerEvidenceRefs: 'providerEvidenceRefs' in patch
        ? [...(patch.providerEvidenceRefs ?? [])] : [] } as StoredSubscriptionRuntimeOperation;
      const stored = structuredClone(f.row);
      const result = await read();
      assert.deepEqual(Object.keys(result).sort(), Object.keys(success).sort());
      assert.equal(result.operationState, f.row.state);
      assert.equal(result.compensationState, f.row.compensationState);
      assert.equal(result.providerBookingId, f.row.providerCorrelationId);
      assert.equal(result.releaseReason, ['PROVIDER_REJECTED', 'BOOKING_CANCELLED'].includes(f.row.lastReconciliationResult!)
        ? f.row.lastReconciliationResult : null);
      assert.deepEqual(f.row, stored);
    }
    const notFound: ReturnType<typeof envelope>[] = [];
    for (const patch of [null, { operationId: 'booking:other' }, { subscriptionInstanceId: 'subscription:other' },
      { tenantId: 'tenant:other' }, { actor: { type: 'CLIENT', actorId: 'c'.repeat(64) } },
      { actor: { type: 'SYSTEM', actorId: 'actor:system' } }, { kind: 'CANCELLATION' }] as const) {
      f.row = patch === null ? null : { ...operationFixture(), ...patch } as StoredSubscriptionRuntimeOperation;
      const failure = await read().catch(error => error);
      assert.ok(failure instanceof NotFoundException);
      notFound.push(envelope(failure));
    }
    assert.ok(notFound.every(result => JSON.stringify(result) === JSON.stringify(notFound[0])));
    f.row = operationFixture();
    await assert.rejects(read({ ...dto, subscriptionInstanceId: 'subscription:foreign' }), NotFoundException);
    for (const patch of [{ decision: null }, { compensationState: 'INVALID' }, { providerCorrelationId: undefined },
      { state: 'INVALID' }, { decision: { decisionKind: 'PURCHASE' } }]) {
      f.row = { ...operationFixture(), ...patch } as unknown as StoredSubscriptionRuntimeOperation;
      const failure = await read().catch(error => error);
      assert.ok(failure instanceof ServiceUnavailableException);
      assert.equal(envelope(failure).payload.error.code, 'UPSTREAM_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(envelope(failure)), /keyHash|policyDigest|clientRefHash/);
    }
    f.row = operationFixture();
    for (const key of ['SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED', 'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED',
      'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED'] as const) {
      const count: number = f.calls.length;
      process.env[key] = 'false';
      await assert.rejects(read(), ServiceUnavailableException);
      assert.equal(f.calls.length, count);
      process.env[key] = 'true';
    }
    for (const token of [undefined, 'invalid-fixture-token']) {
      const count: number = f.calls.length;
      const failure = await f.service.readback('Bearer valid-fixture', token, dto).catch(error => error);
      assert.ok(failure instanceof ForbiddenException);
      assert.equal(envelope(failure).status, 401); // Existing anonymous entitlement filter mapping.
      assert.equal(envelope(failure).payload.error.code, 'AUTH_REQUIRED');
      assert.equal(f.calls.length, count);
    }
    process.env.SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN = 'short';
    await assert.rejects(read(), ServiceUnavailableException);
    process.env.SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN = TOKEN;
    await assert.rejects(f.service.readback(undefined, TOKEN, dto), UnauthorizedException);
    await assert.rejects(f.service.readback('Bearer invalid', TOKEN, dto), UnauthorizedException);
    f.tenant = 'tenant:other'; await assert.rejects(read(), ForbiddenException); f.tenant = TENANT;
    f.client = ''; await assert.rejects(read(), UnauthorizedException); f.client = CLIENT;

    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const metadata = { type: 'body' as const, metatype: ReadbackSubscriptionEntitlementDto };
    assert.deepEqual({ ...await pipe.transform(dto, metadata) }, dto);
    for (const body of [{}, { ...dto, operationId: null }, { ...dto, operationId: 'x' },
      { ...dto, operationId: 'x'.repeat(201) }, { ...dto, subscriptionInstanceId: 'bad id' },
      { ...dto, tenantId: TENANT }, { ...dto, ownerEvidence: 'forbidden' }, { ...dto, idempotencyKey: 'not-needed' }]) {
      await assert.rejects(pipe.transform(body, metadata), BadRequestException);
    }
    const handler = SubscriptionTrustedShadowController.prototype.readbackEntitlement;
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'entitlements/readback');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
    assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
    assert.equal(Reflect.getMetadata(SKIP_ADMIN_MUTATION_AUDIT_KEY, handler), true);
    assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler).map((header: any) => [header.name, header.value]).sort(),
      [['Cache-Control', 'no-store'], ['Referrer-Policy', 'no-referrer']]);
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, SubscriptionTrustedShadowController, 'readbackEntitlement')) as any[];
    assert.deepEqual(args.filter(arg => typeof arg.data === 'string').map(arg => arg.data).sort(),
      ['authorization', 'x-correlation-id', 'x-subscriptions-integration-token']);
    const controller = new SubscriptionTrustedShadowController(denied as never, f.service, denied as never,
      denied as never, denied as never, denied as never, denied as never, denied as never);
    assert.deepEqual(await controller.readbackEntitlement('Bearer valid-fixture', TOKEN, 'readback-correlation', dto), success);
    let audits = 0;
    const interceptor = new AdminAuditInterceptor({ appendAudit: async () => { audits += 1; } } as never, new Reflector());
    await lastValueFrom(interceptor.intercept({ getType: () => 'http', getHandler: () => handler,
      getClass: () => SubscriptionTrustedShadowController } as never, { handle: () => of(success) }));
    assert.equal(audits, 0);
    // Verify connection mode independently without connecting a Mongo client.
    const readonly = new SubscriptionsRepository();
    const modes: string[] = [];
    Object.assign(readonly, { initialize: async (mode: string) => { modes.push(mode); } });
    await readonly.connectReadOnly();
    assert.deepEqual(modes, ['VERIFY_ONLY']);
    console.log('entitlement readback contract/identity/repository/DTO/controller tests: OK (synthetic identity, no database)');
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

if (require.main === module) runEntitlementReadbackTests().catch(error => { console.error(error); process.exitCode = 1; });
