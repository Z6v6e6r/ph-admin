import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

interface CapturedCall {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options: Record<string, unknown>;
}

async function verifyExplicitClientWriteConcern(): Promise<void> {
  const envKeys = ['TOURNAMENTS_MONGODB_URI', 'MONGODB_URI', 'TOURNAMENTS_MONGODB_DB'] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const originalConnect = MongoClient.prototype.connect;
  const clients: MongoClient[] = [];
  const connectionIntercepted = new Error('Options-only test: do not connect');
  MongoClient.prototype.connect = async function () {
    clients.push(this);
    throw connectionIntercepted;
  };
  try {
    for (const [uriKey, query] of [
      ['TOURNAMENTS_MONGODB_URI', ''],
      ['TOURNAMENTS_MONGODB_URI', '?w=1&journal=false'],
      ['MONGODB_URI', '?w=0&journal=false']
    ] as const) {
      delete process.env.TOURNAMENTS_MONGODB_URI;
      delete process.env.MONGODB_URI;
      process.env[uriKey] = 'mongodb:' + '//127.0.0.1:1/' + query;
      process.env.TOURNAMENTS_MONGODB_DB = 'phab_payment_binding_options_only';
      const repository = new TournamentsPersistenceService();
      await assert.rejects(
        () => repository.findCustomTournamentById('options-only'),
        (error) => error === connectionIntercepted
      );
      const client = clients.at(-1);
      assert.ok(client, 'the real Mongo driver constructor must be exercised');
      assert.equal(client.options.writeConcern?.w, 'majority', 'payment writes require explicit majority');
      assert.equal(client.options.writeConcern?.j, true, 'payment acknowledgments must wait for journal');
      assert.equal(client.options.writeConcern?.wtimeoutMS, 5000, 'replication acknowledgment wait is bounded');
      await repository.onModuleDestroy();
    }
  } finally {
    MongoClient.prototype.connect = originalConnect;
    for (const key of envKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    await Promise.all(clients.map((client) => client.close()));
  }
}

async function main(): Promise<void> {
  await verifyExplicitClientWriteConcern();
  const calls: CapturedCall[] = [];
  const repository = new TournamentsPersistenceService();
  (repository as unknown as {
    collection: () => Promise<{
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: Record<string, unknown>
      ) => Promise<null>;
    }>;
  }).collection = async () => ({
    findOneAndUpdate: async (filter, update, options) => {
      calls.push({ filter, update, options });
      return null;
    }
  });

  await repository.reservePublicJoinPayment('cup-1', {
    transactionId: 'attempt-1',
    phone: '79990001111',
    state: 'PROVIDER_CREATE_PENDING'
  });
  const reserveJson = JSON.stringify(calls.at(-1));
  assert.match(reserveJson, /PROVIDER_CREATE_PENDING/);
  assert.match(reserveJson, /PROVIDER_RESULT_UNKNOWN/);

  await repository.claimPublicJoinTransactionCreate(
    'cup-1', 'attempt-1', '79990001111', '2026-08-25T08:00:00.000Z'
  );
  const claimJson = JSON.stringify(calls.at(-1));
  assert.match(claimJson, /PROVIDER_CREATE_PENDING/);
  assert.match(claimJson, /PROVIDER_RESULT_UNKNOWN/);
  assert.match(claimJson, /providerCreateAttemptedAt/);

  await repository.recordPublicJoinTransactionProviderIdentity(
    'cup-1', 'attempt-1', '79990001111', 'provider-transaction-1'
  );
  const identityJson = JSON.stringify(calls.at(-1));
  assert.match(identityJson, /providerTransactionId/);
  assert.match(identityJson, /provider-transaction-1/);
  assert.match(identityJson, /PROVIDER_RESULT_UNKNOWN/);

  await repository.bindPublicJoinTransaction(
    'cup-1',
    'attempt-1',
    '79990001111',
    'provider-transaction-1',
    {
      checkoutUrl: 'https://pay.example/1',
      amountMinor: 250000,
      paymentExpiresAt: '2026-08-25T09:00:00.000Z'
    }
  );
  const bindJson = JSON.stringify(calls.at(-1));
  assert.match(bindJson, /provider-transaction-1/);
  assert.match(bindJson, /PENDING_PAYMENT/);
  assert.match(bindJson, /250000/);

  console.log('Tournament public payment attempt persistence contract test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
