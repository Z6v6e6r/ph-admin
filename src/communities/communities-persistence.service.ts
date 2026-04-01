import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy
} from '@nestjs/common';
import { Collection, Db, Document, Filter, MongoClient, ObjectId, OptionalId } from 'mongodb';
import {
  Community,
  CommunityActor,
  CommunityFeedItem,
  CommunityFeedItemKind,
  CommunityFeedItemStatus,
  CommunityFeedParticipant,
  CommunityJoinRule,
  CommunityMember,
  CommunityMemberRole,
  CommunityMemberStatus,
  CommunityStatus,
  CommunityVisibility
} from './communities.types';

type MongoCommunityDocument = Document & {
  _id?: unknown;
};

type MongoCommunityFeedDocument = Document & {
  _id?: unknown;
};

type MongoCommunityFeedModerationDocument = Document & {
  _id?: unknown;
};

export interface CommunitiesUpdateMutation {
  name?: string;
  status?: string;
  description?: string;
  city?: string;
  isVerified?: boolean;
  visibility?: CommunityVisibility;
  joinRule?: CommunityJoinRule;
  minimumLevel?: string;
  rules?: string;
  logo?: string | null;
  focusTags?: string[];
}

export interface CommunityFeedParticipantInput {
  id?: string;
  name: string;
  avatar?: string | null;
  levelLabel?: string;
}

export interface CommunitiesCreateFeedItemMutation {
  kind: CommunityFeedItemKind;
  title: string;
  body?: string;
  imageUrl?: string | null;
  previewLabel?: string;
  ctaLabel?: string;
  startAt?: string;
  endAt?: string;
  stationName?: string;
  courtName?: string;
  levelLabel?: string;
  likesCount?: number;
  commentsCount?: number;
  priority?: number;
  placement?: string;
  authorName?: string;
  participants?: CommunityFeedParticipantInput[];
  tags?: string[];
  details?: Record<string, unknown>;
  actor?: CommunityActor;
}

export interface CommunitiesUpdateFeedItemMutation {
  kind?: CommunityFeedItemKind;
  title?: string;
  body?: string;
  imageUrl?: string | null;
  previewLabel?: string;
  ctaLabel?: string;
  startAt?: string;
  endAt?: string;
  stationName?: string;
  courtName?: string;
  levelLabel?: string;
  likesCount?: number;
  commentsCount?: number;
  priority?: number;
  placement?: string;
  authorName?: string;
  participants?: CommunityFeedParticipantInput[];
  tags?: string[];
  details?: Record<string, unknown>;
  actor?: CommunityActor;
}

export interface CommunitiesDeleteFeedItemResult {
  ok: true;
  mode: 'deleted' | 'suppressed';
}

export type CommunityMemberManageAction =
  | 'APPROVE'
  | 'REMOVE'
  | 'BAN'
  | 'UNBAN'
  | 'PROMOTE'
  | 'DEMOTE'
  | 'WARN';

export interface CommunityMemberMutationInput {
  id?: string;
  phone?: string;
  name?: string;
  avatar?: string | null;
  role?: CommunityMemberRole;
  status?: CommunityMemberStatus;
  levelScore?: number;
  levelLabel?: string;
  joinedAt?: string;
}

export interface CommunitiesManageMemberMutation {
  action: CommunityMemberManageAction;
  member: CommunityMemberMutationInput;
  actor?: CommunityActor;
}

