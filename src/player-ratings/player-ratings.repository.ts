import {
  Collection,
  CreateIndexesOptions,
  Db,
  Document,
  Filter,
  IndexSpecification,
  MongoClient,
  MongoServerError,
  TransactionOptions
} from 'mongodb';
import {
  ensureMongoIndex,
  isProductionRuntime,
  mongoIndexesAreEquivalent
} from '../common/mongo-index.guard';
import {
  PlayerRatingEventDocument,
  PadlHubPlayerLevelProjectionOutboxDocument,
  PadlHubPlayerLevelProjectionPayload,
  PlayerRatingProjectionOutboxDocument,
  PlayerRatingSource,
  PlayerRatingStateDocument
} from './player-ratings.types';
import { PlayerRatingActor } from './player-ratings.types';
import { PlayerLevelPilotBinding, readPlayerLevelPilot } from './player-level-projection-pilot';

export class PlayerRatingRepository {
  private readonly projectionPilot = readPlayerLevelPilot();
  private readonly padlHubProjectionEnabled = readBoolean(
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED
  );
  private readonly mongoUri = String(
    process.env.PLAYER_RATINGS_MONGODB_URI ?? process.env.MONGODB_URI ?? ''
  ).trim();
  private readonly dbName = String(
    process.env.PLAYER_RATINGS_MONGODB_DB ?? process.env.GAMES_MONGODB_DB ?? 'games'
  ).trim() || 'games';
  private client?: MongoClient;
  private db?: Db;
  private connectPromise?: Promise<void>;

