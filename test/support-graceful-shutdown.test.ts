import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HttpShutdownDrain, installShutdownHandlers } from '../src/common/graceful-shutdown';
import { MessengerPersistenceService } from '../src/messenger/messenger-persistence.service';
import { ChatMessage } from '../src/messenger/messenger.types';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportClientProfile, SupportConnectorRoute } from '../src/support/support.types';
import { QuickRepliesService } from '../src/quick-replies/quick-replies.service';
import { SupportMediaService } from '../src/support/support-media.service';

function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

function fixture(includeMirror = false) {
  const clients = new Map<string, unknown>();
  const dialogs = new Map<string, unknown>();
  const messages = new Map<string, unknown>([['older', { id: 'older' }]]);
  const stored = { clients, dialogs, messages };
  const writes: Array<{
    collection: keyof typeof stored;
    id: string;
    settle(error?: Error): void;
  }> = [];
  const errors: string[] = [];
  let closed = false;
  let closes = 0;
  const persistence = new SupportPersistenceService();
  const config = { key: 'primary', collections: { clients: 'clients', dialogs: 'dialogs', messages: 'messages' } };
  const backend = {
    config,
    client: { async close() { closed = true; closes += 1; } },
    db: {
      collection(name: keyof typeof stored) {
        assert.ok(Object.prototype.hasOwnProperty.call(stored, name), 'fixture permits only history writes');
        return {
          updateOne(filter: { id: string }, update: { $set: { id: string } }) {
            assert.equal(closed, false);
            assert.equal(filter.id, update.$set.id);
            const value = structuredClone(update.$set);
            return new Promise<void>((resolve, reject) => {
              writes.push({
                collection: name, id: value.id,
                settle(error) {
                  if (error || closed) {
                    reject(error ?? new Error('Storage is already closed'));
                    return;
                  }
                  stored[name].set(value.id, value);
                  resolve();
                }
              });
            });
          }
        };
      }
    }
  };
  const mirrorConfig = { ...config, key: 'web' };
  const backends = includeMirror ? [backend, { ...backend, config: mirrorConfig }] : [backend];
  Object.assign(persistence, {
    backendConfigs: backends.map(state => state.config),
    backendStates: new Map(backends.map(state => [state.config.key, state])),
    logger: { error: (message: string) => errors.push(message) },
    findClients: async () => []
  });
  const registry = {
    resolveRoute: (key: unknown) => key === SupportConnectorRoute.MAX_BOT ? key : undefined,
    listEntries: () => [],
    normalizeIncomingEvent: () => ({})
  } as unknown as SupportConnectorRegistry;
  const quickReplies = { findMatchingRules: () => [] } as unknown as QuickRepliesService;
  const media = { managedIngestEnabled: false } as SupportMediaService;
  const support = new SupportService(persistence, registry, quickReplies, media);
  const ingest = () => support.ingestEvent({
    connector: SupportConnectorRoute.MAX_BOT,
    externalUserId: 'synthetic-user',
    externalChatId: 'synthetic-chat',
    text: 'synthetic inbound message'
  });
  return { persistence, support, ingest, stored, writes, errors, closes: () => closes };
}

