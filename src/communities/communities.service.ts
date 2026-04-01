import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  CommunitiesCreateFeedItemMutation,
  CommunitiesDeleteFeedItemResult,
  CommunitiesManageMemberMutation,
  CommunitiesPersistenceService,
  CommunitiesUpdateFeedItemMutation,
  CommunitiesUpdateMutation
} from './communities-persistence.service';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { Community, CommunityFeedItem } from './communities.types';

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly communitiesPersistence: CommunitiesPersistenceService
  ) {}

  async findAll(): Promise<Community[]> {
    if (this.communitiesPersistence.isEnabled()) {
      const communities = await this.communitiesPersistence.listCommunities();
      if (communities.length > 0) {
        return communities;
      }
    }
    return this.lkPadelHubClient.listCommunities();
  }

  async findById(id: string): Promise<Community> {
    let community = this.communitiesPersistence.isEnabled()
      ? await this.communitiesPersistence.findCommunityById(id)
      : null;
    if (!community) {
      community = await this.lkPadelHubClient.getCommunityById(id);
    }
    if (!community) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return community;
  }

  async update(id: string, mutation: CommunitiesUpdateMutation): Promise<Community> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    if (mutation.name !== undefined && !String(mutation.name).trim()) {
      throw new BadRequestException('Community name cannot be empty');
    }
    if (mutation.status !== undefined && !String(mutation.status).trim()) {
      throw new BadRequestException('Community status cannot be empty');
    }

    const community = await this.communitiesPersistence.updateCommunity(id, mutation);
    if (!community) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return community;
  }

  async delete(id: string): Promise<void> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    const deleted = await this.communitiesPersistence.deleteCommunity(id);
    if (!deleted) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
  }

  async listFeedItems(id: string): Promise<CommunityFeedItem[]> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    await this.findById(id);
    return this.communitiesPersistence.listFeedItems(id);
  }

  async createFeedItem(
    id: string,
    mutation: CommunitiesCreateFeedItemMutation
  ): Promise<CommunityFeedItem> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    if (!String(mutation.title ?? '').trim()) {
      throw new BadRequestException('Feed item title cannot be empty');
    }

    const item = await this.communitiesPersistence.createFeedItem(id, mutation);
    if (!item) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return item;
  }

  async updateFeedItem(
    id: string,
    feedItemId: string,
    mutation: CommunitiesUpdateFeedItemMutation
  ): Promise<CommunityFeedItem> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    await this.findById(id);
    if (mutation.title !== undefined && !String(mutation.title).trim()) {
      throw new BadRequestException('Feed item title cannot be empty');
    }

    const item = await this.communitiesPersistence.updateFeedItem(id, feedItemId, mutation);
    if (!item) {
      throw new NotFoundException(`Feed item with id ${feedItemId} not found`);
    }
    return item;
  }

  async deleteFeedItem(
    id: string,
    feedItemId: string
  ): Promise<CommunitiesDeleteFeedItemResult> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    await this.findById(id);
    return this.communitiesPersistence.deleteFeedItem(id, feedItemId);
  }

  async manageMember(
    id: string,
    mutation: CommunitiesManageMemberMutation
  ): Promise<Community> {
    if (!this.communitiesPersistence.isEnabled()) {
      throw new InternalServerErrorException(
        'Communities moderation requires MongoDB source configuration'
      );
    }

    if (
      !String(mutation.member?.id ?? '').trim() &&
      !String(mutation.member?.phone ?? '').trim() &&
      !String(mutation.member?.name ?? '').trim()
    ) {
      throw new BadRequestException(
        'Community member mutation requires member id, phone or name'
      );
    }

    const community = await this.communitiesPersistence.manageMember(id, mutation);
    if (!community) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return community;
  }
}
