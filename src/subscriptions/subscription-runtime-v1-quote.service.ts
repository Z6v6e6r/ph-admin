import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LkIdentityService } from '../lk-identity/lk-identity.service';
import { SubscriptionRuntimeV1QuoteDto } from './dto/subscription-runtime-v1-quote.dto';
import {
  ManagedSubscriptionRuntimeV1QuoteOutcome,
  ManagedSubscriptionRuntimeV1QuoteRequest,
  validateManagedSubscriptionRuntimeV1QuoteOutcome,
  validateManagedSubscriptionRuntimeV1QuoteRequest
} from './subscription-runtime-contracts';
import {
  MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES,
  ManagedSubscriptionRuntimeReasonCode
} from './subscription-runtime-reason-codes';
import { SubscriptionTrustedShadowAdapterService } from './subscription-trusted-shadow-adapter.service';
import { SubscriptionShadowQuoteBlocker } from './subscriptions.types';

const HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const INTEGRATION_TOKEN_PATTERN = /^[!-~]{32,4096}$/;
const CONTRACT_VERSION = '1';
const SHADOW_ACTIONS = new Set([
  'CREATE_GAME',
  'JOIN_GAME',
  'BOOK_GROUP_TRAINING',
  'BOOK_TOURNAMENT',
  'PURCHASE_ADD_ON_PRODUCT'
]);
const FULL_PRICE_ALLOWED_REASON_CODES = new Set<ManagedSubscriptionRuntimeReasonCode>([
  'SUBSCRIPTION_NOT_FOUND',
  'SUBSCRIPTION_SELECTION_REQUIRED',
  'SUBSCRIPTION_NOT_OWNED_BY_ACTOR',
  'SUBSCRIPTION_TYPE_MISMATCH',
  'SUBSCRIPTION_PENDING_ACTIVATION',
  'SUBSCRIPTION_INACTIVE',
  'SUBSCRIPTION_FROZEN',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_REFUNDED',
  'SUBSCRIPTION_REVOKED',
  'POLICY_NOT_PUBLISHED',
  'POLICY_NOT_EFFECTIVE',
  'POLICY_ACTION_DISABLED',
  'EVENT_NOT_INCLUDED',
  'PRODUCT_NOT_INCLUDED',
  'DURATION_NOT_ALLOWED',
  'STATION_NOT_ALLOWED',
  'BOOKING_WINDOW_EXCEEDED',
  'BLACKOUT_DATE',
  'ACTIVE_SERVICES_LIMIT_REACHED',
  'DAILY_LIMIT_REACHED',
  'WEEKLY_LIMIT_REACHED',
  'MONTHLY_LIMIT_REACHED',
  'FUTURE_BOOKINGS_LIMIT_REACHED',
  'MIN_INTERVAL_NOT_MET',
  'UNITS_EXHAUSTED',
  'BENEFIT_NOT_APPLICABLE',
  'DISCOUNT_DISABLED'
]);
const SHADOW_BLOCKER_REASON_CODES: Readonly<Record<string, ManagedSubscriptionRuntimeReasonCode>> = {
  SUBSCRIPTION_OWNERSHIP_NOT_CONFIRMED: 'SUBSCRIPTION_NOT_OWNED_BY_ACTOR',
  PROVIDER_MAPPING_NOT_FOUND: 'POLICY_MAPPING_UNVERIFIED',
  PROVIDER_MAPPING_NOT_VERIFIED: 'POLICY_MAPPING_UNVERIFIED',
  PROVIDER_MAPPING_LINK_MISMATCH: 'POLICY_MAPPING_UNVERIFIED',
  PROVIDER_MAPPING_SCOPE_MISMATCH: 'POLICY_MAPPING_UNVERIFIED',
  CANONICAL_STUDIO_MAPPING_UNAVAILABLE: 'POLICY_MAPPING_UNVERIFIED',
  PROVIDER_MAPPING_STALE: 'POLICY_MAPPING_UNVERIFIED',
  POLICY_PUBLICATION_NOT_FOUND: 'POLICY_UNAVAILABLE',
  ENTITLEMENT_AGGREGATE_NOT_FOUND: 'USAGE_SNAPSHOT_STALE',
  POLICY_DISABLED_FOR_NEW_OPERATIONS: 'POLICY_ACTION_DISABLED',
  POLICY_INSTANCE_LINK_MISMATCH: 'POLICY_DIGEST_MISMATCH',
  DICTIONARY_REVISION_MISMATCH: 'TARGET_REVISION_MISMATCH',
  ENTITLEMENT_AGGREGATE_LINK_MISMATCH: 'USAGE_SNAPSHOT_INVALID',
  ENTITLEMENT_AGGREGATE_NOT_CURRENT: 'USAGE_SNAPSHOT_STALE',
  ENTITLEMENT_AGGREGATE_STALE: 'USAGE_SNAPSHOT_STALE',
  SUBSCRIPTION_INSTANCE_NOT_CURRENT: 'SUBSCRIPTION_INSTANCE_STALE',
  LK_IDENTITY_STALE: 'PROVIDER_IDENTITY_UNAVAILABLE',
  TARGET_RESOLUTION_STALE: 'TARGET_STALE',
  BASE_PRICE_UNRESOLVED: 'PRICE_UNAVAILABLE',
  BASE_PRICE_EVIDENCE_REQUIRED: 'PRICE_UNAVAILABLE',
  SHADOW_QUOTE_TIME_INVALID: 'SERVICE_UNAVAILABLE',
  POLICY_SCHEMA_UNSUPPORTED: 'POLICY_UNAVAILABLE',
  SUBSCRIPTION_VALIDITY_INVALID: 'SUBSCRIPTION_INSTANCE_STALE',
  SUBSCRIPTION_NOT_ACTIVE: 'SUBSCRIPTION_INACTIVE',
  POLICY_EFFECTIVE_AT_INVALID: 'POLICY_STALE',
  TARGET_CATEGORY_MISMATCH: 'SERVICE_UNAVAILABLE',
  TARGET_IDENTITY_INVALID: 'SERVICE_UNAVAILABLE',
  TARGET_PRODUCT_TYPE_REQUIRED: 'SERVICE_UNAVAILABLE',
  TARGET_SCHEDULE_INVALID: 'SERVICE_UNAVAILABLE',
  TARGET_ALREADY_STARTED: 'SERVICE_UNAVAILABLE',
  TARGET_AFTER_SUBSCRIPTION_EXPIRY: 'BENEFIT_NOT_APPLICABLE',
  SUBSCRIPTION_CREATE_DISABLED: 'POLICY_ACTION_DISABLED',
  SUBSCRIPTION_JOIN_DISABLED: 'POLICY_ACTION_DISABLED',
  TARGET_LOCAL_DATE_UNRESOLVED: 'TARGET_STALE',
  BOOKING_WINDOW_UNRESOLVED: 'POLICY_UNAVAILABLE',
  SUBSCRIPTION_BLACKOUT_DATE: 'BLACKOUT_DATE',
  AUTHORITATIVE_ALL_BOOKINGS_COUNT_UNAVAILABLE: 'ACTIVE_SERVICES_LIMIT_UNAVAILABLE',
  ACTIVE_SERVICE_SCOPE_MISMATCH: 'USAGE_SNAPSHOT_INVALID',
  ACTIVE_SERVICES_LIMIT_INVALID: 'ACTIVE_SERVICES_LIMIT_UNAVAILABLE',
  USAGE_UNITS_UNRESOLVED: 'POLICY_UNAVAILABLE',
  DAILY_USAGE_LIMIT_INVALID: 'USAGE_SNAPSHOT_INVALID',
  DAILY_USAGE_LIMIT_REACHED: 'DAILY_LIMIT_REACHED',
  WEEKLY_USAGE_LIMIT_INVALID: 'USAGE_SNAPSHOT_INVALID',
  WEEKLY_USAGE_LIMIT_REACHED: 'WEEKLY_LIMIT_REACHED',
  MONTHLY_USAGE_LIMIT_INVALID: 'USAGE_SNAPSHOT_INVALID',
  MONTHLY_USAGE_LIMIT_REACHED: 'MONTHLY_LIMIT_REACHED',
  USAGE_COUNTER_OVERFLOW: 'USAGE_SNAPSHOT_INVALID',
  ENTITLEMENT_UNITS_INSUFFICIENT: 'UNITS_EXHAUSTED',
  LAST_USAGE_EVIDENCE_UNAVAILABLE: 'USAGE_SNAPSHOT_STALE',
  AMBIGUOUS_STATION_RULE: 'STATION_RULE_AMBIGUOUS',
  AMBIGUOUS_BENEFIT_RULE: 'POLICY_UNAVAILABLE',
  BASE_PRICE_INVALID: 'PRICE_CALCULATION_INVALID',
  STATION_SURCHARGE_INVALID: 'PRICE_CALCULATION_INVALID',
  BENEFIT_VALUE_INVALID: 'PRICE_CALCULATION_INVALID',
  PRICE_CALCULATION_OVERFLOW: 'PRICE_CALCULATION_INVALID'
};

