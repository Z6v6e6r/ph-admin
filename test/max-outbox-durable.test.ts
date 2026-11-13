process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS = '0';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MaxOutboxStore, MAX_RECEIPT_PROTOCOL } from '../src/support/max-outbox-store';
import { SupportService } from '../src/support/support.service';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportController } from '../src/support/support.controller';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main() {
  const uri = process.argv[2]; assert(uri);
  const url = new URL(uri); assert.equal(url.protocol, 'mongodb:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username + url.password + url.search, ''); assert(url.port);
  let client = new MongoClient(uri, { retryWrites: false, retryReads: false, serverSelectionTimeoutMS: 5000 });
  await client.connect(); const name = 'max_durable_' + randomUUID().replaceAll('-', '');
  let db = client.db(name), col = db.collection<Command>('outbox'); await col.createIndex({ id: 1 }, { unique: true });
  const seed = (id: string = randomUUID(), connector = Route.MAX_BOT): Command => ({ id, connector, createdAt: new Date().toISOString(),
    status: Status.PENDING, attempts: 0, dialogId: 'synthetic-dialog', clientId: 'synthetic-client', text: 'synthetic reply',
    targetExternalChatId: 'synthetic-recipient', attachments: undefined, format: undefined, meta: { attachmentsCount: 0 } });
  const persistence = () => Object.assign(Object.create(SupportPersistenceService.prototype), {
    legacyMaxWrites: new Set(), legacyMaxClosing: false, legacyMaxWriteFailures: 0,
    maxBackend: () => ({ db, config: { key: 'synthetic-max' } }), collection: () => col,
    maxStore: () => new MaxOutboxStore(col), logger: { error: () => {} }
  }) as SupportPersistenceService;
  const service = (p = persistence()) => new SupportService(p, {} as any, {} as any);
  const rejected = (op: () => Promise<unknown>) => assert.rejects(op, (e: any) => [409, 503].includes(e.getStatus()));
  try {
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      await col.deleteMany({});
      const accepted = seed(randomUUID(), connector), before = service();
      const command = await (before as any).acceptOutbox(accepted);
      assert.equal(command.meta.maxOutboxProtocol, MAX_RECEIPT_PROTOCOL);
      assert.equal((before as any).outbox.size, 0, 'receipt-v1 keeps no process-local delivery authority');
      assert.equal((await col.findOne({ id: accepted.id }))?.status, Status.PENDING);
      // An entirely new client/service represents a restarted process with an empty Map and sync0.
      await client.close(); client = new MongoClient(uri, { retryWrites: false, retryReads: false }); await client.connect();
      db = client.db(name); col = db.collection<Command>('outbox');
      const after = service(); assert.equal((after as any).outbox.size, 0);
      const leased = await after.pullOutbox(connector, 10, 120, MAX_RECEIPT_PROTOCOL);
      assert.equal(leased.length, 1); assert.equal(leased[0].id, accepted.id);
      const ack = await after.ackOutbox(accepted.id, { leaseToken: leased[0].leaseToken });
      assert.equal(ack.status, Status.SENT);
      const restartedAgain = service();
      assert.equal((await restartedAgain.ackOutbox(accepted.id, { leaseToken: leased[0].leaseToken })).status, Status.SENT,
        'Committed receipt + lost HTTP ACK remains idempotent after another process restart');
      assert.equal((await restartedAgain.pullOutbox(connector, 1, 120, MAX_RECEIPT_PROTOCOL)).length, 0);
    }
    // Explicit v1 must fail startup before advertising an unavailable queue authority.
    const absent = Object.assign(Object.create(SupportPersistenceService.prototype), {
      backendConfigs: [{ key: 'max' }], backendStates: new Map(), resolveBackendKeyForConnector: () => 'max'
    }) as SupportPersistenceService;
    await assert.rejects(() => absent.onModuleInit(), /MAX_OUTBOX_AUTHORITY_NOT_READY/);
    const noUnique = db.collection('synthetic_no_unique_id'); await noUnique.createIndex({ id: 1 });
    const unready = Object.assign(Object.create(SupportPersistenceService.prototype), {
      backendConfigs: [{ key: 'max', uri, dbName: name, collections: { outbox: 'synthetic_no_unique_id' } }],
      backendStates: new Map(), resolveBackendKeyForConnector: () => 'max', ensureIndexes: async () => {},
      logger: { error: () => {}, warn: () => {} }
    }) as SupportPersistenceService;
    await assert.rejects(() => unready.onModuleInit(), /MAX_OUTBOX_UNIQUE_ID_REQUIRED/);
    // A prospective tag alone fences downgrade, even before any claim/receipt exists.
    const downgradeRow = seed();
    await col.insertOne({ ...downgradeRow, meta: { maxOutboxProtocol: MAX_RECEIPT_PROTOCOL } });
    const downgradeBefore = await col.findOne({ id: downgradeRow.id }, { raw: true }) as unknown as Buffer;
    const downgrade = Object.assign(Object.create(SupportPersistenceService.prototype), {
      backendConfigs: [{ key: 'max', uri, dbName: name, collections: { outbox: 'outbox' } }],
      backendStates: new Map(), resolveBackendKeyForConnector: () => 'max', ensureIndexes: async () => {},
      logger: { error: () => {}, warn: () => {} }
    }) as SupportPersistenceService;
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy';
    try { await assert.rejects(() => downgrade.onModuleInit(), /MAX_OUTBOX_RECEIPT_STATE_REQUIRES_V1/); }
    finally { process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1'; }
    assert((await col.findOne({ id: downgradeRow.id }, { raw: true }) as unknown as Buffer).equals(downgradeBefore));

    // All archive/hold states, including null markers and valid-looking tokens, are immutable.
    await col.deleteMany({}); const fixtures: Command[] = [];
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) for (const marker of ['legacyMaxRestartCustody', 'legacyMaxArchive']) {
      for (const status of Object.values(Status)) fixtures.push({ ...seed(randomUUID(), connector), status, attempts: 999,
        leaseToken: randomUUID(), leasedUntil: new Date(0).toISOString(),
        meta: { maxOutboxProtocol: MAX_RECEIPT_PROTOCOL, [marker]: null } });
    }
    const untagged = seed(); fixtures.push(untagged); await col.insertMany(fixtures);
    const rawBefore = new Map<string, Buffer>();
    for (const f of fixtures) rawBefore.set(f.id, (await col.findOne({ id: f.id }, { raw: true })) as unknown as Buffer);
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) assert.deepEqual(await new MaxOutboxStore(col).pull(connector, 50, 60), []);
    for (const f of fixtures) {
      await rejected(() => new MaxOutboxStore(col).receipt(f.id, 'ack', { leaseToken: f.leaseToken ?? randomUUID() }));
      await rejected(() => new MaxOutboxStore(col).enqueue({ ...seed(f.id, f.connector), meta: undefined }));
      const p = persistence(); p.persistOutboxCommand({ ...f, status: Status.PENDING, attempts: 0 });
      await Promise.allSettled([...(p as any).legacyMaxWrites]);
      assert((await col.findOne({ id: f.id }, { raw: true }) as unknown as Buffer).equals(rawBefore.get(f.id)!));
    }
    assert.deepEqual(await new MaxOutboxStore(col).health(Route.MAX_BOT), { protocol: MAX_RECEIPT_PROTOCOL, connector: Route.MAX_BOT,
      pending: 0, leased: 0, sent: 0, failed: 0, due: 0, expiredLeases: 0, needsReview: 0, oldestPendingAgeMs: null });
    // Dedicated queue auth + malformed receipts must not mutate physical TG or archived BSON.
    const envBefore = {dedicated:process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN, ingress:process.env.SUPPORT_INTEGRATION_TOKEN};
    process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN='synthetic-queue';
    process.env.SUPPORT_INTEGRATION_TOKEN='synthetic-ingress';
    try {
      const tg={...seed(randomUUID(),Route.TG_BOT),status:Status.LEASED,attempts:1};await col.insertOne(tg);
      const apiService=service(), api=new SupportController(apiService);
      (apiService as any).outbox.set(tg.id,tg);
      const tgRaw=await col.findOne({id:tg.id},{raw:true}) as unknown as Buffer;
      const protectedRows=[...fixtures,tg];
      const protectedRaw=new Map<string,Buffer>();for(const row of protectedRows)protectedRaw.set(row.id,await col.findOne({id:row.id},{raw:true}) as unknown as Buffer);
      for(const row of protectedRows)for(const receipt of [{leaseToken:randomUUID()},{leaseToken:null},{leaseToken:undefined},{failure:{status:429}},{retryAfterSeconds:1},{},{error:'synthetic',requeue:true}]) {
        await rejected(async()=>api.ackOutbox('synthetic-queue',row.id,receipt));
        await rejected(async()=>api.failOutbox('synthetic-queue',row.id,receipt));
      }
      await assert.rejects(async()=>api.pullOutbox('synthetic-ingress',Route.MAX_BOT,1,120,MAX_RECEIPT_PROTOCOL),(e:any)=>e.getStatus()===403);
      await assert.rejects(async()=>api.pullOutbox('synthetic-queue',Route.TG_BOT),(e:any)=>e.getStatus()===403);
      assert.deepEqual((apiService as any).outbox.get(tg.id),tg);
      assert((await col.findOne({id:tg.id},{raw:true}) as unknown as Buffer).equals(tgRaw));
      for(const row of protectedRows)assert((await col.findOne({id:row.id},{raw:true}) as unknown as Buffer).equals(protectedRaw.get(row.id)!));
    } finally {
      if(envBefore.dedicated===undefined)delete process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN;else process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN=envBefore.dedicated;
      if(envBefore.ingress===undefined)delete process.env.SUPPORT_INTEGRATION_TOKEN;else process.env.SUPPORT_INTEGRATION_TOKEN=envBefore.ingress;
    }
    // API acceptance waits for the database and does not install a Map fallback.
    let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let done = false;
    const waiting = service({ enqueueMaxOutbox: async (c: Command) => { await gate; return c; } } as any);
    const promise = (waiting as any).acceptOutbox(seed()).then(() => { done = true; });
    await Promise.resolve(); assert.equal(done, false); release(); await promise;
    const broken = service({ enqueueMaxOutbox: async () => { throw Error('synthetic database outage'); } } as any);
    await assert.rejects(() => (broken as any).acceptOutbox(seed()), /database outage/); assert.equal((broken as any).outbox.size, 0);
    // A lost DB ACK is reconciled by a majority read, without a second insert.
    await col.deleteMany({}); const c = seed(); let writes = 0;
    const uncertain = new MaxOutboxStore({ updateOne: async (...args: any[]) => { writes++; await (col.updateOne as any)(...args); throw Error('lost ACK'); },
      findOne: (...args: any[]) => (col.findOne as any)(...args) } as any);
    assert.equal((await uncertain.enqueue(c)).id, c.id); assert.equal(writes, 1);
    await rejected(() => uncertain.enqueue({ ...c, text: 'changed payload' }));
    assert.equal((await col.findOne({ id: c.id }))?.text, c.text);
    // Proven local admission failure is bounded too, never an infinite pending cycle.
    await col.deleteMany({}); const store = new MaxOutboxStore(col), deferred = seed(); await store.enqueue(deferred);
    let now = Date.now(); for (let i = 0; i <= 20; i++) {
      const [item] = await store.pull(Route.MAX_BOT, 1, 120, now);
      const r = await store.receipt(item.id, 'fail', { leaseToken: item.leaseToken, failure: { status: null, code: 'local_deferred' } }, now + 1);
      if (i < 20) { assert.equal(r.status, Status.PENDING); now = Date.parse(r.nextAttemptAt!) + 1; }
      else { assert.equal(r.status, Status.FAILED); assert.equal(r.terminalReason, 'LOCAL_ADMISSION_EXHAUSTED'); }
    }
    // Read-only, counts-only health is unavailable without the integration capability.
    const controller = new SupportController({ getMaxOutboxHealth: async () => ({ pending: 1 }) } as any);
    const old = process.env.SUPPORT_INTEGRATION_TOKEN; process.env.SUPPORT_INTEGRATION_TOKEN = 'synthetic-only';
    assert.throws(() => controller.getMaxOutboxHealth(undefined, Route.MAX_BOT), (e: any) => e.getStatus() === 403);
    assert.deepEqual(await controller.getMaxOutboxHealth('synthetic-only', Route.MAX_BOT), { pending: 1 });
    delete process.env.SUPPORT_INTEGRATION_TOKEN;
    assert.throws(() => controller.getMaxOutboxHealth(undefined, Route.MAX_BOT), (e: any) => e.getStatus() === 503);
    if (old !== undefined) process.env.SUPPORT_INTEGRATION_TOKEN = old;
    console.log('MAX durable acceptance/restart/archive fence/finite retries/health: PASS');
  } finally { await db.dropDatabase(); await client.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
