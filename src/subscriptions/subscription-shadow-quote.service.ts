import { Injectable } from '@nestjs/common';
import {
  SubscriptionRuntimeContractError,
  validateStoredSubscriptionEntitlementAggregate,
  validateStoredSubscriptionInstance,
  validateStoredSubscriptionPolicyPublication,
  validateStoredSubscriptionProviderMapping
} from './subscription-runtime-contracts';
import { evaluateSubscriptionShadowQuote } from './subscription-shadow-quote';
import { subscriptionProviderScopeMatchesProjection } from './subscription-provider-scope';
import { SubscriptionsRepository } from './subscriptions.repository';
import {
  SubscriptionShadowQuoteBlocker,
  SubscriptionShadowQuoteRequest,
  SubscriptionShadowQuoteResult
} from './subscriptions.types';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const ACTIONS = [
  'CREATE_GAME', 'JOIN_GAME', 'BOOK_GROUP_TRAINING', 'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
] as const;
const CATEGORIES = ['GAME', 'GROUP_TRAINING', 'TOURNAMENT', 'ADD_ON_PRODUCT'] as const;

@Injectable()
export class SubscriptionShadowQuoteService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async quote(request: SubscriptionShadowQuoteRequest): Promise<SubscriptionShadowQuoteResult> {
    this.assertEnabled();
    const now = this.now();
    const maxStalenessSeconds = this.maxStalenessSeconds();
    this.validateTrustedRequest(request);
    await this.repository.connectReadOnly();

    const instance = await this.repository.runtimeInstanceByTenantAndId(
      request.identity.tenantId,
      request.subscriptionInstanceId
    );
    if (!instance || instance.clientRefHash !== request.identity.clientRefHash) {
      return this.blocked(request.subscriptionInstanceId, now, [
        this.blocker('SUBSCRIPTION_OWNERSHIP_NOT_CONFIRMED', 'Подписка не принадлежит текущему клиенту')
      ]);
    }
    validateStoredSubscriptionInstance(instance);

    const [mapping, publication, aggregate] = await Promise.all([
      this.repository.runtimeProviderMappingById(instance.mappingId),
      this.repository.runtimePolicyPublicationByVersion(
        instance.subscriptionTypeId,
        instance.policyVersion
      ),
      this.repository.runtimeEntitlementAggregateByInstance(instance.subscriptionInstanceId)
    ]);
    const blockers: SubscriptionShadowQuoteBlocker[] = [];
    const block = (code: string, message: string): void => {
      if (!blockers.some((item) => item.code === code)) blockers.push(this.blocker(code, message));
    };

