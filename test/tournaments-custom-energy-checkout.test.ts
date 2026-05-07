import * as assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, KeyObject } from 'node:crypto';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { CustomTournament, TournamentStatus } from '../src/tournaments/tournaments.types';

function createTournament(): CustomTournament {
  return {
    id: 'custom-energy-1',
    source: 'CUSTOM',
    slug: 'energy-cup',
    publicUrl: '/api/tournaments/public/energy-cup',
    name: 'Energy Cup',
    status: TournamentStatus.REGISTRATION,
    sourceTournamentId: 'exercise-energy-1',
    tournamentType: 'Американо',
    accessLevels: ['C'],
    gender: 'MIXED',
    maxPlayers: 16,
    participants: [],
    participantsCount: 0,
    paidParticipantsCount: 0,
    waitlist: [],
    waitlistCount: 0,
    allowedManagerPhones: [],
    studioId: 'studio-1',
    studioName: 'ТестMiniApp',
    startsAt: '2026-05-09T07:00:00+03:00',
    endsAt: '2026-05-09T08:00:00+03:00',
    mechanics: {
      enabled: true,
      config: {
        mode: 'short_americano',
        rounds: null,
        courts: null,
        useRatings: true,
        firstRoundSeeding: 'auto',
        roundExactThreshold: 12,
        balanceOutlierThreshold: 1.1,
        balanceOutlierWeight: 120,
        strictPartnerUniqueness: 'high',
        strictBalance: 'medium',
        avoidRepeatOpponents: true,
        avoidRepeatPartners: true,
        distributeByesEvenly: true,
        historyDepth: 0,
        localSearchIterations: 6,
        pairingExactThreshold: 16,
        matchExactThreshold: 12,
        weights: {
          partnerRepeat: 1000,
          partnerImmediateRepeat: 1200,
          opponentRepeat: 150,
          opponentRecentRepeat: 250,
          balance: 100,
          unevenBye: 300,
          consecutiveBye: 700,
          pairInternalImbalance: 30
        }
      }
    },
    changeLog: [],
    skin: {
      title: 'Название турнира',
      priceLabel: '2 500 ₽'
    },
    details: {
      booking: {
        paymentRequired: true,
        vivaWidgetId: 'iSkq6G',
        vivaExerciseId: 'exercise-energy-1',
        vivaStudioId: 'studio-1'
      }
    }
  };
}

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function buildSignedJwt(payload: Record<string, unknown>, privateKey: KeyObject, kid: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

function createPayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'lk-tournament-signup',
    authProvider: 'lk-keycloak',
    tenantKey: 'iSkq6G',
    exerciseId: 'exercise-energy-1',
    studioId: 'studio-1',
    paymentMethod: 'SMS',
    client: {
      id: 'client-1',
      phone: '79123456789',
      firstName: 'Имя'
    },
    product: {
      name: 'Энергия турниры',
      type: 'SUBSCRIPTION',
      kind: 'TOURNAMENT_CUSTOM_ENERGY'
    },
    pricing: {
      currency: 'RUB',
      priceLabel: '2 500 ₽',
      amount: 2500,
      amountMinor: 250000,
      baseAmount: 20000,
      baseAmountMinor: 2000000,
      discountAmount: 17500,
      discountAmountMinor: 1750000,
      discountReason: 'Участие в турнире «Название турнира» 09.05.2026'
    },
    tournament: {
      id: 'custom-energy-1',
      exerciseId: 'exercise-energy-1',
      linkedCustomTournamentId: 'custom-energy-1',
      title: 'Название турнира',
      startsAt: '2026-05-09T07:00:00+03:00',
      dateLabel: '09.05.2026',
      studioId: 'studio-1'
    },
    returnUrls: {
      successUrl: 'https://padlhub.ru/tournaments?paymentsuccess=true',
      failUrl: 'https://padlhub.ru/tournaments?paymentfailed=true'
    },
    ...overrides
  };
}

function createService(tournament: CustomTournament, vivaAdmin: Record<string, unknown>): TournamentsService {
  return new TournamentsService(
    { listTournaments: async () => [] } as never,
    { listTournaments: async () => [], findTournamentById: async () => null } as never,
    { getTournamentResults: async () => { throw new Error('Not used in test'); } } as never,
    {
      isEnabled: () => true,
      listCustomTournaments: async () => [tournament],
      findCustomTournamentById: async (id: string) => id === tournament.id ? tournament : null,
      findCustomTournamentBySlug: async (slug: string) => slug === tournament.slug ? tournament : null,
      findCustomTournamentBySourceTournamentId: async (sourceTournamentId: string) =>
        sourceTournamentId === tournament.sourceTournamentId ? tournament : null
    } as never,
    { generateSchedule: () => { throw new Error('Not used in test'); } } as never,
    { simulateRating: () => { throw new Error('Not used in test'); } } as never,
    vivaAdmin as never
  );
}