type QuoteBase = Pick<
  ManagedSubscriptionRuntimeV1QuoteOutcome,
  | 'contractVersion'
  | 'nonBinding'
  | 'requiresReservationRecheck'
  | 'paymentIntent'
  | 'decisionId'
  | 'limits'
  | 'warnings'
  | 'evaluatedAt'
  | 'expiresAt'
>;

@Injectable()
export class SubscriptionRuntimeV1QuoteService {
  constructor(
    private readonly adapter: SubscriptionTrustedShadowAdapterService,
    private readonly identity: LkIdentityService
  ) {}

  async quote(
    authorization: string | undefined,
    integrationToken: string | undefined,
    dto: SubscriptionRuntimeV1QuoteDto,
    correlationId: string | undefined,
    idempotencyKey: string | undefined,
    contractVersion: string | undefined
  ): Promise<ManagedSubscriptionRuntimeV1QuoteOutcome> {
    const request = {
      ...dto,
      target: { ...dto.target }
    } as ManagedSubscriptionRuntimeV1QuoteRequest;
    validateManagedSubscriptionRuntimeV1QuoteRequest(request);
    this.assertEnabledMode();
    this.assertCommandHeaders(correlationId, idempotencyKey, contractVersion);
    await this.assertAccess(authorization, integrationToken);

    const base = this.base(
      request,
      correlationId as string,
      idempotencyKey as string,
      this.now()
    );
    if (!request.preferredSubscriptionInstanceId) {
      return this.retryLater(base, 'PROVIDER_IDENTITY_UNAVAILABLE');
    }
    if (!SHADOW_ACTIONS.has(request.action) || request.target.expectedRevision === undefined) {
      return this.retryLater(base, 'TARGET_NOT_SERVER_RESOLVED');
    }

    const shadow = await this.adapter.quote(authorization, integrationToken, {
      subscriptionInstanceId: request.preferredSubscriptionInstanceId,
      action: request.action as 'CREATE_GAME',
      target: {
        targetId: request.target.id,
        snapshotRevision: request.target.expectedRevision
      }
    });
    const basePriceMinor = shadow.benefit?.basePriceMinor;
    if (basePriceMinor === null || basePriceMinor === undefined) {
      return this.retryLater(base, 'PRICE_UNAVAILABLE');
    }
    const fullPrice = {
      priceRevision: request.target.expectedRevision,
      basePriceMinor,
      discountMinor: 0,
      surchargeMinor: 0,
      finalPriceMinor: basePriceMinor,
      currency: 'RUB' as const
    };
    const blockers = this.mapBlockers(shadow.blockers);
    const retryable = blockers.find((item) =>
      MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES[item.code].retryable
    );
    if (retryable) return this.retryLater(base, retryable.code);
    const serviceBlocker = blockers.find((item) => !FULL_PRICE_ALLOWED_REASON_CODES.has(item.code));
    if (serviceBlocker) return this.serviceBlocked(base, serviceBlocker.code);
    if (request.paymentIntent === 'PAY_FULL_PRICE') {
      return this.valid({
        ...base,
        outcome: 'FULL_PRICE_ONLY',
        serviceAllowed: true,
        subscriptionBenefitAllowed: false,
        selectedSubscription: null,
        benefit: null,
        price: fullPrice,
        blockers: [],
        alternatives: []
      });
    }

    if (shadow.eligible
      && shadow.benefit
      && shadow.policyVersion
      && shadow.policyDigest
      && shadow.usageUnits) {
      const finalPriceMinor = shadow.benefit.finalPriceMinor;
      if (finalPriceMinor === null) return this.retryLater(base, 'PRICE_CALCULATION_INVALID');
      return this.valid({
        ...base,
        outcome: 'ENTITLEMENT_APPLIED',
        serviceAllowed: true,
        subscriptionBenefitAllowed: true,
        selectedSubscription: {
          subscriptionInstanceId: request.preferredSubscriptionInstanceId,
          policyVersion: shadow.policyVersion,
          policyDigest: shadow.policyDigest
        },
        benefit: {
          kind: shadow.benefit.kind,
          ruleId: shadow.benefit.ruleId,
          usageUnits: shadow.usageUnits
        },
        price: {
          priceRevision: request.target.expectedRevision,
          basePriceMinor,
          discountMinor: shadow.benefit.discountMinor,
          surchargeMinor: shadow.benefit.surchargeMinor,
          finalPriceMinor,
          currency: 'RUB'
        },
        limits: {
          ...base.limits,
          activeServices: shadow.activeServices,
          activeServicesLimit: shadow.maxActiveServices,
          dailyUsed: shadow.dailyUsed,
          dailyLimit: shadow.dailyLimit
        },
        blockers: [],
        alternatives: []
      });
    }

    return this.valid({
      ...base,
      outcome: 'FULL_PRICE_ONLY',
      serviceAllowed: true,
      subscriptionBenefitAllowed: false,
      selectedSubscription: null,
      benefit: null,
      price: fullPrice,
      blockers: blockers.length ? blockers : [{ code: 'BENEFIT_NOT_APPLICABLE' }],
      alternatives: [{
        paymentIntent: 'PAY_FULL_PRICE',
        requiresExplicitUserConfirmation: true
      }]
    });
  }

