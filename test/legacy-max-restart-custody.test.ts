import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { LegacyMaxCustodyStore, legacyMaxHeld, validateLegacyMaxSnapshot } from '../src/support/legacy-max-custody';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route, SupportOutboxCommand, SupportOutboxStatus as Status } from '../src/support/support.types';
import { Role } from '../src/common/rbac/role.enum';

const clone = <T>(value: T): T => structuredClone(value);
const row = (id = 'synthetic-command'): SupportOutboxCommand => ({ id, connector: Route.MAX_BOT, clientId: 'synthetic-client',
  dialogId: 'synthetic-dialog', text: 'PRIVATE SYNTHETIC MESSAGE', targetExternalChatId: 'PRIVATE SYNTHETIC TARGET',
  createdAt: new Date(0).toISOString(), attempts: 0, status: Status.PENDING });
class FixtureCollection {
  collectionName = 'synthetic-outbox';
  rows = new Map<string, any>(); writes = 0; loseAck = false; rejectWrite = false; rejectRead = false; block?: Promise<void>;
  async findOne(query: any) { if (this.rejectRead) throw Error('synthetic read unavailable'); return clone(this.rows.get(query.id)?.connector === query.connector ? this.rows.get(query.id) : null); }
  private matches(query: any) {
    const current = this.rows.get(query.id);
    return !query.$expr || isDeepStrictEqual(current, query.$expr.$eq[1].$literal);
  }
  async updateOne(query: any, update: any, options: any) {
    assert.equal(options.writeConcern.w, 'majority'); assert.equal(options.timeoutMS, 5000);
    if (this.block) await this.block;
    this.writes++;
    if (this.rejectWrite) throw Error('synthetic unavailable');
    if (!this.matches(query)) return { matchedCount: 0 };
    let current = this.rows.get(query.id);
    if (!current && update.$setOnInsert) { current = { ...clone(update.$setOnInsert), _id: 'synthetic-mongo-id' }; this.rows.set(query.id, current); }
    if (current) {
      for (const [key, value] of Object.entries(update.$set ?? {})) {
        if (key.startsWith('meta.')) { current.meta ??= {}; current.meta[key.slice(5)] = clone(value); }
        else current[key] = clone(value);
      }
      for (const key of Object.keys(update.$unset ?? {})) delete current[key];
    }
    if (this.loseAck) { this.loseAck = false; throw Error('synthetic lost ACK'); }
    return { matchedCount: current ? 1 : 0 };
  }
  async replaceOne(query: any, value: any) {
    this.writes++;
    if (this.matches(query)) this.rows.set(query.id, { ...clone(value), _id: this.rows.get(query.id)._id });
  }
  async insertOne(value: any) { this.writes++; if (this.rows.has(value.id)) throw Error('duplicate'); this.rows.set(value.id, { ...clone(value), _id: 'synthetic-mongo-id' }); }
}
const stripped = (value: any) => { const { _id, ...result } = value; return result; };
async function main() {
  const env = { ...process.env }; process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy';
  const originalFetch = globalThis.fetch; globalThis.fetch = (() => assert.fail('No provider invocation')) as any;
  try {
    const fixture = new FixtureCollection(), store = new LegacyMaxCustodyStore(fixture as any);
    const persistence = new SupportPersistenceService() as any;
    persistence.legacyMaxStore = () => ({ collection: fixture, owner: { db: { databaseName: 'synthetic' }, client: { options: { hosts: ['synthetic-host'] } } } });
    let release!: () => void; fixture.block = new Promise(resolve => { release = resolve; });
    const writing = persistence.persistOutboxCommand(row(), 'enqueue');
    await Promise.resolve();
    assert.equal(persistence.legacyMaxCustodyDiagnostics().pendingWrites, 1);
    assert.equal(fixture.rows.size, 0, 'enqueue must wait for a durable receipt');
    release(); await writing; fixture.block = undefined;
    assert.equal(persistence.legacyMaxCustodyDiagnostics().pendingWrites, 0);
    fixture.loseAck = true;
    const accepted = await store.transition(row('lost-ack'), 'enqueue');
    assert.equal(accepted.id, 'lost-ack', 'exact readback resolves one lost ACK without repeating the write');
    assert.equal(fixture.writes, 2);
    const initial = row('race'); await store.transition(initial, 'enqueue');
    const leased = (claim: string): SupportOutboxCommand => ({ ...initial, status: Status.LEASED, attempts: 1,
      leasedUntil: new Date(Date.now() + 60000).toISOString(), meta: { legacyMaxLeaseId: claim } });
    const racing = await Promise.allSettled([store.transition(leased(randomUUID()), 'lease', initial), store.transition(leased(randomUUID()), 'lease', initial)]);
    assert.equal(racing.filter(x => x.status === 'fulfilled').length, 1, 'one durable claim produces at most one dispatch');
    const claimed = stripped(fixture.rows.get(initial.id));
    fixture.loseAck = true;
    const sent = await store.transition({ ...claimed, status: Status.SENT, leasedUntil: undefined, lastError: undefined }, 'ack', claimed);
    await store.metadata({ ...initial, clientId: 'synthetic-merged', dialogId: 'synthetic-moved' });
    assert.equal(fixture.rows.get(initial.id).status, Status.SENT, 'stale metadata cannot undo SENT');
    await assert.rejects(store.transition({ ...initial, status: Status.PENDING }, 'fail', initial));
    const servicePersistence: any = { persistOutboxCommand: (next: any, op?: any, previous?: any) => op ? store.transition(next, op, previous) : undefined,
      getRuntimeDiagnostics: async () => ({}), legacyMaxCustodyDiagnostics: () => ({ pendingWrites: 0, writeFailures: 0 }) };
    const service = new SupportService(servicePersistence, { listEntries: () => [] } as any, {} as any) as any;
    const expired = { ...row('expired'), status: Status.LEASED, attempts: 1, leasedUntil: new Date(0).toISOString() };
    fixture.rows.set(expired.id, { ...clone(expired), _id: 'synthetic-expired-id' }); service.outbox.set(expired.id, expired);
    assert.deepEqual(await service.pullOutbox(Route.MAX_BOT), []);
    assert.equal(legacyMaxHeld(service.outbox.get(expired.id)), true);
    await assert.rejects(service.ackOutbox(expired.id), 'held custody cannot manufacture a send ACK');
    await assert.rejects(service.failOutbox(expired.id, 'retry', true), 'held custody cannot be requeued');
    const failing = { ...row('legacy-failure'), status: Status.LEASED, attempts: 1,
      leasedUntil: new Date(Date.now() + 60000).toISOString() };
    fixture.rows.set(failing.id, { ...clone(failing), _id: 'synthetic-failure-id' }); service.outbox.set(failing.id, failing);
    const failed = await service.failOutbox(failing.id, 'synthetic transport uncertainty', true);
    assert.equal(failed.status, Status.FAILED); assert.equal(legacyMaxHeld(failed), true);
    assert.deepEqual(await service.pullOutbox(Route.MAX_BOT), [], 'legacy failure never automatically replays an uncertain send');
    const source = { pid: 123, bootId: randomUUID(), startTicks: '123456', sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40), runtimeInventorySha256: 'c'.repeat(64) };
    const targetFingerprint = 'd'.repeat(64);
    const snapshot = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', source, targetFingerprint,
      capturedAt: new Date(0).toISOString(), commands: [row('snapshot')] }));
    const sha = createHash('sha256').update(snapshot).digest('hex');
    const manifest = { schema: 'PHAB_LEGACY_MAX_CUSTODY_IMPORT_V1' as const, snapshotSha256: sha, source, targetFingerprint };
    const imported = validateLegacyMaxSnapshot(snapshot, manifest);
    assert.equal(imported.length, 1);
    const held = await store.importHeld(imported[0], sha);
    assert.equal(held.status, Status.FAILED); assert.equal(legacyMaxHeld(held), true);
    const count = fixture.writes; assert.deepEqual(await store.importHeld(imported[0], sha), held); assert.equal(fixture.writes, count);
    await assert.rejects(store.importHeld({ ...imported[0], text: 'changed' }, 'f'.repeat(64)));
    assert.throws(() => validateLegacyMaxSnapshot(snapshot, { ...manifest, snapshotSha256: '0'.repeat(64) }));
    for (const change of [ { commands: [row(), row()] }, { commands: [{ ...row(), connector: Route.TG_BOT }] },
      { commands: [{ ...row(), leaseToken: 'unapproved' }] }, { capturedAt: 'invalid' } ]) {
      const bytes = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', source, targetFingerprint,
        capturedAt: new Date(0).toISOString(), commands: [row()], ...change }));
      assert.throws(() => validateLegacyMaxSnapshot(bytes, { ...manifest, snapshotSha256: createHash('sha256').update(bytes).digest('hex') }));
    }
    for (const key of ['pid','bootId','startTicks','sourceCommit','sourceTree','runtimeInventorySha256'] as const) {
      assert.throws(() => validateLegacyMaxSnapshot(snapshot, { ...manifest, source: { ...source, [key]: key === 'pid' ? 999 : 'changed' } }));
    }
    assert.throws(() => validateLegacyMaxSnapshot(snapshot, { ...manifest, targetFingerprint: 'e'.repeat(64) }));
    const beforeWrongTarget = fixture.writes;
    await assert.rejects(persistence.importLegacyMaxCustody(snapshot, manifest));
    assert.equal(fixture.writes, beforeWrongTarget, 'target mismatch fails before every write');
    const actualTarget = createHash('sha256').update(JSON.stringify({ hosts: ['synthetic-host'], db: 'synthetic', collection: fixture.collectionName })).digest('hex');
    const targetSnapshot = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', source,
      targetFingerprint: actualTarget, capturedAt: new Date(0).toISOString(), commands: [row('bound-import')] }));
    const approvedManifest = { ...manifest, targetFingerprint: actualTarget, snapshotSha256: createHash('sha256').update(targetSnapshot).digest('hex') };
    assert.equal((await persistence.importLegacyMaxCustody(targetSnapshot, approvedManifest)).imported, 1);
    const sentSnapshot = { ...row('memory-sent'), status: Status.SENT };
    const memorySentHeld = await store.importHeld(sentSnapshot, sha);
    assert.equal(memorySentHeld.status, Status.FAILED);
    assert.equal((memorySentHeld.meta!.legacyMaxRestartCustody as any).sourceStatus, Status.SENT);
    assert.equal((memorySentHeld.meta!.legacyMaxRestartCustody as any).sentEvidence, true);
    const durableSent = { ...row('durable-sent'), status: Status.SENT };
    fixture.rows.set(durableSent.id, { ...durableSent, _id: 'synthetic-id' });
    assert.equal((await store.importHeld({ ...durableSent, status: Status.LEASED }, sha)).status, Status.SENT);
    const diagnostics = await service.getRuntimeDiagnostics({ id: 'synthetic-admin', roles: [Role.SUPER_ADMIN] });
    assert.deepEqual(diagnostics.legacyMaxCustody.states, { PENDING: 0, LEASED: 0, SENT: 0, FAILED: 2 });
    assert.equal(diagnostics.legacyMaxCustody.held, 2);
    assert.equal(JSON.stringify(diagnostics.legacyMaxCustody).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(diagnostics.legacyMaxCustody).includes(expired.id), false);
    service.outbox.set('private-state', { ...row('private-state'), status: 'PRIVATE MALFORMED STATE' });
    assert.equal((await service.getRuntimeDiagnostics({ id: 'synthetic-admin', roles: [Role.SUPER_ADMIN] })).legacyMaxCustody.states.OTHER, 1);
    assert.equal(JSON.stringify((await service.getRuntimeDiagnostics({ id: 'synthetic-admin', roles: [Role.SUPER_ADMIN] })).legacyMaxCustody).includes('PRIVATE'), false);
    service.outbox.delete('private-state');
    await assert.rejects(service.getRuntimeDiagnostics({ id: 'synthetic-client', roles: [Role.CLIENT] }));
    const untouched = row('non-max'); untouched.connector = Route.TG_BOT;
    service.outbox.set(untouched.id, untouched);
    assert.equal(service.pullOutbox(Route.TG_BOT).length, 1, 'non-MAX synchronous legacy contract is retained');
    const acceptanceService = new SupportService(persistence, {} as any, {} as any) as any;
    let finishAcceptance!: () => void;
    fixture.block = new Promise(resolve => { finishAcceptance = resolve; });
    const accepting = acceptanceService.acceptOutbox(row('awaited-acceptance'));
    await Promise.resolve();
    assert.equal(acceptanceService.outbox.size, 0, 'uncommitted enqueue cannot become dispatchable');
    finishAcceptance(); await accepting; fixture.block = undefined;
    assert.equal(acceptanceService.outbox.size, 1);
    fixture.rejectRead = true; fixture.loseAck = true;
    const beforeUnknown = fixture.writes;
    await assert.rejects(acceptanceService.acceptOutbox(row('unknown-acceptance')));
    assert.equal(fixture.writes, beforeUnknown + 1, 'unknown acceptance never automatically retries its write');
    assert.equal(acceptanceService.outbox.has('unknown-acceptance'), false);
    fixture.rejectRead = false;
    assert.equal(fixture.rows.get('unknown-acceptance').status, Status.PENDING, 'the failed receipt did not prove no durable original');
    await acceptanceService.acceptOutbox(row('fresh-reply-retry'));
    const freshClaims = await acceptanceService.pullOutbox(Route.MAX_BOT, 20, 60);
    assert.equal(freshClaims.some((command: any) => command.id === 'unknown-acceptance'), false);
    assert.equal(freshClaims.filter((command: any) => command.id === 'fresh-reply-retry').length, 1);
    const unknownSnapshot = Buffer.from(JSON.stringify({ schema: 'PHAB_LEGACY_MAX_CUSTODY_SNAPSHOT_V1', source,
      targetFingerprint: actualTarget, capturedAt: new Date(0).toISOString(), commands: [row('unknown-acceptance')] }));
    await persistence.importLegacyMaxCustody(unknownSnapshot, { ...approvedManifest,
      snapshotSha256: createHash('sha256').update(unknownSnapshot).digest('hex') });
    const recoveredUnknown = stripped(fixture.rows.get('unknown-acceptance'));
    assert.equal(legacyMaxHeld(recoveredUnknown), true, 'only exact approved recovery may reconcile the retained original');
    const restarted = new SupportService(servicePersistence, {} as any, {} as any) as any;
    assert.equal(restarted.outbox.size, 0, 'no implicit hydration/recovery on reconstruction');
    restarted.outbox.set(recoveredUnknown.id, recoveredUnknown); // only the exact held fixture, never full Mongo hydration
    assert.deepEqual(await restarted.pullOutbox(Route.MAX_BOT), [], 'held original cannot become a second provider dispatch');
    fixture.rejectWrite = true;
    await assert.rejects(persistence.persistOutboxCommand(row('unavailable'), 'enqueue'));
    assert.equal(persistence.legacyMaxCustodyDiagnostics().writeFailures, 2);
    assert.equal(sent.status, Status.SENT);
    console.log('Legacy MAX restart custody: durable waits/readback/CAS, metadata protection, held recovery, privacy and non-MAX compatibility PASS');
  } finally { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
