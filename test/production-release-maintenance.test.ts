import * as assert from 'node:assert/strict';
import { releaseMaintenanceEnabled } from '../src/common/release-maintenance';

const admittedEnvironment: NodeJS.ProcessEnv = {
  PHAB_RELEASE_MAINTENANCE_ENABLED: 'true',
  NODE_ENV: 'production',
  QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false',
  SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
  PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false',
  SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
  TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false',
  TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
  VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false',
  VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
  VIVA_REFERENCE_CACHE_ENABLED: 'false'
};

assert.equal(releaseMaintenanceEnabled({}), false, 'normal bootstrap remains the default');
assert.equal(releaseMaintenanceEnabled(admittedEnvironment), true, 'admitted maintenance selects the fenced bootstrap');
let verifiedGates = 0;
for (const key of Object.keys(admittedEnvironment)) {
  if (key === 'PHAB_RELEASE_MAINTENANCE_ENABLED') continue;
  const missing = { ...admittedEnvironment };
  delete missing[key];
  assert.throws(() => releaseMaintenanceEnabled(missing), new RegExp(`RELEASE_MAINTENANCE_CONFIGURATION:${key}`));
  const unsafe = {
    ...admittedEnvironment,
    [key]: key === 'NODE_ENV' ? 'test' : key.endsWith('_MS') ? '1000' : 'true'
  };
  assert.throws(() => releaseMaintenanceEnabled(unsafe), new RegExp(`RELEASE_MAINTENANCE_CONFIGURATION:${key}`));
  verifiedGates += 1;
}
assert.throws(
  () => releaseMaintenanceEnabled({ ...admittedEnvironment, PHAB_RELEASE_MAINTENANCE_ENABLED: 'yes' }),
  /RELEASE_MAINTENANCE_CONFIGURATION:PHAB_RELEASE_MAINTENANCE_ENABLED/
);
assert.equal(releaseMaintenanceEnabled({ ...admittedEnvironment, NODE_ENV: ' PRODUCTION ' }), true);
assert.equal(releaseMaintenanceEnabled({ PHAB_RELEASE_MAINTENANCE_ENABLED: 'false', NODE_ENV: 'test' }), false);
console.log(`Production release maintenance explicit gates verified: ${verifiedGates}`);
console.log('Production release maintenance selection test passed');
