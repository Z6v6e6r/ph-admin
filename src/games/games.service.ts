import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy
} from '@nestjs/common';
import { Filter, MongoClient, ObjectId } from 'mongodb';
import { LkPadelHubClientService } from '../integrations/lk-padelhub/lk-padelhub-client.service';
import { Game, GameParticipantDetails, GameStatus } from './games.types';

type GamesSourceMode = 'lk' | 'mongo';

interface MongoGameParticipant {
  name?: unknown;
  phone?: unknown;
}

interface MongoGameDoc {
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
  private mongoClient?: MongoClient;

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

    const doc = (await collection.findOne(
      { $or: filter },
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
    )) as MongoGameDoc | null;

    if (!doc) {
      return null;
    }
    return this.mapMongoGame(doc);
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

  private mapMongoGame(doc: MongoGameDoc): Game | null {
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
      locationName: locationName || undefined
    };
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
