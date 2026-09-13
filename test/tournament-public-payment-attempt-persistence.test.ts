import * as assert from 'node:assert/strict';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

interface CapturedCall {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options: Record<string, unknown>;
}

async function main(): Promise<void> {
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

  await repository.failPublicJoinTransactionCreate(
    'cup-1',
    'attempt-2',
    '79990002222',
    '2026-08-25T08:01:00.000Z',
    'VIVA_HTTP_400'
  );
  const failedJson = JSON.stringify(calls.at(-1));
  assert.match(failedJson, /FAILED/);
  assert.match(failedJson, /VIVA_HTTP_400/);

  console.log('Tournament public payment attempt persistence contract test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
