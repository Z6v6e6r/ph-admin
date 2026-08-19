import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { ChangePlayerRatingDto } from './dto/change-player-rating.dto';
import { PlayerRatingsService } from './player-ratings.service';
import { PlayerRatingChangeResult, PlayerRatingEventDto, PlayerRatingEventsResult, PlayerRatingProjectionStatus, PlayerRatingSearchResult, PlayerRatingStateDto } from './player-ratings.types';

@Controller('admin/player-ratings')
@Roles(...STAFF_ROLES)
export class PlayerRatingsController {
  constructor(private readonly service: PlayerRatingsService) {}
  @Get('search') search(@Query('q') q?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<PlayerRatingSearchResult> { return this.service.search(q, limit ? Number(limit) : undefined, cursor); }
  @Get(':playerKey/events') events(@Param('playerKey') playerKey: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('eventType') eventType?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string): Promise<PlayerRatingEventsResult> { return this.service.events(playerKey, { limit: limit ? Number(limit) : undefined, cursor, eventType, dateFrom, dateTo }); }
  @Post(':playerKey/changes') @Roles(Role.SUPER_ADMIN) change(@Param('playerKey') playerKey: string, @Body() dto: ChangePlayerRatingDto, @CurrentUser() user?: RequestUser): Promise<PlayerRatingChangeResult> { return this.service.change(playerKey, dto, user); }
  @Post(':playerKey/projection/retry') @Roles(Role.SUPER_ADMIN) retry(@Param('playerKey') playerKey: string, @CurrentUser() user?: RequestUser) { return this.service.retryProjection(playerKey, user); }
  @Post(':playerKey/padlhub-projection/retry') @Roles(Role.SUPER_ADMIN) retryPadlHubProjection(@Param('playerKey') playerKey: string, @CurrentUser() user?: RequestUser) { return this.service.retryPlayerLevelProjection(playerKey, user); }
  @Get(':playerKey') get(@Param('playerKey') playerKey: string): Promise<PlayerRatingStateDto & { lastEvent?: PlayerRatingEventDto; projection: { status: PlayerRatingProjectionStatus } }> { return this.service.get(playerKey); }
}
