import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { IngestSupportEventDto } from './dto/ingest-support-event.dto';
import { ReplySupportDialogDto } from './dto/reply-support-dialog.dto';
import { SupportService } from './support.service';
import {
  SupportConnectorRoute,
  SupportConnectorSummary,
  SupportDailyAnalytics,
  SupportDialogSummary,
  SupportIngestEventResult,
  SupportMessage,
  SupportOutboxCommand,
  SupportStationSummary
} from './support.types';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('clients/resolve')
  resolveClient(
    @Headers('x-integration-token') token?: string,
    @Query('phone') phone?: string,
    @Query('email') email?: string,
    @Query('connector') connector?: SupportConnectorRoute,
    @Query('externalUserId') externalUserId?: string,
    @Query('externalChatId') externalChatId?: string,
    @Query('username') username?: string
  ) {
    this.assertIntegrationToken(token);
    return this.supportService.resolveClient({
      phone,
      email,
      connector,
      externalUserId,
      externalChatId,
      username
    });
  }

  @Post('dialogs/events')
  ingestEvent(
    @Headers('x-integration-token') token: string | undefined,
    @Body() dto: IngestSupportEventDto
  ): SupportIngestEventResult {
    this.assertIntegrationToken(token);
    return this.supportService.ingestEvent(dto);
  }

  @Get('connectors')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listConnectors(@CurrentUser() user?: RequestUser): SupportConnectorSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.listConnectors(user);
  }

  @Get('connectors/:connector/stations')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listStationsByConnector(
    @Param('connector', new ParseEnumPipe(SupportConnectorRoute))
    connector: SupportConnectorRoute,
    @CurrentUser() user?: RequestUser
  ): SupportStationSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.listStationsByConnector(connector, user);
  }

  @Get('connectors/:connector/stations/:stationId/dialogs')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listDialogsByStation(
    @Param('connector', new ParseEnumPipe(SupportConnectorRoute))
    connector: SupportConnectorRoute,
    @Param('stationId') stationId: string,
    @CurrentUser() user?: RequestUser
  ): SupportDialogSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.listDialogsByStation(connector, stationId, user);
  }

  @Get('dialogs')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listDialogs(@CurrentUser() user?: RequestUser): SupportDialogSummary[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.listDialogs(user);
  }

  @Get('dialogs/:dialogId/messages')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  listMessages(
    @Param('dialogId') dialogId: string,
    @CurrentUser() user?: RequestUser
  ): SupportMessage[] {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.listMessages(dialogId, user);
  }

  @Post('dialogs/:dialogId/reply')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER
  )
  replyToDialog(
    @Param('dialogId') dialogId: string,
    @Body() dto: ReplySupportDialogDto,
    @CurrentUser() user?: RequestUser
  ) {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.replyToDialog(dialogId, dto, user);
  }

  @Get('analytics/daily')
  @Roles(
    Role.SUPER_ADMIN,
    Role.SUPPORT,
    Role.STATION_ADMIN,
    Role.MANAGER,
    Role.TOURNAMENT_MANAGER,
    Role.GAME_MANAGER
  )
  getDailyAnalytics(
    @Query('date') date: string | undefined,
    @CurrentUser() user?: RequestUser
  ): SupportDailyAnalytics {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.getDailyAnalytics(date, user);
  }

  @Get('debug/runtime')
  @Roles(Role.SUPER_ADMIN, Role.SUPPORT, Role.MANAGER)
  async getRuntimeDiagnostics(@CurrentUser() user?: RequestUser) {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return this.supportService.getRuntimeDiagnostics(user);
  }

  @Get('outbox/pull')
  pullOutbox(
    @Headers('x-integration-token') token: string | undefined,
    @Query('connector', new ParseEnumPipe(SupportConnectorRoute))
    connector: SupportConnectorRoute,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('leaseSec', new ParseIntPipe({ optional: true })) leaseSec?: number
  ): { commands: SupportOutboxCommand[] } {
    this.assertIntegrationToken(token);
    return {
      commands: this.supportService.pullOutbox(connector, limit ?? 20, leaseSec ?? 30)
    };
  }

  @Post('outbox/:id/ack')
  ackOutbox(
    @Headers('x-integration-token') token: string | undefined,
    @Param('id') id: string
  ): SupportOutboxCommand {
    this.assertIntegrationToken(token);
    return this.supportService.ackOutbox(id);
  }

  @Post('outbox/:id/fail')
  failOutbox(
    @Headers('x-integration-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: { error?: string; requeue?: boolean } = {}
  ): SupportOutboxCommand {
    this.assertIntegrationToken(token);
    return this.supportService.failOutbox(id, body.error, body.requeue !== false);
  }

  private assertIntegrationToken(token?: string): void {
    const expected = String(process.env.SUPPORT_INTEGRATION_TOKEN ?? '').trim();
    if (!expected) {
      return;
    }
    if (token === expected) {
      return;
    }
    throw new ForbiddenException('Invalid integration token');
  }
}
