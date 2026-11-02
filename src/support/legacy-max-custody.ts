import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Collection, Document } from 'mongodb';
import { isMaxConnector, MAX_OUTBOX_TIMEOUT_MS } from './max-outbox-store';
import { SupportOutboxCommand, SupportOutboxStatus as Status } from './support.types';

export type LegacyMaxTransition = 'enqueue' | 'lease' | 'ack' | 'fail' | 'hold';
export interface LegacyMaxImportManifest {
  schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1';
  snapshotSha256: string;
  targetFingerprint: string;
  source: { pid: number; bootId: string; startTicks: string; sourceCommit: string; sourceTree: string; runtimeInventorySha256: string };
}
const unknown = () => new ServiceUnavailableException({ code: 'LEGACY_MAX_CUSTODY_UNKNOWN' });
const conflict = () => new ConflictException({ code: 'LEGACY_MAX_CUSTODY_CONFLICT' });
const options = { timeoutMS: MAX_OUTBOX_TIMEOUT_MS, readPreference: 'primary' as const,
  readConcern: { level: 'majority' as const } };
const write = { timeoutMS: MAX_OUTBOX_TIMEOUT_MS, writeConcern: { w: 'majority' as const, j: true } };
const mutable = new Set(['_id', 'status', 'attempts', 'leasedUntil', 'lastError', 'updatedAt', 'clientId', 'dialogId']);
const immutable = (row: SupportOutboxCommand) => JSON.parse(JSON.stringify(
  Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)))));
const command = (row: Document): SupportOutboxCommand => {
  const { _id, ...value } = row;
  return value as unknown as SupportOutboxCommand;
};
const transitionKeys = ['status', 'attempts', 'leasedUntil', 'lastError'] as const;
const sameTransition = (a: SupportOutboxCommand, b: SupportOutboxCommand) =>
  isDeepStrictEqual(immutable(a), immutable(b)) && transitionKeys.every(key => isDeepStrictEqual(a[key], b[key]));
const withoutHeld = (row: SupportOutboxCommand): SupportOutboxCommand => {
  const result: SupportOutboxCommand = { ...row, meta: { ...row.meta } };
  delete result.meta!.legacyMaxRestartCustody;
  if (!Object.keys(result.meta!).length) delete result.meta;
  return result;
};

/** Presence is permanent containment; malformed imported metadata must never become sendable. */
export function legacyMaxHeld(row: SupportOutboxCommand): boolean {
  return Object.prototype.hasOwnProperty.call(row.meta ?? {}, 'legacyMaxRestartCustody');
}

