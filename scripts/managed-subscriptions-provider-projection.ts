import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildProviderCanonicalTargetSnapshot,
  providerProjectionInputFingerprint
} from '../src/subscriptions/subscription-provider-canonical-projection.service';

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['--input-fingerprint', '--check'].includes(mode)) {
    throw new Error('Usage: --input-fingerprint or --check');
  }
  const inputPath = String(
    process.env.SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT ?? ''
  ).trim();
  if (!inputPath) {
    throw new Error('SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT is required');
  }
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as unknown;
  const inputSha256 = providerProjectionInputFingerprint(input);
  if (mode === '--input-fingerprint') {
    console.log(JSON.stringify({ inputSha256, write: false }));
    return;
  }
  const snapshot = buildProviderCanonicalTargetSnapshot(input);
  console.log(JSON.stringify({
    status: 'VALID',
    write: false,
    inputSha256,
    snapshotId: snapshot.snapshotId,
    action: snapshot.action,
    revision: snapshot.revision
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
