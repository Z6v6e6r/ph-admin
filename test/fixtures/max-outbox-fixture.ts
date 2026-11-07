import { MaxOutboxStore as Store, MAX_QUEUE_CONTROL_ID, maxQueueControlName } from '../../src/support/max-outbox-store';
import { Db, MongoClient } from 'mongodb';
import * as assert from 'node:assert/strict';

/** Local test double only. It does not model transaction rollback or persistence. */
export function fakeMaxClient() {
  let sequence = 0, active = false;
  const session = {
    startTransaction: (options: any) => {
      assert.equal(options.readConcern.level, 'snapshot'); assert.equal(options.writeConcern.w, 'majority');
      active = true;
    },
    inTransaction: () => active,
    commitTransaction: async (options: any) => { assert(options.timeoutMS > 0 && options.timeoutMS <= 5000); active = false; },
    abortTransaction: async (options: any) => { assert(options.timeoutMS > 0 && options.timeoutMS <= 100); active = false; },
    endSession: async () => { assert.equal(active, false); }
  };
  return { startSession: () => session, db: () => ({ collection: () => ({
    findOneAndUpdate: async (_query: unknown, _update: unknown, options: any) => {
      assert.equal(options.session, session); assert(options.timeoutMS > 0 && options.timeoutMS <= 5000);
      return { _id: MAX_QUEUE_CONTROL_ID, schema: 1, enabled: true, sequence: ++sequence };
    }
  }) }) } as unknown as MongoClient;
}

export class MaxOutboxStore extends Store {
  constructor(collection: any, attempts?: number, clock?: () => number, onFailure?: any, client?: MongoClient) {
    // Mongo Collection's internal client is used only by physical test scaffolding;
    // production receives its explicit backend MongoClient through persistence.
    super(collection, attempts, clock, onFailure, client ?? collection.client ?? fakeMaxClient());
  }
}
export async function provisionMaxQueue(db: Db, outbox = 'outbox') {
  const control = db.collection(maxQueueControlName(outbox));
  await control.updateOne({ _id: MAX_QUEUE_CONTROL_ID as any }, { $setOnInsert: { schema: 1, enabled: true, sequence: 0 } },
    { upsert: true, writeConcern: { w: 'majority' } });
}
