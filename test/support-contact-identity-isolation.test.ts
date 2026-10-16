import * as assert from 'node:assert/strict';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { SupportClientLookupQuery, SupportPersistedState, SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportConnectorRoute, SupportMessageKind } from '../src/support/support.types';

class Persistence {
  state: SupportPersistedState = { clients: [], dialogs: [], messages: [], responseMetrics: [], outbox: [] };
  lookupUnavailable = false;
  isEnabled() { return true; }
  async loadState() { return structuredClone(this.state); }
  async findClients(query: SupportClientLookupQuery) {
    if (this.lookupUnavailable) throw new Error('Unavailable');
    return structuredClone(this.state.clients.filter(client =>
      (query.phone && client.phones.includes(query.phone)) ||
      (query.email && client.emails.includes(query.email)) ||
      client.identities.some(identity => identity.connector === query.connector &&
        ((query.externalUserId && identity.externalUserId === query.externalUserId) ||
         (query.externalChatId && identity.externalChatId === query.externalChatId)))
    ));
  }
  async findDialogsByClientId(clientId: string) {
    return structuredClone(this.state.dialogs.filter(dialog => dialog.clientId === clientId));
  }
  async findDialogIdsByPhone() { return []; }
  async findServiceMessages() { return []; }
  persistClient(row: SupportPersistedState['clients'][number]) { this.upsert('clients', row); }
  persistDialog(row: SupportPersistedState['dialogs'][number]) {
    assert.ok(row.connectors.length > 0,
      'A new dialog must have its connector before the first persistence write');
    this.upsert('dialogs', row);
  }
  persistMessage(row: SupportPersistedState['messages'][number]) { this.upsert('messages', row); }
  persistServiceMessage() {}
  persistResponseMetric(row: SupportPersistedState['responseMetrics'][number]) { this.upsert('responseMetrics', row); }
  persistOutboxCommand(row: SupportPersistedState['outbox'][number]) { this.upsert('outbox', row); }
  deleteClient(id: string) { this.state.clients = this.state.clients.filter(row => row.id !== id); }
  deleteDialog(id: string) { this.state.dialogs = this.state.dialogs.filter(row => row.id !== id); }
  private upsert<K extends keyof SupportPersistedState>(key: K, row: SupportPersistedState[K][number]) {
    const list = this.state[key] as Array<{ id: string }>;
    const index = list.findIndex(item => item.id === row.id);
    const copy = structuredClone(row);
    if (index < 0) list.push(copy); else list[index] = copy;
  }
}

function service(persistence: Persistence) {
  const registry = {
    resolveRoute(raw: unknown) {
      return Object.values(SupportConnectorRoute).find(route => route === String(raw).toUpperCase());
    },
    normalizeIncomingEvent() { return {}; },
    listEntries() { return []; }
  } as unknown as SupportConnectorRegistry;
  const replies = { registerUsage() {}, listRules() { return []; }, findMatchingRules() { return []; } };
  return new SupportService(persistence as unknown as SupportPersistenceService, registry, replies as never);
}

