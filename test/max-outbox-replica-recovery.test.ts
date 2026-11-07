process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MaxOutboxStore, provisionMaxQueue } from './fixtures/max-outbox-fixture';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  assert.equal(process.env.MAX_OWNED_REPLICA_FIXTURE, 'codexMaxQueueRS');
  const uri = process.argv[2], target = new URL(uri); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.username + target.password, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }); await client.connect();
  const db = client.db('max_queue_test_' + randomUUID().replaceAll('-', '')), coll = db.collection<Command>('outbox');
  await coll.createIndex({ id: 1 }, { unique: true }); await provisionMaxQueue(db);
  const events: any[] = [], store = new MaxOutboxStore(coll, undefined, undefined, (e: any) => events.push(e));
  const seed = (id: string): Command => ({ id, connector: Route.MAX_BOT, dialogId: 'synthetic', clientId: 'synthetic', text: 'synthetic',
    targetExternalChatId: 'synthetic-chat', createdAt: new Date().toISOString(), status: Status.PENDING, attempts: 0 });
  const directs: MongoClient[] = []; let killed: string | undefined;
  const topology = await db.admin().command({ hello: 1 });
  assert.equal(topology.setName, 'codexMaxQueueRS'); assert.equal(topology.hosts.length, 3);
  assert.deepEqual([...topology.hosts].sort(), ['127.0.0.1:27317', '127.0.0.1:27318', '127.0.0.1:27319']);
  const direct = async (host: string) => { const c = new MongoClient('mongodb://' + host + '/?directConnection=true', { serverSelectionTimeoutMS: 1500, timeoutMS: 2000 }); await c.connect(); directs.push(c); return c; };
  const primary = async () => {
    for (let i = 0; i < 75; i++) { try { const h = await db.admin().command({ hello: 1 }, { timeoutMS: 1000 }); if (h.isWritablePrimary) return String(h.me); } catch {} await pause(200); }
    throw new Error('Synthetic replica primary did not recover');
  };
  const dockerNames = new Map([['127.0.0.1:27317', 'phab-max-recovery-1'], ['127.0.0.1:27318', 'phab-max-recovery-2'], ['127.0.0.1:27319', 'phab-max-recovery-3']]);
  const fixtureRoot = process.env.MAX_MONGO_FIXTURE_ROOT;
  const processFor = async (host: string, connection: MongoClient) => {
    assert(fixtureRoot && path.resolve(fixtureRoot) === '/private/tmp/max-queue-mongo-20261026');
    const processes = JSON.parse(await readFile(path.join(fixtureRoot, 'owned-processes.json'), 'utf8'));
    const entry = processes.find((p: any) => '127.0.0.1:' + p.port === host); assert(entry);
    const status = await connection.db('admin').command({ serverStatus: 1 });
    const options = await connection.db('admin').command({ getCmdLineOpts: 1 });
    assert.equal(status.pid, entry.pid); assert.equal(options.parsed.net.bindIp, '127.0.0.1');
    assert.equal(options.parsed.storage.dbPath, path.join(fixtureRoot, 'replica-' + processes.indexOf(entry)));
    return { entry, dbPath: options.parsed.storage.dbPath };
  };
  const stop = async (host: string, connection: MongoClient) => {
    if (fixtureRoot) { const { entry } = await processFor(host, connection); process.kill(entry.pid, 'SIGKILL'); }
    else {
      assert.equal(process.env.CI, 'true'); const name = dockerNames.get(host)!; assert(name);
      const inspect = JSON.parse((await promisify(execFile)('docker', ['inspect', name])).stdout)[0];
      assert.equal(inspect.Config.Labels['codex.max-fixture'], process.env.GITHUB_RUN_ID);
      await promisify(execFile)('docker', ['kill', '--signal=KILL', name]);
    }
    killed = host;
  };
  const restart = async (host: string) => {
    if (fixtureRoot) {
      const processes = JSON.parse(await readFile(path.join(fixtureRoot, 'owned-processes.json'), 'utf8'));
      const index = processes.findIndex((p: any) => '127.0.0.1:' + p.port === host); assert(index >= 0);
      const root = path.join(fixtureRoot, 'replica-' + index);
      await promisify(execFile)(path.join(fixtureRoot, 'mongod'), ['--dbpath', root, '--port', String(processes[index].port), '--bind_ip', '127.0.0.1',
        '--replSet', 'codexMaxQueueRS', '--setParameter', 'enableTestCommands=1', '--wiredTigerCacheSizeGB', '0.25',
        '--logpath', path.join(root, 'mongod.log'), '--logappend', '--pidfilepath', path.join(root, 'mongod.pid'), '--fork']);
      processes[index].pid = Number(await readFile(path.join(root, 'mongod.pid'), 'utf8'));
      await require('node:fs/promises').writeFile(path.join(fixtureRoot, 'owned-processes.json'), JSON.stringify(processes));
    } else await promisify(execFile)('docker', ['start', dockerNames.get(host)!]);
    killed = undefined;
  };
  try {
    await store.enqueue(seed('majority-sent')); const leased = (await store.pull(Route.MAX_BOT, 1, 60))[0];
    await store.receipt(leased.id, 'ack', { leaseToken: leased.leaseToken });
    const oldPrimary = await primary(), leader = await direct(oldPrimary);
    await leader.db('admin').command({ replSetStepDown: 60, force: true }).catch(() => {});
    assert.notEqual(await primary(), oldPrimary);
    assert.equal((await coll.findOne({ id: leased.id }, { readConcern: { level: 'majority' } }))?.status, Status.SENT);
    assert.deepEqual(await store.pull(Route.MAX_BOT, 10, 60), [], 'Failover cannot resurrect a majority-acknowledged send');
    const victim = await primary(), current = await direct(victim), paused: MongoClient[] = [];
    for (const host of topology.hosts.filter((h: string) => h !== victim)) {
      const connection = await direct(host);
      await connection.db('admin').command({ configureFailPoint: 'stopReplProducer', mode: 'alwaysOn' }); paused.push(connection);
    }
    for (const c of paused) await c.db('admin').command({ waitForFailPoint: 'stopReplProducer', timesEntered: 1, maxTimeMS: 5000 }, { timeoutMS: 6000 });
    const unknown = seed('unknown-enqueue'), started = Date.now();
    await assert.rejects(() => store.enqueue(unknown));
    assert(Date.now() - started < 6500, 'Majority unavailable cannot hold the HTTP/receipt caller indefinitely');
    assert(events.some(e => e.operation === 'enqueue' && e.stage.startsWith('commit')), 'Unknown admission is observable without payloads');
    await stop(victim, current);
    for (const c of paused) await c.db('admin').command({ configureFailPoint: 'stopReplProducer', mode: 'off' });
    assert.notEqual(await primary(), victim);
    assert.equal(await coll.countDocuments({ id: unknown.id }, { readConcern: { level: 'majority' } }), 0, 'Unacknowledged old-primary state must not be treated as durable');
    await restart(victim);
    for (let i = 0; i < 100; i++) {
      try { const status = await current.db('admin').command({ hello: 1 }); if (status.secondary) break; } catch {}
      await pause(100);
    }
    await store.enqueue(unknown); await new MaxOutboxStore(coll).enqueue(unknown);
    assert.equal(await coll.countDocuments({ id: unknown.id }), 1, 'Same intent is not duplicated across rollback/restart');
    assert.equal((await store.pull(Route.MAX_BOT, 10, 60))[0].id, unknown.id);
    assert.equal((await coll.findOne({ id: leased.id }))?.status, Status.SENT);
    console.log('Physical three-member recovery: primary stepdown, majority ACK custody, replication pause, bounded unknown commit, SIGKILL, rollback and restart/deduplicated admission PASS; provider calls0');
  } finally {
    if (killed) await restart(killed).catch(() => {});
    for (const c of directs) { await c.db('admin').command({ configureFailPoint: 'stopReplProducer', mode: 'off' }).catch(() => {}); await c.close(); }
    await db.dropDatabase(); await client.close();
  }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
