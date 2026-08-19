import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { LkIdentityService } from '../lk-identity/lk-identity.service';
import { SubscriptionShadowQuoteAdapterDto } from './dto/subscription-shadow-quote-adapter.dto';
import { SubscriptionShadowQuoteService } from './subscription-shadow-quote.service';
import { SubscriptionShadowQuoteResult } from './subscriptions.types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export const computeSubscriptionClientRefHash = (input: {
  pepper: string;
  tenantId: string;
  providerClientId: string;
}): string => createHmac('sha256', input.pepper)
  .update([
    'subscription-client-ref:v1',
    input.tenantId,
    'VIVA',
    input.providerClientId
  ].join('\0'))
  .digest('hex');

@Injectable()
export class SubscriptionTrustedShadowAdapterService {
  constructor(
    private readonly identity: LkIdentityService,
    private readonly shadowQuote: SubscriptionShadowQuoteService
  ) {}

  async quote(
    authorizationHeader: string | undefined,
    integrationToken: string | undefined,
    dto: SubscriptionShadowQuoteAdapterDto
  ): Promise<SubscriptionShadowQuoteResult> {
    this.assertEnabled();
    this.assertIntegrationToken(integrationToken);
    const tenantId = this.requireConfiguredId(
      'SUBSCRIPTIONS_RUNTIME_TENANT_ID',
      'SUBSCRIPTIONS_RUNTIME_TENANT_ID_INVALID'
    );
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

    const verifiedAt = this.now().toISOString();
    const clientRefHash = computeSubscriptionClientRefHash({
      pepper,
      tenantId,
      providerClientId
    });
    const identityEvidenceHash = createHmac('sha256', pepper)
      .update([
        'subscription-lk-identity-evidence:v1',
        tenantId,
        verified.actor.issuer,
        verified.actor.subject,
        verifiedAt
      ].join('\0'))
      .digest('hex');

    return this.shadowQuote.quote({
      identity: {
        resolutionSource: 'LK_IDENTITY',
        tenantId,
        clientRefHash,
        evidenceRef: `evidence:lk-identity:${identityEvidenceHash}`,
        verifiedAt
      },
      subscriptionInstanceId: dto.subscriptionInstanceId,
      action: dto.action,
      target: {
        resolutionSource: 'SERVER',
        targetId: dto.target.targetId,
        stationId: dto.target.stationId,
        category: dto.target.category,
        externalEventTypeId: dto.target.externalEventTypeId,
        productTypeId: dto.target.productTypeId,
        durationMinutes: dto.target.durationMinutes,
        startsAt: dto.target.startsAt,
        basePriceMinor: dto.target.basePriceMinor,
        currency: dto.target.currency,
        dictionaryRevision: dto.target.dictionaryRevision,
        evidenceRef: dto.target.evidenceRef,
        priceEvidenceRef: dto.target.priceEvidenceRef,
        resolvedAt: dto.target.resolvedAt
      }
    });
  }

  protected now(): Date {
    return new Date();
  }

  private assertEnabled(): void {
    if (!this.flag('SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_DISABLED',
        message: 'Trusted subscription shadow adapter is disabled'
      });
    }
  }

  private assertIntegrationToken(suppliedToken?: string): void {
    const expected = String(process.env.SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN ?? '').trim();
    if (Buffer.byteLength(expected, 'utf8') < 32) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_NOT_CONFIGURED',
        message: 'Trusted subscription shadow adapter is not configured'
      });
    }
    const supplied = String(suppliedToken ?? '').trim();
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length
      || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_FORBIDDEN',
        message: 'Trusted subscription shadow adapter access is forbidden'
      });
    }
  }

  private requireConfiguredId(name: string, code: string): string {
    const value = String(process.env[name] ?? '').trim();
    if (!ID_PATTERN.test(value)) {
      throw new ServiceUnavailableException({
        code,
        message: 'Subscription runtime tenant is not configured'
      });
    }
    return value;
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }
}
