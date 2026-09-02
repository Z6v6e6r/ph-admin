import * as assert from 'node:assert/strict';
import {
  assertSubscriptionInstanceDevCanaryBoundary,
  parseSubscriptionInstanceDevCanaryInput
} from '../scripts/managed-subscriptions-instance-projector-dev-canary';
import {
  buildSubscriptionInstanceProjectionPlan,
  subscriptionInstanceProjectionTargetFingerprint
} from '../src/subscriptions/subscription-provider-instance-projector.service';
import { SubscriptionRuntimeContractError } from '../src/subscriptions/subscription-runtime-contracts';
import {
  manifestForHistory,
  PEPPER,
  record,
  twoPublicationHistory
} from './subscriptions-provider-instance-projector.test';

const history = twoPublicationHistory();
const records = [{
  ...record(),
  providerClientId: 'provider-client-canary-v1',
  clientSubscriptionId: 'client-subscription-canary-v1',
  purchasedAt: '2026-08-14T23:59:59.999Z',
  activeFrom: '2026-08-14T23:59:59.999Z',
  activeTo: '2027-08-14T23:59:59.999Z'
}, {
  ...record(),
  providerClientId: 'provider-client-canary-v2',
  clientSubscriptionId: 'client-subscription-canary-v2',
  purchasedAt: '2026-08-15T00:00:00.000Z',
  activeFrom: '2026-08-15T00:00:00.000Z',
  activeTo: '2027-08-15T00:00:00.000Z'
}];
const productionShaped = manifestForHistory(records, history);
const projectionInput = {
  ...productionShaped,
  schemaVersion: 3,
  sourceMode: 'DEV_VIVA_EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST',
  authority: {
    ...(productionShaped.authority as Record<string, unknown>),
    selectionMode: 'EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST',
    snapshotSemantics: 'EXACT_ALLOWLIST_AS_OF'
  }
};
const canaryInput = {
  schemaVersion: 1,
  sourceMode: 'DEV_EXACT_CLIENT_SUBSCRIPTION_CANARY',
  allowlistedClientSubscriptionIds: records.map((item) => String(item.clientSubscriptionId)),
  projectionInput
};

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof SubscriptionRuntimeContractError && error.code === code;

const parsed = parseSubscriptionInstanceDevCanaryInput(canaryInput);
assert.deepEqual(
  [...parsed.allowlistedClientSubscriptionIds].sort(),
  ['client-subscription-canary-v1', 'client-subscription-canary-v2']
);
const plan = buildSubscriptionInstanceProjectionPlan(
  projectionInput,
  PEPPER,
  history,
  'DEV_EXACT_ALLOWLIST'
);
assert.equal(plan.checkpoint.coverage.kind, 'EXACT_ALLOWLIST_CANARY');
assert.deepEqual(
  plan.instances.map((instance) => [instance.clientSubscriptionId, instance.policyVersion]).sort(),
  [
    ['client-subscription-canary-v1', 1],
    ['client-subscription-canary-v2', 2]
  ]
);

assert.throws(
  () => parseSubscriptionInstanceDevCanaryInput({
    ...canaryInput,
    allowlistedClientSubscriptionIds: [
      'client-subscription-canary-v1',
      'client-subscription-not-in-input'
    ]
  }),
  hasCode('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_ALLOWLIST_MISMATCH')
);

const uri = 'mongodb://127.0.0.1:27017/';
const database = 'test-subscription-canary';
const targetSha256 = subscriptionInstanceProjectionTargetFingerprint(uri, database);
const baseEnv = {
  NODE_ENV: 'test',
  SUBSCRIPTIONS_MONGODB_URI: uri,
  SUBSCRIPTIONS_MONGODB_DB: database,
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_ID: 'test-subscription-projector',
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ID: 'fixture:test:subscription-projector',
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_NONCE_SHA256: `sha256:${'9'.repeat(64)}`,
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_SHA256: targetSha256,
  SUBSCRIPTIONS_INSTANCE_DEV_CANARY_APPLY_CONFIRM: 'APPLY_EXACTLY_TWO_DEV_SUBSCRIPTION_INSTANCES',
  SUBSCRIPTIONS_AUTO_CREATE_INDEXES: 'false'
};
assert.doesNotThrow(() => assertSubscriptionInstanceDevCanaryBoundary(canaryInput, baseEnv));
assert.throws(
  () => assertSubscriptionInstanceDevCanaryBoundary(canaryInput, {
    ...baseEnv,
    SUBSCRIPTIONS_MONGODB_URI: 'mongodb://prod-db.internal:27017/',
    SUBSCRIPTIONS_MONGODB_DB: 'production',
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_ID: 'prod-subscription-projector',
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_SHA256:
      subscriptionInstanceProjectionTargetFingerprint('mongodb://prod-db.internal:27017/', 'production')
  }),
  hasCode('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_SERVICE_FORBIDDEN')
);
assert.throws(
  () => assertSubscriptionInstanceDevCanaryBoundary(canaryInput, {
    ...baseEnv,
    SUBSCRIPTIONS_MONGODB_URI: 'mongodb://user:secret@127.0.0.1:27017/'
  }),
  hasCode('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_TARGET_FORBIDDEN')
);
assert.throws(
  () => assertSubscriptionInstanceDevCanaryBoundary(canaryInput, {
    ...baseEnv,
    SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_NONCE_SHA256: ''
  }),
  hasCode('SUBSCRIPTIONS_INSTANCE_DEV_CANARY_FIXTURE_ATTESTATION_REQUIRED')
);

console.log('subscriptions instance DEV canary tests passed');
