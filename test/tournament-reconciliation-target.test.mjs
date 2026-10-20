import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = new URL('../scripts/reconcile-public-tournament-pending-payments.mjs', import.meta.url);

test('recovery refuses an implicit database before attempting a connection', () => {
  const result = spawnSync(process.execPath, [script.pathname], {
    env: { PATH: process.env.PATH, TOURNAMENTS_MONGODB_URI: 'mongodb://127.0.0.1:1/' },
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TOURNAMENTS_MONGODB_DB must be explicitly configured/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
});
