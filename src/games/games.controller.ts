import {
  Body,
  Controller,
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
import { CreateGameChatMessageDto } from './dto/create-game-chat-message.dto';
import { GamesService } from './games.service';
import {
  Game,
  GameChatContext,
  GameChatMessage,
  GameEvent,
  GameEventListFilters,
  GameEventListResult
} from './games.types';

@Controller('games')
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
  findAll(): Promise<Game[]> {
    return this.gamesService.findAll();
  }

  @Get('events')
  findEvents(
    @Query('event') event?: string,
    @Query('phone') phone?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ): Promise<GameEventListResult> {
    const filters: GameEventListFilters = {
      event,
      phone,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    return this.gamesService.findEvents(filters);
  }

  @Get('events/:id')
  findEventById(@Param('id') id: string): Promise<GameEvent> {
    return this.gamesService.findEventById(id);
  }

  @Delete('events/:id')
  @Roles(Role.SUPER_ADMIN)
  deleteEvent(@Param('id') id: string): Promise<void> {
    return this.gamesService.deleteEvent(id);
  }

  @Get(':id/chat')
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

  @Get(':id')
  findById(@Param('id') id: string): Promise<Game> {
    return this.gamesService.findById(id);
  }
}
