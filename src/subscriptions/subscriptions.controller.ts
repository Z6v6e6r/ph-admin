import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseFilters
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { CreateReleaseProgramDto } from './dto/create-release-program.dto';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { SubscriptionProviderMappingPreviewDto } from './dto/subscription-provider-mapping-preview.dto';
import { SubscriptionShadowQuoteAdapterDto } from './dto/subscription-shadow-quote-adapter.dto';
import { SubscriptionRuntimeContextDto } from './dto/subscription-runtime-context.dto';
import { ActivateSubscriptionTestOfferDto } from './dto/activate-subscription-test-offer.dto';
import { ActivateSubscriptionFirstUseDto } from './dto/activate-subscription-first-use.dto';
import { CreateSubscriptionTestReservationDto } from './dto/create-subscription-test-reservation.dto';
import { FakeConfirmSubscriptionTestPurchaseDto } from './dto/fake-confirm-subscription-test-purchase.dto';
import { SubscriptionImpactPreviewDto } from './dto/subscription-impact-preview.dto';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionProviderMappingPreviewService } from './subscription-provider-mapping-preview.service';
import { SubscriptionTrustedShadowAdapterService } from './subscription-trusted-shadow-adapter.service';
import {
  SubscriptionActivationResult,
  SubscriptionActivationService
} from './subscription-activation.service';
import {
  SubscriptionRuntimeContextResult,
  SubscriptionRuntimeContextService
} from './subscription-runtime-context.service';
import { SubscriptionsTestRuntimeService } from './subscriptions-test-runtime.service';
import { SubscriptionsExceptionFilter } from './subscriptions-exception.filter';
import {
  ReleaseProgram,
  ReleaseProgramPage,
  SubscriptionPolicyImpactPreview,
  SubscriptionProviderMappingPreview,
  SubscriptionShadowQuoteResult,
  SubscriptionPolicyVersion,
  SubscriptionTestActivationResult,
  SubscriptionTestInventorySnapshot,
  SubscriptionTestOfferView,
  SubscriptionTestPurchaseView,
  SubscriptionTestReservationResult,
  SubscriptionType,
  SubscriptionTypePage
} from './subscriptions.types';

