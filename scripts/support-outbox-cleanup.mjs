#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { MongoClient } from 'mongodb';

const DEFAULT_DB = 'dialog';
const DEFAULT_COLLECTION = 'support_outbox';
const SAMPLE_LIMIT = 50;

function readEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  return value || undefined;
}

function normalizeDbName(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return DEFAULT_DB;
  }

  const normalized = value.toLowerCase();
  if (['ph_admin', 'admin', 'games', 'games_chat'].includes(normalized)) {
    return DEFAULT_DB;
  }

  return value;
}

function usage() {
  console.log(`Usage:
  node scripts/support-outbox-cleanup.mjs [options]

Options:
  --connector MAX_BOT              Connector filter. Default: MAX_BOT
  --status LEASED                  Optional status filter
  --min-attempts 100               Optional minimum attempts filter
  --ids id1,id2                    Comma-separated command ids
  --dialog-ids d1,d2               Comma-separated dialog ids
  --file /path/to/file.json        JSON/text file with ids or { commands: [...] }
  --mark-failed                    Mark matched commands as FAILED
  --delete                         Delete matched commands
  --reason "manual cleanup"        Custom lastError for --mark-failed
  --help                           Show help

Notes:
  - Default mode is dry-run preview.
  - If connector is MAX_BOT/MAX_ACADEMY_BOT and SUPPORT_MAX_MONGODB_DB is configured,
    the script uses the dedicated MAX support backend automatically.
`);
}

function parseArgValue(argv, index) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return argv[index + 1];
}

function parseCsv(rawValue) {
  return Array.from(
    new Set(
      String(rawValue ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function extractIdsFromParsedJson(parsed) {
  if (Array.isArray(parsed)) {
    const ids = [];
    const dialogIds = [];
    for (const item of parsed) {
      if (typeof item === 'string') {
        ids.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        if (typeof item.id === 'string' && item.id.trim()) {
          ids.push(item.id.trim());
        }
        if (typeof item.dialogId === 'string' && item.dialogId.trim()) {
          dialogIds.push(item.dialogId.trim());
        }
      }
    }
    return { ids, dialogIds };
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.commands)) {
      return extractIdsFromParsedJson(parsed.commands);
    }

    if (Array.isArray(parsed.ids) || Array.isArray(parsed.dialogIds)) {
      return {
        ids: Array.isArray(parsed.ids) ? extractIdsFromParsedJson(parsed.ids).ids : [],
        dialogIds: Array.isArray(parsed.dialogIds)
          ? extractIdsFromParsedJson(parsed.dialogIds).ids
          : []
      };
    }
  }

  return { ids: [], dialogIds: [] };
}

function extractIdsFromFile(filePath) {
  const rawText = fs.readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(rawText);
    return extractIdsFromParsedJson(parsed);
  } catch {
    const ids = [];
    const dialogIds = [];
    for (const line of rawText.split(/\r?\n/)) {
      const value = line.trim();
      if (!value) {
        continue;
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        ids.push(value);
      }
    }
    return { ids, dialogIds };
  }
}

function parseArgs(argv) {
  const options = {
    connector: 'MAX_BOT',
    status: undefined,
    minAttempts: undefined,
    ids: [],
    dialogIds: [],
    filePath: undefined,
    markFailed: false,
    deleteMatched: false,
    reason: 'Manual outbox cleanup',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--connector':
        options.connector = String(parseArgValue(argv, index + 0)).trim().toUpperCase();
        index += 1;
        break;
      case '--status':
        options.status = String(parseArgValue(argv, index + 0)).trim().toUpperCase();
        index += 1;
        break;
      case '--min-attempts': {
        const parsed = Number(parseArgValue(argv, index + 0));
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error('--min-attempts must be a non-negative number');
        }
        options.minAttempts = Math.floor(parsed);
        index += 1;
        break;
      }
      case '--ids':
        options.ids = parseCsv(parseArgValue(argv, index + 0));
        index += 1;
        break;
      case '--dialog-ids':
        options.dialogIds = parseCsv(parseArgValue(argv, index + 0));
        index += 1;
        break;
      case '--file':
        options.filePath = parseArgValue(argv, index + 0);
        index += 1;
        break;
      case '--mark-failed':
        options.markFailed = true;
        break;
      case '--delete':
        options.deleteMatched = true;
        break;
      case '--reason':
        options.reason = String(parseArgValue(argv, index + 0)).trim() || options.reason;
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.markFailed && options.deleteMatched) {
    throw new Error('Choose only one action: --mark-failed or --delete');
  }

  if (options.filePath) {
    const fromFile = extractIdsFromFile(options.filePath);
    options.ids = Array.from(new Set([...options.ids, ...fromFile.ids]));
    options.dialogIds = Array.from(new Set([...options.dialogIds, ...fromFile.dialogIds]));
  }

  return options;
}

