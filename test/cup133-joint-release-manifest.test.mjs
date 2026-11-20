import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { MANIFEST_PATH, verifyManifestConsistency, workerFilesDigest } from '../scripts/verify-cup133-joint-release-manifest.mjs';

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

test('147 delivery manifest is internally consistent', () => {
  assert.deepEqual(verifyManifestConsistency(manifest), []);
  assert.equal(manifest.sources.lk1.commit, '09c83d4c7cc805813ef4ef863d6a546f9dacbd4e');
  assert.equal(manifest.sources.cup.commit, '15936d4f03334c099ce60bdf0b7499ef8c53535b');
  assert.equal(manifest.nodeRedGraph.finalSha256, '4823937c5b52ab0aca28aea249b28ce7deb169c705513c8ee06cac57c324327e');
  assert.equal(manifest.workers.cancellation.manifestSha256, '14ffe8e2b81639f1172e6dbb4946e49071b47ee152ef82d9a19988d9953b8f04');
  assert.equal(manifest.workers.rating.filesDigest, 'c511b0e206fc048c1eed64df93b64575eba62fb620b36016e7790b7c19bdb1fc');
});

test('the superseded 6604dd1d graph or a worker pinned to it is rejected', () => {
  const stale = structuredClone(manifest);
  stale.workers.cancellation.pinnedGraphSha256 = manifest.sources.lk1.supersedes.graphSha256;
  assert.ok(verifyManifestConsistency(stale).includes('cancellation worker'));
  const graph = structuredClone(manifest);
  graph.nodeRedGraph.finalSha256 = manifest.sources.lk1.supersedes.graphSha256;
  assert.ok(verifyManifestConsistency(graph).includes('nodeRedGraph'));
});

test('a changed rating worker file is detected', () => {
  const tampered = structuredClone(manifest);
  tampered.workers.rating.files[0].sha256 = '0'.repeat(64);
  assert.ok(verifyManifestConsistency(tampered).includes('rating worker filesDigest'));
  assert.equal(workerFilesDigest(manifest.workers.rating.files), manifest.workers.rating.filesDigest);
});

test('the widget pins verified production addresses and keeps /seliger out of tournament signup', () => {
  assert.equal(manifest.widget.files.length, 32);
  assert.equal(manifest.widget.publicAddresses.equalToServedProduction.allValuesPresent, true);
  assert.equal(Object.keys(manifest.widget.publicAddresses.values).length, 22);
  const tampered = structuredClone(manifest);
  tampered.widget.tournamentSignupAddresses.usesSeligerPath = true;
  assert.ok(verifyManifestConsistency(tampered).includes('widget'));
});
