import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { BSON, ClientSession, Collection, MongoClient, MongoOperationTimeoutError } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { MaxFailure, MAX_DELIVERY_ATTEMPTS, maxFailure, maxRetryDelay } from './max-outbox-policy';
import { SupportConnectorRoute, SupportOutboxCommand, SupportOutboxStatus } from './support.types';

export interface MaxReceipt { leaseToken?: unknown; failure?: unknown; retryAfterSeconds?: unknown }
export const MAX_OUTBOX_TIMEOUT_MS = 5000;
export const MAX_QUEUE_CONTROL_ID = 'max-queue-v1';
export function maxQueueControlName(outbox: string): string { return outbox + '_max_control'; }
export function isMaxConnector(connector: SupportConnectorRoute): boolean {
  return connector === SupportConnectorRoute.MAX_BOT || connector === SupportConnectorRoute.MAX_ACADEMY_BOT;
}
type Control = { _id: string; schema: number; enabled: boolean; sequence: number };
type FailureObserver = (event: { operation: string; stage: string; tentativeClaims: number }) => void;
const deliveryFields = ['id', 'dialogId', 'clientId', 'connector', 'text', 'attachments', 'format', 'createdAt',
  'targetExternalUserId', 'targetExternalChatId', 'targetEmail', 'targetPhone', 'stationId', 'stationName', 'meta'] as const;
const deliveryBinding = (command: SupportOutboxCommand) => deliveryFields.filter(key => key !== 'createdAt' || !command.admissionKey).map(key => command[key] ?? null);
export function maxRecoveryFingerprint(command: unknown): string {
  const row = BSON.EJSON.serialize(command, { relaxed: false });
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
}

/** All MAX state changes serialize through one pre-provisioned control document.
 * No provider or diagnostic side effect is permitted inside a transaction callback.
 * Legacy/non-MAX queues do not use this store. Standalone Mongo fails closed.
 */
export class MaxOutboxStore {
  constructor(private readonly collection: Collection<SupportOutboxCommand>,
    private readonly maxAttempts = MAX_DELIVERY_ATTEMPTS,
    private readonly clock: () => number = () => performance.now(),
    private readonly onFailure: FailureObserver = () => {},
    private readonly client?: MongoClient) {}

  private async transaction<T>(operation: string,
    action: (session: ClientSession, remaining: () => number, sequence: number, claimed: () => void) => Promise<T>, expectedControlFingerprint?: string): Promise<T> {
    const deadline = this.clock() + MAX_OUTBOX_TIMEOUT_MS;
    const remaining = () => {
      const left = Math.ceil(deadline - this.clock());
      if (left <= 0) throw new MongoOperationTimeoutError('MAX outbox operation budget exhausted');
      return left;
    };
    if (!this.client) throw new ServiceUnavailableException({ code: 'MAX_QUEUE_TRANSACTION_CLIENT_REQUIRED' });
    const session = this.client.startSession();
    const control = this.client.db(this.collection.dbName).collection<Control>(maxQueueControlName(this.collection.collectionName));
    let tentativeClaims = 0, stage = 'transaction';
    try {
      for (let attempt = 0; ; attempt++) {
        tentativeClaims = 0;
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
        try {
          // Write first, before reading any command: competing API processes conflict here.
          const fence = await control.findOneAndUpdate({ _id: MAX_QUEUE_CONTROL_ID, schema: 1, enabled: operation !== 'reconcile' },
            { $inc: { sequence: 1 } }, { session, returnDocument: 'before', timeoutMS: remaining() });
          if (expectedControlFingerprint && (!fence || maxRecoveryFingerprint(fence) !== expectedControlFingerprint)) throw new ConflictException({ code: 'MAX_RECONCILIATION_CONTROL_CHANGED' });
          if (!fence || !Number.isSafeInteger(fence.sequence + 1)) throw new ServiceUnavailableException({ code: 'MAX_QUEUE_NOT_PROVISIONED' });
          const result = await action(session, remaining, fence.sequence + 1, () => { tentativeClaims++; });
          stage = 'commit';
          await session.commitTransaction({ timeoutMS: remaining() });
          return result; // Only majority commit releases commands/API success.
        } catch (error) {
          const unknown = (error as { hasErrorLabel?: (label: string) => boolean })?.hasErrorLabel?.('UnknownTransactionCommitResult');
          if (session.inTransaction()) {
            // withTransaction adds a fresh full cleanup budget. Bound cleanup separately instead.
            await session.abortTransaction({ timeoutMS: Math.max(1, Math.min(100, deadline - this.clock())) }).catch(() => {});
          }
          if (!unknown && attempt < 7 && (error as { hasErrorLabel?: (label: string) => boolean })?.hasErrorLabel?.('TransientTransactionError') && this.clock() < deadline) {
            stage = 'transaction';
            continue; // Proven aborted DB transaction only; same immutable command ID.
          }
          if (unknown) stage = 'commit_unknown';
          throw error;
        }
      }
    } catch (error) {
      try { this.onFailure({ operation, stage, tentativeClaims }); } catch { /* telemetry never changes custody */ }
      throw error;
    } finally { await session.endSession(); }
  }

