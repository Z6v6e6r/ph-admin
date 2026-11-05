import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { QrLinksRepository } from '../src/qr-links/qr-links.repository';
import { StoredQrLink } from '../src/qr-links/qr-links.types';

const ENV_KEYS = [
  'QR_LINKS_ENABLED',
  'QR_LINKS_MONGODB_URI',
  'QR_LINKS_MONGODB_DB',
  'QR_LINKS_COLLECTION',
  'QR_LINKS_DAILY_STATS_COLLECTION',
  'NODE_ENV'
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function captureEnv(): Record<EnvKey, string | undefined> {
  return {
    QR_LINKS_ENABLED: process.env.QR_LINKS_ENABLED,
    QR_LINKS_MONGODB_URI: process.env.QR_LINKS_MONGODB_URI,
    QR_LINKS_MONGODB_DB: process.env.QR_LINKS_MONGODB_DB,
    QR_LINKS_COLLECTION: process.env.QR_LINKS_COLLECTION,
    QR_LINKS_DAILY_STATS_COLLECTION: process.env.QR_LINKS_DAILY_STATS_COLLECTION,
    NODE_ENV: process.env.NODE_ENV
  };
}

function restoreEnv(previous: Record<EnvKey, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

let codeCounter = 0;

function nextCode(): string {
  codeCounter += 1;
  return 'itcode' + String(codeCounter).padStart(6, '0');
}

function makeLink(overrides: Partial<StoredQrLink> = {}): StoredQrLink {
  const createdAt = overrides.createdAt ?? '2026-01-01T10:00:00.000Z';
  return {
    id: randomUUID(),
    code: nextCode(),
    name: 'Интеграционный QR',
    stationId: null,
    stationName: null,
    placement: null,
    description: null,
    targetUrl: 'https://padlhub.ru/annual',
    status: 'ACTIVE',
    version: 1,
    createdBy: 'admin:integration',
    updatedBy: 'admin:integration',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    ...overrides
  };
}

async function expectDuplicateKey(
  operation: Promise<unknown>,
  repository: QrLinksRepository,
  expectedField: string
): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure !== undefined, 'duplicate insert must be rejected');
  assert.equal(repository.isDuplicateKey(failure), true, 'E11000 must be recognised');
  assert.ok(
    repository.duplicateKeyFields(failure).includes(expectedField),
    'duplicate key must be attributed to ' + expectedField
  );
}

