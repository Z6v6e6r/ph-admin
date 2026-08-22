import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  buildManagedAnnualSubscriptionV2Candidate,
  VIVA_ANNUAL_OPEN_GAME_DICTIONARY,
  VIVA_ANNUAL_STUDIOS_SNAPSHOT
} from '../src/subscriptions/annual-subscription-policy-v2-candidate';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { Role } from '../src/common/rbac/role.enum';
import { CreatePolicyVersionDto } from '../src/subscriptions/dto/create-policy-version.dto';
import { compileSubscriptionRuntimeProjection } from '../src/subscriptions/subscription-runtime-projection';
import { evaluateSubscriptionShadowQuote } from '../src/subscriptions/subscription-shadow-quote';
import {
  computeSubscriptionRuntimeProjectionDigest,
  validateStoredSubscriptionPolicyPublication
} from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import {
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionPolicyVersion,
  StoredSubscriptionType,
  StoredSubscriptionEntitlementAggregate,
  StoredSubscriptionInstance
} from '../src/subscriptions/subscriptions.types';

class CandidateRepository {
  readonly rows: StoredSubscriptionPolicyVersion[] = [];
  readonly types = new Map<string, StoredSubscriptionType>([
    ['subscription_type:608f1030-580c-4438-b001-1f7fc2053a74', this.type(
      'subscription_type:608f1030-580c-4438-b001-1f7fc2053a74',
      'friendship-12m-piter-2026'
    )],
    ['subscription_type:1f2252e4-7599-454a-9bf4-1fdfe82b2c57', this.type(
      'subscription_type:1f2252e4-7599-454a-9bf4-1fdfe82b2c57',
      'friendship-12m-hub-2026'
    )]
  ]);

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isDuplicateKey(): boolean { return false; }
  async subscriptionTypeById(id: string) { return this.types.get(id) ?? null; }
  async policyByIdempotency(actorId: string, key: string) {
    return this.rows.find((row) => row.idempotency.actorId === actorId && row.idempotency.key === key) ?? null;
  }
  async latestPolicyVersion(typeId: string) {
    return Math.max(1, ...this.rows
      .filter((row) => row.subscriptionTypeId === typeId)
      .map((row) => row.version));
  }
  async insertPolicyVersion(row: StoredSubscriptionPolicyVersion) {
    this.rows.push(structuredClone(row));
  }

  private type(subscriptionTypeId: string, code: string): StoredSubscriptionType {
    return {
      schemaVersion: 1,
      subscriptionTypeId,
      code,
      codeNorm: code,
      title: code,
      description: null,
      state: 'DRAFT',
      currentPolicyVersion: null,
      revision: 1,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      createdBy: 'admin:test',
      idempotency: {
        actorId: 'admin:test',
        key: `type-${code}`,
        requestHash: 'a'.repeat(64),
        correlationId: `corr:${code}`
      }
    };
  }
}

const globalAdmin: RequestUser = {
  id: 'admin:test',
  roles: [Role.SUPER_ADMIN],
  permissions: ['*'],
  permissionStationScopes: { 'subscriptions:catalog:write': null },
  stationIds: [],
  connectorRoutes: []
};

async function dtoErrors(value: unknown): Promise<string[]> {
  const instance = plainToInstance(CreatePolicyVersionDto, value);
  const errors = await validate(instance);
  return errors.map((error) => error.property);
}

