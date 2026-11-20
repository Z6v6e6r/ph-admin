import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { MANIFEST_PATH, verifyManifestConsistency, workerFilesDigest } from '../scripts/verify-cup133-joint-release-manifest.mjs';

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

test('joint release manifest is internally consistent', () => {
  assert.deepEqual(verifyManifestConsistency(manifest), []);
  assert.equal(manifest.components.lk1.ratingWorker.fileCount, 64);
  assert.equal(manifest.components.lk1.ratingWorker.filesDigest, 'c511b0e206fc048c1eed64df93b64575eba62fb620b36016e7790b7c19bdb1fc');
});

test('a changed worker file or count is detected', () => {
  const tampered = structuredClone(manifest);
  tampered.components.lk1.ratingWorker.files[0].sha256 = '0'.repeat(64);
  assert.ok(verifyManifestConsistency(tampered).includes('worker filesDigest'));
  tampered.components.lk1.ratingWorker.files.pop();
  assert.ok(verifyManifestConsistency(tampered).includes('worker fileCount'));
});

test('the rejected 88b2e6c worker release cannot pass as the accepted digest', () => {
  const worker = manifest.components.lk1.ratingWorker;
  assert.notEqual(worker.rejectedRelease.filesDigest, worker.filesDigest);
  assert.equal(workerFilesDigest(worker.files), worker.filesDigest);
});
