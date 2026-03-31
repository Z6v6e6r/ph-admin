import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { ManageCommunityMemberDto } from './dto/manage-community-member.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
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

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommunityDto,
    @CurrentUser() user?: RequestUser
  ): Promise<Community> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.update(id, dto);
  }

  @Post(':id/members/manage')
  manageMember(
    @Param('id') id: string,
    @Body() dto: ManageCommunityMemberDto,
    @CurrentUser() user?: RequestUser
  ): Promise<Community> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.manageMember(id, {
      ...dto,
      actor: {
        id: user.id,
        name: user.title || user.login || user.id
      }
    });
  }
}
