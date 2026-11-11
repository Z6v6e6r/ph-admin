import { RESIDENCY_PRODUCT_ID, residencyBookingCompatibilityMatches } from './residency-booking-policy';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { LkIdentityService } from '../lk-identity/lk-identity.service';
import { SubscriptionRuntimeContextDto } from './dto/subscription-runtime-context.dto';
import {
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProviderMapping
} from './subscription-runtime-contracts';
import { computeSubscriptionClientRefHash } from './subscription-trusted-shadow-adapter.service';
import { subscriptionProviderScopeMatchesProjection } from './subscription-provider-scope';
import { resolveSubscriptionSalePeriod } from './subscription-sale-period-resolver';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionInstance,
  StoredSubscriptionPolicyPublication,
  SubscriptionRuntimeProjectionSnapshot
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export interface SubscriptionRuntimeContextResult {
  schemaVersion: 1;
  subscriptionInstanceId: string;
  clientSubscriptionId: string;
  policyDigest: string;
  policy: SubscriptionRuntimeProjectionSnapshot;
  instance: Pick<StoredSubscriptionInstance,
    | 'subscriptionInstanceId'
    | 'subscriptionTypeId'
    | 'policyVersion'
    | 'state'
    | 'activeFrom'
    | 'activeTo'
    | 'frozenUntil'
    | 'homeStationId'> & { noShowBlockedUntil: null };
  evidence: {
    mappingId: string;
    mappingRevision: number;
    mappingVerifiedAt: string;
    publicationId: string;
    publishedAt: string;
    instanceRevision: number;
    instanceAsOf: string;
  };
}

export interface SubscriptionRuntimeIdentity {
  tenantId: string;
  providerClientId: string;
  clientRefHash: string;
}

@Injectable()
export class SubscriptionRuntimeContextService {
  constructor(
    private readonly identity: LkIdentityService,
    private readonly repository: SubscriptionsRepository
  ) {}

  async resolve(
    authorizationHeader: string | undefined, integrationToken: string | undefined, dto: SubscriptionRuntimeContextDto
  ): Promise<SubscriptionRuntimeContextResult> {
    return (await this.resolveValidated(authorizationHeader, integrationToken, dto)).context;
  }

