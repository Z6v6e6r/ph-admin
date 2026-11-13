process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { SupportController } from '../src/support/support.controller';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';

async function main() {
  const previous = { ...process.env }, calls: string[] = [];
  const controller = new SupportController({
    getMaxOutboxHealth: () => { calls.push('health'); return { pending: 0 }; },
    pullOutbox: async () => { calls.push('pull'); return []; },
    ackOutbox: async () => { calls.push('ack'); }, failOutbox: async () => { calls.push('fail'); },
    resolveClient: async () => { calls.push('resolve'); }, ingestEvent: async () => { calls.push('ingress'); }
  } as any);
  const forbidden = (op: () => unknown) => assert.throws(op, (e: any) => e.getStatus() === 403);
  try {
    process.env.SUPPORT_INTEGRATION_TOKEN = 'synthetic-ingress';
    process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN = 'synthetic-queue';
    assert.deepEqual(controller.getMaxOutboxHealth('synthetic-queue', Route.MAX_BOT), { pending: 0 });
    forbidden(() => controller.getMaxOutboxHealth('synthetic-ingress', Route.MAX_BOT));
    await controller.pullOutbox('synthetic-queue', Route.MAX_BOT, 1, 120, 'max-lease-v1');
    await assert.rejects(controller.pullOutbox('synthetic-ingress', Route.MAX_BOT), (e: any) => e.getStatus() === 403);
    await controller.pullOutbox('synthetic-ingress', Route.TG_BOT);
    await assert.rejects(controller.pullOutbox('synthetic-queue', Route.TG_BOT), (e: any) => e.getStatus() === 403);
    await controller.ackOutbox('synthetic-queue', 'synthetic-command', { leaseToken: 'synthetic' });
    await controller.failOutbox('synthetic-queue', 'synthetic-command', { leaseToken: 'synthetic' });
    forbidden(() => controller.ackOutbox('synthetic-ingress', 'synthetic-command', { leaseToken: 'synthetic' }));
    await controller.resolveClient('synthetic-ingress');
    await controller.ingestEvent('synthetic-ingress', {} as any);
    await assert.rejects(controller.resolveClient('synthetic-queue'), (e: any) => e.getStatus() === 403);
    await assert.rejects(controller.ingestEvent('synthetic-queue', {} as any), (e: any) => e.getStatus() === 403);
    delete process.env.SUPPORT_INTEGRATION_TOKEN;
    for(const body of [{},{error:'synthetic',requeue:true},{other:true}]) {
      assert.throws(()=>controller.ackOutbox('synthetic-queue','synthetic-tg',body as any),(e:any)=>e.getStatus()===409);
      assert.throws(()=>controller.failOutbox('synthetic-queue','synthetic-tg',body as any),(e:any)=>e.getStatus()===409);
    }
    await controller.resolveClient(undefined); // Dedicated queue key does not change old ingress policy.
    delete process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN;
    const before = calls.length;
    assert.throws(() => controller.getMaxOutboxHealth(undefined, Route.MAX_BOT), (e: any) => e.getStatus() === 503);
    assert.equal(calls.length, before);
    process.env.SUPPORT_INTEGRATION_TOKEN = 'synthetic-ingress';
    controller.getMaxOutboxHealth('synthetic-ingress', Route.MAX_BOT); // Existing deployments keep fallback.
    process.env.SUPPORT_MAX_OUTBOX_INTEGRATION_TOKEN = '';
    assert.throws(() => controller.getMaxOutboxHealth('synthetic-ingress', Route.MAX_BOT), (e: any) => e.getStatus() === 503);
    // An explicitly fenced receipt can never fall through to a TG Map mutation.
    const row = { id: 'synthetic-tg', connector: Route.TG_BOT, status: Status.LEASED, attempts: 1 };
    let fenced = 0;
    const service = new SupportService({ acceptMaxReceipt: async () => { fenced++; throw Error('synthetic MAX-only store rejection'); },
      persistOutboxCommand: () => assert.fail('No legacy write') } as any, {} as any, {} as any);
    (service as any).outbox.set(row.id, row);
    await assert.rejects(service.ackOutbox(row.id, { leaseToken: 'synthetic' }), /MAX-only/);
    await assert.rejects(service.failOutbox(row.id, undefined, true, { leaseToken: 'synthetic' }), /MAX-only/);
    for(const body of [{leaseToken:null},{leaseToken:undefined},{failure:{status:429}},{retryAfterSeconds:1}]) {
      await assert.rejects(service.ackOutbox(row.id,body),/MAX-only/);
      await assert.rejects(service.failOutbox(row.id,undefined,true,body),/MAX-only/);
    }
    assert.equal(fenced, 10); assert.deepEqual((service as any).outbox.get(row.id), row);
    console.log('MAX dedicated integration auth: queue-only scope, legacy ingress/fallback and non-MAX receipt fencing PASS');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
