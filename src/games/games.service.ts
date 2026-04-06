import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy
} from '@nestjs/common';
import { Filter, MongoClient, ObjectId } from 'mongodb';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import {
  Game,
  GameAnalyticsFilters,
  GameAnalyticsResult,
  GameChatContext,
  GameChatMessage,
  GameEvent,
  GameEventListFilters,
  GameEventListResult,
  GameParticipantDetails,
  GameStatus
} from './games.types';

type GamesSourceMode = 'lk' | 'mongo';
type StaffSide = 'CLIENT' | 'STAFF';

interface MongoGameParticipant {
  [key: string]: unknown;
  id?: unknown;
  name?: unknown;
  phone?: unknown;
  phoneNorm?: unknown;
  rating?: unknown;
  ratingDelta?: unknown;
  rating_change?: unknown;
  ratingBefore?: unknown;
  ratingAfter?: unknown;
}

interface MongoGameDoc {
  [key: string]: unknown;
  _id?: unknown;
  id?: unknown;
  status?: unknown;
  archived?: unknown;
  createdAt?: unknown;
  createdTs?: unknown;
  updatedAt?: unknown;
  organizer?: {
    id?: unknown;
    name?: unknown;
    phone?: unknown;
    phoneNorm?: unknown;
  };
  participants?: MongoGameParticipant[];
  participantPhones?: unknown;
  metadata?: Record<string, unknown>;
  result?: unknown;
  score?: unknown;
  matchResult?: unknown;
  gameResult?: unknown;
  ratingDelta?: unknown;
  ratingChanges?: unknown;
  payment?: {
    [key: string]: unknown;
    amount?: unknown;
    paid?: unknown;
    paidAt?: unknown;
    status?: unknown;
  };
  booking?: {
    [key: string]: unknown;
    studioId?: unknown;
    date?: unknown;
    timeFrom?: unknown;
    timeTo?: unknown;
    timeFromIso?: unknown;
    studioName?: unknown;
    roomName?: unknown;
  };
}

interface MongoGameChatSenderDoc {
  [key: string]: unknown;
  id?: unknown;
  phoneNorm?: unknown;
  name?: unknown;
  role?: unknown;
}

interface MongoGameChatMessageDoc {
  [key: string]: unknown;
  _id?: ObjectId;
  gameId?: unknown;
  tenantKey?: unknown;
  relatedPhones?: unknown;
  sender?: MongoGameChatSenderDoc;
  type?: unknown;
  text?: unknown;
  createdAt?: unknown;
  createdTs?: unknown;
  editedAt?: unknown;
  deleted?: unknown;
}

interface MongoGameEventDoc {
  [key: string]: unknown;
  _id?: unknown;
  event?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  source?: unknown;
  tenantKey?: unknown;
  page?: Record<string, unknown>;
  user?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  device?: Record<string, unknown>;
}

@Injectable()
export class GamesService implements OnModuleDestroy {
  private static readonly GAME_EVENTS_DEFAULT_PAGE_SIZE = 30;
  private static readonly GAME_EVENTS_MAX_PAGE_SIZE = 100;
  private static readonly STATION_ALIAS_GROUPS: Record<string, string[]> = {
    yas: ['yas', 'yasenevo', 'ясенево'],
    nagat: ['nagat', 'nagatinskaya', 'нагатинская'],
    nagat_p: ['nagat_p', 'nagatinskayap', 'нагатинскаяпремиум', 'нагатинская премиум'],
    tereh: ['tereh', 'terehovo', 'терехово'],
    kuncev: ['kuncev', 'skolkovo', 'сколково'],
    seleger: ['seleger', 'селигерская'],
    sochi: ['sochi', 'сочи'],
    't-sbora': ['t-sbora', 'care_service', 'точкасбора', 'точка сбора']
  };

  private readonly logger = new Logger(GamesService.name);
  private readonly sourceMode = this.resolveSourceMode();
  private readonly mongoUri = this.readEnv('GAMES_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbName = this.readEnv('GAMES_MONGODB_DB') ?? 'games';
  private readonly mongoCollectionName = this.readEnv('GAMES_MONGODB_COLLECTION') ?? 'lk_games';
  private readonly mongoEventsCollectionName =
    this.readEnv('GAMES_EVENTS_MONGODB_COLLECTION') ?? 'events';
  private readonly analyticsTimeZone = this.readEnv('GAMES_ANALYTICS_TIMEZONE') ?? 'Europe/Moscow';

  private readonly gameChatMongoUri =
    this.readEnv('GAMES_CHAT_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly gameChatMongoDbName = this.readEnv('GAMES_CHAT_MONGODB_DB') ?? 'games_chat';
  private readonly gameChatMessagesCollectionName =
    this.readEnv('GAMES_CHAT_MESSAGES_COLLECTION') ?? 'chat_messages';
  private readonly gameChatAdminSenderName =
    this.readEnv('GAMES_CHAT_ADMIN_SENDER_NAME') ?? 'Администратор станции';
  private readonly gameChatAdminSenderRole =
    this.readEnv('GAMES_CHAT_ADMIN_SENDER_ROLE') ?? 'STATION_ADMIN';

  private mongoClient?: MongoClient;
  private gameChatMongoClient?: MongoClient;

  constructor(private readonly lkPadelHubClient: LkPadelHubClientService) {}

  async findAll(user?: RequestUser): Promise<Game[]> {
    if (this.sourceMode === 'mongo') {
      return this.filterGamesForUser(await this.findAllFromMongo(), user);
    }
    return this.filterGamesForUser(await this.lkPadelHubClient.listGames(), user);
  }

  async findById(id: string, user?: RequestUser): Promise<Game> {
    let game: Game | null = null;
    if (this.sourceMode === 'mongo') {
      game = await this.findByIdFromMongo(id);
      if (!game) {
        throw new NotFoundException(`Game with id ${id} not found`);
      }
    } else {
      game = await this.lkPadelHubClient.getGameById(id);
      if (!game) {
        throw new NotFoundException(`Game with id ${id} not found`);
      }
    }

    this.ensureGameVisibleForUser(game, user);
    return this.sanitizeGameForUser(game, user);
  }

  async findAnalytics(
    filters?: GameAnalyticsFilters,
    user?: RequestUser
  ): Promise<GameAnalyticsResult> {
    this.ensureNonStationAdminGamePrivilege(user);
    return this.findAnalyticsFromMongo(filters);
  }

  async findEvents(
    filters?: GameEventListFilters,
    user?: RequestUser
  ): Promise<GameEventListResult> {
    this.ensureNonStationAdminGamePrivilege(user);
    return this.findEventsFromMongo(filters);
  }

  async findEventById(id: string, user?: RequestUser): Promise<GameEvent> {
    this.ensureNonStationAdminGamePrivilege(user);
    const event = await this.findEventByIdFromMongo(id);
    if (!event) {
      throw new NotFoundException(`Game event with id ${id} not found`);
    }
    return event;
  }

  async deleteEvent(id: string): Promise<void> {
    const collection = await this.getMongoEventsCollection();
    const result = await collection.deleteOne(this.buildMongoEventIdFilter(id));
    if (!result.deletedCount) {
      throw new NotFoundException(`Game event with id ${id} not found`);
    }
  }

  async getGameChat(id: string, _user: RequestUser): Promise<GameChatContext> {
    const game = await this.findById(id, _user);
    const chat = await this.loadGameChat(game);
    return {
      game,
      gameId: chat.gameId,
      source: 'GAMES_CHAT_MONGO',
      messages: chat.messages
    };
  }

  async sendGameChatMessage(
    id: string,
    text: string,
    user: RequestUser
  ): Promise<GameChatMessage> {
    const game = await this.findById(id, user);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('Message text cannot be empty');
    }

    const chat = await this.loadGameChat(game);
    const now = new Date();
    const doc: MongoGameChatMessageDoc = {
      gameId: chat.gameId,
      tenantKey: this.extractTenantKey(game),
      relatedPhones: this.extractRelatedPhones(game),
      sender: {
        id: user.id,
        name: this.resolveSenderName(user),
        role: this.resolveSenderRole(user)
      },
      type: 'TEXT',
      text: trimmed,
      createdAt: now.toISOString(),
      createdTs: now.getTime(),
      editedAt: null,
      deleted: false
    };

    const collection = await this.getGameChatMessagesCollection();
    const inserted = await collection.insertOne(doc);
    const mapped = this.mapGameChatMessage({
      ...doc,
      _id: inserted.insertedId
    });

    if (!mapped) {
      throw new InternalServerErrorException('Failed to persist game chat message');
    }
    return mapped;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close().catch(() => undefined);
    }
    if (this.gameChatMongoClient && this.gameChatMongoClient !== this.mongoClient) {
      await this.gameChatMongoClient.close().catch(() => undefined);
    }
  }

