import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoOperationTimeoutError } from 'mongodb';
import { MaxOutboxStore } from '../src/support/max-outbox-store';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main(): Promise<void> {
  for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
    let clock = 100;
    const timeouts: number[] = [];
    const check = (options: any) => {
      assert.equal(options.writeConcern.w, 'majority');
      assert(options.timeoutMS > 0 && options.timeoutMS <= 5000);
      timeouts.push(options.timeoutMS);
      clock += 10;
    };
    const store = new (MaxOutboxStore as any)({
      updateMany: async (_filter: unknown, _update: unknown, options: any) => check(options),
      findOneAndUpdate: async (_filter: unknown, _update: unknown, options: any) => { check(options); return null; }
    }, 3, () => clock);
    assert.deepEqual(await store.pull(connector, 1, 60), []);
    assert.deepEqual(timeouts, [5000, 4990, 4980], 'All pull operations share one request budget');

    let writes = 0;
    const expired = new (MaxOutboxStore as any)({ updateMany: async () => { writes++; clock += 5001; } }, 3, () => clock);
    await assert.rejects(() => expired.pull(connector, 1, 60), MongoOperationTimeoutError);
    assert.equal(writes, 1, 'An exhausted request must not issue another Mongo operation');

    const token = randomUUID();
    const command = { id: 'synthetic', connector, status: Status.LEASED, attempts: 1,
      leaseToken: token, leasedUntil: new Date(Date.now() + 60_000).toISOString() };
    let reads = 0;
    const receiptTimeouts: number[] = [];
    const receipts = new (MaxOutboxStore as any)({
      findOne: async (_filter: unknown, options: any) => {
        assert.equal(options.readConcern.level, 'majority'); assert.equal(options.readPreference, 'primary');
        receiptTimeouts.push(options.timeoutMS); clock += 10; reads++;
        return command;
      },
      findOneAndUpdate: async (_filter: unknown, _update: unknown, options: any) => {
        assert.equal(options.writeConcern.w, 'majority'); receiptTimeouts.push(options.timeoutMS); clock += 10;
        return null;
      }
    }, 3, () => clock);
    await assert.rejects(() => receipts.receipt(command.id, 'ack', { leaseToken: token }), (e: any) => e.getStatus() === 409);
    assert.equal(reads, 2);
    assert.deepEqual(receiptTimeouts, [5000, 4990, 4980]);
    let attempts = 0;
    const timedOut = new (MaxOutboxStore as any)({ findOne: async () => { attempts++; throw new MongoOperationTimeoutError('synthetic timeout'); } });
    await assert.rejects(() => timedOut.receipt(command.id, 'ack', { leaseToken: token }), MongoOperationTimeoutError);
    assert.equal(attempts, 1, 'An ambiguous timeout is never automatically retried');

    let claims = 0, cleanupWrites = 0;
    const partial = new MaxOutboxStore({
      updateMany: async () => { cleanupWrites++; },
      findOneAndUpdate: async () => { claims++; if (claims === 1) return command; throw new MongoOperationTimeoutError('partial claim'); }
    } as any);
    await assert.rejects(() => partial.pull(connector, 2, 60), MongoOperationTimeoutError);
    assert.equal(claims, 2);
    assert.equal(cleanupWrites, 2, 'A partial claim failure does not requeue possibly leased commands');
  }
  const persistence = Object.create(SupportPersistenceService.prototype) as SupportPersistenceService;
  let mongoCalls = 0;
  const timeout = async () => { mongoCalls++; throw new MongoOperationTimeoutError('synthetic timeout'); };
  Object.assign(persistence, {
    maxStore: () => ({ pull: timeout, receipt: timeout }),
    maxBackend: () => ({ config: { key: 'synthetic-max' } }),
    collection: () => ({ findOne: timeout })
  });
  for (const operation of [() => persistence.pullMaxOutbox(Route.MAX_BOT, 1, 60),
    () => persistence.hasMaxOutbox('synthetic'), () => persistence.acceptMaxReceipt('synthetic', 'ack', {})]) {
    await assert.rejects(operation, (error: any) => error.getStatus() === 503 && error.getResponse().code === 'MAX_OUTBOX_OPERATION_TIMEOUT');
  }
  assert.equal(mongoCalls, 3, 'Timeout conversion performs no retry or extra operation');
  console.log('MAX shared operation budgets and timeout propagation: PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
