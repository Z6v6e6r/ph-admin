import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Db, MongoClient } from 'mongodb';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute, SupportMessageKind } from '../src/support/support.types';

const aPhone = '70000000001';
const bPhone = '70000000002';
const sharedPhone = '70000000003';
const suffixes = ['primary', 'web', 'max'] as const;
const collections = [
  'support_clients', 'support_dialogs', 'support_messages',
  'support_service_messages', 'support_response_metrics', 'support_outbox'
];

interface ExpectedContact {
  id: string;
  clientId: string;
  dialogId: string;
  phone: string;
  email: string;
}

function testUri(): string {
  const raw = process.env.SUPPORT_IDENTITY_MONGODB_TEST_URI;
  assert.ok(raw, 'SUPPORT_IDENTITY_MONGODB_TEST_URI is required; there is no live/default fallback');
  const uri = new URL(raw);
  assert.equal(uri.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', 'phab-cup-r1-mongo'].includes(uri.hostname),
    'Only a loopback or task-owned Mongo fixture is allowed');
  assert.equal(uri.username, '');
  assert.equal(uri.password, '');
  assert.equal(uri.pathname, '/');
  assert.ok(uri.searchParams.get('replicaSet'), 'A replica-set fixture is required');
  assert.equal(uri.searchParams.get('retryWrites'), 'true');
  assert.equal(uri.searchParams.get('w'), 'majority');
  return raw;
}

function databaseNames(prefix: string): string[] {
  assert.match(prefix, /^phab_support_identity_[a-f0-9]{32}$/);
  return suffixes.map(suffix => `${prefix}_${suffix}`);
}

function support(persistence: SupportPersistenceService): SupportService {
  // Connector delivery and quick-reply workers are deliberately not started.
  const registry = {
    resolveRoute(raw: unknown) {
      return Object.values(SupportConnectorRoute).find(route => route === String(raw).toUpperCase());
    },
    normalizeIncomingEvent() { return {}; },
    listEntries() { return []; }
  } as unknown as SupportConnectorRegistry;
  const replies = { registerUsage() {}, listRules() { return []; }, findMatchingRules() { return []; } };
  return new SupportService(persistence, registry, replies as never);
}

async function snapshot(client: MongoClient, prefix: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const name of databaseNames(prefix)) {
    for (const collection of collections) {
      result.push(await client.db(name).collection(collection).find({}, { projection: { _id: 0 } })
        .sort({ id: 1 }).toArray());
    }
  }
  return result;
}

async function settled(client: MongoClient, prefix: string): Promise<void> {
  // Persistence is fire-and-forget. Wait for actual durable reads, not a mocked flush.
  let previous = '';
  let stable = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = JSON.stringify(await snapshot(client, prefix));
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 3) return;
    previous = current;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('Support fixture did not reach a stable persisted state');
}

async function assertOwners(persistence: SupportPersistenceService, expected: ExpectedContact[]) {
  const state = await persistence.loadState();
  assert.equal(state.clients.length, 2, 'A and B must remain two persisted clients');
  const a = state.clients.find(client => client.phones.includes(aPhone));
  const b = state.clients.find(client => client.phones.includes(bPhone));
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a.phones, [aPhone]);
  assert.deepEqual(b.phones, [bPhone]);
  assert.deepEqual(a.emails, []);
  assert.deepEqual(b.emails, []);
  assert.equal(state.clients.some(client => client.phones.includes(sharedPhone)), false);
  assert.ok(a.identities.some(identity => identity.externalUserId === 'max-a'));
  assert.ok(b.identities.some(identity => identity.externalUserId === 'max-b'));
  assert.equal(a.identities.some(identity => identity.externalUserId === 'max-b'), false);
  assert.equal(b.identities.some(identity => identity.externalUserId === 'max-a'), false);
  for (const [text, owner] of [['A private history', a], ['B private history', b]] as const) {
    const message = state.messages.find(item => item.text === text);
    assert.ok(message, 'Original client history must survive');
    assert.equal(message.clientId, owner.id);
    assert.equal(state.dialogs.find(dialog => dialog.id === message.dialogId)?.clientId, owner.id,
      JSON.stringify({ message, dialogs: state.dialogs }));
  }
  const shared = state.messages.filter(item => item.meta?.sharedContact);
  assert.deepEqual(shared.map(message => message.id).sort(), expected.map(message => message.id).sort(),
    'Every returned shared-contact message must actually persist, including after process restart');
  for (const contact of expected) {
    const message = shared.find(item => item.id === contact.id);
    assert.ok(message, `Missing persisted shared contact ${contact.id}`);
    assert.equal(message.clientId, a.id);
    assert.equal(message.clientId, contact.clientId);
    assert.equal(message.dialogId, contact.dialogId);
    assert.equal(message.phone, aPhone);
    assert.ok(message.email == null, 'A shared contact email must not become sender identity');
    assert.deepEqual(message.meta?.sharedContact, { phone: contact.phone, email: contact.email });
    assert.equal(state.dialogs.find(dialog => dialog.id === message.dialogId)?.clientId, a.id);
  }
  return [a, b];
}

