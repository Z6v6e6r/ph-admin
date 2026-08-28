import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  subscriptionInstanceProjectionInputFingerprint,
  subscriptionInstanceProjectionTargetFingerprint,
  SubscriptionProviderInstanceProjectorService
} from '../src/subscriptions/subscription-provider-instance-projector.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const MAX_INPUT_BYTES = 1_048_576;

async function readPrivateInput(): Promise<unknown> {
  const configured = String(process.env.SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT ?? '').trim();
  if (!configured || !isAbsolute(configured)) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_ABSOLUTE_PATH_REQUIRED');
  }
  const path = resolve(configured);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_INPUT_BYTES) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_FILE_INVALID');
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_FILE_PRIVATE_REQUIRED');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_FILE_OWNER_MISMATCH');
  }
  return parseProjectorInputJson(await readFile(path, 'utf8'));
}

export function parseProjectorInputJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_INPUT_JSON_INVALID');
  }
}

export function safeProjectorErrorCode(error: unknown): string {
  if (error instanceof SubscriptionRuntimeContractError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return /^SUBSCRIPTIONS_INSTANCE_PROJECTOR_[A-Z0-9_]+$/.test(message)
    ? message
    : 'SUBSCRIPTIONS_INSTANCE_PROJECTOR_FAILED';
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['--input-fingerprint', '--target-fingerprint', '--check'].includes(mode)) {
    throw new Error('SUBSCRIPTIONS_INSTANCE_PROJECTOR_MODE_INVALID');
  }
  if (mode === '--target-fingerprint') {
    console.log(JSON.stringify({
      targetSha256: subscriptionInstanceProjectionTargetFingerprint(
        process.env.SUBSCRIPTIONS_MONGODB_URI ?? process.env.MONGODB_URI,
        process.env.SUBSCRIPTIONS_MONGODB_DB
      ),
      write: false
    }));
    return;
  }
  const input = await readPrivateInput();
  if (mode === '--input-fingerprint') {
    console.log(JSON.stringify({
      inputSha256: subscriptionInstanceProjectionInputFingerprint(input),
      write: false
    }));
    return;
  }
  const repository = new SubscriptionsRepository();
  try {
    const service = new SubscriptionProviderInstanceProjectorService(repository);
    const result = await service.check(input);
    console.log(JSON.stringify({
      status: result.status,
      write: result.write,
      sourceItemCount: result.sourceItemCount,
      inputSha256: result.inputSha256,
      planSha256: result.planSha256,
      checkpointId: result.checkpointId
    }));
  } finally {
    await repository.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(safeProjectorErrorCode(error));
    process.exitCode = 1;
  });
}
