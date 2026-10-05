import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  checkSubscriptionsDevMongoCustody,
  SubscriptionsDevMongoPreflightError
} from './managed-subscriptions-dev-mongo-preflight';

type CustodyCheck = typeof checkSubscriptionsDevMongoCustody;
type IndexRunner = (mode: '--check' | '--apply', env: NodeJS.ProcessEnv) => number;

export async function runSubscriptionsDevIndexes(
  mode: string,
  env: NodeJS.ProcessEnv = process.env,
  checkCustody: CustodyCheck = checkSubscriptionsDevMongoCustody,
  run: IndexRunner = (checkedMode, childEnv) => {
    const result = spawnSync(process.execPath, [
      resolve(__dirname, 'managed-subscriptions-indexes.mjs'), checkedMode
    ], { cwd: resolve(__dirname, '..'), env: childEnv, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
): Promise<number> {
  if (mode !== '--check' && mode !== '--apply') {
    throw new SubscriptionsDevMongoPreflightError('SUBSCRIPTIONS_DEV_INDEX_MODE_INVALID');
  }
  if (mode === '--apply' && env.SUBSCRIPTIONS_INDEX_APPLY !== 'CONFIRM') {
    throw new SubscriptionsDevMongoPreflightError('SUBSCRIPTIONS_DEV_INDEX_APPLY_CONFIRM_REQUIRED');
  }
  const custody = await checkCustody(env);
  if (custody.status !== 'CUSTODY_VERIFIED' || custody.replicaSet !== 'rs0'
    || custody.memberCount !== 1 || custody.sentinelVerified !== true || custody.write !== false
    || env.SUBSCRIPTIONS_INDEX_EXPECTED_DB !== custody.database
    || env.SUBSCRIPTIONS_INDEX_TARGET_SHA256 !== custody.targetSha256) {
    throw new SubscriptionsDevMongoPreflightError('SUBSCRIPTIONS_DEV_INDEX_TARGET_ATTESTATION_MISMATCH');
  }
  return run(mode, {
    ...env,
    SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false',
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_TEST_RUNTIME_ENABLED: 'false'
  });
}

if (require.main === module) {
  runSubscriptionsDevIndexes(process.argv[2]).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof SubscriptionsDevMongoPreflightError
      ? error.code : 'SUBSCRIPTIONS_DEV_INDEX_CHECK_FAILED');
    process.exitCode = 1;
  });
}
