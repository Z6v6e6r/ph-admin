import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  SubscriptionAction,
  SubscriptionShadowQuoteResolvedTarget
} from './subscriptions.types';

export interface SubscriptionCanonicalTargetReference {
  tenantId: string;
  targetId: string;
  action: SubscriptionAction;
  snapshotRevision: number;
}

export type SubscriptionLatestCanonicalTargetReference = Omit<
  SubscriptionCanonicalTargetReference,
  'snapshotRevision'
>;

@Injectable()
export class SubscriptionCanonicalTargetResolverService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async resolve(
    reference: SubscriptionCanonicalTargetReference
  ): Promise<SubscriptionShadowQuoteResolvedTarget> {
    this.assertEnabled();
    const now = this.now();
    const maxStalenessMs = this.maxStalenessSeconds() * 1000;
    await this.repository.connectReadOnly();
    const snapshot = await this.repository.runtimeCanonicalTargetSnapshot({
      tenantId: reference.tenantId,
      targetId: reference.targetId,
      action: reference.action,
      revision: reference.snapshotRevision
    });
    if (!snapshot) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_NOT_FOUND',
        'Canonical subscription target is not available'
      );
    }
    const latest = await this.repository.runtimeLatestCanonicalTargetSnapshot({
      tenantId: reference.tenantId,
      targetId: reference.targetId,
      action: reference.action
    });
    if (!latest || latest.revision !== reference.snapshotRevision) {
      if (latest?.state === 'REVOKED') {
        this.unavailable(
          'SUBSCRIPTIONS_CANONICAL_TARGET_REVOKED',
          'Canonical subscription target is not active'
        );
      }
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_SUPERSEDED',
        'Canonical subscription target revision is not current'
      );
    }
    if (latest.state !== 'ACTIVE') {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_REVOKED',
        'Canonical subscription target is not active'
      );
    }
    const observedAt = Date.parse(snapshot.observedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    if (observedAt > now.getTime() || now.getTime() - observedAt > maxStalenessMs) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_STALE',
        'Canonical subscription target is stale'
      );
    }
    if (expiresAt <= now.getTime()) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_EXPIRED',
        'Canonical subscription target has expired'
      );
    }
    return {
      resolutionSource: 'SERVER',
      targetId: snapshot.targetId,
      stationId: snapshot.stationId,
      category: snapshot.category,
      externalEventTypeId: snapshot.externalEventTypeId,
      productTypeId: snapshot.productTypeId,
      durationMinutes: snapshot.durationMinutes,
      startsAt: snapshot.startsAt,
      basePriceMinor: snapshot.basePriceMinor,
      currency: snapshot.currency,
      dictionaryRevision: snapshot.dictionaryRevision,
      evidenceRef: snapshot.evidenceRef,
      priceEvidenceRef: snapshot.priceEvidenceRef,
      resolvedAt: snapshot.observedAt
    };
  }

  async resolveLatest(
    reference: SubscriptionLatestCanonicalTargetReference
  ): Promise<SubscriptionShadowQuoteResolvedTarget> {
    this.assertEnabled();
    await this.repository.connectReadOnly();
    const latest = await this.repository.runtimeLatestCanonicalTargetSnapshot(reference);
    if (!latest) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_NOT_FOUND',
        'Canonical subscription target is not available'
      );
    }
    return this.resolve({ ...reference, snapshotRevision: latest.revision });
  }

  protected now(): Date {
    return new Date();
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED')) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_DISABLED',
        'Canonical subscription target resolver is disabled'
      );
    }
  }

  private maxStalenessSeconds(): number {
    const value = Number(process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(value) || value < 30 || value > 3600) {
      this.unavailable(
        'SUBSCRIPTIONS_CANONICAL_TARGET_STALENESS_CONFIG_INVALID',
        'Canonical subscription target freshness is not configured'
      );
    }
    return value;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }

  private unavailable(code: string, message: string): never {
    throw new ServiceUnavailableException({ code, message });
  }
}
