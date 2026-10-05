import { isDeepStrictEqual } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { Db, MongoClient } from 'mongodb';
import {
  buildSubscriptionInstanceProjectionPlan,
  subscriptionInstanceProjectionInputFingerprint,
  subscriptionInstanceProjectionTargetFingerprint
} from '../src/subscriptions/subscription-provider-instance-projector.service';
import { subscriptionPublicationHistoryMatchesResolution } from '../src/subscriptions/subscription-instance-policy-resolution';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';

const MAX_INPUT_BYTES = 1_048_576;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DEV_DATABASE_PATTERN = /^(?:dev|test)-[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;
const TOP_LEVEL_KEYS = [
  'schemaVersion', 'sourceMode', 'allowlistedClientSubscriptionIds', 'projectionInput'
] as const;
const FIXTURE_SENTINEL_ID = 'subscription_instance_dev_canary_fixture_sentinel:v1';
export const SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION =
  'subscription_instance_dev_canary_fixture_sentinels';
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

type CanaryInput = {
  schemaVersion: 1;
  sourceMode: 'DEV_EXACT_CLIENT_SUBSCRIPTION_CANARY';
  allowlistedClientSubscriptionIds: [string, string];
  projectionInput: Record<string, unknown>;
};

const fail = (code: string): never => {
  throw new SubscriptionRuntimeContractError(code);
};

const exactObject = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const object = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(object).sort()) !== JSON.stringify([...keys].sort())) fail(code);
  return object;
};

export function parseSubscriptionInstanceDevCanaryInput(input: unknown): CanaryInput {
  const value = exactObject(input, TOP_LEVEL_KEYS, 'SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_INVALID');
  if (value.schemaVersion !== 1
    || value.sourceMode !== 'DEV_EXACT_CLIENT_SUBSCRIPTION_CANARY') {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_INVALID');
  }
  if (!Array.isArray(value.allowlistedClientSubscriptionIds)
    || value.allowlistedClientSubscriptionIds.length !== 2
    || value.allowlistedClientSubscriptionIds.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))
    || new Set(value.allowlistedClientSubscriptionIds).size !== 2) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ALLOWLIST_INVALID');
  }
  const projectionInput = exactObject(
    value.projectionInput,
    [
      'schemaVersion', 'sourceMode', 'evidenceStatus', 'approvalRef', 'tenantId', 'provider',
      'providerProductId', 'providerScope', 'binding', 'producer', 'authority', 'snapshot', 'records'
    ],
    'SUBSCRIPTIONS_INSTANCE_DEV_CANARY_PROJECTION_INPUT_INVALID'
  );
  subscriptionInstanceProjectionInputFingerprint(projectionInput, 'DEV_EXACT_ALLOWLIST');
  const records = projectionInput.records;
  if (!Array.isArray(records) || records.length !== 2) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ALLOWLIST_INVALID');
  }
  const recordIds = (records as unknown[]).map((record: unknown) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_PROJECTION_INPUT_INVALID');
    }
    return String((record as Record<string, unknown>).clientSubscriptionId ?? '');
  }).sort();
  const allowlist = [...value.allowlistedClientSubscriptionIds as string[]].sort();
  if (!isDeepStrictEqual(recordIds, allowlist)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ALLOWLIST_MISMATCH');
  }
  return {
    schemaVersion: 1,
    sourceMode: 'DEV_EXACT_CLIENT_SUBSCRIPTION_CANARY',
    allowlistedClientSubscriptionIds: value.allowlistedClientSubscriptionIds as [string, string],
    projectionInput
  };
}

export function assertSubscriptionInstanceDevCanaryBoundary(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
  apply = true
): { input: CanaryInput; targetSha256: string; database: string; uri: string } {
  const target = subscriptionInstanceDevCanaryTarget(env);
  if (String(env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_SHA256 ?? '').trim()
    !== target.targetSha256) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_ATTESTATION_MISMATCH');
  }
  if (apply && String(env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_APPLY_CONFIRM ?? '').trim()
    !== 'APPLY_EXACTLY_TWO_DEV_SUBSCRIPTION_INSTANCES') {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_CONFIRM_REQUIRED');
  }
  const parsed = parseSubscriptionInstanceDevCanaryInput(input);
  return { input: parsed, ...target };
}

