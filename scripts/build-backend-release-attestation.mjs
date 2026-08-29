#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
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
import { gzipSync } from 'node:zlib';

export const BACKEND_RELEASE_SCHEMA = 'ph-admin-backend-release-attestation-v1';
export const BACKEND_RELEASE_TARGET_SCHEMA = 'ph-admin-backend-release-target-v1';
const SCRIPT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_TARGET = join(SCRIPT_ROOT, 'deploy/release-targets/lk1-subscriptions-backend.json');
const REQUIRED_TARGET_KEYS = Object.freeze([
  'schema', 'repository', 'component', 'serviceName', 'buildCommand', 'entrypoint',
  'nodeVersion', 'npmVersion'
]);
const ALLOWED_SYNTHETIC_IDENTIFIERS = new Set([
  '+79104303190',
  '+79990000000',
  '+79991234567',
  'it@example.com',
  'support@padelhub.local'
]);

export class BackendReleaseAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackendReleaseAttestationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackendReleaseAttestationError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function command(file, args, cwd) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      maxBuffer: 32 * 1024 * 1024
    }).trim();
  } catch {
    fail('BACKEND_RELEASE_COMMAND_FAILED', `Release command failed: ${basename(file)} ${args[0] ?? ''}`);
  }
}

function commandSucceeds(file, args, cwd) {
  try {
    execFileSync(file, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
    });
    return true;
  } catch {
    return false;
  }
}

function requiredSha(value, code) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) fail(code, 'Expected Git identity is invalid');
  return normalized;
}

export function canonicalGitHubRepository(value) {
  const raw = String(value ?? '').trim();
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(raw);
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(raw);
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(raw);
  return (ssh?.[1] ?? https?.[1] ?? sshUrl?.[1] ?? '').toLowerCase();
}

export function validateReleaseTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('BACKEND_RELEASE_TARGET_INVALID', 'Release target must be an object');
  }
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...REQUIRED_TARGET_KEYS].sort())) {
    fail('BACKEND_RELEASE_TARGET_SHAPE_INVALID', 'Release target contains missing or unexpected fields');
  }
  if (value.schema !== BACKEND_RELEASE_TARGET_SCHEMA
    || value.repository !== 'Z6v6e6r/ph-admin'
    || value.component !== 'lk1-subscriptions-backend'
    || value.serviceName !== 'phab-api-p32-2be5b1f.service'
    || value.buildCommand !== 'npm run build'
    || value.entrypoint !== 'node dist/main.js'
    || value.nodeVersion !== 'v22.13.1'
    || value.npmVersion !== '11.1.0') {
    fail('BACKEND_RELEASE_TARGET_MISMATCH', 'Release target differs from the approved backend contract');
  }
  return Object.freeze({ ...value });
}

async function readTarget(path) {
  const configured = resolve(path);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configured, 'utf8'));
  } catch {
    fail('BACKEND_RELEASE_TARGET_INVALID', 'Release target cannot be parsed');
  }
  return validateReleaseTarget(parsed);
}

async function assertPrivateOutput(output, sourceRoot) {
  if (!isAbsolute(output)) fail('BACKEND_RELEASE_OUTPUT_NOT_ABSOLUTE', 'Output path must be absolute');
  const outputPath = resolve(output);
  const rel = relative(sourceRoot, outputPath);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')) {
    fail('BACKEND_RELEASE_OUTPUT_INSIDE_SOURCE', 'Output must be outside the Git worktree');
  }
  if (await lstat(outputPath).catch(() => null)) {
    fail('BACKEND_RELEASE_OUTPUT_EXISTS', 'Output path must be new');
  }
  const parent = await realpath(dirname(outputPath));
  const info = await stat(parent);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if ((uid !== null && info.uid !== uid) || (info.mode & 0o022) !== 0) {
    fail('BACKEND_RELEASE_OUTPUT_PARENT_UNSAFE', 'Output parent must be private and owned by the current user');
  }
  return outputPath;
}

export function shouldExcludeRuntimePath(runtimePath) {
  const segments = String(runtimePath).split('/');
  const filename = segments.at(-1) ?? '';
  if (segments.includes('.cache')
    || ['.jekyll-metadata', '.DS_Store', 'npm-debug.log', 'yarn-error.log'].includes(filename)) {
    return true;
  }
  const packageRootLength = segments[1]?.startsWith('@') ? 3 : 2;
  const dependencyPath = segments.slice(packageRootLength);
  if (segments[0] === 'node_modules'
    && dependencyPath.some((segment) => /^(?:test|tests|__tests__|fixtures?)$/i.test(segment))) {
    return true;
  }
  return segments[0] === 'dist'
    && (/\.d\.ts$/i.test(filename)
      || /\.map$/i.test(filename)
      || /\.tsbuildinfo$/i.test(filename));
}

