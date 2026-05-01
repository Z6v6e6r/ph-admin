import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { PublicTournamentAccessCheckDto } from './dto/public-tournament-access-check.dto';
import { RegisterTournamentParticipantDto } from './dto/register-tournament-participant.dto';
import { TournamentMechanicsAccessDto } from './dto/tournament-mechanics-access.dto';
import { TournamentsPublicSessionService } from './tournaments-public-session.service';
import {
  TournamentAccessCheckResponse,
  TournamentJoinFlowResponse,
  TournamentMechanicsAccessResponse,
  TournamentPublicClientProfile,
  TournamentPublicDirectoryResponse,
  TournamentPublicView,
  TournamentRegistrationResponse
} from './tournaments.types';
import { TournamentsService } from './tournaments.service';

const TOURNAMENT_BASE_LEVEL_OPTIONS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const;
const TOURNAMENT_LEVEL_DIVISION_COUNT = 4;
const TOURNAMENT_LEVEL_BANDS = [
  { base: 'D', min: 1, max: 2, display: '1.0-2.0' },
  { base: 'D+', min: 2, max: 3, display: '2.0-3.0' },
  { base: 'C', min: 3, max: 3.5, display: '3.0-3.5' },
  { base: 'C+', min: 3.5, max: 4, display: '3.5-4.0' },
  { base: 'B', min: 4, max: 4.7, display: '4.0-4.7' },
  { base: 'B+', min: 4.7, max: 5.5, display: '4.7-5.5' },
  { base: 'A', min: 5.5, max: 6.3, display: '5.5+' }
] as const;
const TOURNAMENT_LEVEL_OPTIONS = buildTournamentLevelOptions();

function formatTournamentLevelScoreToken(value: number): string {
  return Number(value ?? 0)
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

function buildTournamentLevelOptions(): Array<{ value: string; label: string; base: string; rank: number }> {
  const options: Array<{ value: string; label: string; base: string; rank: number }> = [];
  TOURNAMENT_LEVEL_BANDS.forEach((band, bandIndex) => {
    for (let step = 0; step <= TOURNAMENT_LEVEL_DIVISION_COUNT; step += 1) {
      if (bandIndex > 0 && step === 0) {
        continue;
      }
      const score = band.min + (band.max - band.min) * (step / TOURNAMENT_LEVEL_DIVISION_COUNT);
      const value = formatTournamentLevelScoreToken(score);
      options.push({
        value,
        label: `${band.base} · ${value}`,
        base: band.base,
        rank: options.length
      });
    }
  });
  return options;
}

function normalizeTournamentLevelOptionToken(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/,/g, '.');
  if (!normalized) {
    return '';
  }
  if (TOURNAMENT_BASE_LEVEL_OPTIONS.includes(normalized as (typeof TOURNAMENT_BASE_LEVEL_OPTIONS)[number])) {
    return normalized;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return normalized;
  }
  const token = formatTournamentLevelScoreToken(numeric);
  return TOURNAMENT_LEVEL_OPTIONS.some((option) => option.value === token)
    ? token
    : normalized;
}

type JoinSubmission = {
  name?: string;
  phone?: string;
  levelLabel?: string;
  notes?: string;
  selectedSubscriptionId?: string;
  selectedPurchaseOptionId?: string;
  directTransactionId?: string;
  directCheckoutUrl?: string;
  authCode?: string;
  directViva?: boolean;
  forceAuthCode?: boolean;
  purchaseConfirmed: boolean;
  waitlist: boolean;
  format?: string;
};

type TournamentPublicParticipantCard = NonNullable<TournamentPublicView['participants']>[number];

