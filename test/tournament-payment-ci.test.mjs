import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/subscriptions-binding-promotion.yml', import.meta.url),
  'utf8'
);

test('exact-head CI runs the fail-closed tournament payment regression closure', () => {
  for (const command of [
    'node --test test/tournament-payment-ci.test.mjs',
    'npx ts-node test/tournament-public-payment-binding.test.ts',
    'npx ts-node test/tournament-public-join-flow.test.ts',
    'npx ts-node test/tournament-public-payment-attempt-persistence.test.ts',
    'node --test test/tournament-public-pending-reconciliation.test.mjs',
    'npx ts-node test/viva-admin-payment-log-redaction.test.ts',
    'npx ts-node test/viva-admin-custom-energy-checkout.test.ts',
    'npx ts-node test/viva-admin-tournament-checkout-reuse.test.ts'
  ]) {
    assert.ok(workflow.includes(command), `Missing exact-head payment command: ${command}`);
  }
});

test('the payment Mongo fixture uses replica-set majority writes and cannot silently be skipped', () => {
  assert.match(workflow,
    /TEST_MONGODB_URI: mongodb:\/\/127\.0\.0\.1:27017\/\?replicaSet=rs0&retryWrites=true&w=majority\s+run: npx ts-node test\/tournament-public-payment-persistence\.mongodb\.test\.ts/);
});
