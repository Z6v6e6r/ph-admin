import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { SubscriptionProviderMappingPreviewDto } from './dto/subscription-provider-mapping-preview.dto';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionProviderMappingPreview } from './subscriptions.types';

@Injectable()
export class SubscriptionProviderMappingPreviewService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly vivaAdmin: VivaAdminService
  ) {}

  async preview(
    subscriptionTypeId: string,
    rawVersion: string,
    dto: SubscriptionProviderMappingPreviewDto,
    user?: RequestUser
  ): Promise<SubscriptionProviderMappingPreview> {
    this.assertEnabled();
    const normalizedTypeId = String(subscriptionTypeId ?? '').trim();
    const normalizedVersion = String(rawVersion ?? '').trim();
    const version = Number(normalizedVersion);
    if (!normalizedTypeId
      || !/^[1-9]\d{0,9}$/.test(normalizedVersion)
      || !Number.isSafeInteger(version)) {
      throw new NotFoundException('Subscription policy version not found');
    }
    const stationScope = getStationScopeForPermission(user, 'subscriptions:catalog:write');
    if (stationScope !== null && !stationScope.includes(dto.canonicalStationId)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_STATION_FORBIDDEN',
        message: 'Station is outside the subscription catalog scope'
      });
    }
    const previewClientId = this.previewClientId();

    await this.repository.connectReadOnly();
    const policy = await this.repository.policyVersionByNumber(normalizedTypeId, version);
    if (!policy) throw new NotFoundException('Subscription policy version not found');
    if (policy.status !== 'DRAFT') {
      throw new BadRequestException({
        code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_DRAFT_REQUIRED',
        message: 'Viva product evidence preview is available only for a draft policy'
      });
    }
    const binding = policy.providerBinding;
    if (!binding
      || binding.provider !== 'VIVA'
      || binding.referenceKind !== 'PRODUCT_CANDIDATE'
      || binding.evidenceState !== 'UNVERIFIED'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(binding.externalId)) {
      throw new BadRequestException({
        code: 'SUBSCRIPTIONS_PROVIDER_BINDING_CANDIDATE_REQUIRED',
        message: 'Policy must contain one unverified Viva product candidate'
      });
    }

    const product = await this.vivaAdmin.inspectSubscriptionProduct({
      productId: binding.externalId,
      clientId: previewClientId,
      studioId: dto.providerStudioId
    });
    if (product.providerProductId !== binding.externalId) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PROVIDER_EVIDENCE_MISMATCH',
        message: 'Viva product evidence does not match the policy candidate'
      });
    }
    return {
      subscriptionTypeId: policy.subscriptionTypeId,
      policyVersion: policy.version,
      policyStatus: policy.status,
      canonicalStationId: dto.canonicalStationId,
      providerStudioId: dto.providerStudioId,
      providerBinding: binding,
      evidenceState: 'EVIDENCE_ONLY',
      persisted: false,
      verified: false,
      product,
      blockers: [
        {
          code: 'RUNTIME_MAPPING_NOT_PERSISTED',
          message: 'Evidence preview does not create a runtime provider mapping'
        },
        {
          code: 'CANONICAL_STUDIO_STATION_MAPPING_UNVERIFIED',
          message: 'Viva studio and canonical station mapping is not verified'
        },
        {
          code: 'POLICY_NOT_PUBLISHED',
          message: 'A draft policy cannot be used by the subscription runtime'
        }
      ]
    };
  }

  private assertEnabled(): void {
    const adminEnabled = this.flag('SUBSCRIPTIONS_ADMIN_ENABLED');
    const previewEnabled = this.flag('SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED');
    if (!adminEnabled || !previewEnabled) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_DISABLED',
        message: 'Viva subscription product preview is disabled'
      });
    }
  }

  private flag(name: string): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
  }

  private previewClientId(): string {
    const value = String(
      process.env.SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID ?? ''
    ).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(value)) {
      throw new ServiceUnavailableException({
        code: 'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_NOT_CONFIGURED',
        message: 'Synthetic Viva client context is not configured'
      });
    }
    return value;
  }
}