function resolveBackend(connector) {
  const normalizedConnector = String(connector ?? '').trim().toUpperCase();
  const isMaxConnector =
    normalizedConnector === 'MAX_BOT' || normalizedConnector === 'MAX_ACADEMY_BOT';

  if (isMaxConnector && readEnv('SUPPORT_MAX_MONGODB_DB')) {
    return {
      backendKey: 'max',
      uri:
        readEnv('SUPPORT_MAX_MONGODB_URI') ??
        readEnv('SUPPORT_MONGODB_URI') ??
        readEnv('MONGODB_URI'),
      dbName: normalizeDbName(readEnv('SUPPORT_MAX_MONGODB_DB')),
      collectionName:
        readEnv('SUPPORT_MAX_OUTBOX_COLLECTION') ??
        readEnv('SUPPORT_OUTBOX_COLLECTION') ??
        DEFAULT_COLLECTION
    };
  }

  return {
    backendKey: 'primary',
    uri: readEnv('SUPPORT_MONGODB_URI') ?? readEnv('MONGODB_URI'),
    dbName: normalizeDbName(readEnv('SUPPORT_MONGODB_DB') ?? readEnv('MONGODB_DB')),
    collectionName: readEnv('SUPPORT_OUTBOX_COLLECTION') ?? DEFAULT_COLLECTION
  };
}

function buildFilter(options) {
  const filter = {};

  if (options.connector) {
    filter.connector = options.connector;
  }
  if (options.status) {
    filter.status = options.status;
  }
  if (typeof options.minAttempts === 'number') {
    filter.attempts = { $gte: options.minAttempts };
  }
  if (options.ids.length > 0) {
    filter.id = { $in: options.ids };
  }
  if (options.dialogIds.length > 0) {
    filter.dialogId = { $in: options.dialogIds };
  }

  return filter;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const backend = resolveBackend(options.connector);
  if (!backend.uri) {
    throw new Error(
      'Mongo URI is not configured. Set SUPPORT_MONGODB_URI or MONGODB_URI first.'
    );
  }

  const filter = buildFilter(options);
  const client = new MongoClient(backend.uri, {
    serverSelectionTimeoutMS: 5000
  });

  try {
    await client.connect();
    const collection = client.db(backend.dbName).collection(backend.collectionName);
    const matchedCount = await collection.countDocuments(filter);
    const sample = await collection
      .find(filter)
      .project({
        _id: 0,
        id: 1,
        dialogId: 1,
        connector: 1,
        status: 1,
        attempts: 1,
        targetExternalChatId: 1,
        targetExternalUserId: 1,
        createdAt: 1,
        lastError: 1,
        text: 1
      })
      .sort({ createdAt: 1 })
      .limit(SAMPLE_LIMIT)
      .toArray();

    const summary = {
      dryRun: !options.markFailed && !options.deleteMatched,
      action: options.deleteMatched
        ? 'delete'
        : options.markFailed
          ? 'mark-failed'
          : 'preview',
      backendKey: backend.backendKey,
      dbName: backend.dbName,
      collectionName: backend.collectionName,
      filter,
      matchedCount,
      sample
    };

    if (!options.markFailed && !options.deleteMatched) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (options.deleteMatched) {
      const result = await collection.deleteMany(filter);
      console.log(
        JSON.stringify(
          {
            ...summary,
            deletedCount: result.deletedCount ?? 0
          },
          null,
          2
        )
      );
      return;
    }

    const result = await collection.updateMany(
      filter,
      {
        $set: {
          status: 'FAILED',
          lastError: options.reason
        },
        $unset: {
          leasedUntil: ''
        }
      }
    );
    console.log(
      JSON.stringify(
        {
          ...summary,
          modifiedCount: result.modifiedCount ?? 0
        },
        null,
        2
      )
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
