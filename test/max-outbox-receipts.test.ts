// These suites exercise the explicitly enabled fenced protocol.
process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { MongoClient, MongoOperationTimeoutError } from 'mongodb';
import { supportDiagnostics } from '../src/support/support-diagnostics';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportController } from '../src/support/support.controller';
import { SupportService } from '../src/support/support.service';
import { MaxOutboxStore } from '../src/support/max-outbox-store';
import { maxFailure, maxRetryDelay } from '../src/support/max-outbox-policy';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main() {
  // Explicit loopback-only disposable test DB. Never reuse app credentials or load .env.
  const uri = process.argv[2];
  assert.ok(uri, 'Pass the isolated local Mongo URI');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'mongodb:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.username + parsed.password + parsed.search, '');
  assert.ok(parsed.port);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  let observeWire = false;
  const wire: { command: string; maxTimeMS?: number; wtimeout?: number }[] = [];
  client.on('commandStarted', event => {
    if (observeWire && ['find', 'update', 'findAndModify'].includes(event.commandName)) {
      wire.push({ command: event.commandName, maxTimeMS: event.command.maxTimeMS, wtimeout: event.command.writeConcern?.wtimeout });
    }
  });
  await client.connect();
  const db = client.db('max_retry_test_' + randomUUID().replaceAll('-', ''));
  const collection = db.collection<Command>('outbox');
  await collection.createIndex({ id: 1 }, { unique: true });
  const store = new MaxOutboxStore(collection, 3);
  const now = Date.parse('2026-01-01T00:00:00Z');
  const seed = (id: string, extra: Partial<Command> = {}): Command => ({ id,
    connector: Route.MAX_BOT, dialogId: 'synthetic-dialog', clientId: 'synthetic-client',
    text: 'synthetic text', targetExternalChatId: 'synthetic-chat', createdAt: new Date(now).toISOString(),
    status: Status.PENDING, attempts: 0, ...extra });
  const reset = async (...commands: Command[]) => { await collection.deleteMany({}); await collection.insertMany(commands); };
  const read = async (id = 'a') => (await collection.findOne({ id }))!;
  const conflict = async (fn: () => Promise<unknown>) => {
    const before = await collection.find({}).toArray();
    await assert.rejects(fn, (e: any) => e.getStatus() === 409);
    assert.deepEqual(await collection.find({}).toArray(), before);
  };
  try {
    const previousToken = process.env.SUPPORT_INTEGRATION_TOKEN;
    const controller = new SupportController({ pullOutbox: () => assert.fail('Unauthenticated claim'), ackOutbox: () => assert.fail('Unauthenticated ACK'), failOutbox: () => assert.fail('Unauthenticated fail') } as any);
    try {
      delete process.env.SUPPORT_INTEGRATION_TOKEN;
      await assert.rejects(() => controller.pullOutbox(undefined, Route.MAX_BOT, 1, 60, 'max-lease-v1'), (e: any) => e.getStatus() === 503);
      const receipt = { leaseToken: randomUUID() };
      assert.throws(() => controller.ackOutbox(undefined, 'a', receipt), (e: any) => e.getStatus() === 503);
      assert.throws(() => controller.failOutbox(undefined, 'a', receipt), (e: any) => e.getStatus() === 503);
      process.env.SUPPORT_INTEGRATION_TOKEN = 'synthetic-integration-token';
      assert.throws(() => controller.ackOutbox('wrong', 'a', receipt), (e: any) => e.getStatus() === 403);
      assert.throws(() => controller.failOutbox('wrong', 'a', receipt), (e: any) => e.getStatus() === 403);
      await assert.rejects(() => controller.pullOutbox('wrong', Route.MAX_BOT, 1, 60, 'max-lease-v1'), (e: any) => e.getStatus() === 403);
    } finally {
      if (previousToken === undefined) delete process.env.SUPPORT_INTEGRATION_TOKEN;
      else process.env.SUPPORT_INTEGRATION_TOKEN = previousToken;
    }
    const service = new SupportService({} as any, {} as any, {} as any);
    assert.throws(() => service.pullOutbox(Route.MAX_BOT), (e: any) => e.getStatus() === 409);
    assert.throws(() => service.pullOutbox(Route.MAX_ACADEMY_BOT), (e: any) => e.getStatus() === 409);
    const persistence = Object.create(SupportPersistenceService.prototype) as any;
    persistence.backendConfigs = [{ key: 'primary' }, { key: 'max' }];
    persistence.backendStates = new Map([['primary', { db: { collection: () => assert.fail('No fallback') } }], ['max', {}]]);
    assert.throws(() => persistence.pullMaxOutbox(Route.MAX_BOT, 1, 60), (e: any) => e.getStatus() === 503);
    let legacyWrites = 0;
    const legacy = new SupportService({ hasMaxOutbox: () => assert.fail('Known non-MAX must not query MAX DB'),
      persistOutboxCommand: () => legacyWrites++ } as any, {} as any, {} as any);
    (legacy as any).outbox.set('legacy', seed('legacy', { connector: Route.TG_BOT }));
    assert.equal((await legacy.ackOutbox('legacy')).status, Status.SENT);
    assert.equal(legacyWrites, 1);
    await reset(seed('a'));
    observeWire = true;
    const [left, right] = await Promise.all([store.pull(Route.MAX_BOT, 1, 60, now), store.pull(Route.MAX_BOT, 1, 60, now)]);
    observeWire = false;
    assert.equal(left.length + right.length, 1, 'Concurrent claims must not duplicate a command');
    const first = [...left, ...right][0];
    assert.ok(first.leaseToken);
    assert.equal(first.attempts, 1);
    await conflict(() => store.receipt('a', 'ack', {}, now + 1));
    await conflict(() => store.receipt('a', 'ack', { leaseToken: 'invalid' }, now + 1));
    await conflict(() => store.receipt('a', 'ack', { leaseToken: randomUUID() }, now + 1));
    observeWire = true;
    const ack = await store.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 1);
    observeWire = false;
    assert(wire.length >= 4);
    assert(wire.every(item => (item.maxTimeMS ?? item.wtimeout ?? 0) > 0 && (item.maxTimeMS ?? item.wtimeout ?? Infinity) <= 5000), JSON.stringify(wire));
    assert.equal(ack.status, Status.SENT);
    assert.deepEqual(await store.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 2), ack);
    await conflict(() => store.receipt('a', 'fail', { leaseToken: first.leaseToken, failure: { status: 429 } }, now + 2));
    assert.equal((await new MaxOutboxStore(collection).pull(Route.MAX_BOT, 5, 60, now + 90_000)).length, 0);
    assert.equal((await read()).status, Status.SENT, 'Recreated store/restart must not resurrect SENT');

    // Exercise the actual persistence enqueue against Mongo: a stale process snapshot cannot
    // replace terminal state or emit a diagnostic ACK for a matched insert-only no-op.
    const queued: Promise<void>[] = [], diagnostics: Record<string, unknown>[] = [];
    const savedSink = (supportDiagnostics as any).sink;
    (supportDiagnostics as any).sink = (event: Record<string, unknown>) => diagnostics.push(event);
    try {
      const persistence = Object.create(SupportPersistenceService.prototype) as SupportPersistenceService;
      Object.assign(persistence, {
        maxBackend: () => ({ config: { key: 'synthetic-max' }, db }),
        collection: () => collection,
        fireAndForget: (task: () => Promise<void>) => queued.push(task()),
        deleteFromOtherBackends: () => assert.fail('MAX must never clean another backend')
      });
      const before = await read();
      persistence.persistOutboxCommand(seed('a'));
      await Promise.all(queued.splice(0));
      assert.deepEqual(await read(), before, 'Stale enqueue cannot resurrect SENT');
      assert.equal(diagnostics.filter(event => event.code === 'DB_ACK').length, 0);
      persistence.persistOutboxCommand(seed('new-enqueue'));
      await Promise.all(queued.splice(0));
      assert.equal((await read('new-enqueue')).status, Status.PENDING);
      assert.equal(diagnostics.filter(event => event.code === 'DB_ACK').length, 1);
    } finally { (supportDiagnostics as any).sink = savedSink; }

    await reset(seed('a'));
    let command = (await store.pull(Route.MAX_BOT, 1, 60, now))[0];
    const failBody = { leaseToken: command.leaseToken, failure: { status: 429, code: 'private arbitrary text', response: 'secret' }, retryAfterSeconds: 1e20 };
    const retry = await store.receipt('a', 'fail', failBody, now + 1);
    assert.equal(retry.status, Status.PENDING);
    assert.equal(retry.lastProviderFailure?.code, 'unclassified');
    assert.equal(retry.lastError, 'RATE_LIMITED');
    assert.ok(Date.parse(retry.nextAttemptAt!) >= now + 300_000);
    assert.ok(Date.parse(retry.nextAttemptAt!) <= now + 301_001);
    assert.deepEqual(await store.receipt('a', 'fail', failBody, now + 100), retry, 'Duplicate fail must not shift due time');
    assert.equal((await store.pull(Route.MAX_BOT, 1, 60, now + 1000)).length, 0);
    const second = (await store.pull(Route.MAX_BOT, 1, 60, now + 302_000))[0];
    assert.notEqual(second.leaseToken, command.leaseToken);
    await conflict(() => store.receipt('a', 'ack', { leaseToken: command.leaseToken }, now + 302_001));
    await conflict(() => store.receipt('a', 'fail', failBody, now + 302_001));
    const retry2 = await store.receipt('a', 'fail', { leaseToken: second.leaseToken, failure: { status: 429 } }, now + 302_001);
    command = (await store.pull(Route.MAX_BOT, 1, 60, Date.parse(retry2.nextAttemptAt!) + 1))[0];
    assert.equal(command.attempts, 3);
    const terminal = await store.receipt('a', 'fail', { leaseToken: command.leaseToken, failure: { status: 429 } }, Date.parse(retry2.nextAttemptAt!) + 2);
    assert.equal(terminal.status, Status.FAILED);
    assert.equal(terminal.terminalReason, 'ATTEMPTS_EXHAUSTED');
    assert.equal(terminal.lastProviderFailure?.status, 429);
    assert.equal(terminal.lastError, 'RATE_LIMITED', 'Exhaustion must preserve provider reason');
    await conflict(() => store.receipt('a', 'ack', { leaseToken: command.leaseToken }, Date.parse(retry2.nextAttemptAt!) + 3));

    for (const status of [400, 401, 403, 404, 500, 503, null]) {
      await reset(seed('a'));
      const leased = (await store.pull(Route.MAX_BOT, 1, 60, now))[0];
      const result = await store.receipt('a', 'fail', { leaseToken: leased.leaseToken,
        failure: { status, code: 'phone/token/raw body', message: 'private description' } }, now + 1);
      assert.equal(result.status, Status.FAILED);
      assert.equal(result.lastProviderFailure?.status, status);
      assert.equal(result.lastProviderFailure?.code, 'unclassified');
      assert.ok(!JSON.stringify(result).includes('private description'));
      assert.ok(!JSON.stringify(result).includes('phone/token'));
      assert.equal((await store.pull(Route.MAX_BOT, 1, 60, now + 99_000)).length, 0);
    }

    for (const [status, code] of [[403, 'dialog.suspended'], [404, 'chat.not.found']] as const) {
      await reset(seed('a'));
      const leased = (await store.pull(Route.MAX_BOT, 1, 60, now))[0];
      const failed = await store.receipt('a', 'fail', { leaseToken: leased.leaseToken,
        failure: { status, code, message: 'private provider description' } }, now + 1);
      assert.equal(failed.status, Status.FAILED);
      assert.equal(failed.terminalReason, 'PROVIDER_REFUSED');
      assert.equal(failed.lastProviderFailure?.code, code);
      assert.ok(!JSON.stringify(failed).includes('private provider description'));
      assert.equal((await store.pull(Route.MAX_BOT, 1, 60, now + 99_000)).length, 0);
    }

    await reset(seed('a'));
    const expired = (await store.pull(Route.MAX_BOT, 1, 5, now))[0];
    await conflict(() => store.receipt('a', 'ack', { leaseToken: expired.leaseToken }, now + 5000));
    assert.equal((await store.pull(Route.MAX_BOT, 1, 60, now + 5001)).length, 0);
    assert.equal((await read()).terminalReason, 'DELIVERY_UNKNOWN', 'Expired/lost receipt must not replay a possibly delivered message');
    await conflict(() => store.receipt('a', 'ack', { leaseToken: expired.leaseToken }, now + 5002));

    await reset(seed('old', { status: Status.FAILED, attempts: 100 }), seed('new'));
    assert.equal((await store.pull(Route.MAX_BOT, 10, 60, now))[0].id, 'new');
    assert.equal((await read('old')).status, Status.FAILED);
    await reset(seed('old-lease', { status: Status.LEASED, attempts: 100, leasedUntil: new Date(now - 1).toISOString() }));
    assert.equal((await store.pull(Route.MAX_BOT, 1, 60, now)).length, 0);
    assert.equal((await read('old-lease')).terminalReason, 'DELIVERY_UNKNOWN');

    let majorityReads = 0;
    let committed = false;
    const pendingCommit = new MaxOutboxStore({
      findOne: async (_filter: unknown, options: any) => {
        // Only local/uncommitted state contains ACK. Majority view still contains lease.
        if (options?.readConcern?.level === 'majority' && options?.readPreference === 'primary' && !committed) {
          majorityReads++;
          return seed('a', { status: Status.LEASED, attempts: 1, leaseToken: first.leaseToken });
        }
        return seed('a', { status: Status.SENT, lastReceipt: { token: first.leaseToken!, kind: 'ack' } });
      },
      findOneAndUpdate: async () => { throw new Error('synthetic majority unavailable'); }
    } as any);
    await assert.rejects(() => pendingCommit.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 1), /majority unavailable/);
    assert.equal(majorityReads, 1);
    committed = true;
    assert.equal((await pendingCommit.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 2)).status, Status.SENT);
    let reads = 0;
    const raced = new MaxOutboxStore({
      findOne: async (_filter: unknown, options: any) => {
        reads++;
        if (reads === 1 || options?.readConcern?.level === 'majority') {
          return seed('a', { status: Status.LEASED, attempts: 1, leaseToken: first.leaseToken });
        }
        return seed('a', { status: Status.SENT, lastReceipt: { token: first.leaseToken!, kind: 'ack' } });
      }, findOneAndUpdate: async () => null
    } as any);
    await assert.rejects(() => raced.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 1), (e: any) => e.getStatus() === 409);
    assert.equal(reads, 2);

    const failing = new MaxOutboxStore({ findOne: async () => seed('a', { status: Status.LEASED, attempts: 1, leaseToken: first.leaseToken }),
      findOneAndUpdate: async () => { throw new Error('synthetic storage unavailable'); } } as any);
    await assert.rejects(() => failing.receipt('a', 'ack', { leaseToken: first.leaseToken }, now + 1), /storage unavailable/);
    assert.equal(maxFailure({ status: 403, message: 'secret', code: 'unclassified' }, now).category, 'PROVIDER_REFUSED');
    assert.equal(maxFailure({ status: 503 }, now).category, 'DELIVERY_UNKNOWN');
    assert.equal(maxFailure({ code: 'invalid_input' }, now).category, 'INVALID_INPUT');
    assert.equal(maxFailure({ status: 400, code: 'invalid_input' }, now).category, 'INVALID_INPUT');
    assert.equal(maxFailure({ status: 429, code: 'invalid_input' }, now).category, 'RATE_LIMITED');
    assert.equal(maxRetryDelay(1, Number.NaN, () => 0), 5000);
    assert.equal(maxRetryDelay(5, -5, () => 0), 80_000);
    // Owned local Mongo only: a blocked server command must really hit driver CSOT,
    // not merely carry a timeout-looking option through a mock. Timeout is not rollback.
    for (const blocked of ['find', 'findAndModify']) {
      await reset(seed('slow', { status: Status.LEASED, attempts: 1, leaseToken: first.leaseToken,
        leasedUntil: new Date(now + 60_000).toISOString() }));
      let clockCalls = 0;
      const slowStore = new MaxOutboxStore(collection, 3, () => {
        clockCalls++;
        return clockCalls <= (blocked === 'find' ? 1 : 2) ? 0 : 4950;
      });
      await client.db('admin').command({ configureFailPoint: 'failCommand', mode: { times: 1 },
        data: { failCommands: [blocked], blockConnection: true, blockTimeMS: 500 } });
      const started = Date.now();
      try {
        await assert.rejects(() => slowStore.receipt('slow', 'ack', { leaseToken: first.leaseToken }, now + 1), MongoOperationTimeoutError);
        assert(Date.now() - started < 2000, 'Driver timeout must bound a blocked server operation');
      } finally {
        await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      }
    }
    console.log('MAX outbox: real local Mongo concurrency, fencing, durability, retry, legacy and privacy checks PASS');
  } finally { await db.dropDatabase(); await client.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
