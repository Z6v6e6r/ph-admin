import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { GamesService } from './games.service';
import { Game, GameChatContext } from './games.types';

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

  @Get(':id')
  findById(@Param('id') id: string): Promise<Game> {
    return this.gamesService.findById(id);
  }
}
