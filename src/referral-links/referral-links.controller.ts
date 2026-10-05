import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { AuthPersistenceService } from '../auth/auth-persistence.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { CreateReferralLinkDto } from './dto/create-referral-link.dto';
import { UpdateReferralLinkDto } from './dto/update-referral-link.dto';
import { ReferralLinksService } from './referral-links.service';
import {
  ReferralLinkAnalytics,
  ReferralLinkListResponse,
  ReferralLinkView
} from './referral-links.types';

@Controller('v1/admin/referral-links')
@Roles(...STAFF_ROLES)
export class ReferralLinksAdminController {
  constructor(
    private readonly service: ReferralLinksService,
    private readonly authPersistence: AuthPersistenceService
  ) {}

  @Get()
  @Permissions('subscriptions:analytics:read')
  @Header('Cache-Control', 'no-store')
  list(
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<ReferralLinkListResponse> {
    return this.service.list(from, to);
  }

  @Post()
  @Permissions('subscriptions:release:write')
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() dto: CreateReferralLinkDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<ReferralLinkView> {
    const result = await this.service.create(dto, { idempotencyKey }, user);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.item;
  }

  @Patch(':linkId')
  @Permissions('subscriptions:release:write')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('linkId') linkId: string,
    @Body() dto: UpdateReferralLinkDto,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ReferralLinkView> {
    return this.service.update(linkId, dto, user);
  }

  @Get(':linkId/analytics')
  @Permissions('subscriptions:analytics:read')
  @Header('Cache-Control', 'no-store')
  analytics(
    @Param('linkId') linkId: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<ReferralLinkAnalytics> {
    return this.service.analytics(linkId, from, to);
  }

  @Get(':linkId/export.csv')
  @Permissions('subscriptions:analytics:export')
  async exportCsv(
    @Param('linkId') linkId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Res() response: Response
  ): Promise<void> {
    const csv = await this.service.exportCsv(linkId, from, to);
    if (!this.authPersistence.isEnabled()) {
      throw new ServiceUnavailableException({
        code: 'REFERRAL_LINK_EXPORT_AUDIT_UNAVAILABLE',
        message: 'Выгрузка временно недоступна: журнал аудита не подключён.'
      });
    }
    await this.authPersistence.appendAudit({
      id: `audit-${randomUUID()}`,
      at: new Date().toISOString(),
      action: 'EXPORT REFERRAL_LINK_ANALYTICS',
      actor: user ? { id: user.id, login: user.login, title: user.title } : undefined,
      targetType: 'RESOURCE',
      targetId: linkId,
      metadata: { format: 'csv', pii: true }
    });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="referral-link-${linkId}.csv"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.send(csv);
  }
}

@Controller('referral-links')
export class ReferralLinksPublicController {
  constructor(private readonly service: ReferralLinksService) {}

  @Get('r/:publicToken')
  async redirect(
    @Param('publicToken') publicToken: string,
    @Headers('referer') referrer: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const cookieName = this.service.cookieName(publicToken);
    const existing = String(cookieHeader ?? '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))?.split('=').slice(1).join('=');
    const result = await this.service.resolveRedirect(publicToken, existing, referrer);
    response.cookie(result.cookieName, result.visitId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: result.cookieMaxAgeSeconds * 1000,
      path: `/api/referral-links/r/${publicToken}`
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(302, result.targetUrl);
  }
}
