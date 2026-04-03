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
import {
  Community,
  CommunityFeedItem,
  CommunityFeedTemplateOption,
  CommunityFeedTemplateSlotsResponse
} from './communities.types';

interface CommunityFeedTemplatePreset {
  id: string;
  title: string;
  description: string;
  levelLabel?: string;
  ctaLabel: string;
  slotStartsMinutes: number[];
  slotDurationMinutes: number;
  capacityBase: number;
}

const COMMUNITY_FEED_TEMPLATE_PRESETS: CommunityFeedTemplatePreset[] = [
  {
    id: 'ultra-beginners',
    title: 'Ультра-новички',
    description: 'Для тех кто хочет попробовать',
    ctaLabel: 'Записаться',
    slotStartsMinutes: [10 * 60, 18 * 60],
    slotDurationMinutes: 60,
    capacityBase: 6
  },
  {
    id: 'split-training',
    title: 'Сплит-тренировка',
    description: 'Тренировка в мини-группе с тренером',
    levelLabel: 'D, D+, C',
    ctaLabel: 'Записаться',
    slotStartsMinutes: [11 * 60, 18 * 60 + 30],
    slotDurationMinutes: 60,
    capacityBase: 4
  },
  {
    id: 'group-training',
    title: 'Групповая тренировка',
    description: 'Клубная тренировка в группе',
    levelLabel: 'D, D+, C',
    ctaLabel: 'Записаться',
    slotStartsMinutes: [17 * 60 + 30, 19 * 60 + 30],
    slotDurationMinutes: 90,
    capacityBase: 8
  },
  {
    id: 'game-with-coach',
    title: 'Игра + тренер',
    description: 'Матч с разбором от тренера',
    levelLabel: 'D+',
    ctaLabel: 'Записаться',
    slotStartsMinutes: [11 * 60, 18 * 60 + 30],
    slotDurationMinutes: 60,
    capacityBase: 4
  },
  {
    id: 'open-court',
    title: 'Своя игра',
    description: 'Свободная аренда корта',
    ctaLabel: 'Записаться',
    slotStartsMinutes: [9 * 60, 20 * 60],
    slotDurationMinutes: 60,
    capacityBase: 4
  }
];

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

  async listFeedTemplateSlots(
    id: string,
    stationId?: string
  ): Promise<CommunityFeedTemplateSlotsResponse> {
    const community = await this.findById(id);
    const normalizedStationId = String(stationId ?? community.stationId ?? '').trim() || id;
    const normalizedCommunityStationId = String(community.stationId ?? '').trim();
    const stationName =
      normalizedStationId === normalizedCommunityStationId
        ? String(community.stationName ?? community.stationId ?? normalizedStationId).trim() ||
          normalizedStationId
        : normalizedStationId;
    const generatedAt = new Date();
    const slotDay = this.buildTemplateDay(generatedAt);
    const shiftMinutes = (this.buildTemplateSeed(normalizedStationId) % 2) * 30;

    return {
      communityId: community.id,
      stationId: normalizedStationId,
      stationName,
      generatedAt: generatedAt.toISOString(),
      items: COMMUNITY_FEED_TEMPLATE_PRESETS.map((preset) =>
        this.buildCommunityFeedTemplateOption(
          preset,
          normalizedStationId,
          slotDay,
          shiftMinutes
        )
      )
    };
  }

  private buildCommunityFeedTemplateOption(
    preset: CommunityFeedTemplatePreset,
    stationId: string,
    slotDay: Date,
    shiftMinutes: number
  ): CommunityFeedTemplateOption {
    return {
      id: `${stationId}:${preset.id}`,
      title: preset.title,
      description: preset.description,
      levelLabel: preset.levelLabel,
      ctaLabel: preset.ctaLabel,
      slots: preset.slotStartsMinutes.map((startMinutes, slotIndex) => {
        const startsAt = new Date(slotDay.getTime());
        startsAt.setMinutes(startMinutes + shiftMinutes, 0, 0);
        const endsAt = new Date(startsAt.getTime());
        endsAt.setMinutes(endsAt.getMinutes() + preset.slotDurationMinutes, 0, 0);
        const seed = this.buildTemplateSeed(
          `${stationId}:${preset.id}:${slotIndex}:${startsAt.toISOString()}`
        );
        return {
          id: `${stationId}:${preset.id}:${slotIndex}:${startsAt.getTime()}`,
          startAt: startsAt.toISOString(),
          endAt: endsAt.toISOString(),
          availablePlaces: 1 + (seed % Math.max(2, preset.capacityBase))
        };
      })
    };
  }

  private buildTemplateDay(sourceDate: Date): Date {
    const day = new Date(sourceDate.getTime());
    day.setDate(day.getDate() + 1);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  private buildTemplateSeed(value: string): number {
    const source = String(value ?? '').trim();
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = (hash * 31 + source.charCodeAt(index)) % 1000003;
    }
    return Math.abs(hash);
  }
}
