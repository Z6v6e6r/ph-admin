import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy
} from '@nestjs/common';
import { Collection, Db, Document, Filter, MongoClient, ObjectId } from 'mongodb';
import {
  Community,
  CommunityActor,
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

export interface CommunitiesUpdateMutation {
  name?: string;
  description?: string;
  city?: string;
  visibility?: CommunityVisibility;
  joinRule?: CommunityJoinRule;
  minimumLevel?: string;
  rules?: string;
  logo?: string | null;
  focusTags?: string[];
}

export type CommunityMemberManageAction = 'APPROVE' | 'REMOVE' | 'BAN';

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
  private readonly mongoDbName =
    this.readEnv('COMMUNITIES_MONGODB_DB')
    ?? this.readEnv('GAMES_MONGODB_DB')
    ?? this.readEnv('MONGODB_DB')
    ?? 'games';
  private readonly collectionName =
    this.readEnv('COMMUNITIES_MONGODB_COLLECTION') ?? 'lk_communities';
  private readonly inviteBaseUrl =
    this.readEnv('COMMUNITIES_INVITE_BASE_URL')
    ?? 'https://padlhub.ru/community/invite/';
  private client?: MongoClient;
  private db?: Db;

  isEnabled(): boolean {
    return Boolean(this.mongoUri);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.close().catch(() => undefined);
    this.client = undefined;
    this.db = undefined;
  }

  async listCommunities(): Promise<Community[]> {
    const collection = await this.collection();
    const items = await collection
      .find({ archived: { $ne: true } })
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .toArray();

    return items
      .map((item) => this.toCommunity(item))
      .filter((community): community is Community => community !== null);
  }

  async findCommunityById(id: string): Promise<Community | null> {
    const item = await this.findDocumentById(id);
    return item ? this.toCommunity(item) : null;
  }

  async updateCommunity(
    id: string,
    mutation: CommunitiesUpdateMutation
  ): Promise<Community | null> {
    const item = await this.findDocumentById(id);
    if (!item) {
      return null;
    }

    const updated: MongoCommunityDocument = { ...item };
    const now = new Date().toISOString();

    if (mutation.name !== undefined) {
      updated.name = mutation.name.trim();
    }
    if (mutation.description !== undefined) {
      updated.description = mutation.description.trim();
    }
    if (mutation.city !== undefined) {
      updated.city = mutation.city.trim();
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

    await this.persistDocument(updated);
    return this.toCommunity(updated);
  }

  async manageMember(
    id: string,
    mutation: CommunitiesManageMemberMutation
  ): Promise<Community | null> {
    const item = await this.findDocumentById(id);
    if (!item) {
      return null;
    }

    const updated: MongoCommunityDocument = { ...item };
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

    if (mutation.action === 'APPROVE') {
      updated.members = [
        this.buildStoredMember(existingMember, mutation.member, {
          status: 'ACTIVE',
          joinedAt:
            this.pickString(mutation.member.joinedAt)
            ?? this.pickString(existingMember?.joinedAt)
            ?? now
        }),
        ...membersFiltered
      ];
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

    await this.persistDocument(updated);
    return this.toCommunity(updated);
  }

  private async collection(): Promise<Collection<MongoCommunityDocument>> {
    const db = await this.database();
    return db.collection<MongoCommunityDocument>(this.collectionName);
  }

  private async database(): Promise<Db> {
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
        this.db = this.client.db(this.mongoDbName);
        this.logger.log(
          `MongoDB communities source enabled: db=${this.mongoDbName}, collection=${this.collectionName}`
        );
      } catch (error) {
        this.client = undefined;
        this.db = undefined;
        this.logger.error(`Mongo connect failed for communities source: ${String(error)}`);
        throw new InternalServerErrorException(
          'MongoDB connection failed for communities source'
        );
      }
    }

    if (!this.db) {
      throw new InternalServerErrorException('MongoDB communities database is unavailable');
    }

    return this.db;
  }

  private async findDocumentById(id: string): Promise<MongoCommunityDocument | null> {
    const collection = await this.collection();
    return collection.findOne(this.buildIdFilter(id));
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

  private async persistDocument(document: MongoCommunityDocument): Promise<void> {
    const collection = await this.collection();
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
      details: this.stripObjectId(document)
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
        this.pickString(value.joinedAt) ?? this.pickString(value.createdAt) ?? undefined
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

  private dedupeStrings(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((entry) => String(entry ?? '').trim())
          .filter((entry) => entry.length > 0)
      )
    );
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
}
