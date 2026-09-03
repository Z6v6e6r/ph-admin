import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEV_RELEASE_SCHEMA, DEV_RELEASE_TARGET, createDeterministicTarGzip, releaseIdentity
} from '../scripts/build-backend-release-attestation.mjs';
import { verifySubscriptionsDevRelease } from '../scripts/verify-subscriptions-dev-release.mjs';

const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const errorCode = (code) => (error) => error?.code === code;

async function fixture(mutator) {
  const base = await mkdtemp(join(tmpdir(), 'subscriptions-dev-release-'));
  const rootName = releaseIdentity(DEV_RELEASE_TARGET, commit, 'subscriptions-dev').rootName;
  const root = join(base, rootName);
  const files = {
    'dist/main.js': Buffer.from('console.log("ok");\n'),
    'package.json': Buffer.from('{"name":"fixture"}\n'),
    'package-lock.json': Buffer.from('{"lockfileVersion":3}\n'),
    'client-sdk/file.js': Buffer.from('window.fixture=true;\n'),
    'node_modules/pkg/index.js': Buffer.from('export default true;\n')
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), body);
  }
  const runtimeFiles = Object.entries(files).map(([path, body]) => ({
    path, bytes: body.length, sha256: sha256(body)
  })).sort((left, right) => left.path.localeCompare(right.path));
  const targetSha256 = sha256(JSON.stringify(DEV_RELEASE_TARGET));
  const manifest = {
    schema: DEV_RELEASE_SCHEMA,
    repository: DEV_RELEASE_TARGET.repository,
    component: DEV_RELEASE_TARGET.component,
    sourceCommit: commit,
    sourceTree: tree,
    sourceTrustedRef: 'refs/remotes/origin/main',
    sourceCommitTime: '2026-09-03T00:00:00.000Z',
    sourceDirty: false,
    serviceName: DEV_RELEASE_TARGET.serviceName,
    profile: 'subscriptions-dev',
    target: DEV_RELEASE_TARGET,
    targetSha256,
    builderSourceCommit: commit,
    activationAuthorized: false,
    buildCommand: DEV_RELEASE_TARGET.buildCommand,
    entrypoint: DEV_RELEASE_TARGET.entrypoint,
    nodeVersion: DEV_RELEASE_TARGET.nodeVersion,
    npmVersion: DEV_RELEASE_TARGET.npmVersion,
    packageLockSha256: sha256(files['package-lock.json']),
    format: 'tar.gz',
    artifactScan: {
      regularFiles: 5, textFilesScanned: 5, binaryFilesSkipped: 0,
      secretMatches: 0, piiMatches: 0, piiScope: 'first-party-code'
    },
    runtimeFileCount: runtimeFiles.length,
    runtimeFiles
  };
  if (mutator) await mutator({ base, root, rootName, files, manifest });
  if (!await readFile(join(root, 'release-manifest.json')).catch(() => null)) {
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  }
  const archive = join(base, 'release.tar.gz');
  execFileSync('/usr/bin/tar', ['-C', base, '-czf', archive, rootName]);
  await chmod(archive, 0o600);
  return { base, archive, archiveSha256: sha256(await readFile(archive)) };
}

async function verify(item, overrides = {}) {
  return verifySubscriptionsDevRelease({
    archivePath: item.archive,
    expectedArchiveSha256: item.archiveSha256,
    expectedSourceCommit: commit,
    expectedSourceTree: tree,
    trustedSourceIdentity: () => ({ commit, tree }),
    ...overrides
  });
}

test('verifies exact subscriptions DEV archive and inventory', async () => {
  const item = await fixture();
  try {
    const result = await verify(item);
    assert.equal(result.sourceCommit, commit);
    assert.equal(result.sourceTree, tree);
    assert.equal(result.activationAuthorized, false);
    assert.equal(result.serviceName, DEV_RELEASE_TARGET.serviceName);
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(result.runtimeInventorySha256, /^[a-f0-9]{64}$/);
  } finally { await rm(item.base, { recursive: true, force: true }); }
});