    if (!mapping) block('PROVIDER_MAPPING_NOT_FOUND', 'Проверенная связь с продуктом Viva не найдена');
    if (!publication) block('POLICY_PUBLICATION_NOT_FOUND', 'Опубликованная версия правил не найдена');
    if (!aggregate) block('ENTITLEMENT_AGGREGATE_NOT_FOUND', 'Актуальный счётчик подписки не найден');
    if (mapping) {
      validateStoredSubscriptionProviderMapping(mapping);
      if (mapping.state !== 'VERIFIED') block('PROVIDER_MAPPING_NOT_VERIFIED', 'Связь с продуктом Viva не подтверждена');
      if (mapping.mappingId !== instance.mappingId
        || mapping.tenantId !== instance.tenantId
        || mapping.subscriptionTypeId !== instance.subscriptionTypeId
        || mapping.provider !== instance.provider
        || mapping.providerProductId !== instance.providerProductId) {
        block('PROVIDER_MAPPING_LINK_MISMATCH', 'Связь подписки с продуктом Viva не совпадает');
      }
      if (mapping.providerScope.kind === 'TENANT'
        && mapping.providerScope.scopeId !== instance.tenantId) {
        block('PROVIDER_MAPPING_SCOPE_MISMATCH', 'Область продукта Viva не совпадает с организацией');
      } else if (mapping.providerScope.kind === 'STATION'
        && mapping.providerScope.scopeId !== instance.homeStationId) {
        block('PROVIDER_MAPPING_SCOPE_MISMATCH', 'Область продукта Viva не совпадает с домашней станцией');
      } else if (mapping.providerScope.kind === 'STUDIO') {
        block('CANONICAL_STUDIO_MAPPING_UNAVAILABLE', 'Сопоставление студии Viva со станцией ещё не подтверждено');
      } else if (mapping.providerScope.kind === 'STATION_SET' && publication
        && !subscriptionProviderScopeMatchesProjection(
          mapping.providerScope,
          publication.runtimeProjection,
          instance.tenantId
        )) {
        block('PROVIDER_MAPPING_SCOPE_MISMATCH', 'Набор станций Viva не совпадает с опубликованными правилами');
      }
      this.requireFresh('PROVIDER_MAPPING_STALE', mapping.verifiedAt, now, maxStalenessSeconds, block);
    }
    if (publication) {
      validateStoredSubscriptionPolicyPublication(publication);
      if (publication.state === 'DISABLED_FOR_NEW_OPERATIONS') {
        block('POLICY_DISABLED_FOR_NEW_OPERATIONS', 'Версия правил отключена для новых операций');
      }
      if (publication.subscriptionTypeId !== instance.subscriptionTypeId
        || publication.policyVersion !== instance.policyVersion
        || publication.policyDigest !== instance.policyDigest
        || publication.mappingId !== instance.mappingId) {
        block('POLICY_INSTANCE_LINK_MISMATCH', 'Экземпляр подписки не закреплён за этой версией правил');
      }
      if (publication.dictionaryRevision !== request.target.dictionaryRevision) {
        block('DICTIONARY_REVISION_MISMATCH', 'Справочник услуги отличается от справочника правил');
      }
    }
    if (aggregate) {
      validateStoredSubscriptionEntitlementAggregate(aggregate);
      if (aggregate.subscriptionInstanceId !== instance.subscriptionInstanceId) {
        block('ENTITLEMENT_AGGREGATE_LINK_MISMATCH', 'Счётчик относится к другой подписке');
      }
      if (aggregate.reconciliation.state !== 'CURRENT') {
        block('ENTITLEMENT_AGGREGATE_NOT_CURRENT', 'Счётчик подписки требует сверки');
      }
      this.requireFresh(
        'ENTITLEMENT_AGGREGATE_STALE',
        aggregate.reconciliation.asOf,
        now,
        maxStalenessSeconds,
        block
      );
    }
    if (instance.reconciliation.state !== 'CURRENT') {
      block('SUBSCRIPTION_INSTANCE_NOT_CURRENT', 'Статус подписки требует сверки');
    }
    this.requireFresh(
      'SUBSCRIPTION_INSTANCE_STALE',
      instance.reconciliation.asOf,
      now,
      maxStalenessSeconds,
      block
    );
    this.requireFresh(
      'LK_IDENTITY_STALE',
      request.identity.verifiedAt,
      now,
      maxStalenessSeconds,
      block
    );
    this.requireFresh(
      'TARGET_RESOLUTION_STALE',
      request.target.resolvedAt,
      now,
      maxStalenessSeconds,
      block
    );
    if (request.target.basePriceMinor === null) {
      block('BASE_PRICE_UNRESOLVED', 'Базовая цена услуги не подтверждена сервером');
    } else if (!request.target.priceEvidenceRef) {
      block('BASE_PRICE_EVIDENCE_REQUIRED', 'Базовая цена не подтверждена серверным источником');
    }

