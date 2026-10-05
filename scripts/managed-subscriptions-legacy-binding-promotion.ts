import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  buildSubscriptionLegacyBindingPromotionPlan,
  parseSubscriptionLegacyBindingPromotionManifest,
  subscriptionLegacyBindingPromotionInputFingerprint,
  subscriptionLegacyBindingPromotionIdentity,
  subscriptionLegacyBindingPromotionResult,
  subscriptionLegacyBindingPromotionTargetFingerprint,
  SubscriptionLegacyBindingPromotionResult,
  validateSubscriptionLegacyBindingPromotionAttestations
} from '../src/subscriptions/subscription-legacy-binding-promotion.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

const MAX_INPUT_BYTES = 65_536;

export async function readPrivateBindingPromotionManifest(): Promise<unknown> {
  const configured = String(process.env.SUBSCRIPTIONS_BINDING_PROMOTION_INPUT ?? '').trim();
  if (!configured || !isAbsolute(configured)) {
    throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_ABSOLUTE_PATH_REQUIRED');
  }
  const path = resolve(configured);
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 2 || info.size > MAX_INPUT_BYTES) {
      throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_INVALID');
    }
    if ((info.mode & 0o077) !== 0) {
      throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_PRIVATE_REQUIRED');
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_OWNER_MISMATCH');
    }
    return parseBindingPromotionInputJson(await handle.readFile('utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ELOOP') {
      throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_FILE_INVALID');
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function parseBindingPromotionInputJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_INPUT_JSON_INVALID');
  }
}

export function safeBindingPromotionErrorCode(error: unknown): string {
  if (error instanceof SubscriptionRuntimeContractError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return /^SUBSCRIPTIONS_BINDING_PROMOTION_[A-Z0-9_]+$/.test(message)
    ? message
    : 'SUBSCRIPTIONS_BINDING_PROMOTION_FAILED';
}

export function sanitizedBindingPromotionOutput(result: SubscriptionLegacyBindingPromotionResult) {
  return {
    status: result.status,
    write: result.write,
    promotionId: result.promotionId,
    subscriptionTypeId: result.subscriptionTypeId,
    providerProductId: result.providerProductId,
    publicationId: result.publicationId,
    mappingId: result.mappingId,
    releaseProgramId: result.releaseProgramId,
    releasePhaseId: result.releasePhaseId,
    sourceItemCount: result.sourceItemCount,
    rejectedItemCount: result.rejectedItemCount,
    duplicateIdentityCount: result.duplicateIdentityCount,
    inputSha256: result.inputSha256,
    planSha256: result.planSha256,
    targetSha256: result.targetSha256
  };
}

function targetFingerprint(): `sha256:${string}` {
  return subscriptionLegacyBindingPromotionTargetFingerprint(
    process.env.SUBSCRIPTIONS_MONGODB_URI ?? process.env.MONGODB_URI,
    process.env.SUBSCRIPTIONS_MONGODB_DB
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (![
    '--input-fingerprint', '--plan-fingerprint', '--target-fingerprint', '--check', '--apply'
  ].includes(mode)) {
    throw new Error('SUBSCRIPTIONS_BINDING_PROMOTION_MODE_INVALID');
  }
  if (mode === '--target-fingerprint') {
    console.log(JSON.stringify({ targetSha256: targetFingerprint(), write: false }));
    return;
  }
  const input = await readPrivateBindingPromotionManifest();
  if (mode === '--input-fingerprint') {
    console.log(JSON.stringify({
      inputSha256: subscriptionLegacyBindingPromotionInputFingerprint(input),
      write: false
    }));
    return;
  }
  const manifest = parseSubscriptionLegacyBindingPromotionManifest(input);
  const actualTargetSha256 = targetFingerprint();
  if (manifest.targetSha256 !== actualTargetSha256) {
    throw new SubscriptionRuntimeContractError(
      'SUBSCRIPTIONS_BINDING_PROMOTION_TARGET_ATTESTATION_MISMATCH'
    );
  }
  const database = String(process.env.SUBSCRIPTIONS_MONGODB_DB ?? '').trim();
  if (mode === '--apply') {
    // This pass validates every non-plan gate before opening a writable connection.
    // The real derived plan hash is checked again after the read-only planning phase.
    validateSubscriptionLegacyBindingPromotionAttestations({
      env: process.env,
      manifest,
      planSha256: String(process.env.SUBSCRIPTIONS_BINDING_PROMOTION_PLAN_SHA256 ?? '') as `sha256:${string}`,
      actualTargetSha256,
      database,
      requireApplyConfirm: true
    });
  }
  const repository = new SubscriptionsRepository();
  try {
    if (mode === '--apply') await repository.connect();
    else await repository.connectReadOnly();
    const identity = subscriptionLegacyBindingPromotionIdentity(manifest);
    const snapshot = await repository.legacyBindingPromotionSnapshot(identity);
    const plan = buildSubscriptionLegacyBindingPromotionPlan(input, snapshot);
    if (mode === '--plan-fingerprint') {
      console.log(JSON.stringify({
        status: plan.status,
        inputSha256: plan.manifest.inputSha256,
        planSha256: plan.planSha256,
        targetSha256: plan.manifest.targetSha256,
        write: false
      }));
      return;
    }
    validateSubscriptionLegacyBindingPromotionAttestations({
      env: process.env,
      manifest: plan.manifest,
      planSha256: plan.planSha256,
      actualTargetSha256,
      database,
      requireApplyConfirm: mode === '--apply'
    });
    if (mode === '--apply') {
      const status = await repository.applyLegacyBindingPromotion(plan);
      console.log(JSON.stringify(sanitizedBindingPromotionOutput(
        subscriptionLegacyBindingPromotionResult(plan, status, status === 'PROMOTED')
      )));
      return;
    }
    const status = await repository.preflightLegacyBindingPromotion(plan);
    console.log(JSON.stringify(sanitizedBindingPromotionOutput(
      subscriptionLegacyBindingPromotionResult(plan, status, false)
    )));
  } finally {
    await repository.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(safeBindingPromotionErrorCode(error));
    process.exitCode = 1;
  });
}
