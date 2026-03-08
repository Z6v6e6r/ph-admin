import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';

type AdminUiQuery = {
  apiBaseUrl?: string;
  userId?: string;
  roles?: string;
  stationIds?: string;
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
  return rawRoles
    .map((role) => role.trim().toUpperCase().replace(/[\s-]+/g, '_'))
    .filter((role): role is Role => known.has(role));
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
    <title>PH Admin Login</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; min-height: 100%; background: #f1f5f3; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
      .page { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
      .card {
        width: 100%; max-width: 420px; background: #fff; border: 1px solid #d8e4df;
        border-radius: 14px; padding: 18px; box-shadow: 0 12px 24px rgba(19,53,42,.08);
      }
      .title { margin: 0 0 6px; font-size: 20px; color: #13352a; }
      .meta { margin: 0 0 14px; font-size: 13px; color: #496b5f; }
      .label { display: block; margin: 0 0 6px; font-size: 12px; color: #25473d; font-weight: 700; }
      .input {
        width: 100%; border: 1px solid #bfd1ca; border-radius: 10px;
        padding: 10px 11px; font-size: 14px; margin-bottom: 12px;
      }
      .btn {
        width: 100%; border: none; background: #0f6049; color: #fff; font-size: 14px;
        font-weight: 700; border-radius: 10px; padding: 11px 12px; cursor: pointer;
      }
      .btn:disabled { opacity: .65; cursor: default; }
      .status { margin-top: 10px; font-size: 12px; color: #5e7c72; min-height: 16px; }
      .status-error { color: #9b2f2f; }
      .foot { margin-top: 12px; font-size: 11px; color: #5b766d; }
      code { background: #eef4f1; border-radius: 6px; padding: 1px 5px; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1 class="title">Вход в PH Admin</h1>
        <p class="meta">Введите логин и пароль администратора.</p>

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

            var data = await response.json().catch(function () { return null; });
            if (data && data.accessToken) {
              try {
                window.localStorage.setItem('phab_admin_token', data.accessToken);
              } catch (_error) {
                // ignore localStorage errors
              }
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
  adminPanel(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: AdminUiQuery
  ): void {
    const authContext = this.resolveAdminAuthContext(request);
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
    const pollIntervalMs = Number(query.pollIntervalMs);

    const authToken = String(query.authToken ?? '').trim();
    const config = {
      mountSelector: '#phab-admin-root',
      apiBaseUrl: query.apiBaseUrl?.trim() || `${hostUrl}/api`,
      userId: authContext.user?.id || query.userId?.trim() || 'local-admin',
      roles,
      stationIds,
      title: query.title?.trim() || 'PadelHub Admin',
      pollIntervalMs:
        Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 8000,
      authToken: authToken || undefined
    };

    const configJson = JSON.stringify(config).replace(/</g, '\\u003c');

    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PH Admin UI</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #f1f5f3; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
      .page {
        min-height: 100vh;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .hint {
        font-size: 13px;
        color: #345348;
      }
      #phab-admin-root {
        width: 100%;
        min-height: 760px;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="hint">
        Локальная страница панели. Настройки можно передавать query-параметрами:
        <code>roles</code>, <code>stationIds</code>, <code>userId</code>, <code>apiBaseUrl</code>.
      </div>
      <div id="phab-admin-root"></div>
    </main>

    <script>
      window.__PHAB_ADMIN_CONFIG__ = ${configJson};
    </script>
    <script src="/api/client-script/admin-panel.js"></script>
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
    response.send(html);
  }

  private resolveAdminAuthContext(request: Request): {
    user?: RequestUser;
    redirectToLogin?: string;
  } {
    if (!this.authService.isEnabled()) {
      return {};
    }

    const resolved = this.authService.resolveUserFromRequest(request, {
      allowHeaderFallback: false
    });

    if (
      resolved.source !== 'token' ||
      !resolved.user ||
      !this.authService.hasStaffRole(resolved.user.roles)
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
    if (!value.startsWith('/api/ui/admin')) {
      return '/api/ui/admin';
    }
    return value;
  }
}
