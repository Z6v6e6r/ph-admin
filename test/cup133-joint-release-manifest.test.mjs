import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { MANIFEST_PATH, pendingInputs, verifyManifestConsistency, workerFilesDigest } from '../scripts/verify-cup133-joint-release-manifest.mjs';

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

test('joint release manifest is internally consistent', () => {
  assert.deepEqual(verifyManifestConsistency(manifest), []);
  assert.equal(manifest.components.lk1.ratingWorker.fileCount, 64);
  assert.equal(manifest.components.lk1.ratingWorker.filesDigest, 'c511b0e206fc048c1eed64df93b64575eba62fb620b36016e7790b7c19bdb1fc');
  assert.equal(manifest.components.cup.runtimeArtifact.runtimeManifest.sourceCommit, manifest.components.cup.commit);
});

test('a changed worker file, count or worker entry is detected', () => {
  const tampered = structuredClone(manifest);
  tampered.components.lk1.ratingWorker.workers[1].sha256 = '1'.repeat(64);
  assert.ok(verifyManifestConsistency(tampered).includes('worker entry scripts/game_result_rating_worker.mjs'));
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

test('frontend and graph are recorded; removing either reopens the release', () => {
  assert.deepEqual(pendingInputs(manifest), []);
  assert.equal(manifest.components.lk1.frontend.expected.files.length, 32);
  assert.equal(manifest.components.lk1.frontend.release.sourceCommit, manifest.components.lk1.commit);
  const reopened = structuredClone(manifest);
  reopened.components.lk1.frontend.status = 'REQUIRED_INPUT';
  reopened.nodeRedGraph.expected.finalSha256 = null;
  assert.deepEqual(pendingInputs(reopened), ['lk1.frontend', 'nodeRedGraph']);
  const tampered = structuredClone(manifest);
  tampered.components.lk1.frontend.release.sourceDirty = true;
  assert.ok(verifyManifestConsistency(tampered).includes('lk1 frontend'));
});
