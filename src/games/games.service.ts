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
  GameChatContext,
  GameChatMessage,
  GameParticipantDetails,
  GameStatus
} from './games.types';

type GamesSourceMode = 'lk' | 'mongo';
type StaffSide = 'CLIENT' | 'STAFF';

interface MongoGameParticipant {
  name?: unknown;
  phone?: unknown;
}

interface MongoGameDoc {
  [key: string]: unknown;
  _id?: unknown;
  id?: unknown;
  status?: unknown;
  archived?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  organizer?: {
    name?: unknown;
  };
  participants?: MongoGameParticipant[];
  booking?: {
    [key: string]: unknown;
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

@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name);
  private readonly sourceMode = this.resolveSourceMode();
  private readonly mongoUri = this.readEnv('GAMES_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbName = this.readEnv('GAMES_MONGODB_DB') ?? 'games';
  private readonly mongoCollectionName = this.readEnv('GAMES_MONGODB_COLLECTION') ?? 'lk_games';

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

  async findAll(): Promise<Game[]> {
    if (this.sourceMode === 'mongo') {
      return this.findAllFromMongo();
    }
    return this.lkPadelHubClient.listGames();
  }

  async findById(id: string): Promise<Game> {
    if (this.sourceMode === 'mongo') {
      const fromMongo = await this.findByIdFromMongo(id);
      if (!fromMongo) {
        throw new NotFoundException(`Game with id ${id} not found`);
      }
      return fromMongo;
    }

    const game = await this.lkPadelHubClient.getGameById(id);
    if (!game) {
      throw new NotFoundException(`Game with id ${id} not found`);
    }
    return game;
  }

  async getGameChat(id: string, _user: RequestUser): Promise<GameChatContext> {
    const game = await this.findById(id);
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
    const game = await this.findById(id);
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
            updatedAt: 1,
            organizer: 1,
            participants: 1,
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

  private async getMongoCollection() {
    if (!this.mongoUri) {
      throw new InternalServerErrorException(
        'GAMES_SOURCE=mongo requires MONGODB_URI or GAMES_MONGODB_URI'
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

    return this.mongoClient.db(this.mongoDbName).collection<MongoGameDoc>(this.mongoCollectionName);
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
    const docs = (await collection
      .find({
        gameId: { $in: candidates },
        deleted: { $ne: true }
      })
      .sort({ createdTs: 1, createdAt: 1, _id: 1 })
      .limit(2000)
      .toArray()) as MongoGameChatMessageDoc[];

    const selectedGameId = this.pickSelectedChatGameId(docs, candidates);
    const messages = docs
      .filter((doc) => (this.readString(doc.gameId) ?? '') === selectedGameId)
      .map((doc) => this.mapGameChatMessage(doc))
      .filter((item): item is GameChatMessage => Boolean(item));

    return { gameId: selectedGameId, messages };
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
        deduped.add(cleaned);
      }
    }
    return Array.from(deduped);
  }

  private pickSelectedChatGameId(
    docs: MongoGameChatMessageDoc[],
    candidates: string[]
  ): string {
    if (docs.length === 0) {
      return candidates[0];
    }

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

    for (const [key, value] of stats.entries()) {
      if (value.count > winnerCount) {
        winner = key;
        winnerCount = value.count;
        winnerIndex = value.firstIndex;
        continue;
      }
      if (value.count === winnerCount && value.firstIndex < winnerIndex) {
        winner = key;
        winnerIndex = value.firstIndex;
      }
    }

    return winner;
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

    return {
      id,
      source: 'LK_PADELHUB_MONGO',
      name: locationName || `Игра ${id}`,
      status: this.normalizeMongoStatus(rawStatus, doc.archived),
      rawStatus: rawStatus ?? undefined,
      startsAt: startsAt ?? undefined,
      createdAt: this.readString(doc.createdAt) ?? undefined,
      updatedAt: this.readString(doc.updatedAt) ?? undefined,
      organizerName: this.readString(doc.organizer?.name) ?? undefined,
      participantNames,
      participantDetails,
      gameDate: bookingDate ?? undefined,
      gameTime,
      locationName: locationName || undefined,
      details: options?.includeDetails ? this.normalizeForJson(doc) : undefined
    };
  }

  private normalizeForJson(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
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
