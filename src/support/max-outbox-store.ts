import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Collection, MongoOperationTimeoutError } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { MaxFailure, MAX_DELIVERY_ATTEMPTS, maxFailure, maxRetryDelay } from './max-outbox-policy';
import { SupportConnectorRoute, SupportOutboxCommand, SupportOutboxStatus } from './support.types';

export interface MaxReceipt { leaseToken?: unknown; failure?: unknown; retryAfterSeconds?: unknown }
export const MAX_OUTBOX_TIMEOUT_MS = 5000;
export function isMaxConnector(connector: SupportConnectorRoute): boolean {
  return connector === SupportConnectorRoute.MAX_BOT || connector === SupportConnectorRoute.MAX_ACADEMY_BOT;
}

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

  async pull(connector: SupportConnectorRoute, limit: number, leaseSec: number, now = Date.now()) {
    const remaining = this.operationBudget();
    const at = new Date(now).toISOString();
    // An expired lease has an ambiguous provider outcome. Never automatically resend it.
    await this.collection.updateMany({ connector, status: SupportOutboxStatus.LEASED,
      $or: [{ leasedUntil: { $lte: at } }, { leasedUntil: { $exists: false } }] }, {
      $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'DELIVERY_UNKNOWN', updatedAt: at },
      $unset: { leasedUntil: '', leaseToken: '' }
    }, { writeConcern: { w: 'majority' }, timeoutMS: remaining() });
    await this.collection.updateMany({ connector, status: SupportOutboxStatus.PENDING,
      attempts: { $gte: this.maxAttempts } }, {
      $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'ATTEMPTS_EXHAUSTED', updatedAt: at },
      $unset: { nextAttemptAt: '' }
    }, { writeConcern: { w: 'majority' }, timeoutMS: remaining() });
    const commands: SupportOutboxCommand[] = [];
    for (let i = 0; i < Math.min(50, Math.max(1, limit)); i++) {
      const leaseToken = randomUUID();
      const command = await this.collection.findOneAndUpdate({ connector,
        status: SupportOutboxStatus.PENDING,
        $and: [ { $or: [{ attempts: { $lt: this.maxAttempts } }, { attempts: { $exists: false } }] },
          { $or: [{ nextAttemptAt: { $lte: at } }, { nextAttemptAt: { $exists: false } }] } ] }, {
        $set: { status: SupportOutboxStatus.LEASED, leaseToken,
          leasedUntil: new Date(now + Math.min(300, Math.max(5, leaseSec)) * 1000).toISOString(), updatedAt: at },
        $inc: { attempts: 1 }, $unset: { lastReceipt: '', nextAttemptAt: '' }
      }, { sort: { createdAt: 1, id: 1 }, returnDocument: 'after', includeResultMetadata: false, writeConcern: { w: 'majority' }, timeoutMS: remaining() });
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
    const command = await this.collection.findOne({ id }, { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() });
    if (!command || !isMaxConnector(command.connector)) throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
    // Majority readback prevents a duplicate reporting success from an applied but uncommitted receipt.
    // A repeated receipt is safe only until the next claim, which clears lastReceipt.
    if (command.lastReceipt?.token === token && command.lastReceipt.kind === kind) return command;
    const at = new Date(now).toISOString();
    const failure: MaxFailure | undefined = kind === 'fail' ? maxFailure(body.failure, now) : undefined;
    const localDeferred = failure?.category === 'LOCAL_DEFERRED';
    const retry = localDeferred || (failure?.category === 'RATE_LIMITED' && command.attempts < this.maxAttempts);
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
        set.terminalReason = failure.category === 'RATE_LIMITED' ? 'ATTEMPTS_EXHAUSTED' : failure.category;
        delete unset.terminalReason;
      }
    }
    const updated = await this.collection.findOneAndUpdate({ id, status: SupportOutboxStatus.LEASED,
      leaseToken: token, leasedUntil: { $gt: at }, attempts: command.attempts },
    { $set: set, $unset: unset }, { returnDocument: 'after', includeResultMetadata: false, writeConcern: { w: 'majority' }, timeoutMS: remaining() });
    if (updated) return updated; // Mongo acknowledgement precedes API success.
    const concurrent = await this.collection.findOne({ id }, { readConcern: { level: 'majority' }, readPreference: 'primary', timeoutMS: remaining() });
    if (concurrent?.lastReceipt?.token === token && concurrent.lastReceipt.kind === kind) return concurrent;
    throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
  }
}

export function missingMaxStore(): never {
  throw new ServiceUnavailableException({ code: 'MAX_OUTBOX_PERSISTENCE_UNAVAILABLE' });
}