async function phase(name: string, prefix: string, expected: ExpectedContact[]): Promise<void> {
  const uri = testUri();
  databaseNames(prefix);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  const persistence = new SupportPersistenceService();
  const service = support(persistence);
  try {
    await client.connect();
    await persistence.onModuleInit();
    const diagnostics = await persistence.getRuntimeDiagnostics();
    assert.deepEqual(diagnostics.backends.map(backend => backend.key), [...suffixes]);
    assert.ok(diagnostics.backends.every(backend => backend.enabled));

    if (name === 'seed') {
      for (const [owner, phone] of [['a', aPhone], ['b', bPhone]] as const) {
        await service.ingestEvent({
          connector: SupportConnectorRoute.LK_WEB_MESSENGER,
          externalUserId: `owner-${owner}`, externalChatId: `lk:owner-${owner}`,
          phone, displayName: `Owner ${owner}`, text: `${owner.toUpperCase()} private history`,
          kind: SupportMessageKind.TEXT
        });
        await settled(client, prefix);
        await service.ingestEvent({
          connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: `max-${owner}`, externalChatId: `max-chat-${owner}`,
          phone, displayName: `Owner ${owner}`, kind: SupportMessageKind.CONTACT
        });
        await settled(client, prefix);
      }
    } else if (name === 'reload') {
      await service.hydrateFromPersistence();
      (service as unknown as { reconcileState(): void }).reconcileState();
      const a = await service.resolveClient({ phone: aPhone });
      const b = await service.resolveClient({ phone: bPhone });
      assert.ok(a.client);
      assert.ok(b.client);
      assert.notEqual(a.client.id, b.client.id);
      assert.equal((await service.resolveClient({ phone: sharedPhone })).client, null);
    } else if (name === 'partial-a' || name === 'partial-b') {
      // Cache only one real persisted client; no full hydration in this process.
      await service.resolveClient({ phone: name === 'partial-a' ? aPhone : bPhone });
      const a = (await persistence.findClients({ phone: aPhone }))[0];
      assert.ok(a);
      for (const phone of [bPhone, sharedPhone]) {
        const forwarded = await service.ingestEvent({
          connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone,
          email: 'shared@example.invalid', displayName: 'Shared contact',
          kind: SupportMessageKind.CONTACT
        });
        assert.equal(forwarded.client.id, a.id, 'A forwarding a contact must remain A');
        assert.deepEqual(forwarded.client.phones, [aPhone]);
        assert.equal(forwarded.message?.phone, aPhone);
        assert.equal(forwarded.message?.email, undefined);
        assert.deepEqual(forwarded.message?.meta?.sharedContact, { phone, email: 'shared@example.invalid' });
        assert.ok(forwarded.message);
        expected.push({ id: forwarded.message.id, clientId: forwarded.client.id,
          dialogId: forwarded.dialog.id, phone, email: 'shared@example.invalid' });
        await settled(client, prefix);
      }
    } else if (name === 'lookup-failure') {
      await service.resolveClient({ phone: bPhone });
      await settled(client, prefix);
      const before = await snapshot(client, prefix);
      const states = (persistence as unknown as {
        backendStates: Map<string, { client?: MongoClient; db?: Db }>
      }).backendStates;
      const max = states.get('max');
      assert.ok(max?.client);
      await max.client.close();
      const event = {
        connector: SupportConnectorRoute.MAX_BOT,
        externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
        kind: SupportMessageKind.CONTACT
      };
      // An active-looking backend whose real query fails must not permit a link.
      await assert.rejects(service.ingestEvent(event),
        (error: unknown) => (error as { getStatus(): number }).getStatus() === 503);
      await settled(client, prefix);
      assert.deepEqual(await snapshot(client, prefix), before);
      // A configured backend missing from the active set must fail before writes too.
      max.db = undefined;
      await assert.rejects(service.ingestEvent(event),
        (error: unknown) => (error as { getStatus(): number }).getStatus() === 503);
      await settled(client, prefix);
      assert.deepEqual(await snapshot(client, prefix), before);
      console.log(`SUPPORT_IDENTITY_PHASE:${JSON.stringify({ name, pid: process.pid, expected })}`);
      return;
    } else {
      assert.fail('Unknown test phase');
    }
    await settled(client, prefix);
    const owners = await assertOwners(persistence, expected);
    // Check each physical backend copy, not only loadState's deduplicated view.
    for (const db of databaseNames(prefix)) {
      const clients = await client.db(db).collection('support_clients').find({}).toArray();
      assert.equal(clients.length, 2);
      for (const owner of owners) {
        const actual = clients.find(item => item.id === owner.id);
        assert.ok(actual);
        assert.deepEqual(actual.phones, owner.phones);
        const identities = (values: typeof owner.identities) => values.map(identity =>
          [identity.connector, identity.externalUserId, identity.externalChatId].join(':')).sort();
        assert.deepEqual(identities(actual.identities), identities(owner.identities));
      }
      for (const contact of expected) {
        const message = await client.db(db).collection('support_messages').findOne({ id: contact.id });
        if (db.endsWith('_max')) {
          assert.ok(message, `Missing contact in physical MAX backend: ${contact.id}`);
          assert.equal(message.clientId, contact.clientId);
          assert.equal(message.dialogId, contact.dialogId);
          assert.deepEqual(message.meta.sharedContact, { phone: contact.phone, email: contact.email });
          const dialog = await client.db(db).collection('support_dialogs').findOne({ id: contact.dialogId });
          assert.equal(dialog?.clientId, contact.clientId);
        } else {
          assert.equal(message, null, 'A shared contact must not be written to an unrelated backend');
        }
      }
    }
    console.log(`SUPPORT_IDENTITY_PHASE:${JSON.stringify({ name, pid: process.pid, expected })}`);
  } finally {
    service.onModuleDestroy();
    await persistence.onModuleDestroy();
    await client.close();
  }
}

