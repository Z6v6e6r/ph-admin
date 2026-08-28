import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMissingSubscriptionIndexes,
  uniqueIndexesRequiringDuplicatePreflight
} from '../scripts/managed-subscriptions-indexes-core.mjs';

const ID_INDEX = [
  'subscription_instance_projector_checkpoints',
  { checkpointId: 1 },
  { unique: true, name: 'subscription_instance_projector_checkpoint_id_unique' }
];
const SCOPE_INDEX = [
  'subscription_instance_projector_checkpoints',
  { tenantId: 1, providerProductId: 1 },
  { unique: true, name: 'subscription_instance_projector_checkpoint_provider_scope_unique' }
];
const READ_INDEX = [
  'subscription_instance_projector_checkpoints',
  { state: 1, updatedAt: 1 },
  { name: 'subscription_instance_projector_checkpoint_read' }
];

function actual([, key, options]) {
  return { key, ...options };
}

test('exact existing index is skipped and same-name definition drift is rejected', () => {
  const existing = new Map([
    ['subscription_instance_projector_checkpoints', [actual(ID_INDEX)]]
  ]);
  assert.deepEqual(classifyMissingSubscriptionIndexes([ID_INDEX], existing), []);

  const drifted = new Map([
    ['subscription_instance_projector_checkpoints', [{
      ...actual(ID_INDEX),
      key: { wrong: 1 }
    }]]
  ]);
  assert.throws(
    () => classifyMissingSubscriptionIndexes([ID_INDEX], drifted),
    /SUBSCRIPTIONS_INDEX_DRIFT:subscription_instance_projector_checkpoints:/
  );
});

test('duplicate preflight receives only missing unique indexes', () => {
  const existing = new Map([
    ['subscription_instance_projector_checkpoints', [actual(ID_INDEX)]]
  ]);
  const missing = classifyMissingSubscriptionIndexes([ID_INDEX, SCOPE_INDEX, READ_INDEX], existing);
  assert.deepEqual(missing, [SCOPE_INDEX, READ_INDEX]);
  assert.deepEqual(uniqueIndexesRequiringDuplicatePreflight(missing), [SCOPE_INDEX]);
});

test('partial apply rerun plans only the remaining index and then becomes a no-op', () => {
  const afterFirstIndex = new Map([
    ['subscription_instance_projector_checkpoints', [actual(ID_INDEX)]]
  ]);
  assert.deepEqual(
    classifyMissingSubscriptionIndexes([ID_INDEX, SCOPE_INDEX], afterFirstIndex),
    [SCOPE_INDEX]
  );

  const afterCompleteApply = new Map([
    ['subscription_instance_projector_checkpoints', [actual(ID_INDEX), actual(SCOPE_INDEX)]]
  ]);
  assert.deepEqual(
    classifyMissingSubscriptionIndexes([ID_INDEX, SCOPE_INDEX], afterCompleteApply),
    []
  );
});
