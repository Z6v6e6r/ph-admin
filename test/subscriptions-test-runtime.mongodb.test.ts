import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { SubscriptionsRepository } from '../src/subscriptions/subscriptions.repository';
import {
  StoredSubscriptionTestInventory,
  StoredSubscriptionTestPurchase
} from '../src/subscriptions/subscriptions.types';

const uri = process.env.SUBSCRIPTIONS_TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27029/?directConnection=true';
const dbName = `phab_subscriptions_runtime_test_${process.pid}_${Date.now()}`;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function dropExactTestDatabase(): Promise<void> {
  assert.match(dbName, /^phab_subscriptions_runtime_test_[0-9]+_[0-9]+$/);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const original = {
    uri: process.env.SUBSCRIPTIONS_MONGODB_URI,
    db: process.env.SUBSCRIPTIONS_MONGODB_DB,
    runtime: process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED,
    indexes: process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES,
    nodeEnv: process.env.NODE_ENV
  };
  process.env.SUBSCRIPTIONS_MONGODB_URI = uri;
  process.env.SUBSCRIPTIONS_MONGODB_DB = dbName;
  process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_AUTO_CREATE_INDEXES = 'true';
  process.env.NODE_ENV = 'test';
  const repository = new SubscriptionsRepository();
  try {
    await repository.connect();
    const now = '2026-08-14T10:00:00.000Z';
    const inventory: StoredSubscriptionTestInventory = {
      schemaVersion: 1,
      offerId: 'test_offer:mongo-concurrency',
      currentPhaseOrder: 1,
      phases: [
        {
          phaseId: 'phase:1', order: 1, activation: 'MANUAL', totalQuantity: 1,
          price: { amountMinor: 1_980_000, currency: 'RUB' },
          available: 1, reserved: 0, sold: 0, refunded: 0
        },
        {
          phaseId: 'phase:2', order: 2, activation: 'PREVIOUS_SOLD_OUT', totalQuantity: 1,
          price: { amountMinor: 2_380_000, currency: 'RUB' },
          available: 0, reserved: 0, sold: 0, refunded: 0
        }
      ],
      purchaseMarkers: {},
      clientClaimCounts: {},
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    await repository.insertTestInventory(inventory);

    const reserveResults = await Promise.all(Array.from({ length: 100 }, (_, index) =>
      repository.reserveTestInventory({
        offerId: inventory.offerId,
        phaseId: 'phase:1',
        phaseOrder: 1,
        purchaseMarkerKey: `marker_${index}`,
        clientClaimKey: `client_${index}`,
        purchaseLimitPerClient: 1,
        now
      })
    ));
    const winnerIndex = reserveResults.findIndex(Boolean);
    assert.ok(winnerIndex >= 0, 'one Mongo CAS reserve must win');
    assert.equal(reserveResults.filter(Boolean).length, 1, 'exactly one Mongo CAS reserve may win');

    let stored = await repository.testInventoryByOfferId(inventory.offerId);
    assert.ok(stored);
    assert.deepEqual(
      [stored.phases[0].available, stored.phases[0].reserved, stored.phases[0].sold],
      [0, 1, 0]
    );

    const finalizeResults = await Promise.all(Array.from({ length: 50 }, () =>
      repository.finalizeTestInventory({
        offerId: inventory.offerId,
        phaseId: 'phase:1',
        purchaseMarkerKey: `marker_${winnerIndex}`,
        clientClaimKey: `client_${winnerIndex}`,
        outcome: 'PAID',
        now
      })
    ));
    assert.equal(finalizeResults.filter(Boolean).length, 1, 'exactly one Mongo capture may win');
    stored = await repository.testInventoryByOfferId(inventory.offerId);
    assert.ok(stored);
    assert.deepEqual(
      [stored.phases[0].available, stored.phases[0].reserved, stored.phases[0].sold],
      [0, 0, 1]
    );
    assert.ok(stored.phases.every((phase) => phase.available >= 0 && phase.reserved >= 0 && phase.sold >= 0));

    const rolloverResults = await Promise.all(Array.from({ length: 20 }, () =>
      repository.activateNextTestPhase({
        offerId: inventory.offerId,
        expectedRevision: stored?.revision ?? -1,
        currentPhaseOrder: 1,
        nextPhaseOrder: 2,
        nextPhaseId: 'phase:2',
        nextTotalQuantity: 1,
        now
      })
    ));
    assert.equal(rolloverResults.filter(Boolean).length, 1, 'exactly one phase rollover CAS may win');
    stored = await repository.testInventoryByOfferId(inventory.offerId);
    assert.equal(stored?.currentPhaseOrder, 2);
    assert.equal(stored?.phases[1].available, 1);

    const crashMarker = 'crash_marker';
    const crashClient = 'crash_client';
    const crashPurchaseId = 'test_purchase:crash-recovery';
    const crashReserved = await repository.reserveTestInventory({
      offerId: inventory.offerId,
      phaseId: 'phase:2',
      phaseOrder: 2,
      purchaseMarkerKey: crashMarker,
      clientClaimKey: crashClient,
      purchaseLimitPerClient: 1,
      now
    });
    assert.ok(crashReserved);
    const expiredAt = '2000-01-01T00:00:00.000Z';
    const crashPurchase: StoredSubscriptionTestPurchase = {
      schemaVersion: 1,
      purchaseId: crashPurchaseId,
      offerId: inventory.offerId,
      phaseId: 'phase:2',
      phaseOrder: 2,
      accessTokenHash: 'a'.repeat(64),
      clientRefHash: 'b'.repeat(64),
      status: 'CREATING',
      priceSnapshot: { amountMinor: 2_380_000, currency: 'RUB' },
      expiresAt: expiredAt,
      testOnly: true,
      providerMode: 'FAKE',
      createdAt: expiredAt,
      updatedAt: expiredAt,
      inventoryFinalizedAt: null,
      idempotency: {
        keyHash: 'c'.repeat(64),
        requestHash: 'd'.repeat(64),
        correlationId: 'mongo-crash-recovery'
      },
      confirmationCommands: {}
    };
    await repository.insertTestPurchase(crashPurchase);
    const expiredCreating = await repository.listExpiredTestPurchases(
      inventory.offerId,
      now,
      10
    );
    assert.equal(expiredCreating.some((row) => row.purchaseId === crashPurchaseId), true);
    const expired = await repository.transitionTestPurchase({
      purchaseId: crashPurchaseId,
      from: 'CREATING',
      to: 'EXPIRED',
      updatedAt: now
    });
    assert.equal(expired?.status, 'EXPIRED');
    const unreconciled = await repository.listUnfinalizedTerminalTestPurchases(
      inventory.offerId,
      10
    );
    assert.equal(unreconciled.some((row) => row.purchaseId === crashPurchaseId), true);
    const crashReleased = await repository.finalizeTestInventory({
      offerId: inventory.offerId,
      phaseId: 'phase:2',
      purchaseMarkerKey: crashMarker,
      clientClaimKey: crashClient,
      outcome: 'EXPIRED',
      now
    });
    assert.deepEqual(
      [crashReleased?.phases[1].available, crashReleased?.phases[1].reserved],
      [1, 0]
    );
    await repository.markTestPurchaseInventoryFinalized({
      purchaseId: crashPurchaseId,
      status: 'EXPIRED',
      finalizedAt: now
    });
    assert.equal(
      (await repository.listUnfinalizedTerminalTestPurchases(inventory.offerId, 10))
        .some((row) => row.purchaseId === crashPurchaseId),
      false
    );
    console.log('Subscription test runtime Mongo concurrency tests passed');
  } finally {
    await repository.close();
    await dropExactTestDatabase().catch((error) => {
      console.error(`Failed to drop exact test database ${dbName}`, error);
      throw error;
    });
    restoreEnv('SUBSCRIPTIONS_MONGODB_URI', original.uri);
    restoreEnv('SUBSCRIPTIONS_MONGODB_DB', original.db);
    restoreEnv('SUBSCRIPTIONS_TEST_RUNTIME_ENABLED', original.runtime);
    restoreEnv('SUBSCRIPTIONS_AUTO_CREATE_INDEXES', original.indexes);
    restoreEnv('NODE_ENV', original.nodeEnv);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