test('rejects archive, source, tree, target, activation and inventory drift', async () => {
  const good = await fixture();
  try {
    await assert.rejects(() => verify(good, { expectedArchiveSha256: 'f'.repeat(64) }),
      errorCode('SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_SHA256_MISMATCH'));
    await assert.rejects(() => verify(good, {
      trustedSourceIdentity: () => ({ commit: 'c'.repeat(40), tree })
    }), errorCode('SUBSCRIPTIONS_DEV_RELEASE_TRUSTED_REF_MISMATCH'));
    await assert.rejects(() => verify(good, {
      expectedSourceCommit: 'c'.repeat(40),
      trustedSourceIdentity: () => ({ commit: 'c'.repeat(40), tree })
    }),
      errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_PATH_INVALID'));
    await assert.rejects(() => verify(good, {
      expectedSourceTree: 'c'.repeat(40),
      trustedSourceIdentity: () => ({ commit, tree: 'c'.repeat(40) })
    }),
      errorCode('SUBSCRIPTIONS_DEV_RELEASE_MANIFEST_MISMATCH'));
  } finally { await rm(good.base, { recursive: true, force: true }); }
  for (const mutate of [
    (manifest) => { manifest.target = { ...manifest.target, apiOrigin: 'http://127.0.0.1:3037' }; },
    (manifest) => { manifest.activationAuthorized = true; },
    (manifest) => { manifest.runtimeFiles[0].sha256 = '0'.repeat(64); },
    (manifest) => { manifest.runtimeFiles.push({ ...manifest.runtimeFiles[0] }); }
  ]) {
    const item = await fixture(async ({ root, manifest }) => {
      mutate(manifest);
      await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
    });
    try { await assert.rejects(() => verify(item)); }
    finally { await rm(item.base, { recursive: true, force: true }); }
  }
});

test('rejects extra, symlink and path traversal archive members', async () => {
  const extra = await fixture(async ({ root }) => writeFile(join(root, 'extra.txt'), 'extra'));
  try {
    await assert.rejects(() => verify(extra), errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_SET_INVALID'));
  } finally { await rm(extra.base, { recursive: true, force: true }); }

  const linked = await fixture(async ({ root }) => {
    await rm(join(root, 'client-sdk/file.js'));
    await symlink('../package.json', join(root, 'client-sdk/file.js'));
  });
  try {
    await assert.rejects(() => verify(linked), errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_TYPE_INVALID'));
  } finally { await rm(linked.base, { recursive: true, force: true }); }

  const traversed = await fixture();
  try {
    const rootName = releaseIdentity(DEV_RELEASE_TARGET, commit, 'subscriptions-dev').rootName;
    await writeFile(traversed.archive, await createDeterministicTarGzip(
      join(traversed.base, rootName), '../escape', 1
    ));
    await chmod(traversed.archive, 0o600);
    traversed.archiveSha256 = sha256(await readFile(traversed.archive));
    await assert.rejects(() => verify(traversed), errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_PATH_INVALID'));
  } finally { await rm(traversed.base, { recursive: true, force: true }); }
});

test('rejects unsafe archive input, missing or altered files and extraction limits', async () => {
  const good = await fixture();
  try {
    await assert.rejects(() => verify(good, { archivePath: 'release.tar.gz' }),
      errorCode('SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_NOT_ABSOLUTE'));
    await chmod(good.archive, 0o644);
    await assert.rejects(() => verify(good), errorCode('SUBSCRIPTIONS_DEV_RELEASE_ARCHIVE_UNSAFE'));
    await chmod(good.archive, 0o600);
    await assert.rejects(() => verify(good, { maxMemberBytes: 1 }),
      errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_LIMIT_EXCEEDED'));
  } finally { await rm(good.base, { recursive: true, force: true }); }

  const missing = await fixture(async ({ root }) => rm(join(root, 'client-sdk/file.js')));
  try {
    await assert.rejects(() => verify(missing), errorCode('SUBSCRIPTIONS_DEV_RELEASE_MEMBER_SET_INVALID'));
  } finally { await rm(missing.base, { recursive: true, force: true }); }

  const altered = await fixture(async ({ root, manifest }) => {
    await writeFile(join(root, 'client-sdk/file.js'), 'altered\n');
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  });
  try {
    await assert.rejects(() => verify(altered), errorCode('SUBSCRIPTIONS_DEV_RELEASE_FILE_MISMATCH'));
  } finally { await rm(altered.base, { recursive: true, force: true }); }
});
