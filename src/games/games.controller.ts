import { Controller, Get, Param } from '@nestjs/common';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { GamesService } from './games.service';
import { Game } from './games.types';

@Controller('games')
@Roles(
  Role.SUPER_ADMIN,
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

  @Get(':id')
  findById(@Param('id') id: string): Promise<Game> {
    return this.gamesService.findById(id);
  }
}
