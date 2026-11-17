import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, MongoOperationTimeoutError } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { MaxFailure, MAX_DELIVERY_ATTEMPTS, MAX_LOCAL_DEFERRALS, maxFailure, maxRetryDelay } from './max-outbox-policy';
import { SupportConnectorRoute, SupportOutboxCommand, SupportOutboxStatus } from './support.types';

export interface MaxReceipt { leaseToken?: unknown; failure?: unknown; retryAfterSeconds?: unknown }
export const MAX_OUTBOX_TIMEOUT_MS = 5000;
export function isMaxConnector(connector: SupportConnectorRoute): boolean {
  return connector === SupportConnectorRoute.MAX_BOT || connector === SupportConnectorRoute.MAX_ACADEMY_BOT;
}

export const MAX_RECEIPT_PROTOCOL = 'max-lease-v1';
/** Marker presence is a permanent fence, even if a future tool changes status. */
export const maxOutboxEligible = () => ({
  'meta.maxOutboxProtocol': MAX_RECEIPT_PROTOCOL,
  'meta.legacyMaxRestartCustody': { $exists: false },
  'meta.legacyMaxArchive': { $exists: false }
});
const excluded = (row: SupportOutboxCommand) => Object.prototype.hasOwnProperty.call(row.meta ?? {}, 'legacyMaxRestartCustody')
  || Object.prototype.hasOwnProperty.call(row.meta ?? {}, 'legacyMaxArchive');
const identity = (row: SupportOutboxCommand) => {
  const mutable = new Set(['_id', 'status', 'attempts', 'leasedUntil', 'leaseToken', 'updatedAt', 'nextAttemptAt',
    'lastReceipt', 'terminalReason', 'lastError', 'lastProviderFailure', 'localDeferrals', 'lastLocalDeferral']);
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)))));
};

/** Atomic Mongo claims/receipts; no dependence on a process-local outbox snapshot. */
export class MaxOutboxStore {
  constructor(private readonly collection: Collection<SupportOutboxCommand>,
    private readonly maxAttempts = MAX_DELIVERY_ATTEMPTS,
    private readonly clock: () => number = () => performance.now()) {}

  private operationBudget(): () => number {
    const deadline = this.clock() + MAX_OUTBOX_TIMEOUT_MS;
    return () => {
      const remaining = Math.ceil(deadline - this.clock());
      if (remaining <= 0) throw new MongoOperationTimeoutError('MAX outbox operation budget exhausted');
      return remaining;
    };
  }

  async enqueue(command: SupportOutboxCommand): Promise<SupportOutboxCommand> {
    if (!isMaxConnector(command.connector) || !command.id || command.status !== SupportOutboxStatus.PENDING
      || command.attempts !== 0 || excluded(command)
      || ['leaseToken', 'leasedUntil', 'lastReceipt', 'terminalReason'].some(key => key in command)
      || (command.meta?.maxOutboxProtocol !== undefined && command.meta.maxOutboxProtocol !== MAX_RECEIPT_PROTOCOL)) {
      throw new ConflictException({ code: 'MAX_OUTBOX_ENQUEUE_CONFLICT' });
    }
    const remaining = this.operationBudget();
    const snapshot: SupportOutboxCommand = JSON.parse(JSON.stringify({ ...command, meta: { ...command.meta, maxOutboxProtocol: MAX_RECEIPT_PROTOCOL } }));
    try {
      // Matching by ID alone makes an existing archive/legacy ID an insert-only no-op, never a second row.
      await this.collection.updateOne({ id: snapshot.id },
        { $setOnInsert: snapshot }, { upsert: true, writeConcern: { w: 'majority', j: true }, timeoutMS: remaining() });
    } catch { /* A lost write ACK can only be resolved by the exact majority readback below. */ }
    const durable = await this.collection.findOne({ id: snapshot.id, connector: snapshot.connector, ...maxOutboxEligible() },
      { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() });
    if (!durable) throw new ServiceUnavailableException({ code: 'MAX_OUTBOX_ENQUEUE_UNCONFIRMED' });
    if (!isDeepStrictEqual(identity(durable), identity(snapshot))) throw new ConflictException({ code: 'MAX_OUTBOX_ENQUEUE_CONFLICT' });
    return durable;
  }

