#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEV_RELEASE_TARGET, releaseIdentity } from './build-backend-release-attestation.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
export const SUBSCRIPTIONS_ENABLED_FLAGS = Object.freeze([
  'SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED',
  'SUBSCRIPTIONS_ACTIVATION_ENABLED',
  'SUBSCRIPTIONS_ADMIN_ENABLED',
  'SUBSCRIPTIONS_BINDING_PROMOTION_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED',
  'SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_INSTANCE_PROJECTOR_READINESS_ENABLED',
  'SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_ENABLED',
  'SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED',
  'SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED',
  'SUBSCRIPTIONS_PUBLICATION_PREVIEW_ENABLED',
  'SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED',
  'SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED',
  'SUBSCRIPTIONS_SALE_READINESS_ENABLED',
  'SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED',
  'SUBSCRIPTIONS_SYNTHETIC_CANONICAL_PROJECTION_ENABLED',
  'SUBSCRIPTIONS_TEST_RUNTIME_ENABLED',
  'SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED'
]);

export class SubscriptionsDevHostContractError extends Error {
  constructor(code, message) { super(message); this.name = 'SubscriptionsDevHostContractError'; this.code = code; }
}
const fail = (code, message) => { throw new SubscriptionsDevHostContractError(code, message); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function safeReleaseChild(path) {
  if (!isAbsolute(path)) return false;
  const rel = relative(resolve(DEV_RELEASE_TARGET.releaseRoot), resolve(path));
  return rel && !rel.startsWith('..' + sep) && rel !== '..' && !rel.includes(sep);
}

function assertIdentity(value) {
  if (!value || !GIT_SHA.test(value.sourceCommit) || !GIT_SHA.test(value.sourceTree)
    || !SHA256.test(value.archiveSha256) || !SHA256.test(value.manifestSha256)
    || !SHA256.test(value.runtimeInventorySha256) || !safeReleaseChild(value.releaseDirectory)
    || basename(value.releaseDirectory) !== releaseIdentity(
      DEV_RELEASE_TARGET, value.sourceCommit, 'subscriptions-dev'
    ).rootName) {
    fail('SUBSCRIPTIONS_DEV_HOST_RELEASE_IDENTITY_INVALID', 'Release identity is incomplete or unsafe');
  }
}

export function validateSubscriptionsDevHostSnapshot(snapshot) {
  if (!exactKeys(snapshot, ['schema', 'environment', 'service', 'listener', 'release', 'flags'])) {
    fail('SUBSCRIPTIONS_DEV_HOST_SNAPSHOT_SHAPE_INVALID', 'Host snapshot shape is invalid');
  }
  if (snapshot.schema !== 'ph-admin-subscriptions-dev-host-snapshot-v1' || snapshot.environment !== 'DEV') {
    fail('SUBSCRIPTIONS_DEV_HOST_ENVIRONMENT_INVALID', 'Host snapshot is not DEV');
  }
  if (!exactKeys(snapshot.service, ['name', 'activeState', 'unitFileState', 'fragmentPath', 'execStart', 'mainPid'])
    || snapshot.service.name !== DEV_RELEASE_TARGET.serviceName
    || !['active', 'inactive'].includes(snapshot.service.activeState)
    || !['enabled', 'disabled'].includes(snapshot.service.unitFileState)
    || typeof snapshot.service.fragmentPath !== 'string' || !isAbsolute(snapshot.service.fragmentPath)
    || basename(snapshot.service.fragmentPath) !== DEV_RELEASE_TARGET.serviceName
    || typeof snapshot.service.execStart !== 'string'
    || !Number.isSafeInteger(snapshot.service.mainPid) || snapshot.service.mainPid < 0) {
    fail('SUBSCRIPTIONS_DEV_HOST_SERVICE_INVALID', 'Service identity is invalid');
  }
  const execParts = snapshot.service.execStart.trim().split(/\s+/);
  const targetExecParts = DEV_RELEASE_TARGET.entrypoint.trim().split(/\s+/);
  if (execParts.length !== 2 || !isAbsolute(execParts[0])
    || targetExecParts.length !== 2 || basename(execParts[0]) !== targetExecParts[0]
    || isAbsolute(targetExecParts[1])
    || execParts[1] !== join(DEV_RELEASE_TARGET.currentLink, targetExecParts[1])) {
    fail('SUBSCRIPTIONS_DEV_HOST_EXEC_START_INVALID', 'ExecStart does not use the exact current release entrypoint');
  }
  if (!exactKeys(snapshot.listener, ['address', 'open', 'ownerPid'])
    || snapshot.listener.address !== new URL(DEV_RELEASE_TARGET.apiOrigin).host
    || typeof snapshot.listener.open !== 'boolean'
    || !(snapshot.listener.ownerPid === null || Number.isSafeInteger(snapshot.listener.ownerPid))) {
    fail('SUBSCRIPTIONS_DEV_HOST_LISTENER_INVALID', 'Listener identity is invalid');
  }
  if ((snapshot.service.activeState === 'active')
    !== (snapshot.service.mainPid > 0 && snapshot.listener.open === true
      && snapshot.listener.ownerPid === snapshot.service.mainPid)) {
    fail('SUBSCRIPTIONS_DEV_HOST_PROCESS_TOPOLOGY_INVALID', 'Unit, PID and listener do not form one exact process');
  }
  if (!exactKeys(snapshot.release, [
    'currentLink', 'releaseDirectory', 'sourceCommit', 'sourceTree', 'archiveSha256',
    'manifestSha256', 'runtimeInventorySha256', 'activationAuthorized'
  ]) || snapshot.release.currentLink !== DEV_RELEASE_TARGET.currentLink
    || snapshot.release.activationAuthorized !== false) {
    fail('SUBSCRIPTIONS_DEV_HOST_RELEASE_INVALID', 'Installed release target is invalid');
  }
  assertIdentity(snapshot.release);
  if (!exactKeys(snapshot.flags, SUBSCRIPTIONS_ENABLED_FLAGS)
    || SUBSCRIPTIONS_ENABLED_FLAGS.some((name) => snapshot.flags[name] !== false)) {
    fail('SUBSCRIPTIONS_DEV_HOST_FLAGS_NOT_OFF', 'Every subscription runtime flag must be explicitly false');
  }
  return structuredClone(snapshot);
}

export function buildSubscriptionsDevSystemEvidence(snapshot) {
  const checked = validateSubscriptionsDevHostSnapshot(snapshot);
  return Object.freeze({
    schema: 'ph-admin-subscriptions-dev-system-evidence-v1',
    environment: 'DEV',
    serviceName: checked.service.name,
    serviceActive: checked.service.activeState === 'active',
    serviceEnabled: checked.service.unitFileState === 'enabled',
    listenerOpen: checked.listener.open,
    listenerOwnedByService: checked.listener.open
      ? checked.listener.ownerPid === checked.service.mainPid : true,
    sourceCommit: checked.release.sourceCommit,
    sourceTree: checked.release.sourceTree,
    archiveSha256: checked.release.archiveSha256,
    manifestSha256: checked.release.manifestSha256,
    runtimeInventorySha256: checked.release.runtimeInventorySha256,
    fragmentPathSha256: createHash('sha256').update(checked.service.fragmentPath).digest('hex'),
    execStartSha256: createHash('sha256').update(checked.service.execStart).digest('hex'),
    allSubscriptionFlagsFalse: true,
    activationAuthorized: false
  });
}

function validateAuthorization(action, snapshot, authorization) {
  if (!exactKeys(authorization, [
    'schema', 'action', 'approved', 'sourceCommit', 'sourceTree', 'archiveSha256',
    'manifestSha256', 'releaseDirectory', 'previousReleaseDirectory', 'fragmentPath', 'execStart'
  ]) || authorization.schema !== 'ph-admin-subscriptions-dev-host-authorization-v1'
    || authorization.action !== action || authorization.approved !== true
    || authorization.sourceCommit !== snapshot.release.sourceCommit
    || authorization.sourceTree !== snapshot.release.sourceTree
    || authorization.archiveSha256 !== snapshot.release.archiveSha256
    || authorization.manifestSha256 !== snapshot.release.manifestSha256
    || authorization.releaseDirectory !== snapshot.release.releaseDirectory
    || authorization.fragmentPath !== snapshot.service.fragmentPath
    || authorization.execStart !== snapshot.service.execStart) {
    fail('SUBSCRIPTIONS_DEV_HOST_AUTHORIZATION_MISMATCH', 'Authorization does not bind the exact transition');
  }
  if (action === 'ROLLBACK_STOPPED') {
    if (!safeReleaseChild(authorization.previousReleaseDirectory)
      || !/^ph-admin-subscriptions-dev-[a-f0-9]{12}$/.test(
        basename(authorization.previousReleaseDirectory)
      )
      || authorization.previousReleaseDirectory === snapshot.release.releaseDirectory) {
      fail('SUBSCRIPTIONS_DEV_HOST_ROLLBACK_TARGET_INVALID', 'Rollback predecessor is invalid');
    }
  } else if (authorization.previousReleaseDirectory !== null) {
    fail('SUBSCRIPTIONS_DEV_HOST_AUTHORIZATION_MISMATCH', 'Non-rollback authorization has a predecessor');
  }
}

export function planSubscriptionsDevHostTransition(action, snapshot, authorization) {
  const checked = validateSubscriptionsDevHostSnapshot(snapshot);
  if (!['INSTALL_STOPPED', 'SWITCH_STOPPED', 'ROLLBACK_STOPPED'].includes(action)) {
    fail('SUBSCRIPTIONS_DEV_HOST_ACTION_INVALID', 'Host transition action is invalid');
  }
  if (checked.service.activeState !== 'inactive' || checked.service.mainPid !== 0
    || checked.service.unitFileState !== 'disabled'
    || checked.listener.open || checked.listener.ownerPid !== null) {
    fail('SUBSCRIPTIONS_DEV_HOST_NOT_STOPPED', 'Host transition requires a stopped unit and closed listener');
  }
  validateAuthorization(action, checked, authorization);
  return Object.freeze({
    schema: 'ph-admin-subscriptions-dev-host-plan-v1',
    action,
    serviceName: checked.service.name,
    currentLink: checked.release.currentLink,
    candidateReleaseDirectory: checked.release.releaseDirectory,
    previousReleaseDirectory: authorization.previousReleaseDirectory,
    sourceCommit: checked.release.sourceCommit,
    sourceTree: checked.release.sourceTree,
    archiveSha256: checked.release.archiveSha256,
    manifestSha256: checked.release.manifestSha256,
    serviceStartAuthorized: false,
    deleteAuthorized: false,
    execute: false
  });
}

async function readPrivateJson(pathValue) {
  const path = String(pathValue ?? '').trim();
  if (!isAbsolute(path)) fail('SUBSCRIPTIONS_DEV_HOST_INPUT_INVALID', 'Snapshot path must be absolute');
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => null);
  if (!handle) fail('SUBSCRIPTIONS_DEV_HOST_INPUT_INVALID', 'Snapshot file cannot be opened safely');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024) {
      fail('SUBSCRIPTIONS_DEV_HOST_INPUT_UNSAFE', 'Snapshot must be a private regular file');
    }
    return JSON.parse(await handle.readFile({ encoding: 'utf8' }));
  } catch (error) {
    if (error instanceof SubscriptionsDevHostContractError) throw error;
    fail('SUBSCRIPTIONS_DEV_HOST_INPUT_INVALID', 'Snapshot is not valid JSON');
  } finally { await handle.close().catch(() => undefined); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  readPrivateJson(process.env.SUBSCRIPTIONS_DEV_HOST_SNAPSHOT)
    .then(buildSubscriptionsDevSystemEvidence)
    .then((evidence) => process.stdout.write(JSON.stringify(evidence, null, 2) + '\n'))
    .catch((error) => {
      process.stderr.write((error instanceof SubscriptionsDevHostContractError
        ? error.code : 'SUBSCRIPTIONS_DEV_HOST_CHECK_FAILED') + '\n');
      process.exitCode = 1;
    });
}
