import {
  BadGatewayException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { PadlhubAdminProxyService } from './padlhub-admin-proxy.service';

/**
 * The ЦУП side of the notification and station-card blocks.
 *
 * Before this module the browser called the PadlHub admin API directly and therefore needed its own
 * short-lived `phub-admin` token — an extra operator login inside ЦУП. Now the browser calls these
 * routes with the ordinary ЦУП session, and the ЦУП attaches the narrow server-side delegation
 * credential instead. The route list is the allowlist: nothing outside «Уведомления» and «Станции»
 * is forwarded.
 */
// Station cards and notification campaigns are global (not station-scoped) catalog operations, so the
// ЦУП roles that own them are the console-wide ones.
@Controller('ui/padlhub-admin/:tenantKey')
@Roles(Role.SUPER_ADMIN, Role.MANAGER)
export class PadlhubAdminProxyController {
  constructor(private readonly proxy: PadlhubAdminProxyService) {}

  @Get('session')
  async session(@Param('tenantKey') tenantKey: string): Promise<{ ok: true }> {
    this.assertAvailable(tenantKey);
    return { ok: true };
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
    return this.forwardJson(request, response, tenantKey, '/notifications/web-push-subscribers', 'GET');
  }

  @Get('notifications/delivery-stats')
  deliveryStats(
    @Param('tenantKey') tenantKey: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    return this.forwardJson(request, response, tenantKey, '/notifications/delivery-stats', 'GET');
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
    const body = await readRawBody(request);
    const forwarded = await this.send({
      method: 'POST',
      path: '/location-media',
      search: searchOf(request),
      contentType: String(request.headers['content-type'] ?? 'application/octet-stream'),
      idempotencyKey,
      correlationId: headerValue(request, 'x-correlation-id'),
      body,
    });
    writeResponse(response, forwarded.status, forwarded.contentType, forwarded.body);
  }

  private async forwardJson(
    request: Request,
    response: Response,
    tenantKey: string,
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    requiresIdempotency = false
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
    const forwarded = await this.send({
      method,
      path,
      search: searchOf(request),
      ...(request.body === undefined || request.body === null
        ? {}
        : { contentType: 'application/json', body: Buffer.from(JSON.stringify(request.body)) }),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      correlationId: headerValue(request, 'x-correlation-id'),
    });
    writeResponse(response, forwarded.status, forwarded.contentType, forwarded.body);
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

function searchOf(request: Request): string | undefined {
  const url = String(request.originalUrl ?? request.url ?? '');
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(index) : undefined;
}

async function readRawBody(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

function writeResponse(
  response: Response,
  status: number,
  contentType: string,
  body: Buffer
): void {
  response.status(status);
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.send(body);
}