async function main(): Promise<void> {
  const uri = String(process.env.QR_LINKS_TEST_MONGODB_URI ?? '').trim();
  const databaseBase = String(process.env.QR_LINKS_TEST_MONGODB_DB ?? '').trim();
  if (!uri || !databaseBase) {
    console.log(
      'qr-links MongoDB integration test: SKIP (QR_LINKS_TEST_MONGODB_URI and QR_LINKS_TEST_MONGODB_DB are not set)'
    );
    return;
  }

  // Safety: never point the integration test at a real or shared database.
  if (process.env.QR_LINKS_TEST_MONGODB_ALLOW_REMOTE !== '1') {
    let hostname = '';
    try {
      hostname = new URL(uri).hostname;
    } catch (_error) {
      assert.fail('QR_LINKS_TEST_MONGODB_URI must be a single-host MongoDB URI for the loopback safety check');
    }
    assert.ok(
      ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname),
      'QR_LINKS_TEST_MONGODB_URI must target loopback unless QR_LINKS_TEST_MONGODB_ALLOW_REMOTE=1 (got ' + hostname + ')'
    );
  }

  const previousEnv = captureEnv();
  const suffix = String(process.pid) + '_' + String(Date.now()) + '_' + randomUUID().slice(0, 8);
  const databaseName = databaseBase + '_qrlinks_it_' + suffix;
  assert.match(databaseName, /_qrlinks_it_/, 'integration database name must be disposable and unique');
  const linksCollection = 'cup_qr_links_it_' + suffix;
  const dailyStatsCollection = 'cup_qr_daily_stats_it_' + suffix;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 10 });
  let repository: QrLinksRepository | undefined;
  try {
    process.env.QR_LINKS_ENABLED = 'true';
    process.env.QR_LINKS_MONGODB_URI = uri;
    process.env.QR_LINKS_MONGODB_DB = databaseName;
    process.env.QR_LINKS_COLLECTION = linksCollection;
    process.env.QR_LINKS_DAILY_STATS_COLLECTION = dailyStatsCollection;
    process.env.NODE_ENV = 'test';

    await client.connect();
    repository = new QrLinksRepository();
    await repository.onModuleInit();
    assert.equal(repository.isFeatureEnabled(), true);
    assert.equal(repository.isAvailable(), true, 'repository must connect to the disposable database');
    repository.requireAvailable();

    const database = client.db(databaseName);
    const links = database.collection<StoredQrLink>(linksCollection);

    // Required unique indexes are created by the repository itself.
    const linkIndexes = await links.listIndexes().toArray();
    const codeIndex = linkIndexes.find((index) => index.name === 'qr_link_code_unique');
    assert.ok(codeIndex, 'code unique index must exist');
    assert.equal(codeIndex?.unique, true, 'code index must be unique');
    assert.deepEqual(codeIndex?.key, { code: 1 });
    const idIndex = linkIndexes.find((index) => index.name === 'qr_link_id_unique');
    assert.ok(idIndex, 'id unique index must exist');
    assert.equal(idIndex?.unique, true);
    const dailyIndexes = await database
      .collection(dailyStatsCollection)
      .listIndexes()
      .toArray();
    const dailyUnique = dailyIndexes.find((index) => index.name === 'qr_daily_unique');
    assert.ok(dailyUnique, 'daily aggregate unique index must exist');
    assert.equal(dailyUnique?.unique, true);

    // Active code uniqueness and archived-code uniqueness share the same index.
    const archivedCandidate = makeLink({ code: 'sharedcode01' });
    await repository.insertLink(archivedCandidate);
    await expectDuplicateKey(
      repository.insertLink(makeLink({ code: 'sharedcode01' })),
      repository,
      'code'
    );
    const archived = await repository.updateLink(
      archivedCandidate.id,
      1,
      { status: 'ARCHIVED', archivedAt: '2026-01-05T10:00:00.000Z' },
      '2026-01-05T10:00:00.000Z'
    );
    assert.equal(archived?.status, 'ARCHIVED');
    assert.equal(archived?.version, 2);
    await expectDuplicateKey(
      repository.insertLink(makeLink({ code: 'sharedcode01' })),
      repository,
      'code'
    );

    // (actorId, Idempotency-Key) uniqueness; documents without idempotency stay sparse.
    await repository.insertLink(
      makeLink({
        idempotency: { actorId: 'admin:one', key: 'idem-key-0001', intentHash: 'a'.repeat(64) }
      })
    );
    await expectDuplicateKey(
      repository.insertLink(
        makeLink({
          idempotency: { actorId: 'admin:one', key: 'idem-key-0001', intentHash: 'b'.repeat(64) }
        })
      ),
      repository,
      'idempotency.actorId'
    );
    await repository.insertLink(makeLink());
    await repository.insertLink(makeLink());
    assert.equal(
      (await repository.findByIdempotency('admin:one', 'idem-key-0001'))?.idempotency?.key,
      'idem-key-0001'
    );
    assert.equal(await repository.findByIdempotency('admin:two', 'idem-key-0001'), null);

    // 100 parallel daily increments (including concurrent upsert races) must not lose an update.
    const concurrentQrId = randomUUID();
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        repository!.incrementDailyRedirect(
          concurrentQrId,
          '2026-01-02',
          '2026-01-02T10:00:' + String(index % 60).padStart(2, '0') + '.000Z'
        )
      )
    );
    const concurrentStats = await repository.getStats(concurrentQrId, '2026-01-02', '2026-01-02');
    assert.equal(concurrentStats.redirectsTotal, 100);
    assert.equal(concurrentStats.redirectsPeriod, 100);
    assert.deepEqual(concurrentStats.daily, [{ date: '2026-01-02', redirects: 100 }]);
    const rawConcurrent = await database
      .collection(dailyStatsCollection)
      .findOne({ qrId: concurrentQrId, dateKey: '2026-01-02' });
    assert.equal(rawConcurrent?.redirectsCount, 100);
    assert.equal(rawConcurrent?.lastRedirectAt, '2026-01-02T10:00:59.000Z');

    // Day keys are filtered as business-timezone calendar strings.
    const dayFilteredQrId = randomUUID();
    for (const dateKey of ['2025-12-31', '2025-12-31', '2025-12-31', '2025-12-31']) {
      await repository.incrementDailyRedirect(dayFilteredQrId, dateKey, dateKey + 'T09:00:00.000Z');
    }
    for (const time of ['10:00:00', '10:10:00']) {
      await repository.incrementDailyRedirect(
        dayFilteredQrId,
        '2026-01-01',
        '2026-01-01T' + time + '.000Z'
      );
    }
    for (const time of ['10:00:00', '10:10:00', '10:20:00']) {
      await repository.incrementDailyRedirect(
        dayFilteredQrId,
        '2026-01-02',
        '2026-01-02T' + time + '.000Z'
      );
    }
    const filteredStats = await repository.getStats(dayFilteredQrId, '2026-01-01', '2026-01-02');
    assert.equal(filteredStats.redirectsTotal, 9);
    assert.equal(filteredStats.redirectsPeriod, 5);
    assert.equal(filteredStats.lastRedirectAt, '2026-01-02T10:20:00.000Z');
    assert.deepEqual(filteredStats.daily, [
      { date: '2026-01-01', redirects: 2 },
      { date: '2026-01-02', redirects: 3 }
    ]);
    const narrowStats = await repository.getStats(dayFilteredQrId, '2026-01-02', '2026-01-02');
    assert.equal(narrowStats.redirectsPeriod, 3);
    assert.equal(narrowStats.redirectsTotal, 9);
    const emptyStats = await repository.getStats(randomUUID(), '2026-01-01', '2026-01-02');
    assert.deepEqual(emptyStats, {
      redirectsTotal: 0,
      redirectsPeriod: 0,
      lastRedirectAt: null,
      daily: []
    });

    // Isolate the listing fixtures from the earlier uniqueness/concurrency documents.
    await links.deleteMany({});
    await database.collection(dailyStatsCollection).deleteMany({});

    // listLinks sorting, filtering, metrics and pagination over real aggregation pipelines.
    const yasenevoActive = makeLink({
      name: 'Alpha',
      code: 'listcode0001',
      stationId: 'Yasenevo',
      stationName: 'Ясенево',
      createdAt: '2026-01-01T10:00:00.000Z'
    });
    const piterActive = makeLink({
      name: 'Bravo',
      code: 'listcode0002',
      stationId: 'Piter',
      stationName: 'Питер',
      createdAt: '2026-01-02T10:00:00.000Z'
    });
    const globalActive = makeLink({
      name: 'Charlie',
      code: 'listcode0003',
      createdAt: '2026-01-03T10:00:00.000Z'
    });
    const yasenevoArchived = makeLink({
      name: 'Delta',
      code: 'listcode0004',
      stationId: 'Yasenevo',
      stationName: 'Ясенево',
      status: 'ARCHIVED',
      archivedAt: '2026-01-04T10:00:00.000Z',
      createdAt: '2026-01-04T10:00:00.000Z'
    });
    for (const link of [yasenevoActive, piterActive, globalActive, yasenevoArchived]) {
      await repository.insertLink(link);
    }
    for (let index = 0; index < 5; index += 1) {
      await repository.incrementDailyRedirect(
        yasenevoActive.id,
        '2026-01-01',
        '2026-01-01T0' + index + ':00:00.000Z'
      );
    }
    await repository.incrementDailyRedirect(
      yasenevoActive.id,
      '2026-01-02',
      '2026-01-02T10:00:00.000Z'
    );
    await repository.incrementDailyRedirect(
      piterActive.id,
      '2026-01-02',
      '2026-01-02T12:00:00.000Z'
    );
    await repository.incrementDailyRedirect(
      piterActive.id,
      '2026-01-02',
      '2026-01-02T12:10:00.000Z'
    );
    for (let index = 0; index < 7; index += 1) {
      await repository.incrementDailyRedirect(
        yasenevoArchived.id,
        '2026-01-03',
        '2026-01-03T09:0' + index + ':00.000Z'
      );
    }

    const period = { from: '2026-01-02', to: '2026-01-03' };
    const defaultPage = await repository.listLinks({
      stationScope: null,
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.deepEqual(
      defaultPage.items.map((item) => item.code),
      ['listcode0003', 'listcode0002', 'listcode0001'],
      'default list sorts by createdAt desc and excludes archived links'
    );
    assert.equal(defaultPage.totalQr, 3);
    assert.equal(defaultPage.activeQr, 3);
    assert.equal(defaultPage.redirectsPeriod, 3);
    assert.equal(defaultPage.items[0].redirectsTotal, 0);
    assert.equal(defaultPage.items[0].lastRedirectAt, null);
    assert.equal(defaultPage.items[1].redirectsTotal, 2);
    assert.equal(defaultPage.items[1].redirectsPeriod, 2);
    assert.equal(defaultPage.items[2].redirectsTotal, 6);
    assert.equal(defaultPage.items[2].redirectsPeriod, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(defaultPage.items[0], 'idempotency'),
      false
    );

    const allByTotal = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      sort: 'redirectsTotal',
      direction: 'desc',
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 10
    });
    assert.deepEqual(
      allByTotal.items.map((item) => item.code),
      ['listcode0004', 'listcode0001', 'listcode0002', 'listcode0003']
    );
    assert.equal(allByTotal.activeQr, 3);
    assert.equal(allByTotal.totalQr, 4);

    const allByLastRedirect = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      sort: 'lastRedirectAt',
      direction: 'desc',
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 10
    });
    assert.deepEqual(
      allByLastRedirect.items.map((item) => item.code),
      ['listcode0004', 'listcode0002', 'listcode0001', 'listcode0003']
    );

    const allByName = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      sort: 'name',
      direction: 'asc',
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 10
    });
    assert.deepEqual(
      allByName.items.map((item) => item.name),
      ['Alpha', 'Bravo', 'Charlie', 'Delta']
    );

    const thirdDayPeriod = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      sort: 'redirectsPeriod',
      direction: 'desc',
      from: '2026-01-03',
      to: '2026-01-03',
      page: 1,
      pageSize: 10
    });
    assert.equal(thirdDayPeriod.items[0].code, 'listcode0004');
    assert.equal(thirdDayPeriod.items[0].redirectsPeriod, 7);
    assert.equal(thirdDayPeriod.redirectsPeriod, 7);

    const secondPage = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      from: period.from,
      to: period.to,
      page: 2,
      pageSize: 2
    });
    assert.deepEqual(secondPage.items.map((item) => item.code), ['listcode0002', 'listcode0001']);
    assert.equal(secondPage.totalQr, 4);

    const scopedPage = await repository.listLinks({
      stationScope: ['Yasenevo'],
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.deepEqual(scopedPage.items.map((item) => item.code), ['listcode0001']);
    assert.equal(scopedPage.totalQr, 1);
    assert.equal(scopedPage.redirectsPeriod, 1);

    const scopedAllPage = await repository.listLinks({
      status: 'ALL',
      stationScope: ['Yasenevo'],
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.deepEqual(
      scopedAllPage.items.map((item) => item.code),
      ['listcode0004', 'listcode0001']
    );

    const emptyScopePage = await repository.listLinks({
      status: 'ALL',
      stationScope: [],
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.equal(emptyScopePage.totalQr, 0);
    assert.deepEqual(emptyScopePage.items, []);

    const outOfScopeStation = await repository.listLinks({
      status: 'ALL',
      stationScope: ['Yasenevo'],
      stationId: 'Piter',
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.deepEqual(outOfScopeStation.items, []);
    assert.equal(outOfScopeStation.totalQr, 0);
    assert.equal(outOfScopeStation.redirectsPeriod, 0);

    const searchPage = await repository.listLinks({
      status: 'ALL',
      stationScope: null,
      q: 'charl',
      from: period.from,
      to: period.to,
      page: 1,
      pageSize: 20
    });
    assert.deepEqual(searchPage.items.map((item) => item.code), ['listcode0003']);

    // findById / findByCode round-trip the stored document without _id.
    const stored = await repository.findById(yasenevoActive.id);
    assert.ok(stored);
    assert.equal(stored?.code, 'listcode0001');
    assert.equal(Object.prototype.hasOwnProperty.call(stored, '_id'), false);
    assert.equal((await repository.findByCode('listcode0001'))?.id, yasenevoActive.id);
    assert.equal(await repository.findByCode('does-not-exist'), null);

    // Version-guarded update returns null on a stale expectation and never overwrites.
    const updated = await repository.updateLink(
      yasenevoActive.id,
      1,
      { name: 'Alpha renamed', targetUrl: 'https://padlhub.ru/new' },
      '2026-01-06T10:00:00.000Z'
    );
    assert.equal(updated?.version, 2);
    assert.equal(updated?.name, 'Alpha renamed');
    assert.equal(
      await repository.updateLink(yasenevoActive.id, 1, { name: 'Stale write' }, '2026-01-07T10:00:00.000Z'),
      null
    );
    assert.equal((await repository.findById(yasenevoActive.id))?.name, 'Alpha renamed');

    console.log('QR links MongoDB integration test passed (db=' + databaseName + ').');
  } finally {
    if (repository) {
      await repository.onModuleDestroy().catch(() => undefined);
    }
    await client.db(databaseName).dropDatabase().catch(() => undefined);
    await client.close().catch(() => undefined);
    restoreEnv(previousEnv);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