  async health(connector: SupportConnectorRoute, now = Date.now()) {
    if (!isMaxConnector(connector)) throw new ConflictException({ code: 'MAX_CONNECTOR_REQUIRED' });
    const remaining = this.operationBudget(), at = new Date(now).toISOString();
    const [result] = await this.collection.aggregate([
      { $match: { connector, ...maxOutboxEligible() } },
      { $facet: {
        states: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        due: [{ $match: { status: SupportOutboxStatus.PENDING,
          $or: [{ nextAttemptAt: { $lte: at } }, { nextAttemptAt: { $exists: false } }] } }, { $count: 'count' }],
        expired: [{ $match: { status: SupportOutboxStatus.LEASED,
          $or: [{ leasedUntil: { $lte: at } }, { leasedUntil: { $exists: false } }] } }, { $count: 'count' }],
        review: [{ $match: { terminalReason: 'DELIVERY_UNKNOWN' } }, { $count: 'count' }],
        oldest: [{ $match: { status: SupportOutboxStatus.PENDING } }, { $sort: { createdAt: 1 } },
          { $limit: 1 }, { $project: { _id: 0, createdAt: 1 } }]
      } }
    ], { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() }).toArray();
    const states = Object.fromEntries((result?.states ?? []).map((x: { _id: string; count: number }) => [x._id, x.count]));
    const oldest = result?.oldest?.[0]?.createdAt;
    return { protocol: MAX_RECEIPT_PROTOCOL, connector, pending: states.PENDING ?? 0, leased: states.LEASED ?? 0,
      sent: states.SENT ?? 0, failed: states.FAILED ?? 0, due: result?.due?.[0]?.count ?? 0,
      expiredLeases: result?.expired?.[0]?.count ?? 0, needsReview: result?.review?.[0]?.count ?? 0,
      oldestPendingAgeMs: typeof oldest === 'string' && Number.isFinite(Date.parse(oldest)) ? Math.max(0, now - Date.parse(oldest)) : null };
  }

