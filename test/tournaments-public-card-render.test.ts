import * as assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { TournamentsPublicController } from '../src/tournaments/tournaments-public.controller';
import {
  TournamentJoinFlowResponse,
  TournamentPublicView,
  TournamentStatus
} from '../src/tournaments/tournaments.types';

function createTournament(): TournamentPublicView {
  return {
    id: 'public-card-1',
    slug: 'weekend-cup',
    publicUrl: '/api/tournaments/public/weekend-cup',
    joinUrl: '/api/tournaments/public/weekend-cup/join',
    name: 'Padel Weekend Cup',
    tournamentType: 'Американо',
    gender: 'MIXED',
    accessLevels: ['D+', 'C'],
    startsAt: '2026-04-25T09:00:00.000Z',
    endsAt: '2026-04-25T11:00:00.000Z',
    studioName: 'PadelHab Селигерская',
    trainerName: 'Игорь Махнов',
    participantsCount: 6,
    paidParticipantsCount: 3,
    waitlistCount: 1,
    maxPlayers: 16,
    participants: [
      {
        id: 'player-1',
        name: 'Игорь Махнов',
        levelLabel: 'D+',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      },
      {
        id: 'player-2',
        name: 'Елена Полкова',
        levelLabel: 'C+',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      }
    ],
    waitlist: [],
    registrationOpen: true,
    allowedManagerPhonesCount: 0,
    skin: {
      title: 'Девичник',
      subtitle: 'ТестMiniApp',
      description: 'Публичная карточка турнира',
      ctaLabel: 'Девки жгем',
      tags: ['MIXED', 'Padel']
    },
    booking: {
      enabled: true,
      required: false,
      acceptedSubscriptions: [],
      purchaseOptions: []
    },
    sourceTournamentId: 'source-1',
    sourceTournament: {
      id: 'source-1',
      source: 'VIVA',
      name: 'Падел турнир от ПадлхАБ',
      status: TournamentStatus.REGISTRATION,
      startsAt: '2026-04-25T12:00:00+03:00',
      endsAt: '2026-04-25T14:00:00+03:00',
      studioName: 'ТестMiniApp',
      trainerName: 'Тренер Сергеев',
      exerciseTypeId: '839'
    }
  };
}

function createRequest(accept?: string): Request {
  return {
    headers: {
      host: 'padlhub.ru',
      'x-forwarded-proto': 'https',
      ...(accept ? { accept } : {})
    },
    secure: false
  } as unknown as Request;
}

function createResponseCapture(): {
  response: Response;
  getHtml: () => string | null;
  getJson: () => unknown;
  getHeader: (name: string) => string | undefined;
} {
  let htmlPayload: string | null = null;
  let jsonPayload: unknown = null;
  const headers = new Map<string, string>();

  const response = {
    json(payload: unknown) {
      jsonPayload = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    send(payload: string) {
      htmlPayload = payload;
      return this;
    }
  } as unknown as Response;

  return {
    response,
    getHtml: () => htmlPayload,
    getJson: () => jsonPayload,
    getHeader: (name: string) => headers.get(name.toLowerCase())
  };
}

function createFlow(
  tournament: TournamentPublicView,
  code: TournamentJoinFlowResponse['code']
): TournamentJoinFlowResponse {
  return {
    ok: code === 'READY_TO_JOIN',
    code,
    message: code === 'PROFILE_REQUIRED'
      ? 'Чтобы присоединиться к турниру, укажите номер телефона.'
      : 'Можно записаться.',
    tournament,
    client: {
      id: 'client-1',
      authorized: code !== 'PROFILE_REQUIRED',
      authSource: 'cookie',
      phoneVerified: code !== 'PROFILE_REQUIRED',
      onboardingCompleted: true,
      subscriptions: []
    },
    access: {
      ok: true,
      code: 'OK',
      message: 'Уровень подходит.',
      accessLevels: tournament.accessLevels
    },
    missingFields: code === 'PROFILE_REQUIRED' ? ['phone'] : [],
    waitlistAllowed: false,
    payment: {
      required: false,
      code: 'NOT_REQUIRED',
      message: 'Оплата не требуется.',
      availableSubscriptions: [],
      purchaseOptions: []
    }
  };
}

async function main(): Promise<void> {
  const tournament = createTournament();
  const controller = new TournamentsPublicController(
    {
      getPublicBySlug: async (slug: string) => {
        assert.equal(slug, tournament.slug);
        return tournament;
      }
    } as never,
    {} as never
  );

  {
    const capture = createResponseCapture();
    await controller.findPublicBySlug(
      tournament.slug,
      createRequest('text/html,application/xhtml+xml'),
      capture.response,
      undefined,
      undefined
    );

    const html = capture.getHtml();
    assert.ok(html, 'HTML should be returned for browser requests');
    assert.equal(capture.getHeader('content-type'), 'text/html; charset=utf-8');
    assert.match(html ?? '', /Девичник/);
    assert.match(html ?? '', /ТестMiniApp/);
    assert.match(html ?? '', /Вы в турнире!/);
    assert.match(html ?? '', /Участники турнира/);
    assert.match(html ?? '', /Елена Полкова/);
    assert.match(html ?? '', /Сетка скоро появится/);
    assert.match(html ?? '', /https:\/\/padlhub\.ru\/api\/tournaments\/public\/weekend-cup\/join/);
  }

  {
    const controllerWithFlow = new TournamentsPublicController(
      {
        getPublicBySlug: async () => tournament,
        getPublicJoinFlow: async () => createFlow(tournament, 'PROFILE_REQUIRED')
      } as never,
      {
        ensureAuthorizedClient: () => ({
          id: 'guest-1',
          authorized: false,
          authSource: 'cookie',
          onboardingCompleted: false,
          subscriptions: []
        }),
        requiresRealAuth: () => true
      } as never
    );
    const capture = createResponseCapture();
    await controllerWithFlow.findPublicBySlug(
      tournament.slug,
      createRequest('text/html,application/xhtml+xml'),
      capture.response,
      undefined,
      undefined
    );

    const html = capture.getHtml();
    assert.match(html ?? '', /Введите номер телефона, чтобы записаться/);
    assert.match(html ?? '', /name="phone"/);
  }

  {
    const controllerWithFlow = new TournamentsPublicController(
      {
        getPublicBySlug: async () => tournament,
        getPublicJoinFlow: async () => createFlow(tournament, 'READY_TO_JOIN')
      } as never,
      {
        ensureAuthorizedClient: () => ({
          id: 'client-1',
          authorized: true,
          authSource: 'headers',
          phone: '79990001122',
          phoneVerified: true,
          onboardingCompleted: true,
          subscriptions: []
        }),
        requiresRealAuth: () => true
      } as never
    );
    const capture = createResponseCapture();
    await controllerWithFlow.findPublicBySlug(
      tournament.slug,
      createRequest('text/html,application/xhtml+xml'),
      capture.response,
      undefined,
      undefined
    );

    const html = capture.getHtml();
    assert.match(html ?? '', /Записаться на занятие/);
  }

  {
    const capture = createResponseCapture();
    await controller.findPublicBySlug(
      tournament.slug,
      createRequest(),
      capture.response,
      undefined,
      undefined
    );

    assert.equal(capture.getHtml(), null);
    assert.deepEqual(capture.getJson(), tournament);
  }

  {
    const capture = createResponseCapture();
    await controller.findPublicBySlug(
      tournament.slug,
      createRequest('application/json'),
      capture.response,
      undefined,
      undefined
    );

    assert.equal(capture.getHtml(), null);
    assert.deepEqual(capture.getJson(), tournament);
  }

  console.log('Tournament public card render test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