  async connect(): Promise<void> {
    if (this.db) return;
    if (this.connectPromise) return this.connectPromise;
    if (!this.mongoUri) throw new Error('PLAYER_RATINGS_MONGODB_URI or MONGODB_URI is required');
    const pending = this.connectOnce();
    this.connectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.connectPromise === pending) this.connectPromise = undefined;
    }
  }

  private async connectOnce(): Promise<void> {
    const client = new MongoClient(this.mongoUri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
    try {
      await client.connect();
      const db = client.db(this.dbName);
      await this.ensureIndexes(db);
      this.client = client;
      this.db = db;
    } catch (error) {
      this.client = undefined;
      this.db = undefined;
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.connectPromise?.catch(() => undefined);
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
    this.db = undefined;
  }

  async stateByKey(playerKey: string): Promise<PlayerRatingStateDocument | null> {
    return this.states().findOne({ playerKey }, { projection: { _id: 0 } });
  }

  async statesByVivaClientId(clientId: string): Promise<PlayerRatingStateDocument[]> {
    return this.states().find({
      $or: [
        { clientId },
        { 'identityAliases.clientIds': clientId },
        { 'identityAliases.playerKeys': `client:${clientId}` }
      ]
    }, { projection: { _id: 0 }, maxTimeMS: 5000 }).limit(2).toArray();
  }

  async statesByIdentity(input: {
    clientId?: string;
    phoneNorm?: string;
  }): Promise<PlayerRatingStateDocument[]> {
    const identity = [
      ...(input.clientId ? [{ clientId: input.clientId }] : []),
      ...(input.phoneNorm ? [{ phoneNorm: input.phoneNorm }] : [])
    ];
    if (identity.length === 0) {
      return [];
    }
    return this.states()
      .find({ $or: identity }, { projection: { _id: 0 } })
      .limit(2)
      .toArray();
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
      .maxTimeMS(5000)
      .sort({ occurredAt: -1, id: 1 })
      .limit(limit)
      .toArray();
  }

  async gameResult(gameId: string, resultId: string, revision: number | string) {
    const scoreRevision = revision === 1 ? { $in: [1, null] } : revision;
    return this.requireDb().collection<{ score?: { teamA: number; teamB: number } }>('lk_game_results')
      .findOne({ gameId, id: resultId, scoreRevision }, { projection: { _id: 0, score: 1 }, maxTimeMS: 5000 });
  }

  async runAtomicChange(input: {
    event: PlayerRatingEventDocument;
    nextState: PlayerRatingStateDocument;
    expectedLastEventId: string;
    compatibility: Document;
    expectedGradeAlignment?: NonNullable<PlayerRatingSource['gradeAlignment']>;
    expectedProjectionRevision?: number;
    outbox?: PlayerRatingProjectionOutboxDocument;
    padlHubOutbox?: PadlHubPlayerLevelProjectionOutboxDocument;
  }): Promise<'ok' | 'conflict'> {
    const client = this.requireClient();
    const session = client.startSession();
    const options: TransactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
    let result: 'ok' | 'conflict' = 'conflict';
    try {
      await session.withTransaction(async () => {
        result = 'conflict';
        const alignment = input.expectedGradeAlignment;
        const preimage: Filter<PlayerRatingStateDocument> = {
          playerKey: input.nextState.playerKey,
          lastEventId: input.expectedLastEventId,
          ownership: 'CUP_CANONICAL',
          clientId: input.nextState.clientId,
          ...(alignment ? {
            ownership: 'CUP_CANONICAL' as const,
            clientId: alignment.clientId,
            ratingNumeric: input.nextState.ratingNumeric,
            rating: alignment.previousGrade
          } : {})
        };
        const current = await this.states().findOne(
          preimage,
          { session, projection: { lastEventId: 1, padlHubProjectionRevision: 1 } }
        );
        if (!current || current.lastEventId !== input.expectedLastEventId
          || (input.expectedProjectionRevision !== undefined
            && (current.padlHubProjectionRevision ?? 0) !== input.expectedProjectionRevision)) return;

        await this.events().insertOne(input.event, { session });
        const stateResult = await this.states().replaceOne(
          preimage,
          input.nextState,
          { session }
        );
        if (stateResult.modifiedCount !== 1) throw new Error('RATING_STATE_CAS_FAILED');
        await this.compatibility().updateOne(
          { playerKey: input.nextState.playerKey },
          { $set: input.compatibility },
          { upsert: true, session }
        );
        if (input.outbox) await this.outbox().insertOne(input.outbox, { session });
        if (input.padlHubOutbox) {
          await this.upsertPadlHubProjection(input.padlHubOutbox, session);
        }
        result = 'ok';
      }, options);
    } finally {
      await session.endSession();
    }
    return result;
  }

  async runAtomicInitialAssignment(input: {
    event: PlayerRatingEventDocument; nextState: PlayerRatingStateDocument;
    compatibility: Document; padlHubOutbox?: PadlHubPlayerLevelProjectionOutboxDocument;
  }): Promise<'ok' | 'conflict'> {
    const session = this.requireClient().startSession(); let result: 'ok' | 'conflict' = 'conflict';
    try {
      await session.withTransaction(async () => {
        result = 'conflict';
        const id = input.nextState.clientId;
        const identity = { $or: [{ clientId: id }, { playerKey: 'client:' + id }, { 'identityAliases.clientIds': id }, { 'identityAliases.playerKeys': 'client:' + id }, ...(input.nextState.phoneNorm ? [{ phoneNorm: input.nextState.phoneNorm }, { 'identityAliases.phoneNorms': input.nextState.phoneNorm }, { playerKey: 'phone:' + input.nextState.phoneNorm }, { 'identityAliases.playerKeys': 'phone:' + input.nextState.phoneNorm }] : [])] };
        const options = { session, maxTimeMS: 5000 };
        if (await this.states().findOne(identity, options) || await this.compatibility().findOne(identity, options)
          || await this.events().findOne({ $or: [{ 'player.clientId': id }, { 'player.key': 'client:' + id }, ...(input.nextState.phoneNorm ? [{ 'player.phoneNorm': input.nextState.phoneNorm }, { 'player.key': 'phone:' + input.nextState.phoneNorm }] : [])] }, options)) return;
        await this.events().insertOne(input.event, options);
        await this.states().insertOne(input.nextState, options);
        await this.compatibility().insertOne(input.compatibility, options);
        if (input.padlHubOutbox) await this.upsertPadlHubProjection(input.padlHubOutbox, session);
        result = 'ok';
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } finally { await session.endSession(); }
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

  async listStatesForPadlHubReconcile(
    afterPlayerKey: string | undefined, limit: number, pilot?: readonly PlayerLevelPilotBinding[]
  ): Promise<PlayerRatingStateDocument[]> {
    return this.states()
      .find(
        {
          clientId: { $type: 'string' },
          ...(pilot ? { $or: [...pilot] } : {}),
          ...(afterPlayerKey ? { playerKey: { $gt: afterPlayerKey } } : {})
        } as Filter<PlayerRatingStateDocument>,
        { projection: { _id: 0 } }
      )
      .sort({ playerKey: 1 })
      .limit(limit)
      .toArray();
  }

  async ensurePadlHubProjectionDesired(
    state: PlayerRatingStateDocument,
    payload: PadlHubPlayerLevelProjectionPayload
  ): Promise<'pilot-binding-conflict' | void> {
    const preimage = { playerKey: state.playerKey, clientId: payload.player.externalClientId, lastEventId: state.lastEventId };
    const existing = await this.padlHubOutbox().findOne(
      { playerKey: state.playerKey },
      { projection: { _id: 0, desiredRevision: 1, 'desired.sourceEventId': 1, 'desired.player.externalClientId': 1, inFlight: 1 } }
    );
    if (existing && this.projectionPilot && (
      existing.desired?.player?.externalClientId !== payload.player.externalClientId
      || (existing.inFlight && existing.inFlight.player?.externalClientId !== payload.player.externalClientId)
      || !Number.isSafeInteger(existing.desiredRevision) || existing.desiredRevision < 0
    )) {
      return 'pilot-binding-conflict';
    }
    if (existing && existing.desiredRevision >= payload.sourceRevision && existing.desired.sourceEventId === payload.sourceEventId) {
      if (existing.desiredRevision > payload.sourceRevision) {
        await this.states().updateOne(preimage, { $max: { padlHubProjectionRevision: existing.desiredRevision } });
      }
      return;
    }
    const effectiveRevision = existing && existing.desired.sourceEventId !== payload.sourceEventId
      ? Math.max(payload.sourceRevision, existing.desiredRevision + 1)
      : payload.sourceRevision;
    const current = await this.states().findOneAndUpdate(
      preimage,
      { $max: { padlHubProjectionRevision: effectiveRevision } },
      { returnDocument: 'after', projection: { padlHubProjectionRevision: 1 } }
    );
    if (!current) return;
    const sourceRevision = current.padlHubProjectionRevision ?? effectiveRevision;
    const effectivePayload: PadlHubPlayerLevelProjectionPayload = {
      ...payload,
      sourceRevision
    };
    const now = new Date().toISOString();
    const document: PadlHubPlayerLevelProjectionOutboxDocument = {
      playerKey: state.playerKey,
      desiredRevision: sourceRevision,
      deliveredRevision: -1,
      desired: effectivePayload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 20,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    };
    await this.upsertPadlHubProjection(document);
  }

  async claimPadlHubProjection(input: {
    leaseOwner: string;
    now: string;
    leaseUntil: string;
    pilot?: readonly PlayerLevelPilotBinding[];
  }): Promise<PadlHubPlayerLevelProjectionOutboxDocument | null> {
    const result = await this.padlHubOutbox().findOneAndUpdate(
      {
        ...(input.pilot ? {
          desiredRevision: { $type: 'number', $gte: 0 },
          $and: [{ $or: input.pilot.map(binding => ({
            playerKey: binding.playerKey, ...pilotOutboxIdentity(binding.clientId)
          })) }]
        } : {}),
        $or: [
          { status: { $in: ['PENDING', 'FAILED_RETRYABLE', 'WAITING_FOR_MAPPING'] }, nextAttemptAt: { $lte: input.now } },
          { status: 'DELIVERING', leaseUntil: { $lte: input.now } }
        ]
      } as Filter<PadlHubPlayerLevelProjectionOutboxDocument>,
      [
        {
          $set: {
            status: 'DELIVERING',
            leaseOwner: input.leaseOwner,
            leaseUntil: input.leaseUntil,
            inFlight: '$desired',
            lastAttemptAt: input.now,
            updatedAt: input.now,
            attempts: { $add: [{ $ifNull: ['$attempts', 0] }, 1] }
          }
        }
      ] as Document[],
      { sort: { nextAttemptAt: 1, playerKey: 1 }, returnDocument: 'after', projection: { _id: 0 } }
    );
    return result;
  }

  async completePadlHubProjection(input: {
    playerKey: string;
    leaseOwner: string;
    revision: number;
    now: string;
  }): Promise<boolean> {
    const result = await this.padlHubOutbox().updateOne(
      {
        playerKey: input.playerKey,
        status: 'DELIVERING',
        leaseOwner: input.leaseOwner,
        'inFlight.sourceRevision': input.revision
      } as Filter<PadlHubPlayerLevelProjectionOutboxDocument>,
      [
        {
          $set: {
            deliveredRevision: input.revision,
            status: {
              $cond: [{ $gt: ['$desiredRevision', input.revision] }, 'PENDING', 'SYNCED']
            },
            nextAttemptAt: input.now,
            lastSuccessAt: input.now,
            updatedAt: input.now,
            leaseOwner: null,
            leaseUntil: null,
            inFlight: null,
            lastErrorCode: null
          }
        }
      ] as Document[]
    );
    return result.modifiedCount === 1;
  }

  async failPadlHubProjection(input: {
    playerKey: string;
    leaseOwner: string;
    revision: number;
    now: string;
    nextAttemptAt: string;
    errorCode: string;
    waitingForMapping?: boolean;
  }): Promise<boolean> {
    const result = await this.padlHubOutbox().updateOne(
      {
        playerKey: input.playerKey,
        status: 'DELIVERING',
        leaseOwner: input.leaseOwner,
        'inFlight.sourceRevision': input.revision
      } as Filter<PadlHubPlayerLevelProjectionOutboxDocument>,
      [
        {
          $set: {
            status: {
              $cond: [
                { $gt: ['$desiredRevision', input.revision] },
                'PENDING',
                input.waitingForMapping
                  ? 'WAITING_FOR_MAPPING'
                  : { $cond: [{ $gte: ['$attempts', '$maxAttempts'] }, 'DEAD', 'FAILED_RETRYABLE'] }
              ]
            },
            attempts: {
              $cond: [
                { $gt: ['$desiredRevision', input.revision] }, 0,
                input.waitingForMapping ? { $max: [0, { $subtract: ['$attempts', 1] }] } : '$attempts'
              ]
            },
            nextAttemptAt: {
              $cond: [
                { $gt: ['$desiredRevision', input.revision] },
                input.now,
                input.nextAttemptAt
              ]
            },
            updatedAt: input.now,
            lastErrorCode: {
              $cond: [
                { $gt: ['$desiredRevision', input.revision] },
                null,
                input.errorCode
              ]
            },
            leaseOwner: null,
            leaseUntil: null,
            inFlight: null
          }
        }
      ] as Document[]
    );
    return result.modifiedCount === 1;
  }

  async retryPadlHubProjection(
    playerKey: string,
    actor: PlayerRatingActor,
    pilotState?: Pick<PlayerRatingStateDocument, 'clientId' | 'lastEventId'>
  ): Promise<PadlHubPlayerLevelProjectionOutboxDocument | null> {
    const now = new Date().toISOString();
    return this.padlHubOutbox().findOneAndUpdate(
      {
        playerKey,
        status: { $in: ['DEAD', 'FAILED_RETRYABLE', 'WAITING_FOR_MAPPING'] },
        ...(pilotState ? {
          ...pilotOutboxIdentity(pilotState.clientId ?? ''),
          'desired.sourceEventId': pilotState.lastEventId
        } : {})
      } as Filter<PadlHubPlayerLevelProjectionOutboxDocument>,
      {
        $set: {
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
          updatedAt: now,
          lastErrorCode: null,
          leaseOwner: null,
          leaseUntil: null,
          inFlight: null,
          lastManualRetryAt: now,
          lastManualRetryBy: actor
        },
        $inc: { manualRetryCount: 1 }
      },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
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
  private padlHubOutbox(): Collection<PadlHubPlayerLevelProjectionOutboxDocument> {
    return this.requireDb().collection<PadlHubPlayerLevelProjectionOutboxDocument>('player_level_projection_outbox');
  }
  private async upsertPadlHubProjection(
    document: PadlHubPlayerLevelProjectionOutboxDocument,
    session?: import('mongodb').ClientSession
  ): Promise<void> {
    const incomingIsNewer = {
      $gt: [document.desiredRevision, { $ifNull: ['$desiredRevision', -1] }]
    };
    const update = {
      playerKey: document.playerKey,
      desiredRevision: {
        $cond: [incomingIsNewer, document.desiredRevision, '$desiredRevision']
      },
      desired: { $cond: [incomingIsNewer, document.desired, '$desired'] },
      deliveredRevision: { $ifNull: ['$deliveredRevision', document.deliveredRevision] },
      status: {
        $cond: [
          incomingIsNewer,
          { $cond: [{ $eq: ['$status', 'DELIVERING'] }, 'DELIVERING', 'PENDING'] },
          '$status'
        ]
      },
      attempts: {
        $cond: [
          incomingIsNewer,
          0,
          { $ifNull: ['$attempts', 0] }
        ]
      },
      maxAttempts: { $ifNull: ['$maxAttempts', document.maxAttempts] },
      nextAttemptAt: {
        $cond: [
          incomingIsNewer,
          {
            $cond: [
              { $eq: ['$status', 'DELIVERING'] },
              '$nextAttemptAt',
              document.nextAttemptAt
            ]
          },
          '$nextAttemptAt'
        ]
      },
      createdAt: { $ifNull: ['$createdAt', document.createdAt] },
      updatedAt: { $cond: [incomingIsNewer, document.updatedAt, '$updatedAt'] }
    };
    // An existing row for the old identity belongs to a separate reconciliation.
    const pipeline = this.projectionPilot ? [{
      $replaceWith: {
        $cond: [
          { $or: [
            { $and: [
              { $eq: [{ $type: '$desiredRevision' }, 'missing'] },
              { $eq: [{ $type: '$desired' }, 'missing'] },
              { $eq: [{ $type: '$status' }, 'missing'] }
            ] },
            { $and: [
              { $isNumber: '$desiredRevision' },
              { $gte: ['$desiredRevision', 0] },
              { $eq: ['$desired.player.externalClientId', document.desired.player.externalClientId] },
              { $or: [
                { $eq: [{ $ifNull: ['$inFlight', null] }, null] },
                { $eq: ['$inFlight.player.externalClientId', document.desired.player.externalClientId] }
              ] }
            ] }
          ] },
          { $mergeObjects: ['$$ROOT', update] },
          '$$ROOT'
        ]
      }
    }] : [{ $set: update }];
    await this.padlHubOutbox().updateOne(
      { playerKey: document.playerKey },
      pipeline,
      { upsert: true, ...(session ? { session } : {}) }
    );
  }
  private requireDb(): Db {
    if (!this.db) throw new Error('Player ratings MongoDB is not connected');
    return this.db;
  }
  private requireClient(): MongoClient {
    if (!this.client) throw new Error('Player ratings MongoDB is not connected');
    return this.client;
  }
  private async ensureIndexes(db?: Db): Promise<void> {
    const states = db?.collection<PlayerRatingStateDocument>('player_rating_state') ?? this.states();
    const events = db?.collection<PlayerRatingEventDocument>('rating_events') ?? this.events();
    const outbox = db?.collection<PlayerRatingProjectionOutboxDocument>('rating_projection_outbox')
      ?? this.outbox();
    const padlHubOutbox = db
      ?.collection<PadlHubPlayerLevelProjectionOutboxDocument>('player_level_projection_outbox')
      ?? this.padlHubOutbox();
    const indexes = [
      this.ensureIndex(
        states,
        { playerKey: 1 },
        { unique: true, name: 'player_rating_state_key_uq' }
      ),
      this.ensureIndex(
        states,
        { clientId: 1 },
        {
          unique: true,
          partialFilterExpression: { clientId: { $type: 'string' } },
          name: 'player_rating_state_client_uq'
        }
      ),
      this.ensureIndex(
        states,
        { phoneNorm: 1 },
        {
          unique: true,
          partialFilterExpression: { phoneNorm: { $type: 'string' } },
          name: 'player_rating_state_phone_uq'
        }
      ),
      this.ensureIndex(
        states,
        { nameSearch: 1, lastEventAt: -1 },
        { name: 'nameSearch_1_lastEventAt_-1' }
      ),
      this.ensureIndex(
        events,
        { idempotencyKey: 1 },
        { unique: true, name: 'rating_event_idempotency_uq' }
      ),
      this.ensureIndex(
        events,
        { 'player.key': 1, occurredAt: -1 },
        { name: 'rating_event_player_time' }
      ),
      this.ensureIndex(
        outbox,
        { status: 1, nextAttemptAt: 1 },
        { name: 'rating_projection_pending' }
      )
    ];
    if (this.padlHubProjectionEnabled) {
      indexes.push(
        this.ensureIndex(
          padlHubOutbox,
          { playerKey: 1 },
          { unique: true, name: 'player_level_projection_player_uq' }
        ),
        this.ensureIndex(
          padlHubOutbox,
          { status: 1, nextAttemptAt: 1, playerKey: 1 },
          { name: 'player_level_projection_pending' }
        )
      );
    }
    await Promise.all(indexes);
  }

  private async ensureIndex<T extends Document>(
    collection: Collection<T>,
    key: IndexSpecification,
    options: CreateIndexesOptions
  ): Promise<string> {
    if (!isProductionRuntime()) {
      try {
        const existing = await collection.listIndexes().toArray();
        const equivalent = existing.find((index) => mongoIndexesAreEquivalent(index, key, options));
        if (equivalent?.name) return equivalent.name;
      } catch (error) {
        if (!isNamespaceNotFound(error)) throw error;
      }
    }
    return ensureMongoIndex(collection, key, options);
  }
}

function pilotOutboxIdentity(clientId: string): Filter<PadlHubPlayerLevelProjectionOutboxDocument> {
  return {
    'desired.player.externalClientId': clientId,
    $or: [{ inFlight: null }, { 'inFlight.player.externalClientId': clientId }]
  };
}

function readBoolean(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function isNamespaceNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && Number((error as { code?: unknown }).code) === 26;
}