async function main() {
  const persistence = new Persistence();
  const current = service(persistence);
  const aPhone = '70000000001';
  const bPhone = '70000000002';
  const otherPhone = '70000000003';
  try {
    const a = await current.ingestEvent({ connector: SupportConnectorRoute.LK_WEB_MESSENGER,
      externalUserId: 'owner-a', externalChatId: 'lk:owner-a', phone: aPhone,
      displayName: 'Owner A', text: 'A private message', kind: SupportMessageKind.TEXT });
    const b = await current.ingestEvent({ connector: SupportConnectorRoute.LK_WEB_MESSENGER,
      externalUserId: 'owner-b', externalChatId: 'lk:owner-b', phone: bPhone,
      displayName: 'Owner B', text: 'B private message', kind: SupportMessageKind.TEXT });
    await current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: aPhone,
      displayName: 'Owner A', kind: SupportMessageKind.CONTACT });
    await current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-b', externalChatId: 'max-chat-b', phone: bPhone,
      displayName: 'Owner B', kind: SupportMessageKind.CONTACT });

    for (const phone of [bPhone, otherPhone]) {
      const forwarded = await current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
        externalUserId: 'max-a', externalChatId: 'max-chat-a', phone,
        email: 'contact@example.invalid', username: 'contact-username',
        displayName: 'Shared contact', kind: SupportMessageKind.CONTACT });
      assert.equal(forwarded.client.id, a.client.id);
      assert.equal(forwarded.client.displayName, 'Owner A');
      assert.deepEqual(forwarded.client.phones, [aPhone]);
      assert.deepEqual(forwarded.client.emails, []);
      assert.equal(forwarded.message?.phone, aPhone);
      assert.equal(forwarded.message?.email, undefined);
      assert.equal((forwarded.message?.meta?.sharedContact as { email: string }).email, 'contact@example.invalid');
      assert.equal((forwarded.message?.meta?.sharedContact as { phone: string }).phone, phone);
      assert.equal(forwarded.message?.text, `Клиент поделился номером: ${phone}`);
    }
    assert.equal(persistence.state.clients.length, 2);

    const seeded = structuredClone(persistence.state);
    for (const cachedId of [a.client.id, b.client.id]) {
      const partialPersistence = new Persistence();
      partialPersistence.state = structuredClone(seeded);
      const partial = service(partialPersistence);
      try {
        await (partial as unknown as { cacheClientFromPersistence(client: typeof a.client): Promise<unknown> })
          .cacheClientFromPersistence(seeded.clients.find(client => client.id === cachedId)!);
        const forwarded = await partial.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
          kind: SupportMessageKind.CONTACT });
        assert.equal(forwarded.client.id, a.client.id);
        assert.deepEqual(forwarded.client.phones, [aPhone]);
        const beforeFailure = structuredClone(partialPersistence.state);
        await assert.rejects(partial.ingestEvent({ connector: SupportConnectorRoute.LK_WEB_MESSENGER,
          externalUserId: 'owner-a', externalChatId: 'lk:owner-a', phone: bPhone,
          text: 'Conflicting phone', kind: SupportMessageKind.TEXT }),
          (error: any) => error.getStatus() === 400);
        assert.deepEqual(partialPersistence.state, beforeFailure);
        partialPersistence.lookupUnavailable = true;
        await assert.rejects(partial.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: otherPhone,
          kind: SupportMessageKind.CONTACT }), (error: any) => error.getStatus() === 503);
        assert.deepEqual(partialPersistence.state, beforeFailure);
      } finally { partial.onModuleDestroy(); }
    }

    const beforePairFailures = structuredClone(persistence.state);
    await assert.rejects(current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-chat-a', externalChatId: 'unknown-chat', phone: bPhone,
      kind: SupportMessageKind.CONTACT }), (error: any) => error.getStatus() === 400);
    assert.deepEqual(persistence.state, beforePairFailures);
    const aProfile = persistence.state.clients.find(client => client.id === a.client.id)!;
    aProfile.identities.push({ ...aProfile.identities.find(identity => identity.externalUserId === 'max-a')!,
      externalUserId: 'max-a-secondary', externalChatId: 'max-chat-a-secondary' });
    const beforeMixedPair = structuredClone(persistence.state);
    await assert.rejects(current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-a', externalChatId: 'max-chat-a-secondary', phone: aPhone,
      kind: SupportMessageKind.CONTACT }), (error: any) => error.getStatus() === 400);
    assert.deepEqual(persistence.state, beforeMixedPair);
    assert.equal((await current.resolveClient({ phone: bPhone })).client?.id, b.client.id);
    assert.equal((await current.resolveClient({ phone: otherPhone })).client, null);

    await assert.rejects(current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-a', externalChatId: 'max-chat-b', phone: bPhone,
      kind: SupportMessageKind.CONTACT }),
      (error: unknown) => error instanceof Error && error.message === 'Support user and chat identities belong to different clients');
    await assert.rejects(current.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
      externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
      text: 'Wrong sender phone', kind: SupportMessageKind.TEXT }),
      (error: unknown) => error instanceof Error && error.message === 'Support identity conflicts with the verified client phone');

    await assert.rejects(current.ingestEvent({ connector: SupportConnectorRoute.LK_WEB_MESSENGER,
      externalUserId: 'owner-a', externalChatId: 'lk:owner-a', phone: bPhone,
      text: 'Identity conflict', kind: SupportMessageKind.TEXT }),
      (error: unknown) => error instanceof Error && error.message === 'Support identity conflicts with the verified client phone');
    const bFollowUp = await current.ingestEvent({ connector: SupportConnectorRoute.LK_WEB_MESSENGER,
      externalUserId: 'owner-b', externalChatId: 'lk:owner-b', phone: bPhone,
      text: 'Still private', kind: SupportMessageKind.TEXT });
    assert.equal(bFollowUp.client.id, b.client.id);
    assert.equal(bFollowUp.dialog.id, b.dialog.id);
    assert.equal(persistence.state.clients.length, 2);

    const restarted = service(persistence);
    try {
      await restarted.hydrateFromPersistence();
      (restarted as unknown as { reconcileState(): void }).reconcileState();
      assert.deepEqual((await restarted.resolveClient({ phone: aPhone })).client?.phones, [aPhone]);
      assert.deepEqual((await restarted.resolveClient({ phone: bPhone })).client?.phones, [bPhone]);
      assert.equal((await restarted.resolveClient({ phone: otherPhone })).client, null);
      assert.equal(persistence.state.clients.length, 2);
      assert.notEqual((await restarted.resolveClient({ phone: aPhone })).client?.id,
        (await restarted.resolveClient({ phone: bPhone })).client?.id);
    } finally { restarted.onModuleDestroy(); }
  } finally { current.onModuleDestroy(); }
  console.log('Support contact identity isolation tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
