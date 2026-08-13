import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { GamesService } from '../src/games/games.service';
import { LkPadelHubClientService } from '../src/integrations/lk-padelhub/lk-padelhub-client.service';

type MutableGame = Record<string, unknown>;

const admin: RequestUser = {
  id: 'staff-1',
  roles: [Role.GAME_MANAGER],
  stationIds: [],
  connectorRoutes: []
};

function createGame(overrides: Partial<MutableGame> = {}): MutableGame {
  return {
    _id: 'mongo-game-1',
    id: 'game-1',
    organizer: { clientId: 'organizer-1', id: 'organizer-1', name: 'Организатор' },
    participants: [
      {
        clientId: 'client-1',
        name: 'Игрок',
        phoneNorm: '79990000001',
        status: 'CONFIRMED',
        membershipId: 'membership-1',
        bookingId: 'booking-1',
        paymentRef: 'payment-1'
      }
    ],
    metadata: {
      splitPayment: {
        payments: [
          {
            clientId: 'client-1',
            status: 'PAID',
            membershipId: 'membership-1',
            bookingIds: ['booking-1'],
            paymentRef: 'payment-1'
          }
        ]
      },
      joinResponses: {
        '79990000001': { membershipId: 'membership-1', paymentRef: 'payment-1', status: 'CONFIRMED' }
      }
    },
    ...overrides
  };
}

function createService(game: MutableGame): {
  service: GamesService;
  getUpdateCalls: () => number;
} {
  const client = new LkPadelHubClientService();
  const service = new GamesService(client);
  let updateCalls = 0;
  const collection = {
    async findOne() {
      return structuredClone(game);
    },
    async updateOne() {
      updateCalls += 1;
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }
  };
  (service as unknown as { getMongoCollection: () => Promise<typeof collection> }).getMongoCollection =
    async () => collection;
  return { service, getUpdateCalls: () => updateCalls };
}

function configureEnvironment() {
  process.env.LK_PADELHUB_STAFF_API_BASE_URL = 'https://lk.internal.example';
  process.env.LK_PADELHUB_STAFF_INTEGRATION_TOKEN = 'test-secret';
  process.env.LK_PADELHUB_STAFF_REQUEST_TIMEOUT_MS = '8000';
}

async function withFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>
) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function testPostForwardingAndPendingNoMongoMutation() {
  configureEnvironment();
  const { service, getUpdateCalls } = createService(createGame());
  let receivedBody: Record<string, unknown> | undefined;
  let authorization = '';
  let idempotencyKey = '';
  await withFetch(async (input, init) => {
    assert.equal(String(input), 'https://lk.internal.example/lk/internal/staff/games/game-1/player-leaves');
    assert.equal(init?.method, 'POST');
    const requestHeaders = new Headers(init?.headers);
    authorization = requestHeaders.get('authorization') ?? '';
    idempotencyKey = requestHeaders.get('idempotency-key') ?? '';
    receivedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        operationId: 'leave-1',
        gameId: 'game-1',
        playerId: 'client-1',
        status: 'IN_PROGRESS',
        visitAction: 'RETURN_VISIT',
        retryAfterMs: 500
      }),
      { status: 202, headers: { 'content-type': 'application/json' } }
    );
  }, async () => {
    const result = await service.requestPlayerRemoval(
      'game-1',
      'client-1',
      { refundPolicy: 'RETURN_VISIT', idempotencyKey: 'idem-1' },
      admin
    );
    assert.deepEqual(result, {
      operationId: 'leave-1',
      gameId: 'game-1',
      playerId: 'client-1',
      refundPolicy: 'RETURN_VISIT',
      status: 'PENDING',
      retryAfterMs: 500
    });
  });
  assert.ok(receivedBody);
  assert.equal(authorization, 'Bearer test-secret');
  assert.equal(idempotencyKey, 'idem-1');
  assert.equal(receivedBody.idempotencyKey, undefined);
  assert.deepEqual(receivedBody.target, {
    bookingId: 'booking-1',
    clientId: 'client-1'
  });
  assert.equal(receivedBody.visitAction, 'RETURN_VISIT');
  assert.equal(receivedBody.reason, 'CUP_STAFF_REMOVAL');
  assert.equal(getUpdateCalls(), 0, 'pending request must not mutate the CUP game document');
}

async function testNoReturnForwarding() {
  configureEnvironment();
  const { service } = createService(createGame());
  let receivedBody: Record<string, unknown> | undefined;
  await withFetch(async (_input, init) => {
    receivedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ operationId: 'leave-2', gameId: 'game-1', playerId: 'client-1', status: 'DONE', visitAction: 'NO_RETURN' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }, async () => {
    const result = await service.requestPlayerRemoval(
      'game-1',
      'client-1',
      { refundPolicy: 'NO_RETURN', idempotencyKey: 'idem-2' },
      admin
    );
    assert.equal(result.status, 'DONE');
    assert.equal(result.refundPolicy, 'NO_RETURN');
  });
  assert.ok(receivedBody);
  assert.equal(receivedBody.visitAction, 'NO_RETURN');
}

