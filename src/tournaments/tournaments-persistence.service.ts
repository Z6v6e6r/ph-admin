import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy
} from '@nestjs/common';
import { Collection, Db, Document, Filter, MongoClient, ObjectId, OptionalId } from 'mongodb';
import {
  AmericanoGeneratorConfig,
  AmericanoHistoricalMatch,
  AmericanoHistoricalRound,
  AmericanoPenaltyWeights
} from './americano-schedule.types';
import {
  CustomTournament,
  Tournament,
  TournamentActor,
  TournamentChangeLogEntry,
  TournamentChangeLogField,
  TournamentGender,
  TournamentMechanics,
  TournamentParticipant,
  TournamentPaymentStatus,
  TournamentSkin,
  TournamentStatus
} from './tournaments.types';

type MongoCustomTournamentDocument = Document & {
  _id?: unknown;
};

const DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS: AmericanoPenaltyWeights = {
  partnerRepeat: 1000,
  partnerImmediateRepeat: 1200,
  opponentRepeat: 150,
  opponentRecentRepeat: 250,
  balance: 100,
  unevenBye: 300,
  consecutiveBye: 700,
  pairInternalImbalance: 30
};

const MAX_TOURNAMENT_CHANGE_LOG_ENTRIES = 40;

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
  mechanics?: unknown;
  actor?: TournamentActor;
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
  mechanics?: unknown;
  actor?: TournamentActor;
}

