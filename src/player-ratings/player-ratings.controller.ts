import { AssignPlayerRatingDto } from './dto/assign-player-rating.dto';
import { VivaAdminService } from '../integrations/viva/viva-admin.service';
import { Permissions } from '../common/rbac/permissions.decorator';
import { BadRequestException, ForbiddenException, Header, NotFoundException, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { exportPlayerRatingAudit } from './player-rating-audit-export';
import { PlayerRatingAuditQuery } from './player-ratings.types';
import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { ChangePlayerRatingDto } from './dto/change-player-rating.dto';
import { PlayerRatingsService, ratingJournalScope, requireRatingPermission } from './player-ratings.service';
import { PlayerRatingChangeResult, PlayerRatingEventDto, PlayerRatingEventsResult, PlayerRatingProjectionStatus, PlayerRatingSearchResult, PlayerRatingStateDto } from './player-ratings.types';

@Controller('admin/player-ratings')
@Roles(...STAFF_ROLES)
export class PlayerRatingsController {
  constructor(private readonly service: PlayerRatingsService, private readonly viva: VivaAdminService) {}
  @Get('assignment-candidates') @Permissions('player-ratings:write') @Header('Cache-Control', 'private, no-store')
  async candidates(@Req() request: Request, @Query('q') q?: string, @CurrentUser() user?: RequestUser) {
    this.requireTrustedOrigin(request);
    requireRatingPermission(user, 'player-ratings:write');
    const rows = await this.viva.searchClients(q);
    return { items: rows.slice(0, 20).map(row => ({ clientId: row.clientId, name: row.clientLabel || row.clientId })) };
  }
  @Post('assignments') @Permissions('player-ratings:write') @SkipAdminMutationAudit()
  async assign(@Req() request: Request, @Body() dto: AssignPlayerRatingDto, @CurrentUser() user?: RequestUser) {
    this.requireTrustedOrigin(request);
    requireRatingPermission(user, 'player-ratings:write');
    const identity = await this.viva.getClientProfile(dto.clientId, true);
    if (!identity || identity.clientId !== dto.clientId) throw new NotFoundException('Клиент не найден');
    return this.service.assign(dto, identity, user);
  }
  @Get('journal')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('audit:read', 'player-ratings:read')
  journal(@Req() request: Request, @Query() query: PlayerRatingAuditQuery, @CurrentUser() user?: RequestUser) {
    this.requireTrustedOrigin(request);
    return this.service.audit(query, { stationScope: ratingJournalScope(user) });
  }

  @Get(['journal.csv', 'journal.xlsx'])
  @Permissions('audit:read', 'player-ratings:read')
  async exportJournal(
    @Query() query: PlayerRatingAuditQuery,
    @Query('ids') ids: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() user?: RequestUser
  ): Promise<StreamableFile> {
    this.requireTrustedOrigin(response.req);
    const stationScope = ratingJournalScope(user);
    const format = response.req.path.endsWith('.xlsx') ? 'xlsx' : 'csv';
    if (ids !== undefined && (typeof ids !== 'string' || ids.length > 10099)) {
      throw new BadRequestException('Invalid journal page');
    }
    const { items } = await this.service.audit(query, { export: true, displayedIds: ids?.split(','), stationScope });
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(await exportPlayerRatingAudit(items, format), {
      disposition: `attachment; filename="player-rating-journal.${format}"`,
      type: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  private requireTrustedOrigin(request: Request): void {
    if (/^Bearer\s+\S+$/i.test(request.get('authorization') ?? '')) return;
    const origin = request.get('origin');
    const fetchSite = request.get('sec-fetch-site');
    if ((origin && origin !== `${request.protocol}://${request.get('host')}`) ||
      (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
      throw new ForbiddenException('Источник запроса не доверен.');
    }
  }

  @Get(':playerKey/events/:eventId/result')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('player-ratings:read')
  result(@Req() request: Request, @Param('playerKey') playerKey: string, @Param('eventId') eventId: string, @CurrentUser() user?: RequestUser) {
    this.requirePlayerRatingRead(request, user);
    return this.service.result(playerKey, eventId);
  }

  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('player-ratings:read')
  search(@Req() request: Request, @Query('q') q?: string, @Query('limit') limit?: string,
    @Query('cursor') cursor?: string, @CurrentUser() user?: RequestUser): Promise<PlayerRatingSearchResult> {
    this.requirePlayerRatingRead(request, user);
    return this.service.search(q, limit ? Number(limit) : undefined, cursor);
  }
  @Get(':playerKey/events')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('player-ratings:read')
  events(@Req() request: Request, @Param('playerKey') playerKey: string, @Query('limit') limit?: string,
    @Query('cursor') cursor?: string, @Query('eventType') eventType?: string, @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string, @CurrentUser() user?: RequestUser): Promise<PlayerRatingEventsResult> {
    this.requirePlayerRatingRead(request, user);
    return this.service.events(playerKey, { limit: limit ? Number(limit) : undefined, cursor, eventType, dateFrom, dateTo });
  }
  @Post(':playerKey/changes')
  @Permissions('player-ratings:write')
  @SkipAdminMutationAudit()
  change(@Req() request: Request, @Param('playerKey') playerKey: string, @Body() dto: ChangePlayerRatingDto,
    @CurrentUser() user?: RequestUser): Promise<PlayerRatingChangeResult> {
    this.requireTrustedOrigin(request);
    return this.service.change(playerKey, dto, user);
  }
  @Post(':playerKey/projection/retry') @Roles(Role.SUPER_ADMIN) retry(@Param('playerKey') playerKey: string, @CurrentUser() user?: RequestUser) { return this.service.retryProjection(playerKey, user); }
  @Post(':playerKey/padlhub-projection/retry') @Roles(Role.SUPER_ADMIN) retryPadlHubProjection(@Param('playerKey') playerKey: string, @CurrentUser() user?: RequestUser) { return this.service.retryPlayerLevelProjection(playerKey, user); }
  @Get(':playerKey')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('player-ratings:read')
  get(@Req() request: Request, @Param('playerKey') playerKey: string, @CurrentUser() user?: RequestUser):
    Promise<PlayerRatingStateDto & { lastEvent?: PlayerRatingEventDto; projection: { status: PlayerRatingProjectionStatus } }> {
    this.requirePlayerRatingRead(request, user);
    return this.service.get(playerKey);
  }

  private requirePlayerRatingRead(request: Request, user: RequestUser | undefined): void {
    this.requireTrustedOrigin(request);
    requireRatingPermission(user, 'player-ratings:read');
  }
}
