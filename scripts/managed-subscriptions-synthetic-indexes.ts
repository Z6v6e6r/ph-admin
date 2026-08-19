import { spawnSync } from 'node:child_process';
import {
  assertSyntheticProjectionApplyBoundary
} from '../src/subscriptions/subscription-synthetic-canonical-projection.service';

function main(): void {
  const mode = process.argv[2];
  if (!['--check', '--apply'].includes(mode)) {
    throw new Error('Usage: --check or --apply');
  }

  assertSyntheticProjectionApplyBoundary();
  if (mode === '--apply' && process.env.SUBSCRIPTIONS_INDEX_APPLY !== 'CONFIRM') {
    throw new Error('SUBSCRIPTIONS_INDEX_APPLY_CONFIRM_REQUIRED');
  }

  const result = spawnSync(
    process.execPath,
    ['scripts/managed-subscriptions-indexes.mjs', mode],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
