import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import {
  CommunitiesManageMemberMutation,
  CommunitiesPersistenceService,
  CommunitiesUpdateMutation
} from './communities-persistence.service';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { Community } from './communities.types';

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

    const community = await this.communitiesPersistence.updateCommunity(id, mutation);
    if (!community) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return community;
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
