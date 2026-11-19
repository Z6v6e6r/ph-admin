import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'node:net';
import { ResidencyBindingSnapshot, ResidencyObservationRepository } from '../src/subscriptions/residency-observation.repository';
import { ResidencyPurchasePolicyService } from '../src/subscriptions/residency-purchase-policy.service';
import { SubscriptionTrustedShadowController } from '../src/subscriptions/subscriptions.controller';
import { SubscriptionRuntimeContextService } from '../src/subscriptions/subscription-runtime-context.service';
import { computeSubscriptionRuntimeProjectionDigest } from '../src/subscriptions/subscription-runtime-contracts';
import { buildSubscriptionProjectionFence } from '../src/subscriptions/subscription-projection-fence';
import { actor, bindingFixture } from './residency-provider-sync.test';

const NOW = '2026-11-19T08:41:20.984Z';

function selectedExerciseBinding() {
  const snapshot: ResidencyBindingSnapshot = bindingFixture();
  const publication = snapshot.publications[0];
  publication.runtimeProjection.benefitRules.find(rule => rule.category === 'GROUP_TRAINING')!
    .externalEventTypeIds = ['viva:direction:3685:type:605'];
  publication.policyDigest = computeSubscriptionRuntimeProjectionDigest(publication.runtimeProjection);
  return { ...snapshot, fence: buildSubscriptionProjectionFence({ mapping: snapshot.mapping, publication, previous: null }) };
}

async function main() {
  const flag = 'SUBSCRIPTIONS_RESIDENCY_PURCHASE_POLICY_ENABLED';
  process.env[flag] = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = actor.tenantId;
  process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER = 'test-only-hash-pepper-'.repeat(2);
  const token = process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN = 'test-only-integration-token-'.repeat(2);
  const identity = new SubscriptionRuntimeContextService({
    verifyTrustedBearer: async (header: string) => {
      if (header !== 'Bearer fixture-first-player' && header !== 'Bearer fixture-foreign') throw new UnauthorizedException();
      return { actor: { tenantKey: header.endsWith('foreign') ? 'tenant:foreign' : actor.tenantId, clientId: actor.providerClientId } };
    }
  } as never, {} as never);
  let snapshot = selectedExerciseBinding();
  let reads = 0;
  const repository = {
    binding: async (tenantId: string) => {
      assert.equal(tenantId, actor.tenantId);
      reads += 1;
      return snapshot;
    }
  } as unknown as ResidencyObservationRepository;
  class FixedTimePolicy extends ResidencyPurchasePolicyService {
    protected now() { return new Date(NOW); }
  }

  const controllerDependencies = Reflect.getMetadata('design:paramtypes', SubscriptionTrustedShadowController) as Function[];
  const services = new Map<Function, unknown>([
    [SubscriptionRuntimeContextService, identity],
    [ResidencyPurchasePolicyService, new FixedTimePolicy(identity, repository)]
  ]);
  @Module({
    controllers: [SubscriptionTrustedShadowController],
    providers: controllerDependencies.map(provide => ({ provide, useValue: services.get(provide) ?? {} }))
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/internal/subscriptions/residency-purchase-policy`;
  const target = {
    exerciseId: '4c9f00aa-d286-4a48-ad29-98757bd0ca87',
    stationId: '588b6151-f4f5-47d9-9449-80edf8cbc748',
    externalEventTypeId: 'viva:direction:3685:type:605',
    startsAt: '2026-11-20T05:00:00.000Z',
    durationMinutes: 60
  };
  const request = (body = target, providedToken = token, bearer = 'Bearer fixture-first-player') => fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: bearer, 'X-Subscriptions-Integration-Token': providedToken },
    body: JSON.stringify(body)
  });

  try {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const publication = snapshot.publications[0];
    assert.deepEqual(await response.json(), {
      schemaVersion: 1, ...target, providerProductId: snapshot.mapping.providerProductId,
      publicationId: publication.publicationId, policyVersion: publication.policyVersion,
      policyDigest: publication.policyDigest, groupTrainingDiscountPercent: 50,
      observedAt: NOW, validUntil: '2026-11-19T08:41:50.984Z'
    });
    assert.equal(reads, 1);
    assert.equal((await request(target, 'invalid')).status, 401);
    assert.equal((await request(target, token, 'Bearer revoked')).status, 401);
    assert.equal((await request(target, token, 'Bearer fixture-foreign')).status, 401);
    process.env[flag] = 'false';
    assert.equal((await request()).status, 503);
    process.env[flag] = 'true';
    assert.equal(reads, 1);

    assert.equal((await request({ ...target, durationMinutes: 45 })).status, 400);
    const callerInjectedDiscount = { ...target, discountPercent: 99 };
    assert.equal((await request(callerInjectedDiscount)).status, 400);
    assert.equal((await request({ ...target, startsAt: '2026-02-31T09:00:00.000Z' })).status, 400);
    for (const changedTarget of [
      { externalEventTypeId: 'viva:direction:99999:type:605' },
      { startsAt: NOW },
      { startsAt: '2026-12-19T08:00:00.000Z' }
    ]) {
      assert.equal((await request({ ...target, ...changedTarget })).status, 422);
    }
    const nearStart = await request({ ...target, startsAt: '2026-11-19T08:41:25.984Z' });
    assert.equal((await nearStart.json()).validUntil, '2026-11-19T08:41:25.984Z');

    snapshot.publications[0].state = 'DISABLED_FOR_NEW_OPERATIONS';
    assert.equal((await request()).status, 503);
    snapshot = selectedExerciseBinding();
    snapshot.publications[0].effectiveAt = '2026-11-20T00:00:00.000Z';
    assert.equal((await request()).status, 503);
    snapshot = selectedExerciseBinding();
    snapshot.publications[0].policyDigest = 'sha256:' + 'f'.repeat(64);
    snapshot.publications[0].runtimeCompatibility = undefined;
    assert.equal((await request()).status, 503);
    console.log('residency purchase policy HTTP: first purchase, authorization, target scope, freshness and publication checks PASS');
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