export function subscriptionInstanceDevCanaryTarget(
  env: NodeJS.ProcessEnv = process.env
): { targetSha256: string; database: string; uri: string } {
  if (!['development', 'test'].includes(String(env.NODE_ENV ?? '').trim())) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ENVIRONMENT_FORBIDDEN');
  }
  const serviceId = String(env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_ID ?? '').trim();
  if (!/^(?:dev|test)-[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/.test(serviceId)
    || /(?:prod|live|shared)/i.test(serviceId)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_FORBIDDEN');
  }
  const database = String(env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  const uri = String(env.SUBSCRIPTIONS_MONGODB_URI ?? env.MONGODB_URI ?? '').trim();
  if (!DEV_DATABASE_PATTERN.test(database)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_DATABASE_FORBIDDEN');
  }
  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_FORBIDDEN');
  }
  if (parsedUri!.protocol !== 'mongodb:'
    || parsedUri!.username !== ''
    || parsedUri!.password !== ''
    || parsedUri!.pathname !== '/'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedUri!.hostname)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_FORBIDDEN');
  }
  const targetSha256 = subscriptionInstanceProjectionTargetFingerprint(uri, database);
  if (!['0', 'false', 'no'].includes(
    String(env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES ?? '').trim().toLowerCase()
  )) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_AUTO_INDEX_FALSE_REQUIRED');
  }
  subscriptionInstanceDevCanaryFixtureSentinel(env, { targetSha256, database });
  return { targetSha256, database, uri };
}

