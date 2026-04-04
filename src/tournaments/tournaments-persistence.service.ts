import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy
} from '@nestjs/common';
import { Collection, Db, Document, Filter, MongoClient, ObjectId, OptionalId } from 'mongodb';
import {
  CustomTournament,
  Tournament,
  TournamentGender,
  TournamentParticipant,
  TournamentPaymentStatus,
  TournamentSkin,
  TournamentStatus
} from './tournaments.types';

type MongoCustomTournamentDocument = Document & {
  _id?: unknown;
};

export interface CreateCustomTournamentMutation {
  sourceTournamentId?: string;
  sourceTournamentSnapshot?: Record<string, unknown>;
  name: string;
  status?: TournamentStatus;
  startsAt?: string;
  endsAt?: string;
  tournamentType: string;
  accessLevels: string[];
  gender: TournamentGender;
  maxPlayers: number;
  participants: TournamentParticipant[];
  waitlist: TournamentParticipant[];
  allowedManagerPhones: string[];
  slug?: string;
  studioId?: string;
  studioName?: string;
  trainerId?: string;
  trainerName?: string;
  exerciseTypeId?: string;
  skin?: TournamentSkin;
}

export interface UpdateCustomTournamentMutation {
  name?: string;
  status?: TournamentStatus;
  startsAt?: string;
  endsAt?: string;
  tournamentType?: string;
  accessLevels?: string[];
  gender?: TournamentGender;
  maxPlayers?: number;
  participants?: TournamentParticipant[];
  waitlist?: TournamentParticipant[];
  allowedManagerPhones?: string[];
  slug?: string;
  studioId?: string;
  studioName?: string;
  trainerId?: string;
  trainerName?: string;
  exerciseTypeId?: string;
  skin?: TournamentSkin;
}

