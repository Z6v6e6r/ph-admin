import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ConfirmSubscriptionSaleBindingDto } from './dto/confirm-subscription-sale-binding.dto';
import {
  LK_NODE_RED_ANNUAL_BOOKING_V1,
  publicationAdapterRuntimeCompatibility
} from './subscription-publication-enforcement-adapter';
import { resolveSubscriptionSalePeriod } from './subscription-sale-period-resolver';
import { computeSubscriptionClientRefHash } from './subscription-trusted-shadow-adapter.service';
import {
  computeSubscriptionUsageLedgerEventHash,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionInstanceProjectorCheckpoint,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProjectionFence,
  validateStoredSubscriptionProviderMapping,
  validateStoredSubscriptionRuntimeOperation,
  validateStoredSubscriptionUsageLedgerEvent,
  validateStoredSubscriptionOutboxEvent
} from './subscription-runtime-contracts';
import { SubscriptionSaleReadinessService } from './subscription-sale-readiness.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface SubscriptionSaleBindingResult {
  schemaVersion: 1;
  state: 'BOUND';
  replayed: boolean;
  subscriptionInstanceId: string;
  clientSubscriptionId: string;
  policyVersion: number;
  binding: {
    mappingId: string;
    publicationId: string;
    fenceId: string;
  };
}

