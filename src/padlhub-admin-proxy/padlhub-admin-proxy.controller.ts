import {
  BadGatewayException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { PadlhubAdminProxyService, type ForwardResponse } from './padlhub-admin-proxy.service';

/**
 * The ЦУП side of the notification and station-card blocks.
 *
 * Before this module the browser called the PadlHub admin API directly and therefore needed its own
 * short-lived `phub-admin` token — an extra operator login inside ЦУП. Now the browser calls these
 * routes with the ordinary ЦУП session, and the ЦУП attaches the narrow server-side delegation
 * credential instead. The route list is the allowlist: nothing outside «Уведомления» and «Станции»
 * is forwarded.
 */
// Notification campaigns and the public station catalog are console-wide surfaces, and sending pushes
// is a critical action: the bridge stays least-privilege at SUPER_ADMIN until the owner decides which
// narrower ЦУП roles may use it.
@Controller('ui/padlhub-admin/:tenantKey')
@Roles(Role.SUPER_ADMIN)
export class PadlhubAdminProxyController {
  constructor(private readonly proxy: PadlhubAdminProxyService) {}

  @Get('session')
  async session(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    this.assertAvailable(tenantKey);
    // Ask LK2 itself: a switched-off contour, a rotated secret or a tenant missing from its allowlist
    // must surface here instead of on the operator's first campaign.
    const forwarded = await this.send({ method: 'GET', path: '/notifications/capabilities' });
    if (forwarded.status !== 200) {
      writeResponse(response, forwarded);
      return;
    }
    response.status(200).json({ ok: true });
  }

  @Get('notifications/capabilities')
  capabilities(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/capabilities', 'GET');
  }

  @Get('notifications/web-push-subscribers')
  subscribers(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/web-push-subscribers', 'GET', false, [
      'limit',
      'cursor'
    ]);
  }

  @Get('notifications/delivery-stats')
  deliveryStats(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/delivery-stats', 'GET', false, [
      'days'
    ]);
  }

  @Post('notifications/recipients/resolve')
  resolveRecipients(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/recipients/resolve', 'POST');
  }

  @Post('notifications/campaigns')
  createCampaign(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/campaigns', 'POST', true);
  }

  @Get('notifications/scenarios')
  listScenarios(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/scenarios', 'GET');
  }

  @Get('notifications/scenarios/runs')
  listScenarioRuns(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/scenarios/runs', 'GET');
  }

  @Post('notifications/scenarios')
  createScenario(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/scenarios', 'POST', true);
  }

  @Put('notifications/scenarios/:scenarioId')
  updateScenario(
    @Param('tenantKey') tenantKey: string,
    @Param('scenarioId') scenarioId: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(
      request,
      response,
      tenantKey,
      `/notifications/scenarios/${encodeURIComponent(scenarioId)}`,
      'PUT',
      true
    );
  }

  @Get('locations')
  listLocations(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/locations', 'GET');
  }

  @Get('locations/:locationId')
  getLocation(
    @Param('tenantKey') tenantKey: string,
    @Param('locationId') locationId: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(
      request,
      response,
      tenantKey,
      `/locations/${encodeURIComponent(locationId)}`,
      'GET'
    );
  }

  @Post('locations')
  createLocation(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/locations', 'POST', true);
  }

  @Patch('locations/:locationId')
  updateLocation(
    @Param('tenantKey') tenantKey: string,
    @Param('locationId') locationId: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(
      request,
      response,
      tenantKey,
      `/locations/${encodeURIComponent(locationId)}`,
      'PATCH',
      true
    );
  }

  @Post('location-media')
  async uploadLocationMedia(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('idempotency-key') idempotencyKey?: string
  ): Promise<void> {
    this.assertAvailable(tenantKey);
    // Media is a binary body the JSON parser deliberately ignores, so it is still readable as a stream.
    const body = await readRawBody(request, this.proxy.maxMediaBytes);
    const forwarded = await this.send({
      method: 'POST',
      path: '/location-media',
      search: searchOf(request, []),
      contentType: String(request.headers['content-type'] ?? 'application/octet-stream'),
      idempotencyKey,
      body,
    });
    writeResponse(response, forwarded);
  }

  private async forwardJson(
    request: Request,
    response: Response,
    tenantKey: string,
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    requiresIdempotency = false,
    query: readonly string[] = []
  ): Promise<void> {
    this.assertAvailable(tenantKey);
    const idempotencyKey = headerValue(request, 'idempotency-key');
    if (requiresIdempotency && !idempotencyKey) {
      response.status(400).json({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Для этой операции требуется корректный Idempotency-Key.'
      });
      return;
    }
    // A GET must never carry a body: express leaves `req.body = {}` on a bodyless request, and Node's
    // fetch turns "GET with body" into a TypeError that the operator sees as 502 «API недоступен».
    const carriesBody = method !== 'GET' && request.body !== undefined && request.body !== null;
    const forwarded = await this.send({
      method,
      path,
      search: searchOf(request, query),
      ...(carriesBody
        ? { contentType: 'application/json', body: Buffer.from(JSON.stringify(request.body)) }
        : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    writeResponse(response, forwarded);
  }

  private async send(input: Parameters<PadlhubAdminProxyService['forward']>[0]) {
    try {
      return await this.proxy.forward(input);
    } catch {
      throw new BadGatewayException({
        code: 'PADLHUB_ADMIN_PROXY_UNAVAILABLE',
        message: 'PadlHub Admin API недоступен. Повторите позже.',
      });
    }
  }

  private assertAvailable(tenantKey: string): void {
    if (!this.proxy.enabled) {
      throw new ServiceUnavailableException({
        code: 'PADLHUB_ADMIN_PROXY_NOT_CONFIGURED',
        message: 'PadlHub Admin API не настроен для этого ЦУП-контейнера.',
      });
    }
    if (String(tenantKey ?? '').trim() !== this.proxy.allowedTenantKey) {
      throw new NotFoundException({
        code: 'PADLHUB_ADMIN_PROXY_TENANT_UNSUPPORTED',
        message: 'Организация не обслуживается этим ЦУП-контейнером.',
      });
    }
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Only the parameters these routes actually read are forwarded: the allowlist covers paths, so a
// browser-chosen query string must not become a side channel to another upstream filter.
function searchOf(request: Request, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) return undefined;
  const url = String(request.originalUrl ?? request.url ?? '');
  const index = url.indexOf('?');
  if (index < 0) return undefined;
  const incoming = new URLSearchParams(url.slice(index + 1));
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    for (const value of incoming.getAll(key)) forwarded.append(key, value);
  }
  const search = forwarded.toString();
  return search.length > 0 ? `?${search}` : undefined;
}

async function readRawBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLargeException({
      code: 'PADLHUB_ADMIN_PROXY_MEDIA_TOO_LARGE',
      message: 'Файл слишком большой для загрузки через ЦУП.'
    });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += part.length;
    if (total > maxBytes) {
      throw new PayloadTooLargeException({
        code: 'PADLHUB_ADMIN_PROXY_MEDIA_TOO_LARGE',
        message: 'Файл слишком большой для загрузки через ЦУП.'
      });
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function writeResponse(response: Response, forwarded: ForwardResponse): void {
  response.status(forwarded.status);
  response.setHeader('Content-Type', forwarded.contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Correlation-ID', forwarded.correlationId);
  response.send(forwarded.body);
}
