import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { Community } from './communities.types';
import { CommunitiesService } from './communities.service';

@Controller('communities')
@Roles(
  Role.SUPER_ADMIN,
  Role.SUPPORT,
  Role.STATION_ADMIN,
  Role.MANAGER,
  Role.TOURNAMENT_MANAGER,
  Role.GAME_MANAGER
)
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  findAll(@CurrentUser() user?: RequestUser): Promise<Community[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user?: RequestUser): Promise<Community> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.findById(id);
  }
}
