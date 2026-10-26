import * as assert from 'node:assert/strict';
import { maxFailure } from '../src/support/max-outbox-policy';

for (const [status, code] of [[403, 'dialog.suspended'], [404, 'chat.not.found']] as const) {
  const failure = maxFailure({ status, code, message: 'private provider text', target: 'private target' }, 0);
  assert.equal(failure.category, 'PROVIDER_REFUSED');
  assert.equal(failure.status, status);
  assert.equal(failure.code, code);
  assert.ok(!JSON.stringify(failure).includes('private'));
}
assert.equal(maxFailure({ status: 403, code: 'untrusted-description' }, 0).code, 'unclassified');
assert.equal(maxFailure({ status: 429, code: 'dialog.suspended' }, 0).category, 'RATE_LIMITED');
assert.equal(maxFailure({ status: 503, code: 'dialog.suspended' }, 0).category, 'DELIVERY_UNKNOWN');
assert.equal(maxFailure({ status: null, code: 'dialog.suspended' }, 0).category, 'DELIVERY_UNKNOWN');
console.log('MAX observed provider refusals: classification and privacy PASS');
