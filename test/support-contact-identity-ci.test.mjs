import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(
  new URL('../.github/workflows/subscriptions-binding-promotion.yml', import.meta.url),
  'utf8'
);

test('exact-head CI runs the contact isolation regression and affected support tests', () => {
  assert.equal(
    manifest.scripts['test:support-contact-identity'],
    'ts-node test/support-contact-identity-isolation.test.ts'
  );
  for (const command of [
    'node --test test/support-contact-identity-ci.test.mjs',
    'npm run test:support-contact-identity',
    'npm run test:support-client-resolve',
    'npm run test:support-dialog-resolution',
    'npm run test:support-outbox-max-attempts'
  ]) {
    assert.ok(workflow.includes(command), `Missing exact-head command: ${command}`);
  }
});

test('exact-head CI runs the physical Mongo process-restart regression', () => {
  assert.equal(
    manifest.scripts['test:support-contact-identity:mongo'],
    'ts-node test/support-contact-identity-isolation.mongodb.test.ts'
  );
  assert.match(
    workflow,
    /SUPPORT_IDENTITY_MONGODB_TEST_URI: mongodb:\/\/127\.0\.0\.1:27017\/\?replicaSet=rs0&retryWrites=true&w=majority\s+run: npm run test:support-contact-identity:mongo/
  );
});
