import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthService } from '../auth/auth.service';
import { RequestUser } from '../common/rbac/request-user.interface';

type ResidencyCheckPageQuery = {
  pass?: string;
  token?: string;
  stationId?: string;
};

type ResidencyStationScope = {
  /** Empty list means "all stations" (global scope). */
  allowedStationIds: string[];
  defaultStationId: string;
};

const RESIDENCY_CHECK_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' https: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

const RESIDENCY_CHECK_ENABLED_VALUES = ['1', 'true', 'yes'];
const RESIDENCY_STATION_SCOPE_PERMISSION = 'resident-services:issue';
const RESIDENCY_CHECK_CONFIG_VERSION = 'rsp1_';
const RESIDENCY_CHECK_API_BASE = '/api';
const MAX_PASS_TOKEN_LENGTH = 512;

/** Feature flag for the resident check section; disabled unless explicitly enabled. */
const isResidencyCheckEnabled = (): boolean =>
  RESIDENCY_CHECK_ENABLED_VALUES.includes(
    String(process.env.RESIDENCY_CHECK_ENABLED ?? '')
      .trim()
      .toLowerCase()
  );

/**
 * Synthetic demo data is injected only outside production; real mode is the
 * default for every other environment.
 */
const isResidencyCheckDemoMode = (): boolean =>
  String(process.env.RESIDENCY_CHECK_DEMO_MODE ?? '')
    .trim()
    .toLowerCase() === 'true' &&
  String(process.env.NODE_ENV ?? '')
    .trim()
    .toLowerCase() !== 'production';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Inline JSON is escaped so no markup can break out of the script element. */
const escapeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const normalizeStationId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const dedupeStationIds = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeStationId(value))
        .filter((value) => value.length > 0)
    )
  );

/**
 * Optional station display labels: JSON object {stationId: label}. Malformed
 * configuration must never break the page, so invalid values are ignored.
 */
const readStationLabels = (): Record<string, string> => {
  const raw = String(process.env.RESIDENCY_CHECK_STATION_LABELS ?? '').trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const stationId = normalizeStationId(key);
      const label = typeof value === 'string' ? value.trim() : '';
      if (stationId && label) {
        labels[stationId] = label;
      }
    }
    return labels;
  } catch {
    return {};
  }
};

/**
 * Standalone mobile screen for the staff resident check.
 *
 * The page never renders resident data: it only carries the opaque pass token
 * plus the verified staff station scope to the served client script. Staff
 * authorization happens here, before the browser may request any pass data.
 */
@Controller('ui')
export class ResidencyCheckPageController {
  constructor(private readonly authService: AuthService) {}

  @Get('admin/residency/check')
  async residencyCheckPage(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: ResidencyCheckPageQuery
  ): Promise<void> {
    this.applyPageHeaders(response);

    if (!isResidencyCheckEnabled()) {
      response
        .status(503)
        .send(
          this.renderStandalonePage({
            title: 'Раздел выключен',
            heading: 'Раздел выключен',
            message:
              'Проверка резидентов сейчас отключена. Обратитесь к администратору ЦУП.'
          })
        );
      return;
    }

    const authContext = await this.resolveStaffAuthContext(request);
    if (authContext.redirectToLogin) {
      response.redirect(authContext.redirectToLogin);
      return;
    }

    const passToken = this.resolvePassToken(query);
    if (!passToken) {
      response.status(400).send(
        this.renderStandalonePage({
          title: 'Ссылка неполная',
          heading: 'Ссылка неполная',
          message:
            'В ссылке нет идентификатора пропуска. Откройте экран по QR-коду или ссылке из ЦУП.'
        })
      );
      return;
    }

    const stationScope = this.resolveStationScope(authContext.user, query);
    const permissions = Array.isArray(authContext.user?.permissions)
      ? authContext.user.permissions.filter(
          (permission): permission is string => typeof permission === 'string'
        )
      : [];
    response.send(this.renderShell(passToken, stationScope, permissions));
  }

  /** Mirrors UiController.resolveAdminAuthContext: cookie/bearer staff session only. */
  private async resolveStaffAuthContext(
    request: Request
  ): Promise<{ user?: RequestUser; redirectToLogin?: string }> {
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
      const nextPath = encodeURIComponent(
        request.originalUrl || '/api/ui/admin/residency/check'
      );
      return { redirectToLogin: `/api/ui/admin/login?next=${nextPath}` };
    }

