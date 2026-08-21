import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { LkIdentityService } from '../lk-identity/lk-identity.service';
import { ActivateSubscriptionFirstUseDto } from './dto/activate-subscription-first-use.dto';
import {
  computeSubscriptionUsageLedgerEventHash,
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProviderMapping
} from './subscription-runtime-contracts';
import { computeSubscriptionClientRefHash } from './subscription-trusted-shadow-adapter.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionOutboxEvent,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionRuntimeOperation,
  StoredSubscriptionUsageLedgerEvent,
  SubscriptionRuntimeActorType
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionActivationResult {
  schemaVersion: 1;
  outcome: 'ACTIVATED' | 'ALREADY_ACTIVE';
  subscriptionInstanceId: string;
  state: 'ACTIVE';
  activeFrom: string;
  activeTo: string;
  revision: number;
}

@Injectable()
export class SubscriptionActivationService {
  constructor(
    private readonly identity: LkIdentityService,
    private readonly repository: SubscriptionsRepository
  ) {}

  async activateFirstUse(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: ActivateSubscriptionFirstUseDto,
    headers: { correlationId?: string }
  ): Promise<SubscriptionActivationResult> {
    this.assertEnabled();
    this.assertIntegrationToken(integrationToken);
    const tenantId = this.requireConfiguredId('SUBSCRIPTIONS_RUNTIME_TENANT_ID');
    const pepper = this.requirePepper();
    const verified = await this.identity.verifyTrustedBearer(authorizationHeader);
    if (verified.actor.tenantKey !== tenantId) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_ACTIVATION_TENANT_MISMATCH',
        message: 'LK identity tenant does not match subscription runtime tenant'
      });
    }
    const providerClientId = String(verified.actor.clientId ?? '').trim();
    if (!ID_PATTERN.test(providerClientId)) {
      throw new UnauthorizedException({
        code: 'SUBSCRIPTIONS_ACTIVATION_PROVIDER_CLIENT_REQUIRED',
        message: 'Verified LK identity does not contain a canonical provider client id'
      });
    }
    const clientRefHash = computeSubscriptionClientRefHash({ pepper, tenantId, providerClientId });

    await this.repository.connect();
    const instance = await this.repository.runtimeInstanceByProviderIdentity({
      tenantId,
      providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId
    });
    if (!instance
      || instance.subscriptionInstanceId !== dto.subscriptionInstanceId
      || instance.clientRefHash !== clientRefHash) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_ACTIVATION_INSTANCE_NOT_FOUND',
        message: 'Current subscription instance was not found'
      });
    }
    return this.activate(instance, {
      cause: 'FIRST_USE',
      expectedRevision: dto.expectedInstanceRevision,
      providerEvidenceRef: `viva:booking:${dto.providerBookingId}`,
      providerCorrelationId: dto.providerBookingId,
      actor: { type: 'CLIENT', actorId: clientRefHash },
      correlationId: this.correlationId(headers.correlationId)
    });
  }

  async activateFixedDeadline(
    subscriptionInstanceId: string
  ): Promise<SubscriptionActivationResult | null> {
    this.assertEnabled();
    const tenantId = this.requireConfiguredId('SUBSCRIPTIONS_RUNTIME_TENANT_ID');
    await this.repository.connect();
    const instance = await this.repository.runtimeInstanceByTenantAndId(
      tenantId,
      subscriptionInstanceId
    );
    if (!instance) return null;
    const now = this.now();
    const publication = await this.publicationFor(instance);
    const deadline = this.activationDeadline(publication);
    if (now.getTime() < deadline.getTime()) return null;
    const evidenceRef = String(instance.evidence.providerInstanceEvidenceRef ?? '').trim();
    if (!evidenceRef) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_PROVIDER_EVIDENCE_REQUIRED',
        message: 'Provider instance evidence is required for deadline activation'
      });
    }
    const reconciliationAsOf = Date.parse(String(instance.reconciliation.asOf ?? ''));
    if (!Number.isFinite(reconciliationAsOf) || reconciliationAsOf < deadline.getTime()) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_DEADLINE_READBACK_REQUIRED',
        message: 'A provider read-back at or after the activation deadline is required'
      });
    }
    return this.activate(instance, {
      cause: 'FIXED_DEADLINE',
      expectedRevision: instance.revision,
      providerEvidenceRef: evidenceRef,
      providerCorrelationId: null,
      actor: { type: 'SYSTEM', actorId: 'system:subscription-deadline-worker' },
      correlationId: `corr:${randomUUID()}`,
      publication
    });
  }

  activationEnabled(): boolean {
    return this.flag('SUBSCRIPTIONS_ACTIVATION_ENABLED');
  }

  protected now(): Date {
    return new Date();
  }

  private async activate(
    instance: StoredSubscriptionInstance,
    input: {
      cause: 'FIRST_USE' | 'FIXED_DEADLINE';
      expectedRevision: number;
      providerEvidenceRef: string;
      providerCorrelationId: string | null;
      actor: { type: SubscriptionRuntimeActorType; actorId: string };
      correlationId: string;
      publication?: StoredSubscriptionPolicyPublication;
    }
  ): Promise<SubscriptionActivationResult> {
    validateStoredSubscriptionInstance(instance);
    if (instance.state === 'ACTIVE') return this.result(instance, false);
    if (instance.state !== 'PENDING_ACTIVATION') {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_ACTIVATION_STATE_CONFLICT',
        message: 'Subscription instance cannot be activated from its current state'
      });
    }
    if (instance.revision !== input.expectedRevision) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_ACTIVATION_REVISION_CONFLICT',
        message: 'Subscription instance revision has changed'
      });
    }

    const publication = input.publication ?? await this.publicationFor(instance);
    await this.assertCurrentRuntimeContract(instance, publication);
    const now = this.now();
    const deadline = this.activationDeadline(publication);
    const activeFromDate = input.cause === 'FIRST_USE' && now.getTime() < deadline.getTime()
      ? now
      : deadline;
    const validityDays = publication.runtimeProjection.lifecycle.validityDays!;
    const activeToMs = activeFromDate.getTime() + validityDays * DAY_MS - 1;
    if (!Number.isSafeInteger(activeToMs)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_RANGE_INVALID',
        message: 'Subscription activation range cannot be calculated'
      });
    }
    const activeFrom = activeFromDate.toISOString();
    const activeTo = new Date(activeToMs).toISOString();
    const recordedAt = now.toISOString();
    const identityHash = this.sha256([
      instance.tenantId,
      instance.subscriptionInstanceId,
      input.cause,
      input.providerEvidenceRef
    ].join('|'));
    const operationId = `activation:${identityHash.slice(0, 48)}`;
    const eventId = `event:activation:${identityHash.slice(0, 48)}`;
    const outboxEventId = `outbox:activation:${identityHash.slice(0, 48)}`;
    const operation: StoredSubscriptionRuntimeOperation = {
      schemaVersion: 1,
      operationId,
      revision: 1,
      tenantId: instance.tenantId,
      subscriptionInstanceId: instance.subscriptionInstanceId,
      kind: 'ACTIVATION',
      state: 'CONFIRMED',
      actor: input.actor,
      idempotency: {
        keyHash: this.sha256(`${input.cause}|${input.providerEvidenceRef}`),
        requestHash: this.sha256(JSON.stringify({
          subscriptionInstanceId: instance.subscriptionInstanceId,
          expectedRevision: input.expectedRevision,
          cause: input.cause,
          activeFrom,
          activeTo
        }))
      },
      correlationId: input.correlationId,
      decision: null,
      providerCorrelationId: input.providerCorrelationId,
      providerEvidenceRefs: [input.providerEvidenceRef],
      attempts: 1,
      nextAttemptAt: null,
      compensationState: 'NONE',
      lastReconciledAt: recordedAt,
      lastReconciliationResult: input.cause,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      terminalAt: recordedAt
    };
    const ledgerWithoutHash: Omit<StoredSubscriptionUsageLedgerEvent, 'eventHash'> = {
      schemaVersion: 1,
      eventId,
      eventType: 'INSTANCE_ACTIVATED',
      tenantId: instance.tenantId,
      subscriptionInstanceId: instance.subscriptionInstanceId,
      operationId,
      correlationId: input.correlationId,
      policyVersion: instance.policyVersion,
      policyDigest: instance.policyDigest,
      stationId: instance.homeStationId,
      eventTypeId: null,
      productTypeId: null,
      moneyDeltaMinor: 0,
      currency: 'RUB',
      usageDelta: 0,
      providerEvidenceRef: input.providerEvidenceRef,
      actor: input.actor,
      occurredAt: activeFrom,
      recordedAt
    };
    const ledger: StoredSubscriptionUsageLedgerEvent = {
      ...ledgerWithoutHash,
      eventHash: computeSubscriptionUsageLedgerEventHash(ledgerWithoutHash)
    };
    const outbox: StoredSubscriptionOutboxEvent = {
      schemaVersion: 1,
      outboxEventId,
      ledgerEventId: eventId,
      subscriptionInstanceId: instance.subscriptionInstanceId,
      topic: 'SUBSCRIPTION_LEDGER_EVENT',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: recordedAt,
      deliveredAt: null,
      lastErrorCode: null,
      createdAt: recordedAt,
      updatedAt: recordedAt
    };

    try {
      const persisted = await this.repository.activateRuntimeInstance({
        tenantId: instance.tenantId,
        subscriptionInstanceId: instance.subscriptionInstanceId,
        expectedRevision: input.expectedRevision,
        activeFrom,
        activeTo,
        updatedAt: recordedAt,
        providerEvidenceRef: input.providerEvidenceRef,
        reconciliation: input.cause === 'FIRST_USE'
          ? { state: 'CURRENT', asOf: recordedAt, evidenceRef: input.providerEvidenceRef }
          : instance.reconciliation,
        operation,
        ledger,
        outbox
      });
      return this.result(persisted.instance, persisted.activated);
    } catch (error) {
      if (error instanceof SubscriptionRuntimeContractError
        && error.code === 'SUBSCRIPTION_ACTIVATION_CAS_CONFLICT') {
        throw new ConflictException({
          code: 'SUBSCRIPTIONS_ACTIVATION_REVISION_CONFLICT',
          message: 'Subscription instance revision has changed'
        });
      }
      throw error;
    }
  }

  private async publicationFor(
    instance: StoredSubscriptionInstance
  ): Promise<StoredSubscriptionPolicyPublication> {
    const publication = await this.repository.runtimePolicyPublicationByVersion(
      instance.subscriptionTypeId,
      instance.policyVersion
    );
    if (!publication) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_POLICY_UNAVAILABLE',
        message: 'Published subscription policy is unavailable'
      });
    }
    validateStoredSubscriptionPolicyPublication(publication);
    return publication;
  }

  private async assertCurrentRuntimeContract(
    instance: StoredSubscriptionInstance,
    publication: StoredSubscriptionPolicyPublication
  ): Promise<void> {
    const mapping = await this.repository.runtimeProviderMappingById(instance.mappingId);
    if (!mapping) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_MAPPING_UNAVAILABLE',
        message: 'Verified provider mapping is unavailable'
      });
    }
    validateStoredSubscriptionProviderMapping(mapping);
    const now = this.now();
    if (publication.state === 'DISABLED_FOR_NEW_OPERATIONS'
      || publication.subscriptionTypeId !== instance.subscriptionTypeId
      || publication.policyVersion !== instance.policyVersion
      || publication.policyDigest !== instance.policyDigest
      || publication.mappingId !== instance.mappingId
      || Date.parse(publication.effectiveAt) > now.getTime()) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_POLICY_NOT_CURRENT',
        message: 'Published subscription policy is not current'
      });
    }
    if (mapping.state !== 'VERIFIED'
      || mapping.mappingId !== instance.mappingId
      || mapping.tenantId !== instance.tenantId
      || mapping.subscriptionTypeId !== instance.subscriptionTypeId
      || mapping.provider !== instance.provider
      || mapping.providerProductId !== instance.providerProductId
      || (mapping.providerScope.kind === 'TENANT'
        && mapping.providerScope.scopeId !== instance.tenantId)
      || (mapping.providerScope.kind === 'STATION'
        && mapping.providerScope.scopeId !== instance.homeStationId)
      || mapping.providerScope.kind === 'STUDIO'
      || !mapping.verifiedAt
      || !this.isFresh(mapping.verifiedAt, now)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_MAPPING_NOT_CURRENT',
        message: 'Verified provider mapping is not current'
      });
    }
    if (instance.reconciliation.state !== 'CURRENT'
      || !instance.reconciliation.asOf
      || !this.isFresh(instance.reconciliation.asOf, now)
      || !instance.evidence.paymentEvidenceRef
      || !instance.evidence.providerInstanceEvidenceRef) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_INSTANCE_NOT_CURRENT',
        message: 'Subscription instance evidence is not current'
      });
    }
    this.activationDeadline(publication);
  }

  private activationDeadline(publication: StoredSubscriptionPolicyPublication): Date {
    const lifecycle = publication.runtimeProjection.lifecycle;
    const validityDays = lifecycle.validityDays;
    const fixedAt = new Date(String(lifecycle.fixedActivationAt ?? ''));
    if (lifecycle.activationMode !== 'FIRST_USE_OR_FIXED_DATE'
      || lifecycle.activationWindowDays !== 0
      || lifecycle.fixedActivationTimeZone !== 'Europe/Moscow'
      || !Number.isInteger(validityDays)
      || validityDays! < 1
      || validityDays! > 3660
      || !Number.isFinite(fixedAt.getTime())) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_LIFECYCLE_UNSUPPORTED',
        message: 'Subscription activation lifecycle is not supported'
      });
    }
    return fixedAt;
  }

  private result(
    instance: StoredSubscriptionInstance,
    activated: boolean
  ): SubscriptionActivationResult {
    validateStoredSubscriptionInstance(instance);
    if (instance.state !== 'ACTIVE' || !instance.activeFrom || !instance.activeTo) {
      throw new ConflictException({
        code: 'SUBSCRIPTIONS_ACTIVATION_STATE_CONFLICT',
        message: 'Subscription instance is not active'
      });
    }
    return {
      schemaVersion: 1,
      outcome: activated ? 'ACTIVATED' : 'ALREADY_ACTIVE',
      subscriptionInstanceId: instance.subscriptionInstanceId,
      state: 'ACTIVE',
      activeFrom: instance.activeFrom,
      activeTo: instance.activeTo,
      revision: instance.revision
    };
  }

  private assertEnabled(): void {
    if (!this.activationEnabled()) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_DISABLED',
        message: 'Subscription activation is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(process.env.SUBSCRIPTIONS_ACTIVATION_INTEGRATION_TOKEN ?? '').trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_INTEGRATION_NOT_CONFIGURED',
        message: 'Subscription activation integration is not configured'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedToken ?? '').trim());
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_ACTIVATION_INTEGRATION_FORBIDDEN',
        message: 'Subscription activation access is forbidden'
      });
    }
  }

  private requireConfiguredId(name: string): string {
    const value = String(process.env[name] ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_TENANT_ID_INVALID',
        message: 'Subscription runtime tenant is not configured'
      });
    }
    return value;
  }

  private requirePepper(): string {
    const value = String(process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER ?? '');
    if (Buffer.byteLength(value, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_HASH_PEPPER_REQUIRED',
        message: 'Subscription client hash is not configured'
      });
    }
    return value;
  }

  private isFresh(value: string, now: Date): boolean {
    const observedAt = Date.parse(value);
    const maxSeconds = Number(process.env.SUBSCRIPTIONS_ACTIVATION_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 30 || maxSeconds > 86400) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_ACTIVATION_STALENESS_CONFIG_INVALID',
        message: 'Subscription activation staleness is not configured'
      });
    }
    return Number.isFinite(observedAt)
      && observedAt <= now.getTime()
      && now.getTime() - observedAt <= maxSeconds * 1000;
  }

  private correlationId(value?: string): string {
    const normalized = String(value ?? '').trim();
    return ID_PATTERN.test(normalized) ? normalized : `corr:${randomUUID()}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }
}