async function testPostRejectsMissingOwnerPlayerId() {
  configureEnvironment();
  const { service } = createService(createGame());
  await withFetch(async () => new Response(
    JSON.stringify({ operationId: 'leave-without-player', gameId: 'game-1', status: 'IN_PROGRESS', visitAction: 'RETURN_VISIT' }),
    { status: 202, headers: { 'content-type': 'application/json' } }
  ), async () => {
    await assert.rejects(
      () => service.requestPlayerRemoval(
        'game-1',
        'client-1',
        { refundPolicy: 'RETURN_VISIT', idempotencyKey: 'missing-owner-player-id' },
        admin
      ),
      /invalid operation/
    );
  });
}

async function testMissingOrOrganizerTargetRejectedBeforeUpstreamCall() {
  configureEnvironment();
  const { service } = createService(createGame());
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await assert.rejects(
      () => service.requestPlayerRemoval('game-1', 'missing', { refundPolicy: 'RETURN_VISIT', idempotencyKey: 'x' }, admin),
      /current game participant/
    );
    await assert.rejects(
      () => service.requestPlayerRemoval('game-1', 'organizer-1', { refundPolicy: 'RETURN_VISIT', idempotencyKey: 'x' }, admin),
      /current game participant|organizer/
    );
  });
  assert.equal(calls, 0);
}

async function testMissingExactBookingFailsClosed() {
  configureEnvironment();
  const { service } = createService(
    createGame({
      metadata: { splitPayment: { payments: [{ clientId: 'client-1', status: 'PAID', membershipId: 'membership-1' }] } }
    })
  );
  await assert.rejects(
    () => service.requestPlayerRemoval('game-1', 'client-1', { refundPolicy: 'RETURN_VISIT', idempotencyKey: 'x' }, admin),
    ConflictException
  );
}

async function testStatusForwardingAndUpstreamFailure() {
  configureEnvironment();
  const { service } = createService(createGame());
  await withFetch(async (_input, init) => {
    assert.equal(init?.method, 'GET');
    return new Response(
      JSON.stringify({ operationId: 'leave-3', gameId: 'game-1', playerId: 'client-1', status: 'FINALIZING', visitAction: 'RETURN_VISIT' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }, async () => {
    const result = await service.getPlayerRemovalRequest('game-1', 'client-1', 'leave-3', admin);
    assert.equal(result.status, 'PENDING');
    assert.equal(result.playerId, 'client-1');
  });
  await withFetch(async () => new Response('busy', { status: 503 }), async () => {
    await assert.rejects(
      () => service.getPlayerRemovalRequest('game-1', 'client-1', 'leave-3', admin),
      ServiceUnavailableException
    );
  });
  await withFetch(async () => new Response(
    JSON.stringify({ operationId: 'leave-4', gameId: 'game-1', playerId: 'client-1', status: 'RETRY_REQUIRED', visitAction: 'RETURN_VISIT' }),
    { status: 202, headers: { 'content-type': 'application/json' } }
  ), async () => {
    const result = await service.getPlayerRemovalRequest('game-1', 'client-1', 'leave-4', admin);
    assert.equal(result.status, 'PENDING');
  });
  await withFetch(async () => new Response(
    JSON.stringify({ operationId: 'leave-5', gameId: 'game-1', playerId: 'another-client', status: 'DONE', visitAction: 'RETURN_VISIT' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ), async () => {
    await assert.rejects(
      () => service.getPlayerRemovalRequest('game-1', 'client-1', 'leave-5', admin),
      /invalid operation/
    );
  });
}

async function testAdminUiDoesNotOptimisticallyRemovePlayer() {
  const source = await readFile('client-sdk/phab-admin-panel.js', 'utf8');
  assert.match(source, /Вернуть посещение/);
  assert.match(source, /Не возвращать посещение/);
  assert.match(source, /Отмена/);
  assert.match(source, /Покидает игру/);
  assert.match(source, /reloadGameAfterPlayerRemoval/);
  assert.match(source, /canRequestGamePlayerRemoval/);
  assert.match(source, /failures >= 5/);
  assert.match(source, /playerRemovalPollTimersByKey/);
  assert.match(source, /operation\.playerId/);
  assert.match(source, /removal-requests/);
  assert.doesNotMatch(source, /LK_PADELHUB_STAFF_INTEGRATION_TOKEN/);
}

async function main() {
  await testPostForwardingAndPendingNoMongoMutation();
  await testNoReturnForwarding();
  await testPostRejectsMissingOwnerPlayerId();
  await testMissingOrOrganizerTargetRejectedBeforeUpstreamCall();
  await testMissingExactBookingFailsClosed();
  await testStatusForwardingAndUpstreamFailure();
  await testAdminUiDoesNotOptimisticallyRemovePlayer();
  console.log('games player removal request test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
