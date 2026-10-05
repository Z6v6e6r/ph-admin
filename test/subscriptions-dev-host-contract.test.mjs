import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SUBSCRIPTIONS_ENABLED_FLAGS, buildSubscriptionsDevSystemEvidence,
  planSubscriptionsDevHostTransition
} from '../scripts/subscriptions-dev-host-contract.mjs';

const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const digest = (char) => char.repeat(64);
const flags = () => Object.fromEntries(SUBSCRIPTIONS_ENABLED_FLAGS.map((name) => [name, false]));
const snapshot = (active = false) => ({
  schema: 'ph-admin-subscriptions-dev-host-snapshot-v1',
  environment: 'DEV',
  service: {
    name: 'phab-subscriptions-dev.service', activeState: active ? 'active' : 'inactive',
    unitFileState: active ? 'enabled' : 'disabled',
    fragmentPath: '/etc/systemd/system/phab-subscriptions-dev.service',
    execStart: '/usr/bin/node /opt/phab-subscriptions-dev/current/dist/main.js',
    mainPid: active ? 42 : 0
  },
  listener: { address: '127.0.0.1:3036', open: active, ownerPid: active ? 42 : null },
  release: {
    currentLink: '/opt/phab-subscriptions-dev/current',
    releaseDirectory: '/opt/phab-subscriptions-dev/releases/ph-admin-subscriptions-dev-aaaaaaaaaaaa',
    sourceCommit: commit, sourceTree: tree, archiveSha256: digest('c'),
    manifestSha256: digest('d'), runtimeInventorySha256: digest('e'),
    activationAuthorized: false
  },
  flags: flags()
});
const authorization = (action) => ({
  schema: 'ph-admin-subscriptions-dev-host-authorization-v1', action, approved: true,
  sourceCommit: commit, sourceTree: tree, archiveSha256: digest('c'), manifestSha256: digest('d'),
  releaseDirectory: '/opt/phab-subscriptions-dev/releases/ph-admin-subscriptions-dev-aaaaaaaaaaaa',
  fragmentPath: '/etc/systemd/system/phab-subscriptions-dev.service',
  execStart: '/usr/bin/node /opt/phab-subscriptions-dev/current/dist/main.js',
  previousReleaseDirectory: action === 'ROLLBACK_STOPPED'
    ? '/opt/phab-subscriptions-dev/releases/ph-admin-subscriptions-dev-111111111111' : null
});
const code = (expected) => (error) => error?.code === expected;

test('emits sanitized active readback without paths, PIDs, flags or env values', () => {
  const evidence = buildSubscriptionsDevSystemEvidence(snapshot(true));
  assert.equal(evidence.serviceActive, true);
  assert.equal(evidence.listenerOwnedByService, true);
  assert.equal(evidence.allSubscriptionFlagsFalse, true);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /\/etc\/systemd|\/usr\/bin\/node|mainPid|previousRelease|SUBSCRIPTIONS_/);
});

test('builds inert exact stopped install, switch and rollback plans', () => {
  for (const action of ['INSTALL_STOPPED', 'SWITCH_STOPPED', 'ROLLBACK_STOPPED']) {
    const plan = planSubscriptionsDevHostTransition(action, snapshot(), authorization(action));
    assert.equal(plan.action, action);
    assert.equal(plan.serviceStartAuthorized, false);
    assert.equal(plan.deleteAuthorized, false);
    assert.equal(plan.execute, false);
  }
});

test('rejects active service, enabled flag, topology mismatch and authorization drift', () => {
  assert.throws(() => planSubscriptionsDevHostTransition(
    'INSTALL_STOPPED', snapshot(true), authorization('INSTALL_STOPPED')
  ), code('SUBSCRIPTIONS_DEV_HOST_NOT_STOPPED'));
  const enabled = snapshot();
  enabled.flags.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = true;
  assert.throws(() => buildSubscriptionsDevSystemEvidence(enabled), code('SUBSCRIPTIONS_DEV_HOST_FLAGS_NOT_OFF'));
  const pid = snapshot(true);
  pid.listener.ownerPid = 99;
  assert.throws(() => buildSubscriptionsDevSystemEvidence(pid), code('SUBSCRIPTIONS_DEV_HOST_PROCESS_TOPOLOGY_INVALID'));
  const drift = authorization('SWITCH_STOPPED');
  drift.manifestSha256 = digest('f');
  assert.throws(() => planSubscriptionsDevHostTransition('SWITCH_STOPPED', snapshot(), drift),
    code('SUBSCRIPTIONS_DEV_HOST_AUTHORIZATION_MISMATCH'));
});

test('rejects path escapes, unknown flags and unsafe rollback predecessor', () => {
  const escaped = snapshot();
  escaped.release.releaseDirectory = '/opt/phab-subscriptions-dev/other';
  assert.throws(() => buildSubscriptionsDevSystemEvidence(escaped),
    code('SUBSCRIPTIONS_DEV_HOST_RELEASE_IDENTITY_INVALID'));
  const wrongRelease = snapshot();
  wrongRelease.release.releaseDirectory =
    '/opt/phab-subscriptions-dev/releases/ph-admin-subscriptions-dev-bbbbbbbbbbbb';
  assert.throws(() => buildSubscriptionsDevSystemEvidence(wrongRelease),
    code('SUBSCRIPTIONS_DEV_HOST_RELEASE_IDENTITY_INVALID'));
  const unknown = snapshot();
  unknown.flags.EXTRA_ENABLED = false;
  assert.throws(() => buildSubscriptionsDevSystemEvidence(unknown),
    code('SUBSCRIPTIONS_DEV_HOST_FLAGS_NOT_OFF'));
  const rollback = authorization('ROLLBACK_STOPPED');
  rollback.previousReleaseDirectory = '/opt/other/release';
  assert.throws(() => planSubscriptionsDevHostTransition('ROLLBACK_STOPPED', snapshot(), rollback),
    code('SUBSCRIPTIONS_DEV_HOST_ROLLBACK_TARGET_INVALID'));
});

test('CLI accepts only a private snapshot and emits sanitized evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subscriptions-dev-host-'));
  const input = join(root, 'snapshot.json');
  try {
    await writeFile(input, JSON.stringify(snapshot(true)));
    await chmod(input, 0o600);
    const output = execFileSync(process.execPath, ['scripts/subscriptions-dev-host-contract.mjs'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, SUBSCRIPTIONS_DEV_HOST_SNAPSHOT: input }
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.allSubscriptionFlagsFalse, true);
    assert.doesNotMatch(output, /\/etc\/systemd|\/usr\/bin\/node|SUBSCRIPTIONS_/);
    await chmod(input, 0o644);
    const rejected = spawnSync(process.execPath, ['scripts/subscriptions-dev-host-contract.mjs'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, SUBSCRIPTIONS_DEV_HOST_SNAPSHOT: input }
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /SUBSCRIPTIONS_DEV_HOST_INPUT_UNSAFE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
