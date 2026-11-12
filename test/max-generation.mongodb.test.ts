import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, Document } from 'mongodb';
import { LegacyMaxCustodyStore } from '../src/support/legacy-max-custody';
import { admitMaxGeneration, admitMaxIngress, consumeMaxIngress, assertMaxGenerationControl,
  MAX_GENERATION_CONTROL_ID } from '../src/support/max-generation';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status, SupportOutboxCommand } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2];
  if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri)) throw Error('OWNED_LOOPBACK_MONGO_REQUIRED');
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  globalThis.fetch = (() => assert.fail('No provider transport')) as any;
  const dbName = 'codex_max_generation_fixture_' + randomUUID().replace(/-/g, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, retryWrites: false });
  const after = new Date(Date.now() - 60000).toISOString(), at = new Date(Date.now() - 1000).toISOString();
  const generation = randomUUID(), config = { generation, after };
  const origin = { kind: 'STAFF_REPLY' as const, id: 'fixture-origin', at };
  const row = (id: string): SupportOutboxCommand => ({ id, connector: Route.MAX_BOT, dialogId: 'fixture', clientId: 'fixture',
    text: 'SYNTHETIC PRIVATE BODY', createdAt: at, status: Status.PENDING, attempts: 0 });
  try {
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy'; process.env.SUPPORT_MAX_GENERATION_TOKEN = 'synthetic-integration-token'; process.env.SUPPORT_MAX_GENERATION = generation;
    process.env.SUPPORT_MAX_GENERATION_AFTER = after;
    await client.connect(); const db = client.db(dbName);
    const commands = db.collection<SupportOutboxCommand>('outbox'), control = db.collection<Document>('control');
    const store = new LegacyMaxCustodyStore(commands, control);
    await control.insertOne({ _id: MAX_GENERATION_CONTROL_ID, schema: 1, ...config, state: 'OPEN' } as Document);
    const old = row('old'); await commands.insertOne(old);
    const lease = (r: SupportOutboxCommand): SupportOutboxCommand => ({ ...r, status: Status.LEASED, attempts: 1,
      leasedUntil: new Date(Date.now() + 60000).toISOString(), meta: { ...r.meta, legacyMaxLeaseId: randomUUID() } });
    await assert.rejects(store.transition(lease(old), 'lease', old));
    assert.equal((await commands.findOne({ id: old.id }))?.status, Status.PENDING);
    const fresh = admitMaxGeneration(row('fresh'), origin); await store.transition(fresh, 'enqueue');
    const race = await Promise.allSettled([store.transition(lease(fresh), 'lease', fresh), store.transition(lease(fresh), 'lease', fresh)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    const actual = await commands.findOne({ id: fresh.id }); assert.equal(actual?.attempts, 1);
    const ticket = await admitMaxIngress(control, Route.MAX_BOT, origin);
    const consumers = await Promise.allSettled([consumeMaxIngress(control, Route.MAX_BOT, origin, ticket),
      consumeMaxIngress(control, Route.MAX_BOT, origin, ticket)]);
    assert.equal(consumers.filter(r => r.status === 'fulfilled').length, 1);
    await assert.rejects(admitMaxIngress(control, Route.MAX_BOT, origin));
    const lost: any = { findOne: control.findOne.bind(control), async insertOne(...args: any[]) {
      await (control.insertOne as any)(...args); throw Error('synthetic lost ACK');
    } };
    await assert.rejects(admitMaxIngress(lost, Route.MAX_BOT, { ...origin, id: 'lost-admission-ACK' }));
    await assert.rejects(admitMaxIngress(control, Route.MAX_BOT, { ...origin, id: 'lost-admission-ACK' }));
    delete process.env.SUPPORT_MAX_GENERATION; delete process.env.SUPPORT_MAX_GENERATION_AFTER;
    await assert.rejects(assertMaxGenerationControl(control));
    process.env.SUPPORT_MAX_GENERATION = generation; process.env.SUPPORT_MAX_GENERATION_AFTER = after;
    await control.updateOne({ _id: MAX_GENERATION_CONTROL_ID } as Document, { $set: { state: 'CLOSED' } });
    await assert.rejects(store.transition(admitMaxGeneration(row('closed-arrival'), origin), 'enqueue'));
    assert.equal(await commands.countDocuments({ id: 'closed-arrival' }), 0);
    console.log('Owned loopback Mongo: old hold, concurrent CAS, duplicate/unknown ingress, durable closed fence PASS');
  } finally {
    if (!/^codex_max_generation_fixture_[a-f0-9]{32}$/.test(dbName)) throw Error('OWNED_FIXTURE_REQUIRED');
    await client.db(dbName).dropDatabase().catch(() => {}); await client.close(); globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
main().catch(() => { console.error('MAX_GENERATION_MONGO_TEST_FAILED'); process.exitCode = 1; });