async function main(): Promise<void> {
  process.env.TOURNAMENTS_PUBLIC_TENANT_KEY = 'iSkq6G';
  const originalFetch = globalThis.fetch;
  const token = buildJwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    phone_number: '79123456789',
    tenantKey: 'iSkq6G',
    sub: 'client-1'
  });
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      String(url),
      'https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/userinfo'
    );
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        phone_number: '79123456789',
        tenantKey: 'iSkq6G',
        sub: 'client-1'
      })
    } as Response;
  }) as typeof fetch;

  let vivaInput: Record<string, unknown> | undefined;
  const service = createService(createTournament(), {
    createTournamentEnergyCheckout: async (input: Record<string, unknown>) => {
      vivaInput = input;
      return {
        clientId: 'client-1',
        productId: 'energy-product',
        subscriptionId: 'subscription-1',
        transactionId: 'transaction-1',
        paymentUrl: 'https://pay.example/energy',
        toPayMinor: 250000,
        paymentExpiresAt: '2026-05-09T07:20:00+03:00'
      };
    }
  });

  const response = await service.createCustomEnergyCheckout('exercise-energy-1', {
    body: createPayload(),
    authorizationHeader: `Bearer ${token}`,
    authSourceHeader: 'lk-keycloak',
    tenantKeyHeader: 'iSkq6G'
  });

  assert.equal(response.ok, true);
  assert.equal(response.paymentUrl, 'https://pay.example/energy');
  assert.equal(response.toPayMinor, 250000);
  assert.equal(vivaInput?.clientPhone, '79123456789');
  assert.equal(vivaInput?.clientId, 'client-1');
  assert.equal(vivaInput?.studioId, 'studio-1');
  assert.equal(vivaInput?.baseAmountMinor, 2000000);
  assert.equal(vivaInput?.discountAmountMinor, 1750000);
  assert.equal(vivaInput?.discountReason, 'Участие в турнире «Название турнира» 09.05.2026');
  assert.equal(vivaInput?.successUrl, 'https://padlhub.ru/tournaments?paymentsuccess=true');

  await assert.rejects(
    () => service.createCustomEnergyCheckout('exercise-energy-1', {
      body: createPayload({
        pricing: {
          ...(createPayload().pricing as Record<string, unknown>),
          amountMinor: 1000,
          discountAmountMinor: 1999000
        }
      }),
      authorizationHeader: `Bearer ${token}`,
      authSourceHeader: 'lk-keycloak',
      tenantKeyHeader: 'iSkq6G'
    }),
    /pricing\.amountMinor does not match tournament custom price/
  );

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & {
    kid?: string;
    alg?: string;
    use?: string;
  };
  publicJwk.kid = 'lk-test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const signedToken = buildSignedJwt(
    {
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://kc.vivacrm.ru/realms/prod',
      phone_number: '79123456789',
      tenantKey: 'iSkq6G',
      sub: 'client-1'
    },
    privateKey,
    'lk-test-key'
  );
  let jwksRequested = false;
  let userInfoRejected = false;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.endsWith('/protocol/openid-connect/certs')) {
      jwksRequested = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ keys: [publicJwk] })
      } as Response;
    }
    if (value.endsWith('/protocol/openid-connect/userinfo')) {
      userInfoRejected = true;
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_token' })
      } as Response;
    }
    throw new Error(`Unexpected fetch in signed token test: ${value}`);
  }) as typeof fetch;

  const signedTokenService = createService(createTournament(), {
    createTournamentEnergyCheckout: async () => ({
      clientId: 'client-1',
      productId: 'energy-product',
      transactionId: 'transaction-signed',
      paymentUrl: 'https://pay.example/signed-energy',
      toPayMinor: 250000
    })
  });
  const signedTokenResponse = await signedTokenService.createCustomEnergyCheckout(
    'exercise-energy-1',
    {
      body: createPayload(),
      authorizationHeader: `Bearer ${signedToken}`,
      authSourceHeader: 'lk-keycloak',
      tenantKeyHeader: 'iSkq6G'
    }
  );
  assert.equal(signedTokenResponse.transactionId, 'transaction-signed');
  assert.equal(jwksRequested, true);
  assert.equal(userInfoRejected, true);

  globalThis.fetch = originalFetch;
  console.log('Tournament custom energy checkout test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
