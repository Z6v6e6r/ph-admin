import * as assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { TournamentsPublicController } from '../src/tournaments/tournaments-public.controller';
import {
  TournamentJoinFlowCode,
  TournamentJoinFlowResponse,
  TournamentPublicClientProfile
} from '../src/tournaments/tournaments.types';

function createClient(authorized: boolean): TournamentPublicClientProfile {
  return {
    id: authorized ? 'user-1' : 'guest-1',
    authorized,
    authSource: authorized ? 'headers' : 'cookie',
    name: authorized ? 'User One' : undefined,
    phone: authorized ? '79990001122' : undefined,
    levelLabel: authorized ? 'C' : undefined,
    onboardingCompleted: authorized,
    subscriptions: []
  };
}

function createFlow(code: TournamentJoinFlowCode): TournamentJoinFlowResponse {
  return {
    ok: code !== 'AUTH_REQUIRED',
    code,
    message: code === 'AUTH_REQUIRED' ? 'Auth required' : 'Ready',
    tournament: {
      id: 't-1',
      slug: 'weekend-cup',
      publicUrl: '/api/tournaments/public/weekend-cup',
      joinUrl: '/api/tournaments/public/weekend-cup/join',
      name: 'Weekend Cup',
      tournamentType: 'Americano',
      gender: 'MIXED',
      accessLevels: ['D+', 'C'],
      participantsCount: 0,
      paidParticipantsCount: 0,
      waitlistCount: 0,
      maxPlayers: 16,
      registrationOpen: true,
      allowedManagerPhonesCount: 0,
      skin: {},
      booking: {
        enabled: false,
        required: false,
        acceptedSubscriptions: [],
        purchaseOptions: []
      }
    },
    client: createClient(code !== 'AUTH_REQUIRED'),
    access: {
      ok: true,
      code: 'OK',
      message: 'OK',
      accessLevels: ['D+', 'C'],
      levelLabel: 'C',
      tournamentSlug: 'weekend-cup'
    },
    missingFields: [],
    waitlistAllowed: false,
    payment: {
      required: false,
      code: 'NOT_REQUIRED',
      message: 'No payment required',
      availableSubscriptions: [],
      purchaseOptions: []
    }
  };
}

function createRequest(): Request {
  return {
    headers: {
      host: 'padlhub.ru',
      'x-forwarded-proto': 'https'
    },
    secure: false
  } as unknown as Request;
}

function createResponseCapture(): {
  response: Response;
  getJson: () => unknown;
  getRedirect: () => string | null;
} {
  let jsonPayload: unknown = null;
  let redirectUrl: string | null = null;

  const response = {
    json(payload: unknown) {
      jsonPayload = payload;
      return this;
    },
    redirect(url: string) {
      redirectUrl = url;
      return this;
    },
    setHeader() {
      return this;
    },
    send() {
      return this;
    }
  } as unknown as Response;

  return {
    response,
    getJson: () => jsonPayload,
    getRedirect: () => redirectUrl
  };
}

async function main(): Promise<void> {
  let currentFlowCode: TournamentJoinFlowCode = 'AUTH_REQUIRED';

  const controller = new TournamentsPublicController(
    {
      getPublicJoinFlow: async () => createFlow(currentFlowCode)
    } as never,
    {
      ensureAuthorizedClient: (_request: Request, _response: Response) =>
        createClient(currentFlowCode !== 'AUTH_REQUIRED'),
      requiresRealAuth: () => true
    } as never
  );

  const expectedJoinUrl = 'https://padlhub.ru/api/tournaments/public/weekend-cup/join';

  {
    const capture = createResponseCapture();
    await controller.renderJoinPage(
      'weekend-cup',
      createRequest(),
      capture.response,
      undefined,
      'json',
      undefined
    );

    const payload = capture.getJson() as TournamentJoinFlowResponse;
    assert.ok(payload, 'JSON payload should be returned');
    assert.equal(payload.code, 'AUTH_REQUIRED');
    assert.equal(payload.authCheckUrl, `${expectedJoinUrl}?format=json`);
    assert.equal(payload.authRequired, true);
    assert.equal(payload.authPollMs, 1500);
    assert.equal(payload.cabinetUrl, 'https://padlhub.ru/lk_new');

    const authUrl = new URL(String(payload.authUrl || ''));
    assert.equal(authUrl.origin + authUrl.pathname, 'https://padlhub.ru/lk_new');
    assert.equal(authUrl.searchParams.get('source'), 'tournament_join');
    assert.equal(authUrl.searchParams.get('returnUrl'), expectedJoinUrl);
  }

  {
    const capture = createResponseCapture();
    await controller.renderJoinPage(
      'weekend-cup',
      createRequest(),
      capture.response,
      undefined,
      undefined,
      '1'
    );
    assert.ok(capture.getRedirect(), 'Redirect URL should be returned for autoAuth');
    const redirectUrl = new URL(String(capture.getRedirect()));
    assert.equal(redirectUrl.origin + redirectUrl.pathname, 'https://padlhub.ru/lk_new');
    assert.equal(redirectUrl.searchParams.get('source'), 'tournament_join');
    assert.equal(redirectUrl.searchParams.get('returnUrl'), expectedJoinUrl);
  }

  {
    currentFlowCode = 'READY_TO_JOIN';
    const capture = createResponseCapture();
    await controller.renderJoinPage(
      'weekend-cup',
      createRequest(),
      capture.response,
      undefined,
      'json',
      undefined
    );

    const payload = capture.getJson() as TournamentJoinFlowResponse;
    assert.equal(payload.code, 'READY_TO_JOIN');
    assert.equal(payload.authRequired, false);
    assert.equal(payload.authUrl, undefined);
    assert.equal(payload.authCheckUrl, `${expectedJoinUrl}?format=json`);
  }

  console.log('Tournament public auth redirect test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
