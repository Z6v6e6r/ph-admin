import * as assert from 'node:assert/strict';
import { TournamentsPublicController } from '../src/tournaments/tournaments-public.controller';

async function main(): Promise<void> {
  const registered: Array<Record<string, unknown>> = [];
  const purchaseInputs: Array<Record<string, unknown>> = [];
  const flowClients: Array<Record<string, unknown>> = [];
  let purchaseFlow = false;
  const service = {
    resolveTrustedLkRegistrationClient: async (authorization?: string) => {
      assert.equal(authorization, 'Bearer trusted-token');
      return {
        clientId: 'viva-client-trusted',
        name: 'Trusted Player',
        phone: '79000000001',
        levelLabel: 'C'
      };
    },
    resolveCanonicalLkRegistrationClientByVerifiedPhone: async () => ({
      clientId: 'viva-client-otp',
      name: 'OTP Player',
      phone: '79000000002',
      levelLabel: 'D+'
    }),
    registerPublicParticipant: async (_slug: string, input: Record<string, unknown>) => {
      registered.push(input);
      return { ok: true, code: 'REGISTERED', message: 'registered' };
    },
    createPublicJoinPurchaseTransaction: async (
      _slug: string,
      input: Record<string, unknown>
    ) => {
      purchaseInputs.push(input);
      return { ok: false, code: 'BOOKING_FAILED', message: 'test stop' };
    },
    getPublicJoinFlow: async (_slug: string, client: Record<string, unknown>) => {
      flowClients.push(client);
      return {
        ok: true,
        code: purchaseFlow ? 'SUBSCRIPTION_AVAILABLE' : 'READY_TO_JOIN',
        message: 'ready',
        tournament: { joinUrl: '/tournaments/public/cup/join' },
        client,
        access: { ok: true, code: 'ALLOWED', message: 'allowed' },
        missingFields: [],
        waitlistAllowed: false,
        payment: purchaseFlow
          ? {
              required: true,
              code: 'SUBSCRIPTION_AVAILABLE',
              purchaseOptions: [],
              availableSubscriptions: [
                { id: 'subscription-first', label: 'First' },
                { id: 'subscription-second', label: 'Second' }
              ],
              selectedSubscription: { id: 'subscription-first', label: 'First' }
            }
          : { required: false, code: 'NOT_REQUIRED', purchaseOptions: [] }
      };
    }
  };
  let sessionClient: Record<string, unknown> = {
    id: 'otp-session',
    authorized: true,
    authSource: 'cookie',
    name: 'Submitted Name',
    phone: '79000000002',
    phoneVerified: true,
    levelLabel: 'A',
    onboardingCompleted: true,
    subscriptions: [{ id: 'forged-subscription' }]
  };
  const sessionService = {
    ensureAuthorizedClient: () => sessionClient,
    rememberClient: () => sessionClient,
    requiresRealAuth: () => true,
    resolveExternalAuthorizationHeader: () => 'Bearer trusted-token'
  };
  const controller = new TournamentsPublicController(service as never, sessionService as never);

  await controller.registerParticipant(
    'cup',
    { headers: { authorization: 'Bearer trusted-token' } } as never,
    {
      name: 'Forged Player',
      phone: '+7 999 999-99-99',
      levelLabel: 'A',
      selectedSubscriptionId: 'forged-subscription',
      selectedPurchaseOptionId: 'single-entry',
      purchaseConfirmed: true,
      subscriptions: [{ id: 'forged-subscription', label: 'Forged' }]
    }
  );
  assert.deepEqual(registered[0], {
    clientId: 'viva-client-trusted',
    name: 'Trusted Player',
    phone: '79000000001',
    levelLabel: 'C',
    notes: undefined,
    selectedPurchaseOptionId: 'single-entry',
    vivaAuthorizationHeader: 'Bearer trusted-token'
  });

  const jsonPayloads: unknown[] = [];
  const response = {
    json: (payload: unknown) => jsonPayloads.push(payload),
    setHeader: () => undefined
  };
  await controller.renderJoinPage(
    'cup',
    { headers: { accept: 'application/json' } } as never,
    response as never,
    undefined,
    'json'
  );
  assert.equal(flowClients[0]?.phone, '79000000002');
  assert.equal(flowClients[0]?.clientId, 'viva-client-otp');
  assert.equal(flowClients[0]?.levelLabel, 'D+');
  assert.equal(flowClients[0]?.onboardingCompleted, true);

  sessionClient = {
    id: 'forged-header-user',
    authorized: true,
    authSource: 'headers',
    name: 'Forged Header',
    phone: '79999999999',
    phoneVerified: true,
    levelLabel: 'A',
    onboardingCompleted: true,
    subscriptions: [{ id: 'forged-subscription' }]
  };
  await controller.renderJoinPage(
    'cup',
    { headers: { accept: 'application/json' } } as never,
    response as never,
    undefined,
    'json'
  );
  assert.equal(flowClients[1]?.authorized, false);
  assert.equal(flowClients[1]?.phoneVerified, false);
  assert.equal(flowClients[1]?.levelLabel, undefined);
  assert.deepEqual(flowClients[1]?.subscriptions, []);

  purchaseFlow = true;
  sessionClient = {
    id: 'untrusted-session-id',
    authorized: true,
    authSource: 'headers',
    name: 'Header Player',
    phone: '79000000001',
    phoneVerified: true,
    levelLabel: 'C',
    onboardingCompleted: true,
    subscriptions: [
      { id: 'subscription-first', label: 'First' },
      { id: 'subscription-second', label: 'Second' }
    ]
  };
  await controller.submitJoinPage(
    'cup',
    {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer trusted-token'
      },
      protocol: 'https',
      get: () => 'padlhub.ru',
      originalUrl: '/tournaments/public/cup/join'
    } as never,
    response as never,
    undefined,
    {
      purchaseConfirmed: true,
      selectedSubscriptionId: 'subscription-second',
      format: 'json'
    }
  );
  assert.equal(purchaseInputs.length, 1);
  assert.equal(purchaseInputs[0]?.clientId, 'viva-client-trusted');
  assert.equal(purchaseInputs[0]?.selectedSubscriptionId, 'subscription-second');

  console.log('Tournament public registration identity test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