@Injectable()
export class TournamentsPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(TournamentsPersistenceService.name);
  private readonly mongoUri =
    this.readEnv('TOURNAMENTS_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbName = this.readEnv('TOURNAMENTS_MONGODB_DB') ?? 'tournaments';
  private readonly collectionName =
    this.readEnv('TOURNAMENTS_MONGODB_COLLECTION') ?? 'custom_tournaments';
  private readonly publicBaseUrl =
    this.readEnv('TOURNAMENTS_PUBLIC_BASE_URL') ?? '/api/tournaments/public/';
  private client?: MongoClient;
  private db?: Db;
  private indexesEnsured = false;

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
    this.indexesEnsured = false;
  }

  async listCustomTournaments(): Promise<CustomTournament[]> {
    const collection = await this.collection();
    const documents = (await collection
      .find({ archived: { $ne: true } })
      .sort({ startsAt: 1, updatedAt: -1, _id: -1 })
      .toArray()) as MongoCustomTournamentDocument[];

    return documents
      .map((document) => this.toCustomTournament(document))
      .filter((item): item is CustomTournament => Boolean(item));
  }

  async findCustomTournamentById(id: string): Promise<CustomTournament | null> {
    const collection = await this.collection();
    const document = (await collection.findOne(this.buildIdFilter(id))) as MongoCustomTournamentDocument | null;
    return document ? this.toCustomTournament(document) : null;
  }

  async findCustomTournamentBySlug(slug: string): Promise<CustomTournament | null> {
    const collection = await this.collection();
    const document = (await collection.findOne({
      slug: this.slugify(slug)
    } as Filter<MongoCustomTournamentDocument>)) as MongoCustomTournamentDocument | null;
    return document ? this.toCustomTournament(document) : null;
  }

  async findCustomTournamentBySourceTournamentId(
    sourceTournamentId: string
  ): Promise<CustomTournament | null> {
    const collection = await this.collection();
    const document = (await collection.findOne({
      sourceTournamentId: String(sourceTournamentId || '').trim()
    } as Filter<MongoCustomTournamentDocument>)) as MongoCustomTournamentDocument | null;
    return document ? this.toCustomTournament(document) : null;
  }

  async createCustomTournament(
    mutation: CreateCustomTournamentMutation
  ): Promise<CustomTournament> {
    const collection = await this.collection();
    const sourceTournamentId = this.pickString(mutation.sourceTournamentId);
    if (sourceTournamentId) {
      const existing = (await collection.findOne({
        sourceTournamentId
      } as Filter<MongoCustomTournamentDocument>)) as MongoCustomTournamentDocument | null;
      if (existing) {
        const existingTournament = this.toCustomTournament(existing);
        if (existingTournament) {
          return existingTournament;
        }
      }
    }

    const now = new Date().toISOString();
    const id = new ObjectId().toHexString();
    const slug = await this.ensureUniqueSlug(mutation.slug ?? mutation.name ?? id);
    const payload: MongoCustomTournamentDocument = {
      id,
      source: 'CUSTOM',
      slug,
      sourceTournamentId: sourceTournamentId ?? null,
      sourceTournamentSnapshot: this.isRecord(mutation.sourceTournamentSnapshot)
        ? mutation.sourceTournamentSnapshot
        : null,
      name: this.pickString(mutation.name) ?? `Турнир ${id}`,
      status: mutation.status ?? TournamentStatus.REGISTRATION,
      startsAt: this.pickString(mutation.startsAt) ?? null,
      endsAt: this.pickString(mutation.endsAt) ?? null,
      tournamentType: this.pickString(mutation.tournamentType) ?? 'AMERICANO',
      accessLevels: this.normalizeLevels(mutation.accessLevels),
      gender: this.normalizeGender(mutation.gender),
      maxPlayers: this.pickPositiveInteger(mutation.maxPlayers) ?? 8,
      participants: this.normalizeParticipants(mutation.participants, 'REGISTERED'),
      waitlist: this.normalizeParticipants(mutation.waitlist, 'WAITLIST'),
      allowedManagerPhones: this.normalizePhoneList(mutation.allowedManagerPhones),
      studioId: this.pickString(mutation.studioId) ?? null,
      studioName: this.pickString(mutation.studioName) ?? null,
      trainerId: this.pickString(mutation.trainerId) ?? null,
      trainerName: this.pickString(mutation.trainerName) ?? null,
      exerciseTypeId: this.pickString(mutation.exerciseTypeId) ?? null,
      skin: this.normalizeSkin(mutation.skin),
      createdAt: now,
      updatedAt: now,
      archived: false
    };

    await collection.insertOne(payload as OptionalId<MongoCustomTournamentDocument>);
    const created = this.toCustomTournament(payload);
    if (!created) {
      throw new InternalServerErrorException('Failed to create custom tournament');
    }
    return created;
  }

  async updateCustomTournament(
    id: string,
    mutation: UpdateCustomTournamentMutation
  ): Promise<CustomTournament | null> {
    const collection = await this.collection();
    const existing = (await collection.findOne(this.buildIdFilter(id))) as MongoCustomTournamentDocument | null;
    if (!existing) {
      return null;
    }

    const setPayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString()
    };

    if (mutation.name !== undefined) {
      setPayload.name = this.pickString(mutation.name) ?? null;
    }
    if (mutation.status !== undefined) {
      setPayload.status = mutation.status;
    }
    if (mutation.startsAt !== undefined) {
      setPayload.startsAt = this.pickString(mutation.startsAt) ?? null;
    }
    if (mutation.endsAt !== undefined) {
      setPayload.endsAt = this.pickString(mutation.endsAt) ?? null;
    }
    if (mutation.tournamentType !== undefined) {
      setPayload.tournamentType = this.pickString(mutation.tournamentType) ?? null;
    }
    if (mutation.accessLevels !== undefined) {
      setPayload.accessLevels = this.normalizeLevels(mutation.accessLevels);
    }
    if (mutation.gender !== undefined) {
      setPayload.gender = this.normalizeGender(mutation.gender);
    }
    if (mutation.maxPlayers !== undefined) {
      setPayload.maxPlayers = this.pickPositiveInteger(mutation.maxPlayers) ?? 8;
    }
    if (mutation.participants !== undefined) {
      setPayload.participants = this.normalizeParticipants(mutation.participants, 'REGISTERED');
    }
    if (mutation.waitlist !== undefined) {
      setPayload.waitlist = this.normalizeParticipants(mutation.waitlist, 'WAITLIST');
    }
    if (mutation.allowedManagerPhones !== undefined) {
      setPayload.allowedManagerPhones = this.normalizePhoneList(mutation.allowedManagerPhones);
    }
    if (mutation.slug !== undefined) {
      setPayload.slug = await this.ensureUniqueSlug(mutation.slug, id);
    }
    if (mutation.studioId !== undefined) {
      setPayload.studioId = this.pickString(mutation.studioId) ?? null;
    }
    if (mutation.studioName !== undefined) {
      setPayload.studioName = this.pickString(mutation.studioName) ?? null;
    }
    if (mutation.trainerId !== undefined) {
      setPayload.trainerId = this.pickString(mutation.trainerId) ?? null;
    }
    if (mutation.trainerName !== undefined) {
      setPayload.trainerName = this.pickString(mutation.trainerName) ?? null;
    }
    if (mutation.exerciseTypeId !== undefined) {
      setPayload.exerciseTypeId = this.pickString(mutation.exerciseTypeId) ?? null;
    }
    if (mutation.skin !== undefined) {
      setPayload.skin = this.normalizeSkin(mutation.skin);
    }

    await collection.updateOne(this.buildIdFilter(id), { $set: setPayload });
    return this.toCustomTournament({
      ...existing,
      ...setPayload
    });
  }

  private async collection(): Promise<Collection<MongoCustomTournamentDocument>> {
    if (!this.mongoUri) {
      throw new InternalServerErrorException(
        'Custom tournaments MongoDB requires TOURNAMENTS_MONGODB_URI or MONGODB_URI'
      );
    }

    if (!this.client) {
      this.client = new MongoClient(this.mongoUri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10
      });
      await this.client.connect();
      this.db = this.client.db(this.mongoDbName);
    }

    const collection = this.requireDb().collection<MongoCustomTournamentDocument>(this.collectionName);
    if (!this.indexesEnsured) {
      await collection.createIndex({ id: 1 }, { unique: true });
      await collection.createIndex({ slug: 1 }, { unique: true });
      await collection.createIndex(
        { sourceTournamentId: 1 },
        { unique: true, sparse: true, partialFilterExpression: { sourceTournamentId: { $type: 'string' } } }
      );
      this.indexesEnsured = true;
    }
    return collection;
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new InternalServerErrorException('Custom tournaments MongoDB is not connected');
    }
    return this.db;
  }

  private toCustomTournament(document: MongoCustomTournamentDocument): CustomTournament | null {
    const id = this.pickString(document.id) ?? this.readObjectId(document._id);
    const slug = this.pickString(document.slug);
    const name = this.pickString(document.name);
    if (!id || !slug || !name) {
      return null;
    }

    const participants = this.normalizeParticipants(document.participants, 'REGISTERED');
    const waitlist = this.normalizeParticipants(document.waitlist, 'WAITLIST');
    const skin = this.normalizeSkin(document.skin);
    const startsAt = this.pickString(document.startsAt) ?? undefined;
    const endsAt = this.pickString(document.endsAt) ?? undefined;
    const status = this.normalizeStatus(
      this.pickString(document.status),
      startsAt,
      endsAt
    );

    return {
      id,
      source: 'CUSTOM',
      name,
      status,
      rawStatus: this.pickString(document.status) ?? undefined,
      slug,
      publicUrl: this.buildPublicUrl(slug),
      sourceTournamentId: this.pickString(document.sourceTournamentId) ?? undefined,
      tournamentType: this.pickString(document.tournamentType) ?? 'AMERICANO',
      accessLevels: this.normalizeLevels(document.accessLevels),
      gender: this.normalizeGender(document.gender),
      maxPlayers: this.pickPositiveInteger(document.maxPlayers) ?? 8,
      participants,
      waitlist,
      participantsCount: participants.length,
      paidParticipantsCount: participants.filter((item) => item.paymentStatus === 'PAID').length,
      waitlistCount: waitlist.length,
      allowedManagerPhones: this.normalizePhoneList(document.allowedManagerPhones),
      studioId: this.pickString(document.studioId) ?? undefined,
      studioName: this.pickString(document.studioName) ?? undefined,
      trainerId: this.pickString(document.trainerId) ?? undefined,
      trainerName: this.pickString(document.trainerName) ?? undefined,
      exerciseTypeId: this.pickString(document.exerciseTypeId) ?? undefined,
      startsAt,
      endsAt,
      createdAt: this.pickString(document.createdAt) ?? undefined,
      updatedAt: this.pickString(document.updatedAt) ?? undefined,
      skin,
      details: this.isRecord(document.sourceTournamentSnapshot)
        ? { sourceTournamentSnapshot: document.sourceTournamentSnapshot }
        : undefined
    };
  }

  private normalizeParticipants(
    value: unknown,
    defaultStatus: 'REGISTERED' | 'WAITLIST'
  ): TournamentParticipant[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const participants: TournamentParticipant[] = [];
    value.forEach((entry) => {
      const record = this.toRecord(entry);
      if (!record) {
        return;
      }

      const name = this.pickString(record.name);
      if (!name) {
        return;
      }

      const normalizedPhone = this.normalizePhone(record.phone);
      participants.push({
        id: this.pickString(record.id) ?? undefined,
        name,
        phone: normalizedPhone ?? undefined,
        levelLabel: this.pickString(record.levelLabel) ?? undefined,
        gender: this.normalizeGender(record.gender),
        paymentStatus: this.normalizePaymentStatus(record.paymentStatus),
        status: this.normalizeParticipantStatus(record.status) ?? defaultStatus,
        registeredAt: this.pickString(record.registeredAt) ?? undefined,
        paidAt: this.pickString(record.paidAt) ?? undefined,
        notes: this.pickString(record.notes) ?? undefined
      });
    });

    return participants;
  }

  private normalizeSkin(value: unknown): TournamentSkin {
    const record = this.toRecord(value);
    if (!record) {
      return {};
    }

    return {
      title: this.pickString(record.title) ?? undefined,
      subtitle: this.pickString(record.subtitle) ?? undefined,
      description: this.pickString(record.description) ?? undefined,
      imageUrl: this.pickNullableString(record.imageUrl),
      ctaLabel: this.pickString(record.ctaLabel) ?? undefined,
      badgeLabel: this.pickString(record.badgeLabel) ?? undefined,
      tags: this.normalizeStringArray(record.tags)
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.pickString(item))
      .filter((item): item is string => Boolean(item));
  }

  private normalizeLevels(value: unknown): string[] {
    return Array.from(
      new Set(
        this.normalizeStringArray(value).map((item) =>
          item
            .trim()
            .toUpperCase()
            .replace(/\s+/g, ' ')
        )
      )
    );
  }

  private normalizePhoneList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const phones = new Set<string>();
    value.forEach((item) => {
      const normalized = this.normalizePhone(item);
      if (normalized) {
        phones.add(normalized);
      }
    });
    return Array.from(phones.values());
  }

  private normalizePhone(value: unknown): string | null {
    const text = String(value ?? '').trim();
    if (!text) {
      return null;
    }

    const digits = text.replace(/\D+/g, '');
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

  private normalizeGender(value: unknown): TournamentGender {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'MALE' || normalized === 'FEMALE' || normalized === 'MIXED') {
      return normalized;
    }
    return 'MIXED';
  }

  private normalizePaymentStatus(value: unknown): TournamentPaymentStatus {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    return normalized === 'PAID' ? 'PAID' : 'UNPAID';
  }

  private normalizeParticipantStatus(
    value: unknown
  ): 'REGISTERED' | 'WAITLIST' | null {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'REGISTERED' || normalized === 'WAITLIST') {
      return normalized;
    }
    return null;
  }

  private normalizeStatus(
    rawStatus: string | undefined,
    startsAt?: string,
    endsAt?: string
  ): TournamentStatus {
    const normalized = String(rawStatus ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (
      normalized === TournamentStatus.PLANNED ||
      normalized === TournamentStatus.REGISTRATION ||
      normalized === TournamentStatus.RUNNING ||
      normalized === TournamentStatus.FINISHED ||
      normalized === TournamentStatus.CANCELED
    ) {
      return normalized;
    }

    const now = Date.now();
    const startsAtMs = Date.parse(startsAt ?? '');
    const endsAtMs = Date.parse(endsAt ?? '');
    if (Number.isFinite(startsAtMs) && startsAtMs > now) {
      return TournamentStatus.REGISTRATION;
    }
    if (
      Number.isFinite(startsAtMs) &&
      startsAtMs <= now &&
      (!Number.isFinite(endsAtMs) || endsAtMs >= now)
    ) {
      return TournamentStatus.RUNNING;
    }
    if (Number.isFinite(endsAtMs) && endsAtMs < now) {
      return TournamentStatus.FINISHED;
    }
    return TournamentStatus.UNKNOWN;
  }

  private buildIdFilter(id: string): Filter<MongoCustomTournamentDocument> {
    const cleaned = String(id ?? '').trim();
    if (!cleaned) {
      return { id: '__missing__' } as Filter<MongoCustomTournamentDocument>;
    }

    if (ObjectId.isValid(cleaned)) {
      return {
        $or: [{ id: cleaned }, { _id: new ObjectId(cleaned) }]
      } as Filter<MongoCustomTournamentDocument>;
    }

    return { id: cleaned } as Filter<MongoCustomTournamentDocument>;
  }

  private async ensureUniqueSlug(rawValue: string, excludeId?: string): Promise<string> {
    const collection = await this.collection();
    const baseSlug = this.slugify(rawValue) || 'tournament';
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
      const existing = (await collection.findOne({
        slug: candidate
      } as Filter<MongoCustomTournamentDocument>)) as MongoCustomTournamentDocument | null;
      const existingId = existing
        ? this.pickString(existing.id) ?? this.readObjectId(existing._id)
        : null;
      if (!existing || (excludeId && existingId === excludeId)) {
        return candidate;
      }
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
  }

  private slugify(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  }

  private buildPublicUrl(slug: string): string {
    const normalizedBase = String(this.publicBaseUrl || '/api/tournaments/public/')
      .trim()
      .replace(/\/+$/, '');
    return `${normalizedBase}/${encodeURIComponent(slug)}`;
  }

  private readEnv(name: string): string | undefined {
    const value = String(process.env[name] ?? '').trim();
    return value || undefined;
  }

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private pickNullableString(value: unknown): string | null | undefined {
    if (value === null) {
      return null;
    }
    return this.pickString(value);
  }

  private pickPositiveInteger(value: unknown): number | undefined {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.trim())
          : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return Math.trunc(parsed);
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private readObjectId(value: unknown): string | undefined {
    if (value instanceof ObjectId) {
      return value.toHexString();
    }
    return undefined;
  }
}
