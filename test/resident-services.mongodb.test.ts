import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { HttpException } from '@nestjs/common';
import { ResidentBenefitsService } from '../src/resident-services/resident-benefits.service';
import { ResidentIssuancesService } from '../src/resident-services/resident-issuances.service';
import { ResidentPassesService } from '../src/resident-services/resident-passes.service';
import { ResidentResidencyService } from '../src/resident-services/resident-residency.service';
import { ResidentServicesRepository } from '../src/resident-services/resident-services.repository';
import {
  RESIDENT_SERVICES_ERROR_CODES,
  ResidentIssuanceView
} from '../src/resident-services/resident-services.types';
import {
  HOME_STATION,
  RESIDENT_INTEGRATION_TOKEN,
  RESIDENT_NOW,
  RESIDENT_PEPPER,
  RESIDENT_TENANT,
  RESIDENT_TOKEN_PEPPER,
  residentClientRefHash,
  residentInstanceFixture,
  residentMappingFixture,
  residentPublicationFixture,
  residentStaff,
  residentSubscriptionTypeFixture
} from './helpers/resident-services-fixtures';

const TEST_URI_KEY = 'RESIDENT_SERVICES_TEST_MONGODB_URI';
const TEST_DB_KEY = 'RESIDENT_SERVICES_TEST_MONGODB_DB';
const DB_PATTERN = /^phab_resident_ci_[1-9][0-9]*_[a-f0-9]{32}$/;
const CLIENT_AUTH = 'Bearer client-token';
const START = Date.parse(RESIDENT_NOW);

function requireTestUri(): string {
  const uri = process.env[TEST_URI_KEY];
  if (!uri) throw new Error(TEST_URI_KEY + '_REQUIRED_NO_SKIP');
  const target = /^mongodb:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/\?replicaSet=rs0(?:&directConnection=true)?$/.exec(uri);
  if (!target || Number(target[1]) > 65535) throw new Error(TEST_URI_KEY + '_UNSAFE_TARGET');
  return 'mongodb://127.0.0.1:' + target[1] + '/?replicaSet=rs0&directConnection=true';
}

function requireDbName(): string {
  const name = String(process.env[TEST_DB_KEY] ?? '');
  if (!DB_PATTERN.test(name)) throw new Error(TEST_DB_KEY + '_INVALID');
  return name;
}

