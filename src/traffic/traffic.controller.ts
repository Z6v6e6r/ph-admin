import { Body, Controller, ForbiddenException, Get, Post, Query, Req, Header } from '@nestjs/common';
import { RequestWithUser } from '../common/rbac/request-user.interface';
import { Permissions } from '../common/rbac/permissions.decorator';
import { getStationScopeForPermission, hasAdminPermission } from '../common/rbac/permissions';
import { TrafficService } from './traffic.service';

export function requireTrafficAccess(request: RequestWithUser, permission: string, mutation = false): string {
  const user = request.user;
  if (!user || request.authSource !== 'token' || !hasAdminPermission(user.permissions, permission) ||
      getStationScopeForPermission(user, permission) !== null) {
    throw new ForbiddenException('Нужны глобальные права и авторизованная сессия');
  }
  // Existing app CORS permits reflected origins. Enforce origin here for cookie sessions.
  const origin = request.headers.origin;
  const trusted = process.env.TRAFFIC_ADMIN_ORIGIN;
  const bearer = /^Bearer\s+\S+$/i.test(String(request.headers.authorization || ''));
  if ((origin && origin !== trusted) || (mutation && !bearer && (!trusted || origin !== trusted))) {
    throw new ForbiddenException('Недоверенный источник запроса');
  }
  return user.id;
}

@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Get()
  @Permissions('traffic:read')
  @Header('Cache-Control', 'private, no-store')
  overview(@Req() request: RequestWithUser, @Query('day') day: string) {
    requireTrafficAccess(request, 'traffic:read');
    return this.traffic.overview(day);
  }

  @Post('quarantine')
  @Permissions('traffic:write')
  @Header('Cache-Control', 'private, no-store')
  mutate(@Req() request: RequestWithUser, @Body() body: unknown) {
    return this.traffic.mutate(body, requireTrafficAccess(request, 'traffic:write', true));
  }
}
