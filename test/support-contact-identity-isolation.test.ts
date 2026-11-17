import * as assert from 'node:assert/strict';
import { SupportConnectorRegistry } from '../src/support/connectors/support-connector.registry';
import { SupportClientLookupQuery, SupportPersistedState, SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportService } from '../src/support/support.service';
import { SupportClientAuthStatus, SupportConnectorRoute, SupportMessageKind, SupportOutboxStatus } from '../src/support/support.types';

class Persistence {
  state: SupportPersistedState = { clients: [], dialogs: [], messages: [], responseMetrics: [], outbox: [] };
  lookupUnavailable = false;
  writes: Array<{ kind: string; id: string }> = [];
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
  deleteClient(id: string) { this.writes.push({ kind: 'deleteClient', id }); this.state.clients = this.state.clients.filter(row => row.id !== id); }
  deleteDialog(id: string) { this.state.dialogs = this.state.dialogs.filter(row => row.id !== id); }
  private upsert<K extends keyof SupportPersistedState>(key: K, row: SupportPersistedState[K][number]) {
    this.writes.push({ kind: key, id: row.id });
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
    for (const connector of [SupportConnectorRoute.LK_WEB_MESSENGER, SupportConnectorRoute.MAX_BOT]) {
      for (const hydration of [false, true]) {
        const repairedPersistence = new Persistence();
        repairedPersistence.state = structuredClone(seeded);
        const owner = repairedPersistence.state.clients.find(client => client.id === a.client.id)!;
        const old = { ...structuredClone(owner), id: 'old-detached-profile', identities: [],
          createdAt: '2000-01-01T00:00:00.000Z' };
        repairedPersistence.state.clients.unshift(old);
        const oldDialog = { ...structuredClone(seeded.dialogs.find(dialog => dialog.clientId === a.client.id)!),
          id: 'old-dialog', clientId: old.id, stationId: 'old-station' };
        repairedPersistence.state.dialogs.push(oldDialog);
        const oldMessage = { ...structuredClone(seeded.messages.find(message => message.clientId === a.client.id)!),
          id: 'old-message', clientId: old.id, dialogId: oldDialog.id, stationId: oldDialog.stationId };
        repairedPersistence.state.messages.push(oldMessage);
        const archived = { id: 'archived-command', clientId: owner.id, dialogId: oldDialog.id,
          connector: SupportConnectorRoute.MAX_BOT, status: SupportOutboxStatus.FAILED,
          terminalReason: 'OWNER_ARCHIVED_WITHOUT_SEND', attempts: 0,
          createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z'
        } as SupportPersistedState['outbox'][number];
        repairedPersistence.state.outbox.push(archived);
        const repaired = service(repairedPersistence);
        try {
          const cache = repaired as unknown as { clients: Map<string, typeof owner>;
            cacheClientFromPersistence(client: typeof owner): Promise<unknown> };
          if (hydration) {
            await repaired.hydrateFromPersistence();
            assert.deepEqual(cache.clients.get(old.id)?.identities, [],
              'Historical message must not recreate a detached identity');
          } else {
            // A partial warm cache with only the older same-phone profile used to
            // steal the persisted owner when normal TEXT went through mergeClients.
            await cache.cacheClientFromPersistence(old);
          }
          const history = structuredClone(repairedPersistence.state.messages);
          repairedPersistence.writes = [];
          const identity = owner.identities.find(item => item.connector === connector)!;
          const followup = await repaired.ingestEvent({ connector,
            externalUserId: identity.externalUserId, externalChatId: identity.externalChatId,
            phone: aPhone, text: 'Synthetic follow-up after repair', kind: SupportMessageKind.TEXT });
          assert.equal(followup.client.id, owner.id);
          assert.equal(repairedPersistence.state.clients.length, seeded.clients.length + 1);
          assert.deepEqual(repairedPersistence.state.clients.find(item => item.id === old.id), old);
          for (const message of history) {
            assert.deepEqual(repairedPersistence.state.messages.find(item => item.id === message.id), message);
            assert.ok(!repairedPersistence.writes.some(write => write.kind === 'messages' && write.id === message.id));
          }
          assert.deepEqual(repairedPersistence.state.dialogs.find(item => item.id === oldDialog.id), oldDialog);
          assert.deepEqual(repairedPersistence.state.outbox.find(item => item.id === archived.id), archived);
          assert.ok(!repairedPersistence.writes.some(write => write.kind === 'deleteClient' || write.kind === 'outbox'));
        } finally { repaired.onModuleDestroy(); }
      }
    }

    const revokedPersistence = new Persistence();
    revokedPersistence.state = structuredClone(seeded);
    const revoked = revokedPersistence.state.clients.find(client => client.id === a.client.id)!;
    revoked.authStatus = SupportClientAuthStatus.UNVERIFIED;
    revoked.primaryPhone = undefined;
    revoked.phones = [];
    revoked.emails = [];
    revoked.identities = [];
    const rehydrated = service(revokedPersistence);
    try {
      await rehydrated.hydrateFromPersistence();
      const loaded = (rehydrated as unknown as { clients: Map<string, typeof revoked> }).clients.get(revoked.id)!;
      assert.equal(loaded.authStatus, SupportClientAuthStatus.UNVERIFIED);
      assert.equal(loaded.primaryPhone, undefined);
      assert.deepEqual(loaded.phones, []);
      assert.deepEqual(loaded.emails, []);
      assert.deepEqual(loaded.identities, []);
    } finally { rehydrated.onModuleDestroy(); }

    const orphanPersistence = new Persistence();
    const orphanMessage = structuredClone(seeded.messages.find(message => message.clientId === a.client.id)!);
    orphanPersistence.state.messages = [orphanMessage, { ...orphanMessage, id: 'orphan-second-message',
      connector: SupportConnectorRoute.MAX_BOT, externalUserId: 'orphan-max', externalChatId: 'orphan-max-chat' }];
    const orphanService = service(orphanPersistence);
    try {
      await orphanService.hydrateFromPersistence();
      const orphan = (orphanService as unknown as { clients: Map<string, typeof revoked> }).clients.get(a.client.id)!;
      assert.ok(orphan.identities.some(identity => identity.externalUserId === orphanMessage.externalUserId));
      assert.ok(orphan.identities.some(identity => identity.externalUserId === 'orphan-max'),
        'Multiple orphan snapshots retain their existing reconstruction behavior');
    } finally { orphanService.onModuleDestroy(); }

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

    for (const timestampOffset of [0, 60_000]) {
      const versionedPersistence = new Persistence();
      versionedPersistence.state = structuredClone(seeded);
      const versioned = service(versionedPersistence);
      try {
        const cachedA = structuredClone(seeded.clients.find(client => client.id === a.client.id)!);
        cachedA.identities = cachedA.identities.filter(identity => identity.connector !== SupportConnectorRoute.MAX_BOT);
        cachedA.updatedAt = new Date(Date.parse(cachedA.updatedAt) + timestampOffset).toISOString();
        const cache = versioned as unknown as { cacheClientFromPersistence(client: typeof a.client): Promise<unknown> };
        await cache.cacheClientFromPersistence(cachedA);
        await cache.cacheClientFromPersistence(seeded.clients.find(client => client.id === b.client.id)!);
        const forwarded = await versioned.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
          kind: SupportMessageKind.CONTACT });
        assert.equal(forwarded.client.id, a.client.id,
          `Persisted identity must not be hidden by cache timestamp offset ${timestampOffset}`);
        assert.deepEqual(forwarded.client.phones, [aPhone]);
        const persistedB = versionedPersistence.state.clients.find(client => client.id === b.client.id)!;
        assert.deepEqual(persistedB, seeded.clients.find(client => client.id === b.client.id));
        assert.equal(versionedPersistence.state.clients.length, 2);
      } finally { versioned.onModuleDestroy(); }
    }

    for (const conflict of ['other-owner', 'different-pair']) {
      const conflictingPersistence = new Persistence();
      conflictingPersistence.state = structuredClone(seeded);
      const conflicting = service(conflictingPersistence);
      try {
        const cached = structuredClone(seeded.clients.find(client =>
          client.id === (conflict === 'other-owner' ? b.client.id : a.client.id))!);
        const senderIdentity = structuredClone(seeded.clients.find(client => client.id === a.client.id)!
          .identities.find(identity => identity.externalUserId === 'max-a')!);
        if (conflict === 'other-owner') cached.identities.push(senderIdentity);
        else cached.identities.find(identity => identity.externalUserId === 'max-a')!.externalChatId = 'wrong-chat';
        cached.updatedAt = new Date(Date.parse(cached.updatedAt) + 60_000).toISOString();
        await (conflicting as unknown as { cacheClientFromPersistence(client: typeof a.client): Promise<unknown> })
          .cacheClientFromPersistence(cached);
        const before = structuredClone(conflictingPersistence.state);
        await assert.rejects(conflicting.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
          kind: SupportMessageKind.CONTACT }), (error: any) => error.getStatus() === 400);
        assert.deepEqual(conflictingPersistence.state, before);
      } finally { conflicting.onModuleDestroy(); }
    }

    for (const divergence of ['persisted-unverified', 'persisted-other-phone', 'cached-unverified']) {
      const laggingPersistence = new Persistence();
      laggingPersistence.state = structuredClone(seeded);
      const lagging = service(laggingPersistence);
      try {
        const cachedA = structuredClone(seeded.clients.find(client => client.id === a.client.id)!);
        const persistedA = laggingPersistence.state.clients.find(client => client.id === a.client.id)!;
        const unverified = divergence === 'cached-unverified' ? cachedA : persistedA;
        if (divergence === 'persisted-other-phone') {
          persistedA.primaryPhone = otherPhone;
          persistedA.phones = [otherPhone];
        } else {
          unverified.authStatus = SupportClientAuthStatus.UNVERIFIED;
          unverified.primaryPhone = undefined;
          unverified.phones = [];
        }
        const cache = lagging as unknown as { cacheClientFromPersistence(client: typeof a.client): Promise<unknown> };
        await cache.cacheClientFromPersistence(cachedA);
        await cache.cacheClientFromPersistence(seeded.clients.find(client => client.id === b.client.id)!);
        const before = structuredClone(laggingPersistence.state);
        await assert.rejects(lagging.ingestEvent({ connector: SupportConnectorRoute.MAX_BOT,
          externalUserId: 'max-a', externalChatId: 'max-chat-a', phone: bPhone,
          kind: SupportMessageKind.CONTACT }), (error: any) => error.getStatus() === 503,
          `Ambiguous auth/phone state must fail closed: ${divergence}`);
        assert.deepEqual(laggingPersistence.state, before);
        assert.deepEqual((lagging as unknown as { clients: Map<string, typeof cachedA> }).clients.get(cachedA.id), cachedA);
      } finally { lagging.onModuleDestroy(); }
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