function configureFixture(uri: string, dbName: string): () => void {
  const settings: Record<string, string> = {
    RESIDENT_SERVICES_ENABLED: 'true',
    RESIDENT_SERVICES_MONGODB_URI: uri,
    RESIDENT_SERVICES_MONGODB_DB: dbName,
    RESIDENT_SERVICES_INTEGRATION_TOKEN: RESIDENT_INTEGRATION_TOKEN,
    RESIDENT_SERVICES_TOKEN_PEPPER: RESIDENT_TOKEN_PEPPER,
    RESIDENT_SERVICES_TENANT_ID: RESIDENT_TENANT,
    RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS: '3600',
    RESIDENT_SERVICES_PASS_TTL_SECONDS: '120',
    RESIDENT_SERVICES_AUTO_CREATE_INDEXES: 'true',
    SUBSCRIPTIONS_RUNTIME_HASH_PEPPER: RESIDENT_PEPPER,
    RESIDENT_SERVICES_PASSES_COLLECTION: 'cup_resident_passes',
    RESIDENT_SERVICES_BENEFIT_RULES_COLLECTION: 'cup_resident_benefit_rules',
    RESIDENT_SERVICES_USAGE_COLLECTION: 'cup_resident_service_usage',
    RESIDENT_SERVICES_ISSUANCES_COLLECTION: 'cup_resident_service_issuances',
    RESIDENT_SERVICES_RETURNS_COLLECTION: 'cup_resident_service_returns',
    RESIDENT_SERVICES_JOURNAL_COLLECTION: 'cup_resident_service_journal',
    NODE_ENV: 'test'
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, settings);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

interface Harness {
  repository: ResidentServicesRepository;
  passes: ResidentPassesService;
  issuances: ResidentIssuancesService;
  benefits: ResidentBenefitsService;
  now(ms: number): void;
}

function buildHarness(repository: ResidentServicesRepository): Harness {
  let nowMs = START;
  const clock = (): Date => new Date(nowMs);
  const identity = {
    verifyTrustedBearer: async (header: string | undefined): Promise<unknown> => {
      if (header !== CLIENT_AUTH) throw new Error('unexpected bearer');
      return {
        verified: true,
        actor: {
          tenantKey: RESIDENT_TENANT,
          clientId: 'provider_client:piter-1',
          issuer: 'issuer:lk',
          subject: 'subject:client'
        }
      };
    }
  };
  const residency = new ResidentResidencyService(repository, identity as never, clock);
  const benefits = new ResidentBenefitsService(repository, residency, clock);
  const passes = new ResidentPassesService(repository, residency, benefits, clock);
  const issuances = new ResidentIssuancesService(repository, residency, benefits, clock);
  return {
    repository,
    passes,
    issuances,
    benefits,
    now(ms: number): void { nowMs = ms; }
  };
}

async function seedSubscriptionContour(uri: string, dbName: string): Promise<void> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const instance = residentInstanceFixture();
    instance.clientRefHash = residentClientRefHash();
    await db.collection('subscription_types').insertOne(residentSubscriptionTypeFixture());
    await db.collection('subscription_policy_publications').insertOne(residentPublicationFixture());
    await db.collection('subscription_provider_mappings').insertOne(residentMappingFixture());
    await db.collection('subscription_instances').insertOne(instance);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function clearResidentState(repository: ResidentServicesRepository): Promise<void> {
  const db = (repository as unknown as {
    db?: { collection(name: string): {
      deleteMany(filter: object): Promise<unknown>;
      insertOne(document: object): Promise<unknown>;
    } };
  }).db;
  assert.ok(db);
  for (const name of [
    'cup_resident_passes',
    'cup_resident_service_usage',
    'cup_resident_service_issuances',
    'cup_resident_service_returns',
    'cup_resident_service_journal',
    'cup_resident_benefit_rules',
    'subscription_types',
    'subscription_policy_publications',
    'subscription_provider_mappings',
    'subscription_instances'
  ]) {
    await db.collection(name).deleteMany({});
  }
  const instance = residentInstanceFixture();
  instance.clientRefHash = residentClientRefHash();
  await db.collection('subscription_types').insertOne(residentSubscriptionTypeFixture());
  await db.collection('subscription_policy_publications').insertOne(residentPublicationFixture());
  await db.collection('subscription_provider_mappings').insertOne(residentMappingFixture());
  await db.collection('subscription_instances').insertOne(instance);
}

function codeOf(error: unknown): string {
  assert.ok(error instanceof HttpException, 'expected HttpException');
  return String((error.getResponse() as { code?: string }).code);
}

async function createRules(h: Harness): Promise<void> {
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'TOWEL',
    limitPeriod: 'DAY',
    limitQuantity: 2,
    returnable: false
  }, 'mongo-towel-rule-0001', residentStaff() as never, 'corr:mongo-towel');
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'RACKET',
    limitPeriod: 'DAY',
    limitQuantity: 1,
    returnable: true
  }, 'mongo-racket-rule-0001', residentStaff() as never, 'corr:mongo-racket');
}

async function issuePass(h: Harness): Promise<string> {
  const pass = await h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:piter-1'
  });
  return pass.token;
}

