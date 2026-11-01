import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipAdminMutationAudit } from '../common/observability/admin-audit.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { TournamentOrganizerService } from './tournament-organizer.service';

@Controller('tournaments/custom/:id/organizer')
@Permissions('tournaments:write')
export class TournamentOrganizerController {
  constructor(private readonly service: TournamentOrganizerService) {}
  @Get() @Header('Cache-Control', 'no-store') read(@Param('id') id: string, @CurrentUser() user?: RequestUser) { return this.service.read(id, user); }
  @Get('operations/:operationId') @Header('Cache-Control', 'no-store') readOperation(@Param('id') id: string, @Param('operationId') operationId: string, @CurrentUser() user?: RequestUser) {
    return this.service.readOperation(id, operationId, user);
  }
  @Post('preview') @Header('Cache-Control', 'no-store') @HttpCode(200) @SkipAdminMutationAudit()
  preview(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: RequestUser | undefined,
    @Headers('x-correlation-id') correlationId: string) { return this.service.preview(id, body, user, correlationId); }
  @Post('operations') @Header('Cache-Control', 'no-store') @HttpCode(200) @SkipAdminMutationAudit()
  command(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: RequestUser | undefined, @Headers('x-correlation-id') correlationId: string) {
    return this.service.command(id, body, key, user, correlationId);
  }
}
