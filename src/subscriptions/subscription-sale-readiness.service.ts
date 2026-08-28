import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { SubscriptionSaleReadinessDto } from './dto/subscription-sale-readiness.dto';
import {
  LK_NODE_RED_ANNUAL_BOOKING_V1,
  publicationAdapterRuntimeCompatibility
} from './subscription-publication-enforcement-adapter';
import { subscriptionProviderScopeMatchesProjection } from './subscription-provider-scope';
import {
  subscriptionProjectionFenceBindingDigest,
  subscriptionProjectionFenceId
} from './subscription-projection-fence';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  validateStoredSubscriptionInstanceProjectorCheckpoint,
  validateStoredSubscriptionProjectionFence
} from './subscription-runtime-contracts';
import {
  StoredSubscriptionInstanceProjectorCheckpoint,
  StoredSubscriptionPolicyPublication,
  StoredSubscriptionProjectionFence,
  StoredSubscriptionProviderMapping,
  SubscriptionProviderScope,
  SubscriptionRuntimeCompatibility
} from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

type SaleReadinessMapping = Pick<StoredSubscriptionProviderMapping,
  | 'mappingId'
  | 'subscriptionTypeId'
  | 'state'
  | 'verifiedAt'
  | 'revision'>;

type SaleReadinessPublication = Pick<StoredSubscriptionPolicyPublication,
  | 'publicationId'
  | 'subscriptionTypeId'
  | 'policyVersion'
  | 'mappingId'
  | 'state'
  | 'effectiveAt'
  | 'schemaVersion'>;

export interface SubscriptionSaleReadinessResult {
  schemaVersion: 1;
  ready: boolean;
  provider: 'VIVA';
  providerProductId: string;
  providerScope: SubscriptionProviderScope;
  checkedAt: string;
  requiredCompatibility: SubscriptionRuntimeCompatibility;
  mapping: SaleReadinessMapping | null;
  publication: SaleReadinessPublication | null;
  instanceProjector: {
    status: 'UNAVAILABLE' | 'CURRENT';
    checkpointAsOf: string | null;
  };
  blockers: Array<{ code: string }>;
}