  protected now(): Date {
    return new Date();
  }

  private base(
    request: ManagedSubscriptionRuntimeV1QuoteRequest,
    correlationId: string,
    idempotencyKey: string,
    evaluatedAt: Date
  ): QuoteBase {
    const fingerprint = JSON.stringify({ request, correlationId, idempotencyKey });
    return {
      contractVersion: 1,
      nonBinding: true,
      requiresReservationRecheck: true,
      paymentIntent: request.paymentIntent,
      decisionId: `decision:${createHash('sha256').update(fingerprint).digest('hex')}`,
      limits: {
        activeServices: null,
        activeServicesLimit: null,
        dailyUsed: null,
        dailyLimit: null,
        weeklyUsed: null,
        weeklyLimit: null,
        monthlyUsed: null,
        monthlyLimit: null,
        remainingUnits: null
      },
      warnings: [],
      evaluatedAt: evaluatedAt.toISOString(),
      expiresAt: new Date(evaluatedAt.getTime() + this.ttlSeconds() * 1000).toISOString()
    };
  }

  private retryLater(
    base: QuoteBase,
    code: ManagedSubscriptionRuntimeReasonCode
  ): ManagedSubscriptionRuntimeV1QuoteOutcome {
    if (!MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES[code].retryable) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_REASON_MAPPING_INVALID',
        message: 'Managed subscription runtime reason mapping is invalid'
      });
    }
    return this.valid({
      ...base,
      outcome: 'RETRY_LATER',
      serviceAllowed: false,
      subscriptionBenefitAllowed: false,
      selectedSubscription: null,
      benefit: null,
      price: null,
      blockers: [{ code }],
      alternatives: []
    });
  }

  private serviceBlocked(
    base: QuoteBase,
    code: ManagedSubscriptionRuntimeReasonCode
  ): ManagedSubscriptionRuntimeV1QuoteOutcome {
    return this.valid({
      ...base,
      outcome: 'SERVICE_BLOCKED',
      serviceAllowed: false,
      subscriptionBenefitAllowed: false,
      selectedSubscription: null,
      benefit: null,
      price: null,
      blockers: [{ code }],
      alternatives: []
    });
  }

  private mapBlockers(
    blockers: SubscriptionShadowQuoteBlocker[]
  ): Array<{ code: ManagedSubscriptionRuntimeReasonCode }> {
    const normalized = blockers.map((item): ManagedSubscriptionRuntimeReasonCode => {
      if (item.code in MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES) {
        return item.code as ManagedSubscriptionRuntimeReasonCode;
      }
      const code = item.code.toUpperCase();
      const exact = SHADOW_BLOCKER_REASON_CODES[code];
      return exact ?? 'SERVICE_UNAVAILABLE';
    });
    return [...new Set(normalized)].map((code) => ({ code }));
  }

  private valid(value: ManagedSubscriptionRuntimeV1QuoteOutcome): ManagedSubscriptionRuntimeV1QuoteOutcome {
    validateManagedSubscriptionRuntimeV1QuoteOutcome(value);
    return value;
  }

  private assertEnabledMode(): void {
    if (!this.flag('SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_QUOTE_DISABLED',
        message: 'Managed subscription runtime quote is disabled'
      });
    }
    const mode = String(process.env.SUBSCRIPTIONS_RUNTIME_V1_MODE ?? 'OFF').trim().toUpperCase();
    if (mode !== 'SHADOW' && mode !== 'WARN') {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_MODE_DISABLED',
        message: 'Managed subscription runtime quote mode is disabled'
      });
    }
  }

  private assertCommandHeaders(
    correlationId: string | undefined,
    idempotencyKey: string | undefined,
    contractVersion: string | undefined
  ): void {
    if (!HEADER_PATTERN.test(String(correlationId ?? ''))
      || !HEADER_PATTERN.test(String(idempotencyKey ?? ''))
      || contractVersion !== CONTRACT_VERSION) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_HEADERS_INVALID',
        message: 'Managed subscription runtime request headers are invalid'
      });
    }
  }

  private async assertAccess(
    authorization: string | undefined,
    suppliedToken: string | undefined
  ): Promise<void> {
    const expected = String(process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN ?? '').trim();
    if (!INTEGRATION_TOKEN_PATTERN.test(expected)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_INTEGRATION_NOT_CONFIGURED',
        message: 'Managed subscription runtime integration is not configured'
      });
    }
    const supplied = String(suppliedToken ?? '').trim();
    if (!INTEGRATION_TOKEN_PATTERN.test(supplied)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_INTEGRATION_FORBIDDEN',
        message: 'Managed subscription runtime integration is forbidden'
      });
    }
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_INTEGRATION_FORBIDDEN',
        message: 'Managed subscription runtime integration is forbidden'
      });
    }
    const verified = await this.identity.verifyTrustedBearer(authorization);
    const tenantId = String(process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID ?? '').trim();
    if (!ID_PATTERN.test(tenantId) || verified.actor.tenantKey !== tenantId) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_TENANT_MISMATCH',
        message: 'Managed subscription runtime tenant does not match verified identity'
      });
    }
  }

  private ttlSeconds(): number {
    const value = Number(process.env.SUBSCRIPTIONS_RUNTIME_V1_QUOTE_TTL_SECONDS);
    if (!Number.isSafeInteger(value) || value < 30 || value > 300) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_RUNTIME_V1_QUOTE_TTL_INVALID',
        message: 'Managed subscription runtime quote TTL is not configured'
      });
    }
    return value;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }
}
