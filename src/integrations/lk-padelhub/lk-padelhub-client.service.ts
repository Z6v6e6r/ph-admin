import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Community, CommunityStatus } from '../../communities/communities.types';
import { Game, GameStatus } from '../../games/games.types';
import { Tournament, TournamentStatus } from '../../tournaments/tournaments.types';
import { LkRawRecord } from './lk-padelhub.types';

type ClientMode = 'mock' | 'http';

@Injectable()
export class LkPadelHubClientService {
  private readonly logger = new Logger(LkPadelHubClientService.name);
  private readonly gamesUrl = process.env.LK_PADELHUB_GAMES_URL;
  private readonly tournamentsUrl = process.env.LK_PADELHUB_TOURNAMENTS_URL;
  private readonly communitiesUrl = process.env.LK_PADELHUB_COMMUNITIES_URL;
  private readonly token = process.env.LK_PADELHUB_API_TOKEN;
  private readonly mode: ClientMode = this.resolveMode();

  async listGames(): Promise<Game[]> {
    const payload =
      this.mode === 'http' ? await this.fetchGamesPayload() : this.mockGamesPayload();

    return this.unwrapArray(payload)
      .map((raw) => this.toGame(raw))
      .filter((game): game is Game => game !== null);
  }

  async getGameById(id: string): Promise<Game | null> {
    const games = await this.listGames();
    return games.find((game) => game.id === id) ?? null;
  }

  async listTournaments(): Promise<Tournament[]> {
    const payload =
      this.mode === 'http'
        ? await this.fetchTournamentsPayload()
        : this.mockTournamentsPayload();

    return this.unwrapArray(payload)
      .map((raw) => this.toTournament(raw))
      .filter((tournament): tournament is Tournament => tournament !== null);
  }

  async listCommunities(): Promise<Community[]> {
    const payload = await this.resolveCommunitiesPayload();

    return this.unwrapArray(payload)
      .map((raw) => this.toCommunity(raw))
      .filter((community): community is Community => community !== null);
  }

  async getCommunityById(id: string): Promise<Community | null> {
    const communities = await this.listCommunities();
    return communities.find((community) => community.id === id) ?? null;
  }

  async getTournamentById(id: string): Promise<Tournament | null> {
    const tournaments = await this.listTournaments();
    return tournaments.find((tournament) => tournament.id === id) ?? null;
  }

  private resolveMode(): ClientMode {
    const explicit = process.env.LK_PADELHUB_MODE?.trim().toLowerCase();
    if (explicit === 'http') {
      return 'http';
    }
    if (explicit === 'mock') {
      return 'mock';
    }
    if (this.gamesUrl && this.tournamentsUrl) {
      return 'http';
    }
    return 'mock';
  }

  private async fetchGamesPayload(): Promise<unknown> {
    if (!this.gamesUrl) {
      throw new InternalServerErrorException(
        'LK_PADELHUB_GAMES_URL is required for HTTP mode'
      );
    }
    return this.fetchJson(this.gamesUrl);
  }

  private async fetchTournamentsPayload(): Promise<unknown> {
    if (!this.tournamentsUrl) {
      throw new InternalServerErrorException(
        'LK_PADELHUB_TOURNAMENTS_URL is required for HTTP mode'
      );
    }
    return this.fetchJson(this.tournamentsUrl);
  }