async function copyRuntimeTree(source, destination, inventory, prefix = '') {
  const info = await lstat(source);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
    fail('BACKEND_RELEASE_RUNTIME_PATH_UNSAFE', `Unsafe runtime path: ${prefix || basename(source)}`);
  }
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o755 });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => Buffer.compare(
      Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')
    ))) {
      if (prefix === 'node_modules' && entry.name === '.bin') continue;
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (shouldExcludeRuntimePath(childPrefix)) continue;
      await copyRuntimeTree(join(source, entry.name), join(destination, entry.name), inventory, childPrefix);
    }
    return;
  }
  const input = await open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const body = await input.readFile();
    await writeFile(destination, body, { flag: 'wx', mode: 0o644 });
    inventory.push({ path: prefix, bytes: body.length, sha256: sha256(body) });
  } finally {
    await input.close();
  }
}

async function regularFiles(root) {
  const files = [];
  const walk = async (path) => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      fail('BACKEND_RELEASE_RUNTIME_PATH_UNSAFE', `Unsafe scan path: ${path}`);
    }
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await walk(join(path, entry));
    } else {
      files.push(path);
    }
  };
  await walk(root);
  return files;
}

export async function scanRuntimeArtifact(root) {
  const files = await regularFiles(root);
  let textFilesScanned = 0;
  let binaryFilesSkipped = 0;
  for (const path of files) {
    const body = await readFile(path);
    if (body.includes(0)) {
      binaryFilesSkipped += 1;
      continue;
    }
    textFilesScanned += 1;
    const text = body.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64,}-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(text)
      || /mongodb(?:\+srv)?:\/\/[^\s]+:[^\s@]+@/i.test(text)
      || /\bsk-[A-Za-z0-9_-]{24,}\b/.test(text)) {
      fail('BACKEND_RELEASE_SECRET_MATCH', `Secret-like content found in ${relative(root, path)}`);
    }
    const runtimePath = relative(root, path);
    const firstPartyCode = runtimePath.startsWith(`dist${sep}`)
      || runtimePath.startsWith(`client-sdk${sep}`);
    const identifiers = firstPartyCode ? [
      ...(text.match(/\+7[0-9]{10}/g) ?? []),
      ...(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])
    ] : [];
    if (identifiers.some((value) => !ALLOWED_SYNTHETIC_IDENTIFIERS.has(value))) {
      fail('BACKEND_RELEASE_PII_MATCH', `Unexpected PII-like content found in ${relative(root, path)}`);
    }
  }
  return {
    regularFiles: files.length,
    textFilesScanned,
    binaryFilesSkipped,
    secretMatches: 0,
    piiMatches: 0,
    piiScope: 'first-party-code'
  };
}

function writeString(buffer, offset, length, value) {
  const body = Buffer.from(value, 'utf8');
  if (body.length > length) fail('BACKEND_RELEASE_TAR_PATH_INVALID', 'Tar header field is too long');
  body.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const body = Math.trunc(value).toString(8).padStart(length - 1, '0');
  if (body.length > length - 1) fail('BACKEND_RELEASE_TAR_VALUE_INVALID', 'Tar header value is too large');
  writeString(buffer, offset, length, `${body}\0`);
}

function splitTarPath(path) {
  const bytes = Buffer.byteLength(path);
  if (bytes <= 100) return { name: path, prefix: '' };
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  fail('BACKEND_RELEASE_TAR_PATH_INVALID', `Tar path is too long: ${path}`);
}

function tarHeader(path, { directory, size, mtime }) {
  const header = Buffer.alloc(512, 0);
  const split = splitTarPath(path);
  writeString(header, 0, 100, split.name);
  writeOctal(header, 100, 8, directory ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, directory ? 0 : size);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = directory ? '5'.charCodeAt(0) : '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, split.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

async function tarEntries(root, prefix = '') {
  const entries = [];
  const walk = async (path, archivePath) => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      fail('BACKEND_RELEASE_RUNTIME_PATH_UNSAFE', `Unsafe staged path: ${archivePath}`);
    }
    if (info.isDirectory()) {
      entries.push({ path: `${archivePath}/`, directory: true, body: Buffer.alloc(0) });
      const children = await readdir(path, { withFileTypes: true });
      for (const child of children.sort((left, right) => Buffer.compare(
        Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')
      ))) {
        await walk(join(path, child.name), `${archivePath}/${child.name}`);
      }
    } else {
      entries.push({ path: archivePath, directory: false, body: await readFile(path) });
    }
  };
  await walk(root, prefix || basename(root));
  return entries;
}