@Injectable()
export class SubscriptionSaleBindingService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly saleReadiness: SubscriptionSaleReadinessService
  ) {}

  async confirm(
    integrationToken: string | undefined,
    idempotencyKey: string | undefined,
    correlationId: string | undefined,
    dto: ConfirmSubscriptionSaleBindingDto
  ): Promise<SubscriptionSaleBindingResult> {
    this.assertEnabled();
    this.assertIntegrationToken(integrationToken);
    const normalizedIdempotencyKey = this.requireRequestId(
      idempotencyKey,
      'SUBSCRIPTIONS_SALE_BINDING_IDEMPOTENCY_KEY_INVALID'
    );
    const normalizedCorrelationId = this.requireRequestId(
      correlationId,
      'SUBSCRIPTIONS_SALE_BINDING_CORRELATION_ID_INVALID'
    );
    this.assertProviderTimes(dto);

    const tenantId = this.requireConfiguredTenantId();
    const pepper = this.requireHashPepper();
    const instanceId = `subscription_instance:${createHmac('sha256', pepper)
      .update(['subscription-instance-id:v1', tenantId, dto.providerClientId,
        dto.clientSubscriptionId].join('\0'))
      .digest('hex')}`;
    const operationId = `subscription_purchase:${this.sha256([
      tenantId,
      dto.providerTransactionId
    ].join('\0'))}`;
    const eventId = `subscription_event:${this.sha256(`${operationId}\0PURCHASE_PAID`)}`;
    const outboxEventId = `subscription_outbox:${this.sha256(eventId)}`;
    const idempotencyKeyHash = this.sha256(normalizedIdempotencyKey);
    // The provider read-back can legitimately advance between a successful bind and
    // a retry after a lost HTTP response.  Keep the replay identity tied to the paid
    // sale and the attested policy/release pins, not to mutable provider projection.
    const requestHash = this.sha256(this.saleReplayIdentity(dto));
    await this.repository.connect();
    try {
      const replay = await this.repository.confirmedRuntimeSaleBindingReplay({
        tenantId,
        providerClientId: dto.providerClientId,
        clientSubscriptionId: dto.clientSubscriptionId,
        providerProductId: dto.providerProductId,
        subscriptionInstanceId: instanceId,
        operationId,
        ledgerEventId: eventId,
        outboxEventId,
        idempotencyKeyHash,
        requestHash,
        correlationId: normalizedCorrelationId,
        providerTransactionId: dto.providerTransactionId
      });
      if (replay) {
        return {
          schemaVersion: 1,
          state: 'BOUND',
          replayed: true,
          subscriptionInstanceId: replay.subscriptionInstanceId,
          clientSubscriptionId: replay.clientSubscriptionId,
          policyVersion: replay.policyVersion,
          binding: {
            mappingId: replay.mappingId,
            publicationId: dto.expectedPublicationId,
            fenceId: dto.expectedFenceId
          }
        };
      }
    } catch (error) {
      if (error instanceof SubscriptionRuntimeContractError) {
        throw new ConflictException({
          code: error.code,
          message: 'Managed subscription sale binding replay conflicted with persisted state'
        });
      }
      throw error;
    }

    const readiness = await this.saleReadiness.checkTrusted({
      provider: dto.provider,
      providerProductId: dto.providerProductId,
      providerScopeKind: dto.providerScopeKind,
      providerScopeId: dto.providerScopeId,
      requiredAdapterId: dto.requiredAdapterId,
      requiredContractVersion: dto.requiredContractVersion,
      requiredCapabilityDigest: dto.requiredCapabilityDigest
    });
    if (!readiness.ready || !readiness.binding) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_READINESS_UNAVAILABLE',
        message: 'Managed subscription sale binding is not ready',
        details: { blockers: readiness.blockers }
      });
    }
    this.assertExpectedBinding(dto, readiness.binding);

    const identity = {
      tenantId,
      provider: 'VIVA' as const,
      providerProductId: dto.providerProductId,
      providerScopeKind: dto.providerScopeKind,
      providerScopeId: dto.providerScopeId
    };
    const [mapping, checkpoint, fence, publicationHistory, releaseProgram] = await Promise.all([
      this.repository.runtimeProviderMappingByProviderIdentity(identity),
      this.repository.runtimeInstanceProjectorCheckpointByProviderIdentity(identity),
      this.repository.runtimeProjectionFenceByType(dto.expectedSubscriptionTypeId),
      this.repository.runtimePolicyPublicationHistoryByType(dto.expectedSubscriptionTypeId),
      this.repository.releaseProgramById(readiness.binding.releaseProgramId)
    ]);
    if (!mapping || !checkpoint || !fence || !releaseProgram) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_SOURCE_UNAVAILABLE',
        message: 'Managed subscription sale binding source is unavailable'
      });
    }
    validateStoredSubscriptionProviderMapping(mapping);
    validateStoredSubscriptionInstanceProjectorCheckpoint(checkpoint);
    validateStoredSubscriptionProjectionFence(fence);
    publicationHistory.forEach(validateStoredSubscriptionPolicyPublication);

    const selected = resolveSubscriptionSalePeriod({
      purchasedAt: dto.purchasedAt,
      publications: publicationHistory
    });
    if (selected.kind !== 'MATCH'
      || selected.publication.publicationId !== dto.expectedPublicationId
      || selected.publication.policyVersion !== dto.expectedPolicyVersion
      || selected.publication.policyDigest !== dto.expectedPolicyDigest
      || selected.publication.mappingId !== dto.expectedMappingId) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_POLICY_CONFLICT',
        message: 'Purchase time does not resolve to the expected policy publication'
      });
    }
    if (!this.stationAllowed(selected.publication.runtimeProjection.stationAccessRules, dto.homeStationId)) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_STATION_CONFLICT',
        message: 'Provider subscription home station is outside the published scope'
      });
    }
    if (releaseProgram.state !== 'ACTIVE'
      || releaseProgram.subscriptionTypeId !== dto.expectedSubscriptionTypeId
      || releaseProgram.revision !== readiness.binding.releaseProgramRevision
      || releaseProgram.stationId !== dto.homeStationId) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_RELEASE_CONFLICT',
        message: 'Provider subscription does not match the attested release program'
      });
    }
    const phase = releaseProgram.phases.find(
      (item) => item.releasePhaseId === readiness.binding!.releasePhaseId
    );
    if (!phase
      || phase.mode !== 'DAILY_DROP'
      || phase.totalQuantity !== 100
      || phase.dailyDropQuantity !== 10
      || phase.providerProductRef !== dto.providerProductId
      || phase.price.currency !== 'RUB'
      || phase.price.amountMinor !== dto.purchasePriceMinor) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_PRICE_CONFLICT',
        message: 'Paid price does not match the attested release phase'
      });
    }

    // Provider observation time is part of the immutable provider evidence. Using it
    // for all generated timestamps keeps a retry byte-for-byte idempotent.
    const recordedAt = dto.providerObservedAt;
    const paymentEvidenceRef = this.evidence('provider_payment_evidence', {
      provider: dto.provider,
      providerTransactionId: dto.providerTransactionId,
      // Every DTO value accepted here is an explicit paid terminal state.
      // Canonicalize equivalent provider spellings for lost-response replay.
      providerTransactionStatus: 'PAID',
      providerProductId: dto.providerProductId,
      providerClientId: dto.providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId,
      purchasePriceMinor: dto.purchasePriceMinor,
      purchasedAt: dto.purchasedAt,
      observedAt: dto.providerObservedAt
    });
    const providerInstanceEvidenceRef = this.evidence('provider_instance_evidence', {
      provider: dto.provider,
      providerProductId: dto.providerProductId,
      providerClientId: dto.providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId,
      state: dto.providerSubscriptionState,
      homeStationId: dto.homeStationId,
      purchasedAt: dto.purchasedAt,
      activeFrom: dto.activeFrom ?? null,
      activeTo: dto.activeTo ?? null
    });
    const readBackEvidenceRef = this.evidence('provider_readback_evidence', {
      providerInstanceEvidenceRef,
      observedAt: dto.providerObservedAt
    });
    const instance: StoredSubscriptionInstance = {
      schemaVersion: 1,
      subscriptionInstanceId: instanceId,
      tenantId: identity.tenantId,
      subscriptionTypeId: dto.expectedSubscriptionTypeId,
      policyVersion: selected.publication.policyVersion,
      policyDigest: selected.publication.policyDigest,
      mappingId: selected.publication.mappingId,
      provider: 'VIVA',
      providerProductId: dto.providerProductId,
      providerClientId: dto.providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId,
      clientRefHash: computeSubscriptionClientRefHash({
        pepper,
        tenantId: identity.tenantId,
        providerClientId: dto.providerClientId
      }),
      homeStationId: dto.homeStationId,
      releaseProgramId: readiness.binding.releaseProgramId,
      releasePhaseId: readiness.binding.releasePhaseId,
      purchasePrice: { amountMinor: dto.purchasePriceMinor, currency: 'RUB' },
      state: dto.providerSubscriptionState,
      purchasedAt: dto.purchasedAt,
      activeFrom: dto.activeFrom ?? null,
      activeTo: dto.activeTo ?? null,
      frozenUntil: null,
      renewalPredecessorId: null,
      renewalSuccessorId: null,
      evidence: { paymentEvidenceRef, providerInstanceEvidenceRef, lastReadBackEvidenceRef: readBackEvidenceRef },
      reconciliation: { state: 'CURRENT', asOf: dto.providerObservedAt, evidenceRef: readBackEvidenceRef },
      revision: 1,
      createdAt: recordedAt,
      updatedAt: recordedAt
    };
    validateStoredSubscriptionInstance(instance);

    const actor = { type: 'SYSTEM' as const, actorId: 'system:lk-managed-sale' };
    const operation: StoredSubscriptionRuntimeOperation = {
      schemaVersion: 1,
      operationId,
      revision: 1,
      tenantId: identity.tenantId,
      subscriptionInstanceId: instanceId,
      kind: 'PURCHASE',
      state: 'CONFIRMED',
      actor,
      idempotency: {
        keyHash: idempotencyKeyHash,
        requestHash
      },
      correlationId: normalizedCorrelationId,
      decision: {
        decisionKind: 'PURCHASE',
        policyVersion: instance.policyVersion,
        policyDigest: instance.policyDigest,
        mappingId: instance.mappingId,
        providerProductId: instance.providerProductId,
        releaseProgramId: instance.releaseProgramId,
        releasePhaseId: instance.releasePhaseId,
        stationId: instance.homeStationId,
        quantity: 1,
        price: instance.purchasePrice
      },
      providerCorrelationId: dto.providerTransactionId,
      providerEvidenceRefs: [paymentEvidenceRef, providerInstanceEvidenceRef, readBackEvidenceRef],
      attempts: 1,
      nextAttemptAt: null,
      compensationState: 'NONE',
      lastReconciledAt: recordedAt,
      lastReconciliationResult: 'PROVIDER_PAID_INSTANCE_READBACK_CONFIRMED',
      createdAt: recordedAt,
      updatedAt: recordedAt,
      terminalAt: recordedAt
    };
    validateStoredSubscriptionRuntimeOperation(operation);
    const ledgerWithoutHash: Omit<StoredSubscriptionUsageLedgerEvent, 'eventHash'> = {
      schemaVersion: 1,
      eventId,
      eventType: 'PURCHASE_PAID',
      tenantId: identity.tenantId,
      subscriptionInstanceId: instanceId,
      operationId,
      correlationId: normalizedCorrelationId,
      policyVersion: instance.policyVersion,
      policyDigest: instance.policyDigest,
      stationId: instance.homeStationId,
      eventTypeId: null,
      productTypeId: instance.providerProductId,
      moneyDeltaMinor: instance.purchasePrice.amountMinor,
      currency: 'RUB',
      usageDelta: 0,
      providerEvidenceRef: paymentEvidenceRef,
      actor,
      occurredAt: dto.purchasedAt,
      recordedAt
    };
    const ledger: StoredSubscriptionUsageLedgerEvent = {
      ...ledgerWithoutHash,
      eventHash: computeSubscriptionUsageLedgerEventHash(ledgerWithoutHash)
    };
    validateStoredSubscriptionUsageLedgerEvent(ledger);
    const outbox: StoredSubscriptionOutboxEvent = {
      schemaVersion: 1,
      outboxEventId,
      ledgerEventId: eventId,
      subscriptionInstanceId: instanceId,
      topic: 'SUBSCRIPTION_LEDGER_EVENT',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: recordedAt,
      deliveredAt: null,
      lastErrorCode: null,
      createdAt: recordedAt,
      updatedAt: recordedAt
    };
    validateStoredSubscriptionOutboxEvent(outbox);

    try {
      const persisted = await this.repository.applyConfirmedRuntimeSaleBinding({
        instance,
        operation,
        ledger,
        outbox,
        mappingSnapshot: mapping,
        checkpointSnapshot: checkpoint,
        fenceSnapshot: fence,
        publicationHistorySnapshot: publicationHistory,
        releaseProgramSnapshot: releaseProgram
      });
      return {
        schemaVersion: 1,
        state: 'BOUND',
        replayed: persisted === 'EXACT_REPLAY',
        subscriptionInstanceId: instance.subscriptionInstanceId,
        clientSubscriptionId: instance.clientSubscriptionId,
        policyVersion: instance.policyVersion,
        binding: {
          mappingId: instance.mappingId,
          publicationId: selected.publication.publicationId,
          fenceId: fence.fenceId
        }
      };
    } catch (error) {
      if (error instanceof SubscriptionRuntimeContractError) {
        throw new ConflictException({
          code: error.code,
          message: 'Managed subscription sale binding conflicted with current state'
        });
      }
      throw error;
    }
  }

  private saleReplayIdentity(dto: ConfirmSubscriptionSaleBindingDto): object {
    return {
      provider: dto.provider,
      providerProductId: dto.providerProductId,
      providerScopeKind: dto.providerScopeKind,
      providerScopeId: dto.providerScopeId,
      providerClientId: dto.providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId,
      providerTransactionId: dto.providerTransactionId,
      providerTransactionStatus: 'PAID',
      purchasePriceMinor: dto.purchasePriceMinor,
      requiredAdapterId: dto.requiredAdapterId,
      requiredContractVersion: dto.requiredContractVersion,
      requiredCapabilityDigest: dto.requiredCapabilityDigest,
      expectedMappingId: dto.expectedMappingId,
      expectedMappingRevision: dto.expectedMappingRevision,
      expectedSubscriptionTypeId: dto.expectedSubscriptionTypeId,
      expectedPublicationId: dto.expectedPublicationId,
      expectedPolicyVersion: dto.expectedPolicyVersion,
      expectedPolicyDigest: dto.expectedPolicyDigest,
      expectedFenceId: dto.expectedFenceId,
      expectedFenceRevision: dto.expectedFenceRevision,
      expectedFenceDigest: dto.expectedFenceDigest,
      expectedProjectorReconciliationDigest: dto.expectedProjectorReconciliationDigest,
      expectedReleaseProgramId: dto.expectedReleaseProgramId,
      expectedReleaseProgramRevision: dto.expectedReleaseProgramRevision,
      expectedReleasePhaseId: dto.expectedReleasePhaseId
    };
  }

  protected now(): Date {
    return new Date();
  }

  private assertProviderTimes(dto: ConfirmSubscriptionSaleBindingDto): void {
    const now = this.now().getTime();
    const purchasedAt = Date.parse(dto.purchasedAt);
    const observedAt = Date.parse(dto.providerObservedAt);
    const activeFrom = dto.activeFrom ? Date.parse(dto.activeFrom) : null;
    const activeTo = dto.activeTo ? Date.parse(dto.activeTo) : null;
    if (!Number.isFinite(purchasedAt) || !Number.isFinite(observedAt)
      || observedAt < purchasedAt || observedAt > now + 5 * 60 * 1000
      || (dto.providerSubscriptionState === 'PENDING_ACTIVATION'
        && (dto.activeFrom != null || dto.activeTo != null))
      || (dto.providerSubscriptionState === 'ACTIVE'
        && (!Number.isFinite(activeFrom) || !Number.isFinite(activeTo)
          || Number(activeFrom) > Number(activeTo)))) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_PROVIDER_TIME_CONFLICT',
        message: 'Provider subscription timestamps are inconsistent'
      });
    }
  }

  private assertExpectedBinding(
    dto: ConfirmSubscriptionSaleBindingDto,
    binding: NonNullable<Awaited<ReturnType<SubscriptionSaleReadinessService['checkTrusted']>>['binding']>
  ): void {
    const exact = dto.expectedMappingId === binding.mappingId
      && dto.expectedMappingRevision === binding.mappingRevision
      && dto.expectedSubscriptionTypeId === binding.subscriptionTypeId
      && dto.expectedPublicationId === binding.publicationId
      && dto.expectedPolicyVersion === binding.policyVersion
      && dto.expectedPolicyDigest === binding.policyDigest
      && dto.expectedFenceId === binding.fenceId
      && dto.expectedFenceRevision === binding.fenceRevision
      && dto.expectedFenceDigest === binding.fenceDigest
      && dto.expectedProjectorReconciliationDigest === binding.projectorReconciliationDigest
      && dto.expectedReleaseProgramId === binding.releaseProgramId
      && dto.expectedReleaseProgramRevision === binding.releaseProgramRevision
      && dto.expectedReleasePhaseId === binding.releasePhaseId;
    if (!exact) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_READINESS_CHANGED',
        message: 'Sale readiness binding changed after checkout started'
      });
    }
  }

  private stationAllowed(
    rules: Array<{ enabled: boolean; selector: { kind: string; stationIds: string[] } }>,
    stationId: string
  ): boolean {
    return rules.some((rule) => rule.enabled && (
      rule.selector.kind === 'ALL_STATIONS'
      || (rule.selector.kind === 'STATION_LIST' && rule.selector.stationIds.includes(stationId))
    ));
  }

  private evidence(kind: string, value: unknown): string {
    return `${kind}:sha256:${this.sha256(value)}`;
  }

  private sha256(value: unknown): string {
    const input = typeof value === 'string' ? value : this.canonicalStringify(value);
    return createHash('sha256').update(input).digest('hex');
  }

  private canonicalStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private requireHashPepper(): string {
    const pepper = String(process.env.SUBSCRIPTIONS_HASH_PEPPER ?? '');
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_HASH_PEPPER_REQUIRED',
        message: 'Managed subscription sale binding hash pepper is not configured'
      });
    }
    return pepper;
  }

  private requireConfiguredTenantId(): string {
    const value = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_TENANT_ID_INVALID',
        message: 'Managed subscription sale binding tenant is not configured'
      });
    }
    return value;
  }

  private requireRequestId(value: string | undefined, code: string): string {
    const normalized = String(value ?? '').trim();
    if (!REQUEST_ID_PATTERN.test(normalized) || /\s/.test(normalized)) {
      throw new ConflictException({ code, message: 'Request identity is invalid' });
    }
    return normalized;
  }

  private assertEnabled(): void {
    const enabled = ['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_SALE_BINDING_ENABLED ?? '').trim().toLowerCase()
    );
    if (!enabled) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_DISABLED',
        message: 'Managed subscription sale binding is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(
      process.env.SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_TOKEN ?? ''
    ).trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_NOT_CONFIGURED',
        message: 'Managed subscription sale binding is not configured'
      });
    }
    const readinessToken = String(
      process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN ?? ''
    ).trim();
    if (readinessToken && readinessToken === expected) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_TOKEN_NOT_DISTINCT',
        message: 'Managed subscription sale binding token must be distinct from readiness'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedToken ?? '').trim());
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_FORBIDDEN',
        message: 'Managed subscription sale binding access is forbidden'
      });
    }
  }
}
