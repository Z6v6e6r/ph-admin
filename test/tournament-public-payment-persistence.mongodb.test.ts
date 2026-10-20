import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, MongoWriteConcernError } from 'mongodb';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

async function main(): Promise<void> {
  const mongoUri = process.env.TEST_MONGODB_URI
    ?? 'mongodb://127.0.0.1:27029/?replicaSet=phadminPr8Rs&retryWrites=true&w=majority';
  const parsedMongoUri = new URL(mongoUri);
  assert.ok(parsedMongoUri.searchParams.get('replicaSet'), 'replicaSet is required');
  assert.equal(parsedMongoUri.searchParams.get('retryWrites'), 'true');
  assert.equal(parsedMongoUri.searchParams.get('w'), 'majority');
  const databaseName = `phab_payment_binding_${randomUUID().replace(/-/g, '')}`;
  const collectionName = 'custom_tournaments';
  if (!databaseName.startsWith('phab_payment_binding_')) {
    throw new Error('Unsafe test database name');
  }
  const repositoryUri = new URL(mongoUri);
  repositoryUri.searchParams.set('w', '1');
  repositoryUri.searchParams.set('journal', 'false');
  process.env.TOURNAMENTS_MONGODB_URI = repositoryUri.toString();
  process.env.TOURNAMENTS_MONGODB_DB = databaseName;
  process.env.TOURNAMENTS_MONGODB_COLLECTION = collectionName;

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2000 });
  const repository = new TournamentsPersistenceService();
  const restartedRepositories: TournamentsPersistenceService[] = [];
  await client.connect();
  const hello = await client.db('admin').command({ hello: 1 });
  assert.equal(typeof hello.setName, 'string', 'MongoDB must be a replica set');
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
  const insertPaymentTournament = async (id: string, maxPlayers = 8) => {
    await collection.insertOne({
      id,
      source: 'CUSTOM',
      slug: id,
      publicUrl: `/api/tournaments/public/${id}`,
      name: id,
      status: 'REGISTRATION',
      tournamentType: 'Американо',
      accessLevels: ['C'],
      gender: 'MIXED',
      maxPlayers,
      participants: [],
      waitlist: [],
      allowedManagerPhones: [],
      skin: {},
      mechanics: { enabled: false, config: {} },
      details: { booking: { pendingJoinPayments: [] } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  };
  const restartRepository = () => {
    const restarted = new TournamentsPersistenceService();
    restartedRepositories.push(restarted);
    return restarted;
  };
  let providerPostCount = 0;
  const syntheticProviderPost = () => {
    providerPostCount += 1;
    const providerTransactionId = `synthetic-provider-${providerPostCount}`;
    return {
      providerTransactionId,
      checkoutUrl: `https://pay.example/${providerTransactionId}`,
      amountMinor: 250000,
      paymentExpiresAt: new Date(Date.now() + 1_200_000).toISOString()
    };
  };
  const applicationWrites: Array<{
    commandName: string;
    writeConcern?: Record<string, unknown>;
  }> = [];
  const assertExplicitWireWriteConcern = () => {
    assert.ok(applicationWrites.length > 0, 'observe nonempty real application write commands');
    for (const command of applicationWrites) {
      assert.deepEqual(
        command.writeConcern,
        { w: 'majority', j: true, wtimeout: 5000 },
        `${command.commandName} must send explicit durable acknowledgment options`
      );
    }
  };

  try {
    const originalConnect = MongoClient.prototype.connect;
    MongoClient.prototype.connect = async function () {
      // Enable test-only wire observation before opening this real driver client.
      Object.assign(this.options, { monitorCommands: true });
      this.on('commandStarted', (event) => {
        if (
          event.databaseName === databaseName
          && ['insert', 'update', 'delete', 'findAndModify'].includes(event.commandName)
        ) {
          applicationWrites.push({
            commandName: event.commandName,
            writeConcern: event.command.writeConcern
          });
        }
      });
      await originalConnect.call(this);
      return this;
    };
    try {
      await repository.findCustomTournamentById('atomic-payment-cup');
    } finally {
      MongoClient.prototype.connect = originalConnect;
    }
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
    assertExplicitWireWriteConcern();
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

    await insertPaymentTournament('same-request-cup');
    const sameRequestPhone = '79990003401';
    const sameRequestAttemptA = `tournament-payment:${randomUUID()}`;
    const sameRequestAttemptB = `tournament-payment:${randomUUID()}`;
    const sameRequestReservations = await Promise.all([
      repository.reservePublicJoinPayment(
        'same-request-cup',
        {
          ...pending(sameRequestAttemptA, sameRequestPhone),
          state: 'PROVIDER_CREATE_PENDING',
          operationType: 'TRANSACTION',
          amountMinor: undefined,
          eligibilitySnapshot: {
            ...pending(sameRequestAttemptA, sameRequestPhone).eligibilitySnapshot,
            activityId: 'same-request-cup'
          }
        }
      ),
      repository.reservePublicJoinPayment(
        'same-request-cup',
        {
          ...pending(sameRequestAttemptB, sameRequestPhone),
          state: 'PROVIDER_CREATE_PENDING',
          operationType: 'TRANSACTION',
          amountMinor: undefined,
          eligibilitySnapshot: {
            ...pending(sameRequestAttemptB, sameRequestPhone).eligibilitySnapshot,
            activityId: 'same-request-cup'
          }
        }
      )
    ]);
    assert.equal(
      sameRequestReservations.filter(Boolean).length,
      1,
      'two concurrent logical retries reserve one local attempt'
    );
    const sameRequestClaims = await Promise.all([
      repository.claimPublicJoinTransactionCreate(
        'same-request-cup',
        sameRequestAttemptA,
        sameRequestPhone,
        new Date().toISOString()
      ),
      repository.claimPublicJoinTransactionCreate(
        'same-request-cup',
        sameRequestAttemptB,
        sameRequestPhone,
        new Date().toISOString()
      )
    ]);
    assert.equal(
      sameRequestClaims.filter(Boolean).length,
      1,
      'the surviving local attempt grants one provider POST claim'
    );

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

    const postsBeforeBoundRetry = providerPostCount;
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'provider-attempt-cup', attemptId, '79990003501', new Date().toISOString()
    ), null);
    assert.equal(providerPostCount, postsBeforeBoundRetry, 'bound retry cannot POST');

    await insertPaymentTournament('write-concern-ack-loss-cup');
    const ackLossAttempt = `tournament-payment:${randomUUID()}`;
    const ackLossPhone = '79990007301';
    const ackLossPending = {
      ...pending(ackLossAttempt, ackLossPhone),
      state: 'PROVIDER_CREATE_PENDING',
      operationType: 'TRANSACTION',
      amountMinor: undefined,
      eligibilitySnapshot: {
        ...pending(ackLossAttempt, ackLossPhone).eligibilitySnapshot,
        activityId: 'write-concern-ack-loss-cup'
      }
    };
    assert.ok(await repository.reservePublicJoinPayment('write-concern-ack-loss-cup', ackLossPending));
    const originalClaim = repository.claimPublicJoinTransactionCreate;
    const lostAcknowledgment = new MongoWriteConcernError({
      ok: 1,
      writeConcernError: { code: 64, errmsg: 'Injected lost acknowledgment after a real Mongo claim' }
    });
    const postsBeforeAckLoss = providerPostCount;
    repository.claimPublicJoinTransactionCreate = async (...args: Parameters<typeof originalClaim>) => {
      assert.ok(await originalClaim.apply(repository, args), 'persist the real claim before losing acknowledgment');
      throw lostAcknowledgment;
    };
    try {
      await assert.rejects(async () => {
        const claimed = await repository.claimPublicJoinTransactionCreate(
          'write-concern-ack-loss-cup', ackLossAttempt, ackLossPhone, new Date().toISOString()
        );
        if (claimed) syntheticProviderPost();
      }, (error) => error === lostAcknowledgment);
    } finally {
      repository.claimPublicJoinTransactionCreate = originalClaim;
    }
    const persistedAfterAckLoss = (await collection.findOne({ id: 'write-concern-ack-loss-cup' }))
      ?.details?.booking?.pendingJoinPayments?.[0];
    assert.equal(persistedAfterAckLoss?.transactionId, ackLossAttempt);
    assert.equal(persistedAfterAckLoss?.state, 'PROVIDER_RESULT_UNKNOWN');
    assert.ok(persistedAfterAckLoss?.providerCreateAttemptedAt);
    const retryAfterAckLoss = await restartRepository().claimPublicJoinTransactionCreate(
      'write-concern-ack-loss-cup', ackLossAttempt, ackLossPhone, new Date().toISOString()
    );
    if (retryAfterAckLoss) syntheticProviderPost();
    assert.equal(retryAfterAckLoss, null, 'an ambiguous persisted claim cannot grant another POST');
    assert.equal(await repository.reservePublicJoinPayment('write-concern-ack-loss-cup', {
      ...ackLossPending,
      transactionId: `tournament-payment:${randomUUID()}`
    }), null, 'an unknown claim cannot be replaced with a new local attempt');
    assert.equal(providerPostCount, postsBeforeAckLoss, 'no POST follows a failed or replayed claim acknowledgment');

    await insertPaymentTournament('crash-before-claim-cup');
    const beforeClaimAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'crash-before-claim-cup',
      {
        ...pending(beforeClaimAttempt, '79990007101'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(beforeClaimAttempt, '79990007101').eligibilitySnapshot,
          activityId: 'crash-before-claim-cup'
        }
      }
    ));
    const afterRestartBeforeClaim = restartRepository();
    assert.ok(await afterRestartBeforeClaim.claimPublicJoinTransactionCreate(
      'crash-before-claim-cup',
      beforeClaimAttempt,
      '79990007101',
      new Date().toISOString()
    ));
    const resumedProvider = syntheticProviderPost();
    assert.ok(await afterRestartBeforeClaim.recordPublicJoinTransactionProviderIdentity(
      'crash-before-claim-cup',
      beforeClaimAttempt,
      '79990007101',
      resumedProvider.providerTransactionId
    ));
    assert.ok(await afterRestartBeforeClaim.bindPublicJoinTransaction(
      'crash-before-claim-cup',
      beforeClaimAttempt,
      '79990007101',
      resumedProvider.providerTransactionId,
      resumedProvider
    ));

    await insertPaymentTournament('crash-after-claim-cup');
    const afterClaimAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'crash-after-claim-cup',
      {
        ...pending(afterClaimAttempt, '79990007102'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(afterClaimAttempt, '79990007102').eligibilitySnapshot,
          activityId: 'crash-after-claim-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'crash-after-claim-cup',
      afterClaimAttempt,
      '79990007102',
      new Date().toISOString()
    ));
    const postsBeforeAfterClaimRestart = providerPostCount;
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'crash-after-claim-cup',
      afterClaimAttempt,
      '79990007102',
      new Date().toISOString()
    ), null);
    assert.equal(
      providerPostCount,
      postsBeforeAfterClaimRestart,
      'crash after claim stays UNKNOWN and cannot POST'
    );

    await insertPaymentTournament('lost-response-cup');
    const lostResponseAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'lost-response-cup',
      {
        ...pending(lostResponseAttempt, '79990007103'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(lostResponseAttempt, '79990007103').eligibilitySnapshot,
          activityId: 'lost-response-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'lost-response-cup',
      lostResponseAttempt,
      '79990007103',
      new Date().toISOString()
    ));
    syntheticProviderPost();
    const postsAfterLostResponse = providerPostCount;
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'lost-response-cup',
      lostResponseAttempt,
      '79990007103',
      new Date().toISOString()
    ), null);
    assert.equal(providerPostCount, postsAfterLostResponse, 'lost response retry cannot POST');

    await insertPaymentTournament('identity-write-failure-cup');
    const identityFailureAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'identity-write-failure-cup',
      {
        ...pending(identityFailureAttempt, '79990007104'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(identityFailureAttempt, '79990007104').eligibilitySnapshot,
          activityId: 'identity-write-failure-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'identity-write-failure-cup',
      identityFailureAttempt,
      '79990007104',
      new Date().toISOString()
    ));
    const acceptedBeforeIdentityFailure = syntheticProviderPost();
    assert.equal(await repository.recordPublicJoinTransactionProviderIdentity(
      'identity-write-failure-cup',
      identityFailureAttempt,
      '79990007999',
      acceptedBeforeIdentityFailure.providerTransactionId
    ), null);
    const postsAfterIdentityFailure = providerPostCount;
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'identity-write-failure-cup',
      identityFailureAttempt,
      '79990007104',
      new Date().toISOString()
    ), null);
    assert.equal(providerPostCount, postsAfterIdentityFailure, 'identity write failure cannot POST');

    await insertPaymentTournament('bind-write-failure-cup');
    const bindFailureAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'bind-write-failure-cup',
      {
        ...pending(bindFailureAttempt, '79990007105'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(bindFailureAttempt, '79990007105').eligibilitySnapshot,
          activityId: 'bind-write-failure-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'bind-write-failure-cup',
      bindFailureAttempt,
      '79990007105',
      new Date().toISOString()
    ));
    const acceptedBeforeBindFailure = syntheticProviderPost();
    assert.ok(await repository.recordPublicJoinTransactionProviderIdentity(
      'bind-write-failure-cup',
      bindFailureAttempt,
      '79990007105',
      acceptedBeforeBindFailure.providerTransactionId
    ));
    assert.equal(await repository.bindPublicJoinTransaction(
      'bind-write-failure-cup',
      bindFailureAttempt,
      '79990007999',
      acceptedBeforeBindFailure.providerTransactionId,
      acceptedBeforeBindFailure
    ), null);
    const postsAfterBindFailure = providerPostCount;
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'bind-write-failure-cup',
      bindFailureAttempt,
      '79990007105',
      new Date().toISOString()
    ), null);
    assert.equal(providerPostCount, postsAfterBindFailure, 'bind failure retry cannot POST');
    assert.ok(await repository.bindPublicJoinTransaction(
      'bind-write-failure-cup',
      bindFailureAttempt,
      '79990007105',
      acceptedBeforeBindFailure.providerTransactionId,
      acceptedBeforeBindFailure
    ));

    await insertPaymentTournament('provider-identity-conflict-cup');
    const conflictAttemptA = `tournament-payment:${randomUUID()}`;
    const conflictAttemptB = `tournament-payment:${randomUUID()}`;
    for (const [conflictAttempt, conflictPhone] of [
      [conflictAttemptA, '79990007106'],
      [conflictAttemptB, '79990007107']
    ] as const) {
      assert.ok(await repository.reservePublicJoinPayment(
        'provider-identity-conflict-cup',
        {
          ...pending(conflictAttempt, conflictPhone),
          state: 'PROVIDER_CREATE_PENDING',
          operationType: 'TRANSACTION',
          amountMinor: undefined,
          eligibilitySnapshot: {
            ...pending(conflictAttempt, conflictPhone).eligibilitySnapshot,
            activityId: 'provider-identity-conflict-cup'
          }
        }
      ));
      assert.ok(await repository.claimPublicJoinTransactionCreate(
        'provider-identity-conflict-cup',
        conflictAttempt,
        conflictPhone,
        new Date().toISOString()
      ));
    }
    assert.ok(await repository.recordPublicJoinTransactionProviderIdentity(
      'provider-identity-conflict-cup',
      conflictAttemptA,
      '79990007106',
      'provider-shared-conflict'
    ));
    assert.equal(await repository.recordPublicJoinTransactionProviderIdentity(
      'provider-identity-conflict-cup',
      conflictAttemptB,
      '79990007107',
      'provider-shared-conflict'
    ), null);

    await insertPaymentTournament('provider-identity-conflict-other-cup');
    const crossTournamentConflictAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'provider-identity-conflict-other-cup',
      {
        ...pending(crossTournamentConflictAttempt, '79990007109'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(crossTournamentConflictAttempt, '79990007109').eligibilitySnapshot,
          activityId: 'provider-identity-conflict-other-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'provider-identity-conflict-other-cup',
      crossTournamentConflictAttempt,
      '79990007109',
      new Date().toISOString()
    ));
    await assert.rejects(
      () => repository.recordPublicJoinTransactionProviderIdentity(
        'provider-identity-conflict-other-cup',
        crossTournamentConflictAttempt,
        '79990007109',
        'provider-shared-conflict'
      ),
      /duplicate key/i
    );

    for (const [mixedTournamentId, boundPhone, unresolvedPhone, providerId] of [
      ['provider-identity-mixed-a', '79990007110', '79990007111', 'provider-mixed-a'],
      ['provider-identity-mixed-b', '79990007112', '79990007113', 'provider-mixed-b']
    ] as const) {
      await insertPaymentTournament(mixedTournamentId);
      const boundAttempt = `tournament-payment:${randomUUID()}`;
      const unresolvedAttempt = `tournament-payment:${randomUUID()}`;
      for (const [mixedAttempt, mixedPhone] of [
        [boundAttempt, boundPhone],
        [unresolvedAttempt, unresolvedPhone]
      ] as const) {
        assert.ok(await repository.reservePublicJoinPayment(
          mixedTournamentId,
          {
            ...pending(mixedAttempt, mixedPhone),
            state: 'PROVIDER_CREATE_PENDING',
            operationType: 'TRANSACTION',
            amountMinor: undefined,
            eligibilitySnapshot: {
              ...pending(mixedAttempt, mixedPhone).eligibilitySnapshot,
              activityId: mixedTournamentId
            }
          }
        ));
        assert.ok(await repository.claimPublicJoinTransactionCreate(
          mixedTournamentId,
          mixedAttempt,
          mixedPhone,
          new Date().toISOString()
        ));
      }
      assert.ok(await repository.recordPublicJoinTransactionProviderIdentity(
        mixedTournamentId,
        boundAttempt,
        boundPhone,
        providerId
      ));
    }

    await insertPaymentTournament('late-confirmation-cup');
    const lateAttempt = `tournament-payment:${randomUUID()}`;
    assert.ok(await repository.reservePublicJoinPayment(
      'late-confirmation-cup',
      {
        ...pending(lateAttempt, '79990007108'),
        state: 'PROVIDER_CREATE_PENDING',
        operationType: 'TRANSACTION',
        amountMinor: undefined,
        eligibilitySnapshot: {
          ...pending(lateAttempt, '79990007108').eligibilitySnapshot,
          activityId: 'late-confirmation-cup'
        }
      }
    ));
    assert.ok(await repository.claimPublicJoinTransactionCreate(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      new Date().toISOString()
    ));
    const lateProvider = syntheticProviderPost();
    assert.ok(await repository.recordPublicJoinTransactionProviderIdentity(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      lateProvider.providerTransactionId
    ));
    assert.ok(await repository.bindPublicJoinTransaction(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      lateProvider.providerTransactionId,
      {
        ...lateProvider,
        paymentExpiresAt: new Date(Date.now() - 60_000).toISOString()
      }
    ));
    const postsBeforeLatePaid = providerPostCount;
    const afterSyntheticUnpaid = await collection.findOne({ id: 'late-confirmation-cup' });
    assert.equal(
      afterSyntheticUnpaid?.details?.booking?.pendingJoinPayments?.[0]?.state,
      'PENDING_PAYMENT',
      'UNPAID observation is non-terminal and must not release the attempt'
    );
    assert.equal(await restartRepository().claimPublicJoinTransactionCreate(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      new Date().toISOString()
    ), null);
    assert.equal(providerPostCount, postsBeforeLatePaid);
    assert.ok(await repository.markPublicJoinPaymentPaid(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      {
        provider: 'VIVA',
        operationType: 'TRANSACTION',
        operationId: lateProvider.providerTransactionId,
        status: 'PAID',
        exerciseId: 'exercise',
        phone: '79990007108',
        amountMinor: 250000,
        currency: 'RUB',
        verifiedAt: new Date().toISOString()
      }
    ));
    assert.ok(await repository.finalizePublicJoinPayment(
      'late-confirmation-cup',
      lateAttempt,
      '79990007108',
      {
        name: 'Late paid player',
        phone: '79990007108',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      }
    ));
    assert.equal(
      (await collection.findOne({ id: 'late-confirmation-cup' }))?.participants?.length,
      1
    );

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
    assertExplicitWireWriteConcern();
    console.log(`Explicit majority+j wire concern verified for ${applicationWrites.length} tournament mutations`);
  } finally {
    await Promise.all(restartedRepositories.map((item) => item.onModuleDestroy()));
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
