#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REFERRAL_RELEASE_SCHEMA = 'phab-referral-links-release-v1';
export const REQUIRED_REFERRAL_CONFIG = Object.freeze([
  'REFERRAL_LINKS_ENABLED',
  'REFERRAL_LINKS_PUBLIC_BASE_URL',
  'REFERRAL_LINKS_ALLOWED_ORIGINS',
  'REFERRAL_LINKS_MONGODB_URI',
  'REFERRAL_LINKS_MONGODB_DB',
  'REFERRAL_LINKS_AUTO_CREATE_INDEXES'
]);

export class ReferralReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReferralReleaseError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReferralReleaseError(code, message);
}

function defaultCommand(file, args, options = {}) {
  return spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
  });
}

function commandText(command, file, args, options, code) {
  const result = command(file, args, options);
  if (result.status !== 0) fail(code, 'Release preparation command failed');
  return String(result.stdout ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileIdentity(path) {
  const body = await readFile(path);
  return { bytes: body.length, sha256: sha256(body) };
}

async function copyStableRegularFile(source, destination) {
  const sourceHandle = await open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    .catch(() => null);
  if (!sourceHandle) fail('REFERRAL_RELEASE_SOURCE_UNSAFE', 'Release source contains an unsafe file');
  let destinationHandle;
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      fail('REFERRAL_RELEASE_SOURCE_UNSAFE', 'Release source contains a non-regular file');
    }
    destinationHandle = await open(destination, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        );
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destinationHandle.sync();
    const after = await sourceHandle.stat({ bigint: true });
    if (before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
      fail('REFERRAL_RELEASE_SOURCE_DRIFT', 'Release source changed while it was copied');
    }
  } finally {
    await destinationHandle?.close().catch(() => undefined);
    await sourceHandle.close().catch(() => undefined);
  }
}

async function copyTree(source, destination, prefix, artifacts) {
  const info = await lstat(source).catch(() => null);
  if (!info || info.isSymbolicLink()) fail('REFERRAL_RELEASE_SOURCE_UNSAFE', 'Release source contains an unsafe path');
  if (info.isDirectory()) {
    await mkdir(destination, { mode: 0o700 });
    await chmod(destination, 0o700);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      await copyTree(join(source, entry.name), join(destination, entry.name), join(prefix, entry.name), artifacts);
    }
    return;
  }
  if (!info.isFile()) fail('REFERRAL_RELEASE_SOURCE_UNSAFE', 'Release source contains a special file');
  await copyStableRegularFile(source, destination);
  await chmod(destination, 0o600);
  artifacts.push({ path: prefix, ...await fileIdentity(destination) });
}

function releaseId(sourceSha, now) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `phab-referral-${sourceSha.slice(0, 7)}-${timestamp}`;
}

async function privateOutputParent(output) {
  const parent = resolve(dirname(resolve(output)));
  const linkInfo = await lstat(parent).catch(() => null);
  if (!linkInfo?.isDirectory() || linkInfo.isSymbolicLink() || await realpath(parent) !== parent) {
    fail('REFERRAL_RELEASE_OUTPUT_PARENT_UNSAFE', 'Release output parent must be a canonical directory');
  }
  const info = await stat(parent);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if ((uid !== null && info.uid !== uid) || (info.mode & 0o022) !== 0) {
    fail('REFERRAL_RELEASE_OUTPUT_PARENT_UNSAFE', 'Release output parent must be private and owned by the current user');
  }
  return parent;
}

async function directoryIdentity(path) {
  const info = await lstat(path, { bigint: true }).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink() || (Number(info.mode) & 0o077) !== 0) {
    fail('REFERRAL_RELEASE_OUTPUT_DRIFT', 'Release output directory identity is unsafe');
  }
  return { dev: info.dev, ino: info.ino, uid: info.uid };
}

async function matchesDirectoryIdentity(path, expected) {
  const info = await lstat(path, { bigint: true }).catch(() => null);
  return Boolean(info?.isDirectory()
    && !info.isSymbolicLink()
    && info.dev === expected?.dev
    && info.ino === expected?.ino
    && info.uid === expected?.uid
    && (Number(info.mode) & 0o077) === 0);
}

