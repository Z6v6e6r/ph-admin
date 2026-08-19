import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildSyntheticCanonicalTargetSnapshot,
  syntheticProjectionTargetFingerprint,
  SubscriptionSyntheticCanonicalProjectionService
} from '../src/subscriptions/subscription-synthetic-canonical-projection.service';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['--target-fingerprint', '--check', '--apply'].includes(mode)) {
    throw new Error('Usage: --target-fingerprint, --check or --apply');
  }
  if (mode === '--target-fingerprint') {
    console.log(JSON.stringify({
      targetSha256: syntheticProjectionTargetFingerprint(),
      write: false
    }));
    return;
  }
  const fixturePath = String(
    process.env.SUBSCRIPTIONS_SYNTHETIC_PROJECTION_FIXTURE ?? ''
  ).trim();
  if (!fixturePath) throw new Error('SUBSCRIPTIONS_SYNTHETIC_PROJECTION_FIXTURE is required');

  const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as unknown;
  const prepared = buildSyntheticCanonicalTargetSnapshot(fixture);

  if (mode === '--check') {
    console.log(JSON.stringify({
      status: 'VALID',
      write: false,
      snapshotId: prepared.snapshotId,
      tenantId: prepared.tenantId,
      targetId: prepared.targetId,
      action: prepared.action,
      revision: prepared.revision
    }));
  } else {
    const repository = new SubscriptionsRepository();
    try {
      const result = await new SubscriptionSyntheticCanonicalProjectionService(repository)
        .apply(fixture);
      console.log(JSON.stringify({ ...result, write: result.status === 'INSERTED' }));
    } finally {
      await repository.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
