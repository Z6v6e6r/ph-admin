import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signValue,
  type KeyObject
} from 'node:crypto';
import { MongoClient, MongoServerError, type Collection } from 'mongodb';
import {
  computeSubscriptionRuntimeIdempotencyKeyHash,
  computeSubscriptionRuntimeQuoteRequestHash,
  SubscriptionRuntimeLk2DelegationVerifierService
} from '../src/subscriptions/subscription-runtime-lk2-delegation-verifier.service';
import { SubscriptionRuntimeContractError } from
  '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const TEST_URI = process.env.SUBSCRIPTIONS_TEST_MONGODB_URI
  ?? 'mongodb://127.0.0.1:27029/?directConnection=true';
const TEST_DATABASE = [
  'phab_sub_replay_test',
  process.pid,
  Date.now(),
  randomBytes(6).toString('hex')
].join('_');
const TEST_DATABASE_PATTERN =
  /^phab_sub_replay_test_[0-9]+_[0-9]+_[a-f0-9]{12}$/;
const LOOPBACK_MONGODB_PATTERN =
  /^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?(?:[/?]|$)/;
const REPLAY_COLLECTION = 'subscription_runtime_delegation_replays';
const UNIQUE_INDEX = 'subscription_runtime_delegation_issuer_jti_unique';
const TTL_INDEX = 'subscription_runtime_delegation_expiry_ttl';
const ENV_NAMES = [
  'NODE_ENV',
  'SUBSCRIPTIONS_MONGODB_URI',
  'SUBSCRIPTIONS_MONGODB_DB',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED',
  'SUBSCRIPTIONS_TEST_RUNTIME_ENABLED',
  'SUBSCRIPTIONS_AUTO_CREATE_INDEXES',
  'SUBSCRIPTIONS_INDEX_APPLY',
  'SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN',
  'SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER',
  'SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE',
  'SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON',
  'SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_LK2_REPLAY_RETENTION_SECONDS',
  'SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON',
  'SUBSCRIPTIONS_RUNTIME_TENANT_ID'
] as const;
const ORIGINAL_ENV = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

interface ReplayDocument {
  issuer: string;
  jti: string;
  expiresAt: Date;
  consumedAt: Date;
}

const quoteRequest = {
  action: 'JOIN_GAME' as const,
  target: { kind: 'GAME' as const, id: 'game:delegation-replay', expectedRevision: 7 },
  preferredSubscriptionInstanceId: 'subscription_instance:delegation-replay',
  paymentIntent: 'USE_SUBSCRIPTION' as const
};

function restoreEnv(): void {
  for (const name of ENV_NAMES) {
    const value = ORIGINAL_ENV.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function assertSafeTarget(): void {
  assert.match(TEST_DATABASE, TEST_DATABASE_PATTERN);
  assert.ok(Buffer.byteLength(TEST_DATABASE, 'utf8') < 64);
  assert.match(TEST_URI, LOOPBACK_MONGODB_PATTERN);
}

function runIndexCommand(script: 'subscriptions:indexes:apply' | 'subscriptions:indexes:check'): void {
  assertSafeTarget();
  const env = { ...process.env };
  if (script === 'subscriptions:indexes:apply') env.SUBSCRIPTIONS_INDEX_APPLY = 'CONFIRM';
  else delete env.SUBSCRIPTIONS_INDEX_APPLY;
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(JSON.stringify({ indexCommand: script, testDatabase: TEST_DATABASE, result: 'OK' }));
}

function exceptionCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const exception = error as {
    response?: unknown;
    getResponse?: () => unknown;
  };
  const response = typeof exception.getResponse === 'function'
    ? exception.getResponse()
    : exception.response;
  return response && typeof response === 'object'
    ? String((response as Record<string, unknown>).code ?? '')
    : undefined;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => exceptionCode(error) === code);
}

async function dropExactTestDatabase(): Promise<void> {
  assertSafeTarget();
  const client = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    await client.db(TEST_DATABASE).dropDatabase();
    const databases = await client.db('admin').admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some((item) => item.name === TEST_DATABASE), false);
    console.log(JSON.stringify({ cleanup: 'DROP_DATABASE_VERIFIED', testDatabase: TEST_DATABASE }));
  } finally {
    await client.close();
  }
}

async function createEmptyReplayCollection(): Promise<void> {
  assertSafeTarget();
  const client = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    await client.db(TEST_DATABASE).createCollection(REPLAY_COLLECTION);
  } finally {
    await client.close();
  }
}