    if (blockers.length || !publication || !aggregate) {
      return this.blocked(
        instance.subscriptionInstanceId,
        now,
        blockers,
        publication?.policyVersion ?? null,
        publication?.policyDigest ?? null,
        aggregate?.revision ?? null
      );
    }
    return evaluateSubscriptionShadowQuote({
      evaluatedAt: now.toISOString(),
      publication,
      instance,
      aggregate,
      action: request.action,
      target: request.target
    });
  }

  protected now(): Date {
    return new Date();
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED')) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_RUNTIME_CONTRACTS_DISABLED');
    }
    if (!this.flag('SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED')) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_DISABLED');
    }
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }

  private maxStalenessSeconds(): number {
    const value = Number(process.env.SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS);
    if (!Number.isSafeInteger(value) || value < 30 || value > 3600) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_STALENESS_CONFIG_INVALID');
    }
    return value;
  }

  private validateTrustedRequest(request: SubscriptionShadowQuoteRequest): void {
    if (request.identity?.resolutionSource !== 'LK_IDENTITY'
      || request.target?.resolutionSource !== 'SERVER') {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_SOURCE_UNTRUSTED');
    }
    for (const [field, value] of [
      ['identity.tenantId', request.identity.tenantId],
      ['identity.evidenceRef', request.identity.evidenceRef],
      ['subscriptionInstanceId', request.subscriptionInstanceId],
      ['target.targetId', request.target.targetId],
      ['target.stationId', request.target.stationId],
      ['target.externalEventTypeId', request.target.externalEventTypeId],
      ['target.dictionaryRevision', request.target.dictionaryRevision],
      ['target.evidenceRef', request.target.evidenceRef]
    ] as const) {
      if (typeof value !== 'string' || value !== value.trim() || !ID_PATTERN.test(value)) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_ID_INVALID', { field });
      }
    }
    if (!HASH_PATTERN.test(request.identity.clientRefHash)) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_CLIENT_HASH_INVALID');
    }
    if (!(ACTIONS as readonly unknown[]).includes(request.action)
      || !(CATEGORIES as readonly unknown[]).includes(request.target.category)) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_TARGET_INVALID');
    }
    if (request.target.currency !== 'RUB'
      || !Number.isSafeInteger(request.target.durationMinutes)
      || request.target.durationMinutes <= 0
      || (request.target.basePriceMinor !== null
        && (!Number.isSafeInteger(request.target.basePriceMinor)
          || request.target.basePriceMinor < 0))) {
      throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_TARGET_INVALID');
    }
    for (const [field, value] of [
      ['identity.verifiedAt', request.identity.verifiedAt],
      ['target.startsAt', request.target.startsAt],
      ['target.resolvedAt', request.target.resolvedAt]
    ] as const) {
      const parsed = new Date(value);
      if (typeof value !== 'string' || !Number.isFinite(parsed.getTime())
        || parsed.toISOString() !== value) {
        throw new SubscriptionRuntimeContractError(
          'SUBSCRIPTION_SHADOW_QUOTE_TIMESTAMP_INVALID',
          { field }
        );
      }
    }
    for (const [field, value] of [
      ['target.productTypeId', request.target.productTypeId],
      ['target.priceEvidenceRef', request.target.priceEvidenceRef]
    ] as const) {
      if (value !== null && (typeof value !== 'string'
        || value !== value.trim()
        || !ID_PATTERN.test(value))) {
        throw new SubscriptionRuntimeContractError('SUBSCRIPTION_SHADOW_QUOTE_ID_INVALID', { field });
      }
    }
  }

  private requireFresh(
    code: string,
    rawInstant: string | null,
    now: Date,
    maxStalenessSeconds: number,
    block: (code: string, message: string) => void
  ): void {
    const parsed = rawInstant ? new Date(rawInstant) : null;
    const ageMs = parsed ? now.getTime() - parsed.getTime() : Number.POSITIVE_INFINITY;
    if (!parsed || !Number.isFinite(parsed.getTime()) || ageMs < -60_000
      || ageMs > maxStalenessSeconds * 1000) {
      block(code, 'Подтверждающие данные устарели или имеют некорректное время');
    }
  }

  private blocker(code: string, message: string): SubscriptionShadowQuoteBlocker {
    return { code, message, details: null };
  }

  private blocked(
    subscriptionInstanceId: string,
    now: Date,
    blockers: SubscriptionShadowQuoteBlocker[],
    policyVersion: number | null = null,
    policyDigest: string | null = null,
    aggregateRevision: number | null = null
  ): SubscriptionShadowQuoteResult {
    return {
      quoteKind: 'SHADOW',
      nonBinding: true,
      requiresReservationRecheck: true,
      eligible: false,
      blockers,
      subscriptionInstanceId,
      policyVersion,
      policyDigest,
      aggregateRevision,
      evaluatedAt: now.toISOString(),
      usageUnits: null,
      activeServices: null,
      maxActiveServices: null,
      dailyUsed: null,
      dailyLimit: null,
      benefit: null,
      decision: null
    };
  }
}