@Injectable()
export class SubscriptionSaleReadinessService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async check(
    integrationToken: string | undefined,
    dto: SubscriptionSaleReadinessDto
  ): Promise<SubscriptionSaleReadinessResult> {
    this.assertEnabled();
    this.assertIntegrationToken(integrationToken);
    const tenantId = this.requireConfiguredTenantId();
    const maxStalenessSeconds = this.requireMaxStalenessSeconds();
    const requiredCompatibility = publicationAdapterRuntimeCompatibility(
      LK_NODE_RED_ANNUAL_BOOKING_V1
    );
    const checkedAt = this.now();
    const providerScope: SubscriptionProviderScope = {
      kind: dto.providerScopeKind,
      scopeId: dto.providerScopeId
    };
    const base = {
      schemaVersion: 1 as const,
      ready: false as const,
      provider: dto.provider,
      providerProductId: dto.providerProductId,
      providerScope,
      checkedAt: checkedAt.toISOString(),
      requiredCompatibility,
      instanceProjector: { status: 'UNAVAILABLE' as const, checkpointAsOf: null }
    };

    if (!this.compatibilityMatches(dto, requiredCompatibility)) {
      return {
        ...base,
        mapping: null,
        publication: null,
        blockers: [
          { code: 'SUBSCRIPTIONS_SALE_READINESS_REQUIRED_COMPATIBILITY_UNSUPPORTED' },
          { code: 'SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE' }
        ]
      };
    }

    const blockers: string[] = [];
    if (!this.flag('SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED')) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_RUNTIME_CONTEXT_DISABLED');
    }
    const identity = {
      tenantId,
      provider: 'VIVA' as const,
      providerProductId: dto.providerProductId,
      providerScopeKind: dto.providerScopeKind,
      providerScopeId: dto.providerScopeId
    };
    const mapping = await this.read(() =>
      this.repository.runtimeProviderMappingByProviderIdentity(identity)
    );
    if (!mapping) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_MAPPING_NOT_FOUND');
    } else {
      if (mapping.state !== 'VERIFIED') {
        blockers.push('SUBSCRIPTIONS_SALE_READINESS_MAPPING_NOT_VERIFIED');
      }
      if (!this.isFresh(mapping.verifiedAt, checkedAt, maxStalenessSeconds)) {
        blockers.push('SUBSCRIPTIONS_SALE_READINESS_MAPPING_STALE');
      }
    }

    const subscriptionType = mapping
      ? await this.read(() => this.repository.subscriptionTypeById(mapping.subscriptionTypeId))
      : null;
    const currentPolicyVersion = subscriptionType
      && subscriptionType.state === 'ACTIVE'
      && Number.isSafeInteger(subscriptionType.currentPolicyVersion)
      && Number(subscriptionType.currentPolicyVersion) > 0
      ? Number(subscriptionType.currentPolicyVersion)
      : null;
    if (mapping && currentPolicyVersion === null) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_SUBSCRIPTION_TYPE_NOT_CURRENT');
    }

    const publication = mapping && currentPolicyVersion !== null
      ? await this.read(() => this.repository.runtimePolicyPublicationByVersion(
        mapping.subscriptionTypeId,
        currentPolicyVersion
      ))
      : null;
    if (mapping && currentPolicyVersion !== null && !publication) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_FOUND');
    }
    if (mapping && currentPolicyVersion !== null && publication) {
      this.appendPublicationBlockers(
        blockers,
        publication,
        mapping,
        currentPolicyVersion,
        tenantId,
        checkedAt,
        requiredCompatibility
      );
      const [mappingAfterRead, typeAfterRead] = await Promise.all([
        this.read(() => this.repository.runtimeProviderMappingByProviderIdentity(identity)),
        this.read(() => this.repository.subscriptionTypeById(mapping.subscriptionTypeId))
      ]);
      if (!mappingAfterRead
        || mappingAfterRead.mappingId !== mapping.mappingId
        || mappingAfterRead.revision !== mapping.revision
        || !typeAfterRead
        || typeAfterRead.subscriptionTypeId !== subscriptionType?.subscriptionTypeId
        || typeAfterRead.revision !== subscriptionType?.revision
        || typeAfterRead.currentPolicyVersion !== subscriptionType?.currentPolicyVersion) {
        blockers.push('SUBSCRIPTIONS_SALE_READINESS_EVIDENCE_CHANGED');
      }
    }

    let instanceProjector: SubscriptionSaleReadinessResult['instanceProjector'] = {
      status: 'UNAVAILABLE',
      checkpointAsOf: null
    };
    if (mapping && publication
      && this.flag('SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED')
      && this.flag('SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED')) {
      const [checkpoint, fence] = await Promise.all([
        this.read(() => this.repository.runtimeInstanceProjectorCheckpointByProviderIdentity(identity)),
        this.read(() => this.repository.runtimeProjectionFenceByType(
          publication.subscriptionTypeId
        ))
      ]);
      if (checkpoint && fence && this.instanceProjectorIsCurrent(
        checkpoint,
        fence,
        mapping,
        publication,
        checkedAt,
        maxStalenessSeconds,
        requiredCompatibility
      )) {
        instanceProjector = {
          status: 'CURRENT',
          checkpointAsOf: checkpoint.coverage.coverageThrough
        };
        const [mappingAfterCheckpoint, publicationAfterCheckpoint, fenceAfterCheckpoint] = await Promise.all([
          this.read(() => this.repository.runtimeProviderMappingByProviderIdentity(identity)),
          this.read(() => this.repository.runtimePolicyPublicationByVersion(
            publication.subscriptionTypeId,
            publication.policyVersion
          )),
          this.read(() => this.repository.runtimeProjectionFenceByType(
            publication.subscriptionTypeId
          ))
        ]);
        if (!mappingAfterCheckpoint
          || mappingAfterCheckpoint.mappingId !== mapping.mappingId
          || mappingAfterCheckpoint.revision !== mapping.revision
          || !publicationAfterCheckpoint
          || publicationAfterCheckpoint.publicationId !== publication.publicationId
          || publicationAfterCheckpoint.state !== publication.state
          || publicationAfterCheckpoint.policyDigest !== publication.policyDigest
          || !fenceAfterCheckpoint
          || fenceAfterCheckpoint.bindingRevision !== fence.bindingRevision
          || fenceAfterCheckpoint.bindingDigest !== fence.bindingDigest
          || fenceAfterCheckpoint.coordinationRevision !== fence.coordinationRevision
          || fenceAfterCheckpoint.lastProjectorReconciliationDigest
            !== fence.lastProjectorReconciliationDigest) {
          blockers.push('SUBSCRIPTIONS_SALE_READINESS_EVIDENCE_CHANGED');
          instanceProjector = { status: 'UNAVAILABLE', checkpointAsOf: null };
        }
      }
    }
    if (instanceProjector.status !== 'CURRENT') {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE');
    }
    const uniqueBlockers = [...new Set(blockers)];
    return {
      ...base,
      ready: uniqueBlockers.length === 0,
      instanceProjector,
      mapping: mapping ? this.mappingView(mapping) : null,
      publication: publication ? this.publicationView(publication) : null,
      blockers: uniqueBlockers.map((code) => ({ code }))
    };
  }

  protected now(): Date {
    return new Date();
  }

  private appendPublicationBlockers(
    blockers: string[],
    publication: StoredSubscriptionPolicyPublication,
    mapping: StoredSubscriptionProviderMapping,
    currentPolicyVersion: number,
    tenantId: string,
    checkedAt: Date,
    requiredCompatibility: SubscriptionRuntimeCompatibility
  ): void {
    const effectiveAt = Date.parse(publication.effectiveAt);
    if (publication.state !== 'PUBLISHED') {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_PUBLISHED');
    }
    if (!Number.isFinite(effectiveAt) || effectiveAt > checkedAt.getTime()) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_NOT_EFFECTIVE');
    }
    if (publication.subscriptionTypeId !== mapping.subscriptionTypeId
      || publication.policyVersion !== currentPolicyVersion
      || publication.mappingId !== mapping.mappingId) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_PUBLICATION_LINK_MISMATCH');
    }
    if (!subscriptionProviderScopeMatchesProjection(
      mapping.providerScope,
      publication.runtimeProjection,
      tenantId
    )) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_PROVIDER_SCOPE_MISMATCH');
    }
    if (publication.schemaVersion !== 3 || !publication.runtimeCompatibility) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_RUNTIME_COMPATIBILITY_UNATTESTED');
    } else if (!this.runtimeCompatibilityMatches(
      publication.runtimeCompatibility,
      requiredCompatibility
    )) {
      blockers.push('SUBSCRIPTIONS_SALE_READINESS_RUNTIME_COMPATIBILITY_MISMATCH');
    }
  }

  private compatibilityMatches(
    dto: SubscriptionSaleReadinessDto,
    required: SubscriptionRuntimeCompatibility
  ): boolean {
    return dto.requiredAdapterId === required.adapterId
      && dto.requiredContractVersion === required.contractVersion
      && dto.requiredCapabilityDigest === required.capabilityDigest;
  }

  private runtimeCompatibilityMatches(
    actual: SubscriptionRuntimeCompatibility,
    required: SubscriptionRuntimeCompatibility
  ): boolean {
    return actual.adapterId === required.adapterId
      && actual.contractVersion === required.contractVersion
      && actual.capabilityDigest === required.capabilityDigest;
  }

  private instanceProjectorIsCurrent(
    checkpoint: StoredSubscriptionInstanceProjectorCheckpoint,
    fence: StoredSubscriptionProjectionFence,
    mapping: StoredSubscriptionProviderMapping,
    publication: StoredSubscriptionPolicyPublication,
    checkedAt: Date,
    maxStalenessSeconds: number,
    requiredCompatibility: SubscriptionRuntimeCompatibility
  ): boolean {
    try {
      validateStoredSubscriptionInstanceProjectorCheckpoint(checkpoint);
      validateStoredSubscriptionProjectionFence(fence);
    } catch {
      return false;
    }
    const compatibility = checkpoint.binding.runtimeCompatibility;
    return checkpoint.state === 'CURRENT'
      && checkpoint.coverage.kind === 'CONSISTENT_FULL_SNAPSHOT'
      && checkpoint.coverage.sourceItemCount > 0
      && this.isFresh(
        checkpoint.coverage.coverageThrough,
        checkedAt,
        maxStalenessSeconds
      )
      && checkpoint.binding.mappingId === mapping.mappingId
      && checkpoint.binding.mappingRevision === mapping.revision
      && checkpoint.binding.subscriptionTypeId === publication.subscriptionTypeId
      && checkpoint.binding.publicationId === publication.publicationId
      && checkpoint.binding.policyVersion === publication.policyVersion
      && checkpoint.binding.policyDigest === publication.policyDigest
      && checkpoint.binding.fenceId === fence.fenceId
      && fence.fenceId === subscriptionProjectionFenceId(publication.subscriptionTypeId)
      && checkpoint.binding.fenceRevision === fence.bindingRevision
      && checkpoint.binding.fenceDigest === fence.bindingDigest
      && fence.bindingDigest === subscriptionProjectionFenceBindingDigest(fence.binding)
      && fence.binding.mappingId === mapping.mappingId
      && fence.binding.mappingRevision === mapping.revision
      && fence.binding.publicationId === publication.publicationId
      && fence.binding.policyVersion === publication.policyVersion
      && fence.binding.policyDigest === publication.policyDigest
      && fence.lastProjectorReconciliationDigest
        === checkpoint.reconciliation.reconciliationDigest
      && this.runtimeCompatibilityMatches(
        fence.binding.runtimeCompatibility,
        requiredCompatibility
      )
      && this.runtimeCompatibilityMatches(compatibility, requiredCompatibility);
  }

  private mappingView(mapping: StoredSubscriptionProviderMapping): SaleReadinessMapping {
    return {
      mappingId: mapping.mappingId,
      subscriptionTypeId: mapping.subscriptionTypeId,
      state: mapping.state,
      verifiedAt: mapping.verifiedAt,
      revision: mapping.revision
    };
  }

  private publicationView(
    publication: StoredSubscriptionPolicyPublication
  ): SaleReadinessPublication {
    return {
      publicationId: publication.publicationId,
      subscriptionTypeId: publication.subscriptionTypeId,
      policyVersion: publication.policyVersion,
      mappingId: publication.mappingId,
      state: publication.state,
      effectiveAt: publication.effectiveAt,
      schemaVersion: publication.schemaVersion
    };
  }

  private async read<T>(action: () => Promise<T>): Promise<T> {
    try {
      await this.repository.connectReadOnly();
      return await action();
    } catch {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_STORAGE_UNAVAILABLE',
        message: 'Subscription sale readiness storage is unavailable'
      });
    }
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_SALE_READINESS_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_DISABLED',
        message: 'Subscription sale readiness is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(
      process.env.SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN ?? ''
    ).trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_NOT_CONFIGURED',
        message: 'Subscription sale readiness is not configured'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(String(suppliedToken ?? '').trim());
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_FORBIDDEN',
        message: 'Subscription sale readiness access is forbidden'
      });
    }
  }

  private requireConfiguredTenantId(): string {
    const value = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_TENANT_ID_INVALID',
        message: 'Subscription sale readiness tenant is not configured'
      });
    }
    return value;
  }

  private requireMaxStalenessSeconds(): number {
    const value = Number(process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(value) || value < 30 || value > 86400) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SALE_READINESS_STALENESS_CONFIG_INVALID',
        message: 'Subscription sale readiness staleness is not configured'
      });
    }
    return value;
  }

  private isFresh(value: string | null, now: Date, maxSeconds: number): boolean {
    const observedAt = Date.parse(String(value ?? ''));
    return Number.isFinite(observedAt)
      && observedAt <= now.getTime()
      && now.getTime() - observedAt <= maxSeconds * 1000;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(
      String(process.env[name] ?? '').trim().toLowerCase()
    );
  }
}