@Injectable()
export class TournamentsPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(TournamentsPersistenceService.name);
  private readonly mongoUri =
    this.readEnv('TOURNAMENTS_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbName =
    this.readEnv('TOURNAMENTS_MONGODB_DB') ?? this.readEnv('MONGODB_DB') ?? 'tournaments';
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
        return this.restoreExistingTournamentDocument(collection, existing, mutation);
      }
    }

    const payload = await this.buildCreateDocument(mutation);
    try {
      await collection.insertOne(payload as OptionalId<MongoCustomTournamentDocument>);
    } catch (error) {
      const recovered = await this.recoverCustomTournamentCreateConflict(
        collection,
        mutation,
        error
      );
      if (recovered) {
        return recovered;
      }
      throw error;
    }
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

    const now = new Date().toISOString();
    const setPayload: Record<string, unknown> = {
      updatedAt: now
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
    if (mutation.mechanics !== undefined) {
      setPayload.mechanics = this.normalizeMechanics(mutation.mechanics);
    }

    const actor = this.toActorRecord(mutation.actor, now);
    const nextDocument: MongoCustomTournamentDocument = {
      ...existing,
      ...setPayload
    };
    if (actor) {
      setPayload.updatedBy = actor;
      nextDocument.updatedBy = actor;
      const changeLogEntry = this.buildUpdateChangeLogEntry(
        id,
        now,
        actor,
        existing,
        nextDocument
      );
      if (changeLogEntry) {
        const currentChangeLog = this.normalizeChangeLog(existing.changeLog);
        setPayload.changeLog = [changeLogEntry, ...currentChangeLog].slice(
          0,
          MAX_TOURNAMENT_CHANGE_LOG_ENTRIES
        );
        nextDocument.changeLog = setPayload.changeLog;
      }
    }

    await collection.updateOne(this.buildIdFilter(id), { $set: setPayload });
    return this.toCustomTournament(nextDocument);
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
      try {
        await collection.createIndex({ id: 1 }, { unique: true });
        await collection.createIndex({ slug: 1 }, { unique: true });
        await collection.createIndex(
          { sourceTournamentId: 1 },
          {
            unique: true,
            sparse: true,
            partialFilterExpression: { sourceTournamentId: { $type: 'string' } }
          }
        );
      } catch (error) {
        this.logger.warn(`Failed to ensure custom tournaments indexes: ${String(error)}`);
      }
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
    const mechanics = this.normalizeMechanics(document.mechanics);
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
      mechanics,
      changeLog: this.normalizeChangeLog(document.changeLog),
      createdBy: this.normalizeActor(document.createdBy),
      updatedBy: this.normalizeActor(document.updatedBy),
      details: this.isRecord(document.sourceTournamentSnapshot)
        ? { sourceTournamentSnapshot: document.sourceTournamentSnapshot }
        : undefined
    };
  }

  private async buildCreateDocument(
    mutation: CreateCustomTournamentMutation,
    options?: {
      id?: string;
      slug?: string;
      createdAt?: string;
    }
  ): Promise<MongoCustomTournamentDocument> {
    const now = new Date().toISOString();
    const id = this.pickString(options?.id) ?? new ObjectId().toHexString();
    const slug = await this.ensureUniqueSlug(
      options?.slug ?? mutation.slug ?? mutation.name ?? id,
      id
    );
    const actor = this.toActorRecord(mutation.actor, now);
    const createdLog = actor
      ? this.buildCreateChangeLogEntry(
          id,
          now,
          actor,
          mutation.mechanics
        )
      : undefined;

    return {
      id,
      source: 'CUSTOM',
      slug,
      sourceTournamentId: this.pickString(mutation.sourceTournamentId) ?? null,
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
      mechanics: this.normalizeMechanics(mutation.mechanics),
      changeLog: createdLog ? [createdLog] : [],
      createdBy: actor ?? null,
      updatedBy: actor ?? null,
      createdAt: this.pickString(options?.createdAt) ?? now,
      updatedAt: now,
      archived: false
    };
  }

  private async restoreExistingTournamentDocument(
    collection: Collection<MongoCustomTournamentDocument>,
    existing: MongoCustomTournamentDocument,
    mutation: CreateCustomTournamentMutation
  ): Promise<CustomTournament> {
    const existingId =
      this.pickString(existing.id) ?? this.readObjectId(existing._id) ?? new ObjectId().toHexString();
    const payload = await this.buildCreateDocument(mutation, {
      id: existingId,
      slug: this.pickString(existing.slug) ?? mutation.slug ?? mutation.name ?? existingId,
      createdAt: this.pickString(existing.createdAt)
    });

    await collection.updateOne(this.buildDocumentFilter(existing), {
      $set: payload
    });

    const restored = this.toCustomTournament({
      ...existing,
      ...payload
    });
    if (!restored) {
      throw new InternalServerErrorException('Failed to restore custom tournament');
    }
    return restored;
  }

  private async recoverCustomTournamentCreateConflict(
    collection: Collection<MongoCustomTournamentDocument>,
    mutation: CreateCustomTournamentMutation,
    error: unknown
  ): Promise<CustomTournament | null> {
    if (!this.isDuplicateKeyError(error)) {
      return null;
    }

    const sourceTournamentId = this.pickString(mutation.sourceTournamentId);
    if (sourceTournamentId) {
      const existing = (await collection.findOne({
        sourceTournamentId
      } as Filter<MongoCustomTournamentDocument>)) as MongoCustomTournamentDocument | null;
      if (existing) {
        const existingTournament = this.toCustomTournament(existing);
        return existingTournament
          ? existingTournament
          : this.restoreExistingTournamentDocument(collection, existing, mutation);
      }
    }

    return null;
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

  private normalizeMechanics(value: unknown): TournamentMechanics {
    const record = this.toRecord(value);
    const config = this.normalizeMechanicsConfig(record?.config);
    const normalizedHistory = this.normalizeMechanicsHistory(record?.history);
    const normalizedNotes = this.pickString(record?.notes) ?? undefined;
    const normalizedEnabled = record?.enabled === false ? false : true;

    return {
      enabled: normalizedEnabled,
      config,
      history: normalizedHistory,
      notes: normalizedNotes,
      raw: this.normalizeMechanicsRaw(record, {
        enabled: normalizedEnabled,
        config,
        history: normalizedHistory,
        notes: normalizedNotes
      })
    };
  }

  private normalizeMechanicsRaw(
    record: Record<string, unknown> | null,
    normalized: {
      enabled: boolean;
      config: AmericanoGeneratorConfig;
      history?: AmericanoHistoricalRound[];
      notes?: string;
    }
  ): Record<string, unknown> | undefined {
    if (!record) {
      return undefined;
    }

    const source = this.toRecord(record.raw) ?? record;
    const payload: Record<string, unknown> = {};

    Object.entries(source).forEach(([key, value]) => {
      if (key === 'raw') {
        return;
      }
      payload[key] = value;
    });

    payload.enabled = normalized.enabled;
    payload.config = normalized.config;
    if (normalized.history !== undefined) {
      payload.history = normalized.history;
    } else {
      delete payload.history;
    }
    if (normalized.notes !== undefined) {
      payload.notes = normalized.notes;
    } else {
      delete payload.notes;
    }

    return Object.keys(payload).length > 0 ? payload : undefined;
  }

  private normalizeMechanicsConfig(value: unknown): AmericanoGeneratorConfig {
    const record = this.toRecord(value);

    return {
      mode: this.normalizeMechanicsMode(record?.mode),
      rounds: this.pickOptionalInteger(record?.rounds, 1),
      courts: this.pickOptionalInteger(record?.courts, 1),
      useRatings: record?.useRatings === false ? false : true,
      firstRoundSeeding: this.normalizeFirstRoundSeeding(record?.firstRoundSeeding),
      roundExactThreshold: this.pickOptionalInteger(record?.roundExactThreshold, 0) ?? 12,
      balanceOutlierThreshold: this.pickOptionalNumber(record?.balanceOutlierThreshold, 0) ?? 1.1,
      balanceOutlierWeight: this.pickOptionalNumber(record?.balanceOutlierWeight, 0) ?? 120,
      strictPartnerUniqueness: this.normalizeStrictness(record?.strictPartnerUniqueness, 'high'),
      strictBalance: this.normalizeStrictness(record?.strictBalance, 'medium'),
      avoidRepeatOpponents: record?.avoidRepeatOpponents === false ? false : true,
      avoidRepeatPartners: record?.avoidRepeatPartners === false ? false : true,
      distributeByesEvenly: record?.distributeByesEvenly === false ? false : true,
      historyDepth: this.pickOptionalInteger(record?.historyDepth, 0) ?? 0,
      localSearchIterations: this.pickOptionalInteger(record?.localSearchIterations, 1) ?? 6,
      pairingExactThreshold: this.pickOptionalInteger(record?.pairingExactThreshold, 8) ?? 16,
      matchExactThreshold: this.pickOptionalInteger(record?.matchExactThreshold, 4) ?? 12,
      weights: this.normalizeMechanicsWeights(record?.weights)
    };
  }

  private normalizeMechanicsWeights(
    value: unknown
  ): Partial<AmericanoPenaltyWeights> {
    const record = this.toRecord(value);

    return {
      partnerRepeat:
        this.pickOptionalNumber(record?.partnerRepeat, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.partnerRepeat,
      partnerImmediateRepeat:
        this.pickOptionalNumber(record?.partnerImmediateRepeat, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.partnerImmediateRepeat,
      opponentRepeat:
        this.pickOptionalNumber(record?.opponentRepeat, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.opponentRepeat,
      opponentRecentRepeat:
        this.pickOptionalNumber(record?.opponentRecentRepeat, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.opponentRecentRepeat,
      balance:
        this.pickOptionalNumber(record?.balance, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.balance,
      unevenBye:
        this.pickOptionalNumber(record?.unevenBye, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.unevenBye,
      consecutiveBye:
        this.pickOptionalNumber(record?.consecutiveBye, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.consecutiveBye,
      pairInternalImbalance:
        this.pickOptionalNumber(record?.pairInternalImbalance, 0)
        ?? DEFAULT_TOURNAMENT_MECHANICS_WEIGHTS.pairInternalImbalance
    };
  }

  private normalizeMechanicsHistory(value: unknown): AmericanoHistoricalRound[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const rounds = value
      .map((entry) => this.normalizeMechanicsHistoryRound(entry))
      .filter((entry): entry is AmericanoHistoricalRound => entry !== null);

    return rounds.length > 0 ? rounds : undefined;
  }

  private normalizeMechanicsHistoryRound(value: unknown): AmericanoHistoricalRound | null {
    const record = this.toRecord(value);
    if (!record) {
      return null;
    }

    const matches = Array.isArray(record.matches)
      ? record.matches
          .map((entry) => this.normalizeMechanicsHistoryMatch(entry))
          .filter((entry): entry is AmericanoHistoricalMatch => entry !== null)
      : [];

    if (matches.length === 0) {
      return null;
    }

    return {
      roundNumber: this.pickOptionalInteger(record.roundNumber, 1) ?? undefined,
      matches,
      byes: this.normalizeStringArray(record.byes)
    };
  }

  private normalizeMechanicsHistoryMatch(value: unknown): AmericanoHistoricalMatch | null {
    const record = this.toRecord(value);
    if (!record) {
      return null;
    }

    const team1 = this.normalizeMechanicsPair(record.team1);
    const team2 = this.normalizeMechanicsPair(record.team2);
    if (!team1 || !team2) {
      return null;
    }

    return {
      team1,
      team2
    };
  }

  private normalizeMechanicsPair(value: unknown): [string, string] | null {
    if (!Array.isArray(value) || value.length !== 2) {
      return null;
    }

    const left = this.pickString(value[0]);
    const right = this.pickString(value[1]);
    if (!left || !right) {
      return null;
    }

    return [left, right];
  }

  private normalizeActor(value: unknown): TournamentActor | undefined {
    const record = this.toRecord(value);
    if (!record) {
      return undefined;
    }

    const id = this.pickString(record.id);
    const login = this.pickString(record.login);
    const name = this.pickString(record.name);
    if (!id && !login && !name) {
      return undefined;
    }

    return {
      id: id ?? undefined,
      login: login ?? undefined,
      name: name ?? undefined
    };
  }

  private toActorRecord(actor: TournamentActor | undefined, fallbackTime: string) {
    const normalized = this.normalizeActor(actor);
    if (!normalized) {
      return undefined;
    }

    return {
      ...(normalized.id ? { id: normalized.id } : {}),
      ...(normalized.login ? { login: normalized.login } : {}),
      ...(normalized.name ? { name: normalized.name } : {}),
      at: fallbackTime
    };
  }

  private normalizeChangeLog(value: unknown): TournamentChangeLogEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry, index) => this.normalizeChangeLogEntry(entry, index))
      .filter((entry): entry is TournamentChangeLogEntry => entry !== null)
      .slice(0, MAX_TOURNAMENT_CHANGE_LOG_ENTRIES);
  }

  private normalizeChangeLogEntry(
    value: unknown,
    index: number
  ): TournamentChangeLogEntry | null {
    const record = this.toRecord(value);
    if (!record) {
      return null;
    }

    const summary = this.pickString(record.summary);
    if (!summary) {
      return null;
    }

    const changes = Array.isArray(record.changes)
      ? record.changes
          .map((entry) => this.normalizeChangeLogField(entry))
          .filter((entry): entry is TournamentChangeLogField => entry !== null)
      : [];

    return {
      id: this.pickString(record.id) ?? `change-${index + 1}`,
      action: this.normalizeChangeAction(record.action),
      scope: this.normalizeChangeScope(record.scope),
      summary,
      actor: this.normalizeActor(record.actor),
      at: this.pickString(record.at) ?? new Date(0).toISOString(),
      changes
    };
  }

  private normalizeChangeLogField(value: unknown): TournamentChangeLogField | null {
    const record = this.toRecord(value);
    if (!record) {
      return null;
    }

    const field = this.pickString(record.field);
    const label = this.pickString(record.label);
    if (!field || !label) {
      return null;
    }

    return {
      field,
      label,
      before: this.pickString(record.before) ?? undefined,
      after: this.pickString(record.after) ?? undefined
    };
  }

  private buildCreateChangeLogEntry(
    tournamentId: string,
    at: string,
    actor: Record<string, unknown>,
    mechanics?: unknown
  ): TournamentChangeLogEntry {
    const createdMechanics = this.normalizeMechanics(mechanics);

    return {
      id: `${tournamentId}:create:${at}`,
      action: 'CREATE',
      scope: 'TOURNAMENT',
      summary: 'Создана карточка турнира',
      actor: this.normalizeActor(actor),
      at,
      changes: [
        {
          field: 'mechanics.enabled',
          label: 'Механика включена',
          after: createdMechanics.enabled ? 'Да' : 'Нет'
        },
        {
          field: 'mechanics.config.mode',
          label: 'Механика: режим',
          after: createdMechanics.config.mode
        }
      ]
    };
  }

  private buildUpdateChangeLogEntry(
    tournamentId: string,
    at: string,
    actor: Record<string, unknown>,
    beforeDocument: MongoCustomTournamentDocument,
    afterDocument: MongoCustomTournamentDocument
  ): TournamentChangeLogEntry | null {
    const beforeTournament = this.toCustomTournament(beforeDocument);
    const afterTournament = this.toCustomTournament(afterDocument);
    if (!beforeTournament || !afterTournament) {
      return null;
    }

    const changes = this.collectTournamentChanges(beforeTournament, afterTournament);
    if (changes.length === 0) {
      return null;
    }

    const mechanicsChanges = changes.filter((change) => change.field.indexOf('mechanics.') === 0);
    const scope = mechanicsChanges.length === changes.length ? 'MECHANICS' : 'TOURNAMENT';

    return {
      id: `${tournamentId}:update:${at}`,
      action: 'UPDATE',
      scope,
      summary:
        scope === 'MECHANICS'
          ? 'Обновлена турнирная механика'
          : 'Обновлены параметры турнира',
      actor: this.normalizeActor(actor),
      at,
      changes
    };
  }

  private collectTournamentChanges(
    beforeTournament: CustomTournament,
    afterTournament: CustomTournament
  ): TournamentChangeLogField[] {
    const changes: TournamentChangeLogField[] = [];
    const pushChange = (
      field: string,
      label: string,
      beforeValue: string | undefined,
      afterValue: string | undefined
    ) => {
      const normalizedBefore = beforeValue ?? '';
      const normalizedAfter = afterValue ?? '';
      if (normalizedBefore === normalizedAfter) {
        return;
      }
      changes.push({
        field,
        label,
        ...(beforeValue !== undefined ? { before: beforeValue } : {}),
        ...(afterValue !== undefined ? { after: afterValue } : {})
      });
    };

    pushChange('name', 'Название', beforeTournament.name, afterTournament.name);
    pushChange('status', 'Статус', beforeTournament.status, afterTournament.status);
    pushChange(
      'startsAt',
      'Дата и время старта',
      this.formatAuditDate(beforeTournament.startsAt),
      this.formatAuditDate(afterTournament.startsAt)
    );
    pushChange(
      'endsAt',
      'Дата и время конца',
      this.formatAuditDate(beforeTournament.endsAt),
      this.formatAuditDate(afterTournament.endsAt)
    );
    pushChange(
      'tournamentType',
      'Формат турнира',
      beforeTournament.tournamentType,
      afterTournament.tournamentType
    );
    pushChange(
      'accessLevels',
      'Уровни участников',
      this.formatAuditList(beforeTournament.accessLevels),
      this.formatAuditList(afterTournament.accessLevels)
    );
    pushChange('gender', 'Пол', beforeTournament.gender, afterTournament.gender);
    pushChange(
      'maxPlayers',
      'Макс. участников',
      this.formatAuditNumber(beforeTournament.maxPlayers),
      this.formatAuditNumber(afterTournament.maxPlayers)
    );
    pushChange(
      'allowedManagerPhones',
      'Телефоны доступа к механике',
      this.formatAuditList(beforeTournament.allowedManagerPhones),
      this.formatAuditList(afterTournament.allowedManagerPhones)
    );
    pushChange('slug', 'Slug', beforeTournament.slug, afterTournament.slug);
    pushChange('studioName', 'Клуб', beforeTournament.studioName, afterTournament.studioName);
    pushChange('trainerName', 'Тренер', beforeTournament.trainerName, afterTournament.trainerName);
    pushChange(
      'participantsCount',
      'Участники',
      this.formatAuditNumber(beforeTournament.participants?.length),
      this.formatAuditNumber(afterTournament.participants?.length)
    );
    pushChange(
      'waitlistCount',
      'Лист ожидания',
      this.formatAuditNumber(beforeTournament.waitlist?.length),
      this.formatAuditNumber(afterTournament.waitlist?.length)
    );
    pushChange(
      'skin.title',
      'Skin: заголовок',
      beforeTournament.skin.title,
      afterTournament.skin.title
    );
    pushChange(
      'skin.subtitle',
      'Skin: подзаголовок',
      beforeTournament.skin.subtitle,
      afterTournament.skin.subtitle
    );
    pushChange(
      'skin.description',
      'Skin: описание',
      beforeTournament.skin.description,
      afterTournament.skin.description
    );
    pushChange(
      'skin.imageUrl',
      'Skin: image URL',
      beforeTournament.skin.imageUrl ?? undefined,
      afterTournament.skin.imageUrl ?? undefined
    );
    pushChange(
      'skin.ctaLabel',
      'Skin: CTA',
      beforeTournament.skin.ctaLabel,
      afterTournament.skin.ctaLabel
    );
    pushChange(
      'skin.badgeLabel',
      'Skin: badge',
      beforeTournament.skin.badgeLabel,
      afterTournament.skin.badgeLabel
    );
    pushChange(
      'skin.tags',
      'Skin: теги',
      this.formatAuditList(beforeTournament.skin.tags),
      this.formatAuditList(afterTournament.skin.tags)
    );

    const beforeMechanics = this.normalizeMechanics(beforeTournament.mechanics);
    const afterMechanics = this.normalizeMechanics(afterTournament.mechanics);
    pushChange(
      'mechanics.enabled',
      'Механика включена',
      beforeMechanics.enabled ? 'Да' : 'Нет',
      afterMechanics.enabled ? 'Да' : 'Нет'
    );
    pushChange(
      'mechanics.notes',
      'Механика: заметки',
      beforeMechanics.notes,
      afterMechanics.notes
    );
    pushChange(
      'mechanics.history',
      'Механика: история раундов',
      this.formatAuditNumber(beforeMechanics.history?.length),
      this.formatAuditNumber(afterMechanics.history?.length)
    );

    const mechanicsFieldMap: Array<{ key: keyof AmericanoGeneratorConfig; label: string }> = [
      { key: 'mode', label: 'Механика: режим' },
      { key: 'rounds', label: 'Механика: раунды' },
      { key: 'courts', label: 'Механика: корты' },
      { key: 'useRatings', label: 'Механика: учитывать рейтинг' },
      { key: 'firstRoundSeeding', label: 'Механика: стартовый посев' },
      { key: 'roundExactThreshold', label: 'Механика: точный перебор раунда' },
      { key: 'balanceOutlierThreshold', label: 'Механика: порог плохого матча' },
      { key: 'balanceOutlierWeight', label: 'Механика: штраф за плохой матч' },
      { key: 'strictPartnerUniqueness', label: 'Механика: строгость по партнёрам' },
      { key: 'strictBalance', label: 'Механика: строгость по балансу' },
      { key: 'avoidRepeatOpponents', label: 'Механика: избегать повторов соперников' },
      { key: 'avoidRepeatPartners', label: 'Механика: избегать повторов партнёров' },
      { key: 'distributeByesEvenly', label: 'Механика: распределять bye равномерно' },
      { key: 'historyDepth', label: 'Механика: глубина истории' },
      { key: 'localSearchIterations', label: 'Механика: итерации локального поиска' },
      { key: 'pairingExactThreshold', label: 'Механика: exact threshold по парам' },
      { key: 'matchExactThreshold', label: 'Механика: exact threshold по матчам' }
    ];

    mechanicsFieldMap.forEach((descriptor) => {
      pushChange(
        'mechanics.config.' + String(descriptor.key),
        descriptor.label,
        this.formatAuditValue(beforeMechanics.config[descriptor.key]),
        this.formatAuditValue(afterMechanics.config[descriptor.key])
      );
    });

    const weightLabels: Record<keyof AmericanoPenaltyWeights, string> = {
      partnerRepeat: 'Вес: повтор партнёров',
      partnerImmediateRepeat: 'Вес: подряд тот же партнёр',
      opponentRepeat: 'Вес: повтор соперников',
      opponentRecentRepeat: 'Вес: недавний повтор соперников',
      balance: 'Вес: баланс матча',
      unevenBye: 'Вес: неравномерный bye',
      consecutiveBye: 'Вес: подряд bye',
      pairInternalImbalance: 'Вес: дисбаланс внутри пары'
    };
    (
      Object.keys(weightLabels) as Array<keyof AmericanoPenaltyWeights>
    ).forEach((key) => {
      pushChange(
        'mechanics.config.weights.' + String(key),
        weightLabels[key],
        this.formatAuditValue(beforeMechanics.config.weights?.[key]),
        this.formatAuditValue(afterMechanics.config.weights?.[key])
      );
    });

    return changes.slice(0, 24);
  }

  private formatAuditDate(value?: string): string | undefined {
    const normalized = this.pickString(value);
    if (!normalized) {
      return undefined;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
  }

  private formatAuditList(values?: string[]): string | undefined {
    return Array.isArray(values) && values.length > 0 ? values.join(', ') : undefined;
  }

  private formatAuditNumber(value?: number): string | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
  }

  private formatAuditValue(value: unknown): string | undefined {
    if (typeof value === 'boolean') {
      return value ? 'Да' : 'Нет';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (Array.isArray(value)) {
      const normalized = value
        .map((entry) => this.pickString(entry))
        .filter((entry): entry is string => Boolean(entry));
      return normalized.length > 0 ? normalized.join(', ') : undefined;
    }
    return this.pickString(value);
  }

  private normalizeChangeAction(value: unknown): 'CREATE' | 'UPDATE' {
    return String(value ?? '').trim().toUpperCase() === 'CREATE' ? 'CREATE' : 'UPDATE';
  }

  private normalizeChangeScope(value: unknown): 'TOURNAMENT' | 'MECHANICS' {
    return String(value ?? '').trim().toUpperCase() === 'MECHANICS'
      ? 'MECHANICS'
      : 'TOURNAMENT';
  }

  private normalizeMechanicsMode(value: unknown): AmericanoGeneratorConfig['mode'] {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (
      normalized === 'full_americano' ||
      normalized === 'short_americano' ||
      normalized === 'competitive_americano' ||
      normalized === 'dynamic_americano'
    ) {
      return normalized;
    }
    return 'short_americano';
  }

  private normalizeFirstRoundSeeding(
    value: unknown
  ): AmericanoGeneratorConfig['firstRoundSeeding'] {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'off' || normalized === 'rating_quartets' || normalized === 'auto') {
      return normalized;
    }
    return 'auto';
  }

  private normalizeStrictness(
    value: unknown,
    fallback: AmericanoGeneratorConfig['strictBalance']
  ): AmericanoGeneratorConfig['strictBalance'] {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return fallback;
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

  private buildDocumentFilter(
    document: MongoCustomTournamentDocument
  ): Filter<MongoCustomTournamentDocument> {
    if (document._id instanceof ObjectId) {
      return { _id: document._id } as Filter<MongoCustomTournamentDocument>;
    }

    const id = this.pickString(document.id);
    if (id) {
      return this.buildIdFilter(id);
    }

    throw new InternalServerErrorException('Custom tournament document identity is missing');
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

  private pickOptionalInteger(value: unknown, minValue: number): number | null | undefined {
    if (value === null) {
      return null;
    }

    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.trim())
          : NaN;
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    if (parsed < minValue) {
      return minValue;
    }
    return Math.trunc(parsed);
  }

  private pickOptionalNumber(value: unknown, minValue: number): number | undefined {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.trim())
          : NaN;
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(minValue, parsed);
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      Number((error as { code?: unknown }).code) === 11000
    );
  }

  private readObjectId(value: unknown): string | undefined {
    if (value instanceof ObjectId) {
      return value.toHexString();
    }
    return undefined;
  }
}
