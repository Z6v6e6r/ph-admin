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
const TOURNAMENT_LEVEL_OPTIONS = Array.from(
  { length: TOURNAMENT_BASE_LEVEL_OPTIONS.length * TOURNAMENT_LEVEL_DIVISION_COUNT + 1 },
  (_value, index) => {
    const score = 1 + index / TOURNAMENT_LEVEL_DIVISION_COUNT;
    const base = resolveTournamentLevelBaseByScore(score);
    return {
      value: formatTournamentLevelScoreToken(score),
      label: `${base} · ${formatTournamentLevelScoreLabel(score)}`
    };
  }
);

function formatTournamentLevelScoreToken(value: number): string {
  const normalized =
    Math.round(Number(value ?? 0) * TOURNAMENT_LEVEL_DIVISION_COUNT)
    / TOURNAMENT_LEVEL_DIVISION_COUNT;
  if (Math.abs(normalized - Math.round(normalized)) < 0.0001) {
    return String(Math.round(normalized));
  }
  return normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTournamentLevelScoreLabel(value: number): string {
  return formatTournamentLevelScoreToken(value).replace('.', ',');
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
  if (numeric < 1 || numeric > TOURNAMENT_BASE_LEVEL_OPTIONS.length + 1) {
    return normalized;
  }
  const token = formatTournamentLevelScoreToken(numeric);
  return Math.abs(Number(token) - numeric) < 0.0001 ? token : normalized;
}

function resolveTournamentLevelBaseByScore(score: number): (typeof TOURNAMENT_BASE_LEVEL_OPTIONS)[number] {
  let baseIndex = Math.ceil(score) - 2;
  if (score <= 1) {
    baseIndex = 0;
  }
  baseIndex = Math.max(0, Math.min(TOURNAMENT_BASE_LEVEL_OPTIONS.length - 1, baseIndex));
  return TOURNAMENT_BASE_LEVEL_OPTIONS[baseIndex];
}

type JoinSubmission = {
  name?: string;
  phone?: string;
  levelLabel?: string;
  notes?: string;
  selectedSubscriptionId?: string;
  selectedPurchaseOptionId?: string;
  purchaseConfirmed: boolean;
  waitlist: boolean;
  format?: string;
};

@Controller('tournaments/public')
export class TournamentsPublicController {
  private readonly directoryUrl =
    String(process.env.TOURNAMENTS_PUBLIC_DIRECTORY_URL ?? '').trim() || '/tournaments';
  private readonly lkAuthUrl =
    String(process.env.TOURNAMENTS_PUBLIC_LK_AUTH_URL ?? '').trim() || 'https://padlhub.ru/lk_new';
  private readonly lkPollMs = this.parsePositiveInteger(
    String(process.env.TOURNAMENTS_PUBLIC_LK_AUTH_POLL_MS ?? '').trim()
  ) ?? 1500;

  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly tournamentsPublicSessionService: TournamentsPublicSessionService
  ) {}

  @Get()
  listPublicTournaments(
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('includePast') includePast?: string
  ): Promise<TournamentPublicDirectoryResponse> {
    return this.tournamentsService.listPublicDirectory({
      stationIds: this.parseCsv(stationId),
      limit: this.parsePositiveInteger(limit),
      includePast: this.parseBoolean(includePast)
    });
  }

  @Get('list')
  listPublicTournamentsStable(
    @Query('stationId') stationId?: string,
    @Query('limit') limit?: string,
    @Query('includePast') includePast?: string
  ): Promise<TournamentPublicDirectoryResponse> {
    return this.tournamentsService.listPublicDirectory({
      stationIds: this.parseCsv(stationId),
      limit: this.parsePositiveInteger(limit),
      includePast: this.parseBoolean(includePast)
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
    @Query('autoAuth') autoAuth?: string
  ): Promise<void> {
    const client = this.tournamentsPublicSessionService.ensureAuthorizedClient(
      request,
      response,
      user
    );
    const flow = this.enrichJoinFlow(
      await this.tournamentsService.getPublicJoinFlow(slug, client, {
        requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
      }),
      request
    );

    if (this.wantsJson(request, format)) {
      response.json(flow);
      return;
    }

    if (flow.code === 'AUTH_REQUIRED' && this.parseBoolean(autoAuth) && flow.authUrl) {
      response.redirect(flow.authUrl);
      return;
    }

    this.sendHtml(response, this.renderJoinHtml(flow));
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
    const client = this.tournamentsPublicSessionService.rememberClient(
      request,
      response,
      currentClient,
      submission
    );
    const flow = this.enrichJoinFlow(
      await this.tournamentsService.getPublicJoinFlow(slug, client, {
        requireAuth: this.tournamentsPublicSessionService.requiresRealAuth()
      }),
      request
    );

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

      this.sendHtml(response, this.renderOutcomeHtml(flow.tournament, outcome, client));
      return;
    }

    if (
      flow.code === 'READY_TO_JOIN'
      || flow.code === 'SUBSCRIPTION_AVAILABLE'
      || (flow.code === 'PURCHASE_REQUIRED' && submission.purchaseConfirmed)
    ) {
      const outcome = await this.tournamentsService.registerPublicParticipant(slug, {
        name: client.name ?? '',
        phone: client.phone ?? '',
        levelLabel: client.levelLabel,
        notes: submission.notes,
        selectedSubscriptionId: submission.selectedSubscriptionId,
        selectedPurchaseOptionId: submission.selectedPurchaseOptionId,
        purchaseConfirmed: submission.purchaseConfirmed,
        subscriptions: client.subscriptions
      });
      if (this.wantsJson(request, submission.format)) {
        response.json(outcome);
        return;
      }

      this.sendHtml(response, this.renderOutcomeHtml(flow.tournament, outcome, client));
      return;
    }

    if (this.wantsJson(request, submission.format)) {
      response.json(flow);
      return;
    }

    this.sendHtml(response, this.renderJoinHtml(flow));
  }

  @Get(':slug')
  async findPublicBySlug(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
    @Query('format') format?: string
  ): Promise<void> {
    const tournament = await this.tournamentsService.getPublicBySlug(slug);

    if (this.wantsJson(request, format)) {
      response.json(tournament);
      return;
    }

    if (this.wantsHtml(request, format)) {
      this.sendHtml(response, this.renderPublicTournamentHtml(tournament, request));
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
    request: Request
  ): TournamentJoinFlowResponse {
    const authRequired = flow.code === 'AUTH_REQUIRED';
    const joinUrl = this.toAbsoluteUrl(flow.tournament.joinUrl, request);
    const authCheckUrl = this.appendQueryParam(joinUrl, 'format', 'json');

    return {
      ...flow,
      authRequired,
      authCheckUrl,
      authPollMs: authRequired ? this.lkPollMs : undefined,
      cabinetUrl: this.lkAuthUrl,
      authUrl: authRequired ? this.buildLkAuthUrl(joinUrl) : undefined
    };
  }

  private renderPublicTournamentHtml(
    tournament: TournamentPublicView,
    request: Request
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
    const absolutePublicUrl = this.toAbsoluteUrl(tournament.publicUrl, request);
    const absoluteJoinUrl = this.toAbsoluteUrl(tournament.joinUrl, request);
    const absoluteDirectoryUrl = this.toAbsoluteUrl(this.directoryUrl, request);
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
            this.toAbsoluteUrl(imageUrl, request)
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
              ? `url("${this.escapeHtml(this.toAbsoluteUrl(imageUrl, request))}") center/cover no-repeat`
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

  private toAbsoluteUrl(value: string, request: Request): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return this.getRequestBaseUrl(request);
    }
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    return new URL(normalized, this.getRequestBaseUrl(request)).toString();
  }

  private getRequestBaseUrl(request: Request): string {
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

  private renderJoinHtml(flow: TournamentJoinFlowResponse): string {
    const tournament = flow.tournament;
    const client = flow.client;
    const needsLevel = tournament.accessLevels.length > 0;
    const phoneValue = this.escapeHtml(this.formatPhone(client.phone));
    const nameValue = this.escapeHtml(String(client.name ?? ''));
    const levelValue = String(client.levelLabel ?? '').trim().toUpperCase();
    const spotsLabel = `${tournament.participantsCount}/${tournament.maxPlayers}`;
    const actionLabel =
      flow.code === 'SUBSCRIPTION_AVAILABLE'
        ? 'Списать абонемент и записаться'
        : flow.code === 'PURCHASE_REQUIRED'
          ? 'Подтвердить покупку и записаться'
          : flow.code === 'READY_TO_JOIN'
        ? tournament.skin.ctaLabel || 'Записаться'
        : flow.code === 'LEVEL_NOT_ALLOWED'
          ? 'Проверить уровень ещё раз'
          : 'Продолжить';
    const statusTone =
      flow.code === 'LEVEL_NOT_ALLOWED'
        ? 'warning'
        : flow.code === 'READY_TO_JOIN' || flow.code === 'SUBSCRIPTION_AVAILABLE'
          ? 'success'
          : 'info';
    const selectedSubscriptionId = this.escapeHtml(flow.payment.selectedSubscription?.id || '');
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
        client
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
          <a class="button-secondary" href="${this.escapeHtml(this.directoryUrl)}">К турнирам</a>
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
      <section class="card">
        <p class="eyebrow">PadelHub Tournament Join</p>
        <h1 class="title">${this.escapeHtml(tournament.skin.title || tournament.name)}</h1>
        <p class="subtitle">${this.escapeHtml(
          tournament.skin.subtitle
          || [this.formatTournamentDate(tournament.startsAt), tournament.studioName]
            .filter(Boolean)
            .join(' · ')
        )}</p>

        <div class="grid">
          <div class="metric">
            <span class="metric-label">Когда</span>
            <span class="metric-value">${this.escapeHtml(
              this.formatTournamentDate(tournament.startsAt)
            )}</span>
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
            <span class="metric-label">Места</span>
            <span class="metric-value">${this.escapeHtml(spotsLabel)}</span>
          </div>
        </div>

        <ul class="chips">
          <li class="chip">${this.escapeHtml(tournament.tournamentType)}</li>
          <li class="chip">${this.escapeHtml(
            needsLevel ? `Уровни: ${tournament.accessLevels.join(', ')}` : 'Без ограничений по уровню'
          )}</li>
          <li class="chip">${tournament.registrationOpen ? 'Регистрация открыта' : 'Регистрация закрыта'}</li>
        </ul>

        <div class="status status-${statusTone}">${this.escapeHtml(flow.message)}</div>

        ${
          flow.payment.required
            ? `<div class="metric" style="margin-bottom:18px;">
          <span class="metric-label">Оплата участия</span>
          <span class="metric-value">${this.escapeHtml(flow.payment.message)}</span>
          ${
            flow.payment.availableSubscriptions.length > 0
              ? `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
            ${flow.payment.availableSubscriptions
              .map(
                (item) =>
                  `<span class="chip">${this.escapeHtml(item.label)}${
                    typeof item.remainingUses === 'number'
                      ? ` · ${this.escapeHtml(String(item.remainingUses))} спис.`
                      : ''
                  }</span>`
              )
              .join('')}
          </div>`
              : ''
          }
          ${
            flow.payment.purchaseOptions.length > 0
              ? `<div style="margin-top:10px; display:grid; gap:8px;">
            ${flow.payment.purchaseOptions
              .map(
                (item) =>
                  `<div class="row"><strong>${this.escapeHtml(item.label)}</strong> · ${this.escapeHtml(item.priceLabel)}${
                    item.description ? `<br />${this.escapeHtml(item.description)}` : ''
                  }</div>`
              )
              .join('')}
          </div>`
              : ''
          }
        </div>`
            : ''
        }

        <form method="post" action="${this.escapeHtml(tournament.joinUrl)}">
          <label>
            Имя и фамилия
            <input
              type="text"
              name="name"
              maxlength="180"
              value="${nameValue}"
              placeholder="Как к вам обращаться"
            />
          </label>

          <label>
            Телефон
            <input
              type="tel"
              name="phone"
              maxlength="30"
              value="${phoneValue}"
              placeholder="+7 999 123-45-67"
              required
            />
          </label>

          ${
            needsLevel
              ? `<label>
            Уровень игрока
            <select name="levelLabel" required>
              <option value="">Выберите уровень</option>
              ${this.renderLevelOptions(levelValue)}
            </select>
          </label>`
              : ''
          }

          <label>
            Комментарий для организатора
            <textarea name="notes" maxlength="500" placeholder="Если нужно, расскажите о себе или оставьте заметку."></textarea>
          </label>

          ${
            flow.code === 'SUBSCRIPTION_AVAILABLE'
              ? `<input type="hidden" name="selectedSubscriptionId" value="${selectedSubscriptionId}" />`
              : ''
          }

          ${
            flow.code === 'PURCHASE_REQUIRED'
              ? `<input type="hidden" name="purchaseConfirmed" value="1" />
          ${
            flow.payment.purchaseOptions.length > 0
              ? `<label>
            Тариф покупки
            <select name="selectedPurchaseOptionId">
              ${flow.payment.purchaseOptions
                .map(
                  (item) =>
                    `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label)} · ${this.escapeHtml(item.priceLabel)}</option>`
                )
                .join('')}
            </select>
          </label>`
              : ''
          }`
              : ''
          }

          <div class="actions">
            <button class="button" type="submit">${this.escapeHtml(actionLabel)}</button>
            <a class="button-secondary" href="${this.escapeHtml(this.directoryUrl)}">К турнирам</a>
          </div>
        </form>

        ${
          flow.code === 'LEVEL_NOT_ALLOWED' && flow.waitlistAllowed
            ? `<form method="post" action="${this.escapeHtml(tournament.joinUrl)}" style="margin-top:12px;">
          <input type="hidden" name="name" value="${nameValue}" />
          <input type="hidden" name="phone" value="${phoneValue}" />
          <input type="hidden" name="levelLabel" value="${this.escapeHtml(levelValue)}" />
          <input type="hidden" name="waitlist" value="1" />
          <div class="actions">
            <button class="button-secondary" type="submit">Добавиться в лист ожидания</button>
          </div>
        </form>`
            : ''
        }

        <p class="footnote">
          Backend сохраняет черновик заявки в защищённой cookie-сессии, а авторизация пользователя проверяется
          через личный кабинет PadelHub.
        </p>
      </section>
    </main>
  </body>
</html>`;
  }

  private renderOutcomeHtml(
    tournament: TournamentPublicView,
    outcome: TournamentRegistrationResponse,
    client: TournamentPublicClientProfile
  ): string {
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
          <a class="button" href="${this.escapeHtml(this.directoryUrl)}">К списку турниров</a>
          <a class="button-secondary" href="${this.escapeHtml(tournament.joinUrl)}">Открыть карточку заявки</a>
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
        label: this.formatLevelLabel(normalizedSelected)
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
    return matched ? matched.label : normalized;
  }

  private formatGenderLabel(value: TournamentPublicView['gender']): string {
    if (value === 'MALE') {
      return 'Мужчины';
    }
    if (value === 'FEMALE') {
      return 'Женщины';
    }
    return 'М/Ж';
  }

  private formatTournamentDate(value?: string): string {
    if (!value) {
      return 'Дата уточняется';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
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
