import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { CreateQrLinkDto } from './dto/create-qr-link.dto';
import { UpdateQrLinkDto } from './dto/update-qr-link.dto';
import { renderQrPublicPage } from './qr-public-page';
import { QrLinksService } from './qr-links.service';
import {
  QrHistoryResponse,
  QrLinkAnalytics,
  QrLinkListResponse,
  QrLinkView,
  QrStationOption
} from './qr-links.types';

const DEFAULT_ADMIN_ORIGIN = 'https://padlhub.su';

function trustedAdminOrigins(): Set<string> {
  const raw = String(
    process.env.QR_LINKS_ADMIN_ORIGINS
      ?? process.env.QR_LINKS_PUBLIC_BASE_URL
      ?? DEFAULT_ADMIN_ORIGIN
  );
  const origins = new Set<string>();
  for (const item of raw.split(',')) {
    try {
      origins.add(new URL(item.trim()).origin.toLowerCase());
    } catch (_error) {
      // Ignore malformed extra entries; the default origin stays trusted.
    }
  }
  if (origins.size === 0) origins.add(DEFAULT_ADMIN_ORIGIN);
  if (String(process.env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}

@Controller('v1/admin/qr-links')
@Roles(...STAFF_ROLES)
export class QrLinksAdminController {
  private readonly allowedOrigins = trustedAdminOrigins();

  constructor(private readonly service: QrLinksService) {}

  @Get()
  @Permissions('qr:read')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: RequestUser | undefined,
    @Query('q') q?: string,
    @Query('stationId') stationId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
    @Query('direction') direction?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ): Promise<QrLinkListResponse> {
    return this.service.list(
      { q, stationId, status, from, to, sort, direction, page, pageSize },
      user
    );
  }

  @Get('stations')
  @Permissions('qr:read')
  @Header('Cache-Control', 'private, no-store')
  stations(
    @CurrentUser() user: RequestUser | undefined
  ): Promise<{ items: QrStationOption[] }> {
    return this.service.stationOptions(user);
  }

  @Post()
  @Permissions('qr:manage')
  @Header('Cache-Control', 'private, no-store')
  async create(
    @Body() dto: CreateQrLinkDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<QrLinkView> {
    this.assertTrustedCookieOrigin(request);
    const result = await this.service.create(dto, { idempotencyKey }, user);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.item;
  }

  @Get(':id')
  @Permissions('qr:read')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<QrLinkView> {
    return this.service.get(id, user);
  }

  @Patch(':id')
  @Permissions('qr:manage')
  @Header('Cache-Control', 'private, no-store')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQrLinkDto,
    @CurrentUser() user: RequestUser | undefined,
    @Req() request: Request
  ): Promise<QrLinkView> {
    this.assertTrustedCookieOrigin(request);
    return this.service.update(id, dto, user);
  }

  @Get(':id/stats')
  @Permissions('qr:read')
  @Header('Cache-Control', 'private, no-store')
  analytics(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<QrLinkAnalytics> {
    return this.service.analytics(id, { from, to }, user);
  }

  @Get(':id/history')
  @Permissions('qr:read')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<QrHistoryResponse> {
    return this.service.history(id, user);
  }

  @Get(':id/image')
  @Permissions('qr:read')
  async image(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser | undefined,
    @Query('format') format: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const payload = await this.service.image(id, format, user);
    response.setHeader('Content-Type', payload.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.send(payload.buffer);
  }

  private assertTrustedCookieOrigin(request: Request): void {
    if (request.headers.authorization) {
      return;
    }
    const origin = String(request.headers.origin ?? '').trim().toLowerCase();
    if (!origin) {
      return;
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new ForbiddenException({
        code: 'QR_LINKS_UNTRUSTED_ORIGIN',
        message: 'Источник запроса не доверен.'
      });
    }
  }
}

@Controller('q')
export class QrLinksPublicController {
  constructor(private readonly service: QrLinksService) {}

  @Get(':code')
  async open(
    @Param('code') code: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const resolution = await this.service.resolvePublic(code, {
        method: String(request.method ?? 'GET').toUpperCase(),
        userAgent: request.headers['user-agent'],
        headers: request.headers as Record<string, string | string[] | undefined>
      });
      if (resolution.kind === 'redirect') {
        response.redirect(302, resolution.location);
        return;
      }
      const kind =
        resolution.kind === 'paused'
          ? 'paused'
          : resolution.kind === 'archived'
            ? 'archived'
            : 'not_found';
      const status = kind === 'archived' ? 410 : kind === 'not_found' ? 404 : 200;
      response.status(status).type('html').send(renderQrPublicPage(kind));
    } catch (error) {
      response.status(503).type('html').send(renderQrPublicPage('unavailable'));
    }
  }
}
