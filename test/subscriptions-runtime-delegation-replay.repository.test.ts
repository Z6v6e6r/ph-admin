import * as assert from 'node:assert/strict';
import { MongoServerError } from 'mongodb';
import {
  SubscriptionsRepository,
  subscriptionRuntimeDelegationIndexesRequired
} from '../src/subscriptions/subscriptions.repository';
import { SubscriptionRuntimeContractError } from
  '../src/subscriptions/subscription-runtime-contracts';

class ReplayRepository extends SubscriptionsRepository {
  classifyReplayDuplicate(error: unknown): boolean {
    return this.isRuntimeDelegationReplayDuplicate(error);
  }
}

const expectedDuplicate = new MongoServerError({
  code: 11000,
  errmsg: 'E11000 duplicate key error collection: test.replays index: subscription_runtime_delegation_issuer_jti_unique dup key: { issuer: "issuer", jti: "jti" }',
  keyPattern: { issuer: 1, jti: 1 }
});
const unknownDuplicate = new MongoServerError({
  code: 11000,
  errmsg: 'E11000 duplicate key error collection: test.replays index: unexpected_unique dup key: { consumedAt: new Date(0) }',
  keyPattern: { consumedAt: 1 }
});

async function run(): Promise<void> {
  assert.equal(subscriptionRuntimeDelegationIndexesRequired({}), false);
  assert.equal(subscriptionRuntimeDelegationIndexesRequired({
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true'
  }), false);
  assert.equal(subscriptionRuntimeDelegationIndexesRequired({
    SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED: 'true',
    SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED: 'true'
  }), true);
  const original = process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  const originalDelegation = process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED = 'true';
  const consumed = new Set<string>();
  const repository = new ReplayRepository();
  assert.equal(repository.classifyReplayDuplicate(expectedDuplicate), true);
  assert.equal(repository.classifyReplayDuplicate(unknownDuplicate), false);
  assert.equal(repository.classifyReplayDuplicate(new Error('storage unavailable')), false);
  (repository as any).db = {
    collection: (name: string) => {
      assert.equal(name, 'subscription_runtime_delegation_replays');
      return {
        insertOne: async (
          document: { issuer: string; jti: string },
          options: {
            timeoutMS?: number;
            writeConcern?: { w?: string; wtimeoutMS?: number };
          }
        ) => {
          assert.deepEqual(options, {
            timeoutMS: 5_000,
            writeConcern: { w: 'majority', wtimeoutMS: 5_000 }
          });
          const key = `${document.issuer}\0${document.jti}`;
          if (consumed.has(key)) throw expectedDuplicate;
          consumed.add(key);
        }
      };
    }
  };

  const document = {
    issuer: 'https://api.padlhub.invalid/subscription-runtime-delegation',
    jti: '11111111-1111-4111-8111-111111111111',
    consumedAt: new Date('2026-08-24T12:00:00.000Z'),
    expiresAt: new Date('2026-08-24T12:00:30.000Z')
  };
  assert.equal(await repository.consumeRuntimeDelegationReplay(document), 'CONSUMED');
  assert.equal(await repository.consumeRuntimeDelegationReplay(document), 'REPLAY');
  await assert.rejects(
    repository.consumeRuntimeDelegationReplay({
      ...document,
      jti: '22222222-2222-4222-8222-222222222222',
      expiresAt: document.consumedAt
    }),
    (error: unknown) => error instanceof SubscriptionRuntimeContractError
      && error.code === 'SUBSCRIPTION_RUNTIME_DELEGATION_REPLAY_INVALID'
  );

  if (original === undefined) delete process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED;
  else process.env.SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED = original;
  if (originalDelegation === undefined) {
    delete process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED;
  } else {
    process.env.SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED = originalDelegation;
  }
  console.log('subscriptions runtime delegation replay repository tests: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