async function main(): Promise<void> {
  const uri = requireTestUri();
  const dbName = requireDbName();
  const restore = configureFixture(uri, dbName);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'resident-services-'));
  const repository = new ResidentServicesRepository();
  try {
    await seedSubscriptionContour(uri, dbName);
    await repository.onModuleInit();
    assert.equal(repository.isAvailable(), true);
    await createRules(buildHarness(repository));

    await scenarioConcurrentOnePassOneIssuance(repository);
    await scenarioReplayAfterLostResponse(repository);
    await scenarioIssuanceAttemptAfterReload(repository);
    await scenarioConcurrentSameIdempotencyKey(repository);
    await scenarioLimitAcrossPasses(repository);
    await scenarioExpiredPass(repository);
    await scenarioStaleEvidence(repository);
    await scenarioPassStatus(repository);
    await scenarioReturnAfterResidencyEnd(repository);
    await scenarioAtomicRollback(repository);
    await scenarioJournal(repository);
    await scenarioConcurrentLimitAcrossPasses(repository);
    await scenarioConcurrentDoubleReturn(repository);
    await scenarioPassRetention(repository);
    await scenarioManualPerIssuance(repository);
    console.log('resident-services.mongodb: ok');
  } finally {
    await repository.close();
    const cleanupClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await cleanupClient.connect().then(() => cleanupClient.db(dbName).dropDatabase()).catch(() => undefined);
    await cleanupClient.close().catch(() => undefined);
    rmSync(temporaryDirectory, { recursive: true, force: true });
    restore();
  }
}

