import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  const environment = { ...process.env };
  const original = { connect: MongoClient.prototype.connect, db: MongoClient.prototype.db, close: MongoClient.prototype.close };
  let connections = 0;
  let indexes = 0;
  let closes = 0;
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://maintenance.invalid:27017';
  process.env.ADMIN_AUTH_MONGODB_DB = 'maintenance_fixture';
  Object.assign(MongoClient.prototype, {
    connect: async function () { connections += 1; await new Promise((resolve) => setTimeout(resolve, 15)); return this; },
    db: () => ({ collection: () => ({ createIndex: async () => { indexes += 1; return 'synthetic_index'; } }) }),
    close: async () => { closes += 1; }
  });
  const persistence = new AuthPersistenceService();
  try {
    await Promise.all([persistence.onModuleInit(), persistence.onModuleInit()]);
    await persistence.onModuleInit();
    assert.equal(connections, 1, 'explicit readiness and Nest lifecycle share one initialization');
    assert.equal(indexes, 6, 'non-production index setup is not repeated');
    assert.equal(persistence.isEnabled(), true);
    await persistence.onModuleDestroy();
    assert.equal(closes, 1, 'one initialized client is closed');
    console.log('Auth persistence concurrent/sequential readiness passed (Mongo transport double, no database connection)');
  } finally {
    await persistence.onModuleDestroy();
    Object.assign(MongoClient.prototype, original);
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
