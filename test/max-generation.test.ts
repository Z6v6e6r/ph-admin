import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { admitMaxGeneration, admitMaxIngress, consumeMaxIngress, assertMaxGenerationAccess, assertMaxGenerationControl, maxGeneration,
  maxGenerationAdmitted, maxOriginAdmitted, MAX_GENERATION_CONTROL_ID } from '../src/support/max-generation';
import { LegacyMaxCustodyStore } from '../src/support/legacy-max-custody';
import { SupportController } from '../src/support/support.controller';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status, SupportOutboxCommand } from '../src/support/support.types';

async function main() {
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  globalThis.fetch = (() => assert.fail('No provider transport in isolation checks')) as any;
  const after = new Date(Date.now() - 60000).toISOString(), at = new Date(Date.now() - 1000).toISOString();
  const generation = randomUUID(), config = { generation, after }, origin = { kind: 'STAFF_REPLY' as const, id: 'fresh-action', at };
  const row = (id: string): SupportOutboxCommand => ({ id, dialogId: 'fixture-dialog', clientId: 'fixture-client',
    connector: Route.MAX_BOT, text: 'PRIVATE SYNTHETIC BODY', targetExternalChatId: 'PRIVATE SYNTHETIC TARGET',
    createdAt: at, status: Status.PENDING, attempts: 0 });
  try {
    delete process.env.SUPPORT_MAX_GENERATION; delete process.env.SUPPORT_MAX_GENERATION_AFTER;
    process.env.SUPPORT_MAX_OUTBOX_MODE = 'legacy'; process.env.SUPPORT_MAX_GENERATION_TOKEN = 'synthetic-integration-token';
    assert.equal(maxGeneration(), undefined);
    for (const env of [{ SUPPORT_MAX_GENERATION: generation }, { SUPPORT_MAX_GENERATION_AFTER: after },
      { SUPPORT_MAX_GENERATION: '', SUPPORT_MAX_GENERATION_AFTER: after },
      { SUPPORT_MAX_GENERATION: generation, SUPPORT_MAX_GENERATION_AFTER: '2026-02-31T00:00:00.000Z' },
      { SUPPORT_MAX_GENERATION: generation, SUPPORT_MAX_GENERATION_AFTER: after, SUPPORT_MAX_OUTBOX_MODE: 'receipt-v1' }]) {
      assert.throws(() => maxGeneration(env));
    }
    process.env.SUPPORT_MAX_GENERATION = generation; process.env.SUPPORT_MAX_GENERATION_AFTER = after;
    assert.deepEqual(maxGeneration(), config);
    assert.equal(maxOriginAdmitted({ ...origin, at: after }), false);
    assert.equal(maxOriginAdmitted({ ...origin, id: '' }), false);
    assert.equal(maxOriginAdmitted({ ...origin, at: new Date(Date.now() + 60000).toISOString() }), false);
    assert.equal(maxOriginAdmitted({ ...origin, kind: 'NO_REPLY_TIMER' }), false);
    assert.throws(() => admitMaxGeneration(row('unknown'), undefined));
    assert.throws(() => admitMaxGeneration(row('old-intent-new-enqueue'), { ...origin, at: new Date(0).toISOString() }));
    const fresh = admitMaxGeneration(row('fresh'), origin);
    assert.equal(maxGenerationAdmitted(fresh), true);
    assert.equal(maxGenerationAdmitted(row('old-cache')), false);
    assert.equal(maxGenerationAdmitted({ ...fresh, meta: { ...fresh.meta, maxGenerationAdmission: {} } }), false);
    assert.equal(maxGenerationAdmitted(fresh, { ...config, generation: randomUUID() }), false);
    assert.equal(maxGenerationAdmitted(structuredClone(fresh)), true, 'restart keeps durable admission');

    const ledger = new Map<string, any>(); const control: any = {
      async findOne() { return ledger.get(MAX_GENERATION_CONTROL_ID) ?? null; },
      async findOneAndUpdate(q: any, update: any) {
        const value = ledger.get(q._id);
        if (!value || value.generation !== q.generation || value.originAt !== q.originAt || value.processingStartedAt) return null;
        Object.assign(value, update.$set); return structuredClone(value);
      },
      async insertOne(doc: any, options: any) {
        assert.equal(options.writeConcern.w, 'majority'); assert.equal(options.writeConcern.j, true);
        if (ledger.has(doc._id)) throw Error('duplicate'); ledger.set(doc._id, structuredClone(doc));
      }
    };
    await assert.rejects(assertMaxGenerationControl(control), 'unprovisioned control holds all admissions');
    ledger.set(MAX_GENERATION_CONTROL_ID, { _id: MAX_GENERATION_CONTROL_ID, schema: 1, ...config, state: 'CLOSED' });
    await assert.rejects(admitMaxIngress(control, Route.MAX_BOT, origin));
    ledger.get(MAX_GENERATION_CONTROL_ID).state = 'OPEN';
    const ticket = await admitMaxIngress(control, Route.MAX_BOT, origin);
    await consumeMaxIngress(control, Route.MAX_BOT, origin, ticket);
    await assert.rejects(consumeMaxIngress(control, Route.MAX_BOT, origin, ticket), 'one business processing after handler failure or restart');
    await assert.rejects(consumeMaxIngress(control, Route.MAX_BOT, { ...origin, id: 'foreign-event' }, ticket));
    await assert.rejects(admitMaxIngress(control, Route.MAX_BOT, origin), 'duplicate after handler failure or restart never reprocesses');
    const academyTicket = await admitMaxIngress(control, Route.MAX_ACADEMY_BOT, origin);
    await assert.rejects(consumeMaxIngress(control, Route.MAX_BOT, origin, academyTicket));
    await consumeMaxIngress(control, Route.MAX_ACADEMY_BOT, origin, academyTicket);
    const lostControl: any = { ...control, async insertOne(doc: any, options: any) { await control.insertOne(doc, options); throw Error('lost ACK'); } };
    await assert.rejects(admitMaxIngress(lostControl, Route.MAX_BOT, { ...origin, id: 'unknown-ACK' }));
    await assert.rejects(admitMaxIngress(control, Route.MAX_BOT, { ...origin, id: 'unknown-ACK' }));
    delete process.env.SUPPORT_MAX_GENERATION; delete process.env.SUPPORT_MAX_GENERATION_AFTER;
    await assert.rejects(assertMaxGenerationControl(control), 'removing environment never removes an existing durable fence');
    process.env.SUPPORT_MAX_GENERATION = generation; process.env.SUPPORT_MAX_GENERATION_AFTER = after;

    const rows = new Map<string, any>(); let writes = 0;
    const collection: any = {
      async findOne(q: any) { return structuredClone(rows.get(q.id) ?? null); },
      async updateOne(q: any, update: any) {
        writes++; const current = rows.get(q.id);
        if (q.$expr && !isDeepStrictEqual(current, q.$expr.$eq[1].$literal)) return;
        if (!current && update.$setOnInsert) rows.set(q.id, { _id: q.id, ...structuredClone(update.$setOnInsert) });
        else if (current) {
          for (const [key, value] of Object.entries(update.$set ?? {})) {
            if (key.startsWith('meta.')) { current.meta ??= {}; current.meta[key.slice(5)] = structuredClone(value); }
            else current[key] = structuredClone(value);
          }
          for (const key of Object.keys(update.$unset ?? {})) delete current[key];
        }
      }
    };
    const store = new LegacyMaxCustodyStore(collection, control);
    const old = row('old'); rows.set(old.id, { _id: old.id, ...old });
    const lease = (value: SupportOutboxCommand): SupportOutboxCommand => ({ ...value, status: Status.LEASED, attempts: 1,
      leasedUntil: new Date(Date.now() + 60000).toISOString(), meta: { ...value.meta, legacyMaxLeaseId: randomUUID() } });
    await assert.rejects(store.transition(lease(old), 'lease', old)); assert.equal(writes, 0);
    await store.transition(fresh, 'enqueue');
    const race = await Promise.allSettled([store.transition(lease(fresh), 'lease', fresh), store.transition(lease(fresh), 'lease', fresh)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    const cached = { ...fresh, id: 'residual-old-copy' }; rows.set(cached.id, { _id: cached.id, ...row(cached.id) });
    await assert.rejects(store.transition(lease(cached), 'lease', cached), 'fresh cached metadata cannot upgrade an old durable row');
    await assert.rejects(store.transition({ ...old, status: Status.SENT }, 'ack', old));
    await assert.rejects(store.transition({ ...old, status: Status.PENDING }, 'fail', old));
    const controller = new SupportController({ admitNewMaxUpdate() { assert.fail('unauthenticated admission'); } } as any);
    delete process.env.SUPPORT_MAX_GENERATION_TOKEN;
    assert.throws(() => maxGeneration(), 'active generation requires configured auth');
    await assert.rejects(controller.ingestEvent(undefined, { connector: Route.MAX_BOT, externalMessageId: 'synthetic', timestamp: at }));
    assert.throws(() => controller.admitNewMaxUpdate(undefined, {}));
    process.env.SUPPORT_MAX_GENERATION_TOKEN = 'synthetic-integration-token';
    assert.throws(() => assertMaxGenerationAccess(undefined));
    assert.throws(() => assertMaxGenerationAccess('invalid'));
    assert.doesNotThrow(() => assertMaxGenerationAccess('synthetic-integration-token'));
    assert.throws(() => controller.admitNewMaxUpdate(undefined, {}, 'invalid'));
    const persistence: any = { isEnabled: () => false, persistOutboxCommand: (...args: any[]) => store.transition(args[0], args[1], args[2]) };
    const service: any = new SupportService(persistence, { listEntries: () => [] } as any, {} as any);
    service.outbox.set(old.id, old);
    assert.deepEqual(await service.pullOutbox(Route.MAX_BOT), [], 'hydrated legacy rows produce no leases/writes');
    delete process.env.SUPPORT_INTEGRATION_TOKEN; // The new MAX scope must not enable shared auth.
    const http = new SupportController(service);
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      const scopedOld = { ...old, id: `old-${connector}`, connector };
      service.outbox.set(scopedOld.id, scopedOld);
      for (const badToken of [undefined, 'invalid']) {
        await assert.rejects(http.pullOutbox(undefined, connector, 1, 60, undefined, badToken), (e: any) => e.getStatus() === 403);
        await assert.rejects(http.ackOutbox(undefined, scopedOld.id, {}, badToken), (e: any) => e.getStatus() === 403);
        await assert.rejects(http.failOutbox(undefined, scopedOld.id, { requeue: false }, badToken), (e: any) => e.getStatus() === 403);
        await assert.rejects(http.resolveClient(undefined, undefined, undefined, connector, undefined, undefined, undefined, badToken), (e: any) => e.getStatus() === 403);
      }
      assert.deepEqual((await http.pullOutbox(undefined, connector, 1, 60, undefined, 'synthetic-integration-token')).commands, []);
      await assert.rejects(http.ackOutbox(undefined, scopedOld.id, {}, 'synthetic-integration-token'), (e: any) => e.getStatus() === 409);
    }
    await assert.rejects(http.ackOutbox(undefined, 'unknown-id'), (e: any) => e.getStatus() === 404);
    let resolved = Route.MAX_BOT;
    service.normalizeIncomingEvent = () => ({ connector: resolved, externalMessageId: `auth-${resolved}`, timestamp: at });
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      resolved = connector;
      // A body claiming nonMAX cannot bypass authentication after normalization selects MAX.
      await assert.rejects(http.ingestEvent(undefined, { connector: Route.EMAIL }), (e: any) => e.getStatus() === 403);
    }
    let nonMaxWrites = 0;
    const nonMax: any = new SupportService({ isEnabled: () => false, persistOutboxCommand() { nonMaxWrites++; } } as any,
      {} as any, {} as any);
    nonMax.outbox.set('email', { ...old, id: 'email', connector: Route.EMAIL });
    const nonMaxHttp = new SupportController(nonMax);
    assert.equal((await nonMaxHttp.ackOutbox(undefined, 'email')).status, Status.SENT);
    assert.equal(nonMaxWrites, 1, 'no MAX credential required by nonMAX ACK');
    nonMax.normalizeIncomingEvent = () => ({ connector: Route.EMAIL });
    const reachedNonMaxBusiness = new Error('synthetic-nonMAX-business');
    nonMax.loadIngestIdentityOwner = async () => { throw reachedNonMaxBusiness; };
    await assert.rejects(nonMaxHttp.ingestEvent(undefined, { connector: Route.EMAIL }), e => e === reachedNonMaxBusiness);
    // Exercise the actual sweep, whose rules are AUTO_REPLY too; restart must not reclassify it as ingress.
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) for (let restart = 0; restart < 2; restart++) {
      const timed: any = new SupportService(persistence, { listEntries: () => [] } as any,
        { findMatchingRules() { assert.fail('MAX no-reply timers remain held'); } } as any);
      timed.dialogs.set('fresh-cycle', { id: 'fresh-cycle', status: 'OPEN', lastReplyConnector: connector, connectors: [connector] });
      timed.canReplyToDialog = () => true;
      timed.getLatestAwaitingClientStaffMessage = () => ({ id: 'fresh-staff-cycle', createdAt: at });
      timed.getLatestClientMessage = () => ({ id: 'fresh-client', externalMessageId: 'fresh-provider-message', createdAt: at });
      await timed.sweepNoReplyQuickReplies(); assert.equal(timed.outbox.size, 0);
    }
    ledger.get(MAX_GENERATION_CONTROL_ID).state = 'CLOSED';
    await assert.rejects(store.transition(admitMaxGeneration(row('late-arrival'), origin), 'enqueue'));
    assert.equal(rows.has('late-arrival'), false);
    assert.ok(!JSON.stringify([...ledger.values()]).includes('PRIVATE SYNTHETIC'), 'ledger retains no recipient or message body');
    console.log('MAX generation: old/cache/residual hold, durable fence, closed/invalid config, concurrent claims, unknown/duplicate ingress and privacy PASS');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
main().catch(() => { console.error('MAX_GENERATION_TEST_FAILED'); process.exitCode = 1; });
