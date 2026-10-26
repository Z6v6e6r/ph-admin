process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoOperationTimeoutError } from 'mongodb';
import { MaxOutboxStore, fakeMaxClient } from './fixtures/max-outbox-fixture';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';
async function main() {
  let clock = 100;
  const budgets: number[] = [];
  const check = (options: any) => { assert(options.session); assert.equal(options.writeConcern, undefined);
    assert(options.timeoutMS > 0 && options.timeoutMS <= 5000); budgets.push(options.timeoutMS); clock += 10; };
  const collection = { updateMany: async (_q: unknown, _u: unknown, options: any) => check(options),
    aggregate: (_q: unknown, options: any) => ({ toArray: async () => { check(options); return []; } }) };
  const store = new MaxOutboxStore(collection, 3, () => clock);
  assert.deepEqual(await store.pull(Route.MAX_BOT, 2, 60), []);
  assert.deepEqual(budgets, [5000, 4990, 4980], 'Statements share one budget; majority belongs to commit');
  let writes = 0;
  const expired = new MaxOutboxStore({ updateMany: async () => { writes++; clock += 5001; } }, 3, () => clock);
  await assert.rejects(() => expired.pull(Route.MAX_BOT, 1, 60), MongoOperationTimeoutError);
  assert.equal(writes, 1);
  const token = randomUUID(), row = { id: 'synthetic', connector: Route.MAX_BOT, status: Status.LEASED, attempts: 1, queueSequence: 1,
    leaseToken: token, leasedUntil: new Date(Date.now() + 60_000).toISOString() };
  let reads = 0; budgets.length = 0;
  const receipts = new MaxOutboxStore({ findOne: async (_q: unknown, options: any) => { check(options); reads++; return row; },
    findOneAndUpdate: async (_q: unknown, _u: unknown, options: any) => { check(options); return null; } }, 3, () => clock);
  await assert.rejects(() => receipts.receipt(row.id, 'ack', { leaseToken: token }), (e: any) => e.getStatus() === 409);
  assert.equal(reads, 2); assert.deepEqual(budgets, [5000, 4990, 4980]);
  const events: any[] = [], client = fakeMaxClient() as any, session = client.startSession();
  const unknown = Object.assign(new Error('synthetic unknown commit'), { hasErrorLabel: (s: string) => s === 'UnknownTransactionCommitResult' });
  session.commitTransaction = async () => { throw unknown; };
  let inserts = 0;
  const admission = new MaxOutboxStore({ findOne: async () => null, insertOne: async () => { inserts++; } }, 3, undefined, (e: any) => events.push(e), client);
  await assert.rejects(() => admission.enqueue({ ...row, text: 'synthetic', dialogId: 'synthetic', clientId: 'synthetic', createdAt: new Date().toISOString(), status: Status.PENDING, attempts: 0 }), /unknown commit/);
  assert.equal(inserts, 1, 'Unknown commit never executes another enqueue/provider operation');
  assert.equal(events[0].stage, 'commit_unknown');
  let statements = 0;
  const partial = new MaxOutboxStore({ updateMany: async () => {}, aggregate: () => ({ toArray: async () => [{ ...row, queueSequence: 1 }, { ...row, id: 'b', queueSequence: 2 }] }),
    findOneAndUpdate: async () => { statements++; if (statements === 1) return row; throw new MongoOperationTimeoutError('synthetic second claim'); } }, 3, undefined, (e: any) => events.push(e));
  await assert.rejects(() => partial.pull(Route.MAX_BOT, 2, 60), MongoOperationTimeoutError);
  assert.equal(events[1].tentativeClaims, 1, 'Telemetry identifies an aborted tentative batch without exposing IDs/tokens');
  assert.deepEqual(Object.keys(events[1]).sort(), ['operation', 'stage', 'tentativeClaims']);
  const persistence = Object.create(SupportPersistenceService.prototype) as SupportPersistenceService;
  let calls = 0; const timeout = async () => { calls++; throw new MongoOperationTimeoutError('synthetic timeout'); };
  Object.assign(persistence, { maxStore: () => ({ pull: timeout, receipt: timeout, enqueue: timeout }), maxBackend: () => ({}), collection: () => ({ findOne: timeout }) });
  for (const operation of [() => persistence.pullMaxOutbox(Route.MAX_BOT, 1, 60), () => persistence.hasMaxOutbox('synthetic'),
    () => persistence.acceptMaxReceipt('synthetic', 'ack', {}), () => persistence.enqueueMaxOutbox(row as any)]) {
    await assert.rejects(operation, (e: any) => e.getStatus() === 503 && e.getResponse().code === 'MAX_OUTBOX_OPERATION_TIMEOUT');
  }
  assert.equal(calls, 4);
  console.log('MAX transaction budgets, bounded abort, unknown commit no replay and safe failure telemetry PASS');
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