@Controller('tournaments/public')
export class TournamentsPublicController {
  private readonly directoryUrl =
    String(process.env.TOURNAMENTS_PUBLIC_DIRECTORY_URL ?? '').trim() || '/tournaments';
  private readonly lkAuthUrl =
    String(process.env.TOURNAMENTS_PUBLIC_LK_AUTH_URL ?? '').trim() || 'https://padlhub.ru/lk_new';
  private readonly lkPollMs = this.parsePositiveInteger(
    String(process.env.TOURNAMENTS_PUBLIC_LK_AUTH_POLL_MS ?? '').trim()
  ) ?? 1500;
  private readonly vivaEndUserApiBaseUrl =
    (
      String(process.env.VIVA_END_USER_API_BASE_URL ?? '').trim()
      || String(process.env.VIVA_ADMIN_API_BASE_URL ?? '').trim()
      || 'https://api.vivacrm.ru'
    ).replace(/\/+$/, '');
  private readonly vivaEndUserWidgetId =
    String(process.env.VIVA_END_USER_WIDGET_ID ?? '').trim() || 'iSkq6G';

  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly tournamentsPublicSessionService: TournamentsPublicSessionService
  ) {}

  @Get()
  listPublicTournaments(
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('includePast') includePast?: string,
    @Query('forwardDays') forwardDays?: string,
    @Query('date') date?: string
  ): Promise<TournamentPublicDirectoryResponse> {
    return this.tournamentsService.listPublicDirectory({
      stationIds: this.parseCsv(stationId),
      limit: this.parsePositiveInteger(limit),
      includePast: this.parseBoolean(includePast),
      forwardDays: this.parsePositiveInteger(forwardDays),
      date
    });
  }

  @Get('list')
  listPublicTournamentsStable(
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('includePast') includePast?: string,
    @Query('forwardDays') forwardDays?: string,
    @Query('date') date?: string
  ): Promise<TournamentPublicDirectoryResponse> {
    return this.tournamentsService.listPublicDirectory({
      stationIds: this.parseCsv(stationId),
      limit: this.parsePositiveInteger(limit),
      includePast: this.parseBoolean(includePast),
      forwardDays: this.parsePositiveInteger(forwardDays),
      date
    });
  }

  @Get('showcase')
  renderPublicShowcase(
    @Req() request: Request,
    @Res() response: Response,
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('includePast') includePast?: string,
    @Query('title') title?: string,
    @Query('subtitle') subtitle?: string,
    @Query('refreshMs') refreshMs?: string
  ): void {
    const apiBasePath = this.resolveApiBasePath(request);
    const widgetScriptUrl = `${apiBasePath}/client-script/tournaments-showcase.js`;
    const normalizedTitle = String(title ?? '').trim() || 'Турниры PadelHub рядом с вами';
    const normalizedSubtitle =
      String(subtitle ?? '').trim()
      || 'Выбирайте турнир, проходите авторизацию через LK и записывайтесь прямо со страницы.';
    const normalizedLimit = this.parsePositiveInteger(limit);
    const normalizedLimitAttr = normalizedLimit !== undefined ? String(normalizedLimit) : '';
    const normalizedRefreshMs = this.normalizeRefreshMs(refreshMs);
    const normalizedIncludePast = this.parseBoolean(includePast);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(normalizedTitle)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at 14% 18%, rgba(194, 243, 214, 0.82), transparent 28%),
          radial-gradient(circle at 84% 14%, rgba(255, 210, 166, 0.74), transparent 30%),
          linear-gradient(150deg, #f7f4ea 0%, #fffdf7 38%, #eef7ff 100%);
        color: #1f2c21;
        padding: 28px;
      }
      .page {
        max-width: 1420px;
        margin: 0 auto;
      }
      .hero {
        margin-bottom: 22px;
        padding: 24px 26px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(31, 44, 33, 0.08);
        box-shadow: 0 24px 60px rgba(31, 44, 33, 0.10);
        backdrop-filter: blur(10px);
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: rgba(31, 44, 33, 0.58);
      }
      .title {
        margin: 0 0 10px;
        font-size: clamp(32px, 4vw, 56px);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0;
        max-width: 920px;
        font-size: clamp(16px, 1.8vw, 22px);
        line-height: 1.45;
        color: rgba(31, 44, 33, 0.76);
      }
      .mount {
        min-height: 360px;
      }
      @media (max-width: 720px) {
        body {
          padding: 16px;
        }
        .hero {
          padding: 18px;
          border-radius: 22px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Tournament Showcase</p>
        <h1 class="title">${this.escapeHtml(normalizedTitle)}</h1>
        <p class="subtitle">${this.escapeHtml(normalizedSubtitle)}</p>
      </section>
      <div
        class="mount"
        data-ph-tournaments-showcase
        data-api-base="${this.escapeHtml(apiBasePath)}"
        data-station-ids="${this.escapeHtml(String(stationId ?? ''))}"
        data-limit="${this.escapeHtml(normalizedLimitAttr)}"
        data-include-past="${normalizedIncludePast ? '1' : '0'}"
        data-refresh-ms="${this.escapeHtml(String(normalizedRefreshMs))}"
        data-title=""
        data-subtitle=""
        data-variant="screen"
      ></div>
    </main>
    <script src="${this.escapeHtml(widgetScriptUrl)}" defer></script>
  </body>
</html>`);
  }

  @Get(':slug/join')
  async renderJoinPage(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser,
    @Query('format') format?: string,
    @Query('autoAuth') autoAuth?: string,
    @Query('paymentsuccess') paymentSuccess?: string,
    @Query('paymentfailed') paymentFailed?: string
  ): Promise<void> {
    const client = this.tournamentsPublicSessionService.ensureAuthorizedClient(
      request,
      response,
      user
    );

    if (this.parseBoolean(paymentSuccess)) {
      const outcome = await this.tournamentsService.confirmPublicJoinAfterPayment(slug, {
        phone: client.phone,
        fallbackName: client.name ?? undefined,
        fallbackLevelLabel: client.levelLabel ?? undefined
      });
      if (this.wantsJson(request, format)) {
        response.json(outcome);
        return;
      }
      const tournament = await this.tournamentsService.getPublicBySlug(slug);
      this.sendHtml(response, this.renderOutcomeHtml(tournament, outcome, client, request, user));
      return;
    }

    if (this.parseBoolean(paymentFailed)) {
      const failedOutcome: TournamentRegistrationResponse = {
        ok: false,
        code: 'PURCHASE_REQUIRED',
        message: 'Оплата не завершена. Повторите оплату, чтобы подтвердить запись.',
        tournamentSlug: slug
      };
      if (this.wantsJson(request, format)) {
        response.json(failedOutcome);
        return;
      }
      const tournament = await this.tournamentsService.getPublicBySlug(slug);
      this.sendHtml(response, this.renderOutcomeHtml(tournament, failedOutcome, client, request, user));
      return;
    }

    const flow = this.enrichJoinFlow(
      await this.tournamentsService.getPublicJoinFlow(slug, client, {
        requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
      }),
      request,
      user
    );
    if (this.wantsJson(request, format)) {
      response.json(flow);
      return;
    }

    if (flow.code === 'AUTH_REQUIRED' && this.parseBoolean(autoAuth) && flow.authUrl) {
      response.redirect(flow.authUrl);
      return;
    }

    this.sendHtml(response, this.renderJoinHtml(flow, request, user));
  }

  @Post(':slug/join')
  async submitJoinPage(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser,
    @Body() body?: Record<string, unknown>
  ): Promise<void> {
    const currentClient = this.tournamentsPublicSessionService.ensureAuthorizedClient(
      request,
      response,
      user
    );
    const submission = this.normalizeJoinSubmission(body);
    let clientForRemember = currentClient;
    if (submission.authCode) {
      const verifiedClient = await this.tournamentsPublicSessionService.verifyPhoneCode(
        request,
        response,
        currentClient,
        submission.phone ?? currentClient.phone,
        submission.authCode
      );
      if (!verifiedClient) {
        const flow = this.enrichJoinFlow(
          await this.tournamentsService.getPublicJoinFlow(slug, currentClient, {
            requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
          }),
          request,
          user
        );
        const payload = {
          ...flow,
          code: 'PHONE_VERIFICATION_REQUIRED' as const,
          ok: false,
          message: 'Код подтверждения не подошёл или устарел.'
        };
        if (this.wantsJson(request, submission.format)) {
          response.json(payload);
          return;
        }
        this.sendHtml(response, this.renderJoinHtml(payload, request, user));
        return;
      }
      clientForRemember = verifiedClient;
    }
    const client = this.tournamentsPublicSessionService.rememberClient(
      request,
      response,
      clientForRemember,
      submission
    );
    await this.trySyncAuthorizedClientLevel(request, client, submission.levelLabel);
    const flow = this.enrichJoinFlow(
      await this.tournamentsService.getPublicJoinFlow(slug, client, {
        requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
      }),
      request,
      user
    );

    if (flow.code === 'PHONE_VERIFICATION_REQUIRED' && submission.phone && !submission.authCode) {
      const codeResult = await this.tournamentsPublicSessionService.createPhoneCode(
        request,
        response,
        client,
        submission.phone
      );
      const nextFlow = {
        ...flow,
        message: codeResult.ok
          ? 'Введите код подтверждения, отправленный на номер телефона.'
          : codeResult.message,
        phoneVerification: codeResult
      };
      if (this.wantsJson(request, submission.format)) {
        response.json(nextFlow);
        return;
      }

      this.sendHtml(response, this.renderJoinHtml(nextFlow, request, user));
      return;
    }

    if (submission.waitlist && flow.code === 'LEVEL_NOT_ALLOWED') {
      const outcome = await this.tournamentsService.addPublicParticipantToWaitlist(slug, {
        name: client.name ?? '',
        phone: client.phone ?? '',
        levelLabel: client.levelLabel,
        notes: submission.notes
      });
      if (this.wantsJson(request, submission.format)) {
        response.json(outcome);
        return;
      }

      this.sendHtml(response, this.renderOutcomeHtml(flow.tournament, outcome, client, request, user));
      return;
    }

    if (flow.code === 'PURCHASE_REQUIRED' && submission.purchaseConfirmed) {
      const joinUrl = this.toAbsoluteUrl(flow.tournament.joinUrl, request, user);
      const successUrl = this.appendQueryParam(joinUrl, 'paymentsuccess', 'true');
      const failUrl = this.appendQueryParam(joinUrl, 'paymentfailed', 'true');
      const vivaAuthorizationHeader = this.tournamentsPublicSessionService
        .resolveExternalAuthorizationHeader(request, client);
      if (
        !submission.directTransactionId
        && (!vivaAuthorizationHeader || submission.forceAuthCode)
      ) {
        const codeResult = await this.tournamentsPublicSessionService.createPhoneCode(
          request,
          response,
          client,
          client.phone ?? submission.phone
        );
        const nextFlow = {
          ...flow,
          code: 'PHONE_VERIFICATION_REQUIRED' as const,
          ok: false,
          message: codeResult.ok
            ? 'Введите код подтверждения, отправленный на номер телефона.'
            : codeResult.message,
          phoneVerification: codeResult
        };
        if (this.wantsJson(request, submission.format)) {
          response.json(nextFlow);
          return;
        }

        this.sendHtml(response, this.renderJoinHtml(nextFlow, request, user));
        return;
      }
      if (submission.directViva && !submission.directTransactionId) {
        const nextFlow = {
          ...flow,
          vivaAuthorizationHeader
        };
        if (this.wantsJson(request, submission.format)) {
          response.json(nextFlow);
          return;
        }

        this.sendHtml(response, this.renderJoinHtml(nextFlow, request, user));
        return;
      }
      const outcome = submission.directTransactionId
        ? await this.tournamentsService.rememberPublicJoinPurchaseTransaction(slug, {
          name: client.name ?? '',
          phone: client.phone ?? '',
          levelLabel: client.levelLabel,
          notes: submission.notes,
          selectedPurchaseOptionId: submission.selectedPurchaseOptionId,
          transactionId: submission.directTransactionId,
          checkoutUrl: submission.directCheckoutUrl
        })
        : await this.tournamentsService.createPublicJoinPurchaseTransaction(slug, {
        name: client.name ?? '',
        phone: client.phone ?? '',
        levelLabel: client.levelLabel,
        notes: submission.notes,
        selectedPurchaseOptionId: submission.selectedPurchaseOptionId,
        purchaseConfirmed: true,
        subscriptions: client.subscriptions,
        vivaAuthorizationHeader,
        successUrl,
        failUrl
      });

      if (this.wantsJson(request, submission.format)) {
        response.json(outcome);
        return;
      }

      if (outcome.payment?.checkoutUrl) {
        response.redirect(outcome.payment.checkoutUrl);
        return;
      }

      this.sendHtml(response, this.renderOutcomeHtml(flow.tournament, outcome, client, request, user));
      return;
    }

    if (
      flow.code === 'READY_TO_JOIN'
      || flow.code === 'SUBSCRIPTION_AVAILABLE'
    ) {
      const outcome = await this.tournamentsService.registerPublicParticipant(slug, {
        name: client.name ?? '',
        phone: client.phone ?? '',
        levelLabel: client.levelLabel,
        notes: submission.notes,
        selectedSubscriptionId: submission.selectedSubscriptionId,
        selectedPurchaseOptionId: submission.selectedPurchaseOptionId,
        purchaseConfirmed: submission.purchaseConfirmed,
        subscriptions: client.subscriptions,
        vivaAuthorizationHeader: this.tournamentsPublicSessionService
          .resolveExternalAuthorizationHeader(request, client)
      });
      if (this.wantsJson(request, submission.format)) {
        response.json(outcome);
        return;
      }

      this.sendHtml(response, this.renderOutcomeHtml(flow.tournament, outcome, client, request, user));
      return;
    }

    if (this.wantsJson(request, submission.format)) {
      response.json(flow);
      return;
    }

    this.sendHtml(response, this.renderJoinHtml(flow, request, user));
  }

  @Get(':slug')
  async findPublicBySlug(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser,
    @Query('format') format?: string
  ): Promise<void> {
    const tournament = await this.tournamentsService.getPublicBySlug(slug);

    if (this.wantsJson(request, format)) {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(tournament);
      return;
    }

    if (this.wantsHtml(request, format)) {
      let flow: TournamentJoinFlowResponse | undefined;
      if (
        typeof this.tournamentsPublicSessionService.ensureAuthorizedClient === 'function'
        && typeof this.tournamentsPublicSessionService.requiresRealAuth === 'function'
      ) {
        const client = this.tournamentsPublicSessionService.ensureAuthorizedClient(
          request,
          response,
          user
        );
        flow = this.enrichJoinFlow(
          await this.tournamentsService.getPublicJoinFlow(slug, client, {
            requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
          }),
          request,
          user
        );
      }
      this.sendHtml(response, this.renderPublicTournamentHtml(tournament, request, user, flow));
      return;
    }

    response.json(tournament);
  }

  @Post(':slug/access-check')
  checkAccess(
    @Param('slug') slug: string,
    @Body() dto: PublicTournamentAccessCheckDto
  ): Promise<TournamentAccessCheckResponse> {
    return this.tournamentsService.checkPublicAccess(slug, dto.levelLabel);
  }

  @Post(':slug/registrations')
  registerParticipant(
    @Param('slug') slug: string,
    @Body() dto: RegisterTournamentParticipantDto
  ): Promise<TournamentRegistrationResponse> {
    return this.tournamentsService.registerPublicParticipant(slug, dto);
  }

  @Post(':slug/mechanics-access')
  checkMechanicsAccess(
    @Param('slug') slug: string,
    @Body() dto: TournamentMechanicsAccessDto
  ): Promise<TournamentMechanicsAccessResponse> {
    return this.tournamentsService.checkMechanicsAccess(slug, dto.phone);
  }

  private enrichJoinFlow(
    flow: TournamentJoinFlowResponse,
    request: Request,
    user?: RequestUser
  ): TournamentJoinFlowResponse {
    const authRequired = flow.code === 'AUTH_REQUIRED';
    const joinUrl = this.toAbsoluteUrl(flow.tournament.joinUrl, request, user);
    const authCheckUrl = this.appendQueryParam(joinUrl, 'format', 'json');
    const vivaAuthorizationHeader = this.tournamentsPublicSessionService
      .resolveExternalAuthorizationHeader(request, flow.client);

    return {
      ...flow,
      authRequired,
      authCheckUrl,
      authPollMs: authRequired ? this.lkPollMs : undefined,
      cabinetUrl: this.lkAuthUrl,
      authUrl: authRequired ? this.buildLkAuthUrl(joinUrl) : undefined,
      vivaAuthorizationHeader
    };
  }

  private renderPublicTournamentHtml(
    tournament: TournamentPublicView,
    request: Request,
    user?: RequestUser,
    flow?: TournamentJoinFlowResponse
  ): string {
    const title = this.pickString(tournament.skin.title) ?? tournament.name;
    const subtitle = this.pickString(tournament.skin.subtitle) ?? 'от PadlxAB';
    const imageUrl = this.pickString(tournament.skin.imageUrl);
    const absoluteImageUrl = imageUrl ? this.toAbsoluteUrl(imageUrl, request, user) : '';
    const posterImageUrl =
      absoluteImageUrl || this.toAbsoluteUrl('/api/ui/tournament-sleeve.png', request, user);
    const trainerAvatarUrl = this.pickString(tournament.trainerAvatarUrl);
    const absoluteTrainerAvatarUrl = trainerAvatarUrl
      ? this.toAbsoluteUrl(trainerAvatarUrl, request, user)
      : '';
    const absoluteJoinUrl = this.toAbsoluteUrl(tournament.joinUrl, request, user);
    const participants = Array.isArray(tournament.participants) ? tournament.participants : [];
    const waitlist = Array.isArray(tournament.waitlist) ? tournament.waitlist : [];
    const maxPlayers = Math.max(1, Number(tournament.maxPlayers) || 1);
    const participantsCount = Math.max(0, Number(tournament.participantsCount) || participants.length);
    const displayParticipants: TournamentPublicParticipantCard[] = [
      ...participants.slice(0, maxPlayers),
      ...waitlist
    ];
    const accessLabel = this.formatAccessLevelRange(tournament.accessLevels);
    const genderLabel = this.formatGenderLabel(tournament.gender).toUpperCase();
    const capacityLabel = `${participantsCount} / ${maxPlayers}`;
    const statusLabel =
      participantsCount >= maxPlayers
        ? 'СОСТАВ НАБРАН'
        : tournament.registrationOpen
          ? 'ИДЕТ ЗАПИСЬ'
          : 'РЕГИСТРАЦИЯ ЗАКРЫТА';
    const defaultActionLabel = tournament.registrationOpen
      ? this.pickString(tournament.skin.ctaLabel) ?? 'Записаться'
      : 'Посмотреть статус';
    const clientInTournament =
      flow?.code === 'ALREADY_REGISTERED' || flow?.code === 'ALREADY_WAITLISTED';
    const actionHtml = this.renderPublicTournamentActionHtml(
      tournament,
      absoluteJoinUrl,
      defaultActionLabel,
      flow
    );
    const actionScript = this.renderPublicTournamentActionScript(absoluteJoinUrl);
    const participantCards =
      displayParticipants.length > 0
        ? displayParticipants
            .map((participant) => {
              const name = this.resolveParticipantDisplayName(participant.name);
              const level = this.formatPublicAvatarLevelLabel(participant.levelLabel);
              const avatarUrl = this.resolveParticipantAvatarUrl(participant.avatarUrl, request, user);
              const stateClass = this.isMutedPublicParticipant(participant) ? ' is-muted' : '';
              return `<article class="participant${stateClass}">
                <div class="avatar-wrap">
                  <div class="avatar">
                    ${
                      avatarUrl
                        ? `<img src="${this.escapeHtml(avatarUrl)}" alt="${this.escapeHtml(name)}" />`
                        : `<span class="avatar-initials">${this.escapeHtml(this.resolveInitials(name))}</span>`
                    }
                  </div>
                  ${level ? `<span class="level">${this.escapeHtml(level)}</span>` : ''}
                </div>
                <p>${this.escapeHtml(name)}</p>
              </article>`;
            })
            .join('')
        : `<div class="empty">Участники появятся после первых записей.</div>`;
    const teaserAvatars =
      displayParticipants.length > 0
        ? displayParticipants
            .slice(0, 4)
            .map((participant) => {
              const name = this.resolveParticipantDisplayName(participant.name);
              const avatarUrl = this.resolveParticipantAvatarUrl(participant.avatarUrl, request, user);
              const level = this.formatPublicAvatarLevelLabel(participant.levelLabel);
              const stateClass = this.isMutedPublicParticipant(participant) ? ' is-muted' : '';
              return `<span class="teaser-avatar-wrap${stateClass}">
                <span class="teaser-avatar">
                  ${
                    avatarUrl
                      ? `<img src="${this.escapeHtml(avatarUrl)}" alt="${this.escapeHtml(name)}" />`
                      : `<span class="avatar-initials">${this.escapeHtml(this.resolveInitials(name))}</span>`
                  }
                </span>
                ${level ? `<b>${this.escapeHtml(level)}</b>` : ''}
              </span>`;
            })
            .join('')
        : '';

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(title)} - карточка турнира</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fbf8ff;
        color: #221d35;
      }
      .page {
        width: min(100%, 760px);
        min-height: 100vh;
        margin: 0 auto;
        background: #fffaff;
        box-shadow: 0 24px 90px rgba(44, 31, 83, 0.12);
      }
      .poster {
        position: relative;
        min-height: 230px;
        overflow: hidden;
        border-radius: 0 0 2px 2px;
        background: #fff;
      }
      .poster::before {
        content: "";
        position: absolute;
        inset: 0;
        background: url("${this.escapeHtml(posterImageUrl)}") center / cover no-repeat;
        opacity: 0.92;
      }
      .poster::after {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(90deg, rgba(76, 43, 196, 0.62), rgba(132, 74, 234, 0.28)),
          linear-gradient(180deg, rgba(255,255,255,0.02), rgba(25,18,74,0.22));
      }
      .back {
        appearance: none;
        border: 0;
        padding: 0;
        position: absolute;
        z-index: 1;
        top: 28px;
        left: 24px;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: transparent;
        color: #fff;
        cursor: pointer;
        text-decoration: none;
        font-size: 42px;
        font-family: inherit;
        line-height: 1;
      }
      .poster-copy {
        position: relative;
        z-index: 1;
        min-height: 230px;
        padding: 42px 140px 28px 260px;
        display: grid;
        align-content: center;
        color: #fff;
        text-shadow: 0 2px 12px rgba(22, 13, 60, 0.28);
      }
      .poster-title {
        margin: 0;
        max-width: 100%;
        font-size: 56px;
        line-height: 0.96;
        font-weight: 900;
        overflow-wrap: break-word;
      }
      .poster-subtitle {
        margin: 14px 0 0;
        font-size: 22px;
        font-weight: 700;
      }
      .date-badge {
        position: absolute;
        z-index: 1;
        top: 28px;
        right: 28px;
        min-width: 88px;
        padding: 12px 10px;
        border-radius: 18px;
        background: linear-gradient(180deg, #251b52, #8b4cf0);
        color: #fff;
        text-align: center;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22);
      }
      .date-badge span { display: block; font-weight: 900; }
      .date-badge span:first-child { font-size: 20px; letter-spacing: 0.06em; }
      .date-badge span:last-child { font-size: 38px; line-height: 1; }
      .content {
        padding: 24px;
        display: grid;
        gap: 22px;
      }
      .headline {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      h1 {
        margin: 0;
        font-size: clamp(30px, 6vw, 42px);
        line-height: 1.05;
        font-weight: 900;
      }
      .organizer {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
      }
      .organizer-avatar {
        width: 64px;
        height: 64px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #7256ef, #a36dff);
        color: #fff;
        font-weight: 900;
        overflow: hidden;
      }
      .organizer-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .organizer-name {
        margin: 0 0 5px;
        font-size: 22px;
        font-weight: 800;
      }
      .pill {
        display: inline-flex;
        min-height: 32px;
        align-items: center;
        padding: 7px 14px;
        border-radius: 999px;
        background: #f0e7ff;
        color: #6540c8;
        font-weight: 800;
      }
      .tabs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .tab {
        min-height: 48px;
        border-radius: 24px;
        display: grid;
        place-items: center;
        background: #f4f0ff;
        color: #8766eb;
        font-size: 20px;
        font-weight: 800;
      }
      .tab.is-active {
        background: #8766eb;
        color: #fff;
      }
      .status-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: baseline;
      }
      .section-title {
        margin: 0;
        font-size: 24px;
        line-height: 1.1;
        font-weight: 900;
      }
      .muted {
        color: #7b748c;
      }
      .schedule {
        margin: 8px 0 0;
        font-size: 20px;
        line-height: 1.35;
        font-weight: 900;
      }
      .details {
        margin: 6px 0 0;
        color: #736c84;
        font-size: 18px;
      }
      .participants-card {
        border: 1px solid #eee7f4;
        border-radius: 18px;
        background: #fff;
        overflow: hidden;
      }
      .teaser {
        min-height: 92px;
        padding: 18px;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #fdfbff;
      }
      .teaser-avatar-wrap {
        position: relative;
        width: 54px;
        height: 54px;
        margin-left: -18px;
        display: block;
        flex: 0 0 54px;
        isolation: isolate;
      }
      .teaser-avatar-wrap:first-child { margin-left: 0; }
      .teaser-avatar {
        width: 100%;
        height: 100%;
        border: 3px solid #fdfbff;
        border-radius: 999px;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #e9e2f3;
        color: #2a2142;
        font-weight: 900;
      }
      .teaser-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .avatar-initials {
        width: 100%;
        height: 100%;
        border-radius: inherit;
        display: grid;
        place-items: center;
      }
      .teaser-avatar b,
      .level {
        position: absolute;
        z-index: 2;
        right: -10px;
        bottom: -5px;
        min-width: 34px;
        max-width: 54px;
        padding: 4px 7px;
        border-radius: 999px;
        background: #211b48;
        color: #fff;
        font-size: 12px;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .players {
        padding: 14px 14px 18px;
        border-top: 1px solid #eee7f4;
      }
      .players-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        padding: 0 4px 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px 14px;
      }
      .participant {
        min-width: 0;
        text-align: center;
      }
      .avatar-wrap {
        position: relative;
        width: 72px;
        height: 72px;
        margin: 0 auto 9px;
        isolation: isolate;
      }
      .avatar {
        width: 100%;
        height: 100%;
        border-radius: 999px;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #eee9f7;
        color: #33294d;
        font-weight: 900;
      }
      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .participant p {
        margin: 0;
        color: #554d68;
        font-size: 16px;
        line-height: 1.15;
        overflow-wrap: anywhere;
      }
      .participant.is-muted .avatar,
      .teaser-avatar-wrap.is-muted .teaser-avatar {
        background: #edf0f5;
        color: #868391;
      }
      .participant.is-muted .avatar img,
      .teaser-avatar-wrap.is-muted img {
        filter: grayscale(1);
        opacity: 0.52;
      }
      .participant.is-muted p {
        color: #8d8799;
      }
      .participant.is-muted .level,
      .teaser-avatar-wrap.is-muted b {
        background: #8c8798;
      }
      .empty {
        padding: 26px;
        color: #756d85;
        text-align: center;
      }
      .bracket-note {
        margin-top: 18px;
        min-height: 46px;
        display: grid;
        place-items: center;
        border: 1px solid #eee7f4;
        border-radius: 12px;
        color: #7b748c;
        font-size: 20px;
      }
      .cta {
        display: grid;
        place-items: center;
        min-height: 64px;
        border-radius: 20px;
        background: linear-gradient(90deg, #7749f5, #ff6047);
        color: #fff;
        text-decoration: none;
        font-size: 22px;
        font-weight: 900;
      }
      .public-action {
        border-radius: 18px;
        background: #f1f2f7;
        padding: 16px;
      }
      .public-action__phone {
        display: grid;
        gap: 12px;
        text-align: center;
      }
      .public-action__title {
        margin: 0;
        font-size: 20px;
        line-height: 1.25;
        font-weight: 900;
        color: #1f1f25;
      }
      .public-action__row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
      }
      .public-action label {
        display: grid;
        gap: 5px;
        text-align: left;
        color: #70717b;
        font-size: 12px;
      }
      .public-action input {
        width: 100%;
        min-height: 50px;
        border: none;
        border-radius: 5px;
        background: #fff;
        padding: 10px 12px;
        color: #202127;
        font: inherit;
        font-size: 18px;
        outline: none;
      }
      .public-action__button {
        display: grid;
        place-items: center;
        width: 100%;
        min-height: 64px;
        border: none;
        border-radius: 5px;
        background: #15191d;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-size: 16px;
        font-weight: 800;
        text-decoration: none;
      }
      .public-action__hint {
        margin: 0;
        color: #70717b;
        font-size: 12px;
        line-height: 1.35;
      }
      .public-action__hint a {
        color: inherit;
      }
      .public-action__status {
        display: none;
        margin: 0 0 10px;
        color: #70717b;
        font-size: 13px;
        line-height: 1.35;
      }
      .public-action.is-loading .public-action__status {
        display: block;
      }
      @media (max-width: 640px) {
        .page { min-height: 100vh; box-shadow: none; }
        .poster { min-height: 176px; }
        .poster-copy {
          min-height: 176px;
          padding: 52px 92px 22px 104px;
        }
        .poster-title { font-size: 34px; }
        .poster-subtitle { font-size: 16px; }
        .date-badge {
          min-width: 70px;
          top: 20px;
          right: 18px;
        }
        .content { padding: 18px; }
        .organizer { grid-template-columns: 54px minmax(0, 1fr); }
        .organizer .pill:last-child { display: none; }
        .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .avatar-wrap { width: 62px; height: 62px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="poster">
        <button class="back" data-back-link data-fallback-url="${this.escapeHtml(this.toAbsoluteUrl(this.directoryUrl, request, user))}" type="button" aria-label="Назад">‹</button>
        <div class="date-badge">
          <span>${this.escapeHtml(this.formatDateBadgeWeekday(tournament.startsAt).toUpperCase() || 'ДАТА')}</span>
          <span>${this.escapeHtml(this.formatDateBadgeDay(tournament.startsAt))}</span>
        </div>
        <div class="poster-copy">
          <h2 class="poster-title">${this.escapeHtml(title)}</h2>
          <p class="poster-subtitle">${this.escapeHtml(subtitle)}</p>
        </div>
      </section>

      <section class="content">
        <div class="headline">
          <h1>${this.escapeHtml(
            clientInTournament ? 'Вы в турнире!' : statusLabel
          )}</h1>
          <span class="pill">${this.escapeHtml(accessLabel)}</span>
        </div>

        <div class="organizer">
          <div class="organizer-avatar">${
            absoluteTrainerAvatarUrl
              ? `<img src="${this.escapeHtml(absoluteTrainerAvatarUrl)}" alt="${this.escapeHtml(tournament.trainerName || 'Организатор')}" />`
              : this.escapeHtml(this.resolveInitials(tournament.trainerName || 'PadelHub'))
          }</div>
          <div>
            <p class="organizer-name">${this.escapeHtml(
              tournament.trainerName || 'Организатор'
            )}</p>
            <span class="pill">Организатор</span>
          </div>
          <span class="pill">Организатор</span>
        </div>

        <div class="tabs" role="tablist" aria-label="Разделы турнира">
          <div class="tab is-active">Статус</div>
          <div class="tab">Регламент</div>
        </div>

        <section>
          <div class="status-row">
            <h2 class="section-title">Участники турнира</h2>
            <strong>${this.escapeHtml(capacityLabel)} ${this.escapeHtml(genderLabel)}</strong>
          </div>
          <p class="schedule">${this.escapeHtml(title)}</p>
          <p class="details">${this.escapeHtml(
            [
              this.formatCardScheduleLabel(tournament.startsAt, tournament.endsAt),
              tournament.studioName || 'Площадка уточняется'
            ]
              .filter(Boolean)
              .join(' · ')
          )}</p>
        </section>

        <section class="participants-card">
          ${teaserAvatars ? `<div class="teaser">${teaserAvatars}</div>` : ''}
          <div class="players">
            <div class="players-head">
              <div>
                <h2 class="section-title">Участники турнира</h2>
                <div class="muted">${this.escapeHtml(capacityLabel)} ${this.escapeHtml(genderLabel)}</div>
              </div>
              <strong>${this.escapeHtml(capacityLabel)}</strong>
            </div>
            <div class="grid">${participantCards}</div>
            <div class="bracket-note">Сетка скоро появится</div>
          </div>
        </section>

        ${actionHtml}
      </section>
    </main>
    <script>
      (function () {
        var backLink = document.querySelector('[data-back-link]');
        if (!backLink) {
          return;
        }
        backLink.addEventListener('click', function (event) {
          event.preventDefault();
          if (window.history.length > 1 && document.referrer) {
            window.history.back();
            return;
          }
          var fallbackUrl = backLink.getAttribute('data-fallback-url');
          if (fallbackUrl) {
            window.location.href = fallbackUrl;
          }
        });
      })();
    </script>
    ${actionScript}
  </body>
</html>`;
  }

  private renderPublicTournamentActionHtml(
    tournament: TournamentPublicView,
    absoluteJoinUrl: string,
    defaultActionLabel: string,
    flow?: TournamentJoinFlowResponse
  ): string {
    const flowCode = flow?.code ?? '';
    const phoneValue = this.escapeHtml(this.formatPhone(flow?.client.phone));
    const showPhoneForm =
      tournament.registrationOpen
      && (flowCode === 'PROFILE_REQUIRED' || flowCode === 'PHONE_VERIFICATION_REQUIRED');

    if (showPhoneForm) {
      return `<section class="public-action" data-phab-public-action>
          <p class="public-action__status">Проверяем авторизацию...</p>
          <form class="public-action__phone" method="post" action="${this.escapeHtml(absoluteJoinUrl)}">
            <p class="public-action__title">Введите номер телефона, чтобы записаться</p>
            <div class="public-action__row">
              <label>
                Телефон
                <input
                  type="tel"
                  name="phone"
                  value="${phoneValue}"
                  inputmode="tel"
                  autocomplete="tel"
                  placeholder="+7"
                  required
                />
              </label>
            </div>
            <button class="public-action__button" type="submit">Продолжить</button>
            <p class="public-action__hint">
              Указывая код, вы соглашаетесь с условиями Публичной Оферты и Обработкой Персональных Данных
            </p>
          </form>
        </section>`;
    }

    const actionLabel =
      tournament.registrationOpen
        ? 'Записаться на турнир'
        : defaultActionLabel;
    const actionHref =
      flowCode === 'AUTH_REQUIRED' && flow?.authUrl
        ? flow.authUrl
        : absoluteJoinUrl;

    return `<section class="public-action" data-phab-public-action>
        <p class="public-action__status">Проверяем авторизацию...</p>
        <a class="public-action__button" href="${this.escapeHtml(actionHref)}">${this.escapeHtml(actionLabel)}</a>
      </section>`;
  }

  private renderPublicTournamentActionScript(absoluteJoinUrl: string): string {
    const profileUrl = new URL(
      `/end-user/api/v1/${encodeURIComponent(this.vivaEndUserWidgetId)}/profile`,
      `${this.vivaEndUserApiBaseUrl}/`
    ).toString();
    const flowUrl = this.appendQueryParam(absoluteJoinUrl, 'format', 'json');

    return `<script>
      (function () {
        var root = document.querySelector('[data-phab-public-action]');
        if (!root || !window.fetch) return;

        var profileUrl = ${JSON.stringify(profileUrl)};
        var flowUrl = ${JSON.stringify(flowUrl)};
        var joinUrl = ${JSON.stringify(absoluteJoinUrl)};

        function escapeHtml(value) {
          return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char;
          });
        }

        function pick(record, keys) {
          if (!record || typeof record !== 'object') return '';
          for (var index = 0; index < keys.length; index += 1) {
            var value = record[keys[index]];
            if (value !== null && value !== undefined && String(value).trim()) {
              return String(value).trim();
            }
          }
          return '';
        }

        function pickPhone(profile) {
          var direct = pick(profile, ['phone', 'phoneNumber', 'primaryPhone', 'mobile', 'mainPhone']);
          var client = profile && typeof profile.client === 'object' ? profile.client : null;
          var nested = pick(client, ['phone', 'phoneNumber', 'primaryPhone', 'mobile', 'mainPhone']);
          var phones = Array.isArray(profile && profile.phones) ? profile.phones : [];
          var firstPhone = phones.length ? pick(phones[0], ['phone', 'phoneNumber', 'value', 'number']) : '';
          return direct || nested || firstPhone;
        }

        function pickName(profile) {
          var direct = pick(profile, ['name', 'fullName', 'displayName', 'title']);
          var firstName = pick(profile, ['firstName']);
          var lastName = pick(profile, ['lastName']);
          var client = profile && typeof profile.client === 'object' ? profile.client : null;
          return direct || [firstName, lastName].filter(Boolean).join(' ') || pick(client, ['name', 'fullName', 'displayName']);
        }

        function pickLevel(profile) {
          var direct = pick(profile, ['levelLabel', 'level', 'ratingLabel', 'rating']);
          if (direct) return direct;
          return pickNamedLevel(profile);
        }

        function normalizeLevelValue(value) {
          if (Array.isArray(value)) {
            for (var index = 0; index < value.length; index += 1) {
              var item = normalizeLevelValue(value[index]);
              if (item) return item;
            }
            return '';
          }
          return value !== null && value !== undefined && String(value).trim()
            ? String(value).trim().replace(',', '.')
            : '';
        }

        function pickNamedLevel(value, depth) {
          depth = depth || 0;
          if (!value || depth > 5) return '';
          if (Array.isArray(value)) {
            for (var index = 0; index < value.length; index += 1) {
              var nested = pickNamedLevel(value[index], depth + 1);
              if (nested) return nested;
            }
            return '';
          }
          if (typeof value !== 'object') return '';
          var name = [
            pick(value, ['name']),
            pick(value, ['title']),
            pick(value, ['label']),
            pick(value, ['key']),
            pick(value, ['code']),
            pick(value, ['fieldName', 'field_name'])
          ].filter(Boolean).join(' ').toLowerCase();
          if (name && /(уровень\\s*падел\\s*числовой|padel\\s*level|level|rating|рейтинг)/i.test(name)) {
            var level = normalizeLevelValue(value.value)
              || normalizeLevelValue(value.values)
              || normalizeLevelValue(value.answer)
              || normalizeLevelValue(value.content);
            if (level) return level;
          }
          var keys = ['fields', 'customFields', 'custom_fields', 'additionalFields', 'additional_fields', 'attributes', 'properties', 'parameters', 'profile', 'client', 'data', 'result', 'content'];
          for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
            var result = pickNamedLevel(value[keys[keyIndex]], depth + 1);
            if (result) return result;
          }
          return '';
        }

        function normalizeSubscriptions(value) {
          if (!Array.isArray(value)) return [];
          return value.map(function (item, index) {
            var record = item && typeof item === 'object' ? item : {};
            var label = pick(record, ['label', 'name', 'title']);
            if (!label) return null;
            return {
              id: pick(record, ['id', 'subscriptionId', 'productId']) || 'viva-sub-' + (index + 1),
              label: label,
              remainingUses: Number(record.remainingUses || record.visitsLeft || record.remaining || record.uses || 1) || 1,
              validUntil: pick(record, ['validUntil', 'expirationDate', 'expiresAt'])
            };
          }).filter(Boolean);
        }

        function buildHeaders(profile) {
          var client = profile && typeof profile.client === 'object' ? profile.client : null;
          var phone = pickPhone(profile);
          var id = pick(profile, ['id', 'clientId', 'userId', 'uuid']) || pick(client, ['id', 'clientId', 'userId', 'uuid']) || phone;
          var name = pickName(profile);
          var level = pickLevel(profile);
          var subscriptions =
            normalizeSubscriptions(profile && profile.availableClientSubscriptions)
              .concat(normalizeSubscriptions(profile && profile.subscriptions))
              .concat(normalizeSubscriptions(profile && profile.clientSubscriptions));
          var headers = { Accept: 'application/json', 'x-user-id': id || 'viva-client' };
          if (name) headers['x-user-name'] = name;
          if (phone) headers['x-user-phone'] = phone;
          if (level) headers['x-user-level-label'] = level;
          if (subscriptions.length) headers['x-user-subscriptions'] = JSON.stringify(subscriptions);
          return { headers: headers, phone: phone };
        }

        function renderPhone(phone) {
          root.classList.remove('is-loading');
          root.innerHTML =
            '<form class="public-action__phone" method="post" action="' + escapeHtml(joinUrl) + '">' +
              '<p class="public-action__title">Введите номер телефона, чтобы записаться</p>' +
              '<div class="public-action__row"><label>Телефон' +
                '<input type="tel" name="phone" inputmode="tel" autocomplete="tel" placeholder="+7" required value="' + escapeHtml(phone || '') + '" />' +
              '</label></div>' +
              '<button class="public-action__button" type="submit">Продолжить</button>' +
              '<p class="public-action__hint">Указывая код, вы соглашаетесь с условиями Публичной Оферты и Обработкой Персональных Данных</p>' +
            '</form>';
        }

        function renderButton(label) {
          root.classList.remove('is-loading');
          root.innerHTML =
            '<a class="public-action__button" href="' + escapeHtml(joinUrl) + '">' +
              escapeHtml(label || 'Записаться на турнир') +
            '</a>';
        }

        fetch(profileUrl, {
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
        })
          .then(function (response) {
            if (!response.ok) throw new Error('profile_unavailable');
            return response.json();
          })
          .then(function (profile) {
            var auth = buildHeaders(profile || {});
            return fetch(flowUrl, {
              credentials: 'include',
              headers: auth.headers
            }).then(function (response) {
              if (!response.ok) throw new Error('join_flow_unavailable');
              return response.json().then(function (flow) {
                return { flow: flow, phone: auth.phone };
              });
            });
          })
          .then(function (result) {
            var flow = result.flow || {};
            if (flow.code === 'PROFILE_REQUIRED' || flow.code === 'PHONE_VERIFICATION_REQUIRED') {
              renderPhone(result.phone || (flow.client && flow.client.phone));
              return;
            }
            if (flow.code === 'ALREADY_REGISTERED' || flow.code === 'ALREADY_WAITLISTED') {
              renderButton('Открыть заявку');
              return;
            }
            renderButton('Записаться на турнир');
          })
          .catch(function () {
            root.classList.remove('is-loading');
          });
      })();
    </script>`;
  }

  private renderPublicTournamentLegacyHtml(
    tournament: TournamentPublicView,
    request: Request,
    user?: RequestUser
  ): string {
    const title = this.pickString(tournament.skin.title) ?? tournament.name;
    const subtitle =
      this.pickString(tournament.skin.subtitle)
      ?? [
        this.formatTournamentDate(tournament.startsAt),
        tournament.studioName,
        tournament.trainerName
      ]
        .filter(Boolean)
        .join(' · ');
    const description =
      this.pickString(tournament.skin.description)
      ?? 'Откройте карточку записи, авторизуйтесь через LK PadelHub и завершите регистрацию в пару шагов.';
    const badgeLabel = this.pickString(tournament.skin.badgeLabel)
      ?? (tournament.registrationOpen ? 'Регистрация открыта' : 'Регистрация закрыта');
    const accessLabel =
      tournament.accessLevels.length > 0
        ? tournament.accessLevels.join(', ')
        : 'Без ограничений';
    const participantsLabel = `${tournament.participantsCount}/${tournament.maxPlayers}`;
    const bookingLabel = tournament.booking.required
      ? 'Оплата обязательна'
      : tournament.booking.enabled
        ? 'Есть варианты оплаты'
        : 'Оплата не требуется';
    const imageUrl = this.pickString(tournament.skin.imageUrl);
    const absolutePublicUrl = this.toAbsoluteUrl(tournament.publicUrl, request, user);
    const absoluteJoinUrl = this.toAbsoluteUrl(tournament.joinUrl, request, user);
    const absoluteDirectoryUrl = this.toAbsoluteUrl(this.directoryUrl, request, user);
    const actionLabel = tournament.registrationOpen
      ? this.pickString(tournament.skin.ctaLabel) ?? 'Открыть запись'
      : 'Посмотреть детали';
    const skinTags = Array.isArray(tournament.skin.tags)
      ? tournament.skin.tags.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    const chipLabels = Array.from(
      new Set(
        [
          tournament.tournamentType,
          this.formatGenderLabel(tournament.gender),
          `Уровень: ${accessLabel}`,
          bookingLabel,
          ...skinTags
        ].filter(Boolean)
      )
    );

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(title)} - Турнир PadelHub</title>
    <meta name="description" content="${this.escapeHtml(description)}" />
    <meta property="og:title" content="${this.escapeHtml(title)}" />
    <meta property="og:description" content="${this.escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${this.escapeHtml(absolutePublicUrl)}" />
    ${
      imageUrl
        ? `<meta property="og:image" content="${this.escapeHtml(
            this.toAbsoluteUrl(imageUrl, request, user)
          )}" />`
        : ''
    }
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at 12% 18%, rgba(194, 243, 214, 0.84), transparent 28%),
          radial-gradient(circle at 84% 14%, rgba(255, 210, 166, 0.78), transparent 30%),
          linear-gradient(148deg, #f7f4ea 0%, #fffdf7 40%, #eef7ff 100%);
        color: #1f2c21;
        padding: 18px;
      }
      .page {
        max-width: 980px;
        margin: 0 auto;
      }
      .hero {
        position: relative;
        overflow: hidden;
        border-radius: 30px;
        border: 1px solid rgba(31, 44, 33, 0.08);
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.82)),
          ${
            imageUrl
              ? `url("${this.escapeHtml(this.toAbsoluteUrl(imageUrl, request, user))}") center/cover no-repeat`
              : 'linear-gradient(90deg, rgba(236, 244, 255, 0.5), rgba(255, 247, 230, 0.48))'
          };
        box-shadow: 0 28px 80px rgba(31, 44, 33, 0.14);
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(140deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.02));
        pointer-events: none;
      }
      .hero-content {
        position: relative;
        z-index: 1;
        padding: 26px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(31, 44, 33, 0.08);
        font-size: 11px;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: rgba(31, 44, 33, 0.7);
      }
      .title {
        margin: 16px 0 10px;
        font-size: clamp(34px, 5vw, 58px);
        line-height: 0.96;
        letter-spacing: -0.045em;
      }
      .subtitle {
        margin: 0;
        max-width: 720px;
        font-size: 17px;
        line-height: 1.5;
        color: rgba(31, 44, 33, 0.76);
      }
      .body {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }
      .summary,
      .details {
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(31, 44, 33, 0.08);
        border-radius: 26px;
        padding: 22px;
        box-shadow: 0 20px 56px rgba(31, 44, 33, 0.1);
        backdrop-filter: blur(10px);
      }
      .summary-text {
        margin: 0 0 18px;
        font-size: 15px;
        line-height: 1.6;
        color: rgba(31, 44, 33, 0.76);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .chip {
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(31, 44, 33, 0.06);
        font-size: 12px;
        line-height: 1.2;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
      }
      .metric {
        padding: 14px;
        border-radius: 20px;
        background: rgba(247, 244, 234, 0.9);
        border: 1px solid rgba(31, 44, 33, 0.06);
      }
      .metric-label {
        display: block;
        margin-bottom: 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(31, 44, 33, 0.52);
      }
      .metric-value {
        font-size: 15px;
        line-height: 1.45;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 22px;
      }
      .button,
      .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 50px;
        padding: 0 18px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
      }
      .button {
        background: linear-gradient(90deg, #f45f34 0%, #f5974c 100%);
        color: #fff;
      }
      .button-secondary {
        background: rgba(31, 44, 33, 0.08);
        color: #1f2c21;
      }
      .footnote {
        margin-top: 16px;
        font-size: 12px;
        line-height: 1.55;
        color: rgba(31, 44, 33, 0.56);
      }
      @media (max-width: 640px) {
        body {
          padding: 12px;
        }
        .hero-content,
        .summary,
        .details {
          padding: 18px;
        }
        .hero,
        .summary,
        .details {
          border-radius: 24px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="hero-content">
          <span class="eyebrow">${this.escapeHtml(badgeLabel)}</span>
          <h1 class="title">${this.escapeHtml(title)}</h1>
          <p class="subtitle">${this.escapeHtml(subtitle)}</p>
        </div>
      </section>

      <section class="body">
        <article class="summary">
          <p class="summary-text">${this.escapeHtml(description)}</p>
          <ul class="chips">
            ${chipLabels
              .map((item) => `<li class="chip">${this.escapeHtml(item)}</li>`)
              .join('')}
          </ul>

          <div class="actions">
            <a class="button" href="${this.escapeHtml(absoluteJoinUrl)}">${this.escapeHtml(actionLabel)}</a>
            <a class="button-secondary" href="${this.escapeHtml(absoluteDirectoryUrl)}">К списку турниров</a>
          </div>
          <p class="footnote">
            Кнопка записи открывает browser-friendly flow: авторизация через LK, проверка уровня и запись в турнир или waitlist.
          </p>
        </article>

        <article class="details">
          <div class="metrics">
            <div class="metric">
              <span class="metric-label">Дата и время старта</span>
              <span class="metric-value">${this.escapeHtml(
                this.formatTournamentDate(tournament.startsAt)
              )}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Дата и время конца</span>
              <span class="metric-value">${this.escapeHtml(
                this.formatTournamentDate(tournament.endsAt)
              )}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Формат</span>
              <span class="metric-value">${this.escapeHtml(tournament.tournamentType)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Пол</span>
              <span class="metric-value">${this.escapeHtml(
                this.formatGenderLabel(tournament.gender)
              )}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Уровень</span>
              <span class="metric-value">${this.escapeHtml(accessLabel)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Участники</span>
              <span class="metric-value">${this.escapeHtml(participantsLabel)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Waitlist</span>
              <span class="metric-value">${this.escapeHtml(String(tournament.waitlistCount))}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Площадка</span>
              <span class="metric-value">${this.escapeHtml(
                tournament.studioName || 'PadelHub'
              )}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Тренер</span>
              <span class="metric-value">${this.escapeHtml(
                tournament.trainerName || 'Организатор турнира'
              )}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Оплата</span>
              <span class="metric-value">${this.escapeHtml(bookingLabel)}</span>
            </div>
            ${
              tournament.sourceTournament?.name
                ? `<div class="metric">
              <span class="metric-label">Источник</span>
              <span class="metric-value">${this.escapeHtml(
                tournament.sourceTournament.name
              )}</span>
            </div>`
                : ''
            }
            <div class="metric">
              <span class="metric-label">Публичная ссылка</span>
              <span class="metric-value">${this.escapeHtml(absolutePublicUrl)}</span>
            </div>
          </div>
        </article>
      </section>
    </main>
  </body>
</html>`;
  }

  private normalizeJoinSubmission(value: unknown): JoinSubmission {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      name: this.pickString(record.name) ?? undefined,
      phone: this.pickString(record.phone) ?? undefined,
      levelLabel: this.pickString(record.levelLabel) ?? undefined,
      notes: this.pickString(record.notes) ?? undefined,
      selectedSubscriptionId: this.pickString(record.selectedSubscriptionId) ?? undefined,
      selectedPurchaseOptionId: this.pickString(record.selectedPurchaseOptionId) ?? undefined,
      directTransactionId: this.pickString(record.directTransactionId) ?? undefined,
      directCheckoutUrl: this.pickString(record.directCheckoutUrl) ?? undefined,
      authCode: this.pickString(record.authCode) ?? undefined,
      directViva: this.parseBoolean(record.directViva),
      forceAuthCode: this.parseBoolean(record.forceAuthCode),
      purchaseConfirmed: this.parseBoolean(record.purchaseConfirmed),
      waitlist: this.parseBoolean(record.waitlist),
      format: this.pickString(record.format) ?? undefined
    };
  }

  private wantsJson(request: Request, format?: string): boolean {
    if (String(format ?? '').trim().toLowerCase() === 'json') {
      return true;
    }
    const accept = String(request.headers.accept ?? '').toLowerCase();
    return accept.includes('application/json');
  }

  private async trySyncAuthorizedClientLevel(
    request: Request,
    client: TournamentPublicClientProfile,
    submittedLevel?: string
  ): Promise<void> {
    if (!client.authorized) {
      return;
    }

    const normalizedLevel = normalizeTournamentLevelOptionToken(
      submittedLevel ?? client.levelLabel
    );
    if (!normalizedLevel) {
      return;
    }

    const authCookie = this.pickString(request.headers.cookie);
    const authHeader = this.pickString(request.headers.authorization);
    if (!authCookie && !authHeader) {
      return;
    }

    const profileUrl = new URL(
      `/end-user/api/v1/${encodeURIComponent(this.vivaEndUserWidgetId)}/profile`,
      `${this.vivaEndUserApiBaseUrl}/`
    ).toString();
    const payload = {
      levelLabel: normalizedLevel,
      level: normalizedLevel
    };
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };

    if (authCookie) {
      headers.Cookie = authCookie;
    }
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    for (const method of ['PATCH', 'PUT'] as const) {
      try {
        const response = await fetch(profileUrl, {
          method,
          headers,
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          return;
        }
      } catch (_error) {
        // Ignore sync errors: tournament join flow should not depend on profile update.
      }
    }
  }

  private wantsHtml(request: Request, format?: string): boolean {
    if (String(format ?? '').trim().toLowerCase() === 'html') {
      return true;
    }
    const accept = String(request.headers.accept ?? '').toLowerCase();
    return accept.includes('text/html') || accept.includes('application/xhtml+xml');
  }

  private sendHtml(response: Response, html: string): void {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.send(html);
  }

  private buildLkAuthUrl(returnUrl: string): string {
    const url = /^https?:\/\//i.test(this.lkAuthUrl)
      ? new URL(this.lkAuthUrl)
      : new URL(this.lkAuthUrl, new URL(returnUrl).origin);
    url.searchParams.set('returnUrl', returnUrl);
    url.searchParams.set('source', 'tournament_join');
    return url.toString();
  }

  private toAbsoluteUrl(value: string, request: Request, user?: RequestUser): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return this.getRequestBaseUrl(request, user);
    }
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    return new URL(normalized, this.getRequestBaseUrl(request, user)).toString();
  }

  private getRequestBaseUrl(request: Request, user?: RequestUser): string {
    const maxPublicUrl = this.pickString(user?.maxPublicUrl);
    if (maxPublicUrl && /^https?:\/\//i.test(maxPublicUrl)) {
      return maxPublicUrl;
    }
    const forwardedProto = this.pickString(request.headers['x-forwarded-proto']);
    const protocol = forwardedProto ?? (request.secure ? 'https' : 'http');
    const host = this.pickString(request.headers['x-forwarded-host'])
      ?? this.pickString(request.headers.host)
      ?? 'localhost';
    return `${protocol}://${host}`;
  }

  private appendQueryParam(url: string, key: string, value: string): string {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set(key, value);
    return nextUrl.toString();
  }

  private renderJoinHtml(
    flow: TournamentJoinFlowResponse,
    request: Request,
    user?: RequestUser
  ): string {
    const tournament = flow.tournament;
    const client = flow.client;
    const absoluteJoinUrl = this.toAbsoluteUrl(tournament.joinUrl, request, user);
    const absoluteDirectoryUrl = this.toAbsoluteUrl(this.directoryUrl, request, user);
    const needsLevel = tournament.accessLevels.length > 0;
    const phoneValue = this.escapeHtml(this.formatPhone(client.phone));
    const nameValue = this.escapeHtml(String(client.name ?? ''));
    const levelValue = String(client.levelLabel ?? '').trim().toUpperCase();
    const actionLabel =
      flow.code === 'SUBSCRIPTION_AVAILABLE'
        ? 'Списать абонемент и записаться'
        : flow.code === 'PURCHASE_REQUIRED'
          ? 'Подтвердить покупку и записаться'
          : flow.code === 'PHONE_VERIFICATION_REQUIRED'
            ? 'Подтвердить код'
          : flow.code === 'READY_TO_JOIN'
        ? tournament.skin.ctaLabel || 'Записаться'
        : flow.code === 'LEVEL_NOT_ALLOWED'
          ? flow.waitlistAllowed ? 'Проверить уровень ещё раз' : 'Подобрать турнир по уровню'
          : 'Продолжить';
    const showPhoneInput =
      flow.code === 'PROFILE_REQUIRED'
      || flow.code === 'PHONE_VERIFICATION_REQUIRED'
      || !this.formatPhone(client.phone);
    const showAuthCodeInput =
      flow.code === 'PROFILE_REQUIRED' || flow.code === 'PHONE_VERIFICATION_REQUIRED';
    const authCodeRequiredAttr = flow.code === 'PHONE_VERIFICATION_REQUIRED' ? ' required' : '';
    const isPurchaseVerification =
      flow.code === 'PHONE_VERIFICATION_REQUIRED'
      && flow.payment.required
      && flow.payment.code === 'PURCHASE_REQUIRED';
    const selectedPurchaseOptionId =
      this.escapeHtml(flow.payment.purchaseOptions[0]?.id || '');
    const cardFormHtml =
      flow.code === 'AUTH_REQUIRED'
        ? ''
        : `<form id="phab-tournament-join-form" method="post" action="${this.escapeHtml(absoluteJoinUrl)}" class="phab-tournament-join-card__form">
            <input type="hidden" name="name" value="${nameValue}" />
            ${
              showPhoneInput
                ? `<label class="phab-tournament-join-card__field">
              <span>Телефон</span>
              <input
                type="tel"
                name="phone"
                maxlength="30"
                value="${phoneValue}"
                placeholder="+7 999 123-45-67"
                required
              />
            </label>`
                : `<input type="hidden" name="phone" value="${phoneValue}" />`
            }
            ${
              showAuthCodeInput
                ? `<label class="phab-tournament-join-card__field">
              <span>Код авторизации</span>
              <input
                type="text"
                name="authCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="8"
                placeholder="Введите код из SMS"
               ${authCodeRequiredAttr}
              />
            </label>`
                : ''
            }
            ${
              needsLevel
                ? `<label class="phab-tournament-join-card__field">
              <span>Уровень игрока</span>
              <select name="levelLabel" required>
                <option value="">Выберите уровень</option>
                ${this.renderLevelOptions(levelValue)}
              </select>
            </label>`
                : ''
            }
            <input type="hidden" name="notes" value="" />
            ${
              flow.code === 'SUBSCRIPTION_AVAILABLE'
                ? `<input type="hidden" name="selectedSubscriptionId" value="${this.escapeHtml(flow.payment.selectedSubscription?.id || '')}" />`
                : ''
            }
            ${
              flow.code === 'PURCHASE_REQUIRED' || isPurchaseVerification
                ? `<input type="hidden" name="purchaseConfirmed" value="1" />
            ${
              flow.payment.purchaseOptions.length > 0
                ? `<label class="phab-tournament-join-card__field">
              <span>Тариф покупки</span>
              <select name="selectedPurchaseOptionId">
                ${flow.payment.purchaseOptions
                  .map(
                    (item) =>
                      `<option value="${this.escapeHtml(item.id)}"${
                        this.escapeHtml(item.id) === selectedPurchaseOptionId ? ' selected' : ''
                      }>${this.escapeHtml(item.label)} · ${this.escapeHtml(item.priceLabel)}</option>`
                  )
                  .join('')}
              </select>
            </label>`
                : ''
            }`
                : ''
            }
          </form>`;
    const cardSecondaryActionHtml =
      flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed
        ? `<form id="phab-tournament-join-waitlist-form" method="post" action="${this.escapeHtml(absoluteJoinUrl)}">
            <input type="hidden" name="name" value="${nameValue}" />
            <input type="hidden" name="phone" value="${phoneValue}" />
            <input type="hidden" name="levelLabel" value="${this.escapeHtml(levelValue)}" />
            <input type="hidden" name="waitlist" value="1" />
          </form>`
        : '';
    const cardActionHtml =
      flow.code === 'AUTH_REQUIRED'
        ? `<a class="phab-tournament-join-card__cta" href="${this.escapeHtml(flow.authUrl || this.lkAuthUrl)}">Войти через LK</a>`
        : flow.code === 'LEVEL_NOT_ALLOWED' && !flow.waitlistAllowed
          ? `<a class="phab-tournament-join-card__cta" href="${this.escapeHtml(
            this.appendQueryParam(absoluteDirectoryUrl, 'level', levelValue || String(client.levelLabel ?? ''))
          )}">${this.escapeHtml(actionLabel)}</a>`
        : `<button class="phab-tournament-join-card__cta" type="submit" form="phab-tournament-join-form">${this.escapeHtml(actionLabel)}</button>`;
    const compactCardHtml = this.renderJoinTournamentCard(
      flow,
      cardActionHtml,
      cardFormHtml,
      cardSecondaryActionHtml
    );
    const alreadyDone =
      flow.code === 'ALREADY_REGISTERED' || flow.code === 'ALREADY_WAITLISTED';

    if (alreadyDone) {
      const outcomeCode =
        flow.code === 'ALREADY_REGISTERED' ? 'ALREADY_REGISTERED' : 'ALREADY_WAITLISTED';
      return this.renderOutcomeHtml(
        tournament,
        {
          ok: true,
          code: outcomeCode,
          message: flow.message,
          tournamentId: tournament.id,
          tournamentSlug: tournament.slug
        },
        client,
        request,
        user
      );
    }

    if (flow.code === 'AUTH_REQUIRED') {
      return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(tournament.name)} - Вход в LK</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at 14% 18%, rgba(194, 243, 214, 0.82), transparent 28%),
          radial-gradient(circle at 84% 14%, rgba(255, 210, 166, 0.74), transparent 30%),
          linear-gradient(150deg, #f7f4ea 0%, #fffdf7 38%, #eef7ff 100%);
        color: #1f2c21;
        padding: 18px;
      }
      .page { max-width: 760px; margin: 0 auto; }
      .card {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(31, 44, 33, 0.08);
        border-radius: 28px;
        padding: 24px;
        box-shadow: 0 24px 60px rgba(31, 44, 33, 0.1);
      }
      .title {
        margin: 0 0 10px;
        font-size: clamp(28px, 5vw, 44px);
        line-height: 1;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0 0 18px;
        color: rgba(31, 44, 33, 0.72);
        line-height: 1.5;
      }
      .status {
        margin-bottom: 18px;
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(231, 244, 255, 0.92);
        border: 1px solid rgba(64, 122, 203, 0.18);
        line-height: 1.5;
      }
      .meta {
        display: grid;
        gap: 10px;
        margin-bottom: 18px;
      }
      .row {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(247, 244, 234, 0.9);
      }
      .label {
        display: block;
        margin-bottom: 5px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(31, 44, 33, 0.52);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button, .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border: none;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
      }
      .button {
        background: linear-gradient(90deg, #f45f34 0%, #f5974c 100%);
        color: #fff;
      }
      .button-secondary {
        background: rgba(31, 44, 33, 0.08);
        color: #1f2c21;
      }
      .footnote {
        margin-top: 16px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(31, 44, 33, 0.56);
      }
      ${this.renderJoinTournamentCardStyles()}
    </style>
  </head>
  <body>
    <main class="page">
      ${compactCardHtml}
      <section class="card join-panel">
        <h1 class="title">${this.escapeHtml(tournament.skin.title || tournament.name)}</h1>
        <p class="subtitle">${this.escapeHtml(
          tournament.skin.subtitle
          || [this.formatTournamentDate(tournament.startsAt), tournament.studioName]
            .filter(Boolean)
            .join(' · ')
        )}</p>
        <div class="status">${this.escapeHtml(flow.message)}</div>
        <div class="meta">
          <div class="row">
            <span class="label">Турнир</span>
            ${this.escapeHtml(tournament.name)}
          </div>
          <div class="row">
            <span class="label">Площадка</span>
            ${this.escapeHtml(tournament.studioName || 'PadelHub')}
          </div>
          <div class="row">
            <span class="label">Когда</span>
            ${this.escapeHtml(this.formatTournamentDate(tournament.startsAt))}
          </div>
        </div>
        <div class="actions">
          <a class="button" href="${this.escapeHtml(flow.authUrl || this.lkAuthUrl)}">Войти через LK</a>
          <a class="button-secondary" href="${this.escapeHtml(absoluteDirectoryUrl)}">К турнирам</a>
        </div>
        <p class="footnote">
          После входа в личный кабинет вернитесь к этой ссылке или повторно нажмите кнопку турнира на Tilda-странице.
        </p>
      </section>
    </main>
  </body>
</html>`;
    }

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(tournament.name)} - Турнир PadelHub</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at 14% 18%, rgba(194, 243, 214, 0.82), transparent 28%),
          radial-gradient(circle at 84% 14%, rgba(255, 210, 166, 0.74), transparent 30%),
          linear-gradient(150deg, #f7f4ea 0%, #fffdf7 38%, #eef7ff 100%);
        color: #1f2c21;
        padding: 18px;
      }
      .page {
        max-width: 820px;
        margin: 0 auto;
      }
      .card {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(31, 44, 33, 0.08);
        border-radius: 28px;
        padding: 24px;
        box-shadow: 0 24px 60px rgba(31, 44, 33, 0.1);
        backdrop-filter: blur(12px);
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: rgba(31, 44, 33, 0.58);
      }
      .title {
        margin: 0 0 8px;
        font-size: clamp(30px, 5vw, 48px);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0 0 20px;
        font-size: 16px;
        line-height: 1.5;
        color: rgba(31, 44, 33, 0.72);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .metric {
        padding: 14px;
        border-radius: 18px;
        background: rgba(247, 244, 234, 0.9);
        border: 1px solid rgba(31, 44, 33, 0.06);
      }
      .metric-label {
        display: block;
        margin-bottom: 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(31, 44, 33, 0.52);
      }
      .metric-value {
        font-size: 15px;
        line-height: 1.4;
        color: #1f2c21;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 18px;
        padding: 0;
        list-style: none;
      }
      .chip {
        padding: 7px 11px;
        border-radius: 999px;
        background: rgba(31, 44, 33, 0.06);
        font-size: 12px;
        line-height: 1;
      }
      .status {
        margin-bottom: 18px;
        padding: 14px 16px;
        border-radius: 20px;
        font-size: 14px;
        line-height: 1.45;
      }
      .status-info {
        background: rgba(231, 244, 255, 0.92);
        border: 1px solid rgba(64, 122, 203, 0.18);
      }
      .status-success {
        background: rgba(228, 250, 236, 0.92);
        border: 1px solid rgba(31, 153, 90, 0.18);
      }
      .status-warning {
        background: rgba(255, 242, 225, 0.96);
        border: 1px solid rgba(222, 145, 34, 0.2);
      }
      form {
        display: grid;
        gap: 14px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 13px;
        color: rgba(31, 44, 33, 0.78);
      }
      input, select, textarea {
        width: 100%;
        border: 1px solid rgba(31, 44, 33, 0.14);
        border-radius: 14px;
        padding: 12px 13px;
        font-size: 15px;
        background: #fff;
        color: #1f2c21;
      }
      textarea {
        min-height: 86px;
        resize: vertical;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 2px;
      }
      .button, .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border: none;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
      }
      .button {
        background: linear-gradient(90deg, #f45f34 0%, #f5974c 100%);
        color: #fff;
      }
      .button-secondary {
        background: rgba(31, 44, 33, 0.08);
        color: #1f2c21;
      }
      .footnote {
        margin-top: 16px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(31, 44, 33, 0.56);
      }
      ${this.renderJoinTournamentCardStyles()}
      @media (max-width: 640px) {
        body {
          padding: 12px;
        }
        .card {
          padding: 18px;
          border-radius: 24px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      ${compactCardHtml}
    </main>
  </body>
</html>`;
  }

  private renderJoinTournamentCard(
    flow: TournamentJoinFlowResponse,
    actionHtml: string,
    formHtml = '',
    secondaryActionHtml = ''
  ): string {
    const tournament = flow.tournament;
    const client = flow.client;
    const accessLabel = this.formatAccessLevelRange(tournament.accessLevels);
    const genderLabel = this.formatGenderCardLabel(tournament.gender);
    const participantsLabel = `${Math.max(0, Number(tournament.participantsCount) || 0)}/${Math.max(
      0,
      Number(tournament.maxPlayers) || 0
    )} участников`;
    const spotsLeft = Math.max(
      0,
      Math.max(0, Number(tournament.maxPlayers) || 0)
      - Math.max(0, Number(tournament.participantsCount) || 0)
    );
    const progress = this.renderJoinTournamentCardProgress(tournament);
    const durationLabel = this.formatDurationCompact(tournament.startsAt, tournament.endsAt);
    const title = tournament.skin.title || tournament.name || 'Турнир';
    const badgeLabel = tournament.tournamentType || 'Турнир';
    const organizerName = tournament.trainerName || 'Организатор турнира';
    const organizerHandle = `@${String(tournament.slug || 'padelhub').replace(/^@+/, '')}`;
    const phoneLabel = this.formatPhone(client.phone) || 'Не указан';

    return `<article class="phab-tournament-join-card" aria-label="${this.escapeHtml(title)}">
        <div class="phab-tournament-join-card__profile">
          <div class="phab-tournament-join-card__profile-main">
            <div class="phab-tournament-join-card__avatar">${this.escapeHtml(this.resolveInitials(organizerName))}</div>
            <div class="phab-tournament-join-card__profile-copy">
              <p class="phab-tournament-join-card__organizer">${this.escapeHtml(organizerName)}</p>
              <p class="phab-tournament-join-card__handle">${this.escapeHtml(organizerHandle)}</p>
            </div>
          </div>
          <span class="phab-tournament-join-card__more" aria-hidden="true">•••</span>
        </div>

        <div class="phab-tournament-join-card__surface">
          <div class="phab-tournament-join-card__head">
            <div class="phab-tournament-join-card__heading">
              <span class="phab-tournament-join-card__tag">
                <span class="phab-tournament-join-card__tag-dot" aria-hidden="true"></span>
                ${this.escapeHtml(badgeLabel)}
              </span>
              <h1 class="phab-tournament-join-card__title">${this.escapeHtml(title)}</h1>
            </div>
            <div class="phab-tournament-join-card__date">
              <span class="phab-tournament-join-card__date-day">${this.escapeHtml(this.formatDateBadgeDay(tournament.startsAt))}</span>
              <span class="phab-tournament-join-card__date-weekday">${this.escapeHtml(this.formatDateBadgeWeekday(tournament.startsAt))}</span>
            </div>
          </div>

          <div class="phab-tournament-join-card__info">
            <div class="phab-tournament-join-card__meta">
              <span class="phab-tournament-join-card__icon" aria-hidden="true">□</span>
              <span>${this.escapeHtml(this.formatCardScheduleLabel(tournament.startsAt, tournament.endsAt))}</span>
            </div>
            <div class="phab-tournament-join-card__meta">
              <span class="phab-tournament-join-card__icon" aria-hidden="true">⌖</span>
              <span>${this.escapeHtml(tournament.studioName || 'PadelHub')}</span>
              <a class="phab-tournament-join-card__map" href="${this.escapeHtml(
                this.buildMapUrl(tournament.studioName || 'PadelHub')
              )}" target="_blank" rel="noopener noreferrer">на карте</a>
            </div>
            <div class="phab-tournament-join-card__meta">
              <span class="phab-tournament-join-card__icon" aria-hidden="true">▥</span>
              <span>${this.escapeHtml(accessLabel)}</span>
            </div>
            ${
              genderLabel
                ? `<div class="phab-tournament-join-card__meta">
              <span class="phab-tournament-join-card__icon" aria-hidden="true">♢</span>
              <span>${this.escapeHtml(genderLabel)}</span>
            </div>`
                : ''
            }
          </div>

          <div class="phab-tournament-join-card__capacity">
            <div class="phab-tournament-join-card__progress">${progress}</div>
            <div class="phab-tournament-join-card__capacity-texts">
              <span>${this.escapeHtml(participantsLabel)}</span>
              <span>${this.escapeHtml(spotsLeft > 0 ? `осталось: ${this.pluralizeSpots(spotsLeft)}` : 'мест нет')}</span>
            </div>
          </div>

          <div class="phab-tournament-join-card__phone" aria-label="Телефон участника">
            <span class="phab-tournament-join-card__phone-label">Телефон</span>
            <span class="phab-tournament-join-card__phone-value">${this.escapeHtml(phoneLabel)}</span>
          </div>

          ${formHtml}

          ${actionHtml}
          ${
            secondaryActionHtml
              ? '<button class="phab-tournament-join-card__cta phab-tournament-join-card__cta--secondary" type="submit" form="phab-tournament-join-waitlist-form">В лист ожидания</button>'
              : ''
          }
          ${secondaryActionHtml}
        </div>

        <div class="phab-tournament-join-card__footer">
          <div class="phab-tournament-join-card__footer-metrics">
            <span class="is-accent">♥ ${this.escapeHtml(String(Math.max(0, Number(tournament.participantsCount) || 0)))}</span>
            <span>▱ ${this.escapeHtml(String(Math.max(0, Number(tournament.waitlistCount) || 0)))}</span>
          </div>
          ${durationLabel ? `<span class="phab-tournament-join-card__duration">${this.escapeHtml(durationLabel)}</span>` : ''}
        </div>
      </article>`;
  }

  private renderJoinTournamentCardStyles(): string {
    return `
      .phab-tournament-join-card {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: min(100%, 359px);
        min-height: 363px;
        margin: 0 auto 18px;
        padding: 0 20px 16px;
        gap: 12px;
        border-bottom: 0.5px solid #ededed;
        color: #1f1e20;
      }
      .phab-tournament-join-card * { box-sizing: border-box; }
      .phab-tournament-join-card__profile,
      .phab-tournament-join-card__footer {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        width: 100%;
        gap: 16px;
      }
      .phab-tournament-join-card__profile-main {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
      }
      .phab-tournament-join-card__avatar {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        flex: 0 0 36px;
        overflow: hidden;
        border-radius: 8px;
        background: #d9d9d9;
        color: #1f1e20;
        font-size: 12px;
        font-weight: 800;
      }
      .phab-tournament-join-card__profile-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 5px;
        min-width: 0;
      }
      .phab-tournament-join-card__organizer,
      .phab-tournament-join-card__handle {
        max-width: 224px;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .phab-tournament-join-card__organizer {
        font-size: 14px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      .phab-tournament-join-card__handle {
        color: #b4b4b4;
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }
      .phab-tournament-join-card__more {
        width: 16px;
        height: 16px;
        color: #b4b4b4;
        font-size: 10px;
        line-height: 16px;
        text-align: center;
      }
      .phab-tournament-join-card__surface {
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        width: 100%;
        min-height: 263px;
        padding: 14px 12px;
        gap: 20px;
        border-radius: 12px;
        background: #fafafa;
      }
      .phab-tournament-join-card__head {
        position: relative;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        width: 100%;
        gap: 24px;
      }
      .phab-tournament-join-card__heading {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 0;
        padding-right: 58px;
        gap: 8px;
      }
      .phab-tournament-join-card__tag {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        min-height: 18px;
        padding: 5px 6px;
        gap: 3px;
        border-radius: 24px;
        background: rgba(47, 157, 212, 0.08);
        color: #2f9dd4;
        font-size: 10px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .phab-tournament-join-card__tag-dot {
        width: 8px;
        height: 8px;
        flex: 0 0 8px;
        border-radius: 999px;
        background: #2f9dd4;
      }
      .phab-tournament-join-card__title {
        width: 100%;
        margin: 0;
        overflow: hidden;
        color: #1f1e20;
        font-size: 18px;
        line-height: 1;
        font-weight: 800;
        letter-spacing: 0.01em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .phab-tournament-join-card__date {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 51px;
        padding: 8px;
        gap: 4px;
        border-radius: 8px;
        background: #fff;
      }
      .phab-tournament-join-card__date-day {
        font-size: 18px;
        line-height: 1.24;
        font-weight: 800;
      }
      .phab-tournament-join-card__date-weekday {
        color: #8766eb;
        font-size: 9px;
        line-height: 1;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .phab-tournament-join-card__info,
      .phab-tournament-join-card__capacity {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        gap: 10px;
      }
      .phab-tournament-join-card__meta {
        display: flex;
        align-items: flex-start;
        width: 100%;
        min-width: 0;
        gap: 4px;
        color: #353436;
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }
      .phab-tournament-join-card__meta span:nth-child(2) {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .phab-tournament-join-card__icon {
        width: 12px;
        flex: 0 0 12px;
        color: #888889;
        text-align: center;
      }
      .phab-tournament-join-card__map {
        margin-left: auto;
        padding-bottom: 1px;
        border-bottom: 1px dashed #8766eb;
        color: #8766eb;
        text-decoration: none;
        white-space: nowrap;
      }
      .phab-tournament-join-card__progress {
        display: flex;
        width: 100%;
        gap: 2px;
      }
      .phab-tournament-join-card__segment {
        height: 3px;
        flex: 1 1 0;
        background: #e8e8e9;
      }
      .phab-tournament-join-card__segment:first-child {
        border-radius: 24px 0 0 24px;
      }
      .phab-tournament-join-card__segment:last-child {
        border-radius: 0 24px 24px 0;
      }
      .phab-tournament-join-card__segment.is-filled {
        background: #8766eb;
      }
      .phab-tournament-join-card__capacity-texts {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 8px;
        color: #1f1e20;
      }
      .phab-tournament-join-card__capacity-texts span:first-child {
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .phab-tournament-join-card__capacity-texts span:last-child {
        font-size: 10px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
      }
      .phab-tournament-join-card__cta {
        appearance: none;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 32px;
        padding: 10px 24px 10px 20px;
        border-radius: 24px;
        background: #8766eb;
        color: #fafafa;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
        letter-spacing: 0.02em;
        text-decoration: none;
      }
      .phab-tournament-join-card__phone {
        display: grid;
        gap: 2px;
        margin: 2px 0 10px;
      }
      .phab-tournament-join-card__phone-label {
        font-size: 10px;
        line-height: 1.2;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #8d8a95;
      }
      .phab-tournament-join-card__phone-value {
        font-size: 14px;
        line-height: 1.3;
        font-weight: 600;
        color: #1f1e20;
      }
      .phab-tournament-join-card__form {
        display: grid;
        width: 100%;
        gap: 10px;
        margin: 2px 0 10px;
      }
      .phab-tournament-join-card__field {
        display: grid;
        gap: 4px;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #8d8a95;
      }
      .phab-tournament-join-card__field input,
      .phab-tournament-join-card__field select {
        width: 100%;
        min-height: 36px;
        border: 1px solid #d9d5e4;
        border-radius: 12px;
        padding: 8px 10px;
        font: inherit;
        font-size: 13px;
        line-height: 1.2;
        font-weight: 500;
        letter-spacing: 0;
        color: #1f1e20;
        background: #fff;
        text-transform: none;
      }
      .phab-tournament-join-card__cta--secondary {
        margin-top: 8px;
        background: #e8e8e9;
        color: #1f1e20;
      }
      .phab-tournament-join-card__footer {
        align-items: center;
        min-height: 24px;
      }
      .phab-tournament-join-card__footer-metrics {
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 12px;
        line-height: 1;
        font-weight: 500;
      }
      .phab-tournament-join-card__footer-metrics .is-accent {
        color: #8766eb;
      }
      .phab-tournament-join-card__duration {
        margin-left: auto;
        color: #b4b4b4;
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
      }
      .join-panel {
        margin-top: 18px;
      }
    `;
  }

  private renderJoinTournamentCardProgress(tournament: TournamentPublicView): string {
    const maxPlayers = Math.max(1, Math.round(Number(tournament.maxPlayers) || 1));
    const participantsCount = Math.max(0, Math.round(Number(tournament.participantsCount) || 0));
    const filled = Math.min(maxPlayers, participantsCount);
    return Array.from({ length: maxPlayers }, (_item, index) =>
      `<span class="phab-tournament-join-card__segment${index < filled ? ' is-filled' : ''}"></span>`
    ).join('');
  }

  private renderOutcomeHtml(
    tournament: TournamentPublicView,
    outcome: TournamentRegistrationResponse,
    client: TournamentPublicClientProfile,
    request: Request,
    user?: RequestUser
  ): string {
    const absoluteDirectoryUrl = this.toAbsoluteUrl(this.directoryUrl, request, user);
    const absoluteJoinUrl = this.toAbsoluteUrl(tournament.joinUrl, request, user);
    const success =
      outcome.code === 'REGISTERED'
      || outcome.code === 'WAITLISTED'
      || outcome.code === 'ALREADY_REGISTERED'
      || outcome.code === 'ALREADY_WAITLISTED';

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(tournament.name)} - Статус заявки</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at 12% 18%, rgba(194, 243, 214, 0.82), transparent 28%),
          radial-gradient(circle at 82% 14%, rgba(255, 210, 166, 0.74), transparent 30%),
          linear-gradient(150deg, #f7f4ea 0%, #fffdf7 38%, #eef7ff 100%);
        color: #1f2c21;
        padding: 18px;
      }
      .page { max-width: 680px; margin: 0 auto; }
      .card {
        background: rgba(255, 255, 255, 0.9);
        border-radius: 28px;
        padding: 24px;
        border: 1px solid rgba(31, 44, 33, 0.08);
        box-shadow: 0 24px 60px rgba(31, 44, 33, 0.1);
      }
      .title {
        margin: 0 0 10px;
        font-size: clamp(28px, 5vw, 42px);
        line-height: 1;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0 0 18px;
        color: rgba(31, 44, 33, 0.7);
        line-height: 1.5;
      }
      .status {
        margin-bottom: 18px;
        padding: 16px 18px;
        border-radius: 20px;
        background: ${success ? 'rgba(228, 250, 236, 0.92)' : 'rgba(255, 242, 225, 0.96)'};
        border: 1px solid ${success ? 'rgba(31, 153, 90, 0.18)' : 'rgba(222, 145, 34, 0.2)'};
        line-height: 1.5;
      }
      .meta {
        display: grid;
        gap: 10px;
        margin-bottom: 18px;
      }
      .row {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(247, 244, 234, 0.9);
      }
      .label {
        display: block;
        margin-bottom: 5px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(31, 44, 33, 0.52);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button, .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border: none;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
      }
      .button {
        background: linear-gradient(90deg, #f45f34 0%, #f5974c 100%);
        color: #fff;
      }
      .button-secondary {
        background: rgba(31, 44, 33, 0.08);
        color: #1f2c21;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1 class="title">${this.escapeHtml(tournament.skin.title || tournament.name)}</h1>
        <p class="subtitle">${this.escapeHtml(
          tournament.skin.subtitle
          || [this.formatTournamentDate(tournament.startsAt), tournament.studioName]
            .filter(Boolean)
            .join(' · ')
        )}</p>
        <div class="status">${this.escapeHtml(outcome.message)}</div>
        <div class="meta">
          <div class="row">
            <span class="label">Турнир</span>
            ${this.escapeHtml(tournament.name)}
          </div>
          <div class="row">
            <span class="label">Телефон</span>
            ${this.escapeHtml(this.formatPhone(client.phone) || 'Не указан')}
          </div>
          <div class="row">
            <span class="label">Уровень</span>
            ${this.escapeHtml(this.formatLevelLabel(client.levelLabel) || 'Не указан')}
          </div>
        </div>
        <div class="actions">
          <a class="button" href="${this.escapeHtml(absoluteDirectoryUrl)}">К списку турниров</a>
          <a class="button-secondary" href="${this.escapeHtml(absoluteJoinUrl)}">Открыть карточку заявки</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
  }

  private renderLevelOptions(selectedValue?: string): string {
    const normalizedSelected = normalizeTournamentLevelOptionToken(selectedValue);
    const options = [...TOURNAMENT_LEVEL_OPTIONS];
    if (normalizedSelected && !options.some((level) => level.value === normalizedSelected)) {
      options.unshift({
        value: normalizedSelected,
        label: this.formatLevelLabel(normalizedSelected),
        base: normalizedSelected,
        rank: -1
      });
    }
    return options.map((level) => {
      const selected = level.value === normalizedSelected ? ' selected' : '';
      return `<option value="${this.escapeHtml(level.value)}"${selected}>${this.escapeHtml(level.label)}</option>`;
    }).join('');
  }

  private formatLevelLabel(value?: string): string {
    const normalized = normalizeTournamentLevelOptionToken(value);
    if (!normalized) {
      return '';
    }

    const matched = TOURNAMENT_LEVEL_OPTIONS.find((item) => item.value === normalized);
    return matched ? matched.value : normalized;
  }

  private formatGenderLabel(value: TournamentPublicView['gender']): string {
    if (value === 'MALE') {
      return 'Мужской';
    }
    if (value === 'FEMALE') {
      return 'Женский';
    }
    return 'Микст';
  }

  private formatGenderCardLabel(value: TournamentPublicView['gender']): string {
    if (value === 'MALE') {
      return 'Мужчины';
    }
    if (value === 'FEMALE') {
      return 'Женщины';
    }
    return 'Микст';
  }

  private formatAccessLevelRange(levels: string[]): string {
    const list = this.normalizeAccessLevelTokens(levels);
    const labels = this.normalizePublicLevelLabels(list);

    if (labels.length === 0) {
      return 'без ограничений';
    }
    if (labels.length === 1) {
      return labels[0];
    }
    return labels.join('/');
  }

  private normalizePublicLevelLabels(tokens: string[]): string[] {
    const labels: string[] = [];
    const seen = new Set<string>();

    tokens.forEach((token) => {
      const label = this.formatPublicLevelLabel(token);
      if (!label || seen.has(label)) {
        return;
      }
      seen.add(label);
      labels.push(label);
    });

    return labels;
  }

  private formatPublicLevelLabel(value?: string): string {
    const normalized = normalizeTournamentLevelOptionToken(value);
    if (!normalized) {
      return '';
    }
    if (TOURNAMENT_BASE_LEVEL_OPTIONS.includes(
      normalized as (typeof TOURNAMENT_BASE_LEVEL_OPTIONS)[number]
    )) {
      return normalized;
    }

    const matched = TOURNAMENT_LEVEL_OPTIONS.find((item) => item.value === normalized);
    return matched ? matched.base : normalized;
  }

  private formatPublicAvatarLevelLabel(value?: string, fallback = ''): string {
    const normalized = normalizeTournamentLevelOptionToken(value);
    if (!normalized) {
      return fallback;
    }

    return normalized;
  }

  private isMutedPublicParticipant(participant: TournamentPublicParticipantCard): boolean {
    return participant.status === 'WAITLIST' || participant.paymentStatus === 'UNPAID';
  }

  private normalizeAccessLevelTokens(levels: string[]): string[] {
    const seen = new Set<string>();
    const tokens: string[] = [];

    (Array.isArray(levels) ? levels : []).forEach((item) => {
      const normalized = normalizeTournamentLevelOptionToken(item);
      if (!normalized) {
        return;
      }

      const expanded = TOURNAMENT_BASE_LEVEL_OPTIONS.includes(
        normalized as (typeof TOURNAMENT_BASE_LEVEL_OPTIONS)[number]
      )
        ? TOURNAMENT_LEVEL_OPTIONS
            .filter((option) => option.base === normalized)
            .map((option) => option.value)
        : [normalized];

      expanded.forEach((token) => {
        if (!TOURNAMENT_LEVEL_OPTIONS.some((option) => option.value === token) || seen.has(token)) {
          return;
        }
        seen.add(token);
        tokens.push(token);
      });
    });

    return tokens.sort((left, right) => {
      const leftRank = TOURNAMENT_LEVEL_OPTIONS.find((option) => option.value === left)?.rank ?? 0;
      const rightRank = TOURNAMENT_LEVEL_OPTIONS.find((option) => option.value === right)?.rank ?? 0;
      return leftRank - rightRank;
    });
  }

  private formatCardScheduleLabel(startsAt?: string, endsAt?: string): string {
    const start = this.parseDate(startsAt);
    const end = this.parseDate(endsAt);
    if (!start) {
      return 'Дата уточняется';
    }

    const dateLabel = start.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long'
    });
    const startTime = this.formatTime(start);

    if (end) {
      return `${dateLabel}, ${startTime}—${this.formatTime(end)}`;
    }

    return `${dateLabel}, ${startTime}`;
  }

  private formatDateBadgeDay(value?: string): string {
    const parsed = this.parseDate(value);
    return parsed ? String(parsed.getDate()) : '—';
  }

  private formatDateBadgeWeekday(value?: string): string {
    const parsed = this.parseDate(value);
    return parsed
      ? parsed.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
      : '';
  }

  private formatDurationCompact(startsAt?: string, endsAt?: string): string {
    const start = this.parseDate(startsAt);
    const end = this.parseDate(endsAt);
    if (!start || !end) {
      return '';
    }

    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes <= 0) {
      return '';
    }
    if (minutes < 60) {
      return `${minutes} мин.`;
    }

    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes > 0 ? `${hours} ч. ${restMinutes} мин.` : `${hours} ч.`;
  }

  private formatTime(value: Date): string {
    return value.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private formatTournamentDate(value?: string): string {
    const parsed = this.parseDate(value);
    if (!parsed) {
      return 'Дата уточняется';
    }

    return parsed.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private parseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveParticipantDisplayName(value: unknown): string {
    const name = this.pickString(value);
    if (!name || this.isPhoneLikeValue(name)) {
      return 'Игрок';
    }
    return name;
  }

  private resolveParticipantAvatarUrl(
    value: unknown,
    request: Request,
    user?: RequestUser
  ): string {
    const avatarUrl = this.pickString(value);
    return avatarUrl ? this.toAbsoluteUrl(avatarUrl, request, user) : '';
  }

  private resolveInitials(value: string): string {
    const words = String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) {
      return 'PH';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  private isPhoneLikeValue(value: string): boolean {
    const digits = String(value ?? '').replace(/\D+/g, '');
    return digits.length >= 10;
  }

  private buildMapUrl(location: string): string {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(location)}`;
  }

  private pluralizeSpots(count: number): string {
    const numeric = Math.max(0, Math.floor(Number(count) || 0));
    const mod10 = numeric % 10;
    const mod100 = numeric % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return `${numeric} место`;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${numeric} места`;
    }
    return `${numeric} мест`;
  }

  private formatPhone(value?: string): string {
    const digits = String(value ?? '').replace(/\D+/g, '');
    if (digits.length !== 11 || !digits.startsWith('7')) {
      return String(value ?? '').trim();
    }
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }

  private parseCsv(value?: string): string[] {
    if (!value) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
  }

  private parsePositiveInteger(value?: string): number | undefined {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return undefined;
    }
    return Math.floor(numericValue);
  }

  private normalizeRefreshMs(value?: string): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 120000;
    }
    return Math.min(900000, Math.max(30000, Math.floor(numericValue)));
  }

  private parseBoolean(value: unknown): boolean {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return (
      normalized === '1'
      || normalized === 'true'
      || normalized === 'yes'
      || normalized === 'on'
    );
  }

  private pickString(value: unknown): string | null {
    if (Array.isArray(value)) {
      return this.pickString(value[0]);
    }
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  }

  private resolveApiBasePath(request: Request): string {
    const originalPath = String(request.originalUrl ?? '').split('?')[0];
    const apiBasePath = originalPath.split('/tournaments/public')[0];
    return apiBasePath || '/api';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
