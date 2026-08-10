import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';

export interface StoredTournamentStanding {
  id?: string;
  name: string;
  rank: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  totalPoints: number;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDelta: number;
}

export interface StoredTournamentResults {
  tournamentId: string;
  standings: StoredTournamentStanding[];
}

interface StoredTournamentDocument {
  tournamentId?: unknown;
  standings?: unknown;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function readNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (normalized === '') {
    return undefined;
  }
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeStoredTournamentStandings(value: unknown): StoredTournamentStanding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((rawStanding, index) => {
    const standing = toRecord(rawStanding);
    const name = readString(standing.name);
    if (!name) {
      return [];
    }
    const ratingBefore = readNumber(standing.ratingBefore);
    const ratingAfter = readNumber(standing.ratingAfter);
    const storedRatingDelta = readNumber(standing.ratingDelta)
      ?? readNumber(standing.deltaTotal);
    const ratingDelta = storedRatingDelta
      ?? (ratingBefore !== undefined && ratingAfter !== undefined
        ? ratingAfter - ratingBefore
        : 0);
    return [{
      id: readString(standing.id),
      name,
      rank: readNumber(standing.rank) ?? index + 1,
      matchesPlayed: readNumber(standing.matchesPlayed) ?? 0,
      wins: readNumber(standing.wins) ?? 0,
      losses: readNumber(standing.losses) ?? 0,
      draws: readNumber(standing.draws) ?? 0,
      pointsFor: readNumber(standing.pointsFor) ?? 0,
      pointsAgainst: readNumber(standing.pointsAgainst) ?? 0,
      pointDiff: readNumber(standing.pointDiff) ?? 0,
      totalPoints: readNumber(standing.totalPoints)
        ?? readNumber(standing.tournamentPoints)
        ?? readNumber(standing.playedPoints)
        ?? readNumber(standing.pointsFor)
        ?? 0,
      ratingBefore,
      ratingAfter,
      ratingDelta
    }];
  });
}

@Injectable()
export class TournamentResultsStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(TournamentResultsStoreService.name);
  private mongoClientPromise?: Promise<MongoClient>;

  async findByTournamentIds(
    tournamentIds: string[]
  ): Promise<Map<string, StoredTournamentResults> | null> {
    const uri = this.readMongoUri();
    if (!uri) {
      return null;
    }
    const normalizedIds = Array.from(new Set(
      tournamentIds.map((value) => readString(value)).filter((value): value is string => Boolean(value))
    ));
    if (normalizedIds.length === 0) {
      return new Map();
    }

    try {
      const collection = await this.getCollection(uri);
      const documents = await collection.find(
        { tournamentId: { $in: normalizedIds } },
        { projection: { _id: 0, tournamentId: 1, standings: 1 } }
      ).toArray();
      const results = new Map<string, StoredTournamentResults>();
      documents.forEach((document) => {
        const tournamentId = readString(document.tournamentId);
        if (!tournamentId) {
          return;
        }
        results.set(tournamentId, {
          tournamentId,
          standings: normalizeStoredTournamentStandings(document.standings)
        });
      });
      return results;
    } catch (error) {
      this.logger.error(`Failed to read stored tournament standings: ${String(error)}`);
      throw new ServiceUnavailableException('Stored tournament results are unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.mongoClientPromise) {
      return;
    }
    const client = await this.mongoClientPromise.catch(() => null);
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private async getCollection(uri: string): Promise<Collection<StoredTournamentDocument>> {
    if (!this.mongoClientPromise) {
      this.mongoClientPromise = MongoClient.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    }
    const client = await this.mongoClientPromise;
    const database = readString(process.env.GAMES_MONGODB_DB) ?? 'games';
    const collection =
      readString(process.env.TOURNAMENT_RESULTS_MONGODB_COLLECTION) ?? 'tournaments';
    return client.db(database).collection<StoredTournamentDocument>(collection);
  }

  private readMongoUri(): string | undefined {
    return readString(process.env.GAMES_MONGODB_URI)
      ?? readString(process.env.MONGODB_URI);
  }
}
