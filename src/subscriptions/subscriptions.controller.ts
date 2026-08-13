import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseFilters
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { CreatePolicyVersionDto } from './dto/create-policy-version.dto';
import { CreateReleaseProgramDto } from './dto/create-release-program.dto';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsExceptionFilter } from './subscriptions-exception.filter';
import {
  ReleaseProgram,
  ReleaseProgramPage,
  SubscriptionPolicyVersion,
  SubscriptionType,
  SubscriptionTypePage
} from './subscriptions.types';

@Controller('v1/admin')
@Roles(...STAFF_ROLES)
@UseFilters(SubscriptionsExceptionFilter)
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

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

  private applyCommandHeaders(response: Response, correlationId: string, replayed: boolean): void {
    response.setHeader('X-Correlation-Id', correlationId);
    if (replayed) response.setHeader('Idempotency-Replayed', 'true');
  }
}
