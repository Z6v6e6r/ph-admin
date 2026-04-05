import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CommunitiesService } from './communities.service';
import {
  CommunityPublicDirectoryResponse,
  CommunityPublicFeedResponse
} from './communities.types';

@Controller('communities/public')
export class CommunitiesPublicController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Get()
  listPublicCommunities(
    @Query('stationId') stationId?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string
  ): Promise<CommunityPublicDirectoryResponse> {
    return this.communitiesService.getPublicDirectory({
      stationIds: this.parseCsv(stationId),
      tags: this.parseCsv(tag),
      limit: this.parsePositiveInteger(limit)
    });
  }

  @Get('list')
  listPublicCommunitiesStable(
    @Query('stationId') stationId?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string
  ): Promise<CommunityPublicDirectoryResponse> {
    return this.communitiesService.getPublicDirectory({
      stationIds: this.parseCsv(stationId),
      tags: this.parseCsv(tag),
      limit: this.parsePositiveInteger(limit)
    });
  }

  @Get('showcase')
  renderPublicShowcase(
    @Req() request: Request,
    @Res() response: Response,
    @Query('stationId') stationId?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
    @Query('title') title?: string,
    @Query('subtitle') subtitle?: string,
    @Query('refreshMs') refreshMs?: string
  ): void {
    const apiBasePath = this.resolveApiBasePath(request);
    const widgetScriptUrl = `${apiBasePath}/client-script/communities-showcase.js`;
    const normalizedTitle =
      String(title ?? '').trim() || 'Сообщества PadelHub рядом с вами';
    const normalizedSubtitle =
      String(subtitle ?? '').trim()
      || 'Выбирайте подходящее сообщество и присоединяйтесь прямо с телефона.';
    const normalizedLimit = this.parsePositiveInteger(limit);
    const normalizedLimitAttr = normalizedLimit !== undefined ? String(normalizedLimit) : '';
    const normalizedRefreshMs = this.normalizeRefreshMs(refreshMs);

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
          radial-gradient(circle at 15% 18%, rgba(178, 245, 211, 0.82), transparent 30%),
          radial-gradient(circle at 84% 12%, rgba(255, 206, 151, 0.72), transparent 32%),
          linear-gradient(135deg, #f7f7ef 0%, #fffdf8 42%, #eef8ff 100%);
        color: #1f2c21;
        padding: 28px;
      }
      .page {
        max-width: 1380px;
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
        max-width: 900px;
        font-size: clamp(16px, 1.8vw, 22px);
        line-height: 1.45;
        color: rgba(31, 44, 33, 0.76);
      }
      .mount {
        min-height: 320px;
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
        <p class="eyebrow">Community Showcase</p>
        <h1 class="title">${this.escapeHtml(normalizedTitle)}</h1>
        <p class="subtitle">${this.escapeHtml(normalizedSubtitle)}</p>
      </section>
      <div
        class="mount"
        data-ph-communities-showcase
        data-api-base="${this.escapeHtml(apiBasePath)}"
        data-station-ids="${this.escapeHtml(String(stationId ?? ''))}"
        data-tags="${this.escapeHtml(String(tag ?? ''))}"
        data-limit="${this.escapeHtml(normalizedLimitAttr)}"
        data-refresh-ms="${this.escapeHtml(String(normalizedRefreshMs))}"
        data-variant="screen"
      ></div>
    </main>
    <script src="${this.escapeHtml(widgetScriptUrl)}" defer></script>
  </body>
</html>`);
  }

  @Get('feed')
  getPublicCommunityFeed(
    @Query('communityId') communityId?: string,
    @Query('limit') limit?: string
  ): Promise<CommunityPublicFeedResponse> {
    return this.communitiesService.getPublicFeed(String(communityId ?? ''), {
      limit: this.parsePositiveInteger(limit)
    });
  }

  @Get('feed/list')
  getPublicCommunityFeedStable(
    @Query('communityId') communityId?: string,
    @Query('limit') limit?: string
  ): Promise<CommunityPublicFeedResponse> {
    return this.communitiesService.getPublicFeed(String(communityId ?? ''), {
      limit: this.parsePositiveInteger(limit)
    });
  }

  @Get('feed/showcase')
  renderPublicCommunityFeedShowcase(
    @Req() request: Request,
    @Res() response: Response,
    @Query('communityId') communityId?: string,
    @Query('limit') limit?: string,
    @Query('title') title?: string,
    @Query('subtitle') subtitle?: string,
    @Query('refreshMs') refreshMs?: string
  ): void {
    const apiBasePath = this.resolveApiBasePath(request);
    const widgetScriptUrl = `${apiBasePath}/client-script/community-feed.js`;
    const normalizedTitle =
      String(title ?? '').trim() || 'Лента выбранного сообщества PadelHub';
    const normalizedSubtitle =
      String(subtitle ?? '').trim()
      || 'Отдельный экран для телевизора, ресепшена или встраивания через HTML-блок Tilda.';
    const normalizedLimit = this.parsePositiveInteger(limit);
    const normalizedLimitAttr = normalizedLimit !== undefined ? String(normalizedLimit) : '';
    const normalizedRefreshMs = this.normalizeRefreshMs(refreshMs);

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
          radial-gradient(circle at 14% 20%, rgba(195, 244, 214, 0.88), transparent 28%),
          radial-gradient(circle at 82% 14%, rgba(255, 208, 163, 0.76), transparent 30%),
          linear-gradient(150deg, #f6f4ea 0%, #fffdf7 38%, #edf6ff 100%);
        color: #1f2c21;
        padding: 28px;
      }
      .page {
        max-width: 1520px;
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
        font-size: clamp(30px, 3.6vw, 52px);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      .subtitle {
        margin: 0;
        max-width: 980px;
        font-size: clamp(16px, 1.7vw, 21px);
        line-height: 1.45;
        color: rgba(31, 44, 33, 0.76);
      }
      .mount {
        min-height: 420px;
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
        <p class="eyebrow">Community TV Feed</p>
        <h1 class="title">${this.escapeHtml(normalizedTitle)}</h1>
        <p class="subtitle">${this.escapeHtml(normalizedSubtitle)}</p>
      </section>
      <div
        class="mount"
        data-ph-community-feed
        data-api-base="${this.escapeHtml(apiBasePath)}"
        data-community-id="${this.escapeHtml(String(communityId ?? ''))}"
        data-limit="${this.escapeHtml(normalizedLimitAttr)}"
        data-refresh-ms="${this.escapeHtml(String(normalizedRefreshMs))}"
        data-variant="screen"
      ></div>
    </main>
    <script src="${this.escapeHtml(widgetScriptUrl)}" defer></script>
  </body>
</html>`);
  }

  private parseCsv(value?: string): string[] {
    return Array.from(
      new Set(
        String(value ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
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

  private resolveApiBasePath(request: Request): string {
    const originalPath = String(request.originalUrl ?? '').split('?')[0];
    const apiBasePath = originalPath.split('/communities/public')[0];
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
