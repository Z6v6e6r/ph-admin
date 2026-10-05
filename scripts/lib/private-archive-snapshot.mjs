import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function copyHandle(source, destination) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    let written = 0;
    while (written < bytesRead) {
      const result = await destination.write(buffer, written, bytesRead - written, position + written);
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}

async function sha256(path) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function sameIdentity(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs;
}

export async function createPrivateArchiveSnapshot({
  archivePath,
  expectedSha256,
  prefix,
  error
}) {
  const source = await open(archivePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => null);
  if (!source) throw error('ARCHIVE_UNSAFE', 'Archive must be a private regular file');
  let snapshotRoot;
  try {
    const before = await source.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || (Number(before.mode) & 0o077) !== 0) {
      throw error('ARCHIVE_UNSAFE', 'Archive must be a private regular file');
    }
    snapshotRoot = await mkdtemp(join(tmpdir(), prefix));
    await chmod(snapshotRoot, 0o700);
    const snapshotPath = join(snapshotRoot, 'archive.tar.gz');
    const destination = await open(snapshotPath, 'wx', 0o600);
    try {
      await copyHandle(source, destination);
      await destination.sync();
    } finally {
      await destination.close().catch(() => undefined);
    }
    await chmod(snapshotPath, 0o600);
    const after = await source.stat({ bigint: true });
    if (!sameIdentity(before, after)) {
      throw error('ARCHIVE_DRIFT', 'Archive changed while the private snapshot was created');
    }
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || await sha256(snapshotPath) !== expectedSha256) {
      throw error('ARCHIVE_SHA256_MISMATCH', 'Archive digest differs from the approved value');
    }
    return {
      path: snapshotPath,
      cleanup: () => rm(snapshotRoot, { recursive: true, force: true })
    };
  } catch (caught) {
    if (snapshotRoot) await rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
    throw caught;
  } finally {
    await source.close().catch(() => undefined);
  }
}
