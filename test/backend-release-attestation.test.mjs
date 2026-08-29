import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BackendReleaseAttestationError,
  canonicalGitHubRepository,
  createDeterministicTarGzip,
  isSensitiveRuntimePath,
  scanRuntimeArtifact,
  shouldExcludeRuntimePath,
  validateReleaseTarget
} from '../scripts/build-backend-release-attestation.mjs';

const target = () => ({
  schema: 'ph-admin-backend-release-target-v1',
  repository: 'Z6v6e6r/ph-admin',
  component: 'lk1-subscriptions-backend',
  serviceName: 'phab-api-p32-2be5b1f.service',
  buildCommand: 'npm run build',
  entrypoint: 'node dist/main.js',
  nodeVersion: 'v22.13.1',
  npmVersion: '11.1.0'
});

const errorCode = (code) => (error) =>
  error instanceof BackendReleaseAttestationError && error.code === code;

test('release target pins ph-admin repository, backend service and entrypoint', () => {
  assert.deepEqual(validateReleaseTarget(target()), target());
  assert.throws(
    () => validateReleaseTarget({ ...target(), repository: 'Z6v6e6r/lk' }),
    errorCode('BACKEND_RELEASE_TARGET_MISMATCH')
  );
  assert.throws(
    () => validateReleaseTarget({ ...target(), serviceName: 'phab-api-dev-subscriptions.service' }),
    errorCode('BACKEND_RELEASE_TARGET_MISMATCH')
  );
  assert.throws(
    () => validateReleaseTarget({ ...target(), entrypoint: '' }),
    errorCode('BACKEND_RELEASE_TARGET_MISMATCH')
  );
  assert.throws(
    () => validateReleaseTarget({ ...target(), lkSha: 'a'.repeat(40) }),
    errorCode('BACKEND_RELEASE_TARGET_SHAPE_INVALID')
  );
});

test('repository identity accepts only canonical GitHub ph-admin remotes', () => {
  assert.equal(canonicalGitHubRepository('https://github.com/Z6v6e6r/ph-admin.git'), 'z6v6e6r/ph-admin');
  assert.equal(canonicalGitHubRepository('git@github.com:Z6v6e6r/ph-admin.git'), 'z6v6e6r/ph-admin');
  assert.equal(canonicalGitHubRepository('Z6v6e6r/ph-admin'), '');
  assert.equal(canonicalGitHubRepository('https://example.com/Z6v6e6r/ph-admin.git'), '');
});

test('runtime pruning keeps dependency implementation and removes only proven non-runtime paths', () => {
  assert.equal(shouldExcludeRuntimePath('node_modules/exceljs/lib/doc/workbook.js'), false);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/docs/guide.md'), false);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/examples/example.js'), false);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/types/index.d.ts'), false);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/test/fixture.js'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/@scope/pkg/__tests__/fixture.js'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/test.js'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/lib/parser.test.js'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/lib/parser.spec.js.map'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/lib/contest.js'), false);
  assert.equal(shouldExcludeRuntimePath('node_modules/jszip/.jekyll-metadata'), true);
  assert.equal(shouldExcludeRuntimePath('node_modules/pkg/.cache/index'), true);
  assert.equal(shouldExcludeRuntimePath('dist/main.d.ts'), true);
  assert.equal(shouldExcludeRuntimePath('dist/main.js'), false);
  assert.equal(isSensitiveRuntimePath('dist/.env.production'), true);
  assert.equal(isSensitiveRuntimePath('dist/.envrc'), true);
  assert.equal(isSensitiveRuntimePath('node_modules/pkg/.git/config'), true);
  assert.equal(isSensitiveRuntimePath('node_modules/pkg/.git-credentials'), true);
  assert.equal(isSensitiveRuntimePath('node_modules/pkg/.npmrc'), true);
  assert.equal(isSensitiveRuntimePath('dist/main.js'), false);
});

test('tar.gz bytes are deterministic for identical content and source epoch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backend-release-tar-test-'));
  try {
    const content = join(root, 'content');
    await mkdir(join(content, 'dist'), { recursive: true });
    await writeFile(join(content, 'dist/main.js'), 'console.log("ok");\n');
    await writeFile(join(content, 'package.json'), '{"name":"ph-admin-backend"}\n');
    const first = await createDeterministicTarGzip(content, 'ph-admin-backend-deadbeef', 1_800_000_000);
    const second = await createDeterministicTarGzip(content, 'ph-admin-backend-deadbeef', 1_800_000_000);
    assert.deepEqual(first, second);
    assert.equal(first[9], 255, 'gzip OS byte must be platform-neutral');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('artifact scan covers runtime text, allows synthetic placeholders and rejects secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backend-release-scan-test-'));
  try {
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'client-sdk'), { recursive: true });
    await writeFile(join(root, 'dist/main.js'), 'const phone = "+79990000000";\n');
    await writeFile(join(root, 'client-sdk/ui.js'), 'const email = "it@example.com";\n');
    await writeFile(join(root, 'package.json'), '{}\n');
    await writeFile(join(root, 'package-lock.json'), '{}\n');
    assert.deepEqual(await scanRuntimeArtifact(root), {
      regularFiles: 4,
      textFilesScanned: 4,
      binaryFilesSkipped: 0,
      secretMatches: 0,
      piiMatches: 0,
      piiScope: 'first-party-code'
    });
    await writeFile(join(root, 'dist/admin-panel-message.wav'), Buffer.from([0, 1, 2, 3]));
    assert.equal((await scanRuntimeArtifact(root)).binaryFilesSkipped, 1);
    await rm(join(root, 'dist/admin-panel-message.wav'));
    await writeFile(join(root, 'dist/unexpected.bin'), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_UNEXPECTED_BINARY')
    );
    await rm(join(root, 'dist/unexpected.bin'));
    await writeFile(join(root, 'dist/.env.production'), 'API_KEY=synthetic\n');
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SENSITIVE_PATH')
    );
    await rm(join(root, 'dist/.env.production'));
    await writeFile(join(root, 'dist/.envrc'), 'export API_KEY=synthetic\n');
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SENSITIVE_PATH')
    );
    await rm(join(root, 'dist/.envrc'));
    await writeFile(join(root, 'dist/.git-credentials'), 'https://user:secret@example.test\n');
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SENSITIVE_PATH')
    );
    await rm(join(root, 'dist/.git-credentials'));
    await mkdir(join(root, 'dist/.git'));
    await writeFile(join(root, 'dist/.git/config'), '[core]\n');
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SENSITIVE_PATH')
    );
    await rm(join(root, 'dist/.git'), { recursive: true, force: true });
    await writeFile(join(root, 'dist/main.js'), `const token = "${['ghp', '_', 'a'.repeat(36)].join('')}";\n`);
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SECRET_MATCH')
    );
    await writeFile(join(root, 'dist/main.js'), [
      `-----BEGIN ${'PRIVATE KEY'}-----`,
      'a'.repeat(64),
      'b'.repeat(64),
      `-----END ${'PRIVATE KEY'}-----`,
      ''
    ].join('\n'));
    await assert.rejects(
      () => scanRuntimeArtifact(root),
      errorCode('BACKEND_RELEASE_SECRET_MATCH')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
