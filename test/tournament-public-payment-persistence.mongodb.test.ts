import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

async function main(): Promise<void> {
  const mongoUri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27029';
  const databaseName = `phab_payment_binding_${randomUUID().replace(/-/g, '')}`;
  const collectionName = 'custom_tournaments';
  if (!databaseName.startsWith('phab_payment_binding_')) {
    throw new Error('Unsafe test database name');
  }
  process.env.TOURNAMENTS_MONGODB_URI = mongoUri;
  process.env.TOURNAMENTS_MONGODB_DB = databaseName;
  process.env.TOURNAMENTS_MONGODB_COLLECTION = collectionName;

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2000 });
  const repository = new TournamentsPersistenceService();
  await client.connect();
  const collection = client.db(databaseName).collection(collectionName);
  await collection.insertOne({
    id: 'atomic-payment-cup',
    source: 'CUSTOM',
    slug: 'atomic-payment-cup',
    publicUrl: '/api/tournaments/public/atomic-payment-cup',
    name: 'Atomic Payment Cup',
    status: 'REGISTRATION',
    tournamentType: 'Американо',
    accessLevels: ['C'],
    gender: 'MIXED',
    maxPlayers: 2,
    participants: [{
      name: 'Existing player',
      phone: '79990003000',
      paymentStatus: 'UNPAID',
      status: 'REGISTERED'
    }],
    waitlist: [],
    allowedManagerPhones: [],
    skin: {},
    mechanics: { enabled: false, config: {} },
    details: {
      booking: {
        vivaWidgetId: 'widget',
        vivaExerciseId: 'exercise',
        vivaStudioId: 'studio',
        pendingJoinPayments: []
      }
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const pending = (transactionId: string, phone: string) => ({
    transactionId,
    state: 'PENDING_PAYMENT',
    phone,
    selectedPurchaseOptionId: 'product',
    productType: 'SERVICE',
    exerciseId: 'exercise',
    studioId: 'studio',
    widgetId: 'widget',
    amountMinor: 250000,
    currency: 'RUB',
    eligibilitySnapshot: {
      decisionId: randomUUID(),
      playerId: phone,
      activityId: 'atomic-payment-cup',
      activityType: 'TOURNAMENT',
      policyVersion: 1,
      levelScaleVersion: 1,
      result: 'ALLOWED',
      reasonCode: 'LEVEL_ALLOWED',
      evaluatedAt: new Date().toISOString()
    },
    createdAt: new Date().toISOString()
  });

  try {
    const [first, second] = await Promise.all([
      repository.reservePublicJoinPayment(
        'atomic-payment-cup',
        pending('transaction-a', '79990003001')
      ),
      repository.reservePublicJoinPayment(
        'atomic-payment-cup',
        pending('transaction-b', '79990003002')
      )
    ]);
    assert.equal([first, second].filter(Boolean).length, 1, 'only one final seat is reserved');
    const storedAfterReserve = await collection.findOne({ id: 'atomic-payment-cup' });
    const storedPending = storedAfterReserve?.details?.booking?.pendingJoinPayments as Array<Record<string, unknown>>;
    assert.equal(storedPending.length, 1);
    const winner = storedPending[0];
    const transactionId = String(winner?.transactionId);
    const phone = String(winner?.phone);

    const markedPaid = await repository.markPublicJoinPaymentPaid(
      'atomic-payment-cup',
      transactionId,
      phone,
      {
        provider: 'VIVA',
        operationType: 'TRANSACTION',
        operationId: transactionId,
        status: 'PAID',
        exerciseId: 'exercise',
        phone,
        amountMinor: 250000,
        currency: 'RUB',
        verifiedAt: new Date().toISOString()
      }
    );
    assert.ok(markedPaid);
    const markedBooking = (markedPaid?.details?.booking ?? {}) as Record<string, unknown>;
    const markedPending = markedBooking.pendingJoinPayments as Array<Record<string, unknown>>;
    assert.equal(
      markedPending[0]?.state,
      'PAID_PENDING_FINALIZATION'
    );

    const finalized = await repository.finalizePublicJoinPayment(
      'atomic-payment-cup',
      transactionId,
      phone,
      {
        id: transactionId,
        name: 'Paid player',
        phone,
        paymentStatus: 'PAID',
        status: 'REGISTERED',
        registeredAt: new Date().toISOString(),
        paidAt: new Date().toISOString()
      }
    );
    assert.ok(finalized);
    assert.equal(finalized?.participants.length, 2);
    const storedAfterFinalize = await collection.findOne({ id: 'atomic-payment-cup' });
    assert.equal(storedAfterFinalize?.participants?.length, 2);
    assert.equal(storedAfterFinalize?.details?.booking?.pendingJoinPayments?.length, 0);

    const replay = await repository.finalizePublicJoinPayment(
      'atomic-payment-cup',
      transactionId,
      phone,
      {
        name: 'Duplicate',
        phone,
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      }
    );
    assert.equal(replay, null);
    const storedAfterReplay = await collection.findOne({ id: 'atomic-payment-cup' });
    assert.equal(storedAfterReplay?.participants?.length, 2);

    await collection.insertOne({
      id: 'provider-attempt-cup',
      source: 'CUSTOM',
      slug: 'provider-attempt-cup',
      publicUrl: '/api/tournaments/public/provider-attempt-cup',
      name: 'Provider Attempt Cup',
      status: 'REGISTRATION',
      tournamentType: 'Американо',
      accessLevels: ['C'],
      gender: 'MIXED',
      maxPlayers: 2,
      participants: [{ name: 'Existing', phone: '79990003500', status: 'REGISTERED' }],
      waitlist: [],
      allowedManagerPhones: [],
      skin: {},
      mechanics: { enabled: false, config: {} },
      details: { booking: { pendingJoinPayments: [] } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const attemptId = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'provider-attempt-cup',
      {
        ...pending(attemptId, '79990003501'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(attemptId, '79990003501').eligibilitySnapshot,
          activityId: 'provider-attempt-cup'
        }
      }
    ));
    const claimAt = new Date().toISOString();
    const claims = await Promise.all([
      repository.claimPublicJoinTransactionCreate(
        'provider-attempt-cup', attemptId, '79990003501', claimAt
      ),
      repository.claimPublicJoinTransactionCreate(
        'provider-attempt-cup', attemptId, '79990003501', claimAt
      )
    ]);
    assert.equal(claims.filter(Boolean).length, 1, 'only one provider POST claim is granted');
    assert.equal(
      (await collection.findOne({ id: 'provider-attempt-cup' }))
        ?.details?.booking?.pendingJoinPayments?.[0]?.state,
      'PROVIDER_RESULT_UNKNOWN'
    );
    assert.ok(await repository.recordPublicJoinTransactionProviderIdentity(
      'provider-attempt-cup',
      attemptId,
      '79990003501',
      'provider-transaction-1'
    ));
    assert.ok(await repository.bindPublicJoinTransaction(
      'provider-attempt-cup',
      attemptId,
      '79990003501',
      'provider-transaction-1',
      {
        checkoutUrl: 'https://pay.example/provider-transaction-1',
        amountMinor: 250000,
        paymentExpiresAt: new Date(Date.now() + 1_200_000).toISOString()
      }
    ));
    const boundAttempt = (await collection.findOne({ id: 'provider-attempt-cup' }))
      ?.details?.booking?.pendingJoinPayments?.[0];
    assert.equal(boundAttempt?.transactionId, attemptId);
    assert.equal(boundAttempt?.providerTransactionId, 'provider-transaction-1');
    assert.equal(boundAttempt?.state, 'PENDING_PAYMENT');

    await collection.insertOne({
      id: 'ordinary-race-cup',
      source: 'CUSTOM',
      slug: 'ordinary-race-cup',
      publicUrl: '/api/tournaments/public/ordinary-race-cup',
      name: 'Ordinary Race Cup',
      status: 'REGISTRATION',
      tournamentType: 'Американо',
      accessLevels: ['C'],
      gender: 'MIXED',
      maxPlayers: 2,
      participants: [{ name: 'Existing', phone: '79990004000', status: 'REGISTERED' }],
      waitlist: [],
      allowedManagerPhones: [],
      skin: {},
      mechanics: { enabled: false, config: {} },
      details: { booking: { pendingJoinPayments: [] } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const [paymentReservation, ordinaryAppend] = await Promise.all([
      repository.reservePublicJoinPayment(
        'ordinary-race-cup',
        {
          ...pending('transaction-race', '79990004001'),
          eligibilitySnapshot: {
            ...pending('transaction-race', '79990004001').eligibilitySnapshot,
            activityId: 'ordinary-race-cup'
          }
        }
      ),
      repository.appendPublicParticipantIfCapacity(
        'ordinary-race-cup',
        '79990004002',
        { name: 'Ordinary', phone: '79990004002', status: 'REGISTERED' }
      )
    ]);
    assert.equal(
      [paymentReservation, ordinaryAppend].filter(Boolean).length,
      1,
      'ordinary join and paid reservation share one atomic capacity gate'
    );
    const raceStored = await collection.findOne({ id: 'ordinary-race-cup' });
    assert.equal(
      Number(raceStored?.participants?.length ?? 0)
        + Number(raceStored?.details?.booking?.pendingJoinPayments?.length ?? 0),
      2
    );

    await collection.insertOne({
      id: 'expired-payment-cup',
      source: 'CUSTOM',
      slug: 'expired-payment-cup',
      publicUrl: '/api/tournaments/public/expired-payment-cup',
      name: 'Expired Payment Cup',
      status: 'REGISTRATION',
      tournamentType: 'Американо',
      accessLevels: ['C'],
      gender: 'MIXED',
      maxPlayers: 2,
      participants: [{ name: 'Existing', phone: '79990005000', status: 'REGISTERED' }],
      waitlist: [],
      allowedManagerPhones: [],
      skin: {},
      mechanics: { enabled: false, config: {} },
      details: { booking: { pendingJoinPayments: [] } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    assert.ok(await repository.reservePublicJoinPayment(
      'expired-payment-cup',
      {
        ...pending('transaction-expired', '79990005001'),
        eligibilitySnapshot: {
          ...pending('transaction-expired', '79990005001').eligibilitySnapshot,
          activityId: 'expired-payment-cup'
        }
      }
    ));
    assert.ok(await repository.expirePublicJoinPayment(
      'expired-payment-cup',
      'transaction-expired',
      '79990005001',
      new Date().toISOString()
    ));
    assert.ok(await repository.appendPublicParticipantIfCapacity(
      'expired-payment-cup',
      '79990005002',
      { name: 'After expiry', phone: '79990005002', status: 'REGISTERED' }
    ));
    const expiredStored = await collection.findOne({ id: 'expired-payment-cup' });
    assert.equal(expiredStored?.participants?.length, 2);
    assert.equal(expiredStored?.details?.booking?.pendingJoinPayments?.[0]?.state, 'EXPIRED');

    await collection.insertOne({
      id: 'subscription-binding-cup',
      source: 'CUSTOM',
      slug: 'subscription-binding-cup',
      publicUrl: '/api/tournaments/public/subscription-binding-cup',
      name: 'Subscription Binding Cup',
      status: 'REGISTRATION',
      tournamentType: 'Американо',
      accessLevels: ['C'],
      gender: 'MIXED',
      maxPlayers: 2,
      participants: [{ name: 'Existing', phone: '79990006000', status: 'REGISTERED' }],
      waitlist: [],
      allowedManagerPhones: [],
      skin: {},
      mechanics: { enabled: false, config: {} },
      details: { booking: { pendingJoinPayments: [] } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const subscriptionOperationId = `subscription:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'subscription-binding-cup',
      {
        ...pending(subscriptionOperationId, '79990006001'),
        operationType: 'SUBSCRIPTION_BOOKING',
        clientId: 'client-subscription-1',
        selectedPurchaseOptionId: 'subscription-1',
        productType: 'SUBSCRIPTION',
        amountMinor: 0,
        eligibilitySnapshot: {
          ...pending(subscriptionOperationId, '79990006001').eligibilitySnapshot,
          activityId: 'subscription-binding-cup'
        }
      }
    ));
    const subscriptionClaims = await Promise.all([
      repository.claimPublicJoinSubscriptionBooking(
        'subscription-binding-cup',
        subscriptionOperationId,
        '79990006001',
        'claim-1',
        new Date().toISOString(),
        new Date(Date.now() + 300_000).toISOString()
      ),
      repository.claimPublicJoinSubscriptionBooking(
        'subscription-binding-cup',
        subscriptionOperationId,
        '79990006001',
        'claim-2',
        new Date().toISOString(),
        new Date(Date.now() + 300_000).toISOString()
      )
    ]);
    assert.equal(subscriptionClaims.filter(Boolean).length, 1);
    assert.ok(await repository.bindPublicJoinSubscriptionBooking(
      'subscription-binding-cup',
      subscriptionOperationId,
      '79990006001',
      'provider-booking-subscription-1'
    ));
    assert.ok(await repository.markPublicJoinPaymentPaid(
      'subscription-binding-cup',
      subscriptionOperationId,
      '79990006001',
      {
        provider: 'VIVA',
        operationType: 'SUBSCRIPTION_BOOKING',
        operationId: subscriptionOperationId,
        bookingId: 'provider-booking-subscription-1',
        clientId: 'client-subscription-1',
        clientSubscriptionId: 'subscription-1',
        status: 'ACTIVE',
        exerciseId: 'exercise',
        phone: '79990006001',
        amountMinor: 0,
        currency: 'RUB',
        verifiedAt: new Date().toISOString()
      }
    ));
    assert.ok(await repository.finalizePublicJoinPayment(
      'subscription-binding-cup',
      subscriptionOperationId,
      '79990006001',
      {
        name: 'Subscription player',
        phone: '79990006001',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      }
    ));
  } finally {
    await repository.onModuleDestroy();
    await client.db(databaseName).dropDatabase();
    await client.close();
  }

  console.log('Tournament public payment persistence MongoDB test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
