import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './tournament-chat.fixture';

/** Actual service serialization only; synthetic memory store, no DB/key/network. */
export async function emitTournamentReadWire() {
  const f = fixture();
  const sent = await f.service.send(f.a, f.input('Synthetic wire fixture'));
  assert.equal(sent.status, 'CONFIRMED');
  const tournamentId = f.input().tournamentId;
  const before = f.store.writes;
  const position = await f.service.position(f.a, tournamentId);
  assert.equal(f.store.writes, before);
  const command = {
    contractVersion: 1 as const, tournamentId, requestId: randomUUID(),
    streamId: position.streamId, witnessHash: position.witnessHash, throughSequence: 1,
  };
  const confirmed = await f.service.advanceRead(f.a, command);
  assert.equal(confirmed.status, 'CONFIRMED');
  const after = f.store.writes;
  const status = await f.service.readStatus(f.a, command);
  assert.equal(f.store.writes, after);
  assert.deepEqual(status, confirmed);
  const { tenantId, tenantKey, userId, sessionId, correlationId, ownerTenantKey, providerClientId } = f.a;
  return {
    source: 'CUP TournamentChatService synthetic MemoryStore; no live identities',
    actor: { tenantId, tenantKey, userId, sessionId, correlationId },
    identity: { ownerTenantKey, providerClientId },
    command,
    wire: { position: JSON.stringify(position), confirmed: JSON.stringify(confirmed), status: JSON.stringify(status) },
  };
}