export async function createDeterministicTarGzip(root, rootName, mtime) {
  const chunks = [];
  const entries = await tarEntries(root, rootName);
  for (const entry of entries) {
    chunks.push(tarHeader(entry.path, {
      directory: entry.directory,
      size: entry.body.length,
      mtime
    }));
    if (!entry.directory) {
      chunks.push(entry.body);
      const padding = (512 - (entry.body.length % 512)) % 512;
      if (padding) chunks.push(Buffer.alloc(padding, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  const compressed = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  compressed[9] = 255;
  return compressed;
}

export async function buildBackendReleaseAttestation({
  source,
  output,
  expectedHead,
  expectedTree,
  trustedRef = 'refs/remotes/origin/main',
  targetPath = DEFAULT_TARGET
}) {
  const sourceRoot = await realpath(resolve(source));
  const approvedHead = requiredSha(expectedHead, 'BACKEND_RELEASE_HEAD_INVALID');
  const approvedTree = requiredSha(expectedTree, 'BACKEND_RELEASE_TREE_INVALID');
  const outputPath = await assertPrivateOutput(output, sourceRoot);
  const target = await readTarget(targetPath);
  const actualRepository = canonicalGitHubRepository(
    command('git', ['remote', 'get-url', 'origin'], sourceRoot)
  );
  if (actualRepository !== target.repository.toLowerCase()) {
    fail('BACKEND_RELEASE_REPOSITORY_MISMATCH', 'Git repository is not Z6v6e6r/ph-admin');
  }
  if (!commandSucceeds('git', ['cat-file', '-e', `${approvedHead}^{commit}`], sourceRoot)) {
    fail('BACKEND_RELEASE_COMMIT_MISSING', 'Approved commit does not exist in ph-admin');
  }
  const normalizedTrustedRef = String(trustedRef ?? '').trim();
  if (!normalizedTrustedRef || !/^(?:HEAD|refs\/(?:remotes\/origin|release-attestation)\/[A-Za-z0-9._/-]+)$/.test(normalizedTrustedRef)) {
    fail('BACKEND_RELEASE_TRUSTED_REF_INVALID', 'Trusted Git ref is missing or invalid');
  }
  if (!commandSucceeds('git', ['cat-file', '-e', `${normalizedTrustedRef}^{commit}`], sourceRoot)
    || command('git', ['rev-parse', `${normalizedTrustedRef}^{commit}`], sourceRoot) !== approvedHead) {
    fail('BACKEND_RELEASE_TRUSTED_REF_MISMATCH', 'Approved commit is not the trusted repository ref');
  }
  if (command('git', ['rev-parse', 'HEAD'], sourceRoot) !== approvedHead) {
    fail('BACKEND_RELEASE_HEAD_MISMATCH', 'Worktree HEAD differs from approved commit');
  }
  if (command('git', ['rev-parse', 'HEAD^{tree}'], sourceRoot) !== approvedTree) {
    fail('BACKEND_RELEASE_TREE_MISMATCH', 'Worktree tree differs from approved tree');
  }
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'], sourceRoot)) {
    fail('BACKEND_RELEASE_DIRTY_SOURCE', 'Exact source worktree is dirty');
  }
  try {
    command('git', ['symbolic-ref', '-q', 'HEAD'], sourceRoot);
    fail('BACKEND_RELEASE_DETACHED_WORKTREE_REQUIRED', 'Release source must be detached');
  } catch (error) {
    if (error instanceof BackendReleaseAttestationError
      && error.code !== 'BACKEND_RELEASE_COMMAND_FAILED') throw error;
  }

  const packageJson = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  if (packageJson.name !== 'ph-admin-backend'
    || packageJson.scripts?.build !== 'tsc -p tsconfig.build.json && npm run build:client-sdk'
    || packageJson.scripts?.start !== target.entrypoint) {
    fail('BACKEND_RELEASE_ENTRYPOINT_MISMATCH', 'Backend build/start entrypoint is missing or changed');
  }

  await mkdir(outputPath, { mode: 0o700 });
  await chmod(outputPath, 0o700);
  const workspace = await mkdtemp(join(outputPath, '.build-'));
  const sourceArchive = join(workspace, 'source.tar');
  const snapshot = join(workspace, 'source');
  const stage = join(workspace, 'stage');
  await mkdir(snapshot, { mode: 0o700 });
  await mkdir(stage, { mode: 0o700 });
  try {
    command('git', ['archive', '--format=tar', `--output=${sourceArchive}`, approvedHead], sourceRoot);
    command('/usr/bin/tar', ['-C', snapshot, '-xf', sourceArchive], sourceRoot);
    await rm(sourceArchive);
    const packageBefore = sha256(await readFile(join(snapshot, 'package.json')));
    const lockBody = await readFile(join(snapshot, 'package-lock.json'));
    const lockSha256 = sha256(lockBody);
    command('npm', ['ci', '--include=optional', '--no-audit', '--no-fund'], snapshot);
    command('npm', ['run', 'build'], snapshot);
    command('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund'], snapshot);
    if (packageBefore !== sha256(await readFile(join(snapshot, 'package.json')))
      || lockSha256 !== sha256(await readFile(join(snapshot, 'package-lock.json')))) {
      fail('BACKEND_RELEASE_PACKAGE_DRIFT', 'Build changed package metadata');
    }
    for (const required of ['dist/main.js', 'client-sdk', 'node_modules', 'package.json', 'package-lock.json']) {
      if (!await lstat(join(snapshot, required)).catch(() => null)) {
        fail('BACKEND_RELEASE_RUNTIME_FILE_MISSING', `Required runtime file is absent: ${required}`);
      }
    }
    const releaseRootName = `ph-admin-backend-${approvedHead.slice(0, 12)}`;
    const releaseRoot = join(stage, releaseRootName);
    await mkdir(releaseRoot, { mode: 0o755 });
    const inventory = [];
    for (const path of ['dist', 'client-sdk', 'node_modules', 'package.json', 'package-lock.json']) {
      await copyRuntimeTree(join(snapshot, path), join(releaseRoot, path), inventory, path);
    }
    inventory.sort((left, right) => Buffer.compare(
      Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')
    ));
    const artifactScan = await scanRuntimeArtifact(releaseRoot);
    const nodeVersion = command('node', ['--version'], snapshot);
    const npmVersion = command('npm', ['--version'], snapshot);
    if (nodeVersion !== target.nodeVersion || npmVersion !== target.npmVersion) {
      fail('BACKEND_RELEASE_TOOLCHAIN_MISMATCH', 'Builder Node/npm differs from release target');
    }
    const sourceEpoch = Number(command('git', ['show', '-s', '--format=%ct', approvedHead], sourceRoot));
    const manifest = {
      schema: BACKEND_RELEASE_SCHEMA,
      repository: target.repository,
      component: target.component,
      sourceCommit: approvedHead,
      sourceTree: approvedTree,
      sourceTrustedRef: normalizedTrustedRef,
      sourceCommitTime: new Date(sourceEpoch * 1000).toISOString(),
      sourceDirty: false,
      serviceName: target.serviceName,
      buildCommand: target.buildCommand,
      entrypoint: target.entrypoint,
      nodeVersion,
      npmVersion,
      packageLockSha256: lockSha256,
      format: 'tar.gz',
      artifactScan,
      runtimeFileCount: inventory.length,
      runtimeFiles: inventory
    };
    await writeFile(join(releaseRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx', mode: 0o644
    });
    const archiveBody = await createDeterministicTarGzip(releaseRoot, releaseRootName, sourceEpoch);
    const archiveName = `${releaseRootName}.tar.gz`;
    const archivePath = join(outputPath, archiveName);
    const archiveSha256 = sha256(archiveBody);
    await writeFile(archivePath, archiveBody, { flag: 'wx', mode: 0o600 });
    await chmod(archivePath, 0o600);
    await writeFile(`${archivePath}.sha256`, `${archiveSha256}  ${archiveName}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(`${archivePath}.sha256`, 0o600);
    await writeFile(join(outputPath, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx', mode: 0o600
    });
    return {
      schema: BACKEND_RELEASE_SCHEMA,
      repository: target.repository,
      sourceCommit: approvedHead,
      sourceTree: approvedTree,
      serviceName: target.serviceName,
      entrypoint: target.entrypoint,
      nodeVersion,
      npmVersion,
      packageLockSha256: lockSha256,
      archivePath,
      archiveSha256,
      runtimeFileCount: inventory.length
    };
  } catch (error) {
    await rm(outputPath, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof BackendReleaseAttestationError) throw error;
    fail('BACKEND_RELEASE_FAILED', 'Backend release attestation failed');
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const result = await buildBackendReleaseAttestation({
    source: argument('--source'),
    output: argument('--output'),
    expectedHead: argument('--expected-head'),
    expectedTree: argument('--expected-tree'),
    trustedRef: argument('--trusted-ref') ?? 'refs/remotes/origin/main',
    targetPath: argument('--target') ?? DEFAULT_TARGET
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof BackendReleaseAttestationError ? error.code : 'BACKEND_RELEASE_FAILED'}\n`);
    process.exitCode = 1;
  });
}
