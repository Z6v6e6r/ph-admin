process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { MongoClient, MongoOperationTimeoutError } from 'mongodb';
import { MaxOutboxStore, provisionMaxQueue } from './fixtures/max-outbox-fixture';
import { maxRecoveryFingerprint, maxQueueControlName, MAX_QUEUE_CONTROL_ID } from '../src/support/max-outbox-store';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';
async function main() {
  const uri = process.argv[2], address = new URL(uri);
  assert.equal(address.protocol, 'mongodb:'); assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.username + address.password, '');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }); await client.connect();
  const db = client.db('max_queue_test_' + randomUUID().replaceAll('-', ''));
  const coll = db.collection<Command>('outbox'); await coll.createIndex({ id: 1 }, { unique: true }); await provisionMaxQueue(db);
  const store = new MaxOutboxStore(coll), other = new MaxOutboxStore(coll);
  const now = Date.now();
  const seed = (id: string, extra: Partial<Command> = {}): Command => ({ id, connector: Route.MAX_BOT, dialogId: 'synthetic-dialog', clientId: 'synthetic-client',
    text: 'synthetic text', createdAt: new Date(now).toISOString(), status: Status.PENDING, attempts: 0, targetExternalChatId: 'synthetic-chat', ...extra });
  const clear = () => coll.deleteMany({});
  const row = async (id: string) => (await coll.findOne({ id }))!;
  const enqueue = async (...rows: Command[]) => { for (const item of rows) await store.enqueue(item); };
  try {
    for (const mode of ['429', 'leased', 'expired', 'unknown', 'legacy-failed', 'legacy-pending']) {
      await clear();
      if (mode.startsWith('legacy')) await coll.insertOne(seed('a', { status: mode === 'legacy-failed' ? Status.FAILED : Status.PENDING, attempts: 100 }));
      else await enqueue(seed('a'));
      await enqueue(seed('b', { dialogId: 'another-station-dialog' }), seed('other', { targetExternalChatId: 'other-chat' }));
      let leased: Command | undefined;
      if (!mode.startsWith('legacy')) leased = (await store.pull(Route.MAX_BOT, 1, mode === 'expired' ? 5 : 60, now))[0];
      if (mode === '429') await store.receipt('a', 'fail', { leaseToken: leased!.leaseToken, failure: { status: 429 }, retryAfterSeconds: 60 }, now + 1);
      if (mode === 'unknown') await store.receipt('a', 'fail', { leaseToken: leased!.leaseToken, failure: { status: 503 } }, now + 1);
      const next = await other.pull(Route.MAX_BOT, 10, 60, now + (mode === 'expired' ? 5001 : 2));
      assert.deepEqual(next.map(x => x.id), ['other'], mode + ' must block B for the same addressed recipient');
      assert.equal((await row('b')).attempts, 0);
      if (mode === 'expired' || mode === 'unknown') {
        const held = await row('a'); assert.equal(held.terminalReason, 'DELIVERY_UNKNOWN'); assert.equal(held.leaseToken, leased!.leaseToken);
        const fingerprint = maxRecoveryFingerprint(held), evidence = 'a'.repeat(64);
        const control = db.collection(maxQueueControlName('outbox'));
        await control.updateOne({ _id: MAX_QUEUE_CONTROL_ID as any }, { $set: { enabled: false } });
        const controlHash = () => control.findOne({ _id: MAX_QUEUE_CONTROL_ID as any }).then(maxRecoveryFingerprint);
        const expectedControl = await controlHash();
        await control.updateOne({ _id: MAX_QUEUE_CONTROL_ID as any }, { $set: { enabled: true } });
        await assert.rejects(() => store.reconcile('a', fingerprint, 'confirmed_sent', evidence, expectedControl), (e: any) => e.getStatus() === 409);
        assert.deepEqual(await row('a'), held, 'Concurrent enable cannot permit operator reconciliation');
        await control.updateOne({ _id: MAX_QUEUE_CONTROL_ID as any }, { $set: { enabled: false } });
        const pausedHash = await controlHash();
        await assert.rejects(() => store.reconcile('a', 'b'.repeat(64), 'confirmed_sent', evidence, pausedHash), (e: any) => e.getStatus() === 409);
        const fixed = await store.reconcile('a', fingerprint, 'confirmed_sent', evidence, await controlHash());
        assert.equal(fixed.status, Status.SENT); assert.equal(fixed.attempts, held.attempts);
        assert.deepEqual(await store.reconcile('a', fingerprint, 'confirmed_sent', evidence, await controlHash()), fixed, 'Same recovery evidence is idempotent');
        await control.updateOne({ _id: MAX_QUEUE_CONTROL_ID as any }, { $set: { enabled: true } });
        assert.deepEqual((await other.pull(Route.MAX_BOT, 10, 60, now + 6000)).map(x => x.id), ['b']);
      }
    }
    await clear(); await enqueue(seed('a'), seed('b'));
    const children = await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ['test/fixtures/max-queue-child.cjs', uri, db.databaseName])));
    assert.equal(children.flatMap(x => JSON.parse(x.stdout)).length, 1, 'Independent API processes cannot claim successive messages of one recipient concurrently');
    await clear(); await enqueue(seed('a'), seed('b'));
    const claims = await Promise.all([store.pull(Route.MAX_BOT, 1, 60, now), other.pull(Route.MAX_BOT, 1, 60, now)]);
    assert.equal(claims.flat().length, 1); assert.equal(claims.flat()[0].id, 'a');
    await store.receipt('a', 'fail', { leaseToken: claims.flat()[0].leaseToken, failure: { status: 403, code: 'dialog.suspended' } }, now + 1);
    assert.equal((await other.pull(Route.MAX_BOT, 1, 60, now + 2))[0].id, 'b', 'A proven refusal releases B');
    await clear();
    await enqueue(seed('first', { createdAt: '2026-12-31T00:00:00.000Z' }), seed('backdated', { createdAt: '2020-01-01T00:00:00.000Z' }));
    assert.equal((await other.pull(Route.MAX_BOT, 10, 60, now))[0].id, 'first', 'Admission sequence, not user time or UUID, defines order');
    await clear();
    await enqueue(seed('chat'), seed('user', { targetExternalChatId: undefined, targetExternalUserId: 'synthetic-chat' }), seed('academy', { connector: Route.MAX_ACADEMY_BOT }));
    assert.equal((await store.pull(Route.MAX_BOT, 10, 60, now)).length, 2, 'Typed recipient IDs are distinct');
    assert.equal((await store.pull(Route.MAX_ACADEMY_BOT, 10, 60, now)).length, 1, 'Bot scopes are distinct');
    await clear(); await enqueue(seed('a'), seed('b', { targetExternalChatId: 'other-chat' }));
    const nativeClaim = coll.findOneAndUpdate.bind(coll); let calls = 0;
    coll.findOneAndUpdate = (async (...args: any[]) => { calls++; if (calls === 2) throw new MongoOperationTimeoutError('synthetic failure after first real transactional claim'); return (nativeClaim as any)(...args); }) as any;
    try { await assert.rejects(() => store.pull(Route.MAX_BOT, 10, 60, now), MongoOperationTimeoutError); }
    finally { coll.findOneAndUpdate = nativeClaim as any; }
    assert.equal(await coll.countDocuments({ status: Status.LEASED }), 0, 'Real Mongo abort rolls back every tentative claim in batch');
    assert.equal(await coll.countDocuments({ status: Status.PENDING, attempts: 0 }), 2);
    // Commit really succeeds, then its response is lost. No commands escape the failed pull.
    const nativeSession = client.startSession.bind(client);
    (client as any).startSession = () => { const session = nativeSession(), commit = session.commitTransaction.bind(session);
      session.commitTransaction = async options => { await commit(options); throw Object.assign(new Error('synthetic commit response loss'), { hasErrorLabel: (label: string) => label === 'UnknownTransactionCommitResult' }); }; return session; };
    try { await assert.rejects(() => store.pull(Route.MAX_BOT, 10, 5, now), /commit response loss/); }
    finally { (client as any).startSession = nativeSession; }
    assert.equal(await coll.countDocuments({ status: Status.LEASED }), 2);
    assert.deepEqual(await new MaxOutboxStore(coll).pull(Route.MAX_BOT, 10, 60, now + 5001), []);
    assert.equal(await coll.countDocuments({ terminalReason: 'DELIVERY_UNKNOWN' }), 2, 'Recreated API store quarantines lost batch, never provider replay');
    await clear(); const original = seed('stable-id'); await store.enqueue(original);
    await other.enqueue(structuredClone(original)); assert.equal(await coll.countDocuments({}), 1);
    await assert.rejects(() => other.enqueue({ ...original, text: 'different synthetic text' }), (e: any) => e.getStatus() === 409);
    console.log('Physical replica-set queue: FIFO429, multi-store claims, typed recipients, backdated enqueue, partial rollback, lost commit, restart quarantine and evidence-only reconciliation PASS');
  } finally { await db.dropDatabase(); await client.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
