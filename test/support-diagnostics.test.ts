import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { SupportDiagnostics, supportDiagnostics } from '../src/support/support-diagnostics';
import { sanitizeEvent } from '../src/support/support-diagnostics-core';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
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
  for (const acknowledged of [true, false]) for (const rejectWrite of [true, false]) {
    const events: Record<string, unknown>[] = [], effects: string[] = [], tasks: Promise<void>[] = [];
    const saved = (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink;
    (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink = e => events.push(e);
    const persistence = Object.create(SupportPersistenceService.prototype) as SupportPersistenceService;
    Object.assign(persistence, {
      fireAndForget: (task: () => Promise<void>) => { tasks.push(task().catch(() => {})); },
      resolveTargetBackendForConnector: () => ({ config: { key: 'synthetic' } }),
      collection: () => ({ updateOne: async () => { effects.push('update'); if (rejectWrite) throw Error('private'); return { acknowledged, matchedCount: 1, modifiedCount: 1 }; } }),
      deleteFromOtherBackends: async () => { effects.push('cleanup'); },
    });
    const command = { id: 'synthetic-outbox', connector: SupportConnectorRoute.MAX_BOT, status: SupportOutboxStatus.LEASED, attempts: 2 } as SupportOutboxCommand;
    persistence.persistOutboxCommand(command);
    assert(events.every(e => e.code !== 'DB_ACK'));
    await Promise.all(tasks);
    assert.equal(effects.filter(e => e === 'update').length, 1);
    assert.equal(effects.filter(e => e === 'cleanup').length, rejectWrite ? 0 : 1);
    assert.equal(events.filter(e => e.code === 'DB_ACK').length, !rejectWrite && acknowledged ? 1 : 0);
    assert(!JSON.stringify(events).includes('synthetic-outbox'));
    (supportDiagnostics as unknown as { sink: (e: Record<string, unknown>) => void }).sink = saved;
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