  private resolveSourceMode(): GamesSourceMode {
    const explicit = (this.readEnv('GAMES_SOURCE') ?? '').toLowerCase();
    if (explicit === 'mongo' || explicit === 'mongodb') {
      return 'mongo';
    }
    return 'lk';
  }

  private async findAllFromMongo(): Promise<Game[]> {
    const collection = await this.getMongoCollection();
    const docs = (await collection
      .find(
        { archived: { $ne: true } },
        {
          projection: {
            id: 1,
            status: 1,
            archived: 1,
            createdAt: 1,
            createdTs: 1,
            updatedAt: 1,
            organizer: 1,
            participants: 1,
            metadata: 1,
            result: 1,
            score: 1,
            matchResult: 1,
            gameResult: 1,
            ratingDelta: 1,
            ratingChanges: 1,
            booking: 1
          }
        }
      )
      .sort({ 'booking.startTs': 1, createdAt: -1 })
      .limit(500)
      .toArray()) as MongoGameDoc[];

    return docs
      .map((doc) => this.mapMongoGame(doc))
      .filter((game): game is Game => game !== null);
  }

  private ensureNonStationAdminGamePrivilege(user?: RequestUser): void {
    if (this.isRestrictedStationAdmin(user)) {
      throw new NotFoundException('Resource not found');
    }
  }

  private filterGamesForUser(games: Game[], user?: RequestUser): Game[] {
    if (!Array.isArray(games) || games.length === 0) {
      return [];
    }

    return games
      .filter((game) => this.canViewGame(game, user))
      .map((game) => this.sanitizeGameForUser(game, user));
  }

  private ensureGameVisibleForUser(game: Game, user?: RequestUser): void {
    if (!this.canViewGame(game, user)) {
      throw new NotFoundException(`Game with id ${game.id} not found`);
    }
  }

  private canViewGame(game: Game, user?: RequestUser): boolean {
    if (!this.isRestrictedStationAdmin(user)) {
      return true;
    }

    const userStationKeys = this.normalizeUserStationKeys(user);
    if (userStationKeys.length === 0) {
      return false;
    }

    const gameStationKeys = this.extractGameStationKeys(game);
    if (gameStationKeys.length === 0) {
      return false;
    }

    return userStationKeys.some((key) => gameStationKeys.includes(key));
  }

  private sanitizeGameForUser(game: Game, user?: RequestUser): Game {
    if (!this.isRestrictedStationAdmin(user)) {
      return game;
    }

    const participantNames = Array.isArray(game.participantNames)
      ? game.participantNames
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0)
      : [];

