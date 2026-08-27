import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REFERRAL_RELEASE_SCHEMA,
  buildReferralLinksRelease
} from '../scripts/build-referral-links-release.mjs';
import { verifyReferralLinksRelease } from '../scripts/verify-referral-links-release.mjs';

function errorCode(code) {
  return (error) => error?.code === code;
}

async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function fixtureRepository({ tamperPackage = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'referral-release-test-')));
  const repo = join(root, 'repo');
  await mkdir(join(repo, 'dist/client-sdk'), { recursive: true, mode: 0o700 });
  await writeFile(join(repo, 'dist/main.js'), 'console.log("synthetic-main");\n');
  await writeFile(
    join(repo, 'dist/client-sdk/phab-referral-links-admin.js'),
    'window.PhabReferralLinksAdmin={synthetic:true};\n'
  );
  await writeFile(join(repo, 'package.json'), JSON.stringify({
    name: 'synthetic-release',
    version: '1.0.0',
    scripts: { build: 'node build.mjs' }
  }));
  await writeFile(join(repo, 'package-lock.json'), JSON.stringify({
    name: 'synthetic-release',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'synthetic-release', version: '1.0.0' } }
  }));
  await writeFile(join(repo, 'build.mjs'), `
    import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
    mkdirSync('dist/client-sdk', { recursive: true });
    writeFileSync('dist/main.js', 'console.log("snapshot-build");\\n');
    writeFileSync('dist/client-sdk/phab-referral-links-admin.js', 'window.SnapshotBuild=true;\\n');
    ${tamperPackage ? "appendFileSync('package.json', ' ');" : ''}
  `);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'synthetic release'], { cwd: repo });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  return { root, repo, head, output: join(root, 'release-output') };
}

test('synthetic immutable referral release builds and verifies with activation disabled', async () => {
  const fixture = await fixtureRepository();
  try {
    const result = await buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head,
      now: new Date('2026-08-27T02:03:04.000Z')
    });
    assert.equal(result.schema, REFERRAL_RELEASE_SCHEMA);
    assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
    await chmod(result.archivePath, 0o600);
    const verified = await verifyReferralLinksRelease({
      archivePath: result.archivePath,
      expectedArchiveSha256: result.archiveSha256,
      expectedSourceCommit: fixture.head
    });
    assert.equal(verified.sourceCommit, fixture.head);
    assert.equal(verified.activationDefaults.REFERRAL_LINKS_ENABLED, false);
    assert.equal(verified.activationDefaults.REFERRAL_LINKS_AUTO_CREATE_INDEXES, false);
    assert.ok(verified.artifactCount >= 4);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release builder compiles from an exact private git snapshot', async () => {
  const fixture = await fixtureRepository();
  try {
    const result = await buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head
    });
    const verified = await verifyReferralLinksRelease({
      archivePath: result.archivePath,
      expectedArchiveSha256: result.archiveSha256,
      expectedSourceCommit: fixture.head
    });
    assert.equal(verified.sourceCommit, fixture.head);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release builder rejects package metadata changed by the build', async () => {
  const fixture = await fixtureRepository({ tamperPackage: true });
  try {
    await assert.rejects(() => buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head
    }), errorCode('REFERRAL_RELEASE_PACKAGE_DRIFT'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release builder rejects dirty source and an output inside the repository', async () => {
  const fixture = await fixtureRepository();
  try {
    await assert.rejects(() => buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: join(fixture.repo, 'release-output'),
      expectedHead: fixture.head
    }), errorCode('REFERRAL_RELEASE_OUTPUT_INSIDE_REPOSITORY'));
    await writeFile(join(fixture.repo, 'untracked.txt'), 'dirty\n');
    await assert.rejects(() => buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head
    }), errorCode('REFERRAL_RELEASE_DIRTY_SOURCE'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release builder rejects writable and symlink output parents', async () => {
  const fixture = await fixtureRepository();
  try {
    const writableParent = join(fixture.root, 'writable-parent');
    await mkdir(writableParent, { mode: 0o700 });
    await chmod(writableParent, 0o777);
    await assert.rejects(() => buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: join(writableParent, 'release-output'),
      expectedHead: fixture.head
    }), errorCode('REFERRAL_RELEASE_OUTPUT_PARENT_UNSAFE'));

    const symlinkParent = join(fixture.root, 'symlink-parent');
    await symlink(fixture.root, symlinkParent);
    await assert.rejects(() => buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: join(symlinkParent, 'release-output'),
      expectedHead: fixture.head
    }), errorCode('REFERRAL_RELEASE_OUTPUT_PARENT_UNSAFE'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release verifier rejects a wrong archive digest', async () => {
  const fixture = await fixtureRepository();
  try {
    const result = await buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head
    });
    await assert.rejects(() => verifyReferralLinksRelease({
      archivePath: result.archivePath,
      expectedArchiveSha256: 'f'.repeat(64),
      expectedSourceCommit: fixture.head
    }), errorCode('REFERRAL_RELEASE_ARCHIVE_SHA256_MISMATCH'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('release verifier rejects a symlink artifact even when the archive digest is approved', async () => {
  const fixture = await fixtureRepository();
  try {
    const result = await buildReferralLinksRelease({
      repoRoot: fixture.repo,
      output: fixture.output,
      expectedHead: fixture.head
    });
    const tamperRoot = join(fixture.root, 'tamper');
    await mkdir(tamperRoot, { mode: 0o700 });
    execFileSync('/usr/bin/tar', ['-C', tamperRoot, '-xzf', result.archivePath]);
    const bundlePath = join(tamperRoot, result.releaseId, 'dist/client-sdk/phab-referral-links-admin.js');
    await rm(bundlePath);
    await symlink('../../package.json', bundlePath);
    const badArchive = join(fixture.root, 'symlink-release.tar.gz');
    execFileSync('/usr/bin/tar', ['-C', tamperRoot, '-czf', badArchive, result.releaseId]);
    await chmod(badArchive, 0o600);
    const badArchiveSha256 = await fileSha256(badArchive);
    await assert.rejects(() => verifyReferralLinksRelease({
      archivePath: badArchive,
      expectedArchiveSha256: badArchiveSha256,
      expectedSourceCommit: fixture.head
    }), errorCode('REFERRAL_RELEASE_MEMBER_TYPE_INVALID'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
