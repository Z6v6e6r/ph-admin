import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Role } from '../src/common/rbac/role.enum';

async function run(environment: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  const entrypoint = process.env.MAINTENANCE_TEST_COMPILED === 'true' ? ['dist/main.js'] : ['-r', require.resolve('ts-node/register'), 'src/main.ts'];
  const child = spawn(process.execPath, entrypoint, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-65536); });
  child.stderr.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-65536); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output }));
    });
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

async function main(): Promise<void> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env, HOST: '127.0.0.1', PORT: '3000', NODE_ENV: 'production', MONGODB_URI: '',
    ADMIN_AUTH_ENABLED: 'true', ADMIN_AUTH_SECRET: 'synthetic-maintenance-entrypoint-key',
    ADMIN_AUTH_USERS_JSON: JSON.stringify([{ id: 'fixture', login: 'fixture', password: 'unused', roles: [Role.SUPER_ADMIN] }]),
    QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false', SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
    PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false', SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
    TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false', TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
    VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false', VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
    VIVA_REFERENCE_CACHE_ENABLED: 'false'
  };
  const invalid = await run({ ...environment, PHAB_RELEASE_MAINTENANCE_ENABLED: 'invalid' });
  assert.ok(invalid.output.includes('RELEASE_MAINTENANCE_CONFIGURATION:PHAB_RELEASE_MAINTENANCE_ENABLED'), 'real main must reject an invalid selector before startup');
  assert.equal(invalid.code, 1);
  assert.equal(invalid.output.includes('Starting Nest application'), false);
  const missingGate = await run({ ...environment, PHAB_RELEASE_MAINTENANCE_ENABLED: 'true', NODE_ENV: '' });
  assert.ok(missingGate.output.includes('RELEASE_MAINTENANCE_CONFIGURATION:NODE_ENV'));
  assert.equal(missingGate.code, 1);
  assert.equal(missingGate.output.includes('Starting Nest application'), false);
  const unavailableAuth = await run({ ...environment, PHAB_RELEASE_MAINTENANCE_ENABLED: 'true' });
  assert.ok(unavailableAuth.output.includes('RELEASE_MAINTENANCE_AUTH_NOT_READY'));
  assert.equal(unavailableAuth.code, 1);
  assert.equal(unavailableAuth.output.includes('TournamentsModule dependencies initialized'), false);
  console.log(`Real ${process.env.MAINTENANCE_TEST_COMPILED === 'true' ? 'compiled' : 'TypeScript'} main fail-closed selection/gates/auth tests passed (child processes, no Mongo connection)`);
}
main().catch((error) => { console.error(error); process.exit(1); });