  async pull(connector: SupportConnectorRoute, limit: number, leaseSec: number, now = Date.now()) {
    const remaining = this.operationBudget();
    const at = new Date(now).toISOString();
    if (!isMaxConnector(connector)) throw new ConflictException({ code: 'MAX_CONNECTOR_REQUIRED' });
    // An expired lease has an ambiguous provider outcome. Never automatically resend it.
    await this.collection.updateMany({ connector, ...maxOutboxEligible(), status: SupportOutboxStatus.LEASED,
      $or: [{ leasedUntil: { $lte: at } }, { leasedUntil: { $exists: false } }] }, {
      $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'DELIVERY_UNKNOWN', updatedAt: at },
      $unset: { leasedUntil: '', leaseToken: '' }
    }, { writeConcern: { w: 'majority', j: true }, timeoutMS: remaining() });
    await this.collection.updateMany({ connector, ...maxOutboxEligible(), status: SupportOutboxStatus.PENDING,
      attempts: { $gte: this.maxAttempts } }, {
      $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'ATTEMPTS_EXHAUSTED', updatedAt: at },
      $unset: { nextAttemptAt: '' }
    }, { writeConcern: { w: 'majority', j: true }, timeoutMS: remaining() });
    const commands: SupportOutboxCommand[] = [];
    // One atomic claim per response: a later batch failure must not hide an already returned claim.
    for (let i = 0; i < Math.min(1, Math.max(0, Math.floor(limit))); i++) {
      const leaseToken = randomUUID();
      const command = await this.collection.findOneAndUpdate({ connector, ...maxOutboxEligible(),
        status: SupportOutboxStatus.PENDING,
        $and: [ { $or: [{ attempts: { $lt: this.maxAttempts } }, { attempts: { $exists: false } }] },
          { $or: [{ nextAttemptAt: { $lte: at } }, { nextAttemptAt: { $exists: false } }] } ] }, {
        $set: { status: SupportOutboxStatus.LEASED, leaseToken,
          leasedUntil: new Date(now + Math.min(300, Math.max(5, leaseSec)) * 1000).toISOString(), updatedAt: at },
        $inc: { attempts: 1 }, $unset: { lastReceipt: '', nextAttemptAt: '' }
      }, { sort: { createdAt: 1, id: 1 }, returnDocument: 'after', includeResultMetadata: false, writeConcern: { w: 'majority', j: true }, timeoutMS: remaining() });
      if (!command) break;
      commands.push(command);
    }
    return commands;
  }

  async receipt(id: string, kind: 'ack' | 'fail', body: MaxReceipt, now = Date.now()) {
    const remaining = this.operationBudget();
    const token = body?.leaseToken;
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) {
      throw new ConflictException({ code: 'OUTBOX_LEASE_REQUIRED' });
    }
    const command = await this.collection.findOne({ id, ...maxOutboxEligible() }, { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() });
    if (!command || !isMaxConnector(command.connector) || excluded(command) || command.meta?.maxOutboxProtocol !== MAX_RECEIPT_PROTOCOL) throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
    // Majority readback prevents a duplicate reporting success from an applied but uncommitted receipt.
    // A repeated receipt is safe only until the next claim, which clears lastReceipt.
    if (command.lastReceipt?.token === token && command.lastReceipt.kind === kind) return command;
    const at = new Date(now).toISOString();
    const failure: MaxFailure | undefined = kind === 'fail' ? maxFailure(body.failure, now) : undefined;
    const localDeferred = failure?.category === 'LOCAL_DEFERRED';
    const retry = (localDeferred && (command.localDeferrals ?? 0) < MAX_LOCAL_DEFERRALS) || (failure?.category === 'RATE_LIMITED' && command.attempts < this.maxAttempts);
    const set: Record<string, unknown> = { updatedAt: at, lastReceipt: { token, kind },
      status: kind === 'ack' ? SupportOutboxStatus.SENT : retry ? SupportOutboxStatus.PENDING : SupportOutboxStatus.FAILED };
    const unset: Record<string, ''> = { leaseToken: '', leasedUntil: '', nextAttemptAt: '', terminalReason: '' };
    if (failure) {
      if (localDeferred) {
        set.localDeferrals = (command.localDeferrals ?? 0) + 1;
        set.lastLocalDeferral = failure;
        // A claim that never reached provider transport must not consume a delivery attempt.
        set.attempts = Math.max(0, command.attempts - 1);
      } else set.lastProviderFailure = failure;
      // Fixed category, never arbitrary legacy body.error or MaxError.message.
      set.lastError = failure.category;
      if (retry) {
        set.nextAttemptAt = new Date(now + maxRetryDelay(localDeferred ? (command.localDeferrals ?? 0) + 1 : command.attempts, localDeferred ? undefined : body.retryAfterSeconds)).toISOString();
        delete unset.nextAttemptAt;
      } else {
        set.terminalReason = localDeferred ? 'LOCAL_ADMISSION_EXHAUSTED' : failure.category === 'RATE_LIMITED' ? 'ATTEMPTS_EXHAUSTED' : failure.category;
        delete unset.terminalReason;
      }
    }
    const updated = await this.collection.findOneAndUpdate({ id, ...maxOutboxEligible(), status: SupportOutboxStatus.LEASED,
      leaseToken: token, leasedUntil: { $gt: at }, attempts: command.attempts },
    { $set: set, $unset: unset }, { returnDocument: 'after', includeResultMetadata: false, writeConcern: { w: 'majority', j: true }, timeoutMS: remaining() });
    if (updated) return updated; // Mongo acknowledgement precedes API success.
    const concurrent = await this.collection.findOne({ id, ...maxOutboxEligible() }, { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() });
    if (concurrent && !excluded(concurrent) && concurrent.meta?.maxOutboxProtocol === MAX_RECEIPT_PROTOCOL
      && concurrent.lastReceipt?.token === token && concurrent.lastReceipt.kind === kind) return concurrent;
    throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
  }
}

export function missingMaxStore(): never {
  throw new ServiceUnavailableException({ code: 'MAX_OUTBOX_PERSISTENCE_UNAVAILABLE' });
}
