import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthService } from '../auth/auth.service';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';

type AdminUiQuery = {
  apiBaseUrl?: string;
  notificationApiBaseUrl?: string;
  notificationTenantKey?: string;
  userId?: string;
  roles?: string;
  stationIds?: string;
  connectorRoutes?: string;
  title?: string;
  pollIntervalMs?: string;
  authToken?: string;
};

type AdminLoginQuery = {
  next?: string;
};

const parseCsv = (raw?: string): string[] => {
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    )
  );
};

const asRoleList = (rawRoles: string[]): Role[] => {
  const known = new Set<string>(Object.values(Role));
  const aliases: Record<string, Role> = {
    ADMIN: Role.STATION_ADMIN,
    ADMINISTRATOR: Role.STATION_ADMIN,
    STATIONADMIN: Role.STATION_ADMIN,
    STATIONADMINISTRATOR: Role.STATION_ADMIN,
    ADMINSTATION: Role.STATION_ADMIN,
    SUPERADMIN: Role.SUPER_ADMIN,
    TOURNAMENTMANAGER: Role.TOURNAMENT_MANAGER,
    GAMEMANAGER: Role.GAME_MANAGER,
    OPERATIONSMANAGER: Role.MANAGER
  };
  return rawRoles
    .map((role) => role.trim().toUpperCase().replace(/[\s-]+/g, '_'))
    .map((role) => {
      if (known.has(role)) {
        return role as Role;
      }
      return aliases[role.replace(/_/g, '')] ?? aliases[role];
    })
    .filter((role): role is Role => Boolean(role));
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

@Controller('ui')
export class UiController {
  constructor(private readonly authService: AuthService) {}

  @Get('favicon.svg')
  faviconSvg(@Res() response: Response): void {
    response.sendFile(this.resolveBrandingAssetPath('dvoroteka-favicon.svg'));
  }

  @Get('favicon-192.png')
  favicon192(@Res() response: Response): void {
    response.sendFile(this.resolveBrandingAssetPath('favicon-192.png'));
  }

  @Get('favicon-512.png')
  favicon512(@Res() response: Response): void {
    response.sendFile(this.resolveBrandingAssetPath('favicon-512.png'));
  }

  @Get('apple-touch-icon.png')
  appleTouchIcon(@Res() response: Response): void {
    response.sendFile(this.resolveBrandingAssetPath('apple-touch-icon.png'));
  }

  @Get('tournament-sleeve.png')
  tournamentSleeve(@Res() response: Response): void {
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.sendFile(this.resolveBrandingAssetPath('tournament-sleeve.png'));
  }

  @Get('site.webmanifest')
  siteManifest(@Res() response: Response): void {
    response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    response.send(
      JSON.stringify(
        {
          id: '/api/ui/admin',
          name: 'ЦУП Дворотека',
          short_name: 'Дворотека',
          description: 'Центр управления пространством Дворотеки',
          lang: 'ru',
          dir: 'ltr',
          start_url: '/api/ui/admin',
          scope: '/api/ui/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#ffffff',
          theme_color: '#330020',
          icons: [
            {
              src: '/api/ui/favicon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/api/ui/favicon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            }
          ]
        },
        null,
        2
      )
    );
  }

  @Get('admin/login')
  adminLogin(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: AdminLoginQuery
  ): void {
    if (!this.authService.isEnabled()) {
      response.redirect('/api/ui/admin');
      return;
    }

    const nextPath = this.normalizeNextPath(query.next);
    const nextPathJson = JSON.stringify(nextPath).replace(/</g, '\\u003c');

    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ЦУП Дворотека - Вход</title>
    ${this.renderBrandMetaTags()}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Unbounded:wght@500;700;800&display=swap');
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; min-height: 100%; }
      body {
        font-family: "TT Neoris Trial Variable", "Manrope", "Helvetica Neue", sans-serif;
        background:
          radial-gradient(circle at 85% -10%, #ddc8fc 0, transparent 38%),
          radial-gradient(circle at -5% 108%, #b6fdff 0, transparent 32%),
          linear-gradient(122deg, #cfffb6 0%, #ffe891 100%);
        color: #330020;
      }
      .page { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
      .card {
        width: 100%;
        max-width: 430px;
        background: rgba(255,255,255,.92);
        border: 2px solid rgba(51,0,32,.18);
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 24px 48px rgba(51,0,32,.2);
        backdrop-filter: blur(2px);
      }
      .title {
        margin: 0 0 7px;
        font-size: 22px;
        color: #330020;
        font-family: "Druk Wide", "Unbounded", "Arial Black", sans-serif;
        letter-spacing: .02em;
        text-transform: uppercase;
      }
      .meta { margin: 0 0 15px; font-size: 13px; color: rgba(51,0,32,.78); }
      .label {
        display: block;
        margin: 0 0 6px;
        font-size: 10px;
        color: rgba(51,0,32,.82);
        font-weight: 800;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .input {
        width: 100%;
        border: 1px solid rgba(51,0,32,.22);
        border-radius: 11px;
        padding: 10px 11px;
        font-size: 14px;
        margin-bottom: 12px;
        background: #fff;
        color: #330020;
      }
      .input:focus {
        outline: none;
        border-color: rgba(0,58,134,.52);
        box-shadow: 0 0 0 3px rgba(182,253,255,.55);
      }
      .btn {
        width: 100%;
        border: none;
        background: linear-gradient(90deg, #ff464e 0%, #ff7158 100%);
        color: #fff;
        font-size: 13px;
        font-weight: 800;
        border-radius: 11px;
        padding: 11px 12px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .btn:disabled { opacity: .65; cursor: default; }
      .status { margin-top: 10px; font-size: 12px; color: rgba(51,0,32,.74); min-height: 16px; }
      .status-error { color: #9f1735; }
      .foot { margin-top: 12px; font-size: 11px; color: rgba(51,0,32,.6); }
      code { background: rgba(221,200,252,.46); border-radius: 6px; padding: 1px 5px; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1 class="title">ЦУП Дворотеки</h1>
        <p class="meta">Вход в центр управления пространством.</p>

        <label class="label" for="login">Логин</label>
        <input id="login" class="input" type="text" autocomplete="username" maxlength="120" />

        <label class="label" for="password">Пароль</label>
        <input id="password" class="input" type="password" autocomplete="current-password" maxlength="200" />

        <button id="submit" class="btn" type="button">Войти</button>
        <div id="status" class="status"></div>

        <div class="foot">После входа откроется: <code>${escapeHtml(nextPath)}</code></div>
      </section>
    </main>

    <script>
      (function () {
        var nextPath = ${nextPathJson};
        var loginEl = document.getElementById('login');
        var passwordEl = document.getElementById('password');
        var submitEl = document.getElementById('submit');
        var statusEl = document.getElementById('status');

        function setStatus(text, isError) {
          statusEl.textContent = text || '';
          statusEl.className = isError ? 'status status-error' : 'status';
        }

        async function submit() {
          var login = String(loginEl.value || '').trim();
          var password = String(passwordEl.value || '');
          if (!login || !password) {
            setStatus('Введите логин и пароль', true);
            return;
          }

          submitEl.disabled = true;
          setStatus('Проверяем доступ...', false);
          try {
            var response = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ login: login, password: password })
            });

            if (!response.ok) {
              var errorText = await response.text().catch(function () { return ''; });
              throw new Error(errorText || ('HTTP ' + response.status));
            }

            try {
              window.localStorage.removeItem('phab_admin_token');
            } catch (_error) {
              // ignore localStorage errors
            }

            window.location.href = nextPath || '/api/ui/admin';
          } catch (error) {
            var message = error && error.message ? error.message : 'Ошибка авторизации';
            setStatus(message, true);
          } finally {
            submitEl.disabled = false;
          }
        }

        submitEl.addEventListener('click', submit);
        passwordEl.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
      })();
    </script>
  </body>
</html>`;

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(html);
  }

  @Get('admin')
  async adminPanel(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: AdminUiQuery
  ): Promise<void> {
    const authContext = await this.resolveAdminAuthContext(request);
    if (authContext.redirectToLogin) {
      response.redirect(authContext.redirectToLogin);
      return;
    }

    const hostUrl = `${request.protocol}://${request.get('host')}`;
    const roles = authContext.user
      ? authContext.user.roles
      : (() => {
          const fromQuery = asRoleList(parseCsv(query.roles));
          return fromQuery.length > 0 ? fromQuery : [Role.SUPER_ADMIN];
        })();
    const stationIds = authContext.user ? authContext.user.stationIds : parseCsv(query.stationIds);
    const connectorRoutes = authContext.user
      ? authContext.user.connectorRoutes
      : parseCsv(query.connectorRoutes);
    const pollIntervalMs = Number(query.pollIntervalMs);

    const authToken = String(query.authToken ?? '').trim();
    const config = {
      mountSelector: '#phab-admin-root',
      apiBaseUrl: query.apiBaseUrl?.trim() || `${hostUrl}/api`,
      userId: authContext.user?.id || query.userId?.trim() || 'local-admin',
      roles,
      roleIds: authContext.user?.roleIds || roles,
      permissions: authContext.user ? authContext.user.permissions || [] : undefined,
      stationIds,
      connectorRoutes,
      title: query.title?.trim() || 'ЦУП Дворотека',
      pollIntervalMs:
        Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 8000,
      playerRatingAdminEnabled:
        String(process.env.PLAYER_RATING_ADMIN_ENABLED ?? '').trim().toLowerCase() === 'true',
      subscriptionAdminEnabled:
        ['1', 'true', 'yes'].includes(
          String(process.env.SUBSCRIPTIONS_ADMIN_ENABLED ?? '').trim().toLowerCase()
        ),
      subscriptionTestRuntimeEnabled:
        ['1', 'true', 'yes'].includes(
          String(process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED ?? '').trim().toLowerCase()
        ),
      notificationApiBaseUrl:
        query.notificationApiBaseUrl?.trim() ||
        String(process.env.PADLHUB_NOTIFICATION_API_BASE_URL ?? '').trim() ||
        undefined,
      notificationTenantKey:
        query.notificationTenantKey?.trim() ||
        String(process.env.PADLHUB_NOTIFICATION_TENANT_KEY ?? '').trim() ||
        'local-padel',
      cookieAuthOnly: Boolean(authContext.user),
      authToken: authContext.user ? undefined : authToken || undefined
    };

    const configJson = JSON.stringify(config).replace(/</g, '\\u003c');

    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ЦУП Дворотека</title>
    ${this.renderBrandMetaTags()}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Unbounded:wght@500;700;800&display=swap');
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        overflow: hidden;
      }
      body {
        font-family: "TT Neoris Trial Variable", "Manrope", "Helvetica Neue", sans-serif;
        background:
          radial-gradient(circle at 92% -4%, #ddc8fc 0, transparent 35%),
          radial-gradient(circle at 4% 98%, #b6fdff 0, transparent 32%),
          linear-gradient(126deg, #cfffb6 0%, #ffe891 100%);
        color: #330020;
        min-height: 100dvh;
        overflow: hidden;
      }
      .page {
        height: 100dvh;
        min-height: 100dvh;
        padding: 14px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #phab-admin-root {
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      @media (max-width: 640px) {
        .page { padding: 8px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div id="phab-admin-root"></div>
    </main>

    <script>
      window.__PHAB_ADMIN_CONFIG__ = ${configJson};
    </script>
    <script src="/api/client-script/admin-panel.js"></script>
    <script src="/api/client-script/gift-certificates-admin.js"></script>
    <script>
      (function bootstrap() {
        function start() {
          if (!window.PHABAdminPanel || typeof window.PHABAdminPanel.init !== 'function') {
            setTimeout(start, 50);
            return;
          }
          window.PHABAdminPanel.init(window.__PHAB_ADMIN_CONFIG__ || {});
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', start);
        } else {
          start();
        }
      })();
    </script>
  </body>
</html>`;

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Vary', 'Cookie, Authorization');
    response.send(html);
  }

  @Get('subscription-test')
  subscriptionTest(
    @Res() response: Response
  ): void {
    const testRuntimeEnabled = ['1', 'true', 'yes'].includes(
      String(process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED ?? '').trim().toLowerCase()
    );
    if (!testRuntimeEnabled) {
      response.status(404).send('Subscription test runtime is disabled');
      return;
    }

    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Тестовая покупка подписки</title>
    ${this.renderBrandMetaTags()}
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; font-family: Inter, Arial, sans-serif; color: #330020; background: linear-gradient(135deg,#cfffb6,#ffe891); }
      main { width: min(720px, calc(100% - 24px)); margin: 0 auto; padding: 24px 0 40px; }
      .card { background: rgba(255,255,255,.94); border: 1px solid rgba(51,0,32,.16); border-radius: 20px; padding: 20px; box-shadow: 0 20px 45px rgba(51,0,32,.14); }
      h1 { margin: 0 0 8px; font: 800 clamp(22px,5vw,34px)/1.05 Inter, Arial, sans-serif; }
      .badge { display: inline-flex; margin-bottom: 16px; border-radius: 999px; padding: 7px 10px; background: #ddc8fc; font-size: 11px; font-weight: 800; }
      .warning { margin: 14px 0; border-radius: 12px; padding: 12px; background: #fff4d2; font-size: 12px; line-height: 1.45; }
      .grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin: 14px 0; }
      .metric { border-radius: 14px; padding: 12px; background: #f7f4f8; }
      .metric small { display: block; color: rgba(51,0,32,.62); }
      .metric strong { display: block; margin-top: 4px; font-size: 18px; }
      label { display: block; margin: 15px 0 6px; font-size: 12px; font-weight: 800; }
      input { width: 100%; border: 1px solid rgba(51,0,32,.22); border-radius: 12px; padding: 12px; font-size: 15px; }
      .actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 14px; }
      button { border: 0; border-radius: 12px; padding: 11px 14px; background: #330020; color: white; font-weight: 800; cursor: pointer; }
      button.secondary { background: #73536a; }
      button.danger { background: #b3263f; }
      button:disabled { opacity: .5; cursor: default; }
      #status { min-height: 20px; margin-top: 14px; font-size: 13px; white-space: pre-wrap; }
      #status.error { color: #a21531; }
      .hidden { display: none; }
      code { word-break: break-all; }
      @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } main { padding-top: 12px; } .card { padding: 16px; } }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <span class="badge">FAKE PAYMENT · TEST ONLY</span>
        <h1 id="title">Тестовая подписка</h1>
        <div class="warning">Деньги не списываются, Viva не вызывается, клиентская подписка не выпускается. Страница проверяет только тестовый snapshot, резерв, лимиты партии и состояния fake-оплаты.</div>
        <div id="offer" class="grid"></div>
        <label for="clientRef">Synthetic tester</label>
        <input id="clientRef" value="synthetic:+79104303190" maxlength="120" autocomplete="off" />
        <div class="actions">
          <button id="reserve" type="button">Зарезервировать и начать покупку</button>
        </div>
        <div id="purchase" class="hidden">
          <div id="purchaseMeta" class="warning"></div>
          <div class="actions">
            <button id="paid" type="button">Fake PAID</button>
            <button id="pending" class="secondary" type="button">Оставить PENDING</button>
            <button id="failed" class="danger" type="button">Fake FAILED</button>
          </div>
        </div>
        <div id="status" role="status" aria-live="polite"></div>
      </section>
    </main>
    <script>
      (function () {
        var fragment = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
        var offerId = String(fragment.get('offerId') || '').trim();
        var token = String(fragment.get('token') || '').trim();
        var offer = null;
        var purchase = null;
        var reserveIntent = null;
        var reserveIntentClientRef = '';
        var confirmIntents = Object.create(null);
        var statusEl = document.getElementById('status');
        var reserveBtn = document.getElementById('reserve');
        var purchaseWrap = document.getElementById('purchase');
        var purchaseMeta = document.getElementById('purchaseMeta');

        function text(value) { return value == null ? '' : String(value); }
        function escape(value) { return text(value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
        function money(value) { return new Intl.NumberFormat('ru-RU').format(Math.max(0, Number(value) || 0) / 100) + ' ₽'; }
        function id() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2); }
        function commandHeaders(prefix, existing) {
          if (existing) return existing;
          var value = id();
          return { 'Content-Type': 'application/json', 'X-Subscription-Test-Token': token, 'Idempotency-Key': prefix + '-' + value, 'X-Correlation-Id': 'test-' + value };
        }
        function setStatus(value, error) { statusEl.textContent = value || ''; statusEl.className = error ? 'error' : ''; }
        async function request(path, options) {
          var response = await fetch(path, options || {});
          var body = await response.json().catch(function () { return null; });
          if (!response.ok) throw new Error((body && body.error && body.error.message) || (body && body.message) || ('HTTP ' + response.status));
          return body;
        }
        function phaseOf(value) { return value.currentPhase || (value.inventory && value.inventory.currentPhase) || null; }
        function renderOffer(value) {
          offer = value;
          var phase = phaseOf(value) || {};
          var price = phase.price || value.price || {};
          document.getElementById('title').textContent = text(value.title || value.subscriptionTitle || 'Тестовая подписка');
          document.getElementById('offer').innerHTML =
            '<div class="metric"><small>Станция</small><strong>' + escape(value.stationId || '—') + '</strong></div>' +
            '<div class="metric"><small>Текущая цена</small><strong>' + money(price.amountMinor) + '</strong></div>' +
            '<div class="metric"><small>Фаза</small><strong>' + escape(phase.order || '—') + '</strong></div>' +
            '<div class="metric"><small>Доступно / резерв / продано</small><strong>' + escape(phase.available || 0) + ' / ' + escape(phase.reserved || 0) + ' / ' + escape(phase.sold || 0) + '</strong></div>';
        }
        async function loadOffer() {
          if (!offerId || !token) throw new Error('В ссылке отсутствует offerId или test token');
          renderOffer(await request('/api/v1/subscription-test/offers/' + encodeURIComponent(offerId), {
            headers: { 'X-Subscription-Test-Token': token }
          }));
        }
        reserveBtn.addEventListener('click', async function () {
          reserveBtn.disabled = true;
          setStatus('Создаём атомарный тестовый резерв…', false);
          try {
            var clientRef = document.getElementById('clientRef').value;
            if (!reserveIntent || reserveIntentClientRef !== clientRef) {
              reserveIntent = commandHeaders('test-reserve', null);
              reserveIntentClientRef = clientRef;
            }
            purchase = await request('/api/v1/subscription-test/offers/' + encodeURIComponent(offerId) + '/reservations', {
              method: 'POST',
              headers: reserveIntent,
              body: JSON.stringify({ clientRef: clientRef })
            });
            purchaseWrap.classList.remove('hidden');
            purchaseMeta.textContent = 'purchaseId: ' + text(purchase.purchaseId) + '\\nstatus: ' + text(purchase.status) + '\\nцена snapshot: ' + money((purchase.priceSnapshot || {}).amountMinor) + '\\nрезерв до: ' + text(purchase.expiresAt);
            setStatus('Резерв создан. Выберите fake-результат оплаты.', false);
            await loadOffer();
          } catch (error) { setStatus(error.message || String(error), true); }
          finally { reserveBtn.disabled = false; }
        });
        async function confirm(outcome) {
          if (!purchase || !purchase.purchaseId) return;
          setStatus('Применяем fake ' + outcome + '…', false);
          try {
            confirmIntents[outcome] = commandHeaders('test-confirm', confirmIntents[outcome]);
            purchase = await request('/api/v1/subscription-test/purchases/' + encodeURIComponent(purchase.purchaseId) + '/fake-confirm', {
              method: 'POST', headers: confirmIntents[outcome],
              body: JSON.stringify({ outcome: outcome })
            });
            purchaseMeta.textContent = 'purchaseId: ' + text(purchase.purchaseId) + '\\nstatus: ' + text(purchase.status) + '\\nцена snapshot: ' + money((purchase.priceSnapshot || {}).amountMinor) + '\\nрезерв до: ' + text(purchase.expiresAt);
            setStatus('Fake-статус: ' + text(purchase.status), false);
            await loadOffer();
          } catch (error) { setStatus(error.message || String(error), true); }
        }
        document.getElementById('paid').addEventListener('click', function () { void confirm('PAID'); });
        document.getElementById('pending').addEventListener('click', function () { void confirm('PENDING'); });
        document.getElementById('failed').addEventListener('click', function () { void confirm('FAILED'); });
        loadOffer().catch(function (error) { setStatus(error.message || String(error), true); reserveBtn.disabled = true; });
      })();
    </script>
  </body>
</html>`;

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    response.send(html);
  }

  @Get('americano-lab')
  async americanoLab(@Req() request: Request, @Res() response: Response): Promise<void> {
    const authContext = await this.resolveAdminAuthContext(request);
    if (authContext.redirectToLogin) {
      response.redirect(authContext.redirectToLogin);
      return;
    }

    response.sendFile(resolve(process.cwd(), 'docs', 'americano-lab.html'));
  }

  @Get('tournaments-dev')
  tournamentsDev(@Res() response: Response): void {
    response.sendFile(resolve(process.cwd(), 'docs', 'tournaments-dev.html'));
  }

  @Get('tournaments-tilda-code')
  tournamentsTildaCode(@Res() response: Response): void {
    const filePath = resolve(process.cwd(), 'docs', 'tilda-tournaments-block.html');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.send(readFileSync(filePath, 'utf8'));
  }

  private async resolveAdminAuthContext(request: Request): Promise<{
    user?: RequestUser;
    redirectToLogin?: string;
  }> {
    if (!this.authService.isEnabled()) {
      return {};
    }

    const resolved = await this.authService.resolveUserFromRequest(request, {
      allowHeaderFallback: false
    });

    if (
      resolved.source !== 'token' ||
      !resolved.user ||
      !this.authService.hasStaffAccess(resolved.user)
    ) {
      const nextPath = encodeURIComponent(request.originalUrl || '/api/ui/admin');
      return { redirectToLogin: `/api/ui/admin/login?next=${nextPath}` };
    }

    return { user: resolved.user };
  }

  private normalizeNextPath(next?: string): string {
    const value = String(next ?? '').trim();
    if (!value) {
      return '/api/ui/admin';
    }
    if (!value.startsWith('/')) {
      return '/api/ui/admin';
    }
    if (value.startsWith('//')) {
      return '/api/ui/admin';
    }
    if (!value.startsWith('/api/ui/')) {
      return '/api/ui/admin';
    }
    return value;
  }

  private renderBrandMetaTags(): string {
    return [
      '<meta name="application-name" content="Дворотека" />',
      '<meta name="theme-color" content="#330020" />',
      '<meta name="mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-title" content="Дворотека" />',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
      '<link rel="icon" type="image/svg+xml" href="/api/ui/favicon.svg" />',
      '<link rel="icon" type="image/png" sizes="192x192" href="/api/ui/favicon-192.png" />',
      '<link rel="apple-touch-icon" sizes="180x180" href="/api/ui/apple-touch-icon.png" />',
      '<link rel="manifest" href="/api/ui/site.webmanifest" />'
    ].join('\n    ');
  }

  private resolveBrandingAssetPath(fileName: string): string {
    const candidates = [
      resolve(process.cwd(), 'client-sdk', 'branding', fileName),
      resolve(process.cwd(), 'dist', 'client-sdk', 'branding', fileName)
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }
}
