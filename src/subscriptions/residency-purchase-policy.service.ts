import { BadRequestException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ResidencyPurchasePolicyDto } from './dto/residency-purchase-policy.dto';
import { RESIDENCY_PRODUCT_ID, residencyBookingCompatibilityMatches } from './residency-booking-policy';
import { ResidencyObservationRepository } from './residency-observation.repository';
import { resolveSubscriptionSalePeriod } from './subscription-sale-period-resolver';
import { SubscriptionRuntimeContextService } from './subscription-runtime-context.service';

@Injectable()
export class ResidencyPurchasePolicyService {
  constructor(
    private readonly identity: SubscriptionRuntimeContextService,
    private readonly repository: ResidencyObservationRepository
  ) {}

  async read(authorization: string | undefined, integrationToken: string | undefined, target: ResidencyPurchasePolicyDto) {
    const { tenantId } = await this.identity.authorizeResidencyPurchasePolicy(authorization, integrationToken);
    const startsAt = Date.parse(target.startsAt);
    if (!Number.isFinite(startsAt) || new Date(startsAt).toISOString() !== target.startsAt) {
      throw new BadRequestException({ code: 'RESIDENCY_PURCHASE_TARGET_INVALID' });
    }

    const snapshot = await this.repository.binding(tenantId, this.now().getTime() + 8000);
    const now = this.now();
    const resolution = resolveSubscriptionSalePeriod({ purchasedAt: now.toISOString(), publications: snapshot.publications });
    if (resolution.kind !== 'MATCH') throw new ServiceUnavailableException({ code: 'RESIDENCY_PURCHASE_POLICY_UNAVAILABLE' });

    const publication = resolution.publication;
    const policy = publication.runtimeProjection;
    if (publication.state !== 'PUBLISHED' || publication.publicationId !== snapshot.fence.binding.publicationId
      || publication.mappingId !== snapshot.mapping.mappingId || Date.parse(publication.publishedAt) > now.getTime()
      || !residencyBookingCompatibilityMatches(policy, publication.runtimeCompatibility)) {
      throw new ServiceUnavailableException({ code: 'RESIDENCY_PURCHASE_POLICY_UNAVAILABLE' });
    }

    const rule = policy.benefitRules.find(candidate => candidate.enabled && candidate.category === 'GROUP_TRAINING'
      && candidate.actions.includes('BOOK_GROUP_TRAINING') && candidate.externalEventTypeIds.includes(target.externalEventTypeId)
      && candidate.durationMinutes.includes(target.durationMinutes));
    const endsAt = startsAt + target.durationMinutes * 60000;
    const activeTo = now.getTime() + (policy.lifecycle.validityDays ?? 0) * 86400000;
    if (rule?.percentage == null || startsAt <= now.getTime() || endsAt > activeTo) {
      throw new UnprocessableEntityException({ code: 'RESIDENCY_PURCHASE_TARGET_NOT_COVERED' });
    }

    return {
      schemaVersion: 1 as const,
      exerciseId: target.exerciseId,
      stationId: target.stationId,
      externalEventTypeId: target.externalEventTypeId,
      startsAt: target.startsAt,
      durationMinutes: target.durationMinutes,
      providerProductId: RESIDENCY_PRODUCT_ID,
      publicationId: publication.publicationId,
      policyVersion: publication.policyVersion,
      policyDigest: publication.policyDigest,
      groupTrainingDiscountPercent: rule.percentage,
      observedAt: now.toISOString(),
      validUntil: new Date(Math.min(now.getTime() + 30000, startsAt)).toISOString()
    };
  }

  protected now(): Date {
    return new Date();
  }
}