  private async resolveCommunitiesPayload(): Promise<unknown> {
    const explicit = process.env.LK_PADELHUB_MODE?.trim().toLowerCase();
    const isProduction = process.env.NODE_ENV?.trim().toLowerCase() === 'production';

    if (this.communitiesUrl) {
      return this.fetchJson(this.communitiesUrl);
    }

    if (explicit === 'mock' && !isProduction) {
      return this.mockCommunitiesPayload();
    }

    if (explicit === 'http') {
      throw new InternalServerErrorException(
        'LK_PADELHUB_COMMUNITIES_URL is required for communities HTTP mode'
      );
    }

    this.logger.warn(
      'LK communities source is not configured. Returning empty communities list.'
    );
    return [];
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      }
    });

    if (!response.ok) {
      this.logger.error(`LK request failed: ${response.status} ${response.statusText}`);
      throw new InternalServerErrorException(
        `LK request failed with status ${response.status}`
      );
    }

    return response.json();
  }

  private unwrapArray(payload: unknown): LkRawRecord[] {
    if (Array.isArray(payload)) {
      return payload.filter(this.isRecord);
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const keys = ['data', 'items', 'results'];
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value.filter(this.isRecord);
      }
    }

    return [];
  }

  private toGame(raw: LkRawRecord): Game | null {
    const id = this.readString(raw.id) ?? this.readString(raw.gameId) ?? this.readString(raw.uuid);
    const name = this.readString(raw.name) ?? this.readString(raw.title);
    if (!id || !name) {
      return null;
    }

    const rawStatus = this.readString(raw.status) ?? this.readString(raw.state);
    const stationName =
      this.readString(raw.stationName) ??
      this.readString(raw.station_name) ??
      this.readString(raw.studioName) ??
      this.readString(raw.studio_name);
    const courtName =
      this.readString(raw.courtName) ??
      this.readString(raw.court_name) ??
      this.readString(raw.roomName) ??
      this.readString(raw.room_name);
    const locationName = [stationName, courtName].filter(Boolean).join(' · ');
    return {
      id,
      source: 'LK_PADELHUB',
      name,
      status: this.normalizeGameStatus(rawStatus),
      rawStatus: rawStatus ?? undefined,
      tournamentId: this.readString(raw.tournamentId) ?? this.readString(raw.tournament_id),
      startsAt: this.readString(raw.startsAt) ?? this.readString(raw.starts_at),
      createdAt: this.readString(raw.createdAt) ?? this.readString(raw.created_at),
      updatedAt: this.readString(raw.updatedAt) ?? this.readString(raw.updated_at),
      stationName: stationName ?? undefined,
      courtName: courtName ?? undefined,
      locationName: locationName || undefined,
      result:
        this.readString(raw.result) ??
        this.readString(raw.score) ??
        this.readString(raw.matchResult) ??
        this.readString(raw.match_result),
      ratingDelta:
        this.readString(raw.ratingDelta) ??
        this.readString(raw.rating_delta) ??
        this.readString(raw.ratingChange) ??
        this.readString(raw.rating_change)
    };
  }

  private toTournament(raw: LkRawRecord): Tournament | null {
    const id =
      this.readString(raw.id) ??
      this.readString(raw.tournamentId) ??
      this.readString(raw.uuid);
    const name = this.readString(raw.name) ?? this.readString(raw.title);
    if (!id || !name) {
      return null;
    }

    const rawStatus = this.readString(raw.status) ?? this.readString(raw.state);
    return {
      id,
      source: 'LK_PADELHUB',
      name,
      status: this.normalizeTournamentStatus(rawStatus),
      rawStatus: rawStatus ?? undefined,
      gameId: this.readString(raw.gameId) ?? this.readString(raw.game_id),
      startsAt: this.readString(raw.startsAt) ?? this.readString(raw.starts_at),
      endsAt: this.readString(raw.endsAt) ?? this.readString(raw.ends_at),
      createdAt: this.readString(raw.createdAt) ?? this.readString(raw.created_at),
      updatedAt: this.readString(raw.updatedAt) ?? this.readString(raw.updated_at)
    };
  }

  private toCommunity(raw: LkRawRecord): Community | null {
    const id =
      this.readString(raw.id) ??
      this.readString(raw.communityId) ??
      this.readString(raw.community_id) ??
      this.readString(raw.uuid) ??
      this.readString(raw.slug);
    const name =
      this.readString(raw.name) ??
      this.readString(raw.title) ??
      this.readString(raw.communityName) ??
      this.readString(raw.community_name);
    if (!id || !name) {
      return null;
    }

    const rawStatus =
      this.readString(raw.status) ??
      this.readString(raw.state) ??
      this.readString(raw.moderationStatus) ??
      this.readString(raw.moderation_status);

    return {
      id,
      source: 'LK_PADELHUB',
      name,
      slug: this.readString(raw.slug),
      isVerified:
        this.readBoolean(raw.isVerified)
        ?? this.readBoolean(raw.verified)
        ?? this.readBoolean(raw.isOfficial)
        ?? this.readBoolean(raw.official),
      logo:
        this.readString(raw.logo) ??
        this.readString(raw.logoUrl) ??
        this.readString(raw.logo_url) ??
        this.readString(raw.imageUrl) ??
        this.readString(raw.image_url),
      description:
        this.readString(raw.description) ??
        this.readString(raw.summary) ??
        this.readString(raw.about),
      city: this.readString(raw.city),
      status: this.normalizeCommunityStatus(rawStatus),
      rawStatus: rawStatus ?? undefined,
      visibility:
        this.readString(raw.visibility) ??
        this.readString(raw.access) ??
        this.readString(raw.accessMode) ??
        this.readString(raw.access_mode),
      joinRule:
        this.readString(raw.joinRule) ??
        this.readString(raw.join_rule),
      minimumLevel:
        this.readString(raw.minimumLevel) ??
        this.readString(raw.minimum_level) ??
        this.readString(raw.levelFrom) ??
        this.readString(raw.level_from),
      rules:
        this.readString(raw.rules) ??
        this.readString(raw.policy),
      inviteCode:
        this.readString(raw.inviteCode) ??
        this.readString(raw.invite_code),
      inviteLink:
        this.readString(raw.inviteLink) ??
        this.readString(raw.invite_link) ??
        this.readString(raw.link),
      stationId:
        this.readString(raw.stationId) ??
        this.readString(raw.station_id) ??
        this.readString(raw.clubId) ??
        this.readString(raw.club_id),
      stationName:
        this.readString(raw.stationName) ??
        this.readString(raw.station_name) ??
        this.readString(raw.clubName) ??
        this.readString(raw.club_name) ??
        this.readString(raw.locationName) ??
        this.readString(raw.location_name),
      membersCount:
        this.readNumber(raw.membersCount) ??
        this.readNumber(raw.members_count) ??
        this.readNumber(raw.participantsCount) ??
        this.readNumber(raw.participants_count) ??
        this.readNumber(raw.usersCount) ??
        this.readNumber(raw.users_count) ??
        this.readNumber(raw.subscribersCount) ??
        this.readNumber(raw.subscribers_count),
      moderatorsCount:
        this.readNumber(raw.moderatorsCount) ??
        this.readNumber(raw.moderators_count) ??
        this.readNumber(raw.adminsCount) ??
        this.readNumber(raw.admins_count),
      postsCount:
        this.readNumber(raw.postsCount) ??
        this.readNumber(raw.posts_count) ??
        this.readNumber(raw.publicationsCount) ??
        this.readNumber(raw.publications_count) ??
        this.readNumber(raw.topicsCount) ??
        this.readNumber(raw.topics_count) ??
        this.readNumber(raw.discussionsCount) ??
        this.readNumber(raw.discussions_count),
      pendingRequestsCount:
        this.readNumber(raw.pendingRequestsCount) ??
        this.readNumber(raw.pending_requests_count) ??
        this.readNumber(raw.requestsCount) ??
        this.readNumber(raw.requests_count) ??
        this.readNumber(raw.moderationQueueCount) ??
        this.readNumber(raw.moderation_queue_count),
      createdAt:
        this.readString(raw.createdAt) ??
        this.readString(raw.created_at),
      updatedAt:
        this.readString(raw.updatedAt) ??
        this.readString(raw.updated_at),
      lastActivityAt:
        this.readString(raw.lastActivityAt) ??
        this.readString(raw.last_activity_at) ??
        this.readString(raw.lastPostAt) ??
        this.readString(raw.last_post_at),
      publicUrl:
        this.readString(raw.publicUrl) ??
        this.readString(raw.public_url) ??
        this.readString(raw.url) ??
        this.readString(raw.href) ??
        this.readString(raw.link),
      moderationUrl:
        this.readString(raw.moderationUrl) ??
        this.readString(raw.moderation_url) ??
        this.readString(raw.adminUrl) ??
        this.readString(raw.admin_url) ??
        this.readString(raw.manageUrl) ??
        this.readString(raw.manage_url) ??
        this.readString(raw.managerUrl) ??
        this.readString(raw.manager_url),
      webviewUrl:
        this.readString(raw.webviewUrl) ??
        this.readString(raw.webview_url) ??
        this.readString(raw.embedUrl) ??
        this.readString(raw.embed_url) ??
        this.readString(raw.iframeUrl) ??
        this.readString(raw.iframe_url),
      tags:
        this.readStringArray(raw.tags) ??
        this.readStringArray(raw.labels) ??
        this.readStringArray(raw.categories),
      focusTags:
        this.readStringArray(raw.focusTags) ??
        this.readStringArray(raw.focus_tags) ??
        this.readStringArray(raw.tags),
      details: raw
    };
  }

  private normalizeGameStatus(rawStatus?: string): GameStatus {
    if (!rawStatus) {
      return GameStatus.UNKNOWN;
    }

    const normalized = this.normalizeStatus(rawStatus);
    if (['DRAFT', 'NEW', 'PENDING'].includes(normalized)) {
      return GameStatus.DRAFT;
    }
    if (['ACTIVE', 'RUNNING', 'OPEN', 'PUBLISHED'].includes(normalized)) {
      return GameStatus.ACTIVE;
    }
    if (['ARCHIVED', 'CLOSED', 'DELETED'].includes(normalized)) {
      return GameStatus.ARCHIVED;
    }
    return GameStatus.UNKNOWN;
  }

  private normalizeTournamentStatus(rawStatus?: string): TournamentStatus {
    if (!rawStatus) {
      return TournamentStatus.UNKNOWN;
    }

    const normalized = this.normalizeStatus(rawStatus);
    if (['PLANNED', 'DRAFT', 'SCHEDULED'].includes(normalized)) {
      return TournamentStatus.PLANNED;
    }
    if (
      ['REGISTRATION', 'ENROLLMENT', 'OPEN_REGISTRATION', 'REG_OPEN'].includes(
        normalized
      )
    ) {
      return TournamentStatus.REGISTRATION;
    }
    if (['RUNNING', 'ACTIVE', 'IN_PROGRESS'].includes(normalized)) {
      return TournamentStatus.RUNNING;
    }
    if (['FINISHED', 'COMPLETED', 'DONE'].includes(normalized)) {
      return TournamentStatus.FINISHED;
    }
    if (['CANCELED', 'CANCELLED'].includes(normalized)) {
      return TournamentStatus.CANCELED;
    }
    return TournamentStatus.UNKNOWN;
  }

  private normalizeCommunityStatus(rawStatus?: string): CommunityStatus {
    if (!rawStatus) {
      return CommunityStatus.UNKNOWN;
    }

    const normalized = this.normalizeStatus(rawStatus);
    if (['DRAFT', 'NEW', 'CREATED'].includes(normalized)) {
      return CommunityStatus.DRAFT;
    }
    if (['ACTIVE', 'OPEN', 'PUBLISHED', 'PUBLIC'].includes(normalized)) {
      return CommunityStatus.ACTIVE;
    }
    if (
      ['MODERATION', 'REVIEW', 'PENDING', 'PENDING_REVIEW', 'PREMODERATION'].includes(
        normalized
      )
    ) {
      return CommunityStatus.MODERATION;
    }
    if (['PRIVATE', 'CLOSED', 'LOCKED', 'HIDDEN'].includes(normalized)) {
      return CommunityStatus.PRIVATE;
    }
    if (['ARCHIVED', 'DELETED', 'DISABLED'].includes(normalized)) {
      return CommunityStatus.ARCHIVED;
    }
    return CommunityStatus.UNKNOWN;
  }

  private normalizeStatus(rawStatus: string): string {
    return rawStatus
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return undefined;
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (['true', '1', 'yes', 'on', 'verified'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off', 'unverified'].includes(normalized)) {
      return false;
    }
    return undefined;
  }

  private readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const items = value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));

    return items.length > 0 ? items : undefined;
  }

  private isRecord(value: unknown): value is LkRawRecord {
    return typeof value === 'object' && value !== null;
  }

  private mockGamesPayload(): unknown {
    return [
      {
        id: 'lk-game-001',
        name: 'Padel Open Match',
        status: 'ACTIVE',
        startsAt: '2026-03-10T18:00:00.000Z',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-06T09:00:00.000Z'
      }
    ];
  }

  private mockTournamentsPayload(): unknown {
    return [
      {
        id: 'lk-tournament-001',
        name: 'Spring Cup',
        status: 'REGISTRATION',
        startsAt: '2026-03-15T09:00:00.000Z',
        endsAt: '2026-03-16T20:00:00.000Z',
        createdAt: '2026-02-20T10:00:00.000Z',
        updatedAt: '2026-03-06T09:00:00.000Z'
      }
    ];
  }

  private mockCommunitiesPayload(): unknown {
    return [
      {
        id: 'community-dvoroteka-moscow',
        slug: 'dvoroteka-moscow',
        name: 'Дворотека Москва',
        description:
          'Основное сообщество станции: новости, анонсы матчей и заявки на вступление новых участников.',
        status: 'ACTIVE',
        visibility: 'PRIVATE',
        stationId: 'station-msk-1',
        stationName: 'Москва #1',
        membersCount: 248,
        moderatorsCount: 5,
        postsCount: 184,
        pendingRequestsCount: 7,
        createdAt: '2026-01-15T09:00:00.000Z',
        updatedAt: '2026-03-30T16:40:00.000Z',
        lastActivityAt: '2026-03-31T10:15:00.000Z',
        publicUrl: 'https://lk.padlhub.ru/communities/dvoroteka-moscow',
        moderationUrl: 'https://lk.padlhub.ru/admin/communities/dvoroteka-moscow',
        webviewUrl: 'https://lk.padlhub.ru/admin/communities/dvoroteka-moscow',
        tags: ['основное', 'москва', 'частное']
      },
      {
        id: 'community-juniors',
        slug: 'dvoroteka-juniors',
        name: 'Dvoroteka Juniors',
        description:
          'Клубное сообщество детского и подросткового направления с отдельной модерацией заявок.',
        status: 'MODERATION',
        visibility: 'REQUEST',
        stationId: 'station-msk-2',
        stationName: 'Москва #2',
        membersCount: 96,
        moderatorsCount: 3,
        postsCount: 61,
        pendingRequestsCount: 12,
        createdAt: '2026-02-08T11:30:00.000Z',
        updatedAt: '2026-03-30T12:05:00.000Z',
        lastActivityAt: '2026-03-30T18:20:00.000Z',
        publicUrl: 'https://lk.padlhub.ru/communities/dvoroteka-juniors',
        moderationUrl: 'https://lk.padlhub.ru/admin/communities/dvoroteka-juniors',
        webviewUrl: 'https://lk.padlhub.ru/admin/communities/dvoroteka-juniors',
        tags: ['junior', 'заявки', 'модерация']
      }
    ];
  }
}