    return {
      ...game,
      participantDetails: participantNames.map((name) => ({ name })),
      details: undefined
    };
  }

  private isRestrictedStationAdmin(user?: RequestUser): boolean {
    if (!user || !Array.isArray(user.roles) || user.roles.indexOf(Role.STATION_ADMIN) < 0) {
      return false;
    }

    return !user.roles.some((role) =>
      [
        Role.SUPER_ADMIN,
        Role.MANAGER,
        Role.SUPPORT,
        Role.GAME_MANAGER,
        Role.TOURNAMENT_MANAGER
      ].includes(role)
    );
  }

  private normalizeUserStationKeys(user?: RequestUser): string[] {
    if (!user || !Array.isArray(user.stationIds)) {
      return [];
    }

    const keys = new Set<string>();
    user.stationIds.forEach((stationId) => {
      this.expandStationAliases(stationId).forEach((key) => keys.add(key));
    });
    return Array.from(keys.values());
  }

  private extractGameStationKeys(game: Game): string[] {
    const details = this.toRecord(game.details);
    const booking = this.toRecord(details.booking);
    const rawValues = [
      booking.studioId,
      booking.studioName,
      booking.stationName,
      details.stationId,
      details.stationName,
      game.stationName,
      game.locationName,
      game.name
    ];

    const keys = new Set<string>();
    rawValues.forEach((value) => {
      this.expandStationAliases(value).forEach((key) => keys.add(key));
    });
    return Array.from(keys.values());
  }

  private expandStationAliases(value: unknown): string[] {
    const normalized = this.normalizeStationKey(value);
    if (!normalized) {
      return [];
    }

    const keys = new Set<string>([normalized]);
    Object.keys(GamesService.STATION_ALIAS_GROUPS).forEach((canonical) => {
      const aliases = GamesService.STATION_ALIAS_GROUPS[canonical];
      if (aliases.includes(normalized)) {
        aliases.forEach((alias) => keys.add(alias));
        keys.add(canonical);
      }
    });

    return Array.from(keys.values());
  }

  private normalizeStationKey(value: unknown): string | null {
    const text = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!text) {
      return null;
    }

    return text
      .replace(/[ё]/g, 'е')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  private async findByIdFromMongo(id: string): Promise<Game | null> {
    const collection = await this.getMongoCollection();
    const filter: Filter<MongoGameDoc>[] = [{ id }];
    if (ObjectId.isValid(id)) {
      filter.push({ _id: new ObjectId(id) });
    }

    const doc = (await collection.findOne({ $or: filter })) as MongoGameDoc | null;
    if (!doc) {
      return null;
    }
    return this.mapMongoGame(doc, { includeDetails: true });
  }

  private async findEventsFromMongo(
    filters?: GameEventListFilters
  ): Promise<GameEventListResult> {
    const collection = await this.getMongoEventsCollection();
    const pagination = this.normalizeGameEventsPagination(filters);
    const mongoFilter = this.buildMongoEventFilter(filters);
    const total = await collection.countDocuments(mongoFilter);
    const docs = (await collection
      .find(
        mongoFilter,
        {
          projection: {
            event: 1,
            timestamp: 1,
            sessionId: 1,
            source: 1,
            tenantKey: 1,
            page: 1,
            user: 1,
            payload: 1
          }
        }
      )
      .sort({ timestamp: -1, _id: -1 })
      .skip((pagination.page - 1) * pagination.pageSize)
      .limit(pagination.pageSize)
      .toArray()) as MongoGameEventDoc[];

    const items = docs
      .map((doc) => this.mapMongoEvent(doc))
      .filter((event): event is GameEvent => event !== null);

    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
    };
  }

  private async findAnalyticsFromMongo(filters?: GameAnalyticsFilters): Promise<GameAnalyticsResult> {
    const collection = await this.getMongoCollection();
    const normalizedFrom = this.normalizeAnalyticsDateValue(filters?.from);
    const normalizedTo = this.normalizeAnalyticsDateValue(filters?.to);
    const docs = (await collection
      .find(
        { archived: { $ne: true } },
        {
          projection: {
            booking: 1,
            stationName: 1,
            organizer: 1,
            participants: 1,
            participantPhones: 1,
            payment: 1,
            metadata: 1,
            createdAt: 1,
            createdTs: 1,
            updatedAt: 1
          }
        }
      )
      .toArray()) as MongoGameDoc[];

    const stationMap = new Map<
      string,
      {
        stationName: string;
        gamesCount: number;
        playersAddedCount: number;
        paymentsAmount: number;
      }
    >();

    docs.forEach((doc) => {
      const gameDate = this.resolveAnalyticsCreatedDate(doc);
      if (normalizedFrom && (!gameDate || gameDate < normalizedFrom)) {
        return;
      }
      if (normalizedTo && (!gameDate || gameDate > normalizedTo)) {
        return;
      }

      const stationName = this.resolveAnalyticsStationName(doc);
      const bucket = stationMap.get(stationName) ?? {
        stationName,
        gamesCount: 0,
        playersAddedCount: 0,
        paymentsAmount: 0
      };

      bucket.gamesCount += 1;
      bucket.playersAddedCount += this.calculateAnalyticsPlayersAdded(doc);
      bucket.paymentsAmount += this.calculateAnalyticsPaymentsAmount(doc);
      stationMap.set(stationName, bucket);
    });

    const items = Array.from(stationMap.values()).sort((left, right) => {
      if (right.gamesCount !== left.gamesCount) {
        return right.gamesCount - left.gamesCount;
      }
      if (right.playersAddedCount !== left.playersAddedCount) {
        return right.playersAddedCount - left.playersAddedCount;
      }
      if (right.paymentsAmount !== left.paymentsAmount) {
        return right.paymentsAmount - left.paymentsAmount;
      }
      return left.stationName.localeCompare(right.stationName, 'ru');
    });

    const totals = items.reduce(
      (acc, item) => {
        acc.gamesCount += item.gamesCount;
        acc.playersAddedCount += item.playersAddedCount;
        acc.paymentsAmount += item.paymentsAmount;
        return acc;
      },
      {
        gamesCount: 0,
        playersAddedCount: 0,
        paymentsAmount: 0
      }
    );

    return {
      from: normalizedFrom ?? undefined,
      to: normalizedTo ?? undefined,
      items,
      totals
    };
  }

  private async findEventByIdFromMongo(id: string): Promise<GameEvent | null> {
    const collection = await this.getMongoEventsCollection();
    const doc = (await collection.findOne(
      this.buildMongoEventIdFilter(id)
    )) as MongoGameEventDoc | null;
    if (!doc) {
      return null;
    }
    return this.mapMongoEvent(doc, { includeDetails: true });
  }

  private async getMongoCollection() {
    const db = await this.getMongoDatabase();
    return db.collection<MongoGameDoc>(this.mongoCollectionName);
  }

  private async getMongoEventsCollection() {
    const db = await this.getMongoDatabase();
    return db.collection<MongoGameEventDoc>(this.mongoEventsCollectionName);
  }

  private async getMongoDatabase() {
    if (!this.mongoUri) {
      throw new InternalServerErrorException(
        'Games MongoDB access requires MONGODB_URI or GAMES_MONGODB_URI'
      );
    }

    if (!this.mongoClient) {
      this.mongoClient = new MongoClient(this.mongoUri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 15
      });
      try {
        await this.mongoClient.connect();
        this.logger.log(
          `MongoDB games source enabled: db=${this.mongoDbName}, collection=${this.mongoCollectionName}`
        );
      } catch (error) {
        this.mongoClient = undefined;
        this.logger.error(`Mongo connect failed for games source: ${String(error)}`);
        throw new InternalServerErrorException('MongoDB connection failed for games source');
      }
    }

    return this.mongoClient.db(this.mongoDbName);
  }

  private buildMongoEventIdFilter(id: string): Filter<MongoGameEventDoc> {
    const variants: Record<string, unknown>[] = [];
    if (ObjectId.isValid(id)) {
      variants.push({ _id: new ObjectId(id) });
    }
    variants.push({ _id: id });
    return {
      $or: variants
    } as Filter<MongoGameEventDoc>;
  }

  private normalizeGameEventsPagination(
    filters?: GameEventListFilters
  ): { page: number; pageSize: number } {
    const rawPage = Number(filters?.page);
    const rawPageSize = Number(filters?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(Math.floor(rawPageSize), GamesService.GAME_EVENTS_MAX_PAGE_SIZE)
        : GamesService.GAME_EVENTS_DEFAULT_PAGE_SIZE;

    return { page, pageSize };
  }

  private buildMongoEventFilter(filters?: GameEventListFilters): Filter<MongoGameEventDoc> {
    const eventName = this.readString(filters?.event);
    const phoneDigits = this.normalizePhone(filters?.phone);
    const fromIso = this.normalizeDateFilterValue(filters?.from, false);
    const toIso = this.normalizeDateFilterValue(filters?.to, true);
    if (!eventName && !phoneDigits && !fromIso && !toIso) {
      return {};
    }

    const clauses: Filter<MongoGameEventDoc>[] = [];
    if (eventName) {
      clauses.push({ event: eventName } as Filter<MongoGameEventDoc>);
    }
    if (phoneDigits) {
      const phonePattern = this.buildLoosePhoneRegex(phoneDigits);
      clauses.push({
        $or: [
          { 'user.phone': { $regex: phonePattern } },
          { 'payload.context.phone': { $regex: phonePattern } }
        ]
      } as Filter<MongoGameEventDoc>);
    }

    const stringRange: Record<string, string> = {};
    const dateRange: Record<string, Date> = {};
    if (fromIso) {
      stringRange.$gte = fromIso;
      dateRange.$gte = new Date(fromIso);
    }
    if (toIso) {
      stringRange.$lte = toIso;
      dateRange.$lte = new Date(toIso);
    }

    if (fromIso || toIso) {
      clauses.push({
        $or: [
          { timestamp: stringRange },
          { createdAt: stringRange },
          { timestamp: dateRange },
          { createdAt: dateRange }
        ]
      } as Filter<MongoGameEventDoc>);
    }

    if (clauses.length === 1) {
      return clauses[0];
    }

    return {
      $and: clauses
    } as Filter<MongoGameEventDoc>;
  }

  private buildLoosePhoneRegex(phoneDigits: string): string {
    return phoneDigits
      .split('')
      .map((digit) => digit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\D*');
  }

  private normalizeDateFilterValue(value: string | undefined, endOfDay: boolean): string | null {
    const text = this.readString(value);
    if (!text) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const normalized = endOfDay
        ? `${text}T23:59:59.999Z`
        : `${text}T00:00:00.000Z`;
      const parsedDate = new Date(normalized);
      return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  private normalizeAnalyticsDateValue(value: string | undefined): string | null {
    const text = this.readString(value);
    if (!text) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    return this.toAnalyticsDateKey(text);
  }

  private resolveAnalyticsStationName(doc: MongoGameDoc): string {
    return (
      this.readString(doc.booking?.studioName) ??
      this.readString(doc.booking?.stationName) ??
      this.readString(doc.stationName) ??
      'Без станции'
    );
  }

  private resolveAnalyticsCreatedDate(doc: MongoGameDoc): string | null {
    const createdDateKey = this.toAnalyticsDateKey(this.resolveGameCreatedAt(doc));
    if (createdDateKey) {
      return createdDateKey;
    }

    const fallbackCandidates = [doc.booking?.timeFromIso, doc.booking?.date, doc.updatedAt];
    for (const candidate of fallbackCandidates) {
      const dateKey = this.toAnalyticsDateKey(candidate);
      if (dateKey) {
        return dateKey;
      }
    }

    return this.toAnalyticsDateKey(this.toIsoFromObjectId(doc._id));
  }

  private calculateAnalyticsPlayersAdded(doc: MongoGameDoc): number {
    const organizer = this.toRecord(doc.organizer);
    const organizerKeys = [
      this.normalizeParticipantAnalyticsKey(organizer.id),
      this.normalizeParticipantAnalyticsKey(organizer.phoneNorm),
      this.normalizeParticipantAnalyticsKey(organizer.phone)
    ].filter((key): key is string => Boolean(key));

    const participantKeys = new Set<string>();
    const pushParticipantKey = (value: unknown) => {
      const key = this.normalizeParticipantAnalyticsKey(value);
      if (key) {
        participantKeys.add(key);
      }
    };

    if (Array.isArray(doc.participants) && doc.participants.length > 0) {
      doc.participants.forEach((participant) => {
        pushParticipantKey(participant.id);
        pushParticipantKey(participant.phoneNorm);
        pushParticipantKey(participant.phone);
        pushParticipantKey(participant.name);
      });
    } else {
      const metadata = this.toRecord(doc.metadata);
      if (Array.isArray(metadata.teamSlots)) {
        metadata.teamSlots.forEach((slot) => {
          const slotRecord = this.toRecord(slot);
          pushParticipantKey(slotRecord.id);
          pushParticipantKey(slotRecord.phoneNorm);
          pushParticipantKey(slotRecord.phone);
          pushParticipantKey(slotRecord.name);
        });
      }
      this.toStringArray(doc.participantPhones).forEach((phone) => pushParticipantKey(phone));
    }

    if (participantKeys.size === 0) {
      return 0;
    }

    let removedOrganizer = false;
    organizerKeys.forEach((key) => {
      if (participantKeys.delete(key)) {
        removedOrganizer = true;
      }
    });

    if (!removedOrganizer && participantKeys.size > 0) {
      return Math.max(0, participantKeys.size - 1);
    }

    return participantKeys.size;
  }

  private normalizeParticipantAnalyticsKey(value: unknown): string | null {
    const asPhone = this.normalizePhone(value);
    if (asPhone) {
      return `phone:${asPhone}`;
    }

    const text = this.readString(value);
    if (!text) {
      return null;
    }
    return `text:${text.trim().toLowerCase()}`;
  }

  private calculateAnalyticsPaymentsAmount(doc: MongoGameDoc): number {
    const payment = this.toRecord(doc.payment);
    const paid = payment.paid === true;
    const paidAt = this.readString(payment.paidAt);
    const status = (this.readString(payment.status) ?? '').trim().toUpperCase();
    if (!(paid || paidAt || status === 'PAID')) {
      return 0;
    }

    const amount = this.extractAnalyticsPaymentAmount(doc);
    return amount !== null ? amount : 0;
  }

  private extractAnalyticsPaymentAmount(doc: MongoGameDoc): number | null {
    const candidatePaths = [
      'payment.totalAmount',
      'payment.fullAmount',
      'payment.amountTotal',
      'payment.sum',
      'payment.total',
      'payment.price',
      'booking.totalAmount',
      'booking.fullAmount',
      'booking.price',
      'metadata.payment.totalAmount',
      'metadata.payment.fullAmount',
      'metadata.totalAmount',
      'metadata.paymentAmount',
      'metadata.price'
    ];

    let fallback: number | null = null;
    for (const path of candidatePaths) {
      const value = this.readFlexibleNumber(this.getValueByPath(doc, path));
      if (value === null) {
        continue;
      }
      if (fallback === null) {
        fallback = value;
      }
      if (value > 0) {
        return value;
      }
    }

    return fallback;
  }

  private async getGameChatMessagesCollection() {
    if (!this.gameChatMongoUri) {
      throw new InternalServerErrorException(
        'Game chat requires MONGODB_URI or GAMES_CHAT_MONGODB_URI'
      );
    }

    if (!this.gameChatMongoClient) {
      this.gameChatMongoClient = new MongoClient(this.gameChatMongoUri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 15
      });
      try {
        await this.gameChatMongoClient.connect();
        this.logger.log(
          `MongoDB game chat enabled: db=${this.gameChatMongoDbName}, collection=${this.gameChatMessagesCollectionName}`
        );
      } catch (error) {
        this.gameChatMongoClient = undefined;
        this.logger.error(`Mongo connect failed for game chat source: ${String(error)}`);
        throw new InternalServerErrorException('MongoDB connection failed for game chat source');
      }
    }

    return this.gameChatMongoClient
      .db(this.gameChatMongoDbName)
      .collection<MongoGameChatMessageDoc>(this.gameChatMessagesCollectionName);
  }

  private async loadGameChat(
    game: Game
  ): Promise<{ gameId: string; messages: GameChatMessage[] }> {
    const candidates = this.collectChatGameIdCandidates(game);
    if (candidates.length === 0) {
      throw new BadRequestException(
        'Cannot resolve gameId for game chat. Add gameId in game payload.'
      );
    }

    const collection = await this.getGameChatMessagesCollection();
    let docs = await this.findGameChatDocsByGameIds(collection, candidates);
    let selectedGameId = this.pickSelectedChatGameId(docs, candidates);

    if (docs.length === 0) {
      const relatedPhones = this.extractRelatedPhones(game);
      if (relatedPhones.length > 0) {
        const discoveredDocs = await this.findGameChatDocsByRelatedPhones(collection, relatedPhones);
        selectedGameId = this.pickSelectedChatGameId(discoveredDocs, candidates);
        if (selectedGameId) {
          docs = await this.findGameChatDocsByGameIds(collection, [selectedGameId]);
        }
      }
    } else if (selectedGameId) {
      docs = await this.findGameChatDocsByGameIds(collection, [selectedGameId]);
    }

    const messages = docs
      .filter((doc) => (this.readString(doc.gameId) ?? '') === selectedGameId)
      .map((doc) => this.mapGameChatMessage(doc))
      .filter((item): item is GameChatMessage => Boolean(item));

    return { gameId: selectedGameId, messages };
  }

  private async findGameChatDocsByGameIds(
    collection: Awaited<ReturnType<GamesService['getGameChatMessagesCollection']>>,
    gameIds: string[]
  ): Promise<MongoGameChatMessageDoc[]> {
    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      return [];
    }

    return (await collection
      .find({
        gameId: { $in: gameIds },
        deleted: { $ne: true }
      })
      .sort({ createdTs: 1, createdAt: 1, _id: 1 })
      .limit(2000)
      .toArray()) as MongoGameChatMessageDoc[];
  }

  private async findGameChatDocsByRelatedPhones(
    collection: Awaited<ReturnType<GamesService['getGameChatMessagesCollection']>>,
    phoneDigits: string[]
  ): Promise<MongoGameChatMessageDoc[]> {
    if (!Array.isArray(phoneDigits) || phoneDigits.length === 0) {
      return [];
    }

    return (await collection
      .find({
        deleted: { $ne: true },
        $or: [
          { relatedPhones: { $in: phoneDigits } },
          { 'sender.phoneNorm': { $in: phoneDigits } }
        ]
      })
      .sort({ createdTs: 1, createdAt: 1, _id: 1 })
      .limit(2000)
      .toArray()) as MongoGameChatMessageDoc[];
  }

  private collectChatGameIdCandidates(game: Game): string[] {
    const details = this.toRecord(game.details);
    const metadata = this.toRecord(details.metadata);
    const booking = this.toRecord(details.booking);
    const payment = this.toRecord(details.payment);

    const raw = [
      this.readString(details.gameId),
      this.readString(details.game_id),
      this.readString(details.chatGameId),
      this.readString(details.chat_game_id),
      this.readString(metadata.gameId),
      this.readString(metadata.game_id),
      this.readString(metadata.chatGameId),
      this.readString(metadata.chat_game_id),
      this.readString(details.id),
      this.readString(booking.slotId),
      this.readString(booking.slot_id),
      this.readString(details.slotId),
      this.readString(details.slot_id),
      this.readString(details.dedupeKey),
      this.readString(payment.paymentRef),
      game.id
    ];

    const deduped = new Set<string>();
    for (const value of raw) {
      const cleaned = (value ?? '').trim();
      if (cleaned.length > 0) {
        this.expandChatGameIdCandidateVariants(cleaned).forEach((variant) => deduped.add(variant));
      }
    }
    return Array.from(deduped);
  }

  private expandChatGameIdCandidateVariants(value: string): string[] {
    const cleaned = String(value ?? '').trim();
    if (!cleaned) {
      return [];
    }

    const variants = new Set<string>([cleaned]);
    variants.add(cleaned.toLowerCase());
    variants.add(cleaned.toUpperCase());

    if (cleaned.includes(':')) {
      const underscored = cleaned.replace(/:/g, '_');
      variants.add(underscored);
      variants.add(underscored.toLowerCase());
      variants.add(underscored.toUpperCase());
    }

    if (cleaned.includes('_')) {
      const colonized = cleaned.replace(/_/g, ':');
      variants.add(colonized);
      variants.add(colonized.toLowerCase());
      variants.add(colonized.toUpperCase());
    }

    return Array.from(variants).filter((item) => item.trim().length > 0);
  }

  private pickSelectedChatGameId(
    docs: MongoGameChatMessageDoc[],
    candidates: string[]
  ): string {
    if (docs.length === 0) {
      return candidates[0];
    }

    const exactCandidates = new Set(candidates);
    const normalizedCandidates = new Set(
      candidates
        .map((candidate) => this.normalizeChatGameIdKey(candidate))
        .filter((candidate): candidate is string => Boolean(candidate))
    );
    const stats = new Map<string, { count: number; firstIndex: number }>();
    docs.forEach((doc, index) => {
      const key = this.readString(doc.gameId);
      if (!key) {
        return;
      }
      const entry = stats.get(key);
      if (!entry) {
        stats.set(key, { count: 1, firstIndex: index });
        return;
      }
      entry.count += 1;
      stats.set(key, entry);
    });

    let winner = candidates[0];
    let winnerCount = -1;
    let winnerIndex = Number.MAX_SAFE_INTEGER;
    let winnerMatchScore = -1;

    for (const [key, value] of stats.entries()) {
      const normalizedKey = this.normalizeChatGameIdKey(key);
      const matchScore = exactCandidates.has(key)
        ? 2
        : normalizedKey && normalizedCandidates.has(normalizedKey)
          ? 1
          : 0;

      if (matchScore > winnerMatchScore) {
        winner = key;
        winnerCount = value.count;
        winnerIndex = value.firstIndex;
        winnerMatchScore = matchScore;
        continue;
      }
      if (matchScore < winnerMatchScore) {
        continue;
      }
      if (value.count > winnerCount) {
        winner = key;
        winnerCount = value.count;
        winnerIndex = value.firstIndex;
        winnerMatchScore = matchScore;
        continue;
      }
      if (value.count === winnerCount && value.firstIndex < winnerIndex) {
        winner = key;
        winnerIndex = value.firstIndex;
        winnerMatchScore = matchScore;
      }
    }

    return winner;
  }

  private normalizeChatGameIdKey(value: unknown): string | null {
    const cleaned = this.readString(value);
    if (!cleaned) {
      return null;
    }
    return cleaned.trim().toLowerCase().replace(/:/g, '_');
  }

  private mapGameChatMessage(doc: MongoGameChatMessageDoc): GameChatMessage | null {
    const id = this.readObjectId(doc._id) ?? this.readString(doc._id);
    const gameId = this.readString(doc.gameId);
    const text = this.readString(doc.text);
    const createdAt = this.readString(doc.createdAt) ?? this.toIsoFromEpoch(doc.createdTs);

    if (!id || !gameId || !text || !createdAt) {
      return null;
    }

    const sender = this.toRecord(doc.sender);
    const senderRoleRaw = this.readString(sender.role) ?? undefined;

    return {
      id,
      gameId,
      text,
      createdAt,
      senderId: this.readString(sender.id) ?? undefined,
      senderName: this.readString(sender.name) ?? undefined,
      senderRole: this.normalizeSenderRole(senderRoleRaw),
      senderRoleRaw,
      type: this.readString(doc.type) ?? undefined
    };
  }

  private normalizeSenderRole(raw: string | undefined): StaffSide {
    if (!raw) {
      return 'STAFF';
    }
    const upper = raw.trim().toUpperCase();
    if (
      ['CLIENT', 'CUSTOMER', 'PLAYER', 'ORGANIZER', 'USER', 'VISITOR', 'MEMBER'].includes(upper)
    ) {
      return 'CLIENT';
    }
    return 'STAFF';
  }

  private resolveSenderName(user: RequestUser): string {
    if (user.id && user.id !== 'anonymous') {
      return user.id;
    }
    return this.gameChatAdminSenderName;
  }

  private resolveSenderRole(user: RequestUser): string {
    const nonClientRole = user.roles.find((role) => role !== Role.CLIENT);
    return nonClientRole ?? this.gameChatAdminSenderRole;
  }

  private extractTenantKey(game: Game): string | null {
    const details = this.toRecord(game.details);
    return this.readString(details.tenantKey) ?? this.readString(details.tenant_key);
  }

  private extractRelatedPhones(game: Game): string[] {
    const details = this.toRecord(game.details);
    const organizer = this.toRecord(details.organizer);
    const metadata = this.toRecord(details.metadata);
    const joinResponses = this.toRecord(metadata.joinResponses);
    const phones = new Set<string>();

    const addPhone = (value: unknown) => {
      const cleaned = this.normalizePhone(value);
      if (cleaned) {
        phones.add(cleaned);
      }
    };

    [
      details.relatedPhones,
      details.allRelatedPhones,
      details.participantPhones,
      details.invitedPhones,
      details.waitlistPhones
    ].forEach((value) => {
      this.toStringArray(value).forEach((phone) => addPhone(phone));
    });

    if (Array.isArray(details.participants)) {
      details.participants.forEach((participant) => {
        const participantRecord = this.toRecord(participant);
        addPhone(participantRecord.phone);
        addPhone(participantRecord.phoneNorm);
      });
    }

    if (Array.isArray(metadata.teamSlots)) {
      metadata.teamSlots.forEach((slot) => {
        const slotRecord = this.toRecord(slot);
        addPhone(slotRecord.phone);
        addPhone(slotRecord.phoneNorm);
      });
    }

    Object.keys(joinResponses).forEach((phone) => addPhone(phone));
    addPhone(organizer.phone);

    return Array.from(phones.values());
  }

  private normalizePhone(value: unknown): string | null {
    const text = String(value ?? '').trim();
    if (!text) {
      return null;
    }
    const digits = text.replace(/\D+/g, '');
    return digits.length > 0 ? digits : null;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }

  private mapMongoGame(doc: MongoGameDoc, options?: { includeDetails?: boolean }): Game | null {
    const id = this.readString(doc.id) ?? this.readObjectId(doc._id);
    const studioName = this.readString(doc.booking?.studioName);
    const roomName = this.readString(doc.booking?.roomName);
    const bookingDate = this.readString(doc.booking?.date);
    const bookingTimeFrom = this.readString(doc.booking?.timeFrom);
    const bookingTimeTo = this.readString(doc.booking?.timeTo);
    const startsAt = this.readString(doc.booking?.timeFromIso);
    const rawStatus = this.readString(doc.status);

    if (!id) {
      return null;
    }

    const locationName = [studioName, roomName].filter(Boolean).join(' · ');
    const participantDetails = Array.isArray(doc.participants)
      ? doc.participants.reduce((acc, participant) => {
          const name = this.readString(participant?.name);
          if (!name) {
            return acc;
          }
          const phone = this.readString(participant?.phone);
          const value: GameParticipantDetails = phone ? { name, phone } : { name };
          acc.push(value);
          return acc;
        }, [] as GameParticipantDetails[])
      : [];
    const participantNames = participantDetails.map((participant) => participant.name);
    const gameTime =
      bookingTimeFrom && bookingTimeTo ? `${bookingTimeFrom}-${bookingTimeTo}` : undefined;
    const teamParticipantLines = this.resolveTeamParticipantLines(doc);
    const resultLines = this.resolveGameResultLines(doc);
    const ratingDeltaLines = this.resolveGameRatingDeltaLines(doc);
    const result =
      resultLines.length > 0 ? resultLines.join('\n') : this.resolveGameResult(doc);
    const ratingDelta =
      ratingDeltaLines.length > 0
        ? ratingDeltaLines.join('\n')
        : this.resolveGameRatingDelta(doc);

    return {
      id,
      source: 'LK_PADELHUB_MONGO',
      name: locationName || `Игра ${id}`,
      status: this.normalizeMongoStatus(rawStatus, doc.archived),
      rawStatus: rawStatus ?? undefined,
      startsAt: startsAt ?? undefined,
      createdAt: this.resolveGameCreatedAt(doc) ?? undefined,
      updatedAt: this.readString(doc.updatedAt) ?? undefined,
      organizerName: this.readString(doc.organizer?.name) ?? undefined,
      participantNames,
      participantDetails,
      gameDate: bookingDate ?? undefined,
      gameTime,
      stationName: studioName ?? undefined,
      courtName: roomName ?? undefined,
      locationName: locationName || undefined,
      teamParticipantLines,
      result: result ?? undefined,
      resultLines,
      ratingDelta: ratingDelta ?? undefined,
      ratingDeltaLines,
      details: options?.includeDetails ? this.normalizeForJson(doc) : undefined
    };
  }

  private resolveTeamParticipantLines(doc: MongoGameDoc): string[] {
    const metadata = this.toRecord(doc.metadata);
    const ratingImpact = this.extractRatingImpactEntries(metadata.matchResult ?? doc.matchResult);
    const teams = new Map<string, string[]>();
    const dedupe = new Map<string, Set<string>>();

    const pushToTeam = (teamNameRaw: string | null, playerLabel: string | null) => {
      const player = String(playerLabel ?? '').trim();
      if (!player) {
        return;
      }
      const teamName = this.normalizeTeamName(teamNameRaw);
      const teamSet = dedupe.get(teamName) ?? new Set<string>();
      if (teamSet.has(player)) {
        return;
      }
      teamSet.add(player);
      dedupe.set(teamName, teamSet);

      const lines = teams.get(teamName) ?? [];
      lines.push(player);
      teams.set(teamName, lines);
    };

    ratingImpact.forEach((entry) => {
      const team = this.readString(entry.team);
      const playerLabel = this.formatPlayerLabel(
        this.readString(entry.name),
        this.readString(entry.phoneNorm) ?? this.readString(entry.phone)
      );
      pushToTeam(team, playerLabel);
    });

    if (teams.size === 0) {
      const teamSlots = Array.isArray(metadata.teamSlots) ? metadata.teamSlots : [];
      if (teamSlots.length > 0) {
        const midpoint = Math.ceil(teamSlots.length / 2);
        teamSlots.forEach((slot, index) => {
          const slotRecord = this.toRecord(slot);
          const teamRaw =
            this.readString(slotRecord.team) ??
            this.readString(slotRecord.side) ??
            this.readString(slotRecord.slotTeam);
          const team = teamRaw ?? (index < midpoint ? 'A' : 'B');
          const playerLabel = this.formatPlayerLabel(
            this.readString(slotRecord.name),
            this.readString(slotRecord.phone)
          );
          pushToTeam(team, playerLabel);
        });
      }
    }

    if (teams.size < 2) {
      return [];
    }

    const orderedTeams = Array.from(teams.entries()).sort(([left], [right]) =>
      this.teamSortKey(left).localeCompare(this.teamSortKey(right), 'ru')
    );

    const lines: string[] = [];
    orderedTeams.forEach(([teamName, players]) => {
      lines.push(`Команда ${teamName}`);
      players.forEach((player) => {
        lines.push(player);
      });
    });
    return lines;
  }

  private normalizeTeamName(value: string | null): string {
    const team = String(value ?? '').trim().toUpperCase();
    if (!team) {
      return 'A';
    }
    return team;
  }

  private teamSortKey(value: string): string {
    const normalized = this.normalizeTeamName(value);
    const directOrder = ['A', 'B', 'C', 'D'];
    const index = directOrder.indexOf(normalized);
    if (index >= 0) {
      return `0${index}_${normalized}`;
    }
    return `1_${normalized}`;
  }

  private formatPlayerLabel(name: string | null, phone: string | null): string | null {
    const normalizedName = String(name ?? '').trim();
    const normalizedPhone = String(phone ?? '').trim();
    if (!normalizedName && !normalizedPhone) {
      return null;
    }
    if (normalizedName && normalizedPhone) {
      return `${normalizedName} · ${normalizedPhone}`;
    }
    return normalizedName || normalizedPhone || null;
  }

  private resolveGameResultLines(doc: MongoGameDoc): string[] {
    const metadata = this.toRecord(doc.metadata);
    const lines = this.extractMatchResultSetLines(metadata.matchResult ?? doc.matchResult);
    if (lines.length > 0) {
      return lines;
    }

    const fallback = this.resolveGameResult(doc);
    if (!fallback) {
      return [];
    }
    return fallback
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private resolveGameRatingDeltaLines(doc: MongoGameDoc): string[] {
    const metadata = this.toRecord(doc.metadata);
    const ratingImpact = this.extractRatingImpactEntries(metadata.matchResult ?? doc.matchResult);
    if (ratingImpact.length > 0) {
      return ratingImpact
        .map((entry) => {
          const name =
            this.readString(entry.name) ??
            this.readString(entry.phoneNorm) ??
            this.readString(entry.phone);
          const before = this.readNumber(entry.before);
          const after = this.readNumber(entry.after);
          const delta =
            this.readNumber(entry.delta) ??
            (before !== null && after !== null ? after - before : null);

          const beforeText = before !== null ? this.formatNumber(before) : '?';
          const afterText = after !== null ? this.formatNumber(after) : '?';
          const deltaText = delta !== null ? this.formatSignedNumber(delta) : '?';
          const title = name ? `${name}: ` : '';

          return `${title}${beforeText} -> ${afterText} (${deltaText})`;
        })
        .filter((line) => line.trim().length > 0);
    }

    const fallback = this.resolveGameRatingDelta(doc);
    if (!fallback) {
      return [];
    }
    return fallback
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private resolveGameResult(doc: MongoGameDoc): string | null {
    const metadata = this.toRecord(doc.metadata);
    const matchResultSummary = this.resolveMatchResultSummary(
      metadata.matchResult ?? doc.matchResult
    );
    if (matchResultSummary) {
      return matchResultSummary;
    }

    const directCandidates = [
      doc.result,
      doc.score,
      doc.matchResult,
      doc.gameResult,
      doc.finalResult,
      doc.finalScore,
      doc.matchScore,
      metadata.result,
      metadata.score,
      metadata.matchResult,
      metadata.gameResult,
      metadata.finalResult,
      metadata.finalScore,
      metadata.matchScore
    ];

    for (const candidate of directCandidates) {
      const fromString = this.readString(candidate);
      if (fromString) {
        return fromString;
      }

      const fromNumber = this.readNumber(candidate);
      if (fromNumber !== null) {
        return this.formatNumber(fromNumber);
      }

      const fromScoreObject = this.resolveScoreObject(candidate);
      if (fromScoreObject) {
        return fromScoreObject;
      }
    }

    return null;
  }

  private resolveGameRatingDelta(doc: MongoGameDoc): string | null {
    const metadata = this.toRecord(doc.metadata);
    const ratingImpactSummary = this.summarizeRatingDeltaSet(
      this.extractRatingImpactDeltas(metadata.matchResult ?? doc.matchResult)
    );
    if (ratingImpactSummary) {
      return ratingImpactSummary;
    }

    const scalarCandidates = [
      doc.ratingDelta,
      doc.ratingChange,
      doc.ratingDiff,
      metadata.ratingDelta,
      metadata.ratingChange,
      metadata.ratingDiff
    ];

    for (const candidate of scalarCandidates) {
      const fromString = this.readString(candidate);
      if (fromString) {
        return fromString;
      }
      const fromNumber = this.readNumber(candidate);
      if (fromNumber !== null) {
        return this.formatSignedNumber(fromNumber);
      }
    }

    const mapCandidates = [
      doc.ratingChanges,
      doc.ratingDeltas,
      doc.ratingDeltaByPlayer,
      doc.ratingDiffByPlayer,
      metadata.ratingChanges,
      metadata.ratingDeltas,
      metadata.ratingDeltaByPlayer,
      metadata.ratingDiffByPlayer
    ];
    for (const candidate of mapCandidates) {
      const summary = this.summarizeRatingDeltaSet(this.extractNumericValues(candidate));
      if (summary) {
        return summary;
      }
    }

    const participantSummary = this.summarizeParticipantRatingDeltas(doc.participants);
    if (participantSummary) {
      return participantSummary;
    }

    return null;
  }

  private resolveMatchResultSummary(value: unknown): string | null {
    const lines = this.extractMatchResultSetLines(value);
    if (lines.length === 0) {
      return null;
    }
    return lines.join(' ');
  }

  private extractMatchResultSetLines(value: unknown): string[] {
    const matchResult = this.toRecord(value);
    const sets = matchResult.sets;
    if (!Array.isArray(sets) || sets.length === 0) {
      return [];
    }

    return sets
      .map((setEntry) => {
        const setRecord = this.toRecord(setEntry);
        const left = this.readString(setRecord.left) ?? this.formatNumberOrNull(setRecord.left);
        const right =
          this.readString(setRecord.right) ?? this.formatNumberOrNull(setRecord.right);
        if (!left || !right) {
          return null;
        }
        return `${left}:${right}`;
      })
      .filter((entry): entry is string => Boolean(entry));
  }

  private extractRatingImpactEntries(value: unknown): Record<string, unknown>[] {
    const matchResult = this.toRecord(value);
    const ratingImpact = matchResult.ratingImpact;
    if (!Array.isArray(ratingImpact)) {
      return [];
    }
    return ratingImpact
      .map((entry) => this.toRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0);
  }

  private extractRatingImpactDeltas(value: unknown): number[] {
    const matchResult = this.toRecord(value);
    const ratingImpact = matchResult.ratingImpact;
    if (!Array.isArray(ratingImpact) || ratingImpact.length === 0) {
      return [];
    }

    const deltas: number[] = [];
    ratingImpact.forEach((impactEntry) => {
      const impact = this.toRecord(impactEntry);
      const delta =
        this.readNumber(impact.delta) ??
        this.readNumber(impact.ratingDelta) ??
        this.readNumber(impact.rating_change) ??
        this.readNumber(impact.change);
      if (delta !== null) {
        deltas.push(delta);
        return;
      }

      const before = this.readNumber(impact.before);
      const after = this.readNumber(impact.after);
      if (before !== null && after !== null) {
        deltas.push(after - before);
      }
    });

    return deltas;
  }

  private summarizeParticipantRatingDeltas(participants: unknown): string | null {
    if (!Array.isArray(participants)) {
      return null;
    }

    const deltas: number[] = [];
    participants.forEach((participant) => {
      const entry = this.toRecord(participant);
      const direct =
        this.readNumber(entry.ratingDelta) ??
        this.readNumber(entry.rating_change) ??
        this.readNumber(entry.deltaRating) ??
        this.readNumber(entry.ratingDiff) ??
        this.readNumber(entry.ratingChange);
      if (direct !== null) {
        deltas.push(direct);
        return;
      }

      const before =
        this.readNumber(entry.ratingBefore) ??
        this.readNumber(entry.rating_before) ??
        this.readNumber(entry.oldRating) ??
        this.readNumber(entry.prevRating);
      const after =
        this.readNumber(entry.ratingAfter) ??
        this.readNumber(entry.rating_after) ??
        this.readNumber(entry.newRating) ??
        this.readNumber(entry.nextRating);

      if (before !== null && after !== null) {
        deltas.push(after - before);
      }
    });

    return this.summarizeRatingDeltaSet(deltas);
  }

  private summarizeRatingDeltaSet(values: number[]): string | null {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }

    const normalized = values.filter((value) => Number.isFinite(value));
    if (normalized.length === 0) {
      return null;
    }
    if (normalized.length === 1) {
      return this.formatSignedNumber(normalized[0]);
    }

    const plus = normalized.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const minus = normalized.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
    const parts: string[] = [];
    if (plus !== 0) {
      parts.push(this.formatSignedNumber(plus));
    }
    if (minus !== 0) {
      parts.push(this.formatSignedNumber(minus));
    }
    if (parts.length === 0) {
      parts.push('0');
    }

    return `${parts.join(' / ')} (${normalized.length} чел.)`;
  }

  private extractNumericValues(value: unknown): number[] {
    if (value == null) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractNumericValues(item));
    }

    const directNumber = this.readNumber(value);
    if (directNumber !== null) {
      return [directNumber];
    }

    if (typeof value !== 'object') {
      return [];
    }

    const record = this.toRecord(value);
    const preferredKeys = [
      'delta',
      'ratingDelta',
      'rating_change',
      'ratingDiff',
      'ratingChange',
      'change'
    ];

    const collected: number[] = [];
    preferredKeys.forEach((key) => {
      const parsed = this.readNumber(record[key]);
      if (parsed !== null) {
        collected.push(parsed);
      }
    });
    if (collected.length > 0) {
      return collected;
    }

    return Object.values(record)
      .map((entry) => this.readNumber(entry))
      .filter((entry): entry is number => entry !== null);
  }

  private resolveScoreObject(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = this.toRecord(value);

    const stringFirst = [
      this.readString(record.score),
      this.readString(record.result),
      this.readString(record.matchScore),
      this.readString(record.finalScore)
    ].find((entry) => Boolean(entry));
    if (stringFirst) {
      return stringFirst;
    }

    const pairs: Array<[unknown, unknown]> = [
      [record.home, record.away],
      [record.left, record.right],
      [record.teamA, record.teamB],
      [record.team1, record.team2],
      [record.scoreA, record.scoreB],
      [record.score1, record.score2],
      [record.a, record.b]
    ];

    for (const [left, right] of pairs) {
      const leftValue = this.readString(left) ?? this.formatNumberOrNull(left);
      const rightValue = this.readString(right) ?? this.formatNumberOrNull(right);
      if (leftValue && rightValue) {
        return `${leftValue}:${rightValue}`;
      }
    }

    return null;
  }

  private formatNumberOrNull(value: unknown): string | null {
    const parsed = this.readNumber(value);
    if (parsed === null) {
      return null;
    }
    return this.formatNumber(parsed);
  }

  private formatSignedNumber(value: number): string {
    const abs = this.formatNumber(Math.abs(value));
    if (value > 0) {
      return `+${abs}`;
    }
    if (value < 0) {
      return `-${abs}`;
    }
    return '0';
  }

  private formatNumber(value: number): string {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(2).replace(/\.?0+$/, '');
  }

  private normalizeForJson(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  private mapMongoEvent(
    doc: MongoGameEventDoc,
    options?: { includeDetails?: boolean }
  ): GameEvent | null {
    const id = this.readObjectId(doc._id) ?? this.readScalarString(doc._id);
    if (!id) {
      return null;
    }

    const event = this.readFieldString(doc, ['event']) ?? 'unknown';
    const timestamp =
      this.readIsoDateValue(this.getValueByPath(doc, 'timestamp')) ??
      this.readIsoDateValue(this.getValueByPath(doc, 'createdAt')) ??
      this.toIsoFromEpoch(this.getValueByPath(doc, 'timestampTs')) ??
      this.toIsoFromEpoch(this.getValueByPath(doc, 'createdTs')) ??
      undefined;
    const payloadMessage =
      this.readFieldString(doc, [
        'payload.message',
        'payload.context.message',
        'payload.reason',
        'payload.status'
      ]) ?? undefined;
    const payloadError =
      this.readFieldString(doc, ['payload.errorMessage', 'payload.errorName']) ?? undefined;

    return {
      id,
      event,
      timestamp,
      sessionId: this.readFieldString(doc, ['sessionId']) ?? undefined,
      source: this.readFieldString(doc, ['source']) ?? undefined,
      tenantKey: this.readFieldString(doc, ['tenantKey']) ?? undefined,
      pagePath: this.readFieldString(doc, ['page.path']) ?? undefined,
      pageHref: this.readFieldString(doc, ['page.href']) ?? undefined,
      userPhone: this.readFieldString(doc, ['user.phone', 'payload.context.phone']) ?? undefined,
      userClientId:
        this.readFieldString(doc, ['user.clientId', 'payload.clientId', 'payload.context.clientId']) ??
        undefined,
      userName: this.buildEventUserName(doc) ?? undefined,
      payloadLabel: this.readFieldString(doc, ['payload.label']) ?? undefined,
      payloadModule: this.readFieldString(doc, ['payload.module']) ?? undefined,
      payloadSource: this.readFieldString(doc, ['payload.source']) ?? undefined,
      payloadStatus: this.readFieldString(doc, ['payload.status']) ?? undefined,
      payloadMessage,
      payloadError,
      details: options?.includeDetails ? this.normalizeForJson(doc) : undefined
    };
  }

  private buildEventUserName(doc: MongoGameEventDoc): string | null {
    const parts = [
      this.readFieldString(doc, ['user.firstName']),
      this.readFieldString(doc, ['user.lastName'])
    ].filter((item): item is string => Boolean(item));
    if (parts.length > 0) {
      return parts.join(' ');
    }
    return this.readFieldString(doc, ['user.email', 'user.clientId', 'user.phone']);
  }

  private getValueByPath(source: unknown, path: string): unknown {
    if (!source || typeof source !== 'object') {
      return undefined;
    }

    const record = source as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, path)) {
      return record[path];
    }

    const parts = path.split('.');
    let current: unknown = record;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private readFieldString(source: unknown, paths: string[]): string | null {
    for (const path of paths) {
      const value = this.getValueByPath(source, path);
      const text = this.readScalarString(value);
      if (text) {
        return text;
      }
    }
    return null;
  }

  private normalizeMongoStatus(rawStatus: string | null, archived: unknown): GameStatus {
    if (archived === true) {
      return GameStatus.ARCHIVED;
    }
    if (!rawStatus) {
      return GameStatus.UNKNOWN;
    }

    const normalized = rawStatus.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (
      ['PAYMENT_PENDING', 'PENDING', 'DRAFT', 'NEW', 'WAITING_PAYMENT'].includes(normalized)
    ) {
      return GameStatus.DRAFT;
    }
    if (
      ['ACTIVE', 'OPEN', 'CONFIRMED', 'READY', 'RUNNING', 'STARTED'].includes(normalized)
    ) {
      return GameStatus.ACTIVE;
    }
    if (
      ['ARCHIVED', 'CANCELLED', 'CANCELED', 'FINISHED', 'DONE', 'COMPLETED'].includes(
        normalized
      )
    ) {
      return GameStatus.ARCHIVED;
    }
    return GameStatus.UNKNOWN;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toIsoFromEpoch(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    return null;
  }

  private toIsoFromObjectId(value: unknown): string | null {
    if (value instanceof ObjectId) {
      return value.getTimestamp().toISOString();
    }

    const objectId = this.readObjectId(value);
    if (!objectId || !ObjectId.isValid(objectId)) {
      return null;
    }

    return new ObjectId(objectId).getTimestamp().toISOString();
  }

  private resolveGameCreatedAt(doc: MongoGameDoc): string | null {
    const metadata = this.toRecord(doc.metadata);
    const candidates = [doc.createdAt, doc.createdTs, metadata.createdAt, metadata.createdTs];
    for (const candidate of candidates) {
      const iso = this.normalizeIsoDateCandidate(candidate);
      if (iso) {
        return iso;
      }
    }

    return this.toIsoFromObjectId(doc._id);
  }

  private normalizeIsoDateCandidate(value: unknown): string | null {
    const fromEpoch = this.toIsoFromEpoch(value);
    if (fromEpoch) {
      return fromEpoch;
    }

    const text = this.readIsoDateValue(value);
    if (!text) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return `${text}T00:00:00.000Z`;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  private toAnalyticsDateKey(value: unknown): string | null {
    const text = this.readString(value);
    if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const iso = this.normalizeIsoDateCandidate(value);
    if (!iso) {
      return null;
    }

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return this.formatDateKeyInAnalyticsTimeZone(parsed);
  }

  private formatDateKeyInAnalyticsTimeZone(value: Date): string {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.analyticsTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(value);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fallback to UTC date key if timezone is not supported by the runtime.
    }

    return value.toISOString().slice(0, 10);
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readScalarString(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return this.readString(value);
  }

  private readIsoDateValue(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    return this.readString(value);
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readFlexibleNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/,/g, '.')
      .replace(/[^\d.+-]/g, '');

    if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readObjectId(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (value instanceof ObjectId) {
      return value.toHexString();
    }
    return null;
  }

  private readEnv(name: string): string | null {
    const value = String(process.env[name] ?? '').trim();
    return value.length > 0 ? value : null;
  }
}