  async enqueue(command: SupportOutboxCommand): Promise<SupportOutboxCommand> {
    if (!isMaxConnector(command.connector) || command.status !== SupportOutboxStatus.PENDING || command.attempts !== 0) {
      throw new ConflictException({ code: 'MAX_OUTBOX_INVALID_ENQUEUE' });
    }
    return this.transaction('enqueue', async (session, remaining, sequence) => {
      const existing = await this.collection.findOne({ id: command.id }, { session, timeoutMS: remaining() });
      if (existing) {
        if (existing.admissionKey !== command.admissionKey || !isDeepStrictEqual(deliveryBinding(existing), deliveryBinding(command))) throw new ConflictException({ code: 'MAX_OUTBOX_ID_CONFLICT' });
        return existing; // Duplicate admission cannot reset a lease or terminal result.
      }
      const queued = { ...command, queueSequence: sequence };
      await this.collection.insertOne(queued, { session, timeoutMS: remaining() });
      return queued;
    });
  }

  async pull(connector: SupportConnectorRoute, limit: number, leaseSec: number, now = Date.now()) {
    return this.transaction('pull', async (session, remaining, _sequence, claimed) => {
      const at = new Date(now).toISOString();
      // Only new-protocol records. Old leases/commands stay untouched for individual review.
      await this.collection.updateMany({ connector, queueSequence: { $exists: true }, status: SupportOutboxStatus.LEASED,
        $or: [{ leasedUntil: { $lte: at } }, { leasedUntil: { $exists: false } }] }, {
        $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'DELIVERY_UNKNOWN', updatedAt: at, quarantinedAt: at }
        // Retain token/expiry privately for receipt-only reconciliation. Ordinary expired ACK stays409.
      }, { session, timeoutMS: remaining() });
      await this.collection.updateMany({ connector, queueSequence: { $exists: true }, status: SupportOutboxStatus.PENDING,
        attempts: { $gte: this.maxAttempts } }, {
        $set: { status: SupportOutboxStatus.FAILED, terminalReason: 'ATTEMPTS_EXHAUSTED', updatedAt: at },
        $unset: { nextAttemptAt: '' }
      }, { session, timeoutMS: remaining() });
      const safeFailure = { $or: [
        { terminalReason: 'PROVIDER_REFUSED', 'lastProviderFailure.category': 'PROVIDER_REFUSED', 'lastProviderFailure.status': { $gte: 400, $lt: 500, $ne: 429 } },
        { terminalReason: 'INVALID_INPUT', 'lastProviderFailure.category': 'INVALID_INPUT' },
        { terminalReason: 'ATTEMPTS_EXHAUSTED', 'lastProviderFailure.category': 'RATE_LIMITED', 'lastProviderFailure.status': 429 },
        { terminalReason: 'CONFIRMED_NOT_SENT', 'reconciliation.resolution': 'confirmed_not_sent' }
      ] };
      const heads = await this.collection.aggregate<SupportOutboxCommand>([
        { $match: { connector, $or: [{ status: { $in: [SupportOutboxStatus.PENDING, SupportOutboxStatus.LEASED] } },
          { status: SupportOutboxStatus.FAILED, $nor: [safeFailure] }] } },
        { $set: { _queueChat: { $trim: { input: { $ifNull: ['$targetExternalChatId', ''] } } },
          _queueUser: { $trim: { input: { $ifNull: ['$targetExternalUserId', ''] } } } } },
        { $sort: { queueSequence: 1, createdAt: 1, id: 1 } },
        { $group: { _id: { connector: '$connector', type: { $cond: [{ $ne: ['$_queueChat', ''] }, 'chat', 'user'] },
          target: { $cond: [{ $ne: ['$_queueChat', ''] }, '$_queueChat', '$_queueUser'] } }, head: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$head' } },
        { $match: { status: SupportOutboxStatus.PENDING, queueSequence: { $type: 'number' },
          $and: [{ $or: [{ attempts: { $lt: this.maxAttempts } }, { attempts: { $exists: false } }] },
            { $or: [{ nextAttemptAt: { $lte: at } }, { nextAttemptAt: { $exists: false } }] }] } },
        { $sort: { queueSequence: 1, id: 1 } }, { $limit: Math.min(50, Math.max(1, Math.floor(limit))) },
        { $unset: ['_queueChat', '_queueUser'] }
      ], { session, timeoutMS: remaining(), maxTimeMS: remaining() }).toArray();
      const commands: SupportOutboxCommand[] = [];
      for (const head of heads) {
        const command = await this.collection.findOneAndUpdate({ id: head.id, status: SupportOutboxStatus.PENDING,
          queueSequence: head.queueSequence }, {
          $set: { status: SupportOutboxStatus.LEASED, leaseToken: randomUUID(),
            leasedUntil: new Date(now + Math.min(300, Math.max(5, leaseSec)) * 1000).toISOString(), updatedAt: at },
          $inc: { attempts: 1 }, $unset: { lastReceipt: '', nextAttemptAt: '' }
        }, { session, returnDocument: 'after', timeoutMS: remaining() });
        if (!command) throw new ConflictException({ code: 'MAX_QUEUE_HEAD_CHANGED' });
        commands.push(command); claimed();
      }
      return commands;
    });
  }

  /** Offline operator primitive only. No public route and no provider transport.
   * Call only with separately authorized per-record evidence and paused consumers.
   */
  async reconcile(id: string, expectedFingerprint: string, resolution: 'confirmed_sent' | 'confirmed_not_sent', evidenceSha256: string, expectedControlFingerprint: string, now = Date.now()) {
    if (!/^[a-f0-9]{64}$/.test(expectedControlFingerprint) || !/^[a-f0-9]{64}$/.test(expectedFingerprint) || !/^[a-f0-9]{64}$/.test(evidenceSha256)
      || !['confirmed_sent', 'confirmed_not_sent'].includes(resolution)) throw new ConflictException({ code: 'MAX_RECONCILIATION_EVIDENCE_REQUIRED' });
    return this.transaction('reconcile', async (session, remaining) => {
      const command = await this.collection.findOne({ id }, { session, timeoutMS: remaining() });
      if (!command || !isMaxConnector(command.connector)) throw new ConflictException({ code: 'MAX_RECONCILIATION_STALE' });
      if (command.reconciliation?.evidenceSha256 === evidenceSha256 && command.reconciliation.resolution === resolution) return command;
      if (maxRecoveryFingerprint(command) !== expectedFingerprint || command.status === SupportOutboxStatus.SENT
        || (command.status === SupportOutboxStatus.LEASED && Date.parse(command.leasedUntil ?? '') > now)) {
        throw new ConflictException({ code: 'MAX_RECONCILIATION_STALE' });
      }
      const at = new Date(now).toISOString();
      const updated = await this.collection.findOneAndUpdate({ id, status: command.status, attempts: command.attempts }, {
        $set: { status: resolution === 'confirmed_sent' ? SupportOutboxStatus.SENT : SupportOutboxStatus.FAILED,
          terminalReason: resolution === 'confirmed_sent' ? 'CONFIRMED_SENT' : 'CONFIRMED_NOT_SENT', updatedAt: at,
          reconciliation: { resolution, evidenceSha256, at } }
      }, { session, timeoutMS: remaining(), returnDocument: 'after' });
      if (!updated) throw new ConflictException({ code: 'MAX_RECONCILIATION_STALE' });
      return updated;
    }, expectedControlFingerprint);
  }

  async receipt(id: string, kind: 'ack' | 'fail', body: MaxReceipt, now = Date.now()) {
    return this.transaction('receipt', (session, remaining) => this.receiptInTransaction(id, kind, body, now, session, remaining));
  }

  private async receiptInTransaction(id: string, kind: 'ack' | 'fail', body: MaxReceipt, now: number,
    session: ClientSession, remaining: () => number) {
    const token = body?.leaseToken;
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) {
      throw new ConflictException({ code: 'OUTBOX_LEASE_REQUIRED' });
    }
    const command = await this.collection.findOne({ id }, { session, timeoutMS: remaining() });
    if (!command || !isMaxConnector(command.connector)) throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
    if (!Number.isSafeInteger(command.queueSequence)) throw new ConflictException({ code: 'MAX_LEGACY_RECORD_REQUIRES_REVIEW' });
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
      if (failure.category === 'DELIVERY_UNKNOWN') {
        delete unset.leaseToken; delete unset.leasedUntil; set.quarantinedAt = at;
      }
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
    { $set: set, $unset: unset }, { returnDocument: 'after', includeResultMetadata: false, session, timeoutMS: remaining() });
    if (updated) return updated; // Mongo acknowledgement precedes API success.
    const concurrent = await this.collection.findOne({ id }, { session, timeoutMS: remaining() });
    if (concurrent?.lastReceipt?.token === token && concurrent.lastReceipt.kind === kind) return concurrent;
    throw new ConflictException({ code: 'OUTBOX_LEASE_STALE' });
  }
}

export function missingMaxStore(): never {
  throw new ServiceUnavailableException({ code: 'MAX_OUTBOX_PERSISTENCE_UNAVAILABLE' });
}
