import {
  Collection,
  Db,
  Document,
  Filter,
  MongoClient,
  MongoServerError,
  TransactionOptions
} from 'mongodb';
import {
  PlayerRatingEventDocument,
  PlayerRatingProjectionOutboxDocument,
  PlayerRatingStateDocument
} from './player-ratings.types';
import { PlayerRatingActor } from './player-ratings.types';

export class PlayerRatingRepository {
  private readonly mongoUri = String(
    process.env.PLAYER_RATINGS_MONGODB_URI ?? process.env.MONGODB_URI ?? ''
  ).trim();
  private readonly dbName = String(
    process.env.PLAYER_RATINGS_MONGODB_DB ?? process.env.GAMES_MONGODB_DB ?? 'games'
  ).trim() || 'games';
  private client?: MongoClient;
  private db?: Db;

  async connect(): Promise<void> {
    if (this.db) return;
    if (!this.mongoUri) throw new Error('PLAYER_RATINGS_MONGODB_URI or MONGODB_URI is required');
    const client = new MongoClient(this.mongoUri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
    await client.connect();
    this.client = client;
    this.db = client.db(this.dbName);
    await this.ensureIndexes();
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
    this.db = undefined;
  }

  async stateByKey(playerKey: string): Promise<PlayerRatingStateDocument | null> {
    return this.states().findOne({ playerKey }, { projection: { _id: 0 } });
  }

  async eventById(id: string): Promise<PlayerRatingEventDocument | null> {
    return this.events().findOne({ id }, { projection: { _id: 0 } });
  }

  async eventByIdempotencyKey(key: string): Promise<PlayerRatingEventDocument | null> {
    return this.events().findOne({ idempotencyKey: key }, { projection: { _id: 0 } });
  }

  async latestOutbox(playerKey: string): Promise<PlayerRatingProjectionOutboxDocument | null> {
    return this.outbox().findOne({ playerKey }, { projection: { _id: 0 }, sort: { createdAt: -1 } });
  }

  async searchStates(filter: Filter<PlayerRatingStateDocument>, limit: number): Promise<PlayerRatingStateDocument[]> {
    return this.states()
      .find(filter, { projection: { _id: 0 } })
      .sort({ lastEventAt: -1, playerKey: 1 })
      .limit(limit)
      .toArray();
  }

  async listEvents(filter: Filter<PlayerRatingEventDocument>, limit: number): Promise<PlayerRatingEventDocument[]> {
    return this.events()
      .find(filter, { projection: { _id: 0 } })
      .sort({ occurredAt: -1, id: 1 })
      .limit(limit)
      .toArray();
  }

  async runAtomicChange(input: {
    event: PlayerRatingEventDocument;
    nextState: PlayerRatingStateDocument;
    expectedLastEventId: string;
    compatibility: Document;
    outbox: PlayerRatingProjectionOutboxDocument;
  }): Promise<'ok' | 'conflict'> {
    const client = this.requireClient();
    const session = client.startSession();
    const options: TransactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
    let result: 'ok' | 'conflict' = 'conflict';
    try {
      await session.withTransaction(async () => {
        const current = await this.states().findOne(
          { playerKey: input.nextState.playerKey },
          { session, projection: { lastEventId: 1 } }
        );
        if (!current || current.lastEventId !== input.expectedLastEventId) return;

        await this.events().insertOne(input.event, { session });
        const stateResult = await this.states().replaceOne(
          { playerKey: input.nextState.playerKey, lastEventId: input.expectedLastEventId },
          input.nextState,
          { session }
        );
        if (stateResult.modifiedCount !== 1) throw new Error('RATING_STATE_CAS_FAILED');
        await this.compatibility().updateOne(
          { playerKey: input.nextState.playerKey },
          { $set: input.compatibility },
          { upsert: true, session }
        );
        await this.outbox().insertOne(input.outbox, { session });
        result = 'ok';
      }, options);
    } finally {
      await session.endSession();
    }
    return result;
  }

  async retryLatestFailedProjection(playerKey: string, actor: PlayerRatingActor): Promise<PlayerRatingProjectionOutboxDocument | null> {
    const now = new Date().toISOString();
    const result = await this.outbox().findOneAndUpdate(
      ({ playerKey, status: { $in: ['FAILED_RETRYABLE', 'FAILED'] } } as unknown) as Filter<PlayerRatingProjectionOutboxDocument>,
      {
        $set: { status: 'PENDING', nextAttemptAt: now, updatedAt: now, lastManualRetryAt: now, lastManualRetryBy: actor },
        $inc: { manualRetryCount: 1 }
      },
      { sort: { createdAt: -1 }, returnDocument: 'after', projection: { _id: 0 } }
    );
    return result;
  }

  isDuplicateKey(error: unknown): boolean {
    return error instanceof MongoServerError && error.code === 11000;
  }

  private states(): Collection<PlayerRatingStateDocument> {
    return this.requireDb().collection<PlayerRatingStateDocument>('player_rating_state');
  }
  private events(): Collection<PlayerRatingEventDocument> {
    return this.requireDb().collection<PlayerRatingEventDocument>('rating_events');
  }
  private compatibility(): Collection<Document> {
    return this.requireDb().collection<Document>('player_ratings');
  }
  private outbox(): Collection<PlayerRatingProjectionOutboxDocument> {
    return this.requireDb().collection<PlayerRatingProjectionOutboxDocument>('rating_projection_outbox');
  }
  private requireDb(): Db {
    if (!this.db) throw new Error('Player ratings MongoDB is not connected');
    return this.db;
  }
  private requireClient(): MongoClient {
    if (!this.client) throw new Error('Player ratings MongoDB is not connected');
    return this.client;
  }
  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.states().createIndex({ playerKey: 1 }, { unique: true }),
      this.states().createIndex({ clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }),
      this.states().createIndex({ phoneNorm: 1 }, { unique: true, partialFilterExpression: { phoneNorm: { $type: 'string' } } }),
      this.states().createIndex({ nameSearch: 1, lastEventAt: -1 }),
      this.events().createIndex({ idempotencyKey: 1 }, { unique: true }),
      this.events().createIndex({ 'player.key': 1, occurredAt: -1 }),
      this.outbox().createIndex({ status: 1, nextAttemptAt: 1 })
    ]);
  }
}