export class LegacyMaxCustodyStore {
  constructor(private readonly collection: Collection<SupportOutboxCommand>) {}
  private read(id: string, connector: SupportOutboxCommand['connector']) {
    return this.collection.findOne({ id, connector }, options);
  }
  async transition(next: SupportOutboxCommand, operation: LegacyMaxTransition,
    previous?: SupportOutboxCommand): Promise<SupportOutboxCommand> {
    if (!isMaxConnector(next.connector) || !next.id || !Number.isSafeInteger(next.attempts)
      || next.attempts < 0 || ['leaseToken', 'lastReceipt', 'terminalReason'].some(key => key in next)) throw conflict();
    const copy: SupportOutboxCommand = JSON.parse(JSON.stringify(next));
    if (operation === 'enqueue') {
      if (copy.status !== Status.PENDING || copy.attempts !== 0 || legacyMaxHeld(copy)) throw conflict();
      try { await this.collection.updateOne({ id: copy.id }, { $setOnInsert: copy }, { ...write, upsert: true }); }
      catch { /* The exact majority readback below is the only acceptance receipt. */ }
      const row = await this.read(copy.id, copy.connector).catch(() => null);
      if (!row || !isDeepStrictEqual(immutable(command(row)), immutable(copy)) || legacyMaxHeld(command(row))) throw unknown();
      return command(row);
    }
    if (!previous || previous.id !== copy.id || previous.connector !== copy.connector) throw conflict();
    if (!((operation === 'lease' && previous.status === Status.PENDING && copy.status === Status.LEASED
      && copy.attempts === previous.attempts + 1 && typeof copy.leasedUntil === 'string' && Date.parse(copy.leasedUntil) > Date.now()
      && typeof copy.meta?.legacyMaxLeaseId === 'string' && /^[a-f0-9-]{36}$/.test(copy.meta.legacyMaxLeaseId)
      && copy.meta.legacyMaxLeaseId !== previous.meta?.legacyMaxLeaseId)
      || (operation === 'ack' && [Status.LEASED, Status.SENT].includes(previous.status) && copy.status === Status.SENT)
      || (operation === 'fail' && [Status.PENDING, Status.LEASED, Status.FAILED].includes(previous.status)
        && [Status.PENDING, Status.FAILED].includes(copy.status))
      || (operation === 'hold' && [Status.PENDING, Status.LEASED, Status.FAILED].includes(previous.status) && copy.status === Status.FAILED))) throw conflict();
    const raw = await this.read(copy.id, copy.connector).catch(() => null);
    if (!raw) throw unknown();
    const current = command(raw);
    if (legacyMaxHeld(current)) {
      const marker = current.meta?.legacyMaxRestartCustody as { reason?: string } | undefined;
      if (operation === 'hold' && marker?.reason === 'DELIVERY_UNKNOWN'
        && sameTransition(withoutHeld(current), withoutHeld(copy))) return current;
      throw conflict();
    }
    if (sameTransition(current, copy)) return current;
    if (!sameTransition(current, previous)) throw conflict();
    const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
    for (const key of transitionKeys) {
      if (copy[key] === undefined) unset[key] = '';
      else set[key] = copy[key];
    }
    if (operation === 'lease') set['meta.legacyMaxLeaseId'] = copy.meta!.legacyMaxLeaseId;
    if (operation === 'hold') {
      if (![Status.PENDING, Status.LEASED, Status.FAILED].includes(previous.status) || copy.status !== Status.FAILED) throw conflict();
      set['meta.legacyMaxRestartCustody'] = { version: 1, reason: 'DELIVERY_UNKNOWN' };
      copy.meta = { ...copy.meta, legacyMaxRestartCustody: set['meta.legacyMaxRestartCustody'] };
    }
    try {
      await this.collection.updateOne({ id: copy.id, connector: copy.connector,
        $expr: { $eq: ['$$ROOT', { $literal: raw }] } } as Document,
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, write);
    } catch { /* Never dispatch/re-lease from an ambiguous write result. */ }
    const after = await this.read(copy.id, copy.connector).catch(() => null);
    if (!after || !sameTransition(command(after), copy)) throw unknown();
    return command(after);
  }
  async metadata(row: SupportOutboxCommand): Promise<void> {
    // Reconciliation can move metadata; a stale Map snapshot cannot rewrite delivery state/payload.
    const fields = { clientId: row.clientId, dialogId: row.dialogId };
    await this.collection.updateOne({ id: row.id, connector: row.connector }, { $set: fields }, write);
  }
  async importHeld(row: SupportOutboxCommand, snapshotSha256: string): Promise<SupportOutboxCommand> {
    const raw = await this.read(row.id, row.connector);
    if (raw) {
      const current = command(raw);
      const marker = current.meta?.legacyMaxRestartCustody as { snapshotSha256?: string } | undefined;
      if (marker?.snapshotSha256 === snapshotSha256) {
        const original = withoutHeld(current);
        if (!isDeepStrictEqual(immutable(original), immutable(row))) throw conflict();
        return current;
      }
      if (legacyMaxHeld(current) || !isDeepStrictEqual(immutable(current), immutable(row))) throw conflict();
    }
    const held: SupportOutboxCommand = { ...(raw ? command(raw) : structuredClone(row)),
      // Only an already durable SENT remains SENT. A snapshot never manufactures a send ACK.
      status: raw?.status === Status.SENT ? Status.SENT : Status.FAILED,
      meta: { ...(raw ? command(raw).meta : row.meta),
        legacyMaxRestartCustody: { version: 1, reason: 'OWNER_SNAPSHOT_HELD', snapshotSha256,
          sourceStatus: row.status, durableStatus: raw?.status ?? 'ABSENT',
          sourceLease: row.leasedUntil ?? null, durableLease: raw?.leasedUntil ?? null,
          sourceAttempts: row.attempts, durableAttempts: raw?.attempts ?? null,
          sentEvidence: row.status === Status.SENT || raw?.status === Status.SENT } } };
    delete held.leasedUntil;
    try {
      if (raw) await this.collection.replaceOne({ id: row.id, connector: row.connector,
        $expr: { $eq: ['$$ROOT', { $literal: raw }] } } as Document, structuredClone(held), write);
      else await this.collection.insertOne(structuredClone(held), write);
    } catch { /* Partial import is resumable using the same exact snapshot only. */ }
    const after = await this.read(row.id, row.connector);
    if (!after || !isDeepStrictEqual(command(after), held)) throw unknown();
    return command(after);
  }
}

export function validateLegacyMaxSnapshot(bytes: Buffer, manifest: LegacyMaxImportManifest): SupportOutboxCommand[] {
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'schema,snapshotSha256,source,targetFingerprint'
    || manifest.schema !== 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1'
    || !/^[a-f0-9]{64}$/.test(manifest.snapshotSha256) || !/^[a-f0-9]{64}$/.test(manifest.targetFingerprint)
    || bytes.length > 32 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== manifest.snapshotSha256) throw conflict();
  let snapshot: any;
  try { snapshot = JSON.parse(bytes.toString('utf8')); } catch { throw conflict(); }
  const source = snapshot?.source;
  if (!snapshot || Object.keys(snapshot).sort().join(',') !== 'capturedAt,commands,schema,source,targetFingerprint'
    || snapshot.schema !== 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1' || !source
    || Object.keys(source).sort().join(',') !== 'bootId,pid,runtimeInventorySha256,sourceCommit,sourceTree,startTicks'
    || !Number.isSafeInteger(source.pid) || source.pid < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source.bootId)
    || !/^[1-9][0-9]{0,30}$/.test(source.startTicks) || !/^[a-f0-9]{40}$/.test(source.sourceCommit)
    || !/^[a-f0-9]{40}$/.test(source.sourceTree) || !/^[a-f0-9]{64}$/.test(source.runtimeInventorySha256)
    || !isDeepStrictEqual(source, manifest.source) || snapshot.targetFingerprint !== manifest.targetFingerprint
    || typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt))
    || new Date(snapshot.capturedAt).toISOString() !== snapshot.capturedAt
    || !Array.isArray(snapshot.commands) || snapshot.commands.length < 1 || snapshot.commands.length > 5000) throw conflict();
  const ids = new Set<string>();
  for (const row of snapshot.commands) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isMaxConnector(row.connector)
      || typeof row.id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(row.id) || ids.has(row.id)
      || typeof row.dialogId !== 'string' || typeof row.clientId !== 'string' || typeof row.text !== 'string'
      || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || !Object.values(Status).includes(row.status)
      || legacyMaxHeld(row) || ['_id','leaseToken','lastReceipt','terminalReason'].some(key => key in row)) throw conflict();
    ids.add(row.id);
  }
  return structuredClone(snapshot.commands);
}
