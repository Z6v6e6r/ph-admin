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
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  StoredSubscriptionInstance,
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

@Injectable()
export class SubscriptionRuntimeContextService {
  constructor(
    private readonly identity: LkIdentityService,
    private readonly repository: SubscriptionsRepository
  ) {}

  async resolve(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: SubscriptionRuntimeContextDto
  ): Promise<SubscriptionRuntimeContextResult> {
    this.assertEnabled();
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

    const [mapping, publication] = await Promise.all([
      this.repository.runtimeProviderMappingById(instance.mappingId),
      this.repository.runtimePolicyPublicationByVersion(
        instance.subscriptionTypeId,
        instance.policyVersion
      )
    ]);
    if (!mapping || !publication) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTION_RUNTIME_CONTEXT_INCOMPLETE',
        message: 'Subscription runtime context is incomplete'
      });
    }
    validateStoredSubscriptionProviderMapping(mapping);
    validateStoredSubscriptionPolicyPublication(publication);

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
    if (publication.state === 'DISABLED_FOR_NEW_OPERATIONS'
      || publication.subscriptionTypeId !== instance.subscriptionTypeId
      || publication.policyVersion !== instance.policyVersion
      || publication.policyDigest !== instance.policyDigest
      || publication.mappingId !== instance.mappingId
      || Date.parse(publication.effectiveAt) > now.getTime()) {
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

    return {
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
