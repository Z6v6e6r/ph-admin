import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = process.env.CUP_RECOVERY_ROOT;
assert.ok(root && root.startsWith('/'), 'Explicit isolated compiled recovery root required');
const uri = process.argv[2], url = new URL(uri);
assert.equal(url.protocol, 'mongodb:');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Owned loopback Mongo only');
const require = createRequire(resolve(root, 'package.json'));
require('reflect-metadata');
const { MongoClient } = require('mongodb');
const { TournamentsPersistenceService } = require(resolve(root, 'dist/tournaments/tournaments-persistence.service.js'));
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
const dbName = 'cup_recovery_' + randomUUID().replaceAll('-', '');
await client.connect();
try {
  const collection = client.db(dbName).collection('synthetic_tournaments');
  const persistence = Object.create(TournamentsPersistenceService.prototype);
  persistence.collection = async () => collection;
  for (const state of ['PROVIDER_CREATE_PENDING', 'PROVIDER_RESULT_UNKNOWN']) {
    await collection.deleteMany({});
    const id = randomUUID(), phone = '79990000000', transactionId = randomUUID();
    await collection.insertOne({ id, slug: id, name: 'Synthetic', status: 'REGISTRATION', maxPlayers: 2,
      participants: [{ id: 'existing', phone: '79990000001' }], waitlist: [],
      details: { booking: { pendingJoinPayments: [{ transactionId, phone, state, operationType: 'TRANSACTION' }] } } });
    const before = await collection.findOne({ id });
    for (const requester of [phone, '79990000002']) {
      assert.equal(await persistence.reservePublicJoinPayment(id, { transactionId: randomUUID(), phone: requester, state: 'PENDING_PAYMENT' }), null);
      assert.equal(await persistence.appendPublicParticipantIfCapacity(id, requester, { id: randomUUID(), phone: requester }), null);
      assert.deepEqual(await collection.findOne({ id }), before);
    }
    // Spare capacity isolates the same-phone predicates from the capacity predicates.
    await collection.updateOne({ id }, { $set: { maxPlayers: 3 } });
    const spareBefore = await collection.findOne({ id });
    assert.equal(await persistence.reservePublicJoinPayment(id, { transactionId: randomUUID(), phone, state: 'PENDING_PAYMENT' }), null);
    assert.equal(await persistence.appendPublicParticipantIfCapacity(id, phone, { id: randomUUID(), phone }), null);
    assert.deepEqual(await collection.findOne({ id }), spareBefore);
    await collection.updateOne({ id }, { $set: { maxPlayers: 2 } });
    assert.equal(await persistence.markPublicJoinPaymentPaid(id, transactionId, phone, {}), null);
    assert.equal(await persistence.expirePublicJoinPayment(id, transactionId, phone), null);
    assert.equal(await persistence.finalizePublicJoinPayment(id, transactionId, phone, { id: randomUUID(), phone }), null);
    assert.deepEqual(await collection.findOne({ id }), before);
  }
  console.log('Physical recovery capacity: both states, reserve/append same/other phone, paid/expire/finalize denied, rows unchanged PASS');
} finally { await client.db(dbName).dropDatabase(); await client.close(); }
