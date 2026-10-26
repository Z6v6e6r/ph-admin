import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MongoClient } from 'mongodb';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportConnectorRoute as Route } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  assert.ok(uri, 'Pass the disposable loopback Mongo fixture URI explicitly');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'mongodb:'); assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(parsed.port); assert.equal(parsed.username + parsed.password + parsed.search, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db('support_cold_reply_test_' + randomUUID().replaceAll('-', ''));
  const state = { config: { key: 'max' }, db };
  const persistence = Object.create(SupportPersistenceService.prototype) as any;
  persistence.backendConfigs = [{ key: 'max', uri }];
  persistence.getActiveBackends = () => [state];
  persistence.resolveBackendKeyForConnector = () => 'max';
  persistence.collection = (_state: unknown, name: string) => db.collection(name);
  try {
    await db.collection('dialogs').createIndex({ id: 1 }, { unique: true });
    await db.collection('clients').createIndex({ id: 1 }, { unique: true });
    await db.collection('messages').createIndex({ dialogId: 1, createdAt: 1 });
    const dialog = { id: 'synthetic-dialog', clientId: 'synthetic-client', connectors: [Route.MAX_BOT], lastInboundConnector: Route.MAX_BOT };
    const profile = { id: dialog.clientId, authStatus: 'VERIFIED', phones: [], emails: [], identities: [{ connector: Route.MAX_BOT, externalChatId: 'synthetic-chat' }] };
    await db.collection('dialogs').insertOne(dialog);
    await db.collection('clients').insertOne(profile);
    await db.collection('messages').insertMany([
      { id: 'synthetic-first', dialogId: dialog.id, direction: 'INBOUND', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'synthetic-latest', dialogId: dialog.id, direction: 'INBOUND', createdAt: '2026-01-02T00:00:00.000Z' }
    ]);
    const result = await persistence.loadReplyContext(dialog.id);
    assert.equal(result.client.id, profile.id);
    assert.equal(result.latestInbound.id, 'synthetic-latest');
    assert.equal(result.firstInboundId, 'synthetic-first');
    assert.equal(result.dialog._id, undefined);
    assert.equal(await persistence.loadReplyContext('missing'), null);
    assert.equal(await db.collection('messages').countDocuments({}), 2, 'Lookup must not write');
    await db.collection('clients').deleteOne({ id: profile.id });
    await assert.rejects(() => persistence.loadReplyContext(dialog.id), (e: any) => e.getStatus() === 503);
    await db.collection('clients').insertOne(profile);
    // This admin failpoint is only for the explicitly supplied disposable CI fixture.
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 10000 } });
    const started = performance.now();
    await assert.rejects(() => persistence.loadReplyContext(dialog.id), (e: any) => e.getStatus() === 503);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 4000 && elapsed < 6500, `Whole lookup budget not enforced: ${elapsed}`);
    console.log('Support cold reply physical Mongo: exact lookup, missing client, no writes, CSOT timeout PASS');
  } finally {
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' }).catch(() => {});
    await db.dropDatabase();
    await client.close();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