export function subscriptionInstanceDevCanaryFixtureSentinel(
  env: NodeJS.ProcessEnv,
  target: { targetSha256: string; database: string }
) {
  const fixtureId = String(env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ID ?? '').trim();
  const nonceSha256 = String(
    env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_NONCE_SHA256 ?? ''
  ).trim();
  if (!/^fixture:(?:dev|test):[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(fixtureId)
    || !DIGEST_PATTERN.test(nonceSha256)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ATTESTATION_REQUIRED');
  }
  return {
    _id: FIXTURE_SENTINEL_ID,
    schemaVersion: 1,
    custody: 'LOCAL_EPHEMERAL_FIXTURE',
    fixtureId,
    targetSha256: target.targetSha256,
    database: target.database,
    nonceSha256
  } as const;
}

export async function assertSubscriptionInstanceDevCanaryFixtureCustody(
  db: Db,
  env: NodeJS.ProcessEnv,
  target: { targetSha256: string; database: string }
): Promise<void> {
  const hello = await db.admin().command({ hello: 1 });
  const replicaSetConfig = await db.admin().command({ replSetGetConfig: 1 });
  assertSubscriptionInstanceDevCanaryReplicaSetTopology(hello, replicaSetConfig);
  const expected = subscriptionInstanceDevCanaryFixtureSentinel(env, target);
  const actual = await db.collection<typeof expected>(
    SUBSCRIPTION_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_COLLECTION
  ).findOne({ _id: expected._id });
  if (!isDeepStrictEqual(actual, expected)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_SENTINEL_MISMATCH');
  }
}

export function assertSubscriptionInstanceDevCanaryReplicaSetTopology(
  hello: Record<string, unknown>,
  replicaSetConfig: Record<string, unknown>
): void {
  const hosts = Array.isArray(hello.hosts) ? hello.hosts : [];
  const config = replicaSetConfig.config;
  const members = config && typeof config === 'object' && !Array.isArray(config)
    && Array.isArray((config as Record<string, unknown>).members)
    ? (config as Record<string, unknown>).members as unknown[]
    : [];
  const configuredHost = members.length === 1
    && members[0] && typeof members[0] === 'object' && !Array.isArray(members[0])
    ? (members[0] as Record<string, unknown>).host
    : null;
  const loopbackHostPattern = /^(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]{2,5}$/;
  if (hello.isWritablePrimary !== true
    || hello.setName !== 'rs0'
    || hosts.length !== 1
    || hosts.some((host) => typeof host !== 'string'
      || !loopbackHostPattern.test(host))
    || typeof configuredHost !== 'string'
    || !loopbackHostPattern.test(configuredHost)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_TOPOLOGY_FORBIDDEN');
  }
}

async function readPrivateInput(): Promise<unknown> {
  const configured = String(process.env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT ?? '').trim();
  if (!configured || !isAbsolute(configured)) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_ABSOLUTE_PATH_REQUIRED');
  }
  const path = resolve(configured);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_INPUT_BYTES) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_FILE_INVALID');
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_FILE_PRIVATE_REQUIRED');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_FILE_OWNER_MISMATCH');
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_INPUT_JSON_INVALID');
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['--target-fingerprint', '--plan-fingerprint', '--check', '--apply'].includes(mode)) {
    fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_MODE_INVALID');
  }
  if (mode === '--target-fingerprint') {
    console.log(JSON.stringify({
      ...subscriptionInstanceDevCanaryTarget(),
      uri: undefined,
      database: undefined,
      write: false
    }));
    return;
  }
  const boundary = assertSubscriptionInstanceDevCanaryBoundary(
    await readPrivateInput(),
    process.env,
    mode === '--apply'
  );
  const binding = boundary.input.projectionInput.binding as Record<string, unknown>;
  const subscriptionTypeId = String(binding.subscriptionTypeId ?? '');
  const client = new MongoClient(boundary.uri, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 2 });
  try {
    await client.connect();
    const db = client.db(boundary.database);
    await assertSubscriptionInstanceDevCanaryFixtureCustody(db, process.env, boundary);
    const publications = await db.collection('subscription_policy_publications')
      .find({ subscriptionTypeId }, { projection: { _id: 0 } })
      .sort({ effectiveAt: 1, publicationId: 1 })
      .toArray();
    const plan = buildSubscriptionInstanceProjectionPlan(
      boundary.input.projectionInput,
      process.env.SUBSCRIPTIONS_RUNTIME_HASH_PEPPER,
      publications as any,
      'DEV_EXACT_ALLOWLIST'
    );
    if (mode !== '--plan-fingerprint'
      && String(process.env.SUBSCRIPTIONS_INSTANCE_DEV_CANARY_PLAN_SHA256 ?? '').trim()
        !== plan.planSha256) {
      fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_PLAN_ATTESTATION_MISMATCH');
    }
    const allowlist = new Set(boundary.input.allowlistedClientSubscriptionIds);
    if (plan.instances.length !== 2
      || plan.instances.some((instance) => !allowlist.has(instance.clientSubscriptionId))) {
      fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ALLOWLIST_MISMATCH');
    }
    const runId = `subscription_instance_dev_canary:${plan.planSha256.slice(7)}`;
    const expectedInstances = plan.instances.map((instance) => ({
      _id: `${runId}:${instance.subscriptionInstanceId}`,
      runId,
      ...instance
    }));
    const expectedRun = {
      _id: runId,
      schemaVersion: 1,
      runId,
      sourceMode: boundary.input.sourceMode,
      targetSha256: boundary.targetSha256,
      planSha256: plan.planSha256,
      checkpoint: plan.checkpoint
    };
    const inspect = async (): Promise<'READY_TO_INSERT' | 'EXACT_REPLAY'> => {
      const runs = db.collection<any>('subscription_instance_dev_canary_runs');
      const instances = db.collection<any>('subscription_instance_dev_canary_instances');
      const existingRun = await runs.findOne({ _id: runId });
      const existingInstances = await instances.find({ runId })
        .sort({ subscriptionInstanceId: 1 }).toArray();
      if (!existingRun) {
        if (existingInstances.length !== 0) {
          fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_IMMUTABLE_CONFLICT');
        }
        return 'READY_TO_INSERT';
      }
      if (!isDeepStrictEqual(existingRun, expectedRun)
        || !isDeepStrictEqual(existingInstances, expectedInstances)) {
        fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_IMMUTABLE_CONFLICT');
      }
      return 'EXACT_REPLAY';
    };
    if (mode === '--plan-fingerprint') {
      console.log(JSON.stringify({
        status: 'PLAN_READY',
        write: false,
        sourceItemCount: 2,
        planSha256: plan.planSha256,
        targetSha256: boundary.targetSha256
      }));
      return;
    }
    if (mode === '--check') {
      console.log(JSON.stringify({
        status: await inspect(),
        write: false,
        sourceItemCount: 2,
        planSha256: plan.planSha256,
        targetSha256: boundary.targetSha256
      }));
      return;
    }
    const session = client.startSession();
    let status: 'INSERTED' | 'EXACT_REPLAY' | null = null;
    try {
      await session.withTransaction(async () => {
        const runs = db.collection<any>('subscription_instance_dev_canary_runs');
        const instances = db.collection<any>('subscription_instance_dev_canary_instances');
        const transactionPublications = await db.collection('subscription_policy_publications')
          .find({ subscriptionTypeId }, { projection: { _id: 0 }, session })
          .sort({ effectiveAt: 1, publicationId: 1 }).toArray();
        if (plan.checkpoint.schemaVersion !== 3
          || !plan.checkpoint.policyResolution
          || !subscriptionPublicationHistoryMatchesResolution(
            transactionPublications as any,
            plan.checkpoint.policyResolution
          )) {
          fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_POLICY_HISTORY_CONFLICT');
        }
        const existingRun = await runs.findOne({ _id: runId }, { session });
        const existingInstances = await instances.find(
          { runId }, { session }
        ).sort({ subscriptionInstanceId: 1 }).toArray();
        if (existingRun) {
          if (!isDeepStrictEqual(existingRun, expectedRun)
            || !isDeepStrictEqual(existingInstances, expectedInstances)) {
            fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_IMMUTABLE_CONFLICT');
          }
          status = 'EXACT_REPLAY';
          return;
        }
        if (existingInstances.length !== 0) {
          fail('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_IMMUTABLE_CONFLICT');
        }
        await instances.insertMany(structuredClone(expectedInstances) as any[], { ordered: true, session });
        await runs.insertOne(structuredClone(expectedRun) as any, { session });
        status = 'INSERTED';
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority', j: true },
        readPreference: 'primary'
      });
    } finally {
      await session.endSession();
    }
    console.log(JSON.stringify({
      status,
      write: status === 'INSERTED',
      sourceItemCount: 2,
      planSha256: plan.planSha256,
      targetSha256: boundary.targetSha256
    }));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : '';
    const code = error instanceof SubscriptionRuntimeContractError
      ? error.code
      : /^SUBSCRIPTIONS_INSTANCE_DEV_CANARY_[A-Z0-9_]+$/.test(message)
        ? message
        : 'SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
