import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { RESIDENCY_PRODUCT_ID, residencyBookingCompatibilityMatches } from './residency-booking-policy';
import { SubscriptionRuntimeContextService, SubscriptionRuntimeIdentity } from './subscription-runtime-context.service';
import { SubscriptionRuntimeContextDto } from './dto/subscription-runtime-context.dto';
import { ResidencyObservationRepository } from './residency-observation.repository';
import { normalizeResidencyProviderFacts, residencyDigest, residencyFailure, residencyInstanceId, withinResidencyDeadline,
  StoredResidencyObservation } from './residency-provider-observation';
import { resolveSubscriptionSalePeriod } from './subscription-sale-period-resolver';

@Injectable()
export class ResidencyProviderSyncService {
  constructor(private readonly identity: SubscriptionRuntimeContextService,
    private readonly repository: ResidencyObservationRepository, private readonly viva: VivaAdminService) {}

  async refresh(authorization: string | undefined, integrationToken: string | undefined, dto: SubscriptionRuntimeContextDto) {
    const actor = await this.identity.authorizeResidencyRefresh(authorization, integrationToken);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(dto.clientSubscriptionId)) residencyFailure('INSTANCE_ID_INVALID');
    return this.refreshOwned(actor, dto.clientSubscriptionId);
  }

  private async refreshOwned(actor: SubscriptionRuntimeIdentity, clientSubscriptionId: string) {
    const studioId = String(process.env.SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID || '');
    const ttl = Number(process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS);
    const deadline = Date.now() + 8000;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(studioId) || !Number.isSafeInteger(ttl) || ttl < 30 || ttl > 300) {
      residencyFailure('CONFIG_INVALID');
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (Date.now() >= deadline) residencyFailure('DEADLINE');
      const snapshot = await withinResidencyDeadline(() => this.repository.binding(actor.tenantId, deadline), deadline);
      const source = await withinResidencyDeadline(() => this.viva.readResidencySubscriptionEvidence({ clientId: actor.providerClientId, clientSubscriptionId, studioId, deadline }), deadline);
      const facts = normalizeResidencyProviderFacts({ providerClientId: actor.providerClientId, clientSubscriptionId,
        subscription: source.subscription, transaction: source.transaction, observedAt: this.now().toISOString() });
      const resolution = resolveSubscriptionSalePeriod({ purchasedAt: facts.purchasedAt, publications: snapshot.publications });
      if (resolution.kind !== 'MATCH') residencyFailure('SALE_PERIOD');
      const publication = resolution.publication;
      if (publication.mappingId !== snapshot.mapping.mappingId || publication.state === 'DISABLED_FOR_NEW_OPERATIONS'
        || !residencyBookingCompatibilityMatches(publication.runtimeProjection, publication.runtimeCompatibility)) residencyFailure('POLICY_UNSUPPORTED');
      const earliest = Math.min(Date.parse(source.instanceObservedAt), Date.parse(source.productObservedAt));
      if (!Number.isFinite(earliest) || earliest > this.now().getTime() || this.now().getTime() - earliest >= 30000) residencyFailure('OBSERVATION_EXPIRED');
      const binding = { subscriptionTypeId: publication.subscriptionTypeId, policyVersion: publication.policyVersion,
        policyDigest: publication.policyDigest, publicationId: publication.publicationId, mappingId: publication.mappingId };
      const now = this.now().toISOString();
      const observation: StoredResidencyObservation = { schemaVersion: 1, sourceKind: 'VIVA_OWNED_SUBSCRIPTION_READ',
        subscriptionInstanceId: residencyInstanceId(actor.tenantId, clientSubscriptionId), ...actor, clientSubscriptionId,
        facts, binding, evidence: { instanceObservedAt: source.instanceObservedAt, productObservedAt: source.productObservedAt,
          productEvidenceRef: source.productEvidenceRef, sourceDigest: facts.sourceDigest, mappingRevision: snapshot.mapping.revision + 1 },
        revision: 1, createdAt: now, updatedAt: now,
        refreshId: residencyDigest({ actor, clientSubscriptionId, binding, sourceDigest: facts.sourceDigest,
          instanceObservedAt: source.instanceObservedAt, productObservedAt: source.productObservedAt,
          mappingRevision: snapshot.mapping.revision }) };
      let stored: StoredResidencyObservation;
      try { stored = await this.repository.persist(snapshot, observation, deadline); }
      catch (error) {
        const code = error instanceof ServiceUnavailableException ? (error.getResponse() as { code?: string }).code : null;
        if (code === 'RESIDENCY_SYNC_BINDING_CHANGED' && attempt === 0) continue;
        throw error;
      }
      if (Date.now() >= deadline) residencyFailure('DEADLINE');
      if (residencyDigest(stored.facts) !== residencyDigest(facts) || residencyDigest(stored.binding) !== residencyDigest(binding)
        || stored.clientRefHash !== actor.clientRefHash || stored.refreshId !== observation.refreshId) residencyFailure('STORED_OBSERVATION_MISMATCH');
      const validUntil = Math.min(earliest + 30000, earliest + ttl * 1000, Date.parse(facts.activeTo || ''));
      if (!facts.eligible) throw new ForbiddenException({ code: 'RESIDENCY_SYNC_' + facts.denialReason });
      if (!Number.isFinite(validUntil) || validUntil <= this.now().getTime()) residencyFailure('OBSERVATION_EXPIRED');
      return { schemaVersion: 1 as const, contextKind: 'RESIDENCY_BOOKING_CONTEXT' as const,
        providerProductId: RESIDENCY_PRODUCT_ID, purchasedAt: facts.purchasedAt,
        runtimeCompatibility: publication.runtimeCompatibility, observedAt: new Date(earliest).toISOString(),
        validUntil: new Date(validUntil).toISOString(), context: { schemaVersion: 1 as const,
          subscriptionInstanceId: stored.subscriptionInstanceId, clientSubscriptionId, policyDigest: publication.policyDigest,
          policy: publication.runtimeProjection, instance: { subscriptionInstanceId: stored.subscriptionInstanceId,
            subscriptionTypeId: publication.subscriptionTypeId, policyVersion: publication.policyVersion,
            state: 'ACTIVE' as const, activeFrom: facts.activeFrom!, activeTo: facts.activeTo!,
            frozenUntil: null, homeStationId: null, noShowBlockedUntil: null },
          evidence: { mappingId: publication.mappingId, mappingRevision: stored.evidence.mappingRevision,
            mappingVerifiedAt: stored.evidence.productObservedAt, publicationId: publication.publicationId,
            publishedAt: publication.publishedAt, instanceRevision: stored.revision,
            instanceAsOf: stored.evidence.instanceObservedAt } } };
    }
    return residencyFailure('REFRESH_CONFLICT');
  }
  protected now(): Date { return new Date(); }
}