@Controller('v1/admin')
@Roles(...STAFF_ROLES)
@UseFilters(SubscriptionsExceptionFilter)
export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly testRuntime: SubscriptionsTestRuntimeService,
    private readonly providerMappingPreview: SubscriptionProviderMappingPreviewService
  ) {}

  @Get('subscription-types')
  @Permissions('subscriptions:read')
  listTypes(
    @Query('stationId') stationId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionTypePage> {
    return this.service.listTypes(stationId, cursor, user);
  }

  @Post('subscription-types')
  @Permissions('subscriptions:catalog:write')
  async createType(
    @Body() dto: CreateSubscriptionTypeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<SubscriptionType> {
    const result = await this.service.createType(dto, { idempotencyKey, correlationId }, user);
    this.applyCommandHeaders(response, result.correlationId, result.replayed);
    return result.item;
  }

  @Post('subscription-types/:subscriptionTypeId/policy-versions')
  @Permissions('subscriptions:catalog:write')
  async createPolicyVersion(
    @Param('subscriptionTypeId') subscriptionTypeId: string,
    @Body() dto: CreatePolicyVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<SubscriptionPolicyVersion> {
    const result = await this.service.createPolicyVersion(
      subscriptionTypeId,
      dto,
      { idempotencyKey, correlationId },
      user
    );
    this.applyCommandHeaders(response, result.correlationId, result.replayed);
    return result.item;
  }

  @Get('subscription-types/:subscriptionTypeId/policy-versions')
  @Permissions('subscriptions:read')
  listPolicyVersions(
    @Param('subscriptionTypeId') subscriptionTypeId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionPolicyVersion[]> {
    return this.service.listPolicyVersions(subscriptionTypeId, user);
  }

  @Post('subscription-types/:subscriptionTypeId/policy-versions/:version/provider-mapping-preview')
  @Permissions('subscriptions:catalog:write')
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  previewProviderMapping(
    @Param('subscriptionTypeId') subscriptionTypeId: string,
    @Param('version') version: string,
    @Body() dto: SubscriptionProviderMappingPreviewDto,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionProviderMappingPreview> {
    return this.providerMappingPreview.preview(subscriptionTypeId, version, dto, user);
  }

  @Post('subscription-types/:subscriptionTypeId/policy-versions/:version/impact-preview')
  @Permissions('subscriptions:read')
  impactPreview(
    @Param('subscriptionTypeId') subscriptionTypeId: string,
    @Param('version') version: string,
    @Body() _dto: SubscriptionImpactPreviewDto,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionPolicyImpactPreview> {
    return this.testRuntime.impactPreview(
      subscriptionTypeId,
      Number(version),
      _dto.releaseProgramId,
      user
    );
  }

  @Get('subscription-release-programs')
  @Permissions('subscriptions:read')
  listReleasePrograms(
    @Query('stationId') stationId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<ReleaseProgramPage> {
    return this.service.listReleasePrograms(stationId, cursor, user);
  }

  @Post('subscription-release-programs')
  @Permissions('subscriptions:release:write')
  async createReleaseProgram(
    @Body() dto: CreateReleaseProgramDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<ReleaseProgram> {
    const result = await this.service.createReleaseProgram(
      dto,
      { idempotencyKey, correlationId },
      user
    );
    this.applyCommandHeaders(response, result.correlationId, result.replayed);
    return result.item;
  }

  @Post('subscription-release-programs/:releaseProgramId/test-activate')
  @Permissions('subscriptions:release:write')
  @Header('Cache-Control', 'no-store')
  async activateTestOffer(
    @Param('releaseProgramId') releaseProgramId: string,
    @Body() dto: ActivateSubscriptionTestOfferDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<SubscriptionTestActivationResult> {
    const result = await this.testRuntime.activateTestOffer(
      releaseProgramId,
      dto,
      { idempotencyKey, correlationId },
      user
    );
    this.applyCommandHeaders(response, result.correlationId, result.replayed);
    return result;
  }

  @Get('subscription-test-offers/:offerId/inventory')
  @Permissions('subscriptions:read')
  testOfferInventory(
    @Param('offerId') offerId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionTestInventorySnapshot> {
    return this.testRuntime.adminInventory(offerId, user);
  }

  @Get('subscription-release-programs/:releaseProgramId/test-inventory')
  @Permissions('subscriptions:read')
  testInventoryByReleaseProgram(
    @Param('releaseProgramId') releaseProgramId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<SubscriptionTestInventorySnapshot> {
    return this.testRuntime.adminInventoryByReleaseProgram(releaseProgramId, user);
  }

  private applyCommandHeaders(response: Response, correlationId: string, replayed: boolean): void {
    response.setHeader('X-Correlation-Id', correlationId);
    if (replayed) response.setHeader('Idempotency-Replayed', 'true');
  }
}

@Controller('internal/subscriptions')
@Roles()
@UseFilters(SubscriptionsExceptionFilter)
export class SubscriptionTrustedShadowController {
  constructor(
    private readonly adapter: SubscriptionTrustedShadowAdapterService,
    private readonly runtimeContext: SubscriptionRuntimeContextService,
    private readonly activation: SubscriptionActivationService
  ) {}

  @Post('shadow-quote')
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  quote(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-subscriptions-integration-token') integrationToken: string | undefined,
    @Body() dto: SubscriptionShadowQuoteAdapterDto
  ): Promise<SubscriptionShadowQuoteResult> {
    return this.adapter.quote(authorization, integrationToken, dto);
  }

  @Post('runtime-context')
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  context(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-subscriptions-integration-token') integrationToken: string | undefined,
    @Body() dto: SubscriptionRuntimeContextDto
  ): Promise<SubscriptionRuntimeContextResult> {
    return this.runtimeContext.resolve(authorization, integrationToken, dto);
  }

  @Post('activate-first-use')
  @SkipAdminMutationAudit()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  activateFirstUse(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-subscriptions-integration-token') integrationToken: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() dto: ActivateSubscriptionFirstUseDto
  ): Promise<SubscriptionActivationResult> {
    return this.activation.activateFirstUse(
      authorization,
      integrationToken,
      dto,
      { correlationId }
    );
  }
}

@Controller('v1/subscription-test')
@Roles()
@UseFilters(SubscriptionsExceptionFilter)
export class SubscriptionTestController {
  constructor(private readonly testRuntime: SubscriptionsTestRuntimeService) {}

  @Get('offers/:offerId')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  offer(
    @Param('offerId') offerId: string,
    @Headers('x-subscription-test-token') accessToken: string | undefined
  ): Promise<SubscriptionTestOfferView> {
    return this.testRuntime.offerByCredentials(offerId, accessToken ?? '');
  }

  @Post('offers/:offerId/reservations')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  reserve(
    @Param('offerId') offerId: string,
    @Headers('x-subscription-test-token') accessToken: string | undefined,
    @Body() dto: CreateSubscriptionTestReservationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined
  ): Promise<SubscriptionTestReservationResult> {
    return this.testRuntime.reserve(offerId, accessToken ?? '', dto, { idempotencyKey, correlationId });
  }

  @Post('purchases/:purchaseId/fake-confirm')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  fakeConfirm(
    @Param('purchaseId') purchaseId: string,
    @Headers('x-subscription-test-token') accessToken: string | undefined,
    @Body() dto: FakeConfirmSubscriptionTestPurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined
  ): Promise<SubscriptionTestPurchaseView> {
    return this.testRuntime.fakeConfirm(
      purchaseId,
      accessToken ?? '',
      dto,
      { idempotencyKey, correlationId }
    );
  }

  @Get('purchases/:purchaseId')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  purchase(
    @Param('purchaseId') purchaseId: string,
    @Headers('x-subscription-test-token') accessToken: string | undefined
  ): Promise<SubscriptionTestPurchaseView> {
    return this.testRuntime.getPurchase(purchaseId, accessToken ?? '');
  }
}
