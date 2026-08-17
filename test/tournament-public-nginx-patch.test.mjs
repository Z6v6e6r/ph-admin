import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCandidate,
  buildCandidate,
  createTournamentPublicNginxCandidate,
  sha256
} from '../scripts/patch-tournament-public-nginx.mjs';

const legacySource = `server {
    listen 443 ssl;

    location ^~ /api/tournaments/public/ {
        rewrite ^/api/tournaments/public/([^/?#]+)$ https://padlhub.ru/tournaments?slug=$1 permanent;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3000;
    }
}
`;

{
  const candidate = createTournamentPublicNginxCandidate(legacySource);
  assert.match(candidate, /BEGIN PHAB MANAGED PUBLIC TOURNAMENT ROUTES/);
  assert.ok(candidate.includes(
    'rewrite ^/api/tournaments/public/(?!list$|showcase$)([^/?#]+)$ https://padlhub.ru/tournaments?slug=$1 permanent;'
  ));
  assert.match(candidate, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(candidate, /Access-Control-Allow-Headers .*Authorization/);
  assert.equal(createTournamentPublicNginxCandidate(candidate), candidate);
}

assert.throws(
  () => createTournamentPublicNginxCandidate(legacySource.replace('permanent;', 'redirect;')),
  /differs from the audited preimage/
);
assert.throws(
  () => createTournamentPublicNginxCandidate(`${legacySource}\n${legacySource}`),
  /expected exactly one legacy public tournament location/
);

{
  const dir = mkdtempSync(join(tmpdir(), 'phab-public-nginx-'));
  const sourcePath = join(dir, 'padlhub.su');
  const candidatePath = join(dir, 'padlhub.su.candidate');
  const backupPath = join(dir, 'padlhub.su.backup');
  writeFileSync(sourcePath, legacySource);
  const built = buildCandidate({
    sourcePath,
    outputPath: candidatePath,
    expectedSourceSha256: sha256(legacySource)
  });
  assert.equal(built.changed, true);
  assert.equal(built.candidateSha256, sha256(readFileSync(candidatePath)));
  const applied = applyCandidate({
    sourcePath,
    candidatePath,
    backupPath,
    expectedSourceSha256: built.sourceSha256,
    expectedCandidateSha256: built.candidateSha256
  });
  assert.equal(applied.candidateSha256, sha256(readFileSync(sourcePath)));
  assert.equal(readFileSync(backupPath, 'utf8'), legacySource);
}

{
  const dir = mkdtempSync(join(tmpdir(), 'phab-public-nginx-race-'));
  const sourcePath = join(dir, 'padlhub.su');
  const candidatePath = join(dir, 'candidate.conf');
  const backupPath = join(dir, 'padlhub.su.backup');
  writeFileSync(sourcePath, legacySource);
  const built = buildCandidate({
    sourcePath,
    outputPath: candidatePath,
    expectedSourceSha256: sha256(legacySource)
  });
  const driftedSource = `${legacySource}\n# concurrent deploy\n`;
  assert.throws(
    () => applyCandidate({
      sourcePath,
      candidatePath,
      backupPath,
      expectedSourceSha256: built.sourceSha256,
      expectedCandidateSha256: built.candidateSha256,
      beforeReplace() {
        writeFileSync(sourcePath, driftedSource);
      }
    }),
    /drifted before replace/
  );
  assert.equal(readFileSync(sourcePath, 'utf8'), driftedSource);
  assert.equal(readFileSync(backupPath, 'utf8'), legacySource);
}

{
  const dir = mkdtempSync(join(tmpdir(), 'phab-public-nginx-unsafe-'));
  const sourcePath = join(dir, 'padlhub.su');
  const candidatePath = join(dir, 'candidate.conf');
  const foreignBackupPath = join(tmpdir(), `padlhub.su.backup-${process.pid}`);
  writeFileSync(sourcePath, legacySource);
  assert.throws(
    () => buildCandidate({
      sourcePath,
      outputPath: sourcePath,
      expectedSourceSha256: sha256(legacySource)
    }),
    /must differ from the source/
  );
  const built = buildCandidate({
    sourcePath,
    outputPath: candidatePath,
    expectedSourceSha256: sha256(legacySource)
  });
  assert.throws(
    () => applyCandidate({
      sourcePath,
      candidatePath,
      backupPath: foreignBackupPath,
      expectedSourceSha256: built.sourceSha256,
      expectedCandidateSha256: built.candidateSha256
    }),
    /must be a sibling/
  );
}

{
  const dir = mkdtempSync(join(tmpdir(), 'phab-public-nginx-link-'));
  const realPath = join(dir, 'real.conf');
  const linkedPath = join(dir, 'linked.conf');
  const candidatePath = join(dir, 'candidate.conf');
  writeFileSync(realPath, legacySource);
  symlinkSync(realPath, linkedPath);
  assert.throws(
    () => buildCandidate({
      sourcePath: linkedPath,
      outputPath: candidatePath,
      expectedSourceSha256: sha256(legacySource)
    }),
    /regular non-symlink file/
  );
}

console.log('Tournament public nginx patch test passed');
