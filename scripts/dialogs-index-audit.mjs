#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const DEFAULT_DB = 'dialog';
const STRICT_MODE = process.argv.includes('--strict');

function readEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  return value || undefined;
}

function keySignature(key) {
  return Object.entries(key)
    .map(([field, direction]) => `${field}:${String(direction)}`)
    .join('|');
}

function indexSignature(indexSpec) {
  const unique = indexSpec.unique === true ? 1 : 0;
  return `${keySignature(indexSpec.key)}|u:${unique}`;
}

function expectedIndexesForSupport() {
  return {
    clients: [
      { key: { id: 1 }, unique: true },
      { key: { phones: 1 } },
      { key: { emails: 1 } },
      { key: { 'identities.connector': 1, 'identities.externalUserId': 1 } },
      { key: { 'identities.connector': 1, 'identities.externalChatId': 1 } }
    ],
    dialogs: [
      { key: { id: 1 }, unique: true },
      { key: { stationId: 1, updatedAt: -1 } },
      { key: { accessStationIds: 1, updatedAt: -1 } },
      { key: { clientId: 1, status: 1 } }
    ],
    messages: [
      { key: { id: 1 }, unique: true },
      { key: { dialogId: 1, createdAt: 1 } },
      { key: { clientId: 1, createdAt: 1 } }
    ],
    responseMetrics: [
      { key: { id: 1 }, unique: true },
      { key: { dialogId: 1, startedAt: -1 } }
    ],
    outbox: [
      { key: { id: 1 }, unique: true },
      { key: { connector: 1, status: 1, createdAt: 1 } }
    ]
  };
}

function expectedIndexesForMessenger() {
  return {
    threads: [
      { key: { id: 1 }, unique: true },
      { key: { connector: 1, stationId: 1, updatedAt: -1 } }
    ],
    messages: [
      { key: { id: 1 }, unique: true },
      { key: { threadId: 1, createdAt: 1 } }
    ],
    stations: [{ key: { stationId: 1 }, unique: true }],
    connectors: [{ key: { id: 1 }, unique: true }],
    accessRules: [{ key: { id: 1 }, unique: true }],
    metrics: [{ key: { threadId: 1 }, unique: true }],
    aiConfigs: [{ key: { threadId: 1 }, unique: true }],
    aiInsights: [{ key: { threadId: 1 }, unique: true }],
    aiSuggestions: [
      { key: { id: 1 }, unique: true },
      { key: { threadId: 1, createdAt: -1 } }
    ]
  };
}

async function auditCollection(db, collectionName, expected) {
  const actual = await db.collection(collectionName).indexes();
  const actualWithoutId = actual.filter((index) => index.name !== '_id_');

  const expectedSignatures = new Set(expected.map((spec) => indexSignature(spec)));
  const actualSignatures = new Set(
    actualWithoutId.map((index) =>
      indexSignature({
        key: index.key,
        unique: index.unique === true
      })
    )
  );

  const missing = expected.filter(
    (spec) => !actualSignatures.has(indexSignature(spec))
  );
  const extra = actualWithoutId.filter((index) => {
    const sig = indexSignature({
      key: index.key,
      unique: index.unique === true
    });
    return !expectedSignatures.has(sig);
  });

  return {
    collectionName,
    expectedCount: expected.length,
    actualCount: actualWithoutId.length,
    missing,
    extra
  };
}

async function auditSupport() {
  const uri = readEnv('SUPPORT_MONGODB_URI') ?? readEnv('MONGODB_URI');
  if (!uri) {
    return {
      target: 'support',
      skipped: true,
      reason: 'SUPPORT_MONGODB_URI/MONGODB_URI is not configured'
    };
  }

  const dbName =
    readEnv('SUPPORT_MONGODB_DB') ?? readEnv('MONGODB_DB') ?? DEFAULT_DB;
  const collectionNames = {
    clients: readEnv('SUPPORT_CLIENTS_COLLECTION') ?? 'support_clients',
    dialogs: readEnv('SUPPORT_DIALOGS_COLLECTION') ?? 'support_dialogs',
    messages: readEnv('SUPPORT_MESSAGES_COLLECTION') ?? 'support_messages',
    responseMetrics:
      readEnv('SUPPORT_RESPONSE_METRICS_COLLECTION') ?? 'support_response_metrics',
    outbox: readEnv('SUPPORT_OUTBOX_COLLECTION') ?? 'support_outbox'
  };
  const expected = expectedIndexesForSupport();

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = {};
    for (const [alias, collectionName] of Object.entries(collectionNames)) {
      collections[alias] = await auditCollection(db, collectionName, expected[alias]);
    }
    return {
      target: 'support',
      skipped: false,
      dbName,
      collections
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function auditMessenger() {
  const uri = readEnv('MONGODB_URI');
  if (!uri) {
    return {
      target: 'messenger',
      skipped: true,
      reason: 'MONGODB_URI is not configured'
    };
  }

  const dbName = readEnv('MONGODB_DB') ?? DEFAULT_DB;
  const collectionNames = {
    threads: 'messenger_threads',
    messages: 'messenger_messages',
    stations: 'messenger_station_configs',
    connectors: 'messenger_connector_configs',
    accessRules: 'messenger_access_rules',
    metrics: 'messenger_response_metrics',
    aiConfigs: 'messenger_ai_configs',
    aiInsights: 'messenger_ai_insights',
    aiSuggestions: 'messenger_ai_suggestions'
  };
  const expected = expectedIndexesForMessenger();

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = {};
    for (const [alias, collectionName] of Object.entries(collectionNames)) {
      collections[alias] = await auditCollection(db, collectionName, expected[alias]);
    }
    return {
      target: 'messenger',
      skipped: false,
      dbName,
      collections
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function flattenFindings(result) {
  if (result.skipped) {
    return [];
  }

  const findings = [];
  for (const [alias, collection] of Object.entries(result.collections)) {
    if (collection.missing.length > 0 || collection.extra.length > 0) {
      findings.push({
        target: result.target,
        collectionAlias: alias,
        collectionName: collection.collectionName,
        missing: collection.missing,
        extra: collection.extra
      });
    }
  }
  return findings;
}

async function main() {
  const results = [];
  const errors = [];

  for (const fn of [auditSupport, auditMessenger]) {
    try {
      results.push(await fn());
    } catch (error) {
      errors.push(String(error));
    }
  }

  console.log(JSON.stringify({ strict: STRICT_MODE, results, errors }, null, 2));

  const findings = results.flatMap(flattenFindings);
  const hasProblems = errors.length > 0 || findings.length > 0;

  if (STRICT_MODE && hasProblems) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