@Injectable()
export class CommunitiesPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(CommunitiesPersistenceService.name);
  private readonly mongoUri = this.readEnv('COMMUNITIES_MONGODB_URI')
    ?? this.readEnv('GAMES_MONGODB_URI')
    ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbNames = this.dedupeStrings([
    this.readEnv('COMMUNITIES_MONGODB_DB'),
    this.readEnv('GAMES_MONGODB_DB'),
    'games',
    this.readEnv('MONGODB_DB'),
    'ph_admin'
  ]);
  private readonly collectionNames = this.dedupeStrings([
    this.readEnv('COMMUNITIES_MONGODB_COLLECTION'),
    'lk_communities'
  ]);
  private readonly feedMongoDbNames = this.dedupeStrings([
    this.readEnv('COMMUNITIES_FEED_MONGODB_DB'),
    this.readEnv('COMMUNITIES_MONGODB_DB'),
    this.readEnv('GAMES_MONGODB_DB'),
    'games',
    this.readEnv('MONGODB_DB'),
    'ph_admin'
  ]);
  private readonly feedCollectionNames = this.dedupeStrings([
    this.readEnv('COMMUNITIES_FEED_MONGODB_COLLECTION'),
    'lk_community_feed'
  ]);
  private readonly feedModerationCollectionNames = this.dedupeStrings([
    this.readEnv('COMMUNITIES_FEED_MODERATION_MONGODB_COLLECTION'),
    'lk_community_feed_moderation'
  ]);
  private readonly inviteBaseUrl =
    this.readEnv('COMMUNITIES_INVITE_BASE_URL')
    ?? 'https://padlhub.ru/community/invite/';
  private client?: MongoClient;
  private dbsByName = new Map<string, Db>();

  isEnabled(): boolean {
    return Boolean(this.mongoUri);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.close().catch(() => undefined);
    this.client = undefined;
    this.dbsByName.clear();
  }

  async listCommunities(): Promise<Community[]> {
    const fallback = await this.primaryCollection();
    const candidates = await this.readCollections(fallback);

    for (const candidate of candidates) {
      const items = await candidate.collection
        .find({ archived: { $ne: true } })
        .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
        .toArray();
      const communities = items
        .map((item) => this.toCommunity(item))
        .filter((community): community is Community => community !== null);
      if (communities.length > 0) {
        this.logger.log(
          `Communities source resolved: db=${candidate.dbName}, collection=${candidate.collectionName}, count=${communities.length}`
        );
        return communities;
      }
    }

    return [];
  }

  async findCommunityById(id: string): Promise<Community | null> {
    const match = await this.findDocumentWithSourceById(id);
    return match ? this.toCommunity(match.document) : null;
  }

  async updateCommunity(
    id: string,
    mutation: CommunitiesUpdateMutation
  ): Promise<Community | null> {
    const match = await this.findDocumentWithSourceById(id);
    if (!match) {
      return null;
    }

    const updated: MongoCommunityDocument = { ...match.document };
    const now = new Date().toISOString();

    if (mutation.name !== undefined) {
      updated.name = mutation.name.trim();
    }
    if (mutation.status !== undefined) {
      updated.status = mutation.status.trim().toUpperCase();
      updated.archived = updated.status === 'ARCHIVED';
    }
    if (mutation.description !== undefined) {
      updated.description = mutation.description.trim();
    }
    if (mutation.city !== undefined) {
      updated.city = mutation.city.trim();
    }
    if (mutation.isVerified !== undefined) {
      updated.isVerified = mutation.isVerified;
      updated.verified = mutation.isVerified;
    }
    if (mutation.visibility !== undefined) {
      updated.visibility = mutation.visibility;
    }
    if (mutation.joinRule !== undefined) {
      updated.joinRule = mutation.joinRule;
    }
    if (mutation.minimumLevel !== undefined) {
      updated.minimumLevel = mutation.minimumLevel.trim();
    }
    if (mutation.rules !== undefined) {
      updated.rules = mutation.rules.trim();
    }
    if (mutation.logo !== undefined) {
      updated.logo = mutation.logo;
    }
    if (mutation.focusTags !== undefined) {
      updated.focusTags = this.dedupeStrings(mutation.focusTags);
    }

    updated.updatedAt = now;

    await this.persistDocument(updated, match.collection);
    return this.toCommunity(updated);
  }

  async manageMember(
    id: string,
    mutation: CommunitiesManageMemberMutation
  ): Promise<Community | null> {
    const match = await this.findDocumentWithSourceById(id);
    if (!match) {
      return null;
    }

    const updated: MongoCommunityDocument = { ...match.document };
    const members = this.toObjectArray(updated.members);
    const pendingMembers = this.toObjectArray(updated.pendingMembers);
    const bannedMembers = this.toObjectArray(updated.bannedMembers);

    const membersFiltered = members.filter(
      (entry) => !this.sameMemberIdentity(entry, mutation.member)
    );
    const pendingFiltered = pendingMembers.filter(
      (entry) => !this.sameMemberIdentity(entry, mutation.member)
    );
    const bannedFiltered = bannedMembers.filter(
      (entry) => !this.sameMemberIdentity(entry, mutation.member)
    );

    const existingMember =
      members.find((entry) => this.sameMemberIdentity(entry, mutation.member))
      ?? pendingMembers.find((entry) => this.sameMemberIdentity(entry, mutation.member))
      ?? bannedMembers.find((entry) => this.sameMemberIdentity(entry, mutation.member))
      ?? null;

    const now = new Date().toISOString();
    const actor = this.toActorRecord(mutation.actor, now);

    updated.members = membersFiltered;
    updated.pendingMembers = pendingFiltered;
    updated.bannedMembers = bannedFiltered;

    if (mutation.action === 'APPROVE' || mutation.action === 'UNBAN') {
      updated.members = [
        this.buildStoredMember(existingMember, mutation.member, {
          status: 'ACTIVE',
          joinedAt:
            this.pickString(mutation.member.joinedAt)
            ?? this.pickString(existingMember?.joinedAt)
            ?? now,
          bannedAt: undefined,
          bannedBy: undefined
        }),
        ...membersFiltered
      ];
    }

    if (mutation.action === 'PROMOTE' || mutation.action === 'DEMOTE' || mutation.action === 'WARN') {
      const targetRole = mutation.action === 'PROMOTE'
        ? 'ADMIN'
        : mutation.action === 'DEMOTE'
          ? 'MEMBER'
          : this.normalizeRole(existingMember?.role ?? mutation.member.role);
      const warningsCount =
        mutation.action === 'WARN'
          ? this.readWarningsCount(existingMember) + 1
          : this.readWarningsCount(existingMember);
      const targetMember = this.buildStoredMember(existingMember, mutation.member, {
        role: targetRole,
        status: this.normalizeMemberStatus(existingMember?.status, 'ACTIVE'),
        warningsCount: warningsCount,
        ...(mutation.action === 'WARN'
          ? {
              lastWarnedAt: now,
              lastWarnedBy: actor ?? undefined
            }
          : {})
      });

      if (pendingMembers.some((entry) => this.sameMemberIdentity(entry, mutation.member))) {
        updated.pendingMembers = [targetMember, ...pendingFiltered];
      } else if (bannedMembers.some((entry) => this.sameMemberIdentity(entry, mutation.member))) {
        updated.bannedMembers = [targetMember, ...bannedFiltered];
      } else {
        updated.members = [targetMember, ...membersFiltered];
      }
    }

    if (mutation.action === 'BAN') {
      updated.bannedMembers = [
        this.buildStoredMember(existingMember, mutation.member, {
          status: 'BANNED',
          joinedAt:
            this.pickString(existingMember?.joinedAt)
            ?? this.pickString(mutation.member.joinedAt)
            ?? now,
          bannedAt: now,
          bannedBy: actor ?? undefined
        }),
        ...bannedFiltered
      ];
    }

    updated.memberCount = this.toObjectArray(updated.members).length;
    updated.membersCount = updated.memberCount;
    updated.pendingCount = this.toObjectArray(updated.pendingMembers).length;
    updated.updatedAt = now;

    await this.persistDocument(updated, match.collection);
    return this.toCommunity(updated);
  }

  async deleteCommunity(id: string): Promise<boolean> {
    const match = await this.findDocumentWithSourceById(id);
    if (!match) {
      return false;
    }

    const deleteResult = match.document._id !== undefined
      ? await match.collection.deleteOne({ _id: match.document._id } as Filter<MongoCommunityDocument>)
      : await match.collection.deleteOne(this.buildIdFilter(id));
    const deleted = (deleteResult.deletedCount ?? 0) > 0;

    if (!deleted) {
      return false;
    }

    await this.deleteCommunityFeedArtifacts(id).catch((error) => {
      this.logger.warn(
        `Community ${id} deleted, but feed cleanup failed: ${String(error)}`
      );
    });
    return true;
  }

  async listFeedItems(communityId: string): Promise<CommunityFeedItem[]> {
    const collections = await this.readFeedCollections();
    const items: CommunityFeedItem[] = [];

    for (const candidate of collections) {
      try {
        const documents = await candidate.collection
          .find(this.buildCommunityFeedFilter(communityId))
          .sort({ priority: -1, publishedAt: -1, createdAt: -1, _id: -1 })
          .toArray();
        documents.forEach((document) => {
          const item = this.toFeedItem(document);
          if (item) {
            items.push(item);
          }
        });
      } catch (error) {
        this.logger.warn(
          `Failed to read community feed items from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }

    const moderationCollections = await this.readFeedModerationCollections();
    for (const candidate of moderationCollections) {
      try {
        const documents = await candidate.collection
          .find(this.buildCommunityFeedFilter(communityId) as Filter<MongoCommunityFeedModerationDocument>)
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .toArray();
        documents.forEach((document) => {
          const item = this.toFeedModerationItem(document);
          if (item) {
            items.push(item);
          }
        });
      } catch (error) {
        this.logger.warn(
          `Failed to read community feed moderation from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }

    return this.dedupeFeedItems(items).sort((left, right) => {
      const rightPriority = right.priority ?? 0;
      const leftPriority = left.priority ?? 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }
      return String(right.publishedAt ?? right.createdAt ?? '').localeCompare(
        String(left.publishedAt ?? left.createdAt ?? '')
      );
    });
  }

  async createFeedItem(
    communityId: string,
    mutation: CommunitiesCreateFeedItemMutation
  ): Promise<CommunityFeedItem | null> {
    const communityMatch = await this.findDocumentWithSourceById(communityId);
    if (!communityMatch) {
      return null;
    }

    const collection = await this.primaryFeedCollection();
    const now = new Date().toISOString();
    const itemId = new ObjectId().toHexString();
    const community = this.toCommunity(communityMatch.document);
    const actor = this.toActorRecord(mutation.actor, now);
    const participants = (mutation.participants ?? [])
      .map((entry) => this.normalizeFeedParticipantInput(entry))
      .filter((entry): entry is CommunityFeedParticipant => entry !== null);
    const kind = mutation.kind;
    const normalizedTags = this.dedupeStrings(mutation.tags ?? []);
    const imageUrl = this.pickNullableString(mutation.imageUrl);

    const payload: MongoCommunityFeedDocument = {
      id: itemId,
      feedItemId: itemId,
      communityId: communityId,
      communityName: community?.name ?? this.pickString(communityMatch.document.name) ?? undefined,
      communitySlug: community?.slug ?? this.pickString(communityMatch.document.slug) ?? undefined,
      kind,
      type: kind,
      status: 'PUBLISHED',
      title: mutation.title.trim(),
      body: this.pickString(mutation.body) ?? undefined,
      description: this.pickString(mutation.body) ?? undefined,
      content: this.pickString(mutation.body) ?? undefined,
      imageUrl: imageUrl ?? null,
      image: imageUrl ?? null,
      photo: imageUrl ?? null,
      previewLabel: this.pickString(mutation.previewLabel) ?? undefined,
      label: this.pickString(mutation.previewLabel) ?? undefined,
      ctaLabel: this.pickString(mutation.ctaLabel) ?? undefined,
      actionLabel: this.pickString(mutation.ctaLabel) ?? undefined,
      buttonLabel: this.pickString(mutation.ctaLabel) ?? undefined,
      startAt: this.pickString(mutation.startAt) ?? undefined,
      endAt: this.pickString(mutation.endAt) ?? undefined,
      stationName:
        this.pickString(mutation.stationName)
        ?? community?.stationName
        ?? undefined,
      courtName: this.pickString(mutation.courtName) ?? undefined,
      levelLabel: this.pickString(mutation.levelLabel) ?? undefined,
      likesCount: this.pickCountNumber(mutation.likesCount) ?? 0,
      commentsCount: this.pickCountNumber(mutation.commentsCount) ?? 0,
      reportsCount: 0,
      isAdvertisement: kind === 'AD',
      ad: kind === 'AD',
      placement: this.pickString(mutation.placement) ?? 'feed',
      priority: this.pickNumeric(mutation.priority) ?? 0,
      tags: normalizedTags,
      participants: participants,
      authorName:
        this.pickString(mutation.authorName)
        ?? actor?.name
        ?? community?.name
        ?? 'Админка',
      createdBy: actor ?? undefined,
      source: 'ADMIN_PANEL',
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      details: this.isRecord(mutation.details) ? mutation.details : undefined
    };

    await collection.insertOne(payload as OptionalId<MongoCommunityFeedDocument>);
    return this.toFeedItem(payload);
  }

  async updateFeedItem(
    communityId: string,
    feedItemId: string,
    mutation: CommunitiesUpdateFeedItemMutation
  ): Promise<CommunityFeedItem | null> {
    const now = new Date().toISOString();
    const actor = this.toActorRecord(mutation.actor, now);
    const setPayload: Record<string, unknown> = {
      updatedAt: now
    };

    if (mutation.kind !== undefined) {
      setPayload.kind = mutation.kind;
      setPayload.type = mutation.kind;
      setPayload.isAdvertisement = mutation.kind === 'AD';
      setPayload.ad = mutation.kind === 'AD';
    }
    if (mutation.title !== undefined) {
      setPayload.title = mutation.title.trim();
    }
    if (mutation.body !== undefined) {
      const body = this.pickString(mutation.body);
      setPayload.body = body ?? null;
      setPayload.description = body ?? null;
      setPayload.content = body ?? null;
    }
    if (mutation.imageUrl !== undefined) {
      const imageUrl = this.pickNullableString(mutation.imageUrl);
      setPayload.imageUrl = imageUrl ?? null;
      setPayload.image = imageUrl ?? null;
      setPayload.photo = imageUrl ?? null;
    }
    if (mutation.previewLabel !== undefined) {
      const previewLabel = this.pickString(mutation.previewLabel);
      setPayload.previewLabel = previewLabel ?? null;
      setPayload.label = previewLabel ?? null;
    }
    if (mutation.ctaLabel !== undefined) {
      const ctaLabel = this.pickString(mutation.ctaLabel);
      setPayload.ctaLabel = ctaLabel ?? null;
      setPayload.actionLabel = ctaLabel ?? null;
      setPayload.buttonLabel = ctaLabel ?? null;
    }
    if (mutation.startAt !== undefined) {
      setPayload.startAt = this.pickString(mutation.startAt) ?? null;
    }
    if (mutation.endAt !== undefined) {
      setPayload.endAt = this.pickString(mutation.endAt) ?? null;
    }
    if (mutation.stationName !== undefined) {
      setPayload.stationName = this.pickString(mutation.stationName) ?? null;
    }
    if (mutation.courtName !== undefined) {
      setPayload.courtName = this.pickString(mutation.courtName) ?? null;
    }
    if (mutation.levelLabel !== undefined) {
      setPayload.levelLabel = this.pickString(mutation.levelLabel) ?? null;
    }
    if (mutation.likesCount !== undefined) {
      setPayload.likesCount = this.pickCountNumber(mutation.likesCount) ?? 0;
    }
    if (mutation.commentsCount !== undefined) {
      setPayload.commentsCount = this.pickCountNumber(mutation.commentsCount) ?? 0;
    }
    if (mutation.priority !== undefined) {
      setPayload.priority = this.pickNumeric(mutation.priority) ?? 0;
    }
    if (mutation.placement !== undefined) {
      setPayload.placement = this.pickString(mutation.placement) ?? null;
    }
    if (mutation.authorName !== undefined) {
      setPayload.authorName = this.pickString(mutation.authorName) ?? null;
    }
    if (mutation.participants !== undefined) {
      setPayload.participants = mutation.participants
        .map((entry) => this.normalizeFeedParticipantInput(entry))
        .filter((entry): entry is CommunityFeedParticipant => entry !== null);
    }
    if (mutation.tags !== undefined) {
      setPayload.tags = this.dedupeStrings(mutation.tags ?? []);
    }
    if (mutation.details !== undefined) {
      setPayload.details = this.isRecord(mutation.details) ? mutation.details : null;
    }
    if (actor) {
      setPayload.updatedBy = actor;
    }

    const collections = await this.readFeedCollections();
    for (const candidate of collections) {
      try {
        const filter = {
          $and: [
            this.buildCommunityFeedFilter(communityId),
            this.buildFeedItemFilter(feedItemId)
          ]
        } as Filter<MongoCommunityFeedDocument>;
        const existing = await candidate.collection.findOne(filter);
        if (!existing) {
          continue;
        }
        const updated = {
          ...existing,
          ...setPayload
        } as MongoCommunityFeedDocument;
        await candidate.collection.updateOne(
          existing._id !== undefined
            ? ({ _id: existing._id } as Filter<MongoCommunityFeedDocument>)
            : filter,
          { $set: setPayload }
        );
        await this.clearFeedItemModeration(communityId, feedItemId);
        return this.toFeedItem(updated);
      } catch (error) {
        this.logger.warn(
          `Failed to update feed item ${feedItemId} in ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }

    const override = await this.upsertFeedItemOverride(communityId, feedItemId, mutation);
    return this.toFeedModerationItem(override);
  }

  async deleteFeedItem(
    communityId: string,
    feedItemId: string
  ): Promise<CommunitiesDeleteFeedItemResult> {
    const collections = await this.readFeedCollections();
    let deleted = false;
    for (const candidate of collections) {
      try {
        const result = await candidate.collection.deleteMany({
          $and: [
            this.buildCommunityFeedFilter(communityId),
            this.buildFeedItemFilter(feedItemId)
          ]
        } as Filter<MongoCommunityFeedDocument>);
        if ((result.deletedCount ?? 0) > 0) {
          deleted = true;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to delete feed item ${feedItemId} from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }
    if (deleted) {
      await this.clearFeedItemModeration(communityId, feedItemId);
      return {
        ok: true,
        mode: 'deleted'
      };
    }

    await this.suppressFeedItem(communityId, feedItemId);
    return {
      ok: true,
      mode: 'suppressed'
    };
  }

  private async primaryCollection(): Promise<Collection<MongoCommunityDocument>> {
    const dbName = this.mongoDbNames[0] || 'games';
    const collectionName = this.collectionNames[0] || 'lk_communities';
    return this.collection(dbName, collectionName);
  }

  private async primaryFeedCollection(): Promise<Collection<MongoCommunityFeedDocument>> {
    const dbName = this.feedMongoDbNames[0] || 'games';
    const collectionName = this.feedCollectionNames[0] || 'lk_community_feed';
    return this.feedCollection(dbName, collectionName);
  }

  private async primaryFeedModerationCollection(): Promise<Collection<MongoCommunityFeedModerationDocument>> {
    const dbName = this.feedMongoDbNames[0] || 'games';
    const collectionName = this.feedModerationCollectionNames[0] || 'lk_community_feed_moderation';
    return this.feedModerationCollection(dbName, collectionName);
  }

  private async database(dbName: string): Promise<Db> {
    if (!this.mongoUri) {
      throw new InternalServerErrorException(
        'Communities MongoDB access requires COMMUNITIES_MONGODB_URI or MONGODB_URI'
      );
    }

    if (!this.client) {
      this.client = new MongoClient(this.mongoUri, {
        serverSelectionTimeoutMS: 5_000,
        maxPoolSize: 10
      });
      try {
        await this.client.connect();
        this.logger.log('MongoDB communities source enabled');
      } catch (error) {
        this.client = undefined;
        this.dbsByName.clear();
        this.logger.error(`Mongo connect failed for communities source: ${String(error)}`);
        throw new InternalServerErrorException(
          'MongoDB connection failed for communities source'
        );
      }
    }

    if (!this.client) {
      throw new InternalServerErrorException('MongoDB communities client is unavailable');
    }

    const existingDb = this.dbsByName.get(dbName);
    if (existingDb) {
      return existingDb;
    }

    const db = this.client.db(dbName);
    this.dbsByName.set(dbName, db);
    return db;
  }

  private async collection(
    dbName: string,
    collectionName: string
  ): Promise<Collection<MongoCommunityDocument>> {
    const db = await this.database(dbName);
    return db.collection<MongoCommunityDocument>(collectionName);
  }

  private async feedCollection(
    dbName: string,
    collectionName: string
  ): Promise<Collection<MongoCommunityFeedDocument>> {
    const db = await this.database(dbName);
    return db.collection<MongoCommunityFeedDocument>(collectionName);
  }

  private async feedModerationCollection(
    dbName: string,
    collectionName: string
  ): Promise<Collection<MongoCommunityFeedModerationDocument>> {
    const db = await this.database(dbName);
    return db.collection<MongoCommunityFeedModerationDocument>(collectionName);
  }

  private buildIdFilter(id: string): Filter<MongoCommunityDocument> {
    const normalizedId = String(id ?? '').trim();
    const variants: Record<string, unknown>[] = [
      { id: normalizedId },
      { communityId: normalizedId }
    ];

    if (ObjectId.isValid(normalizedId)) {
      variants.push({ _id: new ObjectId(normalizedId) });
    }

    return {
      $or: variants
    } as Filter<MongoCommunityDocument>;
  }

  private buildCommunityFeedFilter(communityId: string): Filter<MongoCommunityFeedDocument> {
    const normalizedId = String(communityId ?? '').trim();
    return {
      $or: [
        { communityId: normalizedId },
        { community_id: normalizedId },
        { sourceCommunityId: normalizedId }
      ]
    } as Filter<MongoCommunityFeedDocument>;
  }

  private buildFeedItemFilter(feedItemId: string): Filter<MongoCommunityFeedDocument> {
    const normalizedId = String(feedItemId ?? '').trim();
    const variants: Record<string, unknown>[] = [
      { id: normalizedId },
      { feedItemId: normalizedId },
      { itemId: normalizedId },
      { postId: normalizedId },
      { uuid: normalizedId }
    ];
    if (ObjectId.isValid(normalizedId)) {
      variants.push({ _id: new ObjectId(normalizedId) });
    }
    return {
      $or: variants
    } as Filter<MongoCommunityFeedDocument>;
  }

  private buildFeedItemModerationFilter(
    communityId: string,
    feedItemId: string
  ): Filter<MongoCommunityFeedModerationDocument> {
    return {
      $and: [
        this.buildCommunityFeedFilter(communityId) as Filter<MongoCommunityFeedModerationDocument>,
        this.buildFeedItemFilter(feedItemId) as Filter<MongoCommunityFeedModerationDocument>
      ]
    } as Filter<MongoCommunityFeedModerationDocument>;
  }

  private async readCollections(
    fallback: Collection<MongoCommunityDocument>
  ): Promise<
    Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityDocument>;
    }>
  > {
    const result: Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityDocument>;
    }> = [];

    for (const dbName of this.mongoDbNames.length > 0 ? this.mongoDbNames : ['games']) {
      for (const collectionName of this.collectionNames.length > 0
        ? this.collectionNames
        : ['lk_communities']) {
        result.push({
          dbName: dbName,
          collectionName: collectionName,
          collection: await this.collection(dbName, collectionName)
        });
      }
    }

    if (result.length === 0) {
      result.push({
        dbName: 'games',
        collectionName: 'lk_communities',
        collection: fallback
      });
    }

    return result;
  }

  private async readFeedCollections(): Promise<
    Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityFeedDocument>;
    }>
  > {
    const result: Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityFeedDocument>;
    }> = [];

    for (const dbName of this.feedMongoDbNames.length > 0 ? this.feedMongoDbNames : ['games']) {
      for (const collectionName of this.feedCollectionNames.length > 0
        ? this.feedCollectionNames
        : ['lk_community_feed']) {
        result.push({
          dbName,
          collectionName,
          collection: await this.feedCollection(dbName, collectionName)
        });
      }
    }

    if (result.length === 0) {
      result.push({
        dbName: 'games',
        collectionName: 'lk_community_feed',
        collection: await this.feedCollection('games', 'lk_community_feed')
      });
    }

    return result;
  }

  private async readFeedModerationCollections(): Promise<
    Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityFeedModerationDocument>;
    }>
  > {
    const result: Array<{
      dbName: string;
      collectionName: string;
      collection: Collection<MongoCommunityFeedModerationDocument>;
    }> = [];

    for (const dbName of this.feedMongoDbNames.length > 0 ? this.feedMongoDbNames : ['games']) {
      for (const collectionName of this.feedModerationCollectionNames.length > 0
        ? this.feedModerationCollectionNames
        : ['lk_community_feed_moderation']) {
        result.push({
          dbName,
          collectionName,
          collection: await this.feedModerationCollection(dbName, collectionName)
        });
      }
    }

    if (result.length === 0) {
      result.push({
        dbName: 'games',
        collectionName: 'lk_community_feed_moderation',
        collection: await this.feedModerationCollection('games', 'lk_community_feed_moderation')
      });
    }

    return result;
  }

  private async findDocumentWithSourceById(
    id: string
  ): Promise<{
    document: MongoCommunityDocument;
    collection: Collection<MongoCommunityDocument>;
    dbName: string;
    collectionName: string;
  } | null> {
    const fallback = await this.primaryCollection();
    const candidates = await this.readCollections(fallback);
    const filter = this.buildIdFilter(id);

    for (const candidate of candidates) {
      const document = await candidate.collection.findOne(filter);
      if (document) {
        return {
          document: document,
          collection: candidate.collection,
          dbName: candidate.dbName,
          collectionName: candidate.collectionName
        };
      }
    }

    return null;
  }

  private async persistDocument(
    document: MongoCommunityDocument,
    collection: Collection<MongoCommunityDocument>
  ): Promise<void> {
    const identifier = document._id ?? this.pickString(document.id) ?? this.pickString(document.communityId);
    const payload = { ...document };
    delete payload._id;

    if (document._id !== undefined) {
      await collection.updateOne(
        { _id: document._id } as Filter<MongoCommunityDocument>,
        { $set: payload }
      );
      return;
    }

    if (!identifier) {
      throw new InternalServerErrorException('Community document id is missing');
    }

    await collection.updateOne(this.buildIdFilter(String(identifier)), { $set: payload });
  }

  private toCommunity(document: MongoCommunityDocument): Community | null {
    const id =
      this.pickString(document.id)
      ?? this.pickString(document.communityId)
      ?? this.pickString(document.uuid)
      ?? this.readObjectId(document._id);
    const name = this.pickString(document.name) ?? this.pickString(document.title);
    if (!id || !name) {
      return null;
    }

    const members = this.toObjectArray(document.members)
      .map((entry) => this.normalizeMember(entry, 'ACTIVE'))
      .filter((entry): entry is CommunityMember => entry !== null);
    const pendingMembers = this.toObjectArray(document.pendingMembers)
      .map((entry) => this.normalizeMember(entry, 'PENDING'))
      .filter((entry): entry is CommunityMember => entry !== null);
    const bannedMembers = this.toObjectArray(document.bannedMembers)
      .map((entry) => this.normalizeMember(entry, 'BANNED'))
      .filter((entry): entry is CommunityMember => entry !== null);

    const visibility = this.normalizeVisibility(document.visibility);
    const rawStatus =
      this.pickString(document.status)
      ?? this.pickString(document.state)
      ?? (document.archived === true ? 'ARCHIVED' : visibility);
    const inviteCode = this.pickString(document.inviteCode) ?? this.pickString(document.code);
    const inviteLink =
      this.pickString(document.inviteLink)
      ?? this.pickString(document.link)
      ?? (inviteCode ? `${this.inviteBaseUrl.replace(/\/?$/, '/')}${inviteCode}` : undefined);
    const focusTags = this.dedupeStrings(
      this.toStringArray(document.focusTags).concat(this.toStringArray(document.tags))
    );

    return {
      id,
      source: 'MONGODB',
      name,
      slug: this.pickString(document.slug) ?? undefined,
      isVerified: this.pickBoolean(
        document.isVerified
        ?? document.verified
        ?? document.isOfficial
        ?? document.official
      ) ?? undefined,
      logo: this.pickNullableString(document.logo),
      description:
        this.pickString(document.description) ?? this.pickString(document.body) ?? undefined,
      city: this.pickString(document.city) ?? undefined,
      status: this.resolveCommunityStatus(document, rawStatus, visibility),
      rawStatus: rawStatus ?? undefined,
      visibility,
      joinRule: this.normalizeJoinRule(document.joinRule, visibility),
      minimumLevel:
        this.pickString(document.minimumLevel)
        ?? this.pickString(document.levelFrom)
        ?? undefined,
      rules:
        this.pickString(document.rules) ?? this.pickString(document.policy) ?? undefined,
      inviteCode: inviteCode ?? undefined,
      inviteLink: inviteLink ?? undefined,
      membersCount:
        this.pickCountNumber(document.memberCount)
        ?? this.pickCountNumber(document.membersCount)
        ?? members.length,
      moderatorsCount:
        members.filter((entry) => entry.role === 'OWNER' || entry.role === 'ADMIN').length,
      postsCount:
        this.pickCountNumber(document.postsCount)
        ?? this.pickCountNumber(document.feedCount)
        ?? this.pickCountNumber(document.publicationsCount),
      pendingRequestsCount:
        this.pickCountNumber(document.pendingCount) ?? pendingMembers.length,
      bannedMembersCount: bannedMembers.length,
      createdAt: this.pickString(document.createdAt) ?? undefined,
      updatedAt: this.pickString(document.updatedAt) ?? undefined,
      lastActivityAt:
        this.pickString(document.lastActivityAt)
        ?? this.pickString(document.lastPostAt)
        ?? this.pickString(document.updatedAt)
        ?? undefined,
      publicUrl: inviteLink ?? undefined,
      tags: focusTags,
      focusTags,
      createdBy: this.normalizeActor(document.createdBy),
      members,
      pendingMembers,
      bannedMembers,
      details: this.stripObjectId(document)
    };
  }

  private toFeedItem(document: MongoCommunityFeedDocument): CommunityFeedItem | null {
    const id =
      this.pickString(document.id)
      ?? this.pickString(document.feedItemId)
      ?? this.pickString(document.itemId)
      ?? this.readObjectId(document._id);
    const communityId =
      this.pickString(document.communityId)
      ?? this.pickString(document.community_id)
      ?? this.pickString(document.sourceCommunityId);
    const title =
      this.pickString(document.title)
      ?? this.pickString(document.name)
      ?? this.pickString(document.header);
    if (!id || !communityId || !title) {
      return null;
    }

    const kind = this.normalizeFeedItemKind(
      document.kind
      ?? document.type
      ?? (document.isAdvertisement === true || document.ad === true ? 'AD' : undefined)
    );
    const participants = this.toObjectArray(document.participants)
      .map((entry) => this.normalizeFeedParticipant(entry))
      .filter((entry): entry is CommunityFeedParticipant => entry !== null);

    return {
      id,
      communityId,
      kind,
      status: this.normalizeFeedItemStatus(document.status),
      title,
      body:
        this.pickString(document.body)
        ?? this.pickString(document.description)
        ?? this.pickString(document.content)
        ?? undefined,
      imageUrl:
        this.pickNullableString(document.imageUrl ?? document.image ?? document.photo) ?? undefined,
      previewLabel:
        this.pickString(document.previewLabel)
        ?? this.pickString(document.label)
        ?? undefined,
      ctaLabel:
        this.pickString(document.ctaLabel)
        ?? this.pickString(document.actionLabel)
        ?? this.pickString(document.buttonLabel)
        ?? undefined,
      startAt:
        this.pickString(document.startAt)
        ?? this.pickString(document.startsAt)
        ?? undefined,
      endAt:
        this.pickString(document.endAt)
        ?? this.pickString(document.endsAt)
        ?? undefined,
      stationName:
        this.pickString(document.stationName)
        ?? this.pickString(document.clubName)
        ?? undefined,
      courtName:
        this.pickString(document.courtName)
        ?? this.pickString(document.court)
        ?? this.pickString(document.venueName)
        ?? undefined,
      levelLabel:
        this.pickString(document.levelLabel)
        ?? this.pickString(document.rating)
        ?? this.pickString(document.level)
        ?? undefined,
      reportsCount: this.pickCountNumber(document.reportsCount ?? document.flagsCount) ?? 0,
      likesCount:
        this.pickCountNumber(document.likesCount ?? document.likes ?? document.reactionsCount) ?? 0,
      commentsCount:
        this.pickCountNumber(document.commentsCount ?? document.comments ?? document.repliesCount) ?? 0,
      isAdvertisement:
        this.pickBoolean(document.isAdvertisement ?? document.ad)
        ?? kind === 'AD',
      priority: this.pickNumeric(document.priority),
      placement: this.pickString(document.placement) ?? undefined,
      tags: this.toStringArray(document.tags),
      authorName:
        this.pickString(document.authorName)
        ?? this.pickString(document.memberName)
        ?? undefined,
      createdBy: this.normalizeActor(document.createdBy),
      participants,
      createdAt: this.pickString(document.createdAt) ?? undefined,
      updatedAt: this.pickString(document.updatedAt) ?? undefined,
      publishedAt:
        this.pickString(document.publishedAt)
        ?? this.pickString(document.createdAt)
        ?? undefined,
      details: this.stripFeedObjectId(document)
    };
  }

  private toFeedModerationItem(document: MongoCommunityFeedModerationDocument): CommunityFeedItem | null {
    const action = String(document.action ?? '').trim().toUpperCase();
    const suppressed = document.suppressed === true || action === 'DELETE';
    const id =
      this.pickString(document.feedItemId)
      ?? this.pickString(document.itemId)
      ?? this.pickString(document.postId)
      ?? this.pickString(document.uuid)
      ?? this.pickString(document.id);
    const communityId =
      this.pickString(document.communityId)
      ?? this.pickString(document.community_id)
      ?? this.pickString(document.sourceCommunityId);
    if (!id || !communityId) {
      return null;
    }

    const kind = this.normalizeFeedItemKind(
      document.kind
      ?? document.type
      ?? (document.isAdvertisement === true || document.ad === true ? 'AD' : undefined)
    );
    const participants = this.toObjectArray(document.participants)
      .map((entry) => this.normalizeFeedParticipant(entry))
      .filter((entry): entry is CommunityFeedParticipant => entry !== null);
    if (suppressed) {
      return {
        id,
        communityId,
        kind,
        status: 'HIDDEN',
        title: this.pickString(document.title) ?? `suppressed:${id}`,
        updatedAt: this.pickString(document.updatedAt) ?? undefined,
        publishedAt:
          this.pickString(document.updatedAt)
          ?? this.pickString(document.createdAt)
          ?? undefined,
        details: {
          ...this.stripFeedModerationObjectId(document),
          source: 'COMMUNITY_MODERATION',
          moderationAction: 'DELETE',
          suppressed: true
        }
      };
    }

    return {
      id,
      communityId,
      kind,
      status: this.normalizeFeedItemStatus(document.status ?? 'PUBLISHED'),
      title: this.pickString(document.title) ?? `override:${id}`,
      body:
        this.pickString(document.body)
        ?? this.pickString(document.description)
        ?? this.pickString(document.content)
        ?? undefined,
      imageUrl:
        this.pickNullableString(document.imageUrl ?? document.image ?? document.photo) ?? undefined,
      previewLabel:
        this.pickString(document.previewLabel)
        ?? this.pickString(document.label)
        ?? undefined,
      ctaLabel:
        this.pickString(document.ctaLabel)
        ?? this.pickString(document.actionLabel)
        ?? this.pickString(document.buttonLabel)
        ?? undefined,
      startAt:
        this.pickString(document.startAt)
        ?? this.pickString(document.startsAt)
        ?? undefined,
      endAt:
        this.pickString(document.endAt)
        ?? this.pickString(document.endsAt)
        ?? undefined,
      stationName:
        this.pickString(document.stationName)
        ?? this.pickString(document.clubName)
        ?? undefined,
      courtName:
        this.pickString(document.courtName)
        ?? this.pickString(document.court)
        ?? this.pickString(document.venueName)
        ?? undefined,
      levelLabel:
        this.pickString(document.levelLabel)
        ?? this.pickString(document.rating)
        ?? this.pickString(document.level)
        ?? undefined,
      reportsCount: this.pickCountNumber(document.reportsCount ?? document.flagsCount) ?? 0,
      likesCount:
        this.pickCountNumber(document.likesCount ?? document.likes ?? document.reactionsCount) ?? 0,
      commentsCount:
        this.pickCountNumber(document.commentsCount ?? document.comments ?? document.repliesCount) ?? 0,
      isAdvertisement:
        this.pickBoolean(document.isAdvertisement ?? document.ad)
        ?? kind === 'AD',
      priority: this.pickNumeric(document.priority),
      placement: this.pickString(document.placement) ?? undefined,
      tags: this.toStringArray(document.tags),
      authorName:
        this.pickString(document.authorName)
        ?? this.pickString(document.memberName)
        ?? undefined,
      createdBy: this.normalizeActor(document.createdBy),
      participants,
      updatedAt: this.pickString(document.updatedAt) ?? undefined,
      publishedAt:
        this.pickString(document.updatedAt)
        ?? this.pickString(document.createdAt)
        ?? undefined,
      details: {
        ...this.stripFeedModerationObjectId(document),
        source: 'COMMUNITY_MODERATION',
        moderationAction: action || 'UPDATE',
        override: true
      }
    };
  }

  private resolveCommunityStatus(
    document: MongoCommunityDocument,
    rawStatus: string | null,
    visibility: CommunityVisibility
  ): CommunityStatus {
    if (document.archived === true) {
      return CommunityStatus.ARCHIVED;
    }

    const normalized = String(rawStatus ?? '').trim().toUpperCase();
    if (!normalized) {
      return visibility === 'CLOSED' ? CommunityStatus.PRIVATE : CommunityStatus.ACTIVE;
    }
    if (['DRAFT', 'NEW', 'CREATED'].includes(normalized)) {
      return CommunityStatus.DRAFT;
    }
    if (['ACTIVE', 'OPEN', 'PUBLIC'].includes(normalized)) {
      return CommunityStatus.ACTIVE;
    }
    if (['MODERATION', 'REVIEW', 'PENDING', 'PENDING_REVIEW'].includes(normalized)) {
      return CommunityStatus.MODERATION;
    }
    if (['PAUSED', 'ON_PAUSE', 'FROZEN'].includes(normalized)) {
      return CommunityStatus.PAUSED;
    }
    if (['HIDDEN', 'SHADOW', 'INVISIBLE'].includes(normalized)) {
      return CommunityStatus.HIDDEN;
    }
    if (['PRIVATE', 'CLOSED', 'LOCKED', 'HIDDEN'].includes(normalized)) {
      return CommunityStatus.PRIVATE;
    }
    if (['ARCHIVED', 'DELETED', 'DISABLED'].includes(normalized)) {
      return CommunityStatus.ARCHIVED;
    }
    return visibility === 'CLOSED' ? CommunityStatus.PRIVATE : CommunityStatus.ACTIVE;
  }

  private normalizeActor(value: unknown): CommunityActor | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const id =
      this.pickString(value.id) ?? this.pickString(value.clientId) ?? this.pickString(value.userId);
    const phone = this.normalizePhone(value.phone ?? value.phoneNorm ?? value.phoneNumber);
    const name =
      this.pickString(value.name)
      ?? this.pickString(value.displayName)
      ?? this.joinNameParts(value.firstName, value.lastName);

    if (!id && !phone && !name) {
      return undefined;
    }

    return {
      id: id ?? undefined,
      phone: phone ?? undefined,
      name: name ?? undefined
    };
  }

  private normalizeMember(
    value: unknown,
    fallbackStatus: CommunityMemberStatus
  ): CommunityMember | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const id =
      this.pickString(value.id) ?? this.pickString(value.clientId) ?? this.pickString(value.userId);
    const phone = this.normalizePhone(value.phone ?? value.phoneNorm ?? value.phoneNumber);
    const name =
      this.pickString(value.name)
      ?? this.pickString(value.displayName)
      ?? this.joinNameParts(value.firstName, value.lastName);
    if (!id && !phone && !name) {
      return null;
    }

      return {
        id: id ?? undefined,
        phone: phone ?? undefined,
        name: name ?? 'Игрок',
        avatar: this.pickNullableString(value.avatar ?? value.photo ?? value.imageUrl),
        role: this.normalizeRole(value.role),
        status: this.normalizeMemberStatus(value.status, fallbackStatus),
        levelScore: this.pickNumeric(value.levelScore ?? value.ratingNumeric ?? value.levelNumeric),
        levelLabel:
          this.pickString(value.levelLabel)
          ?? this.pickString(value.rating)
          ?? this.pickString(value.level)
          ?? undefined,
      joinedAt:
        this.pickString(value.joinedAt) ?? this.pickString(value.createdAt) ?? undefined,
      lastActiveAt:
        this.pickString(value.lastActiveAt)
        ?? this.pickString(value.updatedAt)
        ?? this.pickString(value.lastSeenAt)
        ?? undefined,
      warningsCount: this.readWarningsCount(value) || undefined,
      complaintsCount:
        this.pickCountNumber(value.complaintsCount)
        ?? this.pickCountNumber(value.reportsCount)
        ?? this.pickCountNumber(value.flagsCount)
        ?? undefined
    };
  }

  private buildStoredMember(
    existing: Record<string, unknown> | null,
    incoming: CommunityMemberMutationInput,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const base = this.isRecord(existing) ? { ...existing } : {};
    const id =
      this.pickString(incoming.id) ?? this.pickString(base.id) ?? this.pickString(base.clientId);
    const phone =
      this.normalizePhone(incoming.phone)
      ?? this.normalizePhone(base.phone ?? base.phoneNorm ?? base.phoneNumber);
    const name =
      this.pickString(incoming.name)
      ?? this.pickString(base.name)
      ?? this.pickString(base.displayName)
      ?? 'Игрок';
    const role = incoming.role ?? this.normalizeRole(base.role);
    const status =
      incoming.status ?? this.normalizeMemberStatus(base.status, 'ACTIVE');
    const levelScore =
      typeof incoming.levelScore === 'number'
        ? incoming.levelScore
        : this.pickNumeric(base.levelScore ?? base.ratingNumeric ?? base.levelNumeric);
    const levelLabel =
      this.pickString(incoming.levelLabel)
      ?? this.pickString(base.levelLabel)
      ?? this.pickString(base.rating)
      ?? this.pickString(base.level);
    const joinedAt =
      this.pickString(incoming.joinedAt)
      ?? this.pickString(base.joinedAt)
      ?? this.pickString(base.createdAt);
    const avatar =
      incoming.avatar !== undefined
        ? incoming.avatar
        : this.pickNullableString(base.avatar ?? base.photo ?? base.imageUrl);

    return {
      ...base,
      ...(id ? { id: id } : {}),
      ...(phone ? { phone: phone } : {}),
      name,
      avatar: avatar ?? null,
      role,
      status,
      ...(typeof levelScore === 'number' ? { levelScore: levelScore } : {}),
      ...(levelLabel ? { levelLabel: levelLabel } : {}),
      ...(joinedAt ? { joinedAt: joinedAt } : {}),
      ...overrides
    };
  }

  private sameMemberIdentity(
    left: unknown,
    right: CommunityMemberMutationInput | Record<string, unknown>
  ): boolean {
    const leftMember = this.normalizeMember(left, 'ACTIVE');
    const rightMember = this.normalizeMember(right, 'ACTIVE');
    if (!leftMember || !rightMember) {
      return false;
    }

    if (leftMember.id && rightMember.id) {
      return leftMember.id === rightMember.id;
    }
    if (leftMember.phone && rightMember.phone) {
      return leftMember.phone === rightMember.phone;
    }

    return (
      !leftMember.id &&
      !rightMember.id &&
      !leftMember.phone &&
      !rightMember.phone &&
      leftMember.name.trim().toLowerCase() === rightMember.name.trim().toLowerCase()
    );
  }

  private toActorRecord(actor: CommunityActor | undefined, fallbackTime: string) {
    const normalized = this.normalizeActor(actor);
    if (!normalized) {
      return undefined;
    }

    return {
      ...(normalized.id ? { id: normalized.id } : {}),
      ...(normalized.phone ? { phone: normalized.phone } : {}),
      ...(normalized.name ? { name: normalized.name } : {}),
      at: fallbackTime
    };
  }

  private normalizeVisibility(value: unknown): CommunityVisibility {
    return String(value ?? '').trim().toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN';
  }

  private normalizeJoinRule(
    value: unknown,
    visibility: CommunityVisibility
  ): CommunityJoinRule {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'MODERATED' || normalized === 'INVITE_ONLY' || normalized === 'INSTANT') {
      return normalized;
    }
    return visibility === 'CLOSED' ? 'INVITE_ONLY' : 'INSTANT';
  }

  private normalizeRole(value: unknown): CommunityMemberRole {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'MEMBER') {
      return normalized;
    }
    return 'MEMBER';
  }

  private normalizeMemberStatus(
    value: unknown,
    fallbackStatus: CommunityMemberStatus
  ): CommunityMemberStatus {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'PENDING' || normalized === 'ACTIVE' || normalized === 'BANNED') {
      return normalized;
    }
    return fallbackStatus;
  }

  private normalizeFeedItemKind(value: unknown): CommunityFeedItemKind {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (
      normalized === 'NEWS' ||
      normalized === 'GAME' ||
      normalized === 'TOURNAMENT' ||
      normalized === 'EVENT' ||
      normalized === 'AD'
    ) {
      return normalized;
    }
    if (['PROMO', 'ADVERTISEMENT', 'ADVERT', 'BANNER'].includes(normalized)) {
      return 'AD';
    }
    if (['POST', 'PHOTO', 'SYSTEM'].includes(normalized)) {
      return 'NEWS';
    }
    return 'NEWS';
  }

  private normalizeFeedItemStatus(value: unknown): CommunityFeedItemStatus {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'DRAFT' || normalized === 'PUBLISHED' || normalized === 'HIDDEN') {
      return normalized;
    }
    return 'PUBLISHED';
  }

  private normalizeFeedParticipant(value: unknown): CommunityFeedParticipant | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const id =
      this.pickString(value.id) ?? this.pickString(value.clientId) ?? this.pickString(value.userId);
    const name =
      this.pickString(value.name)
      ?? this.pickString(value.displayName)
      ?? this.joinNameParts(value.firstName, value.lastName);
    if (!name && !id) {
      return null;
    }

    return {
      id: id ?? undefined,
      name: name ?? 'Игрок',
      avatar: this.pickNullableString(value.avatar ?? value.avatarUrl ?? value.photo),
      shortName: this.pickString(value.shortName) ?? undefined,
      levelLabel:
        this.pickString(value.levelLabel)
        ?? this.pickString(value.rating)
        ?? this.pickString(value.level)
        ?? undefined
    };
  }

  private normalizeFeedParticipantInput(value: CommunityFeedParticipantInput): CommunityFeedParticipant | null {
    const name = this.pickString(value.name);
    if (!name) {
      return null;
    }

    return {
      id: this.pickString(value.id) ?? undefined,
      name,
      avatar: value.avatar === null ? null : this.pickNullableString(value.avatar),
      shortName: name.slice(0, 1).toUpperCase(),
      levelLabel: this.pickString(value.levelLabel) ?? undefined
    };
  }

  private readWarningsCount(value: unknown): number {
    if (!this.isRecord(value)) {
      return 0;
    }

    const explicit =
      this.pickCountNumber(value.warningsCount)
      ?? this.pickCountNumber(value.warningCount)
      ?? this.pickCountNumber(value.warnCount);
    if (explicit !== undefined) {
      return explicit;
    }

    if (Array.isArray(value.warnings)) {
      return value.warnings.length;
    }

    return 0;
  }

  private toObjectArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this.pickString(entry))
        .filter((entry): entry is string => Boolean(entry));
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  }

  private stripObjectId(value: MongoCommunityDocument): Record<string, unknown> {
    const result = { ...value } as Record<string, unknown>;
    delete result._id;
    return result;
  }

  private stripFeedObjectId(value: MongoCommunityFeedDocument): Record<string, unknown> {
    const result = { ...value } as Record<string, unknown>;
    delete result._id;
    return result;
  }

  private stripFeedModerationObjectId(
    value: MongoCommunityFeedModerationDocument
  ): Record<string, unknown> {
    const result = { ...value } as Record<string, unknown>;
    delete result._id;
    return result;
  }

  private async suppressFeedItem(communityId: string, feedItemId: string): Promise<void> {
    const now = new Date().toISOString();
    const collections = await this.readFeedModerationCollections();
    let lastError: unknown;

    for (const candidate of collections) {
      try {
        await candidate.collection.updateOne(
          this.buildFeedItemModerationFilter(communityId, feedItemId),
          {
            $set: {
              id: `${communityId}:${feedItemId}:DELETE`,
              communityId,
              community_id: communityId,
              sourceCommunityId: communityId,
              feedItemId,
              itemId: feedItemId,
              postId: feedItemId,
              uuid: feedItemId,
              source: 'COMMUNITY_MODERATION',
              action: 'DELETE',
              status: 'HIDDEN',
              kind: 'NEWS',
              title: `suppressed:${feedItemId}`,
              suppressed: true,
              updatedAt: now,
              details: {
                source: 'COMMUNITY_MODERATION',
                moderationAction: 'DELETE',
                suppressed: true
              }
            },
            $setOnInsert: {
              createdAt: now
            }
          },
          { upsert: true }
        );
        return;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Failed to write feed moderation tombstone to ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  private async upsertFeedItemOverride(
    communityId: string,
    feedItemId: string,
    mutation: CommunitiesUpdateFeedItemMutation
  ): Promise<MongoCommunityFeedModerationDocument> {
    const collection = await this.primaryFeedModerationCollection();
    const now = new Date().toISOString();
    const actor = this.toActorRecord(mutation.actor, now);
    const kind = mutation.kind ?? 'NEWS';
    const participants = (mutation.participants ?? [])
      .map((entry) => this.normalizeFeedParticipantInput(entry))
      .filter((entry): entry is CommunityFeedParticipant => entry !== null);
    const payload: MongoCommunityFeedModerationDocument = {
      id: `${communityId}:${feedItemId}:UPDATE`,
      communityId,
      community_id: communityId,
      sourceCommunityId: communityId,
      feedItemId,
      itemId: feedItemId,
      postId: feedItemId,
      uuid: feedItemId,
      source: 'COMMUNITY_MODERATION',
      action: 'UPDATE',
      status: 'PUBLISHED',
      kind,
      type: kind,
      title: this.pickString(mutation.title) ?? 'Публикация сообщества',
      body: this.pickString(mutation.body) ?? null,
      description: this.pickString(mutation.body) ?? null,
      content: this.pickString(mutation.body) ?? null,
      imageUrl: this.pickNullableString(mutation.imageUrl) ?? null,
      image: this.pickNullableString(mutation.imageUrl) ?? null,
      photo: this.pickNullableString(mutation.imageUrl) ?? null,
      previewLabel: this.pickString(mutation.previewLabel) ?? null,
      label: this.pickString(mutation.previewLabel) ?? null,
      ctaLabel: this.pickString(mutation.ctaLabel) ?? null,
      actionLabel: this.pickString(mutation.ctaLabel) ?? null,
      buttonLabel: this.pickString(mutation.ctaLabel) ?? null,
      startAt: this.pickString(mutation.startAt) ?? null,
      endAt: this.pickString(mutation.endAt) ?? null,
      stationName: this.pickString(mutation.stationName) ?? null,
      courtName: this.pickString(mutation.courtName) ?? null,
      levelLabel: this.pickString(mutation.levelLabel) ?? null,
      likesCount: this.pickCountNumber(mutation.likesCount) ?? 0,
      commentsCount: this.pickCountNumber(mutation.commentsCount) ?? 0,
      reportsCount: 0,
      isAdvertisement: kind === 'AD',
      ad: kind === 'AD',
      placement: this.pickString(mutation.placement) ?? 'feed',
      priority: this.pickNumeric(mutation.priority) ?? 0,
      tags: this.dedupeStrings(mutation.tags ?? []),
      participants,
      authorName: this.pickString(mutation.authorName) ?? 'Админка',
      createdBy: actor ?? undefined,
      updatedBy: actor ?? undefined,
      updatedAt: now,
      details: this.isRecord(mutation.details) ? mutation.details : undefined
    };

    await collection.updateOne(
      this.buildFeedItemModerationFilter(communityId, feedItemId),
      {
        $set: payload,
        $setOnInsert: {
          createdAt: now,
          publishedAt: now
        }
      },
      { upsert: true }
    );

    return {
      ...payload,
      createdAt: now,
      publishedAt: now
    };
  }

  private async clearFeedItemModeration(communityId: string, feedItemId: string): Promise<void> {
    const collections = await this.readFeedModerationCollections();
    for (const candidate of collections) {
      try {
        await candidate.collection.deleteMany(
          this.buildFeedItemModerationFilter(communityId, feedItemId)
        );
      } catch (error) {
        this.logger.warn(
          `Failed to clear feed moderation for ${feedItemId} from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }
  }

  private async deleteCommunityFeedArtifacts(communityId: string): Promise<void> {
    const feedCollections = await this.readFeedCollections();
    for (const candidate of feedCollections) {
      try {
        await candidate.collection.deleteMany(this.buildCommunityFeedFilter(communityId));
      } catch (error) {
        this.logger.warn(
          `Failed to cleanup community feed from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }

    const moderationCollections = await this.readFeedModerationCollections();
    for (const candidate of moderationCollections) {
      try {
        await candidate.collection.deleteMany(
          this.buildCommunityFeedFilter(communityId) as Filter<MongoCommunityFeedModerationDocument>
        );
      } catch (error) {
        this.logger.warn(
          `Failed to cleanup community feed moderation from ${candidate.dbName}.${candidate.collectionName}: ${String(error)}`
        );
      }
    }
  }

  private normalizePhone(value: unknown): string | null {
    const digits = String(value ?? '').replace(/\D+/g, '');
    if (!digits) {
      return null;
    }
    if (digits.length === 10) {
      return `7${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `7${digits.slice(1)}`;
    }
    return digits;
  }

  private joinNameParts(firstName: unknown, lastName: unknown): string | null {
    const parts = [this.pickString(firstName), this.pickString(lastName)].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  private readObjectId(value: unknown): string | null {
    if (value instanceof ObjectId) {
      return value.toHexString();
    }
    return null;
  }

  private pickString(value: unknown): string | null {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private pickNullableString(value: unknown): string | null | undefined {
    if (value === null) {
      return null;
    }
    const normalized = this.pickString(value);
    return normalized ?? undefined;
  }

  private pickBoolean(value: unknown): boolean | undefined {
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
    if (typeof value === 'string') {
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
    }
    return undefined;
  }

  private pickNumeric(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (!normalized) {
        return undefined;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private pickCountNumber(value: unknown): number | undefined {
    const parsed = this.pickNumeric(value);
    if (typeof parsed !== 'number') {
      return undefined;
    }
    return Math.max(0, Math.trunc(parsed));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readEnv(name: string): string | undefined {
    const value = String(process.env[name] ?? '').trim();
    return value || undefined;
  }

  private dedupeStrings(values: Array<string | undefined>): string[] {
    return Array.from(
      new Set(
        values
          .map((entry) => String(entry ?? '').trim())
          .filter((entry) => entry.length > 0)
      )
    );
  }

  private dedupeFeedItems(items: CommunityFeedItem[]): CommunityFeedItem[] {
    const map = new Map<string, CommunityFeedItem>();
    items.forEach((item) => {
      map.set(item.id, item);
    });
    return Array.from(map.values());
  }
}
