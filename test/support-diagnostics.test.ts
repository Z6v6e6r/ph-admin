process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { SupportDiagnostics, supportDiagnostics } from '../src/support/support-diagnostics';
import { sanitizeEvent } from '../src/support/support-diagnostics-core';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute, SupportOutboxCommand, SupportOutboxStatus } from '../src/support/support.types';

async function main(): Promise<void> {
  for (const connector of ['MAX_BOT', 'MAX_ACADEMY_BOT']) {
    const events: Record<string, unknown>[] = [];
    const observer = new SupportDiagnostics(event => events.push(event), Buffer.alloc(32, 17));
    const owner = {};
    for (const stage of ['max_ingress', 'max_binding', 'max_outbox', 'max_lease', 'max_ack']) observer.observe(owner, stage, {
      connector, bindingRef: observer.ref('binding', 'synthetic-target'), text: 'private-message', targetExternalChatId: 'private-target',
      lastError: 'private-error', token: 'private-token', leasePresent: true, executionObserved: false, outcome: 'outcome_unknown',
    });
    assert.equal(events.length, 5); assert.equal(new Set(events.map(e => e.requestId)).size, 1);
    assert(events.every(e => e.connector === connector && e.botIdentityKnown === false && e.accessEvidenceKnown === false));
    assert(!JSON.stringify(events).includes('private'));
    const throwing = new SupportDiagnostics(() => { throw Error('private'); }); throwing.observe(owner, 'max_ack', { connector });
    assert.equal(throwing.snapshot().loggerFailures, 1);
  }
  for (let i = 0; i < 100; i++) {
    const secret = `${randomBytes(30).toString('hex')}\r\n`;
    const safe = sanitizeEvent({ schemaVersion: 1, diagnosticEventId: randomUUID(), requestId: randomUUID(), stage: secret, code: secret, raw: secret });
    assert(!JSON.stringify(safe).includes(secret));
  }
  assert.equal(new SupportDiagnostics().ref('outbox', 'low-entropy'), undefined);
  // Actual persistence method, synthetic transport only; no Nest application bootstrap or DB connection.
  for (const connector of [SupportConnectorRoute.MAX_BOT, SupportConnectorRoute.MAX_ACADEMY_BOT, SupportConnectorRoute.TG_BOT])
  for (const acknowledged of [true, false]) for (const rejectWrite of [true, false]) for (const isNew of [true, false]) {
    const isMax = connector !== SupportConnectorRoute.TG_BOT;
    const events: Record<string, unknown>[] = [], effects: string[] = [], tasks: Promise<void>[] = [];
    const saved = (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink;
    (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink = e => events.push(e);
    const persistence = Object.create(SupportPersistenceService.prototype) as SupportPersistenceService;
    Object.assign(persistence, {
      fireAndForget: (task: () => Promise<void>) => { tasks.push(task().catch(() => {})); },
      maxBackend: () => ({ config: { key: 'synthetic-max' } }),
      resolveTargetBackendForConnector: () => { assert(!isMax, 'MAX must not use fallback routing'); return { config: { key: 'synthetic' } }; },
      collection: () => ({ updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
        effects.push('update');
        assert.deepEqual(Object.keys(update), [isMax ? '$setOnInsert' : '$set']);
        if (rejectWrite) throw Error('private');
        return { acknowledged, matchedCount: isNew ? 0 : 1, modifiedCount: 0, upsertedCount: isNew ? 1 : 0 };
      } }),
      deleteFromOtherBackends: async () => { effects.push('cleanup'); },
    });
    const command = { id: 'synthetic-outbox', connector, status: SupportOutboxStatus.LEASED, attempts: 2 } as SupportOutboxCommand;
    persistence.persistOutboxCommand(command);
    assert(events.every(e => e.code !== 'DB_ACK'));
    await Promise.all(tasks);
    assert.equal(effects.filter(e => e === 'update').length, isMax ? 0 : 1, 'Background MAX snapshots must never admit or mutate a fenced command');
    assert.equal(effects.filter(e => e === 'cleanup').length, rejectWrite || isMax ? 0 : 1);
    assert.equal(events.filter(e => e.code === 'DB_ACK').length, 0, 'A background snapshot cannot attest new durable admission');
    assert(!JSON.stringify(events).includes('synthetic-outbox'));
    (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink = saved;
  }
  for (const reject of [false, true]) {
    const events: Record<string, unknown>[] = [];
    const saved = (supportDiagnostics as any).sink; (supportDiagnostics as any).sink = (event: Record<string, unknown>) => events.push(event);
    try {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const command = { id: 'synthetic-awaited-enqueue', connector: SupportConnectorRoute.MAX_BOT, status: SupportOutboxStatus.PENDING, attempts: 0 } as SupportOutboxCommand;
      const persistence = Object.create(SupportPersistenceService.prototype) as any;
      persistence.maxStore = () => ({ enqueue: async () => { await pending; if (reject) throw Error('synthetic rejection'); return { ...command, queueSequence: 1 }; } });
      const admission = persistence.enqueueMaxOutbox(command); assert.equal(events.length, 0);
      release();
      if (reject) await assert.rejects(() => admission); else await admission;
      assert.equal(events.filter(e => e.code === 'DB_ACK').length, reject ? 0 : 1, 'Only awaited committed admission emits DB_ACK');
      assert(!JSON.stringify(events).includes(command.id));
    } finally { (supportDiagnostics as any).sink = saved; }
  }
  for (const connector of [SupportConnectorRoute.MAX_BOT, SupportConnectorRoute.MAX_ACADEMY_BOT]) {
    const events: Record<string, unknown>[] = [], calls: string[] = [];
    const saved = (supportDiagnostics as any).sink;
    (supportDiagnostics as any).sink = (event: Record<string, unknown>) => events.push(event);
    try {
      let release!: (commands: SupportOutboxCommand[]) => void;
      let rejectReceipt = false;
      const command = { id: 'synthetic-max-store', connector, status: SupportOutboxStatus.LEASED, attempts: 1 } as SupportOutboxCommand;
      const service = new SupportService({
        pullMaxOutbox: () => new Promise<SupportOutboxCommand[]>(resolve => { calls.push('pull'); release = resolve; }),
        acceptMaxReceipt: async (_id: string, kind: string) => {
          calls.push(kind); if (rejectReceipt) throw Error('synthetic storage timeout');
          return { ...command, status: kind === 'ack' ? SupportOutboxStatus.SENT : SupportOutboxStatus.FAILED };
        }
      } as any, {} as any, {} as any);
      (service as any).outbox.set(command.id, command);
      const pull = service.pullOutbox(connector, 1, 60, 'max-lease-v1');
      assert.equal(events.length, 0, 'No lease observation before actual persistence claim');
      release([command]); await pull;
      assert.equal(events.filter(event => event.stage === 'max_lease').length, 1);
      await service.ackOutbox(command.id, {});
      await service.failOutbox(command.id, undefined, false, {});
      assert.equal(events.filter(event => event.stage === 'max_ack' && event.code === 'DB_ACK').length, 2);
      rejectReceipt = true;
      await assert.rejects(() => service.ackOutbox(command.id, {}), /storage timeout/);
      assert.equal(events.filter(event => event.code === 'DB_ACK').length, 2);
      assert.deepEqual(calls, ['pull', 'ack', 'fail', 'ack'], 'Observations add no request or retry');
    } finally { (supportDiagnostics as any).sink = saved; }
  }
  const mixed: Record<string, unknown>[] = [];
  const observer = new SupportDiagnostics(e => mixed.push(e), undefined, 2);
  for (const connector of ['EMAIL', 'TG', 'LK']) observer.observe({}, 'max_ingress', { connector });
  assert.equal(mixed.length, 0);
  for (let i = 0; i < 1000; i++) observer.observe({}, 'max_lease', { connector: 'MAX_BOT' });
  observer.flushSuppressed();
  assert.equal(mixed.length, 3); assert.equal(mixed[2].suppressedCount, 998); assert.equal(observer.snapshot().observed, 1000);
  console.log('support diagnostics: PASS (both bot bindings, privacy, no-key, throwing sink, actual synthetic persistence ACK/failure)');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