async function main(): Promise<void> {
  const uri = testUri();
  const prefix = `phab_support_identity_${randomUUID().replace(/-/g, '')}`;
  const names = databaseNames(prefix);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  try {
    await client.connect();
    assert.equal(typeof (await client.db('admin').command({ hello: 1 })).setName, 'string');
    const pids = new Set<number>();
    let expected: ExpectedContact[] = [];
    for (const name of ['seed', 'partial-a', 'partial-b', 'reload', 'lookup-failure']) {
      const result = spawnSync(process.execPath,
        ['-r', 'ts-node/register', __filename, '--phase', name, prefix, JSON.stringify(expected)], {
          cwd: process.cwd(), timeout: 120000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            SUPPORT_IDENTITY_MONGODB_TEST_URI: uri,
            SUPPORT_MONGODB_URI: uri, SUPPORT_MONGODB_DB: names[0],
            SUPPORT_WEB_MONGODB_URI: uri, SUPPORT_WEB_MONGODB_DB: names[1],
            SUPPORT_MAX_MONGODB_URI: uri, SUPPORT_MAX_MONGODB_DB: names[2],
            SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
            QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false'
          }
        });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${name} failed:\n${result.stdout}\n${result.stderr}`);
      const marker = result.stdout.split('\n').find(line => line.startsWith('SUPPORT_IDENTITY_PHASE:'));
      assert.ok(marker, 'A real subprocess must report completion');
      const completed = JSON.parse(marker.slice('SUPPORT_IDENTITY_PHASE:'.length));
      assert.equal(completed.name, name);
      assert.equal(completed.expected.length, expected.length + (name.startsWith('partial-') ? 2 : 0));
      expected = completed.expected;
      assert.notEqual(completed.pid, process.pid);
      assert.equal(pids.has(completed.pid), false);
      pids.add(completed.pid);
      console.log(`Support Mongo identity phase passed: ${name} (separate process)`);
    }
    assert.equal(pids.size, 5);
    assert.equal(expected.length, 4);
    console.log('Support contact identity Mongo process-restart tests passed');
  } finally {
    // Only this invocation's validated, randomly named disposable databases.
    try {
      for (const name of names) await client.db(name).dropDatabase();
    } finally {
      await client.close();
    }
  }
}

const phaseIndex = process.argv.indexOf('--phase');
void (phaseIndex < 0 ? main() : phase(process.argv[phaseIndex + 1], process.argv[phaseIndex + 2],
  JSON.parse(process.argv[phaseIndex + 3])))
  .catch(error => { console.error(error); process.exitCode = 1; });