async function runChild(): Promise<void> {
  Object.assign(process.env, {
    QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false',
    SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
    SUPPORT_MAX_OUTBOX_MODE: 'legacy'
  });
  const f = fixture();
  const handler = gate();
  const notify = (type: string, fields: object = {}) => process.send?.({ type, ...fields });
  process.on('message', (command: string) => {
    if (command === 'finish-handler') handler.release();
    if (command === 'commit-history') {
      assert.equal(f.closes(), 0);
      for (const write of f.writes) write.settle();
      notify('history-committed');
    }
  });

  @Controller()
  class FixtureController {
    @Post('message')
    async message() {
      notify('handler-entered');
      await handler.pending;
      const accepted = await f.ingest();
      assert.ok(accepted.message?.id);
      assert.equal(f.stored.messages.has(accepted.message.id), false);
      notify('message-accepted');
      return accepted;
    }
  }

  @Module({
    controllers: [FixtureController],
    providers: [{
      provide: 'FixtureHistoryShutdown',
      useValue: { onModuleDestroy: () => f.persistence.onModuleDestroy() }
    }]
  })
  class FixtureModule {}

  const app = await NestFactory.create(FixtureModule, { logger: false });
  const drain = new HttpShutdownDrain();
  app.use(drain.middleware);
  app.use((req: { headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
    if (req.headers['x-fixture-slow-body']) notify('body-admitted');
    next();
  });
  app.useGlobalInterceptors(drain);
  await app.listen(0, '127.0.0.1');
  installShutdownHandlers(async () => {
    const http = drain.drain();
    notify('admission-closed');
    await Promise.all([http, f.support.stopScheduledWork()]);
    notify('handler-drained');
    await app.close();
    notify('stopped', { closes: f.closes(), messages: f.stored.messages.size,
      dialogs: f.stored.dialogs.size, olderPresent: f.stored.messages.has('older') });
    process.disconnect?.();
  });
  notify('listening', { port: (app.getHttpServer().address() as AddressInfo).port });
}

if (process.argv.includes('--shutdown-fixture')) {
  void runChild().catch(error => { console.error(error); process.exitCode = 1; process.disconnect?.(); });
} else {
  test('support storage waits for every outstanding history write before closing', async () => {
    const f = fixture();
    await f.ingest();
    assert.equal(f.persistence.legacyMaxCustodyDiagnostics().pendingWrites, 0);
    assert.equal(f.stored.messages.size, 1);
    const shutdown = f.persistence.onModuleDestroy();
    assert.equal(f.persistence.onModuleDestroy(), shutdown);
    const message = f.writes.find(write => write.collection === 'messages');
    assert.ok(message);
    for (const write of f.writes) {
      if (write !== message) write.settle();
    }
    await yieldTurn();
    assert.equal(f.closes(), 0);
    assert.throws(() => f.persistence.persistMessage({} as never), /History persistence is shutting down/);
    message.settle(new Error('synthetic history write failure'));
    await shutdown;
    assert.equal(f.closes(), 1);
    assert.equal(f.persistence.hasUnconfirmedWrites, true);
    assert.ok(f.errors.some(message => message.includes('synthetic history write failure')));
    assert.ok(f.stored.messages.has('older'));
  });

  test('a rejected mirror write does not close another backend whose write is still pending', async () => {
    const f = fixture(true);
    f.persistence.persistClient({ id: 'synthetic-client' } as SupportClientProfile);
    assert.equal(f.writes.length, 2);
    f.writes[0].settle(new Error('synthetic mirror failure'));
    await yieldTurn();
    assert.equal(f.persistence.hasUnconfirmedWrites, false);
    const shutdown = f.persistence.onModuleDestroy();
    await yieldTurn();
    assert.equal(f.closes(), 0);
    f.writes[1].settle();
    await shutdown;
    assert.equal(f.closes(), 2);
    assert.equal(f.persistence.hasUnconfirmedWrites, true);
    assert.ok(f.stored.clients.has('synthetic-client'));
  });

  test('the Messenger history store also waits for its admitted message write', async () => {
    const stored = gate();
    let closed = false;
    const persistence = new MessengerPersistenceService();
    Object.assign(persistence, {
      client: { async close() { closed = true; } },
      db: { collection: () => ({ updateOne: () => stored.pending }) }
    });
    persistence.persistMessage({ id: 'synthetic-messenger' } as ChatMessage);
    const shutdown = persistence.onModuleDestroy();
    await yieldTurn();
    assert.equal(closed, false);
    stored.release();
    await shutdown;
    assert.equal(closed, true);
    assert.equal(persistence.hasUnconfirmedWrites, false);
  });

  test('SIGTERM waits for the handler even after the client aborts and then flushes its history', { timeout: 20000 }, async () => {
    const child = fork(__filename, ['--shutdown-fixture'], {
      execArgv: __filename.endsWith('.ts') ? ['-r', require.resolve('ts-node/register')] : [],
      env: { PATH: process.env.PATH, TS_NODE_TRANSPILE_ONLY: 'true' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    const exit = once(child, 'exit');
    const seen: Array<{ type: string; port?: number }> = [];
    const wait = (type: string) => new Promise<{ type: string; port?: number }>((resolve, reject) => {
      const found = seen.find(message => message.type === type);
      if (found) { resolve(found); return; }
      const receive = (message: { type: string; port?: number }) => {
        if (message.type === type) {
          child.off('message', receive);
          child.off('exit', earlyExit);
          resolve(message);
        }
      };
      const earlyExit = () => {
        child.off('message', receive);
        reject(new Error(`Shutdown fixture exited before ${type}`));
      };
      child.on('message', receive);
      child.once('exit', earlyExit);
    });
    child.on('message', (message: { type: string; port?: number }) => seen.push(message));
    try {
      const { port } = await wait('listening');
      const url = `http://127.0.0.1:${port}/message`;
      const client = request(url, { method: 'POST' });
      client.on('error', () => {});
      client.end();
      await wait('handler-entered');
      client.destroy();
      const slow = request(url, { method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': '2', 'x-fixture-slow-body': 'true'
      } });
      const slowResponse = once(slow, 'response');
      slow.write('{');
      await wait('body-admitted');

      child.kill('SIGTERM');
      await wait('admission-closed');
      child.kill('SIGTERM');
      slow.end('}');
      const [late] = await slowResponse;
      assert.equal(late.statusCode, 503);
      late.resume();
      const refused = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
      assert.equal(refused.status, 503);
      assert.equal(refused.headers.get('connection'), 'close');
      await refused.text();
      assert.equal(seen.some(message => message.type === 'handler-drained'), false);

      child.send('finish-handler');
      await wait('message-accepted');
      await wait('handler-drained');
      child.send('commit-history');
      await wait('history-committed');
      assert.deepEqual(await wait('stopped'), {
        type: 'stopped', closes: 1, messages: 2, dialogs: 1, olderPresent: true
      });
      assert.deepEqual(await exit, [0, null]);
      assert.equal(seen.filter(message => message.type === 'admission-closed').length, 1);
      assert.equal(seen.filter(message => message.type === 'handler-entered').length, 1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
}
