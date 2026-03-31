import { Injectable, NotFoundException } from '@nestjs/common';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { Community } from './communities.types';

@Injectable()
export class CommunitiesService {
  constructor(private readonly lkPadelHubClient: LkPadelHubClientService) {}

  async findAll(): Promise<Community[]> {
    return this.lkPadelHubClient.listCommunities();
  }

  async findById(id: string): Promise<Community> {
    const community = await this.lkPadelHubClient.getCommunityById(id);
    if (!community) {
      throw new NotFoundException(`Community with id ${id} not found`);
    }
    return community;
  }
}
