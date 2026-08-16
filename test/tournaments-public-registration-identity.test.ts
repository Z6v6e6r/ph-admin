import * as assert from 'node:assert/strict';
import { TournamentsPublicController } from '../src/tournaments/tournaments-public.controller';

async function main(): Promise<void> {
  const registered: Array<Record<string, unknown>> = [];
  const flowClients: Array<Record<string, unknown>> = [];
  const service = {
    resolveTrustedLkRegistrationClient: async (authorization?: string) => {
      assert.equal(authorization, 'Bearer trusted-token');
      return { name: 'Trusted Player', phone: '79000000001', levelLabel: 'C' };
    },
    resolveCanonicalLkRegistrationClientByVerifiedPhone: async () => ({
      name: 'OTP Player',
      phone: '79000000002',
      levelLabel: 'D+'
    }),
    registerPublicParticipant: async (_slug: string, input: Record<string, unknown>) => {
      registered.push(input);
      return { ok: true, code: 'REGISTERED', message: 'registered' };
    },
    getPublicJoinFlow: async (_slug: string, client: Record<string, unknown>) => {
      flowClients.push(client);
      return {
        ok: true,
        code: 'READY_TO_JOIN',
        message: 'ready',
        tournament: { joinUrl: '/tournaments/public/cup/join' },
        client,
        access: { ok: true, code: 'ALLOWED', message: 'allowed' },
        missingFields: [],
        waitlistAllowed: false,
        payment: { required: false, code: 'NOT_REQUIRED', purchaseOptions: [] }
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
    requiresRealAuth: () => true,
    resolveExternalAuthorizationHeader: () => undefined
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

  console.log('Tournament public registration identity test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
