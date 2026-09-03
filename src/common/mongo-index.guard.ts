import {
  Collection,
  CreateIndexesOptions,
  Document,
  IndexSpecification
} from 'mongodb';

export function isProductionRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return String(environment.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

export function isMongoIndexReadinessError(error: unknown): boolean {
  return error instanceof Error
    && (error.message.startsWith('MONGO_INDEX_NOT_READY:')
      || error.message.startsWith('MONGO_INDEX_READINESS_CHECK_FAILED:'));
}

/**
 * Production is verify-only: application runtime may read index metadata but never
 * issue createIndex. Index creation belongs to separately guarded operator scripts.
 */
export async function ensureMongoIndex<TSchema extends Document>(
  collection: Collection<TSchema>,
  key: IndexSpecification,
  options: CreateIndexesOptions = {},
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> {
  if (!isProductionRuntime(environment)) {
    return collection.createIndex(key, options);
  }

  const label = options.name ?? 'unnamed';
  let indexes: Document[];
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    const cause = error instanceof Error ? error.name : 'UnknownError';
    throw new Error(
      `MONGO_INDEX_READINESS_CHECK_FAILED:${collection.collectionName}:${label}:${cause}`
    );
  }

  const existing = indexes.find((index) => mongoIndexesAreEquivalent(index, key, options));
  if (!existing?.name) {
    throw new Error(`MONGO_INDEX_NOT_READY:${collection.collectionName}:${label}`);
  }
  return existing.name;
}

export function mongoIndexesAreEquivalent(
  existing: Document,
  key: IndexSpecification,
  options: CreateIndexesOptions
): boolean {
  return JSON.stringify(existing.key ?? null) === JSON.stringify(key)
    && Boolean(existing.unique) === Boolean(options.unique)
    && Boolean(existing.sparse) === Boolean(options.sparse)
    && Boolean(existing.hidden) === Boolean(options.hidden)
    && (existing.expireAfterSeconds ?? null) === (options.expireAfterSeconds ?? null)
    && JSON.stringify(existing.partialFilterExpression ?? null)
      === JSON.stringify(options.partialFilterExpression ?? null)
    && JSON.stringify(existing.collation ?? null) === JSON.stringify(options.collation ?? null);
}
