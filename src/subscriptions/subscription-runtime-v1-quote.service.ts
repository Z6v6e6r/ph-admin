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

    const blockers = this.mapBlockers(shadow.blockers);
    const retryable = blockers.find((item) =>
      MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES[item.code].retryable
    );
    if (retryable) return this.retryLater(base, retryable.code);
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

  private mapBlockers(
    blockers: SubscriptionShadowQuoteBlocker[]
  ): Array<{ code: ManagedSubscriptionRuntimeReasonCode }> {
    const normalized = blockers.map((item): ManagedSubscriptionRuntimeReasonCode => {
      if (item.code in MANAGED_SUBSCRIPTION_RUNTIME_REASON_CODES) {
        return item.code as ManagedSubscriptionRuntimeReasonCode;
      }
      const code = item.code.toUpperCase();
      if (code.includes('DAILY')) return 'DAILY_LIMIT_REACHED';
      if (code.includes('WEEKLY')) return 'WEEKLY_LIMIT_REACHED';
      if (code.includes('MONTHLY')) return 'MONTHLY_LIMIT_REACHED';
      if (code.includes('ACTIVE_SERVICE')) return 'ACTIVE_SERVICES_LIMIT_REACHED';
      if (code.includes('STATION') && code.includes('AMBIGU')) return 'STATION_RULE_AMBIGUOUS';
      if (code.includes('STATION')) return 'STATION_NOT_ALLOWED';
      if (code.includes('DURATION')) return 'DURATION_NOT_ALLOWED';
      if (code.includes('PRODUCT')) return 'PRODUCT_NOT_INCLUDED';
      if (code.includes('EVENT')) return 'EVENT_NOT_INCLUDED';
      if (code.includes('PRICE')) return 'PRICE_UNAVAILABLE';
      if (code.includes('STALE') || code.includes('CURRENT')) return 'USAGE_SNAPSHOT_STALE';
      return 'BENEFIT_NOT_APPLICABLE';
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
