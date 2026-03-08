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
import { MessengerService } from '../messenger/messenger.service';
import { ChatThread, ConnectorRoute, ThreadStatus } from '../messenger/messenger.types';
import { Game, GameChatContext, GameParticipantDetails, GameStatus } from './games.types';

type GamesSourceMode = 'lk' | 'mongo';

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

@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name);
  private readonly sourceMode = this.resolveSourceMode();
  private readonly mongoUri = this.readEnv('GAMES_MONGODB_URI') ?? this.readEnv('MONGODB_URI');
  private readonly mongoDbName = this.readEnv('GAMES_MONGODB_DB') ?? 'games';
  private readonly mongoCollectionName = this.readEnv('GAMES_MONGODB_COLLECTION') ?? 'lk_games';
  private readonly gameChatConnector = this.resolveGameChatConnector();
  private readonly gameChatDefaultStationId = this.readEnv('GAMES_CHAT_DEFAULT_STATION_ID');
  private mongoClient?: MongoClient;

  constructor(
    private readonly lkPadelHubClient: LkPadelHubClientService,
    private readonly messengerService: MessengerService
  ) {}

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

  async getGameChat(id: string, user: RequestUser): Promise<GameChatContext> {
    const game = await this.findById(id);
    const station = this.resolveGameStation(game, user);
    const thread = this.findOrCreateGameThread(game, station.stationId, station.stationName, user);
    const messages = this.messengerService.listMessages(thread.id, user);
    return {
      game,
      thread,
      messages
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.mongoClient) {
      return;
    }
    await this.mongoClient.close().catch(() => undefined);
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

  private resolveGameChatConnector(): ConnectorRoute {
    const configured = (this.readEnv('GAMES_CHAT_CONNECTOR') ?? '').toUpperCase();
    if ((Object.values(ConnectorRoute) as string[]).includes(configured)) {
      return configured as ConnectorRoute;
    }
    if (configured) {
      this.logger.warn(
        `Unknown GAMES_CHAT_CONNECTOR="${configured}", fallback to ${ConnectorRoute.LK_WEB_MESSENGER}`
      );
    }
    return ConnectorRoute.LK_WEB_MESSENGER;
  }

  private resolveGameStation(
    game: Game,
    user: RequestUser
  ): { stationId: string; stationName?: string } {
    const details = this.toRecord(game.details);
    const booking = this.toRecord(details?.booking);
    const metadata = this.toRecord(details?.metadata);

    const stationIdFromPayload = this.firstNonEmpty([
      this.readString(details?.stationId),
      this.readString(details?.station_id),
      this.readString(booking?.stationId),
      this.readString(booking?.station_id),
      this.readString(metadata?.stationId),
      this.readString(metadata?.station_id),
      this.readString(details?.tenantKey),
      this.readString(details?.tenant_key),
      this.gameChatDefaultStationId
    ]);
    const stationNameFromPayload = this.firstNonEmpty([
      this.readString(details?.stationName),
      this.readString(details?.station_name),
      this.readString(booking?.studioName),
      this.readString(booking?.studio_name),
      this.readString(metadata?.stationName),
      this.readString(metadata?.station_name),
      game.locationName
    ]);

    const configuredStations = this.messengerService.listStationConfigs(this.buildSystemUser());

    if (stationIdFromPayload) {
      const exactById = configuredStations.find(
        (station) => station.stationId === stationIdFromPayload
      );
      if (exactById) {
        return {
          stationId: exactById.stationId,
          stationName: exactById.stationName
        };
      }
      return {
        stationId: stationIdFromPayload,
        stationName: stationNameFromPayload ?? stationIdFromPayload
      };
    }

    if (stationNameFromPayload) {
      const normalizedSource = this.normalizeToken(stationNameFromPayload);
      if (normalizedSource) {
        const byName = configuredStations.find((station) => {
          const stationIdToken = this.normalizeToken(station.stationId);
          const stationNameToken = this.normalizeToken(station.stationName);
          return stationIdToken === normalizedSource || stationNameToken === normalizedSource;
        });
        if (byName) {
          return {
            stationId: byName.stationId,
            stationName: byName.stationName
          };
        }
      }
    }

    if (this.gameChatDefaultStationId) {
      return {
        stationId: this.gameChatDefaultStationId,
        stationName: stationNameFromPayload ?? this.gameChatDefaultStationId
      };
    }

    if (configuredStations.length === 1) {
      return {
        stationId: configuredStations[0].stationId,
        stationName: configuredStations[0].stationName
      };
    }

    if (user.stationIds.length > 0) {
      const normalizedSource = this.normalizeToken(stationNameFromPayload ?? '');
      if (normalizedSource) {
        const matched = user.stationIds.find(
          (stationId) => this.normalizeToken(stationId) === normalizedSource
        );
        if (matched) {
          return {
            stationId: matched,
            stationName: stationNameFromPayload ?? matched
          };
        }
      }
      return {
        stationId: user.stationIds[0],
        stationName: stationNameFromPayload ?? user.stationIds[0]
      };
    }

    throw new BadRequestException(
      'Cannot resolve station for game chat. Set GAMES_CHAT_DEFAULT_STATION_ID or include stationId in game payload.'
    );
  }

  private findOrCreateGameThread(
    game: Game,
    stationId: string,
    stationName: string | undefined,
    user: RequestUser
  ): ChatThread {
    const clientId = this.buildGameClientId(game.id);
    const candidates = this.messengerService
      .listThreads(user, {
        connector: this.gameChatConnector,
        stationId
      })
      .filter((thread) => thread.clientId === clientId);

    const openThread = candidates.find((thread) => thread.status === ThreadStatus.OPEN);
    if (openThread) {
      return openThread;
    }
    if (candidates.length > 0) {
      return candidates[0];
    }

    const subject = this.buildGameThreadSubject(game);
    return this.messengerService.createThread(
      {
        connector: this.gameChatConnector,
        stationId,
        stationName,
        clientId,
        subject
      },
      user
    );
  }

  private buildGameClientId(gameId: string): string {
    return `game:${gameId}`;
  }

  private buildGameThreadSubject(game: Game): string {
    const raw = `Игра ${game.id}${game.gameDate ? ` · ${game.gameDate}` : ''}`;
    return raw.length > 120 ? raw.slice(0, 120) : raw;
  }

  private buildSystemUser(): RequestUser {
    return {
      id: 'games-chat-system',
      roles: [Role.SUPER_ADMIN],
      stationIds: []
    };
  }

  private normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '');
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      const trimmed = (value ?? '').trim();
      if (trimmed.length > 0) {
        return trimmed;
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