function assertExactReplayIndexes(indexes: Array<Record<string, unknown>>): void {
  const unique = indexes.find((index) => index.name === UNIQUE_INDEX);
  assert.ok(unique, 'exact replay unique index must exist');
  assert.deepEqual(unique.key, { issuer: 1, jti: 1 });
  assert.equal(unique.unique, true);

  const ttl = indexes.find((index) => index.name === TTL_INDEX);
  assert.ok(ttl, 'exact replay TTL index must exist');
  assert.deepEqual(ttl.key, { expiresAt: 1 });
  assert.equal(ttl.expireAfterSeconds, 0);
}

async function proveRepositoryConcurrency(
  repository: SubscriptionsRepository,
  collection: Collection<ReplayDocument>
): Promise<Array<{ consumed: number; replay: number }>> {
  const issuer = 'https://api.padlhub.invalid/subscription-runtime-delegation';
  const rounds: Array<{ consumed: number; replay: number }> = [];
  for (let round = 0; round < 3; round += 1) {
    const consumedAt = new Date(Date.now() + round);
    const expiresAt = new Date(consumedAt.getTime() + 60_000);
    const jti = randomUUID();
    const results = await Promise.all(Array.from({ length: 100 }, () =>
      repository.consumeRuntimeDelegationReplay({ issuer, jti, consumedAt, expiresAt })
    ));
    const consumed = results.filter((result) => result === 'CONSUMED').length;
    const replay = results.filter((result) => result === 'REPLAY').length;
    assert.deepEqual({ consumed, replay }, { consumed: 1, replay: 99 });
    assert.equal(await collection.countDocuments({ issuer, jti }), 1);
    const stored = await collection.findOne({ issuer, jti });
    assert.ok(stored);
    assert.equal(stored.issuer, issuer);
    assert.equal(stored.jti, jti);
    assert.ok(stored.consumedAt instanceof Date);
    assert.ok(stored.expiresAt instanceof Date);
    assert.equal(stored.consumedAt.getTime(), consumedAt.getTime());
    assert.equal(stored.expiresAt.getTime(), expiresAt.getTime());
    rounds.push({ consumed, replay });
  }

  const sameIssuer = 'issuer:same-with-independent-jti';
  const independentJtis = Array.from({ length: 16 }, () => randomUUID());
  const independentResults = await Promise.all(independentJtis.map((jti, index) => {
    const consumedAt = new Date(Date.now() + index);
    return repository.consumeRuntimeDelegationReplay({
      issuer: sameIssuer,
      jti,
      consumedAt,
      expiresAt: new Date(consumedAt.getTime() + 60_000)
    });
  }));
  assert.equal(independentResults.every((result) => result === 'CONSUMED'), true);
  assert.equal(await collection.countDocuments({ issuer: sameIssuer }), 16);

  const sharedJti = randomUUID();
  const independentIssuers = Array.from({ length: 16 }, (_, index) => `issuer:independent:${index}`);
  const issuerResults = await Promise.all(independentIssuers.map((independentIssuer, index) => {
    const consumedAt = new Date(Date.now() + index);
    return repository.consumeRuntimeDelegationReplay({
      issuer: independentIssuer,
      jti: sharedJti,
      consumedAt,
      expiresAt: new Date(consumedAt.getTime() + 60_000)
    });
  }));
  assert.equal(issuerResults.every((result) => result === 'CONSUMED'), true);
  assert.equal(await collection.countDocuments({ jti: sharedJti }), 16);

  const invalidJti = randomUUID();
  const consumedAt = new Date();
  await assert.rejects(
    repository.consumeRuntimeDelegationReplay({
      issuer,
      jti: invalidJti,
      consumedAt,
      expiresAt: consumedAt
    }),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_RUNTIME_DELEGATION_REPLAY_INVALID'
  );
  assert.equal(await collection.countDocuments({ issuer, jti: invalidJti }), 0);
  return rounds;
}