    return { user: resolved.user };
  }

  private resolvePassToken(query: ResidencyCheckPageQuery): string {
    const fromPass =
      typeof query?.pass === 'string' ? query.pass.trim() : '';
    const fromToken =
      typeof query?.token === 'string' ? query.token.trim() : '';
    const value = fromPass || fromToken;

    if (!value || value.length > MAX_PASS_TOKEN_LENGTH) {
      return '';
    }

    return value;
  }

  /**
   * Station context from the verified staff user:
   * - `permissionStationScopes['resident-services:issue']` when the key exists
   *   (`null` means all stations);
   * - otherwise the user's non-empty `stationIds`;
   * - otherwise all stations.
   */
  private resolveStationScope(
    user: RequestUser | undefined,
    query: ResidencyCheckPageQuery
  ): ResidencyStationScope {
    const scopes = user?.permissionStationScopes;
    const hasScopeKey = Boolean(
      scopes &&
        Object.prototype.hasOwnProperty.call(
          scopes,
          RESIDENCY_STATION_SCOPE_PERMISSION
        )
    );

    let allowedStationIds: string[] = [];
    if (hasScopeKey && scopes) {
      const scope = scopes[RESIDENCY_STATION_SCOPE_PERMISSION];
      allowedStationIds = Array.isArray(scope) ? dedupeStationIds(scope) : [];
    } else if (Array.isArray(user?.stationIds) && user.stationIds.length > 0) {
      allowedStationIds = dedupeStationIds(user.stationIds);
    }

    const requestedStationId = normalizeStationId(query?.stationId);
    const requestedAllowed =
      Boolean(requestedStationId) &&
      (allowedStationIds.length === 0 ||
        allowedStationIds.includes(requestedStationId));

    let defaultStationId = '';
    if (requestedAllowed) {
      defaultStationId = requestedStationId;
    } else if (allowedStationIds.length === 1) {
      defaultStationId = allowedStationIds[0];
    }

    return { allowedStationIds, defaultStationId };
  }

  private applyPageHeaders(response: Response): void {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Vary', 'Cookie, Authorization');
    response.setHeader('Content-Security-Policy', RESIDENCY_CHECK_PAGE_CSP);
  }

  private renderShell(
    passToken: string,
    stationScope: ResidencyStationScope,
    permissions: string[]
  ): string {
    const config: Record<string, unknown> = {
      passToken,
      version: RESIDENCY_CHECK_CONFIG_VERSION,
      enabled: true,
      allowedStationIds: stationScope.allowedStationIds,
      defaultStationId: stationScope.defaultStationId,
      permissions,
      demoMode: isResidencyCheckDemoMode(),
      apiBase: RESIDENCY_CHECK_API_BASE
    };
    const stationLabels = readStationLabels();
    if (Object.keys(stationLabels).length > 0) {
      config.stationLabels = stationLabels;
    }
    const configJson = escapeJsonForHtml(config);

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#330020" />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Проверка резидента — ЦУП Дворотека</title>
    <link rel="stylesheet" href="/api/client-script/residency-check.css" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background: #f4eef3;
        color: #330020;
        -webkit-text-size-adjust: 100%;
      }
      .phab-rc-noscript {
        max-width: 520px;
        margin: 0 auto;
        padding: 24px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="phab-residency-check-root">
      <div class="phab-rc-boot" role="status" aria-live="polite">Загружаем данные пропуска…</div>
    </div>
    <noscript>
      <div class="phab-rc-noscript">
        <h1>Нужен JavaScript</h1>
        <p>Для проверки резидента включите JavaScript в браузере и откройте ссылку ещё раз.</p>
      </div>
    </noscript>
    <script>
      window.__PHAB_RESIDENCY_CHECK_CONFIG__ = ${configJson};
    </script>
    <script src="/api/client-script/residency-check.js"></script>
  </body>
</html>`;
  }

  /**
   * Standalone notice page (disabled feature / incomplete link). It has no
   * client-script, no config and never contains resident data.
   */
  private renderStandalonePage(options: {
    title: string;
    heading: string;
    message: string;
  }): string {
    const title = escapeHtml(options.title);
    const heading = escapeHtml(options.heading);
    const message = escapeHtml(options.message);

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#330020" />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background: #f4eef3;
        color: #330020;
        -webkit-text-size-adjust: 100%;
      }
      .phab-rc-standalone {
        max-width: 520px;
        margin: 0 auto;
        padding: 32px 16px calc(32px + env(safe-area-inset-bottom));
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 16px;
        line-height: 1.45;
      }
      .phab-rc-standalone-title {
        margin: 0 0 12px;
        font-size: 26px;
        line-height: 1.15;
      }
      .phab-rc-standalone-text {
        margin: 0;
        color: #4a2a3f;
      }
    </style>
  </head>
  <body>
    <main class="phab-rc-standalone">
      <h1 class="phab-rc-standalone-title">${heading}</h1>
      <p class="phab-rc-standalone-text">${message}</p>
    </main>
  </body>
</html>`;
  }
}

/**
 * Serves the isolated residency-check assets. Kept in the same file (and a
 * separate controller class) so the module wiring is one import.
 */
@Controller('client-script')
export class ResidencyCheckAssetController {
  @Get('residency-check.js')
  streamResidencyCheckScript(@Res() response: Response): void {
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(this.resolveClientSdkFile('phab-residency-check.js'));
  }

  @Get('residency-check.css')
  streamResidencyCheckStyles(@Res() response: Response): void {
    response.setHeader('Content-Type', 'text/css; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(this.resolveClientSdkFile('phab-residency-check.css'));
  }

  private resolveClientSdkFile(fileName: string): string {
    const candidates = [
      resolve(process.cwd(), 'client-sdk', fileName),
      resolve(process.cwd(), 'dist', 'client-sdk', fileName)
    ];

    const found = candidates.find((candidate) => existsSync(candidate));
    return found ?? candidates[0];
  }
}