async function scenarioConcurrentOnePassOneIssuance(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const results = await Promise.allSettled([
    h.issuances.confirm({
      token,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'TOWEL', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'concurrent-issuance-0001',
      correlationHeader: 'corr:concurrent-1'
    }),
    h.issuances.confirm({
      token,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'TOWEL', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'concurrent-issuance-0002',
      correlationHeader: 'corr:concurrent-2'
    })
  ]);
  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent issuance must succeed');
  assert.equal(rejected.length, 1);
  assert.equal(
    codeOf((rejected[0] as PromiseRejectedResult).reason),
    RESIDENT_SERVICES_ERROR_CODES.PASS_ALREADY_USED
  );
  const db = (repository as unknown as { db: { collection(name: string): { countDocuments(filter: object): Promise<number> } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  const usage = await db.collection('cup_resident_service_usage').countDocuments({});
  assert.equal(usage, 1);
  console.log('mongo scenario concurrent one pass: ok');
}

async function scenarioManualPerIssuance(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  const h = buildHarness(repository);
  await h.benefits.createRule({
    subscriptionTypeId: 'subscription_type:piter-friendship-12m',
    serviceKind: 'RACKET',
    limitPeriod: 'MANUAL_PER_ISSUANCE',
    limitQuantity: 1,
    returnable: true
  }, 'mongo-manual-racket-rule-0001', residentStaff() as never, 'corr:mongo-manual-rule');

  const tooManyToken = await issuePass(h);
  await assert.rejects(
    () => h.issuances.confirm({
      token: tooManyToken,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 2 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-manual-quantity-two-0001',
      correlationHeader: 'corr:mongo-manual-quantity-two'
    }),
    (error: unknown) => codeOf(error) === RESIDENT_SERVICES_ERROR_CODES.REQUEST_INVALID
  );

  const samePassToken = await issuePass(h);
  const samePassResults = await Promise.allSettled([
    h.issuances.confirm({
      token: samePassToken,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-manual-same-pass-0001',
      correlationHeader: 'corr:mongo-manual-same-pass-1'
    }),
    h.issuances.confirm({
      token: samePassToken,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-manual-same-pass-0002',
      correlationHeader: 'corr:mongo-manual-same-pass-2'
    })
  ]);
  assert.equal(samePassResults.filter((result) => result.status === 'fulfilled').length, 1);
  const samePassRejected = samePassResults.find((result) => result.status === 'rejected');
  assert.ok(samePassRejected && samePassRejected.status === 'rejected');
  assert.equal(
    codeOf(samePassRejected.reason),
    RESIDENT_SERVICES_ERROR_CODES.PASS_ALREADY_USED
  );

  const firstToken = await issuePass(h);
  const secondToken = await issuePass(h);
  const body = (token: string, key: string) => ({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET' as const, quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: key,
    correlationHeader: 'corr:' + key
  });
  const results = await Promise.all([
    h.issuances.confirm(body(firstToken, 'mongo-manual-issuance-0001')),
    h.issuances.confirm(body(secondToken, 'mongo-manual-issuance-0002'))
  ]);
  assert.equal(results.length, 2, 'different QR scans are deliberately distinct manual operations');
  assert.notEqual(results[0].view.issuanceId, results[1].view.issuanceId);
  const replay = await h.issuances.confirm(body(firstToken, 'mongo-manual-issuance-0001'));
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.issuanceId, results[0].view.issuanceId);

  const db = (repository as unknown as { db: { collection(name: string): {
    countDocuments(filter: object): Promise<number>;
    find(filter: object): { toArray(): Promise<Array<{ periodKey?: string; used?: number }>> };
  } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 3);
  const usage = await db.collection('cup_resident_service_usage').find({
    limitPeriod: 'MANUAL_PER_ISSUANCE',
    serviceKind: 'RACKET'
  }).toArray();
  assert.equal(usage.length, 3);
  assert.ok(usage.every((row) => row.used === 1 && row.periodKey?.startsWith('resident_issuance:')));
  console.log('mongo scenario manual per issuance: ok');
}

async function scenarioReplayAfterLostResponse(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const first = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'lost-response-issuance-0001',
    correlationHeader: 'corr:lost'
  });
  // the caller never observes the first response and retries with the same key
  const retry = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'lost-response-issuance-0001',
    correlationHeader: 'corr:lost-retry'
  });
  assert.equal(retry.replayed, true);
  assert.equal(retry.view.issuanceId, first.view.issuanceId);
  const db = (repository as unknown as { db: { collection(name: string): {
    countDocuments(filter: object): Promise<number>;
    findOne(filter: object): Promise<unknown>;
  } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  const usage = await db.collection('cup_resident_service_usage').findOne({ serviceKind: 'TOWEL' }) as { used?: number } | null;
  assert.equal(usage?.used, 1);
  console.log('mongo scenario replay after lost response: ok');
}

/**
 * Full page reload after a lost response: the browser has lost the pass token,
 * keeps only the Idempotency-Key, and resolves the exact attempt read-only.
 */
async function scenarioIssuanceAttemptAfterReload(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const notFound = (error: unknown) => codeOf(error) === RESIDENT_SERVICES_ERROR_CODES.ISSUANCE_NOT_FOUND;

  // Not committed yet: nothing found, and the lookup itself writes nothing.
  await assert.rejects(
    () => h.issuances.issuanceAttempt('reload-issuance-key-0001', residentStaff() as never),
    notFound
  );

  const token = await issuePass(h);
  const first = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'reload-issuance-key-0001',
    correlationHeader: 'corr:reload'
  });
  const resolved = await h.issuances.issuanceAttempt('reload-issuance-key-0001', residentStaff() as never);
  assert.equal(resolved.issuanceId, first.view.issuanceId);
  assert.deepEqual(resolved.items.map((item) => item.serviceKind), ['TOWEL']);

  // Another staff actor cannot resolve someone else's key.
  await assert.rejects(
    () => h.issuances.issuanceAttempt(
      'reload-issuance-key-0001',
      residentStaff({ id: 'admin:other-manager' }) as never
    ),
    notFound
  );
  // The same actor scoped away from the issuing station sees nothing.
  await assert.rejects(
    () => h.issuances.issuanceAttempt(
      'reload-issuance-key-0001',
      residentStaff({ stationIds: ['station:elsewhere'] }) as never
    ),
    notFound
  );
  // Read permission alone is not enough: the lookup belongs to the issuer.
  await assert.rejects(
    () => h.issuances.issuanceAttempt(
      'reload-issuance-key-0001',
      residentStaff({ permissions: ['resident-services:read'] }) as never
    ),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 403
  );

  const db = (repository as unknown as { db: { collection(name: string): {
    countDocuments(filter: object): Promise<number>;
  } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  assert.equal(await db.collection('cup_resident_service_journal').countDocuments({}), 1);
  console.log('mongo scenario issuance attempt after reload: ok');
}

async function scenarioConcurrentSameIdempotencyKey(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const body = {
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL' as const, quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'same-key-issuance-0001',
    correlationHeader: 'corr:same-key'
  };
  const results = await Promise.allSettled([
    h.issuances.confirm(body),
    h.issuances.confirm(body)
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 2);
  const ids = new Set(
    (results as PromiseFulfilledResult<{ view: ResidentIssuanceView }>[])
      .map((item) => item.value.view.issuanceId)
  );
  assert.equal(ids.size, 1);
  const db = (repository as unknown as { db: { collection(name: string): { countDocuments(filter: object): Promise<number> } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  console.log('mongo scenario concurrent same idempotency key: ok');
}

async function scenarioLimitAcrossPasses(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const first = await issuePass(h);
  await h.issuances.confirm({
    token: first,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-limit-issuance-0001',
    correlationHeader: 'corr:mongo-limit-1'
  });
  const second = await issuePass(h);
  try {
    await h.issuances.confirm({
      token: second,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-limit-issuance-0002',
      correlationHeader: 'corr:mongo-limit-2'
    });
    assert.fail('limit must be enforced across different passes of one client');
  } catch (error) {
    assert.equal(codeOf(error), RESIDENT_SERVICES_ERROR_CODES.SERVICE_LIMIT_EXCEEDED);
  }
  const db = (repository as unknown as { db: { collection(name: string): { countDocuments(filter: object): Promise<number> } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  console.log('mongo scenario limit across passes: ok');
}

async function scenarioExpiredPass(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  h.now(START + 121_000);
  try {
    await h.issuances.confirm({
      token,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'TOWEL', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-expired-issuance-0001',
      correlationHeader: 'corr:mongo-expired'
    });
    assert.fail('expired pass must be rejected at confirmation');
  } catch (error) {
    assert.equal(codeOf(error), RESIDENT_SERVICES_ERROR_CODES.PASS_EXPIRED);
  }
  console.log('mongo scenario expired pass: ok');
}

async function scenarioStaleEvidence(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  // Keep the pass valid but force the residency evidence outside the freshness window.
  const previousMaxAge = process.env.RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS;
  process.env.RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS = '30';
  h.now(START + 40_000);
  try {
    await h.issuances.confirm({
      token,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'TOWEL', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-stale-issuance-0001',
      correlationHeader: 'corr:mongo-stale'
    });
    assert.fail('stale residency evidence must not auto-approve issuance');
  } catch (error) {
    const code = codeOf(error);
    assert.ok(
      code === RESIDENT_SERVICES_ERROR_CODES.EVIDENCE_STALE
        || code === RESIDENT_SERVICES_ERROR_CODES.MAPPING_STALE,
      'unexpected stale code ' + code
    );
  } finally {
    if (previousMaxAge === undefined) delete process.env.RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS;
    else process.env.RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS = previousMaxAge;
  }
  console.log('mongo scenario stale evidence: ok');
}

async function scenarioReturnAfterResidencyEnd(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const issued = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-late-issuance-0001',
    correlationHeader: 'corr:mongo-late'
  });
  const db = (repository as unknown as {
    db: { collection(name: string): { updateOne(filter: object, update: object): Promise<unknown> } };
  }).db;
  await db.collection('subscription_instances').updateOne(
    { subscriptionInstanceId: 'subscription_instance:piter-1' },
    { $set: {
      state: 'EXPIRED',
      activeTo: new Date(START - 1000).toISOString(),
      reconciliation: {
        state: 'CURRENT',
        asOf: new Date(START - 1000).toISOString(),
        evidenceRef: 'evidence:instance-expired'
      }
    } }
  );
  h.now(START + 400 * 86_400_000);
  const returned = await h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-late-return-0001',
    correlationHeader: 'corr:mongo-late-return'
  });
  assert.equal(returned.view.issuanceState, 'RETURNED');
  console.log('mongo scenario return after residency end: ok');
}

async function scenarioAtomicRollback(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const original = repository.appendJournal.bind(repository);
  let failed = false;
  repository.appendJournal = async () => {
    if (!failed) {
      failed = true;
      throw new Error('forced journal failure');
    }
    return original([]);
  };
  try {
    await assert.rejects(() => h.issuances.confirm({
      token,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'TOWEL', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-rollback-issuance-0001',
      correlationHeader: 'corr:mongo-rollback'
    }));
  } finally {
    repository.appendJournal = original;
  }
  const db = (repository as unknown as {
    db: { collection(name: string): {
      countDocuments(filter: object): Promise<number>;
      findOne(filter: object): Promise<unknown>;
    } };
  }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 0);
  assert.equal(await db.collection('cup_resident_service_usage').countDocuments({}), 0);
  const pass = await db.collection('cup_resident_passes').findOne({}) as { state?: string } | null;
  assert.equal(pass?.state, 'ACTIVE');
  const success = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-rollback-issuance-0002',
    correlationHeader: 'corr:mongo-rollback-2'
  });
  assert.equal(success.view.state, 'ISSUED');
  console.log('mongo scenario atomic rollback: ok');
}

async function scenarioConcurrentLimitAcrossPasses(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const first = await issuePass(h);
  const second = await issuePass(h);
  const results = await Promise.allSettled([
    h.issuances.confirm({
      token: first,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-concurrent-limit-0001',
      correlationHeader: 'corr:mongo-concurrent-limit-1'
    }),
    h.issuances.confirm({
      token: second,
      stationId: HOME_STATION,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-concurrent-limit-0002',
      correlationHeader: 'corr:mongo-concurrent-limit-2'
    })
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.filter((item) => item.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(
    codeOf((rejected[0] as PromiseRejectedResult).reason),
    RESIDENT_SERVICES_ERROR_CODES.SERVICE_LIMIT_EXCEEDED
  );
  const db = (repository as unknown as { db: { collection(name: string): {
    countDocuments(filter: object): Promise<number>;
    findOne(filter: object): Promise<unknown>;
  } } }).db;
  assert.equal(await db.collection('cup_resident_service_issuances').countDocuments({}), 1);
  const usage = await db.collection('cup_resident_service_usage').findOne({
    serviceKind: 'RACKET'
  }) as { used?: number } | null;
  assert.equal(usage?.used, 1);
  console.log('mongo scenario concurrent limit across passes: ok');
}

async function scenarioConcurrentDoubleReturn(
  repository: ResidentServicesRepository
): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const issued = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-double-return-issuance-0001',
    correlationHeader: 'corr:mongo-double-return'
  });
  const results = await Promise.allSettled([
    h.issuances.returnItems({
      issuanceId: issued.view.issuanceId,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-double-return-0001',
      correlationHeader: 'corr:mongo-double-return-1'
    }),
    h.issuances.returnItems({
      issuanceId: issued.view.issuanceId,
      items: [{ serviceKind: 'RACKET', quantity: 1 }],
      user: residentStaff() as never,
      idempotencyHeader: 'mongo-double-return-0002',
      correlationHeader: 'corr:mongo-double-return-2'
    })
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.filter((item) => item.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(
    codeOf((rejected[0] as PromiseRejectedResult).reason),
    RESIDENT_SERVICES_ERROR_CODES.SERVICE_ALREADY_RETURNED
  );
  const db = (repository as unknown as { db: { collection(name: string): {
    countDocuments(filter: object): Promise<number>;
  } } }).db;
  assert.equal(await db.collection('cup_resident_service_returns').countDocuments({}), 1);
  console.log('mongo scenario concurrent double return: ok');
}

async function scenarioPassRetention(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  await issuePass(h);
  const db = (repository as unknown as { db: { collection(name: string): {
    findOne(filter: object): Promise<unknown>;
    indexes(): Promise<Array<{
      name?: string;
      expireAfterSeconds?: number;
      key?: object;
      unique?: boolean;
      sparse?: boolean;
      partialFilterExpression?: object;
    }>>;
  } } }).db;
  const pass = await db.collection('cup_resident_passes').findOne({}) as {
    expiresAt?: string;
    expiresAtDate?: Date;
  } | null;
  assert.ok(pass);
  assert.equal(pass!.expiresAtDate instanceof Date, true);
  assert.equal(pass!.expiresAtDate!.toISOString(), pass!.expiresAt);
  const indexes = await db.collection('cup_resident_passes').indexes();
  const ttl = indexes.find((index) => index.name === 'resident_pass_expires_ttl');
  assert.ok(ttl);
  assert.equal(ttl!.expireAfterSeconds, 86400);
  assert.deepEqual(ttl!.key, { expiresAtDate: 1 });
  const ruleIndexes = await db.collection('cup_resident_benefit_rules').indexes();
  const idempotencyIndex = ruleIndexes.find(
    (index) => index.name === 'resident_benefit_rule_idempotency_unique'
  );
  assert.ok(idempotencyIndex);
  assert.equal(idempotencyIndex!.unique, true);
  assert.equal(Boolean(idempotencyIndex!.sparse), false);
  assert.deepEqual(idempotencyIndex!.partialFilterExpression, {
    'idempotency.keyHash': { $exists: true }
  });
  console.log('mongo scenario pass retention: ok');
}

async function scenarioPassStatus(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const created = await h.passes.createPass({
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    clientSubscriptionId: 'client_subscription:piter-1'
  });
  const db = (repository as unknown as { db: { collection(name: string): {
    findOne(filter: object, options?: object): Promise<unknown>;
  } } }).db;
  const storedPass = async (): Promise<unknown> => db
    .collection('cup_resident_passes')
    .findOne({ passId: created.passId }, { projection: { _id: 0 } });
  const input = {
    authorization: CLIENT_AUTH,
    integrationToken: RESIDENT_INTEGRATION_TOKEN,
    passId: created.passId
  };

  const storedBefore = await storedPass();
  assert.ok(storedBefore);
  const active = await h.passes.status(input);
  assert.equal(active.schemaVersion, 1);
  assert.equal(active.passId, created.passId);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.issuedAt, created.issuedAt);
  assert.equal(active.expiresAt, created.expiresAt);
  assert.equal(active.consumedAt, null);
  assert.equal(active.stationId, null);
  // Reading the status must not modify the stored pass at all.
  assert.deepEqual(await storedPass(), storedBefore);

  try {
    await h.passes.status({ ...input, passId: 'resident_pass:unknown-1' });
    assert.fail('unknown pass must not be reported');
  } catch (error) {
    assert.equal(codeOf(error), RESIDENT_SERVICES_ERROR_CODES.PASS_NOT_FOUND);
  }
  try {
    await h.passes.status({ ...input, integrationToken: 'wrong-token' });
    assert.fail('wrong integration token must be rejected');
  } catch (error) {
    assert.equal(codeOf(error), RESIDENT_SERVICES_ERROR_CODES.INTEGRATION_FORBIDDEN);
  }

  await h.issuances.confirm({
    token: created.token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'TOWEL', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-status-issuance-0001',
    correlationHeader: 'corr:mongo-status'
  });
  const storedAfterConsume = await storedPass();
  const consumed = await h.passes.status(input);
  assert.equal(consumed.state, 'CONSUMED');
  assert.equal(consumed.stationId, HOME_STATION);
  assert.ok(consumed.consumedAt);
  assert.equal(consumed.issuedAt, created.issuedAt);
  assert.equal(consumed.expiresAt, created.expiresAt);
  assert.deepEqual(await storedPass(), storedAfterConsume);
  console.log('mongo scenario pass status: ok');
}

async function scenarioJournal(repository: ResidentServicesRepository): Promise<void> {
  await clearResidentState(repository);
  await createRules(buildHarness(repository));
  const h = buildHarness(repository);
  const token = await issuePass(h);
  const issued = await h.issuances.confirm({
    token,
    stationId: HOME_STATION,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-journal-issuance-0001',
    correlationHeader: 'corr:mongo-journal'
  });
  h.now(START + 1000);
  await h.issuances.returnItems({
    issuanceId: issued.view.issuanceId,
    items: [{ serviceKind: 'RACKET', quantity: 1 }],
    user: residentStaff() as never,
    idempotencyHeader: 'mongo-journal-return-0001',
    correlationHeader: 'corr:mongo-journal-return'
  });
  const page = await h.issuances.journal({ limit: '50' }, residentStaff() as never);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].eventType, 'ITEM_RETURNED');
  assert.equal(page.items[1].eventType, 'ISSUANCE_CONFIRMED');
  console.log('mongo scenario journal: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