async function proveStorageFailuresFailClosed(
  repository: SubscriptionsRepository,
  client: MongoClient,
  collection: Collection<ReplayDocument>
): Promise<void> {
  const failureIssuer = 'issuer:forced-storage-failure';
  await client.db(TEST_DATABASE).command({
    collMod: REPLAY_COLLECTION,
    validator: { issuer: { $ne: failureIssuer } },
    validationLevel: 'strict',
    validationAction: 'error'
  });
  const failedJti = randomUUID();
  const failedAt = new Date();
  const failedDocument = {
    issuer: failureIssuer,
    jti: failedJti,
    consumedAt: failedAt,
    expiresAt: new Date(failedAt.getTime() + 60_000)
  };
  await assert.rejects(
    repository.consumeRuntimeDelegationReplay(failedDocument),
    (error: unknown) => error instanceof MongoServerError && error.code === 121
  );
  assert.equal(await collection.countDocuments({ issuer: failureIssuer, jti: failedJti }), 0);
  await client.db(TEST_DATABASE).command({
    collMod: REPLAY_COLLECTION,
    validator: {},
    validationLevel: 'strict',
    validationAction: 'error'
  });
  assert.equal(await repository.consumeRuntimeDelegationReplay(failedDocument), 'CONSUMED');

  const unexpectedIssuer = 'issuer:unexpected-duplicate-index';
  const unexpectedConsumedAt = new Date(Date.now() + 1_000);
  await collection.insertOne({
    issuer: unexpectedIssuer,
    jti: randomUUID(),
    consumedAt: unexpectedConsumedAt,
    expiresAt: new Date(unexpectedConsumedAt.getTime() + 60_000)
  });
  const unexpectedIndex = 'subscription_runtime_delegation_unexpected_consumed_at_unique';
  await collection.createIndex(
    { consumedAt: 1 },
    {
      name: unexpectedIndex,
      unique: true,
      partialFilterExpression: { issuer: unexpectedIssuer }
    }
  );
  const unexpectedJti = randomUUID();
  await assert.rejects(
    repository.consumeRuntimeDelegationReplay({
      issuer: unexpectedIssuer,
      jti: unexpectedJti,
      consumedAt: unexpectedConsumedAt,
      expiresAt: new Date(unexpectedConsumedAt.getTime() + 60_000)
    }),
    (error: unknown) => error instanceof MongoServerError
      && error.code === 11000
      && error.message.includes(`index: ${unexpectedIndex} dup key:`)
  );
  assert.equal(await collection.countDocuments({ issuer: unexpectedIssuer, jti: unexpectedJti }), 0);
  await collection.dropIndex(unexpectedIndex);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function delegationToken(input: {
  privateKey: KeyObject;
  nowSeconds: number;
  jti: string;
  claimOverrides?: Record<string, unknown>;
  headerOverrides?: Record<string, unknown>;
}): string {
  const header = {
    alg: 'RS256',
    typ: 'phub-subscription-runtime-actor-delegation+jwt',
    kid: 'subscription-runtime-delegation-mongo-test-1',
    ...input.headerOverrides
  };
  const claims = {
    iss: 'https://api.padlhub.invalid/subscription-runtime-delegation',
    aud: 'urn:padlhub:ph-admin:subscription-runtime:v1',
    sub: '11111111-1111-4111-8111-111111111111',
    iat: input.nowSeconds,
    nbf: input.nowSeconds,
    exp: input.nowSeconds + 30,
    jti: input.jti,
    contract_version: 1,
    scope: 'subscription-runtime.quote',
    tenant_id: '86afbe01-0318-4dd2-bc25-303b7bf0d430',
    tenant_key: 'local-padel',
    sid: '22222222-2222-4222-8222-222222222222',
    provider: 'VIVA',
    provider_client_id: 'viva-profile:delegation-replay',
    provider_mapping_id: '33333333-3333-4333-8333-333333333333',
    action: quoteRequest.action,
    correlation_id: 'correlation:lk2:delegation:replay',
    request_sha256: computeSubscriptionRuntimeQuoteRequestHash(quoteRequest),
    idempotency_key_sha256: computeSubscriptionRuntimeIdempotencyKeyHash(
      'idempotency:lk2:delegation:replay'
    ),
    ...input.claimOverrides
  };
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = signValue(
    'RSA-SHA256',
    Buffer.from(signingInput, 'utf8'),
    input.privateKey
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function proveVerifierConcurrency(
  repository: SubscriptionsRepository,
  collection: Collection<ReplayDocument>
): Promise<{ winners: number; replays: number; invalidCases: number }> {
  const fixedNow = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const nowSeconds = Math.floor(fixedNow.getTime() / 1_000);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attackerKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const publicJwk = publicKey.export({ format: 'jwk' });
  const integrationToken = ['lk2', 'mongo', 'delegation', 'integration', 'test', '20260824'].join(':');
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN = integrationToken;
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER =
    'https://api.padlhub.invalid/subscription-runtime-delegation';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE =
    'urn:padlhub:ph-admin:subscription-runtime:v1';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON = JSON.stringify({
    keys: [{
      ...publicJwk,
      kid: 'subscription-runtime-delegation-mongo-test-1',
      alg: 'RS256',
      use: 'sig'
    }]
  });
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS = '60';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS = '5';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_REPLAY_RETENTION_SECONDS = '300';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON = JSON.stringify({
    'local-padel': {
      lk2TenantId: '86afbe01-0318-4dd2-bc25-303b7bf0d430',
      runtimeTenantId: 'tenant:delegation-replay'
    }
  });
  process.env.SUBSCRIPTIONS_RUNTIME_TENANT_ID = 'tenant:delegation-replay';

  class FixedNowVerifier extends SubscriptionRuntimeLk2DelegationVerifierService {
    protected override now(): Date {
      return new Date(fixedNow);
    }
  }
  const verifier = new FixedNowVerifier(repository);
  const verify = (actorDelegation: string) => verifier.verify({
    actorDelegation,
    integrationToken,
    request: quoteRequest,
    correlationId: 'correlation:lk2:delegation:replay',
    idempotencyKey: 'idempotency:lk2:delegation:replay',
    contractVersion: '1'
  });
  const validToken = (jti: string) => delegationToken({ privateKey, nowSeconds, jti });

  const parallelJti = randomUUID();
  const parallelToken = validToken(parallelJti);
  const parallel = await Promise.allSettled(
    Array.from({ length: 32 }, () => verify(parallelToken))
  );
  const winners = parallel.filter((result) => result.status === 'fulfilled');
  const replayed = parallel.filter((result) => result.status === 'rejected'
    && exceptionCode(result.reason) === 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_REPLAYED');
  assert.equal(winners.length, 1);
  assert.equal(replayed.length, 31);
  const actor = winners[0].status === 'fulfilled' ? winners[0].value : null;
  assert.deepEqual(actor, {
    source: 'LK2_DELEGATION',
    runtimeTenantId: 'tenant:delegation-replay',
    actorUserId: '11111111-1111-4111-8111-111111111111',
    provider: 'VIVA',
    providerClientId: 'viva-profile:delegation-replay',
    evidenceRef: actor?.evidenceRef,
    verifiedAt: fixedNow.toISOString()
  });
  assert.match(String(actor?.evidenceRef), /^evidence:lk2-delegation:[a-f0-9]{64}$/);
  assert.equal(await collection.countDocuments({
    issuer: process.env.SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER,
    jti: parallelJti
  }), 1);
  const parallelMarker = await collection.findOne({ jti: parallelJti });
  assert.ok(parallelMarker);
  assert.equal(
    parallelMarker.expiresAt.getTime(),
    (nowSeconds + 330) * 1000,
    'replay marker must not become TTL-eligible at token expiry'
  );

  const invalidCases: Array<{
    name: string;
    jti: string;
    invalidToken: string;
    code: string;
  }> = [];
  const addInvalid = (
    name: string,
    options: {
      signingKey?: KeyObject;
      claimOverrides?: Record<string, unknown>;
      headerOverrides?: Record<string, unknown>;
      code?: string;
    }
  ) => {
    const jti = randomUUID();
    invalidCases.push({
      name,
      jti,
      invalidToken: delegationToken({
        privateKey: options.signingKey ?? privateKey,
        nowSeconds,
        jti,
        claimOverrides: options.claimOverrides,
        headerOverrides: options.headerOverrides
      }),
      code: options.code ?? 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_INVALID'
    });
  };
  addInvalid('invalid signature', { signingKey: attackerKey });
  addInvalid('unknown kid', { headerOverrides: { kid: 'unknown-delegation-key' } });
  addInvalid('wrong issuer', { claimOverrides: { iss: 'https://attacker.invalid/issuer' } });
  addInvalid('wrong audience', { claimOverrides: { aud: 'urn:wrong-audience' } });
  addInvalid('expired token', {
    claimOverrides: { iat: nowSeconds - 30, nbf: nowSeconds - 30, exp: nowSeconds - 1 }
  });
  addInvalid('future nbf and iat', {
    claimOverrides: { iat: nowSeconds + 6, nbf: nowSeconds + 6, exp: nowSeconds + 30 }
  });
  addInvalid('wrong tenant binding', {
    claimOverrides: { tenant_id: '99999999-9999-4999-8999-999999999999' },
    code: 'SUBSCRIPTIONS_RUNTIME_DELEGATION_TENANT_UNMAPPED'
  });
  addInvalid('wrong request digest', {
    claimOverrides: { request_sha256: `sha256:${'0'.repeat(64)}` }
  });
  addInvalid('wrong correlation id', {
    claimOverrides: { correlation_id: 'correlation:lk2:wrong' }
  });
  addInvalid('wrong idempotency digest', {
    claimOverrides: { idempotency_key_sha256: `sha256:${'1'.repeat(64)}` }
  });
  addInvalid('wrong action', { claimOverrides: { action: 'CREATE_GAME' } });

  for (const invalidCase of invalidCases) {
    await expectCode(verify(invalidCase.invalidToken), invalidCase.code);
    assert.equal(
      await collection.countDocuments({ jti: invalidCase.jti }),
      0,
      `${invalidCase.name} must not burn its jti`
    );
    const correct = validToken(invalidCase.jti);
    const accepted = await verify(correct);
    assert.equal(accepted.actorUserId, '11111111-1111-4111-8111-111111111111');
    assert.equal(await collection.countDocuments({ jti: invalidCase.jti }), 1);
    await expectCode(verify(correct), 'SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_REPLAYED');
  }

  return { winners: winners.length, replays: replayed.length, invalidCases: invalidCases.length };
}

async function proveWrongIndexSpecificationFails(
  collection: Collection<ReplayDocument>
): Promise<void> {
  await collection.dropIndex(UNIQUE_INDEX);
  await collection.createIndex(
    { jti: 1, issuer: 1 },
    { name: UNIQUE_INDEX, unique: true }
  );
  const repository = new SubscriptionsRepository();
  try {
    await assert.rejects(
      repository.connectReadOnly(),
      (error: unknown) => String(error).includes(
        `SUBSCRIPTIONS_RUNTIME_INDEXES_NOT_READY:${UNIQUE_INDEX}`
      )
    );
  } finally {
    await repository.close();
  }
}

async function main(): Promise<void> {
  assertSafeTarget();
  process.env.NODE_ENV = 'test';
  process.env.SUBSCRIPTIONS_MONGODB_URI = TEST_URI;
  process.env.SUBSCRIPTIONS_MONGODB_DB = TEST_DATABASE;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED = 'false';
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'false';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'false';
  process.env.SUBSCRIPTIONS_INDEX_APPLY = 'CONFIRM';

  let repository: SubscriptionsRepository | undefined;
  let client: MongoClient | undefined;
  try {
    runIndexCommand('subscriptions:indexes:apply');
    await createEmptyReplayCollection();
    process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED = 'true';
    const missingIndexRepository = new SubscriptionsRepository();
    try {
      await assert.rejects(
        missingIndexRepository.connectReadOnly(),
        (error: unknown) => {
          const message = String(error);
          return message.includes('SUBSCRIPTIONS_RUNTIME_INDEXES_NOT_READY')
            && message.includes(UNIQUE_INDEX)
            && message.includes(TTL_INDEX);
        }
      );
    } finally {
      await missingIndexRepository.close();
    }

    runIndexCommand('subscriptions:indexes:apply');
    runIndexCommand('subscriptions:indexes:check');

    repository = new SubscriptionsRepository();
    await repository.connectReadOnly();
    client = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 10 });
    await client.connect();
    const collection = client.db(TEST_DATABASE).collection<ReplayDocument>(REPLAY_COLLECTION);
    assertExactReplayIndexes(await collection.listIndexes().toArray());

    const repositoryRounds = await proveRepositoryConcurrency(repository, collection);
    const verifier = await proveVerifierConcurrency(repository, collection);
    await proveStorageFailuresFailClosed(repository, client, collection);
    await proveWrongIndexSpecificationFails(collection);

    console.log(JSON.stringify({
      testDatabasePattern: TEST_DATABASE_PATTERN.source,
      indexApplyScope: 'EXACT_EPHEMERAL_DATABASE_ONLY',
      exactIndexReadiness: 'PROVEN',
      atomicUniqueness: 'PROVEN',
      repositoryRounds,
      verifier,
      replicaSetMajorityDurability: 'OUT_OF_SCOPE_OPEN'
    }));
  } finally {
    await repository?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
    await dropExactTestDatabase();
    restoreEnv();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