async function main(): Promise<void> {
  const piter = buildManagedAnnualSubscriptionV2Candidate('PITER');
  const hub = buildManagedAnnualSubscriptionV2Candidate('HUB');

  assert.deepEqual(await dtoErrors(piter.request), []);
  assert.deepEqual(await dtoErrors(hub.request), []);

  assert.equal(piter.expectedPreviousVersion, 1);
  assert.equal(piter.expectedNextVersion, 2);
  assert.equal(piter.providerEvidence.providerProductId, '8bf334ba-3050-4017-b40a-7eef2db1eb16');
  assert.equal(hub.providerEvidence.providerProductId, 'db7a5250-7369-4f43-8ac5-9111be24bc74');
  assert.equal(piter.providerEvidence.providerStudioLimited, true);
  assert.equal(hub.providerEvidence.providerStudioLimited, false);

  assert.equal(VIVA_ANNUAL_OPEN_GAME_DICTIONARY.directionId, '4588');
  assert.equal(VIVA_ANNUAL_OPEN_GAME_DICTIONARY.typeId, '1613');
  assert.equal(
    VIVA_ANNUAL_OPEN_GAME_DICTIONARY.canonicalExternalEventTypeId,
    'viva:direction:4588:type:1613'
  );

  assert.deepEqual(piter.request.createGame.durationsMinutes, [60]);
  assert.equal(piter.request.joinGame.minDurationMinutes, 60);
  assert.equal(piter.request.joinGame.maxDurationMinutes, 120);
  assert.equal(piter.request.dailyUsageLimit, 1);
  assert.deepEqual(piter.request.benefitRules.map((rule) => rule.actions), [
    ['CREATE_GAME'],
    ['JOIN_GAME']
  ]);
  assert.deepEqual(piter.request.benefitRules[0].durationMinutes, [60]);
  assert.deepEqual(piter.request.benefitRules[1].durationMinutes, [60, 90, 120]);
  assert.ok(piter.request.benefitRules.every((rule) => rule.kind === 'FREE_ENTITLEMENT'));
  assert.ok(piter.request.benefitRules.every((rule) => rule.category === 'GAME'));
  assert.equal(piter.request.benefitRules.length, 2);

  assert.deepEqual(piter.request.benefitRules[0].stationIds, [
    '1ea77cbf-bc36-49a1-96d6-f35c216a409b'
  ]);
  assert.equal(hub.request.benefitRules[0].stationIds.length, 25);
  assert.deepEqual(hub.request.benefitRules[0].stationIds, [...VIVA_ANNUAL_STUDIOS_SNAPSHOT]);
  assert.equal(new Set(hub.request.benefitRules[0].stationIds).size, 25);
  assert.deepEqual(hub.request.stationAccessRules?.[0].selector, {
    kind: 'STATION_LIST',
    stationIds: [...VIVA_ANNUAL_STUDIOS_SNAPSHOT]
  });

  assert.equal(piter.request.capabilities?.lifecycle.activationMode, 'FIRST_USE_OR_FIXED_DATE');
  assert.equal(piter.request.capabilities?.lifecycle.fixedActivationAt, '2026-09-30T21:00:00.000Z');
  assert.equal(hub.request.capabilities?.lifecycle.fixedActivationAt, '2026-09-30T21:00:00.000Z');
  assert.equal(piter.request.capabilities?.usage.crossStationMode, 'HOME_ONLY');
  assert.equal(hub.request.capabilities?.usage.crossStationMode, 'ALLOWED');

  assert.match(piter.dictionaryRevision, /^annual-v2-[a-f0-9]{64}$/);
  assert.match(hub.dictionaryRevision, /^annual-v2-[a-f0-9]{64}$/);
  assert.notEqual(piter.dictionaryRevision, hub.dictionaryRevision);
  assert.equal(piter.dictionaryEvidenceRef, null);
  assert.deepEqual(piter.publicationBlockers, [
    'CANONICAL_DICTIONARY_EVIDENCE_ARTIFACT_REQUIRED',
    'REAL_CANONICAL_TARGET_PRODUCER_REQUIRED'
  ]);
  assert.deepEqual(hub.publicationBlockers, [
    'CANONICAL_DICTIONARY_EVIDENCE_ARTIFACT_REQUIRED',
    'REAL_CANONICAL_TARGET_PRODUCER_REQUIRED'
  ]);

  const previousFlag = process.env.SUBSCRIPTIONS_ADMIN_ENABLED;
  process.env.SUBSCRIPTIONS_ADMIN_ENABLED = 'true';
  try {
    const repository = new CandidateRepository();
    const service = new SubscriptionsService(repository as never);
    for (const candidate of [piter, hub]) {
      const created = await service.createPolicyVersion(
        candidate.subscriptionTypeId,
        candidate.request,
        {
          idempotencyKey: `annual-v2-${candidate.scope.toLowerCase()}-candidate`,
          correlationId: `corr:annual-v2:${candidate.scope.toLowerCase()}`
        },
        globalAdmin
      );
      assert.equal(created.item.version, 2);
      assert.equal(created.item.status, 'DRAFT');
      assert.equal(created.item.benefitRules.length, 2);

      const runtimeProjection = compileSubscriptionRuntimeProjection({
        ...created.item,
        status: 'PUBLISHED'
      });
      const policyDigest = computeSubscriptionRuntimeProjectionDigest(runtimeProjection);
      const publication: StoredSubscriptionPolicyPublication = {
        schemaVersion: 1,
        publicationId: `publication:annual-v2:${candidate.scope.toLowerCase()}`,
        subscriptionTypeId: candidate.subscriptionTypeId,
        policyVersion: 2,
        policyDigest,
        mappingId: `mapping:annual-v2:${candidate.scope.toLowerCase()}`,
        dictionaryRevision: candidate.dictionaryRevision,
        effectiveAt: candidate.request.effectiveAt,
        publishedAt: '2026-08-22T12:00:00.000Z',
        publishedBy: 'admin:test',
        impactPreviewRef: `impact:annual-v2:${candidate.scope.toLowerCase()}`,
        approvalAuditRef: `audit:annual-v2:${candidate.scope.toLowerCase()}`,
        state: 'PUBLISHED',
        supersededAt: null,
        supersededBy: null,
        runtimeProjection
      };
      validateStoredSubscriptionPolicyPublication(publication);

      const stationId = candidate.request.benefitRules[0].stationIds[0];
      const instance: StoredSubscriptionInstance = {
        schemaVersion: 1,
        subscriptionInstanceId: `subscription_instance:annual-v2:${candidate.scope.toLowerCase()}`,
        tenantId: 'iSkq6G',
        subscriptionTypeId: candidate.subscriptionTypeId,
        policyVersion: 2,
        policyDigest,
        mappingId: publication.mappingId,
        provider: 'VIVA',
        providerProductId: candidate.providerEvidence.providerProductId,
        providerClientId: 'provider_client:synthetic-annual-v2',
        clientSubscriptionId: 'client_subscription:synthetic-annual-v2',
        clientRefHash: 'a'.repeat(64),
        homeStationId: stationId,
        releaseProgramId: 'release_program:synthetic-annual-v2',
        releasePhaseId: 'release_phase:synthetic-annual-v2',
        purchasePrice: { amountMinor: 5680000, currency: 'RUB' },
        state: 'ACTIVE',
        purchasedAt: '2026-08-22T12:00:00.000Z',
        activeFrom: '2026-08-22T12:00:00.000Z',
        activeTo: '2027-08-22T11:59:59.999Z',
        frozenUntil: null,
        renewalPredecessorId: null,
        renewalSuccessorId: null,
        evidence: {
          paymentEvidenceRef: 'evidence:synthetic-payment',
          providerInstanceEvidenceRef: 'evidence:synthetic-provider-instance',
          lastReadBackEvidenceRef: 'evidence:synthetic-provider-instance'
        },
        reconciliation: {
          state: 'CURRENT',
          asOf: '2026-08-22T12:00:00.000Z',
          evidenceRef: 'evidence:synthetic-instance-current'
        },
        revision: 1,
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:00:00.000Z'
      };
      const aggregate: StoredSubscriptionEntitlementAggregate = {
        schemaVersion: 1,
        subscriptionInstanceId: instance.subscriptionInstanceId,
        revision: 1,
        activeServiceScope: 'SUBSCRIPTION_BENEFIT_ONLY',
        activeServiceCount: 0,
        activeServices: [],
        dailyUsage: {},
        weeklyUsage: {},
        monthlyUsage: {},
        futureBookingCount: 0,
        futureServiceStartsAt: [],
        remainingUnits: 365,
        reconciliation: {
          state: 'CURRENT',
          asOf: '2026-08-22T12:00:00.000Z',
          evidenceRef: 'evidence:synthetic-aggregate-current'
        },
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:00:00.000Z'
      };
      const target = {
        resolutionSource: 'SERVER' as const,
        targetId: 'exercise:synthetic-annual-v2',
        stationId,
        category: 'GAME' as const,
        externalEventTypeId: VIVA_ANNUAL_OPEN_GAME_DICTIONARY.canonicalExternalEventTypeId,
        productTypeId: null,
        durationMinutes: 60,
        startsAt: '2026-08-24T12:00:00.000Z',
        basePriceMinor: 400000,
        currency: 'RUB' as const,
        dictionaryRevision: candidate.dictionaryRevision,
        evidenceRef: 'evidence:synthetic-target',
        priceEvidenceRef: 'evidence:synthetic-price',
        resolvedAt: '2026-08-22T12:00:00.000Z'
      };
      const inside = evaluateSubscriptionShadowQuote({
        evaluatedAt: '2026-08-22T12:01:00.000Z',
        publication,
        instance,
        aggregate,
        action: 'CREATE_GAME',
        target
      });
      assert.equal(inside.eligible, true);
      assert.equal(inside.benefit?.kind, 'FREE_ENTITLEMENT');
      assert.equal(inside.benefit?.finalPriceMinor, 0);

      if (candidate.scope === 'HUB') {
        const outside = evaluateSubscriptionShadowQuote({
          evaluatedAt: '2026-08-22T12:01:00.000Z',
          publication,
          instance,
          aggregate,
          action: 'CREATE_GAME',
          target: { ...target, stationId: 'station:future-provider-studio' }
        });
        assert.equal(outside.eligible, false);
        assert.ok(outside.blockers.some((blocker) => blocker.code === 'STATION_NOT_ALLOWED'));
        assert.equal(outside.decision, null);
      }
    }

    const missingHubScope = structuredClone(hub.request);
    missingHubScope.benefitRules[0].stationIds = [];
    await assert.rejects(
      () => service.createPolicyVersion(
        hub.subscriptionTypeId,
        missingHubScope,
        {
          idempotencyKey: 'annual-v2-hub-missing-stations',
          correlationId: 'corr:annual-v2:hub:invalid'
        },
        globalAdmin
      ),
      (error: unknown) => JSON.stringify(
        (error as { getResponse?: () => unknown }).getResponse?.() ?? error
      ).includes('BENEFIT_STATIONS_REQUIRED')
    );
  } finally {
    if (previousFlag === undefined) delete process.env.SUBSCRIPTIONS_ADMIN_ENABLED;
    else process.env.SUBSCRIPTIONS_ADMIN_ENABLED = previousFlag;
  }

  const invalid = structuredClone(piter.request);
  invalid.createGame.durationsMinutes = [60, 90];
  assert.notDeepEqual(invalid.createGame.durationsMinutes, piter.request.createGame.durationsMinutes);
  assert.deepEqual(piter.request.createGame.durationsMinutes, [60]);

  process.stdout.write('managed annual subscription v2 candidate tests passed\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