export async function buildReferralLinksRelease({
  repoRoot,
  output,
  expectedHead,
  now = new Date(),
  command = defaultCommand
}) {
  const sourceRoot = await realpath(resolve(repoRoot));
  const expected = String(expectedHead ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expected)) fail('REFERRAL_RELEASE_EXPECTED_HEAD_INVALID', 'Expected source SHA is invalid');
  if (!isAbsolute(output)) fail('REFERRAL_RELEASE_OUTPUT_NOT_ABSOLUTE', 'Release output must be absolute');
  const outputPath = join(await privateOutputParent(output), basename(resolve(output)));
  const relativeOutput = relative(sourceRoot, outputPath);
  if (!relativeOutput.startsWith(`..${sep}`) && relativeOutput !== '..') {
    fail('REFERRAL_RELEASE_OUTPUT_INSIDE_REPOSITORY', 'Release output must stay outside the repository');
  }
  if (await lstat(outputPath).catch(() => null)) fail('REFERRAL_RELEASE_OUTPUT_EXISTS', 'Release output already exists');

  const readHead = () => commandText(command, 'git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }, 'REFERRAL_RELEASE_GIT_FAILED');
  const readStatus = () => commandText(
    command,
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: sourceRoot },
    'REFERRAL_RELEASE_GIT_FAILED'
  );
  if (readHead() !== expected) fail('REFERRAL_RELEASE_HEAD_MISMATCH', 'Source HEAD differs from the approved SHA');
  if (readStatus()) fail('REFERRAL_RELEASE_DIRTY_SOURCE', 'Release source is dirty');

  let createdOutput = false;
  let outputIdentity;
  try {
    await mkdir(outputPath, { mode: 0o700 });
    createdOutput = true;
    await chmod(outputPath, 0o700);
    outputIdentity = await directoryIdentity(outputPath);
    const id = releaseId(expected, now);
    const workspace = join(outputPath, `.tmp-${id}`);
    const contentRoot = join(workspace, id);
    await mkdir(contentRoot, { recursive: true, mode: 0o700 });
    await chmod(workspace, 0o700);
    await chmod(contentRoot, 0o700);
    const sourceArchive = join(workspace, 'source.tar');
    const sourceSnapshot = join(workspace, 'source');
    await mkdir(sourceSnapshot, { mode: 0o700 });
    commandText(
      command,
      'git',
      ['archive', '--format=tar', `--output=${sourceArchive}`, expected],
      { cwd: sourceRoot },
      'REFERRAL_RELEASE_GIT_ARCHIVE_FAILED'
    );
    commandText(
      command,
      '/usr/bin/tar',
      ['-C', sourceSnapshot, '-xf', sourceArchive],
      {},
      'REFERRAL_RELEASE_SOURCE_SNAPSHOT_FAILED'
    );
    await rm(sourceArchive, { force: false });
    const pristinePackageIdentity = await fileIdentity(join(sourceSnapshot, 'package.json'));
    const pristineLockIdentity = await fileIdentity(join(sourceSnapshot, 'package-lock.json'));
    commandText(
      command,
      'npm',
      ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: sourceSnapshot },
      'REFERRAL_RELEASE_INSTALL_FAILED'
    );
    commandText(command, 'npm', ['run', 'build'], { cwd: sourceSnapshot }, 'REFERRAL_RELEASE_BUILD_FAILED');
    if (JSON.stringify(await fileIdentity(join(sourceSnapshot, 'package.json')))
      !== JSON.stringify(pristinePackageIdentity)
      || JSON.stringify(await fileIdentity(join(sourceSnapshot, 'package-lock.json')))
        !== JSON.stringify(pristineLockIdentity)) {
      fail('REFERRAL_RELEASE_PACKAGE_DRIFT', 'Package metadata changed during release build');
    }
    const artifactSourceRoot = sourceSnapshot;
    if (readHead() !== expected || readStatus()) {
      fail('REFERRAL_RELEASE_SOURCE_DRIFT', 'Source changed during release build');
    }

    const requiredSources = [
      ['dist', join(artifactSourceRoot, 'dist')],
      ['package.json', join(artifactSourceRoot, 'package.json')],
      ['package-lock.json', join(artifactSourceRoot, 'package-lock.json')]
    ];
    for (const [, path] of requiredSources) {
      if (!await lstat(path).catch(() => null)) fail('REFERRAL_RELEASE_ARTIFACT_MISSING', 'Required release artifact is missing');
    }
    const clientBundle = join(artifactSourceRoot, 'dist/client-sdk/phab-referral-links-admin.js');
    if (!await lstat(clientBundle).catch(() => null)) {
      fail('REFERRAL_RELEASE_CLIENT_BUNDLE_MISSING', 'Referral admin client bundle is missing');
    }

    const artifacts = [];
    for (const [name, source] of requiredSources) {
      await copyTree(source, join(contentRoot, name), name, artifacts);
    }
    if (readHead() !== expected || readStatus()) {
      fail('REFERRAL_RELEASE_SOURCE_DRIFT', 'Source changed while release artifacts were copied');
    }
    artifacts.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      schema: REFERRAL_RELEASE_SCHEMA,
      createdAt: now.toISOString(),
      sourceCommit: expected,
      sourceDirty: false,
      buildSource: 'PRIVATE_GIT_ARCHIVE',
      requiredRuntimeConfig: REQUIRED_REFERRAL_CONFIG,
      activationDefaults: {
        REFERRAL_LINKS_ENABLED: false,
        REFERRAL_LINKS_AUTO_CREATE_INDEXES: false
      },
      artifacts
    };
    const manifestPath = join(contentRoot, 'release-manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(manifestPath, 0o600);

    const archivePath = join(outputPath, `${id}.tar.gz`);
    if (!await matchesDirectoryIdentity(outputPath, outputIdentity)) {
      fail('REFERRAL_RELEASE_OUTPUT_DRIFT', 'Release output directory changed during build');
    }
    commandText(command, '/usr/bin/tar', ['-C', workspace, '-czf', archivePath, id], {}, 'REFERRAL_RELEASE_ARCHIVE_FAILED');
    await chmod(archivePath, 0o600);
    const archive = await fileIdentity(archivePath);
    const checksumPath = `${archivePath}.sha256`;
    await writeFile(checksumPath, `${archive.sha256}  ${basename(archivePath)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(checksumPath, 0o600);
    await rm(workspace, { recursive: true, force: false });
    return {
      schema: REFERRAL_RELEASE_SCHEMA,
      releaseId: id,
      sourceCommit: expected,
      archivePath,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
      checksumPath,
      artifactCount: artifacts.length
    };
  } catch (error) {
    if (createdOutput && await matchesDirectoryIdentity(outputPath, outputIdentity)) {
      await rm(outputPath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof ReferralReleaseError) throw error;
    fail('REFERRAL_RELEASE_FAILED', 'Referral release preparation failed');
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const result = await buildReferralLinksRelease({
    repoRoot: SCRIPT_ROOT,
    output: argument('--output'),
    expectedHead: argument('--expected-head')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReferralReleaseError ? error.code : 'REFERRAL_RELEASE_FAILED'}\n`);
    process.exitCode = 1;
  });
}