  /** Internal identity boundary for the separately named, explicitly mutating refresh route. */
  async authorizeResidencyRefresh(authorizationHeader?: string, integrationToken?: string): Promise<SubscriptionRuntimeIdentity> {
    this.assertEnabled();
    if (!this.flag('SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED') || !this.flag('SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'RESIDENCY_SYNC_DISABLED' });
    }
    return this.verifiedIdentity(authorizationHeader, integrationToken);
  }

  async resolveResidency(
    authorizationHeader: string | undefined, integrationToken: string | undefined, dto: SubscriptionRuntimeContextDto
  ) {
    if (!this.flag('SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED')) {
      throw new ServiceUnavailableException({code:'RESIDENCY_BOOKING_CONTEXT_DISABLED'});
    }
    const {context, providerProductId, publication, purchasedAt} = await this.resolveValidated(authorizationHeader, integrationToken, dto);
    const compatibility = publication.runtimeCompatibility;
    if (providerProductId !== RESIDENCY_PRODUCT_ID || !compatibility
      || !residencyBookingCompatibilityMatches(context.policy, compatibility)) {
      throw new ServiceUnavailableException({code:'RESIDENCY_BOOKING_POLICY_UNSUPPORTED'});
    }
    const now = this.now().getTime();
    const from = Date.parse(context.instance.activeFrom || '');
    const to = Date.parse(context.instance.activeTo || '');
    const purchase=Date.parse(purchasedAt);
    const expiry=purchase+30*86400000;
    if (!Number.isFinite(purchase) || from !== purchase || ![expiry,expiry-1].includes(to)
      || context.instance.state !== 'ACTIVE' || context.instance.frozenUntil
      || !Number.isFinite(from) || !Number.isFinite(to) || from > now || to <= now
      || to <= from || to - from > 30 * 86400000) {
      throw new ForbiddenException({code:'RESIDENCY_BOOKING_NOT_ACTIVE'});
    }
    const maxAgeMs=Number(process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS)*1000;
    const validUntil=Math.min(now+30000,to,Date.parse(context.evidence.mappingVerifiedAt)+maxAgeMs,Date.parse(context.evidence.instanceAsOf)+maxAgeMs);
    if (validUntil<=now) throw new ServiceUnavailableException({code:'RESIDENCY_BOOKING_EVIDENCE_STALE'});
    return {schemaVersion:1 as const,contextKind:'RESIDENCY_BOOKING_CONTEXT' as const,
      providerProductId,purchasedAt,runtimeCompatibility:compatibility,context,
      observedAt:new Date(now).toISOString(),validUntil:new Date(validUntil).toISOString()};
  }

  private async resolveValidated(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: SubscriptionRuntimeContextDto
  ): Promise<{ context: SubscriptionRuntimeContextResult; providerProductId: string; publication: StoredSubscriptionPolicyPublication; purchasedAt: string }> {
    this.assertEnabled();
    const { tenantId, providerClientId, clientRefHash } = await this.verifiedIdentity(authorizationHeader, integrationToken);

    await this.repository.connectReadOnly();
    const instance = await this.repository.runtimeInstanceByProviderIdentity({
      tenantId,
      providerClientId,
      clientSubscriptionId: dto.clientSubscriptionId
    });
    if (!instance || instance.clientRefHash !== clientRefHash) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_RUNTIME_CONTEXT_NOT_FOUND',
        message: 'Current subscription runtime context was not found'
      });
    }
    validateStoredSubscriptionInstance(instance);

    return this.validateInstance(instance);
  }

  private async verifiedIdentity(authorizationHeader?: string, integrationToken?: string): Promise<SubscriptionRuntimeIdentity> {
    this.assertIntegrationToken(integrationToken);
    const tenantId = this.requireConfiguredId('SUBSCRIPTIONS_RUNTIME_TENANT_ID');
    const pepper = String(process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER ?? '');
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_HASH_PEPPER_REQUIRED',
        message: 'Subscription client hash is not configured'
      });
    }

    const verified = await this.identity.verifyTrustedBearer(authorizationHeader);
    if (verified.actor.tenantKey !== tenantId) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_TENANT_MISMATCH',
        message: 'LK identity tenant does not match subscription runtime tenant'
      });
    }
    const providerClientId = String(verified.actor.clientId ?? '').trim();
    if (!ID_PATTERN.test(providerClientId)) {
      throw new UnauthorizedException({
        code: 'SUBSCRIPTIONS_RUNTIME_PROVIDER_CLIENT_REQUIRED',
        message: 'Verified LK identity does not contain a canonical provider client id'
      });
    }
    const clientRefHash = computeSubscriptionClientRefHash({ pepper, tenantId, providerClientId });
    return { tenantId, providerClientId, clientRefHash };
  }

  private async validateInstance(instance: StoredSubscriptionInstance): Promise<{
    context: SubscriptionRuntimeContextResult; providerProductId: string;
    publication: StoredSubscriptionPolicyPublication; purchasedAt: string;
  }> {
    const mapping = await this.repository.runtimeProviderMappingById(instance.mappingId);
    let publications: StoredSubscriptionPolicyPublication[];
    try {
      publications = await this.repository.runtimePolicyPublicationHistoryByType(instance.subscriptionTypeId);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_SALE_PERIOD_INVALID',
        message: 'Subscription sale-period history is invalid'
      });
    }
    if (!mapping || publications.length === 0) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_CONTEXT_INCOMPLETE',
        message: 'Subscription runtime context is incomplete'
      });
    }
    validateStoredSubscriptionProviderMapping(mapping);
    let resolution: ReturnType<typeof resolveSubscriptionSalePeriod>;
    try {
      publications.forEach((publication) => validateStoredSubscriptionPolicyPublication(publication));
      resolution = resolveSubscriptionSalePeriod({
        purchasedAt: instance.purchasedAt,
        publications
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_SALE_PERIOD_INVALID',
        message: 'Subscription sale-period history is invalid'
      });
    }
    if (resolution.kind === 'MALFORMED') {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_SALE_PERIOD_INVALID',
        message: 'Subscription sale-period history is invalid'
      });
    }
    if (resolution.kind !== 'MATCH') {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_SALE_PERIOD_UNRESOLVED',
        message: 'Subscription sale-period rule is not uniquely resolved'
      });
    }
    const publication = resolution.publication;

    const now = this.now();
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
      || (mapping.providerScope.kind === 'STATION_SET'
        && !subscriptionProviderScopeMatchesProjection(
          mapping.providerScope,
          publication.runtimeProjection,
          instance.tenantId
        ))) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_MAPPING_NOT_CURRENT',
        message: 'Subscription provider mapping is not current'
      });
    }
    if (!mapping.verifiedAt || !this.isFresh(mapping.verifiedAt, now)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_MAPPING_STALE',
        message: 'Subscription provider mapping is stale'
      });
    }
    if (publication.subscriptionTypeId !== instance.subscriptionTypeId
      || publication.policyVersion !== instance.policyVersion
      || publication.policyDigest !== instance.policyDigest
      || publication.mappingId !== instance.mappingId
      || publication.state === 'DISABLED_FOR_NEW_OPERATIONS') {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_POLICY_NOT_CURRENT',
        message: 'Published subscription policy is not current'
      });
    }
    if (instance.reconciliation.state !== 'CURRENT'
      || !instance.reconciliation.asOf
      || !this.isFresh(instance.reconciliation.asOf, now)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_INSTANCE_NOT_CURRENT',
        message: 'Subscription instance is not current'
      });
    }

    const context: SubscriptionRuntimeContextResult = {
      schemaVersion: 1,
      subscriptionInstanceId: instance.subscriptionInstanceId,
      clientSubscriptionId: instance.clientSubscriptionId,
      policyDigest: instance.policyDigest,
      policy: publication.runtimeProjection,
      instance: {
        subscriptionInstanceId: instance.subscriptionInstanceId,
        subscriptionTypeId: instance.subscriptionTypeId,
        policyVersion: instance.policyVersion,
        state: instance.state,
        activeFrom: instance.activeFrom,
        activeTo: instance.activeTo,
        frozenUntil: instance.frozenUntil,
        homeStationId: instance.homeStationId,
        noShowBlockedUntil: null
      },
      evidence: {
        mappingId: mapping.mappingId,
        mappingRevision: mapping.revision,
        mappingVerifiedAt: mapping.verifiedAt,
        publicationId: publication.publicationId,
        publishedAt: publication.publishedAt,
        instanceRevision: instance.revision,
        instanceAsOf: instance.reconciliation.asOf
      }
    };
    return {context, providerProductId: instance.providerProductId, publication, purchasedAt: instance.purchasedAt};
  }

  protected now(): Date {
    return new Date();
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_CONTEXT_DISABLED',
        message: 'Subscription runtime context is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN ?? '').trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_NOT_CONFIGURED',
        message: 'Subscription runtime context is not configured'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedToken ?? '').trim());
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_FORBIDDEN',
        message: 'Subscription runtime context access is forbidden'
      });
    }
  }

  private requireConfiguredId(name: string): string {
    const value = String(process.env[name] ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_TENANT_ID_INVALID',
        message: 'Subscription runtime tenant is not configured'
      });
    }
    return value;
  }

  private isFresh(value: string, now: Date): boolean {
    const observedAt = Date.parse(value);
    const maxSeconds = Number(process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 30 || maxSeconds > 86400) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_CONTEXT_STALENESS_CONFIG_INVALID',
        message: 'Subscription runtime context staleness is not configured'
      });
    }
    return Number.isFinite(observedAt)
      && observedAt <= now.getTime()
      && now.getTime() - observedAt <= maxSeconds * 1000;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }
}
