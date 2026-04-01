import {
  Body,
  Controller,
  Delete,
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
import { CreateCommunityFeedItemDto } from './dto/create-community-feed-item.dto';
import { ManageCommunityMemberDto } from './dto/manage-community-member.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { Community, CommunityFeedItem } from './communities.types';
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

  @Get(':id/feed-items')
  listFeedItems(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<CommunityFeedItem[]> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.listFeedItems(id);
  }

  @Post(':id/feed-items')
  createFeedItem(
    @Param('id') id: string,
    @Body() dto: CreateCommunityFeedItemDto,
    @CurrentUser() user?: RequestUser
  ): Promise<CommunityFeedItem> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.communitiesService.createFeedItem(id, {
      ...dto,
      actor: {
        id: user.id,
        name: user.title || user.login || user.id
      }
    });
  }

  @Delete(':id/feed-items/:feedItemId')
  async deleteFeedItem(
    @Param('id') id: string,
    @Param('feedItemId') feedItemId: string,
    @CurrentUser() user?: RequestUser
  ): Promise<{ ok: true }> {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    await this.communitiesService.deleteFeedItem(id, feedItemId);
    return { ok: true };
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
