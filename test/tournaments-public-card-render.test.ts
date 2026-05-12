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
        levelLabel: '2.75',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      },
      {
        id: 'player-2',
        name: 'Елена Полкова',
        levelLabel: '3.50926',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      },
      {
        id: 'player-phone',
        name: '79104303190',
        levelLabel: '1.2',
        avatarUrl: '/uploads/player-phone.jpg',
        gender: 'MIXED',
        paymentStatus: 'UNPAID',
        status: 'REGISTERED'
      },
      {
        id: 'player-no-level',
        name: 'Игрок без уровня',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'PAID',
        status: 'REGISTERED'
      }
    ],
    waitlist: [
      {
        id: 'waitlist-1',
        name: 'Ольга Листова',
        levelLabel: '2.75',
        avatarUrl: null,
        gender: 'MIXED',
        paymentStatus: 'UNPAID',
        status: 'WAITLIST'
      }
    ],
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
  getRedirect: () => { status: number; url: string } | null;
} {
  let htmlPayload: string | null = null;
  let jsonPayload: unknown = null;
  let redirectPayload: { status: number; url: string } | null = null;
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
    },
    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      if (typeof statusOrUrl === 'number') {
        redirectPayload = { status: statusOrUrl, url: String(maybeUrl ?? '') };
      } else {
        redirectPayload = { status: 302, url: statusOrUrl };
      }
      return this;
    }
  } as unknown as Response;

  return {
    response,
    getHtml: () => htmlPayload,
    getJson: () => jsonPayload,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    getRedirect: () => redirectPayload
  };
}

function createFlow(
  tournament: TournamentPublicView,
  code: TournamentJoinFlowResponse['code'],
  options?: {
    waitlistAllowed?: boolean;
    accessOk?: boolean;
    accessCode?: TournamentJoinFlowResponse['access']['code'];
    accessMessage?: string;
  }
): TournamentJoinFlowResponse {
  const waitlistAllowed = options?.waitlistAllowed ?? false;
  const accessOk = options?.accessOk ?? true;
  const accessCode = options?.accessCode ?? 'OK';
  const accessMessage = options?.accessMessage ?? (accessOk ? 'Уровень подходит.' : 'Уровень не подходит.');
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
      ok: accessOk,
      code: accessCode,
      message: accessMessage,
      accessLevels: tournament.accessLevels
    },
    missingFields: code === 'PROFILE_REQUIRED' ? ['phone'] : [],
    waitlistAllowed,
    payment: {
      required: false,
      code: 'NOT_REQUIRED',
      message: 'Оплата не требуется.',
      availableSubscriptions: [],
      purchaseOptions: []
    }
  };
}

function createSessionServiceMock(overrides: Record<string, unknown> = {}): unknown {
  return {
    requiresRealAuth: () => true,
    resolveExternalAuthorizationHeader: () => undefined,
    ...overrides
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

    assert.equal(capture.getHtml(), null);
    assert.deepEqual(capture.getRedirect(), {
      status: 301,
      url: 'https://padlhub.ru/tournaments?tournamentId=public-card-1&date=2026-04-25&slug=weekend-cup'
    });
  }

  assert.equal(
    (controller as unknown as { formatGenderLabel(value: TournamentPublicView['gender']): string })
      .formatGenderLabel('FEMALE'),
    'Женский'
  );

  {
    const purchaseFlow = createFlow(tournament, 'PURCHASE_REQUIRED');
    purchaseFlow.client.levelLabel = 'D';
    purchaseFlow.payment = {
      required: true,
      code: 'PURCHASE_REQUIRED',
      message: 'Подходящий абонемент не найден. Сначала нужно купить участие.',
      availableSubscriptions: [],
      purchaseOptions: [
        {
          id: 'energy-5',
          label: 'Энергия 5 🎾',
          priceLabel: '3 990 ₽',
          productType: 'SUBSCRIPTION'
        },
        {
          id: 'energy-flex',
          label: 'Энергия 🎾',
          priceLabel: '—',
          productType: 'ONE_TIME'
        }
      ]
    };
    const controllerWithFlow = new TournamentsPublicController(
      {
        getPublicBySlug: async () => tournament,
        getPublicJoinFlow: async () => purchaseFlow
      } as never,
      createSessionServiceMock({
        ensureAuthorizedClient: () => ({
          id: 'client-1',
          authorized: true,
          authSource: 'headers',
          phone: '79990001122',
          phoneVerified: true,
          onboardingCompleted: true,
          subscriptions: []
        })
      }) as never
    );
    const capture = createResponseCapture();
    await controllerWithFlow.renderJoinPage(
      tournament.slug,
      createRequest('text/html,application/xhtml+xml'),
      capture.response,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const html = capture.getHtml();
    assert.doesNotMatch(html ?? '', /<select name="levelLabel" required>/);
    assert.match(html ?? '', /<input type="hidden" name="levelLabel" value="D" \/>/);
    assert.match(html ?? '', /<option value="energy-5" selected>Энергия 5 🎾 · 3 990 ₽<\/option>/);
    assert.match(html ?? '', /<option value="energy-flex">Энергия 🎾<\/option>/);
    assert.doesNotMatch(html ?? '', /Энергия 🎾 · —/);
  }

  {
    const controllerWithFlow = new TournamentsPublicController(
      {
        getPublicBySlug: async () => tournament,
        getPublicJoinFlow: async () =>
          createFlow(tournament, 'LEVEL_NOT_ALLOWED', {
            waitlistAllowed: false,
            accessOk: false,
            accessCode: 'LEVEL_NOT_ALLOWED',
            accessMessage: 'Уровень игрока не подходит под условия этого турнира.'
          })
      } as never,
      createSessionServiceMock({
        ensureAuthorizedClient: () => ({
          id: 'client-1',
          authorized: true,
          authSource: 'headers',
          phone: '79990001122',
          phoneVerified: true,
          onboardingCompleted: true,
          levelLabel: 'A',
          subscriptions: []
        })
      }) as never
    );
    const capture = createResponseCapture();
    await controllerWithFlow.renderJoinPage(
      tournament.slug,
      createRequest('text/html,application/xhtml+xml'),
      capture.response,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const html = capture.getHtml();
    assert.match(html ?? '', /Подобрать турнир по уровню/);
    assert.match(html ?? '', /\/tournaments\?level=/);
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
