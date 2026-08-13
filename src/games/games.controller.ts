import {
  Body,
  Controller,
  Patch,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { CreateGameChatMessageDto } from './dto/create-game-chat-message.dto';
import { RemoveGamePublicationPlayerDto } from './dto/remove-game-publication-player.dto';
import { RequestGamePlayerRemovalDto } from './dto/request-game-player-removal.dto';
import { UpdateGameMetadataDto } from './dto/update-game-metadata.dto';
import { GamesService } from './games.service';
import {
  Game,
  GameAnalyticsFilters,
  GameAnalyticsResult,
  GameChatContext,
  GameChatMessage,
  GameEvent,
  GameEventListFilters,
  GameEventListResult,
  GameListFilters,
  GameListResult,
  GamePlayerRemovalRequest
} from './games.types';

@Controller('games')
@Permissions('games:read')
@Roles(
  Role.SUPER_ADMIN,
  Role.SUPPORT,
  Role.GAME_MANAGER,
  Role.MANAGER,
  Role.STATION_ADMIN,
  Role.TOURNAMENT_MANAGER
)
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  findAll(
    @Query('phone') phone?: string,
    @Query('q') query?: string,
    @Query('date') date?: string,
    @Query('station') station?: string,
    @Query('status') status?: string,
    @Query('publication') publication?: string,
    @Query('view') quickFilter?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: string,
    @CurrentUser() user?: RequestUser
  ): Promise<GameListResult> {
    const filters: GameListFilters = {
      phone,
      query,
      date,
      station,
      status,
      publication: publication as GameListFilters['publication'],
      quickFilter: quickFilter as GameListFilters['quickFilter'],
      lifecycle: lifecycle as GameListFilters['lifecycle'],
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sortField: sortField as GameListFilters['sortField'],
      sortDirection: sortDirection as GameListFilters['sortDirection']
    };
    return this.gamesService.findAll(filters, user);
  }

  @Get('analytics')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  findAnalytics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: RequestUser
  ): Promise<GameAnalyticsResult> {
    const filters: GameAnalyticsFilters = {
      from,
      to
    };
    return this.gamesService.findAnalytics(filters, user);
  }

  @Get('events')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  findEvents(
    @Query('event') event?: string,
    @Query('phone') phone?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() user?: RequestUser
  ): Promise<GameEventListResult> {
    const filters: GameEventListFilters = {
      event,
      phone,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    return this.gamesService.findEvents(filters, user);
  }

  @Get('events/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  findEventById(@Param('id') id: string, @CurrentUser() user?: RequestUser): Promise<GameEvent> {
    return this.gamesService.findEventById(id, user);
  }

  @Delete('events/:id')
  @Permissions('games:write')
  @Roles(Role.SUPER_ADMIN)
  deleteEvent(@Param('id') id: string, @CurrentUser() user?: RequestUser): Promise<void> {
    return this.gamesService.deleteEvent(id, user);
  }

  @Get(':id/chat')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.GAME_MANAGER, Role.MANAGER, Role.TOURNAMENT_MANAGER)
  getGameChat(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<GameChatContext> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.gamesService.getGameChat(id, user);
  }

  @Post(':id/chat/messages')
  @Permissions('games:write')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.GAME_MANAGER, Role.MANAGER, Role.TOURNAMENT_MANAGER)
  sendGameChatMessage(
    @Param('id') id: string,
    @Body() dto: CreateGameChatMessageDto,
    @CurrentUser() user?: RequestUser
  ): Promise<GameChatMessage> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.gamesService.sendGameChatMessage(id, dto.text, user);
  }

  @Post(':id/publication/remove-player')
  @Permissions('games:write')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  removePlayerFromPublication(
    @Param('id') id: string,
    @Body() dto: RemoveGamePublicationPlayerDto,
    @CurrentUser() user?: RequestUser
  ): Promise<Game> {
    return this.gamesService.removePlayerFromPublication(id, dto, user);
  }

  @Post(':id/players/:playerId/removal-requests')
  @Permissions('games:write')
  @Roles(Role.SUPER_ADMIN, Role.GAME_MANAGER, Role.MANAGER)
  requestPlayerRemoval(
    @Param('id') id: string,
    @Param('playerId') playerId: string,
    @Body() dto: RequestGamePlayerRemovalDto,
    @CurrentUser() user?: RequestUser
  ): Promise<GamePlayerRemovalRequest> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.gamesService.requestPlayerRemoval(id, playerId, dto, user);
  }

  @Get(':id/players/:playerId/removal-requests/:operationId')
  @Permissions('games:write')
  @Roles(Role.SUPER_ADMIN, Role.GAME_MANAGER, Role.MANAGER)
  getPlayerRemovalRequest(
    @Param('id') id: string,
    @Param('playerId') playerId: string,
    @Param('operationId') operationId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<GamePlayerRemovalRequest> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.gamesService.getPlayerRemovalRequest(id, playerId, operationId, user);
  }

  @Post(':id/publication/hide-game')
  @Permissions('games:write')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  hideGameFromPublicList(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<Game> {
    return this.gamesService.hideGameFromPublicList(id, user);
  }

  @Post(':id/publication/archive-community-posts')
  @Permissions('games:write')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  archiveGameCommunityPublications(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<Game> {
    return this.gamesService.archiveGameCommunityPublications(id, user);
  }

  @Post(':id/publication/hide-player-cabinets')
  @Permissions('games:write')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  hideGameFromPlayerCabinets(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<Game> {
    return this.gamesService.hideGameFromPlayerCabinets(id, user);
  }

  @Patch(':id/metadata')
  @Permissions('games:write')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.GAME_MANAGER,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER
  )
  updateMetadata(
    @Param('id') id: string,
    @Body() dto: UpdateGameMetadataDto,
    @CurrentUser() user?: RequestUser
  ): Promise<Game> {
    return this.gamesService.updateMetadata(id, dto.metadata, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user?: RequestUser): Promise<Game> {
    return this.gamesService.findById(id, user);
  }
}
